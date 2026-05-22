// HO 115 Phase 1 — measure summarize per-bill latency without writing to the
// DB. Mirrors runSummarize's selector (summary IS NULL, update_date DESC) and
// per-bill work (fetchBillContext + summarizeBill) but times each stage and
// skips the UPDATE. Read-only — safe to run repeatedly.
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { getDb } from "../../lib/db";
import { fetchBillContext, summarizeBill, type BillRow } from "../../lib/summarize";

const LIMIT = Number(process.argv[2] ?? 12);

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function main() {
  const congressKey = process.env.CONGRESS_API_KEY!;
  const geminiKey = process.env.GEMINI_API_KEY!;
  const db = getDb();
  const client = new GoogleGenAI({ apiKey: geminiKey });

  const rs = await db.execute({
    sql: `SELECT id, congress, bill_type, bill_number, title, latest_action_text
          FROM bills WHERE summary IS NULL
          ORDER BY update_date DESC LIMIT ?`,
    args: [LIMIT],
  });
  const bills: BillRow[] = rs.rows.map((r) => ({
    id: r.id as string,
    congress: r.congress as number,
    bill_type: r.bill_type as string,
    bill_number: r.bill_number as number,
    title: r.title as string,
    latest_action_text: (r.latest_action_text as string | null) ?? null,
  }));

  console.log(`measuring ${bills.length} bill(s), 400ms throttle between\n`);
  const totals: number[] = [];
  const wallStart = Date.now();

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i]!;
    const t0 = Date.now();
    let ctxMs = 0;
    let llmMs = 0;
    let textLen: number | null = null;
    let note = "ok";
    try {
      const c0 = Date.now();
      const ctx = await fetchBillContext(bill, congressKey);
      ctxMs = Date.now() - c0;
      textLen = ctx.textLength;
      const l0 = Date.now();
      const out = await summarizeBill(client, bill, ctx);
      llmMs = Date.now() - l0;
      if (!out.result) note = "parse-fail-or-empty";
    } catch (e) {
      note = `ERROR ${(e as Error).message.slice(0, 90)}`;
    }
    const totalMs = Date.now() - t0;
    totals.push(totalMs);
    console.log(
      `  ${String(i + 1).padStart(2)}. ${bill.id.padEnd(16)} total=${String(totalMs).padStart(6)}ms  ctx=${String(ctxMs).padStart(6)}ms  llm=${String(llmMs).padStart(6)}ms  text_len=${textLen}  ${note}`,
    );
    if (i + 1 < bills.length) await new Promise((r) => setTimeout(r, 400));
  }

  const wallMs = Date.now() - wallStart;
  const sorted = [...totals].sort((a, b) => a - b);
  const sum = totals.reduce((s, n) => s + n, 0);
  console.log(`\n--- summary over ${bills.length} bills ---`);
  console.log(`  wall clock (incl 400ms throttles): ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`  per-bill work only — avg: ${Math.round(sum / totals.length)}ms`);
  console.log(`  per-bill min/p50/p95/max: ${sorted[0]}/${pct(sorted, 50)}/${pct(sorted, 95)}/${sorted[sorted.length - 1]}ms`);
  console.log(`  projected for 12-bill cron tick (avg × 12 + 11×400ms throttle): ${((sum / totals.length) * 12 + 11 * 400) / 1000}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
