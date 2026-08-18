// HO 670 (review) — how many summarize ticks flush the `bills` tag without
// having written anything. READ-ONLY.
//
// `app/api/cron/summarize/route.ts:88` calls revalidateTag("bills")
// unconditionally, immediately after runSummarize, on a */10 schedule. The
// question the filing needs answered with a number, not an inference: what share
// of those ticks summarized ZERO bills and flushed anyway.
//
// The envelope trap from HO 669 applies — cron_runs.payload is
// {ok, elapsedMs, payload:{...}}, so the tick's own fields sit one level down and
// a naive payload.summarized reads undefined on every row, which is
// indistinguishable from "zero bills". Both depths are read here and the raw
// first row is printed so the shape is visible rather than assumed.
//
//   npx tsx scripts/diagnostic/summarize-flush-670.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL required");
  const db = createClient({ url, authToken });

  const rs = await db.execute(`
    SELECT started_at, status, payload
      FROM cron_runs
     WHERE route = '/api/cron/summarize'
     ORDER BY started_at DESC
     LIMIT 300`);
  console.log(`  rows: ${rs.rows.length}`);
  if (rs.rows.length === 0) {
    console.log("  no summarize rows — nothing to conclude");
    return;
  }
  console.log(`  newest: ${rs.rows[0]?.started_at}  oldest: ${rs.rows[rs.rows.length - 1]?.started_at}`);
  console.log(`  RAW first payload (shape check, not assumed): ${String(rs.rows[0]?.payload).slice(0, 220)}`);

  let wrote = 0;
  let zero = 0;
  let skipped = 0;
  let unreadable = 0;
  for (const r of rs.rows) {
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(String(r.payload)) as Record<string, unknown>;
    } catch {
      unreadable += 1;
      continue;
    }
    // One level down is where the tick's own fields live (HO 669).
    const inner = (p.payload ?? p) as Record<string, unknown>;
    if (typeof inner.skipped === "string") {
      skipped += 1; // lock overlap — returns BEFORE the flush
      continue;
    }
    const n = inner.summarized;
    if (typeof n !== "number") {
      unreadable += 1;
      continue;
    }
    if (n > 0) wrote += 1;
    else zero += 1;
  }

  const flushing = wrote + zero; // every non-skipped tick reaches the flush
  console.log("");
  console.log(`  ticks that reached revalidateTag("bills"): ${flushing}`);
  console.log(`    of which summarized > 0 bills:           ${wrote}`);
  console.log(`    of which summarized ZERO bills:          ${zero}` +
    (flushing > 0 ? `  (${((zero / flushing) * 100).toFixed(1)}% of flushes are writes-free)` : ""));
  console.log(`  ticks skipped on the lock (never flush):   ${skipped}`);
  console.log(`  rows whose payload could not be read:      ${unreadable}`);
  console.log("");
  console.log("  CONTROL: `wrote` must be > 0 — if every tick reads zero, the field is");
  console.log("  being misread (the HO 669 envelope trap) rather than the queue being idle.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
