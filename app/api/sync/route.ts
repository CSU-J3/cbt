import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import {
  generateDashboardLead,
  writeDashboardLead,
} from "@/lib/dashboard-lead";
import { runReportCatchup } from "@/lib/report-generation";
import { runSync } from "@/lib/sync";
import { ingestTrades } from "@/lib/trades-ingest";

// Daily sync cron. HO 115 split summarize out; HO 116 bounded runSync;
// HO 117 split news ingestion into /api/cron/news; HO 139 split the
// weekly report into /api/cron/weekly-report and migrated this route to
// the `wrapCronRoute` finalize pattern. This route now runs: bill sync
// (≤30s budget) → dashboard lead → trades. Report and news live on their
// own crons. Per-step wall-clock times are logged and included in the
// cron_runs payload.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// HO 116 lock: stop starting new bills in runSync at 30s wall-clock from
// route start. Leaves ~25s for downstream steps (lead + trades) inside
// the 60s function ceiling.
const SYNC_BUDGET_MS = 30_000;

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
      lead: null,
      trades: null,
    };

    // Weekly-report daily catch-up (HO 285). Runs FIRST, ahead of the
    // resumable bill sync and the orphaned dashboard lead — a deliberate
    // deviation from the handoff's "after the normal sync work". The 284
    // budget read showed this route already runs 33-55s and soft-times-out
    // ~1 day in 5, so a 15-29s gen appended after sync+lead+trades would
    // never fit under the 55s soft cap on exactly the (gap) days it must run.
    // On the common no-op day this is a single indexed PK lookup (~tens of
    // ms); on a rare gap day the report gen gets full headroom and the
    // self-resuming sync simply continues next tick. Non-fatal: a transient
    // gen failure leaves the row missing for the next day's catch-up.
    const tCatchup = Date.now();
    try {
      const catchup = await runReportCatchup();
      if (catchup.generated) {
        revalidateTag("reports");
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
      console.warn("[sync] report catch-up failed; will retry next tick", err);
    }
    timings.reportCatchup = Date.now() - tCatchup;

    const tSync = Date.now();
    const sync = await runSync({ deadlineMs: routeStart + SYNC_BUDGET_MS });
    timings.sync = Date.now() - tSync;
    console.log(
      `[sync] runSync: ${timings.sync}ms ` +
        `(seen=${sync.seen} upserted=${sync.upserted} skipped=${sync.skipped} ` +
        `failed=${sync.failed} timeout=${sync.timedOut} budgetStopped=${sync.budgetStopped})`,
    );
    // Invalidate after sync writes new bill rows so the dashboard sees them
    // before any later step in this tick fails.
    revalidateTag("bills");

    // Regenerate the dashboard lead from the freshly synced data. Non-fatal:
    // if Gemini errors or rate-limits, the prior lead stays in the DB and the
    // dashboard keeps rendering it.
    const tLead = Date.now();
    try {
      const lead = await generateDashboardLead();
      await writeDashboardLead(lead);
      revalidateTag("bills");
    } catch (err) {
      console.warn("[sync] lead generation failed; keeping prior lead", err);
    }
    timings.lead = Date.now() - tLead;
    console.log(`[sync] lead: ${timings.lead}ms`);

    // Stock-trade ingestion (handoff 70). Pulls FMP disclosure pages and
    // writes to stock_trades. Best-effort: missing FMP_API_KEY or a stuck
    // endpoint logs and skips, never crashes the cron.
    const tTrades = Date.now();
    try {
      const tradeResults = await ingestTrades({ maxPagesPerChamber: 3 });
      for (const r of tradeResults) {
        console.log(
          `[sync] trades.${r.chamber}: pages=${r.pagesFetched} inserted=${r.inserted} matched=${r.matched} unmatched_names=${r.unmatchedNames.size}`,
        );
        for (const e of r.errors) console.warn(`[sync] trades error: ${e}`);
      }
      revalidateTag("member-trades");
    } catch (err) {
      console.warn("[sync] trades ingestion failed; skipping", err);
    }
    timings.trades = Date.now() - tTrades;
    console.log(`[sync] trades: ${timings.trades}ms`);

    const elapsedMs = Date.now() - routeStart;
    console.log(`[sync] total: ${elapsedMs}ms`);

    return {
      payload: { timings, sync },
    };
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET; support it so the same schedule works in production.
export async function GET(request: Request) {
  return handle(request);
}
