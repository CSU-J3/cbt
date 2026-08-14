// HO 659 STEP 0.2/0.3 + STEP 2 falsification reads for `race_candidates.updated_at`.
//
// Read-only. Run it BEFORE the migration (captures the before-state and proves
// no temporal column exists) and again after each leg — it prints the same
// blocks each time, so the legs are diffs of one instrument rather than three
// hand-written queries.
//
//   npx tsx scripts/diagnostic/race-candidates-stamp-659.ts
//
// The byte-identity leg is a checksum over the sentinel rows' NON-timestamp
// columns: the harvest DELETEs and re-derives, so "the content is unchanged"
// has to be asserted against content, not row counts.
import "dotenv/config";
import { createHash } from "node:crypto";
import { getDb } from "../../lib/db";

const HARVEST_SOURCE = "harvest:primary_winner";

async function main() {
  const db = getDb();

  console.log("=== 0.2 PRAGMA table_info(race_candidates) ===");
  const cols = await db.execute(`PRAGMA table_info(race_candidates)`);
  for (const r of cols.rows) console.log(`  ${r.cid}  ${r.name}  ${r.type}`);
  const hasStamp = cols.rows.some((r) => r.name === "updated_at");
  console.log(`  updated_at present: ${hasStamp}`);

  console.log("\n=== 0.3 row census ===");
  const total = await db.execute(
    `SELECT COUNT(*) AS rows, COUNT(DISTINCT race_id) AS seats FROM race_candidates`,
  );
  console.log(`  TOTAL      ${total.rows[0]?.rows} rows / ${total.rows[0]?.seats} seats`);
  const sentinel = await db.execute({
    sql: `SELECT COUNT(*) AS rows, COUNT(DISTINCT race_id) AS seats
          FROM race_candidates WHERE source_url = ?`,
    args: [HARVEST_SOURCE],
  });
  console.log(`  SENTINEL   ${sentinel.rows[0]?.rows} rows / ${sentinel.rows[0]?.seats} seats`);
  const curated = await db.execute({
    sql: `SELECT race_id, name FROM race_candidates
          WHERE source_url IS NULL OR source_url <> ?
          ORDER BY race_id, name`,
    args: [HARVEST_SOURCE],
  });
  console.log(`  CURATED    ${curated.rows.length} rows:`);
  for (const r of curated.rows) console.log(`      ${r.race_id}  ${r.name}`);

  console.log("\n=== 0.3 sentinel content checksum (non-timestamp columns) ===");
  const dump = await db.execute({
    sql: `SELECT race_id, name, party, bioguide_id, status, source_url
          FROM race_candidates WHERE source_url = ?
          ORDER BY race_id, name`,
    args: [HARVEST_SOURCE],
  });
  const canonical = dump.rows
    .map((r) =>
      [r.race_id, r.name, r.party ?? "", r.bioguide_id ?? "", r.status ?? "", r.source_url ?? ""].join(""),
    )
    .join("\n");
  const sum = createHash("sha256").update(canonical).digest("hex");
  console.log(`  rows ${dump.rows.length}  sha256 ${sum}`);

  if (!hasStamp) {
    console.log("\n(no updated_at column yet — stamp census skipped)");
    return;
  }

  console.log("\n=== STEP 2 stamp census ===");
  const nn = await db.execute(
    `SELECT COUNT(*) AS n FROM race_candidates WHERE updated_at IS NOT NULL`,
  );
  console.log(`  non-NULL updated_at: ${nn.rows[0]?.n}`);
  const distinct = await db.execute(
    `SELECT updated_at, COUNT(*) AS n, COUNT(DISTINCT race_id) AS seats
     FROM race_candidates WHERE updated_at IS NOT NULL
     GROUP BY updated_at ORDER BY updated_at`,
  );
  console.log(`  distinct stamps: ${distinct.rows.length}`);
  for (const r of distinct.rows) console.log(`      ${r.updated_at}  ${r.n} rows / ${r.seats} seats`);
  const split = await db.execute({
    sql: `SELECT
            SUM(CASE WHEN source_url = ?  AND updated_at IS NOT NULL THEN 1 ELSE 0 END) AS sentinel_stamped,
            SUM(CASE WHEN source_url = ?  AND updated_at IS NULL     THEN 1 ELSE 0 END) AS sentinel_null,
            SUM(CASE WHEN (source_url IS NULL OR source_url <> ?) AND updated_at IS NOT NULL THEN 1 ELSE 0 END) AS curated_stamped,
            SUM(CASE WHEN (source_url IS NULL OR source_url <> ?) AND updated_at IS NULL     THEN 1 ELSE 0 END) AS curated_null
          FROM race_candidates`,
    args: [HARVEST_SOURCE, HARVEST_SOURCE, HARVEST_SOURCE, HARVEST_SOURCE],
  });
  const s = split.rows[0];
  console.log(
    `  sentinel: ${s?.sentinel_stamped} stamped / ${s?.sentinel_null} NULL` +
      `   curated: ${s?.curated_stamped} stamped / ${s?.curated_null} NULL`,
  );
}

main();
