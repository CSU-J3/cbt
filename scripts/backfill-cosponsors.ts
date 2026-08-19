// One-shot backfill: extract cosponsor_count from raw_json into the column.
// Pure SQL, no API calls. Idempotent via WHERE cosponsor_count IS NULL.
//
// JSON path is `$.cosponsors.count` because lib/sync.ts stores the unwrapped
// detailRes.bill object as raw_json (not the outer { bill: {...} } wrapper).
// Verified against the live corpus before this script was authored.
//
// HO 674 CORRECTION. The note below used to read that NULL is
// "distinguishable from 0, which is a real 'no cosponsors' / 'empty text'".
// That is BACKWARDS and it was backwards when written. Measured on the live
// corpus: explicit `cosponsor_count = 0` occurs on ZERO of 17,722 bills. The
// API OMITS the `cosponsors` key entirely when a bill has none, so
// json_extract yields NULL and this script writes nothing. **NULL is the
// no-cosponsors case** -- all 3,800 of them -- not a distinguishable
// "unknown". Confirmed against the API: 119-hr-6544 reads NULL here and
// `count: 0` from /cosponsors.
//
// Two consequences, neither fixed here (this script's guard is its own
// business, and HO 674 deliberately did not touch `bills.cosponsor_count`):
//   1. Because the guard is `WHERE cosponsor_count IS NULL`, those 3,800 stay
//      NULL permanently -- re-running can never resolve them.
//   2. NULL is NOT a reliable "has no cosponsors" signal either: a 52-bill
//      sample found 3 (~5.8%) that DO have cosponsors on the API and are NULL
//      here only because `raw_json` predates the cosponsor arriving. HO 674's
//      roster backfill therefore fetches NULL bills rather than skipping them.
import "dotenv/config";
import { getDb } from "../lib/db";

async function countNull(db: ReturnType<typeof getDb>): Promise<number> {
  const r = await db.execute(
    "SELECT COUNT(*) AS n FROM bills WHERE cosponsor_count IS NULL",
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function main() {
  const db = getDb();

  const before = await countNull(db);
  const totalRs = await db.execute("SELECT COUNT(*) AS n FROM bills");
  const total = Number(totalRs.rows[0]?.n ?? 0);
  console.log(`Bills total: ${total}`);
  console.log(`Bills with NULL cosponsor_count before: ${before}`);

  const result = await db.execute(`
    UPDATE bills
    SET cosponsor_count = CAST(json_extract(raw_json, '$.cosponsors.count') AS INTEGER)
    WHERE cosponsor_count IS NULL
      AND json_extract(raw_json, '$.cosponsors.count') IS NOT NULL
  `);
  console.log(`Rows updated: ${result.rowsAffected}`);

  const after = await countNull(db);
  console.log(`Bills with NULL cosponsor_count after: ${after}`);

  if (total > 0) {
    const populated = total - after;
    const pct = ((populated / total) * 100).toFixed(1);
    console.log(`Coverage: ${populated}/${total} (${pct}%)`);
    if (populated / total < 0.9) {
      console.warn(
        "Coverage <90% — re-fetching detail for the gaps is a separate handoff decision.",
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
