import { GoogleGenAI } from "@google/genai";
import { getDb } from "./db";
import {
  fetchBillContext,
  summarizeBill,
  SUMMARY_MODEL,
  type BillRow,
  type SummarizeResult,
} from "./summarize";

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 2000;
const DEFAULT_LIMIT = 50;

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
  let sql = `SELECT id, congress, bill_type, bill_number, title, latest_action_text
    FROM bills WHERE ${where.join(" AND ")} ORDER BY update_date DESC`;
  if (limit > 0) {
    sql += ` LIMIT ?`;
    args.push(limit);
  }
  const rs = await db.execute({ sql, args });

  const bills: BillRow[] = rs.rows.map((r) => ({
    id: r.id as string,
    congress: r.congress as number,
    bill_type: r.bill_type as string,
    bill_number: r.bill_number as number,
    title: r.title as string,
    latest_action_text: (r.latest_action_text as string | null) ?? null,
  }));

  console.log(
    `processing ${bills.length} bill(s) ${limit > 0 ? `(limit ${limit})` : "(all)"}`,
  );

  const stats: SummarizeStats = {
    ok: 0,
    failed: 0,
    promptTokens: 0,
    outputTokens: 0,
    samples: [],
  };

  for (let i = 0; i < bills.length; i += BATCH_SIZE) {
    const batch = bills.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (bill) => {
        try {
          const ctx = await fetchBillContext(bill, congressKey);
          const out = await summarizeBill(client, bill, ctx);
          stats.promptTokens += out.promptTokens;
          stats.outputTokens += out.outputTokens;
          if (!out.result) {
            console.warn(`parse-fail: ${bill.id}`);
            return { bill, result: null };
          }
          await db.execute({
            sql: `UPDATE bills
                  SET summary = ?, summary_model = ?, summary_updated_at = ?, topics = ?, stage = ?
                  WHERE id = ?`,
            args: [
              out.result.summary,
              SUMMARY_MODEL,
              new Date().toISOString(),
              JSON.stringify(out.result.topics),
              out.result.stage,
              bill.id,
            ],
          });
          return { bill, result: out.result };
        } catch (e) {
          console.error(`error ${bill.id}:`, (e as Error).message);
          return { bill, result: null };
        }
      }),
    );

    for (const r of results) {
      if (r.result) {
        stats.ok++;
        if (stats.samples.length < 5) stats.samples.push({ bill: r.bill, result: r.result });
      } else {
        stats.failed++;
      }
    }

    const seen = Math.min(i + BATCH_SIZE, bills.length);
    if (seen % 50 === 0 || seen === bills.length) {
      console.log(
        `progress: ${seen}/${bills.length} ok=${stats.ok} fail=${stats.failed} tokens=${stats.promptTokens}/${stats.outputTokens}`,
      );
    }

    if (i + BATCH_SIZE < bills.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  return stats;
}
