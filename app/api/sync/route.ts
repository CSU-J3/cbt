import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import {
  generateDashboardLead,
  writeDashboardLead,
} from "@/lib/dashboard-lead";
import { prewarmHomeDashboard } from "@/lib/queries";
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

// HO 241: the Gemini lead call is unbounded and variable (≈19s typical, but
// observed >30s), and it sits before the homepage pre-warm. Left unbounded it
// can push the route past wrapCronRoute's 55s soft timeout (504), skipping the
// pre-warm and leaving the homepage cache cold — the exact 500 this fix exists
// to prevent. Bound it so the pre-warm always runs; lead is best-effort (the
// prior lead stays on timeout), so capping it is free.
const LEAD_TIMEOUT_MS = 25_000;

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
      sync: null,
      lead: null,
      prewarm: null,
      trades: null,
    };

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
      let leadTimer: ReturnType<typeof setTimeout> | undefined;
      const leadTimeout = new Promise<never>((_, reject) => {
        leadTimer = setTimeout(
          () => reject(new Error(`lead generation exceeded ${LEAD_TIMEOUT_MS}ms`)),
          LEAD_TIMEOUT_MS,
        );
      });
      try {
        const lead = await Promise.race([generateDashboardLead(), leadTimeout]);
        await writeDashboardLead(lead);
        revalidateTag("bills");
      } finally {
        if (leadTimer) clearTimeout(leadTimer);
      }
    } catch (err) {
      console.warn(
        "[sync] lead generation failed or timed out; keeping prior lead",
        err,
      );
    }
    timings.lead = Date.now() - tLead;
    console.log(`[sync] lead: ${timings.lead}ms`);

    // HO 241: repopulate the homepage's cached query entries now, while this
    // route's sync reads have left Turso's bills pages warm — the recompute
    // lands sub-second here instead of as a ~18-20s cold abort on the first
    // post-invalidation user request. Best-effort (never throws).
    const tPrewarm = Date.now();
    await prewarmHomeDashboard();
    timings.prewarm = Date.now() - tPrewarm;
    console.log(`[sync] prewarm: ${timings.prewarm}ms`);

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
