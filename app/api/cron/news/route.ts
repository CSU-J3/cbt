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
//
// HO 139: migrated to wrapCronRoute. Per-article LLM timeouts flow through
// `chronicErr` to land in cron_runs.error_message on success rows.
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
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

  const result = await wrapCronRoute("/api/cron/news", async () => {
    const routeStart = Date.now();
    const feeds = await ingestNews({
      deadlineMs: routeStart + NEWS_BUDGET_MS,
    });

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
    // HO 398: flush the race-detail news section (getRaceNews) — new obs from
    // this tick may mention a race incumbent. Tag must also be allowlisted on
    // /api/revalidate or its first manual flush 400s (oddities, HO 390).
    revalidateTag("race-news");

    const payload = {
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

    // Surface chronic per-article LLM timeouts into cron_runs error trail
    // (HO 115 pattern) — non-fatal, status stays success.
    const chronicErr =
      totalLlmTimeouts > 0
        ? `llm timeouts: ${totalLlmTimeouts} article(s) exceeded the per-article cap`
        : undefined;

    return { payload, chronicErr };
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET; support both so the same path works in production
// and from manual curl.
export async function GET(request: Request) {
  return handle(request);
}
