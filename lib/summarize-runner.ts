import { GoogleGenAI } from "@google/genai";
import { getDb } from "./db";
import { computeStage, stageRank } from "./enums";
import { isRetryable, sleep, withGeminiRetry } from "./gemini-retry";
import {
  fetchBillContext,
  summarizeBill,
  SUMMARY_MODEL,
  type BillRow,
  type SummarizeResult,
} from "./summarize";

const PER_REQUEST_DELAY_MS = 400;
const RETRY_BACKOFF_MS = [2000, 4000, 8000, 16000];
const DEFAULT_LIMIT = 50;
// HO 115: hard wall-clock cap per bill. Combined with the route's 45s
// "stop starting new bills" deadline (passed via deadlineMs), 45s + 15s
// guarantees the cron function never crosses Vercel's 60s ceiling — even
// if the very last bill hangs on a fetch or Gemini call.
const PER_BILL_TIMEOUT_MS = 15_000;
// HO 115: how long to wait after a per-bill failure before re-attempting it.
// Matches the daily cron cadence — a failed bill cleanly retries on the next
// tick instead of burning consecutive ticks. Reset to NULL/0 when the bill
// re-syncs (see UPSERT_SQL) or summarizes successfully.
const FAILURE_DEFER_HOURS = 24;
// HO 115: bills crossing this attempt count are surfaced into the
// cron_runs error trail for manual inspection — not auto-disabled, just
// flagged. Each tick still retries them once the 24h defer elapses.
const CHRONIC_ATTEMPT_THRESHOLD = 3;

export type SummarizeStats = {
  ok: number;
  failed: number;
  // Subset of `failed` whose abort signal fired — i.e. they hit the
  // per-bill 15s wall-clock cap rather than a model/network error.
  timedOut: number;
  promptTokens: number;
  outputTokens: number;
  samples: Array<{ bill: BillRow; result: SummarizeResult }>;
  // HO 115: bill ids that crossed CHRONIC_ATTEMPT_THRESHOLD this tick, with
  // their post-increment attempt count for the cron_runs error message.
  chronicFailures: string[];
  // HO 115: did the tick stop because deadlineMs was reached (vs. exhausting
  // the eligible bill list)? Useful in the route's response payload.
  budgetStopped: boolean;
};

export type SummarizeOptions = {
  /**
   * Maximum number of bills to process. Defaults to 50 (kept for the
   * standalone CLI which still uses a count-based slice). Pass 0 for
   * unbounded (full-backlog drain via `npm run summarize`).
   */
  limit?: number;
  types?: string[];
  /**
   * HO 115: absolute epoch-millis past which the loop stops *starting* new
   * bills. The 15s per-bill AbortController bounds the in-flight bill on
   * top of this, so the route can budget `deadlineMs = routeStart + 45_000`
   * and stay safely under the 60s function ceiling. When both `limit` and
   * `deadlineMs` are set, whichever fires first stops the loop.
   */
  deadlineMs?: number;
};

// HO 115: increment the failure counter and stamp summarize_failed_at so the
// selector's 24h-skip clause picks the bill up again on the next-but-one tick.
// Returns the post-increment attempt count so the runner can flag chronic
// failures (>= 3) to the cron_runs error trail.
async function markBillFailed(
  db: ReturnType<typeof getDb>,
  billId: string,
): Promise<number> {
  const rs = await db.execute({
    sql: `UPDATE bills
          SET summarize_failed_at = ?,
              summarize_attempts = summarize_attempts + 1
          WHERE id = ?
          RETURNING summarize_attempts`,
    args: [new Date().toISOString(), billId],
  });
  return Number(rs.rows[0]?.summarize_attempts ?? 0);
}

