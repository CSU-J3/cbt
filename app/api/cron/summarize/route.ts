// Summarize cron (handoff 115). Split out of /api/sync because the
// summarize step was eating the shared 60s function budget and starving
// every subsequent step (lead, news, trades, report). On its own route
// summarize gets the full ceiling: a wall-clock deadline at 45s "stop
// starting new bills" + a 15s per-bill AbortController guarantees the
// function never crosses 60s, even if the last bill hangs on a fetch or
// Gemini call. See lib/summarize-runner.ts for the loop logic.
//
// Auth mirrors the other cron routes (Bearer CRON_SECRET).
// Schedule lives in vercel.json: */10, every ten minutes. The neighbours this
// route was once written to dodge have moved too — /api/sync is 0 */6,
// sync-votes 0 10, race-ratings 0 11 Wed, primaries 0 0,12 — so it no longer
// has a reserved slot and does not need one (the HO 432 lock handles overlap).
// revalidateTag("bills") flushes the cached bill queries so the dashboard sees
// fresh summaries — GUARDED as of HO 671: it fires only when the tick actually
// wrote one.
//
// HO 139: migrated to wrapCronRoute. Chronic >=3-attempt summarize
// failures flow through `chronicErr` so they still land in the
// cron_runs.error_message column on success rows.
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { claimCronLock, releaseCronLock } from "@/lib/cron-lock";
import { type CronHandlerResult, wrapCronRoute } from "@/lib/cron-log";
import { runSummarize } from "@/lib/summarize-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// HO 115 lock: stop starting new bills at 45s wall-clock from route start.
// The 15s per-bill AbortController in runSummarize bounds the in-flight
// bill on top of this. 45 + 15 = 60, the Vercel function ceiling.
const SUMMARIZE_BUDGET_MS = 45_000;

// HO 432: overlap guard for the */10 cadence. The 45s budget means a run can't
// overrun into the next scheduled tick, but Vercel Cron is best-effort
// at-least-once and can deliver one tick twice near-simultaneously — and the
// drain isn't overlap-safe (two invocations both SELECT the same summary-IS-NULL
// rows → duplicate Gemini spend + duplicate append-only stage_transitions rows).
// The advisory lock lets exactly one proceed; the other no-ops. TTL is > the 55s
// cron soft-timeout so a clean run always releases before its own claim expires,
// and a SIGKILLed run's claim ages out instead of wedging the queue.
const SUMMARIZE_LOCK_KEY = "cron_lock:summarize";
const SUMMARIZE_LOCK_TTL_MS = 120_000;

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

  const result = await wrapCronRoute("/api/cron/summarize", async (): Promise<
    CronHandlerResult<Record<string, unknown>>
  > => {
    // HO 432: bail if another drain is already in flight (Vercel at-least-once
    // double-delivery). Non-fatal — status stays success, this tick just no-ops.
    const claimed = await claimCronLock(
      SUMMARIZE_LOCK_KEY,
      SUMMARIZE_LOCK_TTL_MS,
    );
    if (!claimed) {
      console.log("[summarize] another drain in flight; skipping this tick");
      return { payload: { skipped: "overlap" as const } };
    }

    try {
      const routeStart = Date.now();
      const stats = await runSummarize({
        // HO 406: raise the per-tick cap from the DEFAULT_LIMIT of 50 to 200 so the
        // 45s budget — not an arbitrary count — is the wall. At C=5 concurrency the
        // budget clears ~100-120 bills/tick, well above the ~30/day inflow, so a
        // single tick self-heals the queue after any outage instead of only
        // steady-state trickling. The 45s deadlineMs still stops it before 200; the
        // per-bill 15s cap keeps the function under 60s regardless.
        limit: 200,
        deadlineMs: routeStart + SUMMARIZE_BUDGET_MS,
      });
      // HO 671 — FLUSH ON THE WRITE, NOT ON THE SCHEDULE. This call was
      // unconditional, so a `*/10` tick invalidated the `bills` tag ~144×/day
      // whether or not it had written anything. That is a cost multiplier, not a
      // safety margin: the tag governs **37** cache entries in lib/queries.ts
      // (27 tagged ["bills"] alone, 10 in combination), so one flush costs the
      // next visitor of every bills-tagged surface a full regeneration —
      // measured at ~89,090 rows_read for /welcome alone (HO 670). And it was
      // almost always pointless: over 300 consecutive ticks (2026-08-16 →
      // 2026-08-18), **296 (98.7%) summarized ZERO bills and flushed anyway**.
      // That ratio is HO 406 working, not failing — the queue is drained and
      // inflow is ~30/day against a tick that clears 100–120 — so the waste was
      // the unconditional flush, never the schedule.
      //
      // `stats.ok` carries the guard because of a code boundary, not a
      // convention: both content-write paths (the advance branch's UPDATE +
      // stage_transitions INSERT, and the no-move branch's UPDATE) fall through
      // to `stats.ok++` with no branch between, so ok > 0 iff a summary landed.
      //
      // A FAILED-ONLY TICK DELIBERATELY DOES NOT FLUSH, and this is the half a
      // future reader is most likely to "fix": the failure path (markBillFailed)
      // writes only `summarize_failed_at` and `summarize_attempts`, and **0 of
      // the 37 tagged queries read either column** — so there is nothing for a
      // flush to propagate. The observed window contained zero (ok = 0,
      // failed > 0) ticks, so that branch is argued from column visibility
      // rather than from counts; this comment is where the argument lives.
      //
      // NOT extended to /api/sync (HO 671 STEP 0): its upsert sits INSIDE the
      // loop's try/catch, so a throw after the row commits is caught and leaves
      // `upserted` at 0 with the write landed — invisible in the return value,
      // so its 4 flushes/day stay unconditional as cheap insurance.
      if (stats.ok > 0) revalidateTag("bills");

      const payload = {
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
      const chronicErr =
        stats.chronicFailures.length > 0
          ? `chronic summarize failures (>=3 attempts): ${stats.chronicFailures.join(", ")}`
          : undefined;

      return { payload, chronicErr };
    } finally {
      // Release even on throw/soft-timeout; a killed function's claim ages out.
      await releaseCronLock(SUMMARIZE_LOCK_KEY);
    }
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
