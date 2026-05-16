// Backfills text_length for summarized bills that don't have one. Re-fetches
// the same text URL the summarize step uses, writes the raw stripped length.
//
// Resumable: WHERE text_length IS NULL means restarting after Ctrl-C just
// resumes wherever the last run left off. Throttled at ~5 bills/sec to be
// kind to the Congress.gov API.
//
// Failure semantics (handoff 59):
// - Fetch succeeds, returns "" → write 0 (won't be retried).
// - Fetch throws (network/HTTP/timeout) → leave NULL (next run picks it up).
import "dotenv/config";
import { getDb } from "../lib/db";
import { fetchBillText } from "../lib/summarize";

const BATCH_SIZE = 100;
const DELAY_MS = 200;

async function main() {
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");

  const db = getDb();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  while (true) {
    const batch = await db.execute(`
      SELECT id, congress, bill_type, bill_number
      FROM bills
      WHERE summary IS NOT NULL
        AND text_length IS NULL
      LIMIT ${BATCH_SIZE}
    `);

    if (batch.rows.length === 0) {
      console.log("Done.");
      break;
    }

    for (const row of batch.rows) {
      const id = row.id as string;
      try {
        const text = await fetchBillText(
          {
            congress: row.congress as number,
            bill_type: row.bill_type as string,
            bill_number: row.bill_number as number,
          },
          apiKey,
        );
        // 0 (not null) when the fetch worked but returned empty content —
        // distinguishes "checked, no text" from "haven't checked yet".
        const len = text.length;
        await db.execute({
          sql: `UPDATE bills SET text_length = ? WHERE id = ?`,
          args: [len, id],
        });
        succeeded++;
        console.log(`${id}: ${len}`);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`${id}: fetch failed (leaving NULL) — ${msg.slice(0, 80)}`);
      }
      processed++;
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    console.log(
      `progress: processed=${processed} succeeded=${succeeded} failed=${failed}`,
    );
  }

  console.log(
    `final: processed=${processed} succeeded=${succeeded} failed=${failed}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
