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

// Daily sync cron. HO 115 split summarize out into /api/cron/summarize because
// summarize alone consumed most of the 60s budget and starved every step
// behind it (news, trades, report were never reached). This route now runs:
// bill sync → dashboard lead → news ingest → trades → weekly report (Mon).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  // check so unauthorized probes never reach cron_runs. The whole sync body
  // is wrapped: only runSync() throws out of here (the summarize/news/trades/
  // report steps below are deliberately non-fatal and swallow their own
  // errors — their failure shows up as a null in the persisted payload).
  const runId = await startCronRun("/api/sync");
  try {
    const sync = await runSync();
    // Invalidate after sync writes new bill rows so the dashboard sees them
    // before any later step in this tick fails. HO 115 removed the
    // summarize step from this route; summarize now runs at /api/cron/summarize
    // and revalidates `bills` on its own when summaries land.
    revalidateTag("bills");

    // Regenerate the dashboard lead from the freshly synced data. Non-fatal:
    // if Gemini errors or rate-limits, the prior lead stays in the DB and the
    // dashboard keeps rendering it. revalidateTag flushes the cached lead.
    try {
      const lead = await generateDashboardLead();
      await writeDashboardLead(lead);
      revalidateTag("bills");
    } catch (err) {
      console.warn("[sync] lead generation failed; keeping prior lead", err);
    }

    // News ingestion (handoff 64). Pulls 3 RSS feeds, regex-matches bill ids,
    // writes to news_mentions. Best-effort: per-source errors get logged but
    // never fail the cron — sync + summarize already wrote their data and
    // news is purely an enrichment surface. UI consumption lands in 66/67.
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
      // Flush the breaking-news query cache so /news and the home banner see
      // fresh mentions without waiting on the 600s backstop revalidate.
      revalidateTag("news-breaking");
    } catch (err) {
      console.warn("[sync] news ingestion failed; skipping", err);
    }

    // Stock-trade ingestion (handoff 70). Pulls FMP disclosure pages and
    // writes to stock_trades. Best-effort: missing FMP_API_KEY or a stuck
    // endpoint logs and skips, never crashes the cron. Capped at 3 pages
    // per chamber on the cron path — cron is incremental, the 20-page
    // backfill is reserved for `npm run sync:trades`.
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

    // Weekly report — generated on Monday for the prior calendar week. The
    // Monday check is UTC because the cron runs at 09:00 UTC. Non-fatal: on
    // failure no row is written, the cron's other steps still complete, and
    // manual recovery is `npm run report`.
    const now = new Date();
    if (now.getUTCDay() === 1) {
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
    }

    const responseBody = {
      ok: true,
      sync,
    };
    await finishCronRun(runId, "success", responseBody);
    return NextResponse.json(responseBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishCronRun(runId, "error", null, message);
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
