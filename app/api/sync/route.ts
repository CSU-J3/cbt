import { expireTag } from "@/lib/cache/expire-tag";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import { runReportCatchup } from "@/lib/report-generation";
import { runSync } from "@/lib/sync";
import { ingestTrades, type TradesIngestResult } from "@/lib/trades-ingest";

// Sync cron, every 6h (`0 */6`, vercel.json). HO 115 split summarize out; HO 116 bounded runSync;
// HO 117 split news ingestion into /api/cron/news; HO 139 split the
// weekly report into /api/cron/weekly-report and migrated this route to
// the `wrapCronRoute` finalize pattern. HO 667 retired the dashboard-lead
// step (orphaned since HO 244 — nothing had rendered the lead in ~400
// handoffs, and it was the dominant step at ~25.3s of a 40.4s run).
// This route now runs: report catch-up → bill sync (≤240s budget) → trades.
// Report and news live on their own crons. Per-step wall-clock times are
// logged and included in the cron_runs payload — note `timings.lead` is
// GONE from that payload as of HO 667, so a row with no `lead` key is a
// post-667 tick, not a truncated payload. HO 790: the sync lists from the
// frontier in sync_state into sync_queue and drains it, so a tick the budget
// stops leaves its rows queued for the next one (lib/sync.ts header).
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// HO 790: stop starting new list pages and queued bills in runSync 240s after
// route start; the report catch-up before it counts against the 240s, and a
// detail fetch in flight then is cut by its 15s cap. Trades follow, inside the
// 290s soft timeout under the 300s ceiling: the committees route's layering
// (app/api/cron/committees/route.ts). Until HO 790 the budget was 30s under a
// 60s ceiling, and a tick got through a median 63 bills.
const SYNC_BUDGET_MS = 240_000;
const SOFT_TIMEOUT_MS = 290_000;

function authorize(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server" },
      { status: 500 },
    );
  }
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

