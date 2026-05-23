import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { startCronRun, finishCronRun } from "@/lib/cron-log";
import {
  generateDashboardLead,
  writeDashboardLead,
} from "@/lib/dashboard-lead";
import { ingestNews } from "@/lib/news-ingest";
import {
  generateWeeklyReport,
  getPriorWeek,
  writeReport,
} from "@/lib/report-generation";
import { runSync } from "@/lib/sync";
import { ingestTrades } from "@/lib/trades-ingest";

// Daily sync cron. HO 115 split summarize out; HO 116 bounded runSync. This
// route now runs: bill sync (≤30s budget) → dashboard lead → news → trades →
// weekly report (Mondays only). Per-step wall-clock times are logged and
// included in the cron_runs payload so the next "step X starved" problem
// becomes visible without instrumentation work.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// HO 116 lock: stop starting new bills in runSync at 30s wall-clock from
// route start. Leaves ~25s for downstream steps (lead + news + trades +
// Monday report) inside the 60s function ceiling.
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

  // Durable cron logging (handoff 105). startCronRun runs after the auth
  // check so unauthorized probes never reach cron_runs. The downstream
  // steps (lead/news/trades/report) deliberately swallow their own errors —
  // only runSync() and the cron-log writes throw out of here.
  const routeStart = Date.now();
  const runId = await startCronRun("/api/sync");

  // Per-step wall-clock timings. Surfaced in console.log AND in the
  // responseBody → cron_runs.payload, so a future "step X is overrunning
  // its share of the budget" investigation has data without an HO 117
  // instrumentation pass first.
  const timings: Record<string, number | null> = {
    sync: null,
    lead: null,
    news: null,
    trades: null,
    report: null,
  };

  try {
    const tSync = Date.now();
    const sync = await runSync({ deadlineMs: routeStart + SYNC_BUDGET_MS });
    timings.sync = Date.now() - tSync;
    console.log(
      `[sync] runSync: ${timings.sync}ms ` +
        `(seen=${sync.seen} upserted=${sync.upserted} skipped=${sync.skipped} ` +
        `failed=${sync.failed} timeout=${sync.timedOut} budgetStopped=${sync.budgetStopped})`,
    );
    // Invalidate after sync writes new bill rows so the dashboard sees them
    // before any later step in this tick fails. HO 115 removed the
    // summarize step from this route; summarize now runs at /api/cron/summarize
    // and revalidates `bills` on its own when summaries land.
    revalidateTag("bills");

    // Regenerate the dashboard lead from the freshly synced data. Non-fatal:
    // if Gemini errors or rate-limits, the prior lead stays in the DB and the
    // dashboard keeps rendering it. revalidateTag flushes the cached lead.
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

    // News ingestion (handoff 64). Pulls 3 RSS feeds, regex-matches bill ids,
    // writes to news_mentions. Best-effort: per-source errors get logged but
    // never fail the cron — sync already wrote its data and news is purely
    // an enrichment surface. UI consumption: HO 66/67 plus the HO 114
    // breaking-news block on the home page.
    const tNews = Date.now();
    try {
      const newsResults = await ingestNews();
      const totalInserted = newsResults.reduce(
        (s, r) => s + r.mentionsInserted,
        0,
      );
      const totalErrors = newsResults.flatMap((r) => r.errors);
      console.log(
        `[sync] news: ${totalInserted} mentions inserted across ${newsResults.length} sources`,
      );
      for (const r of newsResults) {
        console.log(
          `[sync] news.${r.source}: fetched=${r.itemsFetched} mentions=${r.mentionsInserted} skipped_unknown_bill=${r.mentionsSkippedUnknownBill} llm_calls=${r.llmCalls} llm_matches=${r.llmMatches} llm_errors=${r.llmErrors}`,
        );
      }
      if (totalErrors.length > 0) {
        for (const e of totalErrors) console.warn(`[sync] news error: ${e}`);
      }
      // Flush the breaking-news query cache so /news and the home block see
      // fresh mentions without waiting on the 600s backstop revalidate.
      revalidateTag("news-breaking");
    } catch (err) {
      console.warn("[sync] news ingestion failed; skipping", err);
    }
    timings.news = Date.now() - tNews;
    console.log(`[sync] news: ${timings.news}ms`);

    // Stock-trade ingestion (handoff 70). Pulls FMP disclosure pages and
    // writes to stock_trades. Best-effort: missing FMP_API_KEY or a stuck
    // endpoint logs and skips, never crashes the cron. Capped at 3 pages
    // per chamber on the cron path — cron is incremental, the 20-page
    // backfill is reserved for `npm run sync:trades`.
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

    // Weekly report — generated on Monday for the prior calendar week. The
    // Monday check is UTC because the cron runs at 09:00 UTC. Non-fatal: on
    // failure no row is written, the cron's other steps still complete, and
    // manual recovery is `npm run report`.
    const now = new Date();
    if (now.getUTCDay() === 1) {
      const tReport = Date.now();
      try {
        const week = getPriorWeek(now);
        const report = await generateWeeklyReport(week);
        await writeReport({
          slug: report.slug,
          weekStart: week.start,
          weekEnd: week.end,
          title: report.title,
          contentMd: report.content_md,
        });
        revalidateTag("reports");
      } catch (err) {
        console.warn("[cron] report generation failed; skipping", err);
      }
      timings.report = Date.now() - tReport;
      console.log(`[sync] report: ${timings.report}ms`);
    }

    const elapsedMs = Date.now() - routeStart;
    console.log(`[sync] total: ${elapsedMs}ms`);

    const responseBody = {
      ok: true,
      elapsedMs,
      timings,
      sync,
    };
    await finishCronRun(runId, "success", responseBody);
    return NextResponse.json(responseBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishCronRun(runId, "error", { timings }, message);
    throw err; // let Next.js return the 500 as before
  }
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET; support it so the same schedule works in production.
export async function GET(request: Request) {
  return handle(request);
}
