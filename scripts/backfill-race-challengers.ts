// HO 213 Part A: harvest non-incumbent primary winners from `primary_candidates`
// into `race_candidates` as the general-election challenger(s) for the
// getRacesIndex (rated, 2026) seats. Pure DB-to-DB — no scraping, no external
// dependency. The primary winner of the OTHER party (or any non-incumbent
// advancer) is the challenger; a winner who IS the seat's incumbent is excluded.
//
// Idempotent + seed-safe via a sentinel source_url:
//   - Harvested rows carry source_url = HARVEST_SOURCE.
//   - Hand-curated rows (HO 171/174/182 strip races) carry real Ballotpedia
//     URLs, so a race that already has any non-sentinel row is left untouched.
//   - Re-running deletes prior harvested rows and re-derives, so newly-resolved
//     primaries flow in without clobbering curated rosters.
//
// Coverage is partial by design — only seats whose primaries have voted AND
// were rostered yield a winner. The rest keep RaceMapCard's null-safe
// "challenger field not yet available" placeholder.
//
// Run: `npm run backfill:race-challengers`. Then flush the cache:
//   POST /api/revalidate?tag=races  (seed scripts don't auto-flush, per SKILL).
import "dotenv/config";
import { getDb } from "../lib/db";

const CYCLE = 2026;
const HARVEST_SOURCE = "harvest:primary_winner";

// races (rated index) ↔ primaries by state + chamber + district. races.district
// is INTEGER; primaries.district is zero-padded TEXT → CAST. Winner exclusion:
// drop the seat's own incumbent (bioguide match); a winner with a NULL bioguide
// is never the incumbent (HO 213 probe: zero incumbent winners lack a bioguide).
// The NOT EXISTS guard skips any race that already carries a hand-curated row
// (real Ballotpedia source_url ≠ the sentinel), preserving the HO 171/174/182
// strip rosters.
const HARVEST_FROM_WHERE = `
  FROM races r
  JOIN primaries p
    ON p.state = r.state AND p.chamber = r.chamber
   AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
  JOIN primary_candidates pc ON pc.primary_id = p.id AND pc.status = 'winner'
  WHERE r.cycle = ${CYCLE}
    AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = ${CYCLE})
    AND ( pc.bioguide_id IS NULL OR pc.bioguide_id <> r.incumbent_bioguide_id )
    AND NOT EXISTS (
      SELECT 1 FROM race_candidates rc
      WHERE rc.race_id = r.id
        AND ( rc.source_url IS NULL OR rc.source_url <> '${HARVEST_SOURCE}' )
    )`;

async function main() {
  const db = getDb();

  const before = await db.execute(
    `SELECT COUNT(*) AS rows, COUNT(DISTINCT race_id) AS races FROM race_candidates`,
  );
  console.log(
    `race_candidates before: ${before.rows[0]?.rows ?? 0} rows / ${before.rows[0]?.races ?? 0} races`,
  );

  // 1. Clear prior harvested rows (idempotent refresh). Never touches curated
  //    rows — they don't carry the sentinel.
  const del = await db.execute({
    sql: `DELETE FROM race_candidates WHERE source_url = ?`,
    args: [HARVEST_SOURCE],
  });
  console.log(`cleared ${del.rowsAffected} prior harvested rows`);

  // 2. Insert non-incumbent winners for index races with no curated roster.
  //    status='won_primary' surfaces them first in the card's roster ordering.
  const ins = await db.execute({
    sql: `INSERT OR IGNORE INTO race_candidates
            (race_id, name, party, bioguide_id, status, source_url)
          SELECT DISTINCT r.id, pc.name, pc.party, pc.bioguide_id,
                 'won_primary', '${HARVEST_SOURCE}'
          ${HARVEST_FROM_WHERE}`,
    args: [],
  });
  console.log(`inserted ${ins.rowsAffected} harvested challenger rows`);

  // 3. Report fill.
  const filled = await db.execute({
    sql: `SELECT COUNT(DISTINCT race_id) AS races, COUNT(*) AS rows
          FROM race_candidates WHERE source_url = ?`,
    args: [HARVEST_SOURCE],
  });
  const idx = await db.execute(
    `SELECT COUNT(*) AS n FROM races r
     WHERE r.cycle = ${CYCLE}
       AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = ${CYCLE})`,
  );
  console.log(
    `\nharvested: ${filled.rows[0]?.rows ?? 0} rows across ${filled.rows[0]?.races ?? 0} races (of ${idx.rows[0]?.n ?? 0} rated index races)`,
  );

  // 4. Sample for eyeballing.
  const sample = await db.execute({
    sql: `SELECT rc.race_id, rc.name, rc.party
          FROM race_candidates rc WHERE rc.source_url = ?
          ORDER BY rc.race_id, rc.name LIMIT 16`,
    args: [HARVEST_SOURCE],
  });
  console.log("\nsample harvested challengers:");
  for (const r of sample.rows)
    console.log(`  ${r.race_id}: ${r.name} (${r.party})`);

  console.log(
    "\nDONE. Flush cache: POST /api/revalidate?tag=races (with Bearer CRON_SECRET).",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
