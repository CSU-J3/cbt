// One-shot derivation of stub race rows from `members` (handoff 62).
//
// One row per (state, district, cycle) for the House and one per
// (state, cycle) for the Senate. The id expression is a SQL translation of
// `raceIdFromMember` in lib/race-id.ts — keep them in sync. `INSERT OR
// IGNORE` makes re-runs idempotent so hand-curated rating + candidate data
// in seeded rows is never clobbered. House rows with NULL district are
// filtered to avoid a NULL-id collision; Senate ignores district by design.
import "dotenv/config";
import { getDb } from "../lib/db";

async function main() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const before = await db.execute("SELECT COUNT(*) AS n FROM races");
  console.log(`Races before: ${before.rows[0]?.n ?? 0}`);

  const result = await db.execute({
    sql: `
      INSERT OR IGNORE INTO races
        (id, cycle, chamber, state, district, incumbent_bioguide_id, last_verified)
      SELECT
        CASE
          WHEN m.chamber = 'senate' THEN 'S-' || m.state || '-' || m.next_election_year
          ELSE m.state || '-' || printf('%02d', m.district) || '-' || m.next_election_year
        END AS id,
        m.next_election_year,
        m.chamber,
        m.state,
        CASE WHEN m.chamber = 'senate' THEN NULL ELSE m.district END,
        m.bioguide_id,
        ?
      FROM members m
      WHERE m.next_election_year IS NOT NULL
        AND m.state IS NOT NULL
        AND m.chamber IS NOT NULL
        AND (m.chamber = 'senate' OR m.district IS NOT NULL)
    `,
    args: [today],
  });
  console.log(`Inserted: ${result.rowsAffected}`);

  const after = await db.execute("SELECT COUNT(*) AS n FROM races");
  console.log(`Races after: ${after.rows[0]?.n ?? 0}`);

  const byChamber = await db.execute(
    "SELECT chamber, COUNT(*) AS n FROM races GROUP BY chamber",
  );
  for (const row of byChamber.rows) {
    console.log(`  ${row.chamber}: ${row.n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
