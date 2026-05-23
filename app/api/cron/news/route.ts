// News ingestion cron (handoff 117). Split out of /api/sync because the
// 52-article LLM matcher step (~580ms avg, 250ms throttle = ~830ms/article)
// crept up to ~45s on its own and threatened to push /api/sync past the 60s
// ceiling — same shape as HO 115's summarize hang. On its own route news
// gets the full budget: a 45s "stop starting new articles" deadline + an
// 8s per-article AbortController (≈ 10× the observed p95 of 760ms), so the
// function stays inside 60s even if the very last article hangs on a
// Gemini call.
//
// Auth mirrors the other cron routes (Bearer CRON_SECRET). Schedule: 14:00
// UTC daily (clean of /api/sync 09, /api/sync-votes 10, /api/sync-race-
// ratings 11 Wed, /api/cron/primaries 12, /api/cron/summarize 13). 14:00
// also runs *after* summarize so the matcher's getCandidateBills(30) pool
// sees the freshest summaries when the matcher ever leans on them.
//
// revalidateTag("news-breaking") flushes both /news (getBreakingNews) and
// the home block (getBreakingNewsForHome) — both share that tag per HO 114.
// /api/sync no longer touches the tag (it doesn't write to news_mentions
// after HO 117). If the home block goes stale post-deploy, this flush is
// the first thing to check.
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { finishCronRun, startCronRun } from "@/lib/cron-log";
import { ingestNews } from "@/lib/news-ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// HO 117 lock: 45s deadline + 8s AbortController + ~2s for cron-log writes
// = 55s worst case. Comfortable margin under the 60s ceiling.
const NEWS_BUDGET_MS = 45_000;

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

  // Start the deadline clock BEFORE startCronRun so the cron-log INSERT
  // counts against the 45s budget (Turso round-trip ~100-300ms).
  const routeStart = Date.now();
  const runId = await startCronRun("/api/cron/news");

  try {
    const feeds = await ingestNews({ deadlineMs: routeStart + NEWS_BUDGET_MS });

    // Per-feed wall-clock for cron_runs.payload.timings — same shape as
    // /api/sync's timings object so the watch-pattern stays consistent.
    const timings: Record<string, number> = {};
    for (const r of feeds) timings[r.source] = r.wallMs;

    const totalInserted = feeds.reduce((s, r) => s + r.mentionsInserted, 0);
    const totalLlmCalls = feeds.reduce((s, r) => s + r.llmCalls, 0);
    const totalLlmMatches = feeds.reduce((s, r) => s + r.llmMatches, 0);
    const totalLlmErrors = feeds.reduce((s, r) => s + r.llmErrors, 0);
    const totalLlmTimeouts = feeds.reduce((s, r) => s + r.llmTimeouts, 0);
    const anyBudgetStopped = feeds.some((r) => r.budgetStopped);

    console.log(
      `[news] ${totalInserted} mentions inserted across ${feeds.length} sources`,
    );
    for (const r of feeds) {
      console.log(
        `[news] ${r.source}: wall=${r.wallMs}ms items=${r.itemsFetched} ` +
          `mentions=${r.mentionsInserted} skipped_unknown_bill=${r.mentionsSkippedUnknownBill} ` +
          `llm_calls=${r.llmCalls} llm_matches=${r.llmMatches} ` +
          `llm_errors=${r.llmErrors} llm_timeouts=${r.llmTimeouts} ` +
          `budgetStopped=${r.budgetStopped}`,
      );
      for (const e of r.errors) console.warn(`[news] ${r.source} error: ${e}`);
    }

    // Flush both /news and the HO 114 home block — same shared tag.
    revalidateTag("news-breaking");

    const elapsedMs = Date.now() - routeStart;
    console.log(`[news] total: ${elapsedMs}ms`);

    const responseBody = {
      ok: true,
      elapsedMs,
      timings,
      totals: {
        mentions: totalInserted,
        llmCalls: totalLlmCalls,
        llmMatches: totalLlmMatches,
        llmErrors: totalLlmErrors,
        llmTimeouts: totalLlmTimeouts,
      },
      budgetStopped: anyBudgetStopped,
      feeds,
    };

    // Surface chronic per-article LLM timeouts into the cron_runs error
    // trail (HO 115 pattern) — non-fatal, status stays success.
    const errMsg =
      totalLlmTimeouts > 0
        ? `llm timeouts: ${totalLlmTimeouts} article(s) exceeded the per-article cap`
        : undefined;
    await finishCronRun(runId, "success", responseBody, errMsg);
    return NextResponse.json(responseBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron-news] failed:", err);
    await finishCronRun(runId, "error", null, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET; support both so the same path works in production
// and from manual curl.
export async function GET(request: Request) {
  return handle(request);
}
