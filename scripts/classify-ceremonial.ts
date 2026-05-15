import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { classifyCeremonial } from "../lib/classify-ceremonial";
import { getDb } from "../lib/db";

const CONCURRENCY = 10;

type Row = {
  id: string;
  title: string;
  latest_action_text: string | null;
};

async function fetchRows(): Promise<Row[]> {
  const db = getDb();
  const rs = await db.execute(
    "SELECT id, title, latest_action_text FROM bills WHERE is_ceremonial IS NULL",
  );
  return rs.rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    latest_action_text: (r.latest_action_text as string | null) ?? null,
  }));
}

async function processOne(
  client: GoogleGenAI,
  row: Row,
  stats: { ok: number; failed: number },
): Promise<void> {
  try {
    const result = await classifyCeremonial(client, row);
    if (!result) {
      console.warn(`parse-fail ${row.id}: leaving NULL`);
      stats.failed++;
      return;
    }
    const db = getDb();
    await db.execute({
      sql: "UPDATE bills SET is_ceremonial = ? WHERE id = ?",
      args: [result.is_ceremonial ? 1 : 0, row.id],
    });
    stats.ok++;
  } catch (err) {
    console.error(`error ${row.id}:`, (err as Error).message);
    stats.failed++;
  }
}

async function runWithConcurrency(
  client: GoogleGenAI,
  rows: Row[],
  stats: { ok: number; failed: number },
): Promise<void> {
  let cursor = 0;
  const total = rows.length;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= total) return;
      const row = rows[i]!;
      await processOne(client, row, stats);
      const seen = stats.ok + stats.failed;
      if (seen % 100 === 0 || seen === total) {
        console.log(
          `progress: ${seen}/${total} ok=${stats.ok} fail=${stats.failed}`,
        );
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, total) },
    () => worker(),
  );
  await Promise.all(workers);
}

async function revalidateBillsCache(): Promise<void> {
  const url = process.env.REVALIDATE_URL;
  const secret = process.env.CRON_SECRET;
  if (!url || !secret) {
    console.log(
      "\nskipping cache revalidation: set REVALIDATE_URL (e.g. https://<deploy>/api/revalidate) and CRON_SECRET to auto-invalidate.",
    );
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) {
      console.warn(`revalidate POST ${url} -> ${res.status}: ${await res.text()}`);
      return;
    }
    console.log(`revalidated bills cache via ${url}`);
  } catch (err) {
    console.warn(`revalidate failed: ${(err as Error).message}`);
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const rows = await fetchRows();
  console.log(`classifying ${rows.length} bill(s) at concurrency ${CONCURRENCY}`);
  if (rows.length === 0) {
    console.log("nothing to do");
    return;
  }

  const stats = { ok: 0, failed: 0 };
  const t0 = Date.now();
  await runWithConcurrency(client, rows, stats);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\ndone in ${elapsed}s: ok=${stats.ok} failed=${stats.failed}`);
  await revalidateBillsCache();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