async function handle(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  const result = await wrapCronRoute("/api/sync", async () => {
    const routeStart = Date.now();

    // Per-step wall-clock timings. Surfaced in console.log AND in the
    // cron_runs.payload so a future "step X is overrunning its share of the
    // budget" investigation has data without an instrumentation pass first.
    const timings: Record<string, number | null> = {
      reportCatchup: null,
      sync: null,
      trades: null,
    };

    // Weekly-report catch-up (HO 285), on every sync tick (every 6h). Runs FIRST, ahead of the
    // resumable bill sync and the orphaned dashboard lead — a deliberate
    // deviation from the handoff's "after the normal sync work". The 284
    // budget read showed this route already runs 33-55s and soft-times-out
    // ~1 day in 5, so a 15-29s gen appended after sync+lead+trades would
    // never fit under the 55s soft cap on exactly the (gap) days it must run.
    // On the common no-op day this is a single indexed PK lookup (~tens of
    // ms); on a rare gap day the report gen gets full headroom and the
    // self-resuming sync simply continues next tick. Non-fatal: a transient
    // gen failure leaves the row missing for the next tick's catch-up, six hours later.
    const tCatchup = Date.now();
    // HO 407: capture the catch-up outcome as a machine-keyable signal. Before
    // this the failure was swallowed by console.warn and the route still
    // returned success, so a catch-up failing EVERY day (the gatherReportData
    // cold-stall) was invisible in cron_runs for two weeks. Surfaced two ways: a
    // distinct `payload.reportCatchup.ok` field, AND via chronicErr into the
    // cron_runs.error_message column with a stable `report-catchup-failed:`
    // prefix — so a status-level cron-health audit keys on either without
    // parsing payload JSON by hand. Still non-fatal: the route stays success.
    let reportCatchupError: string | null = null;
    let reportCatchupGenerated: string | null = null;
    try {
      const catchup = await runReportCatchup();
      reportCatchupGenerated = catchup.generated;
      if (catchup.generated) {
        expireTag("reports");
        console.log(
          `[sync] report catch-up: generated ${catchup.generated} ` +
            `(${catchup.missing}/${catchup.checked} weeks missing)`,
        );
      } else {
        console.log(
          `[sync] report catch-up: nothing missing (${catchup.checked} weeks checked)`,
        );
      }
    } catch (err) {
      reportCatchupError = err instanceof Error ? err.message : String(err);
      console.warn("[sync] report catch-up failed; will retry next tick", err);
    }
    timings.reportCatchup = Date.now() - tCatchup;

    const tSync = Date.now();
    const sync = await runSync({ deadlineMs: routeStart + SYNC_BUDGET_MS });
    timings.sync = Date.now() - tSync;
    console.log(
      `[sync] runSync: ${timings.sync}ms ` +
        `(seen=${sync.seen} enqueued=${sync.enqueued} upserted=${sync.upserted} skipped=${sync.skipped} ` +
        `failed=${sync.failed} timeout=${sync.timedOut} queue=${sync.queueBefore}→${sync.queueAfter} ` +
        `listComplete=${sync.listComplete} budgetStopped=${sync.budgetStopped})`,
    );
    // Invalidate after sync writes new bill rows so the dashboard sees them
    // before any later step in this tick fails.
    expireTag("bills");

    // HO 806: stock trades from CapitolStockWatch's open dataset, mirrored for the
    // feed's filing-date window (lib/trades-ingest.ts). Non-fatal: a fetch or write
    // failure logs and rides chronicErr as `trades-failed:`, a refused delete as
    // `trades-delete-refused:`, and the route stays success.
    const tTrades = Date.now();
    let trades: TradesIngestResult | null = null;
    let tradesError: string | null = null;
    try {
      trades = await ingestTrades();
      console.log(
        `[sync] trades: fetched=${trades.fetched} kept=${trades.kept} window=${trades.window.from}..${trades.window.to} ` +
          `domain=${trades.domain} inserted=${trades.inserted} updated=${trades.updated} deleted=${trades.deleted} ` +
          `deleteRefused=${trades.deleteRefused} matched=${trades.matched} unmatched=${trades.unmatchedNames.length} ` +
          `duplicateIds=${trades.duplicateIds} ownerOther=${trades.ownerOther}`,
      );
      if (trades.inserted + trades.updated + trades.deleted > 0) {
        expireTag("member-trades");
      }
    } catch (err) {
      tradesError = err instanceof Error ? err.message : String(err);
      console.warn("[sync] trades ingestion failed; skipping", err);
    }
    timings.trades = Date.now() - tTrades;
    console.log(`[sync] trades: ${timings.trades}ms`);

    const elapsedMs = Date.now() - routeStart;
    console.log(`[sync] total: ${elapsedMs}ms`);

    return {
      payload: {
        timings,
        sync,
        // HO 407: machine-keyable catch-up health. ok=false → the weekly report's
        // catch-up backfill threw this tick (see error for the message).
        reportCatchup: {
          ok: reportCatchupError === null,
          generated: reportCatchupGenerated,
          error: reportCatchupError,
        },
        // HO 806: the trades step's counts (lib/trades-ingest.ts), the unmatched
        // names cut to 10; null if the step threw.
        trades: trades
          ? { ...trades, unmatchedNames: trades.unmatchedNames.slice(0, 10) }
          : null,
      },
      // Non-fatal surfacing into cron_runs.error_message (status stays success).
      chronicErr:
        [
          reportCatchupError ? `report-catchup-failed: ${reportCatchupError}` : null,
          tradesError ? `trades-failed: ${tradesError}` : null,
          trades && trades.deleteRefused > 0
            ? `trades-delete-refused: ${trades.deleteRefused}`
            : null,
          trades && trades.duplicateIds > 0
            ? `trades-duplicate-ids: ${trades.duplicateIds}`
            : null,
        ]
          .filter((s): s is string => s !== null)
          .join("; ") || undefined,
    };
  }, { softTimeoutMs: SOFT_TIMEOUT_MS });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET; support it so the same schedule works in production.
export async function GET(request: Request) {
  return handle(request);
}
