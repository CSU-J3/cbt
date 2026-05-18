import { GoogleGenAI } from "@google/genai";
import { getDb } from "./db";
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Gemini documents 429 (RESOURCE_EXHAUSTED) and 503 (UNAVAILABLE) as transient.
// Other 5xx codes typically indicate a non-retryable request-shape problem.
function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|"code"\s*:\s*(429|503)/.test(
    msg,
  );
}

export type SummarizeStats = {
  ok: number;
  failed: number;
  promptTokens: number;
  outputTokens: number;
  samples: Array<{ bill: BillRow; result: SummarizeResult }>;
};

export type SummarizeOptions = {
  /**
   * Maximum number of bills to process. Defaults to 50 (matches the cron tick).
   * Pass 0 to disable the limit entirely (used by the standalone script for manual drains).
   */
  limit?: number;
  types?: string[];
};

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

  const where: string[] = ["summary IS NULL"];
  const args: (string | number)[] = [];
  if (options.types && options.types.length > 0) {
    where.push(`bill_type IN (${options.types.map(() => "?").join(",")})`);
    args.push(...options.types);
  }
  let sql = `SELECT id, congress, bill_type, bill_number, title, latest_action_text, stage
    FROM bills WHERE ${where.join(" AND ")} ORDER BY update_date DESC`;
  if (limit > 0) {
    sql += ` LIMIT ?`;
    args.push(limit);
  }
  const rs = await db.execute({ sql, args });

  const bills: Array<BillRow & { oldStage: string | null }> = rs.rows.map(
    (r) => ({
      id: r.id as string,
      congress: r.congress as number,
      bill_type: r.bill_type as string,
      bill_number: r.bill_number as number,
      title: r.title as string,
      latest_action_text: (r.latest_action_text as string | null) ?? null,
      oldStage: (r.stage as string | null) ?? null,
    }),
  );

  console.log(
    `processing ${bills.length} bill(s) ${limit > 0 ? `(limit ${limit})` : "(all)"} serial, ${PER_REQUEST_DELAY_MS}ms throttle`,
  );

  const stats: SummarizeStats = {
    ok: 0,
    failed: 0,
    promptTokens: 0,
    outputTokens: 0,
    samples: [],
  };
  let gaveUpRetryable = 0;

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i]!;

    let out: Awaited<ReturnType<typeof summarizeBill>> | null = null;
    let attempt = 0;
    let failed = false;
    while (true) {
      try {
        const ctx = await fetchBillContext(bill, congressKey);
        out = await summarizeBill(client, bill, ctx);
        break;
      } catch (e) {
        if (isRetryable(e) && attempt < RETRY_BACKOFF_MS.length) {
          const wait = RETRY_BACKOFF_MS[attempt]!;
          console.warn(
            `retry ${bill.id}: backoff ${wait}ms (attempt ${attempt + 1}/${RETRY_BACKOFF_MS.length}) ${(e as Error).message.slice(0, 80)}`,
          );
          await sleep(wait);
          attempt++;
          continue;
        }
        if (isRetryable(e)) {
          gaveUpRetryable++;
          console.warn(
            `retry-give-up ${bill.id}: stays NULL, will retry next pass (total give-ups: ${gaveUpRetryable})`,
          );
        } else {
          console.error(`error ${bill.id}:`, (e as Error).message);
        }
        failed = true;
        break;
      }
    }

    if (failed || !out) {
      stats.failed++;
    } else {
      stats.promptTokens += out.promptTokens;
      stats.outputTokens += out.outputTokens;
      if (!out.result) {
        console.warn(`parse-fail: ${bill.id}`);
        stats.failed++;
      } else {
        // First-time-seen non-`introduced` stage counts as a transition too:
        // a bill arriving already past introduced (e.g. S 723 first observed
        // at `enacted`) skipped earlier stages in our view and that's
        // semantically a transition the report needs to surface.
        const transitioned =
          (bill.oldStage !== null && bill.oldStage !== out.result.stage) ||
          (bill.oldStage === null && out.result.stage !== "introduced");
        const ceremonialArg =
          out.result.is_ceremonial === null
            ? null
            : out.result.is_ceremonial
              ? 1
              : 0;
        if (transitioned) {
          await db.execute({
            sql: `UPDATE bills
                  SET summary = ?, summary_model = ?, summary_updated_at = ?, topics = ?, stage = ?,
                      previous_stage = ?, stage_changed_at = ?, is_ceremonial = ?, text_length = ?
                  WHERE id = ?`,
            args: [
              out.result.summary,
              SUMMARY_MODEL,
              new Date().toISOString(),
              JSON.stringify(out.result.topics),
              out.result.stage,
              bill.oldStage,
              new Date().toISOString(),
              ceremonialArg,
              out.textLength,
              bill.id,
            ],
          });
        } else {
          await db.execute({
            sql: `UPDATE bills
                  SET summary = ?, summary_model = ?, summary_updated_at = ?, topics = ?, stage = ?,
                      is_ceremonial = ?, text_length = ?
                  WHERE id = ?`,
            args: [
              out.result.summary,
              SUMMARY_MODEL,
              new Date().toISOString(),
              JSON.stringify(out.result.topics),
              out.result.stage,
              ceremonialArg,
              out.textLength,
              bill.id,
            ],
          });
        }
        stats.ok++;
        if (stats.samples.length < 5)
          stats.samples.push({ bill, result: out.result });
      }
    }

    const seen = i + 1;
    if (seen % 50 === 0 || seen === bills.length) {
      console.log(
        `progress: ${seen}/${bills.length} ok=${stats.ok} fail=${stats.failed} (retry-give-ups=${gaveUpRetryable}) tokens=${stats.promptTokens}/${stats.outputTokens}`,
      );
    }

    if (i + 1 < bills.length) {
      await sleep(PER_REQUEST_DELAY_MS);
    }
  }

  console.log(`final retry-give-ups: ${gaveUpRetryable}`);
  return stats;
}