// HO 239 stage-monotonicity guard. Given the bill's current stage, the stage
// the classifier just proposed, and any pending downgrade already on record,
// decide what the slot write should do. Rank order is the canonical
// ALLOWED_STAGES one (lib/enums.ts `stageRank`).
//   "advance" — move the slot + log it: a forward move, a first observation
//               past introduced, or a backward move confirmed by a matching
//               pending proposal (a genuine recommit reclassifies stably).
//   "reject"  — an impossible *→introduced downgrade; never moves, always warns
//               (a wrong answer that is stable is still wrong).
//   "pend"    — a first-seen non-introduced downgrade; record it and wait for a
//               second, matching vote before moving (flicker rarely repeats).
//   "noop"    — no stage change (proposed equals current).
export type StageDecision = "advance" | "reject" | "pend" | "noop";

export function decideStage(
  current: string | null,
  proposed: string,
  pending: string | null,
): StageDecision {
  if (current === null) return proposed === "introduced" ? "noop" : "advance";
  if (proposed === current) return "noop";
  if (stageRank(proposed) > stageRank(current)) return "advance";
  // Backward from here.
  if (proposed === "introduced") return "reject";
  if (proposed === pending) return "advance"; // same downgrade twice → confirmed
  return "pend";
}

export async function runSummarize(
  options: SummarizeOptions = {},
): Promise<SummarizeStats> {
  const congressKey = process.env.CONGRESS_API_KEY;
  if (!congressKey) throw new Error("CONGRESS_API_KEY is not set");
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("GEMINI_API_KEY is not set");

  const db = getDb();
  const client = new GoogleGenAI({ apiKey: geminiKey });

  const limit = options.limit ?? DEFAULT_LIMIT;
  const deadlineMs = options.deadlineMs;

  // HO 115: selector adds the 24h skip clause so a bill that failed within
  // the last day doesn't get re-tried on this tick. Bills that never failed
  // (summarize_failed_at IS NULL) pass through normally; this is also the
  // state for the entire pre-115 corpus after migration.
  const where: string[] = [
    "summary IS NULL",
    `(summarize_failed_at IS NULL OR summarize_failed_at < datetime('now', '-${FAILURE_DEFER_HOURS} hours'))`,
  ];
  const args: (string | number)[] = [];
  if (options.types && options.types.length > 0) {
    where.push(`bill_type IN (${options.types.map(() => "?").join(",")})`);
    args.push(...options.types);
  }
  // HO 383: fetch the full eligible set (no SQL LIMIT) so we can PRIORITIZE by
  // the stage computed live from latest_action_text — a presented/enacted bill
  // must summarize ahead of the ~1.4k introduced backlog, and its STORED stage
  // is stale by definition (that is the bug), so a stored-stage sort would never
  // surface it. The set is small and this runs with no request cap, so the full
  // fetch + app-side sort is trivial (trap 1: never ORDER BY CASE in SQL — it
  // defeats the index short-circuit). The per-tick `limit` is applied in TS
  // after the priority sort, below.
  const sql = `SELECT id, congress, bill_type, bill_number, title, latest_action_text, stage, pending_stage
    FROM bills WHERE ${where.join(" AND ")} ORDER BY update_date DESC`;
  const rs = await db.execute({ sql, args });

  const eligible: Array<
    BillRow & { oldStage: string | null; pendingStage: string | null }
  > = rs.rows.map((r) => ({
    id: r.id as string,
    congress: r.congress as number,
    bill_type: r.bill_type as string,
    bill_number: r.bill_number as number,
    title: r.title as string,
    latest_action_text: (r.latest_action_text as string | null) ?? null,
    oldStage: (r.stage as string | null) ?? null,
    // HO 239: the bill's currently-pending downgrade proposal, if any. A
    // second consecutive proposal of this same stage confirms the move.
    pendingStage: (r.pending_stage as string | null) ?? null,
  }));

  // HO 383: stable sort by computed-stage rank DESC (enacted/president first).
  // Array.sort is stable, so within an equal stage the SQL's update_date-DESC
  // order is preserved (newest first). Then take the per-tick cap.
  eligible.sort(
    (a, b) =>
      stageRank(computeStage(b.latest_action_text)) -
      stageRank(computeStage(a.latest_action_text)),
  );
  const bills = limit > 0 ? eligible.slice(0, limit) : eligible;

  console.log(
    `processing ${bills.length} bill(s) ${limit > 0 ? `(limit ${limit})` : "(all)"} ${deadlineMs ? `deadline=${new Date(deadlineMs).toISOString()} ` : ""}serial, ${PER_REQUEST_DELAY_MS}ms throttle, ${PER_BILL_TIMEOUT_MS}ms per-bill cap`,
  );

  const stats: SummarizeStats = {
    ok: 0,
    failed: 0,
    timedOut: 0,
    promptTokens: 0,
    outputTokens: 0,
    samples: [],
    chronicFailures: [],
    budgetStopped: false,
  };
  let gaveUpRetryable = 0;

  for (let i = 0; i < bills.length; i++) {
    // Deadline check before starting a new bill, so the 15s per-bill cap
    // is the only thing that can push us past `deadlineMs`.
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      stats.budgetStopped = true;
      console.log(
        `budget reached after ${i}/${bills.length} bill(s); stopping`,
      );
      break;
    }

    const bill = bills[i]!;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PER_BILL_TIMEOUT_MS);

    let out: Awaited<ReturnType<typeof summarizeBill>> | null = null;
    let failed = false;

    try {
      // Retry transient Gemini errors via the shared helper; the per-bill
      // AbortController (ac.signal) bounds total time exactly as before — once
      // the 15s timer fires, a pending backoff is interrupted and the error is
      // re-thrown for classification below.
      out = await withGeminiRetry(
        async () => {
          const ctx = await fetchBillContext(bill, congressKey, ac.signal);
          return summarizeBill(client, bill, ctx, ac.signal);
        },
        {
          backoffMs: RETRY_BACKOFF_MS,
          signal: ac.signal,
          onRetry: ({ attempt, total, waitMs, error }) =>
            console.warn(
              `retry ${bill.id}: backoff ${waitMs}ms (attempt ${attempt + 1}/${total}) ${error.message.slice(0, 80)}`,
            ),
        },
      );
    } catch (e) {
      if (ac.signal.aborted) {
        console.warn(
          `timeout ${bill.id}: exceeded ${PER_BILL_TIMEOUT_MS}ms, deferring ${FAILURE_DEFER_HOURS}h`,
        );
      } else if (isRetryable(e)) {
        gaveUpRetryable++;
        console.warn(
          `retry-give-up ${bill.id}: deferring ${FAILURE_DEFER_HOURS}h (total give-ups: ${gaveUpRetryable})`,
        );
      } else {
        console.error(`error ${bill.id}:`, (e as Error).message);
      }
      failed = true;
    } finally {
      clearTimeout(timer);
    }

    // Always count tokens even when parsing failed — they were billed.
    if (out) {
      stats.promptTokens += out.promptTokens;
      stats.outputTokens += out.outputTokens;
    }

    const succeeded = !failed && out !== null && out.result !== null;
    if (!succeeded) {
      if (!failed && out && !out.result) {
        console.warn(`parse-fail: ${bill.id}`);
      }
      stats.failed++;
      if (ac.signal.aborted) stats.timedOut++;
      // Stamp the failure so the next tick's selector skips this bill for
      // FAILURE_DEFER_HOURS. Same UPDATE for all failure shapes — timeout,
      // retry give-up, non-retryable error, parse-fail — so any stuck bill
      // can't repeatedly burn budget.
      const attempts = await markBillFailed(db, bill.id);
      if (attempts >= CHRONIC_ATTEMPT_THRESHOLD) {
        stats.chronicFailures.push(`${bill.id}(attempts=${attempts})`);
      }
    } else {
      const result = out!.result!;
      // HO 383: stage is derived deterministically from latest_action_text via
      // computeStage — NOT from the LLM's result.stage (still emitted by the
      // prompt, now ignored; stripping it from the prompt is banked). Same
      // helper as sync, so the two write paths can't disagree.
      const computedStage = computeStage(bill.latest_action_text);
      const ceremonialArg =
        result.is_ceremonial === null ? null : result.is_ceremonial ? 1 : 0;
      // HO 239: the stage-monotonicity guard sits on the one slot-write point
      // (shared with the HO 232 log). A first-time-seen non-`introduced` stage
      // counts as a forward move too — a bill arriving already past introduced
      // (e.g. S 723 first observed at `enacted`) skipped earlier stages in our
      // view and that's a transition the report needs to surface.
      const decision = decideStage(
        bill.oldStage,
        computedStage,
        bill.pendingStage,
      );
      if (decision === "advance") {
        const changedAt = new Date().toISOString();
        await db.execute({
          sql: `UPDATE bills
                SET summary = ?, summary_model = ?, summary_updated_at = ?,
                    topics = ?, stage = ?, previous_stage = ?, stage_changed_at = ?,
                    is_ceremonial = ?, text_length = ?,
                    summarize_failed_at = NULL, summarize_attempts = 0,
                    pending_stage = NULL, pending_stage_at = NULL
                WHERE id = ?`,
          args: [
            result.summary,
            SUMMARY_MODEL,
            new Date().toISOString(),
            JSON.stringify(result.topics),
            computedStage,
            bill.oldStage,
            changedAt,
            ceremonialArg,
            out!.textLength,
            bill.id,
          ],
        });
        // HO 232: append-only stage-transition log (write-only plant). Same
        // condition + same timestamp as the single-slot previous_stage/
        // stage_changed_at write above — bill.oldStage may be NULL (first
        // observed already past introduced), recorded as a NULL-from row. A
        // confirmed backward move logs honestly as a from→to setback row.
        await db.execute({
          sql: `INSERT INTO stage_transitions (bill_id, from_stage, to_stage, changed_at)
                VALUES (?, ?, ?, ?)`,
          args: [bill.id, bill.oldStage, computedStage, changedAt],
        });
      } else {
        // No slot move. "reject"/"pend" keep the current stage; "noop" persists
        // the unchanged stage (== current, except a first-observed `introduced`
        // where current is NULL — write the proposed `introduced` there). "pend"
        // records the proposal; every other outcome clears any prior pending.
        const stageToWrite =
          decision === "noop" ? computedStage : bill.oldStage;
        const pendStage = decision === "pend" ? computedStage : null;
        const pendAt = decision === "pend" ? new Date().toISOString() : null;
        if (decision === "reject")
          console.warn(
            "[stage] rejected impossible downgrade",
            bill.id,
            bill.oldStage,
            "→",
            computedStage,
          );
        else if (decision === "pend")
          console.warn(
            "[stage] downgrade pending",
            bill.id,
            bill.oldStage,
            "→",
            computedStage,
          );
        await db.execute({
          sql: `UPDATE bills
                SET summary = ?, summary_model = ?, summary_updated_at = ?,
                    topics = ?, stage = ?, is_ceremonial = ?, text_length = ?,
                    summarize_failed_at = NULL, summarize_attempts = 0,
                    pending_stage = ?, pending_stage_at = ?
                WHERE id = ?`,
          args: [
            result.summary,
            SUMMARY_MODEL,
            new Date().toISOString(),
            JSON.stringify(result.topics),
            stageToWrite,
            ceremonialArg,
            out!.textLength,
            pendStage,
            pendAt,
            bill.id,
          ],
        });
      }
      stats.ok++;
      if (stats.samples.length < 5) stats.samples.push({ bill, result });
    }

    const seen = i + 1;
    if (seen % 50 === 0 || seen === bills.length) {
      console.log(
        `progress: ${seen}/${bills.length} ok=${stats.ok} fail=${stats.failed} timeout=${stats.timedOut} (retry-give-ups=${gaveUpRetryable}) tokens=${stats.promptTokens}/${stats.outputTokens}`,
      );
    }

    if (i + 1 < bills.length) {
      await sleep(PER_REQUEST_DELAY_MS);
    }
  }

  console.log(
    `final: ok=${stats.ok} fail=${stats.failed} timeout=${stats.timedOut} retry-give-ups=${gaveUpRetryable} budgetStopped=${stats.budgetStopped} chronic=${stats.chronicFailures.length}`,
  );
  return stats;
}
