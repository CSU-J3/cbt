// One-shot backfill: extract sponsors[0].bioguideId from raw_json into the
// sponsor_bioguide_id column. Pure SQL, no API calls. Idempotent via
// WHERE sponsor_bioguide_id IS NULL.
//
// JSON path is $.sponsors[0].bioguideId because the sync stores the
// unwrapped detailRes.bill object as raw_json (verified against the live
// corpus). Modern sync runs already write sponsor_bioguide_id directly, so
// this script is mostly a safety net for historical rows.
import "dotenv/config";
import { getDb } from "../lib/db";

async function countNull(db: ReturnType<typeof getDb>): Promise<number> {
  const r = await db.execute(
    "SELECT COUNT(*) AS n FROM bills WHERE sponsor_bioguide_id IS NULL",
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function main() {
  const db = getDb();
  const totalRs = await db.execute("SELECT COUNT(*) AS n FROM bills");
  const total = Number(totalRs.rows[0]?.n ?? 0);
  const before = await countNull(db);
  console.log(`Bills total: ${total}`);
  console.log(`Bills with NULL sponsor_bioguide_id before: ${before}`);

  const result = await db.execute(`
    UPDATE bills
    SET sponsor_bioguide_id = json_extract(raw_json, '$.sponsors[0].bioguideId')
    WHERE sponsor_bioguide_id IS NULL
      AND json_extract(raw_json, '$.sponsors[0].bioguideId') IS NOT NULL
  `);
  console.log(`Rows updated: ${result.rowsAffected}`);

  const after = await countNull(db);
  console.log(`Bills with NULL sponsor_bioguide_id after: ${after}`);
  if (total > 0) {
    const populated = total - after;
    console.log(
      `Coverage: ${populated}/${total} (${((populated / total) * 100).toFixed(1)}%)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
