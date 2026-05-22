// Summarize cron (handoff 115). Split out of /api/sync because the
// summarize step was eating the shared 60s function budget and starving
// every subsequent step (lead, news, trades, report). On its own route
// summarize gets the full ceiling: a wall-clock deadline at 45s "stop
// starting new bills" + a 15s per-bill AbortController guarantees the
// function never crosses 60s, even if the last bill hangs on a fetch or
// Gemini call. See lib/summarize-runner.ts for the loop logic.
//
// Auth mirrors the other cron routes (Bearer CRON_SECRET).
// Schedule lives in vercel.json (13:00 UTC daily, clear of /api/sync at
// 09:00, sync-votes at 10:00, race-ratings at 11:00 Wed, primaries at
// 12:00). revalidateTag("bills") flushes the cached bill queries so the
// dashboard sees fresh summaries.
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { finishCronRun, startCronRun } from "@/lib/cron-log";
import { runSummarize } from "@/lib/summarize-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// HO 115 lock: stop starting new bills at 45s wall-clock from route start.
// The 15s per-bill AbortController in runSummarize bounds the in-flight
// bill on top of this. 45 + 15 = 60, the Vercel function ceiling.
const SUMMARIZE_BUDGET_MS = 45_000;

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
  // counts against the 45s budget (it's a Turso round-trip, ~100-300ms;
  // small but real).
  const routeStart = Date.now();
  const runId = await startCronRun("/api/cron/summarize");

  try {
    const stats = await runSummarize({
      deadlineMs: routeStart + SUMMARIZE_BUDGET_MS,
    });
    revalidateTag("bills");

    const elapsedMs = Date.now() - routeStart;
    const responseBody = {
      ok: true,
      elapsedMs,
      summarized: stats.ok,
      failed: stats.failed,
      timedOut: stats.timedOut,
      budgetStopped: stats.budgetStopped,
      promptTokens: stats.promptTokens,
      outputTokens: stats.outputTokens,
      chronicFailures: stats.chronicFailures,
    };

    // Chronic-failure surfacing: bills with >= 3 cumulative summarize
    // attempts get written into the cron_runs error_message column so the
    // log shows them past the 30-minute live-log window. Status stays
    // "success" — these aren't fatal to the tick, just worth eyeballing.
    const errMsg =
      stats.chronicFailures.length > 0
        ? `chronic summarize failures (>=${3} attempts): ${stats.chronicFailures.join(", ")}`
        : undefined;
    await finishCronRun(runId, "success", responseBody, errMsg);
    return NextResponse.json(responseBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron-summarize] failed:", err);
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
