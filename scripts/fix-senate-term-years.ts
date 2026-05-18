// Re-derives current_term_end_year + next_election_year for every senator
// in the members table from their already-stored terms_json (no API calls),
// then drops any senate races whose id no longer maps to a senator's
// corrected (state, next_election_year) (handoff 63).
//
// Safe to drop senate races at this stage because data/races-seed.json is
// empty for senate races — no hand-curated rating or candidate data is at
// risk of being clobbered. Re-run `npm run backfill:races` after this to
// regenerate the corrected senate stubs.
import "dotenv/config";
import { getDb } from "../lib/db";
import {
  senateNextElection,
  senateTermEnd,
  senateTermStart,
  type Term,
} from "../lib/derive-term";

async function main() {
  const db = getDb();

  const res = await db.execute(
    "SELECT bioguide_id, name, terms_json FROM members WHERE chamber = 'senate'",
  );
  console.log(`Processing ${res.rows.length} senators`);

  let updated = 0;
  let skipped = 0;

  for (const row of res.rows) {
    const bioguideId = row.bioguide_id as string;
    const name = row.name as string;
    const termsJsonRaw = row.terms_json as string | null;
    if (!termsJsonRaw) {
      console.warn(`  ${bioguideId} (${name}): no terms_json — skip`);
      skipped++;
      continue;
    }

    let terms: Term[];
    try {
      terms = JSON.parse(termsJsonRaw) as Term[];
    } catch {
      console.warn(`  ${bioguideId} (${name}): malformed terms_json — skip`);
      skipped++;
      continue;
    }

    const termStart = senateTermStart(terms);
    if (termStart === null) {
      console.warn(`  ${bioguideId} (${name}): no senate terms — skip`);
      skipped++;
      continue;
    }

    const termEnd = senateTermEnd(termStart);
    const nextElection = senateNextElection(termStart);

    await db.execute({
      sql: `UPDATE members
            SET current_term_end_year = ?, next_election_year = ?
            WHERE bioguide_id = ?`,
      args: [termEnd, nextElection, bioguideId],
    });
    updated++;
  }

  console.log(`Updated ${updated} senators, skipped ${skipped}`);

  const dropRes = await db.execute(`
    DELETE FROM races
    WHERE chamber = 'senate'
      AND id NOT IN (
        SELECT 'S-' || state || '-' || next_election_year
        FROM members
        WHERE chamber = 'senate' AND state IS NOT NULL AND next_election_year IS NOT NULL
      )
  `);
  console.log(`Dropped ${dropRes.rowsAffected} stale senate race rows`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
