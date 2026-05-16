// One-shot backfill: extract cosponsor_count from raw_json into the column.
// Pure SQL, no API calls. Idempotent via WHERE cosponsor_count IS NULL.
//
// JSON path is `$.cosponsors.count` because lib/sync.ts stores the unwrapped
// detailRes.bill object as raw_json (not the outer { bill: {...} } wrapper).
// Verified against the live corpus before this script was authored.
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
