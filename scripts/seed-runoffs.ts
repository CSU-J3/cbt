// Idempotent loader for runoff contests (handoff 107).
//
// A runoff is a primary-shaped contest, so it lives as additional `primaries`
// rows (id suffix `-runoff`, `election_round='runoff'`) with rosters in
// `primary_candidates` — see the HO 107 schema decision. This script loads the
// hand-curated seed at data/runoff-seeds/la-senate-2026.json: it hand-seeds
// because the June 27 runoff has no results yet and Ballotpedia has not built
// the Democratic runoff page. A real Ballotpedia runoff scraper (a post-June-27
// handoff) will overwrite/retire the seed JSON.
//
// Idempotent: the `primaries` row upserts on its PK; `primary_candidates` is
// delete-then-insert per primary_id, the same pattern syncSenateCandidates
// uses. Re-running after editing the JSON is the refresh workflow.
import "dotenv/config";
import { getDb } from "../lib/db";
import seed from "../data/runoff-seeds/la-senate-2026.json";

async function main() {
  const db = getDb();
  const now = new Date().toISOString();
  let primariesUpserted = 0;
  let candidatesInserted = 0;
  let parentsUpdated = 0;

  for (const runoff of seed.runoffs) {
    // The runoff primaries row. primary_date carries the runoff's own
    // election date; runoff_date is NULL (a runoff has no further runoff);
    // primary_type is NULL (not a 270toWin calendar classification).
    await db.execute({
      sql: `INSERT INTO primaries
              (id, state, district, chamber, party, primary_date, runoff_date,
               primary_type, race_id, election_round, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'runoff', ?)
            ON CONFLICT(id) DO UPDATE SET
              state = excluded.state,
              district = excluded.district,
              chamber = excluded.chamber,
              party = excluded.party,
              primary_date = excluded.primary_date,
              race_id = excluded.race_id,
              election_round = 'runoff',
              updated_at = excluded.updated_at`,
      args: [
        runoff.id,
        seed.state,
        seed.district,
        seed.chamber,
        runoff.party,
        seed.runoffDate,
        seed.raceId,
        now,
      ],
    });
    primariesUpserted++;

    // Delete-then-insert the roster so a re-run after a JSON edit is clean.
    await db.execute({
      sql: `DELETE FROM primary_candidates WHERE primary_id = ?`,
      args: [runoff.id],
    });
    for (const c of runoff.candidates) {
      await db.execute({
        sql: `INSERT INTO primary_candidates
                (primary_id, name, party, incumbent, bioguide_id, status,
                 vote_pct, updated_at)
              VALUES (?, ?, ?, ?, NULL, 'running', NULL, ?)`,
        args: [runoff.id, c.name, c.party, c.incumbent ? 1 : 0, now],
      });
      candidatesInserted++;
    }
    console.log(`  ${runoff.id}: ${runoff.candidates.length} candidates`);
  }

  // Point each parent (round-1) primary row at the runoff date so the
  // existing `runoff_date` column carries the forward link.
  for (const parentId of seed.parentPrimaryIds) {
    const r = await db.execute({
      sql: `UPDATE primaries SET runoff_date = ?, updated_at = ? WHERE id = ?`,
      args: [seed.runoffDate, now, parentId],
    });
    if (r.rowsAffected === 0) {
      console.warn(
        `  parent primary '${parentId}' not found — runoff_date not set ` +
          `(run the primaries sync for ${seed.state} first)`,
      );
    } else {
      parentsUpdated++;
    }
  }

  console.log(
    `Done. primaries_upserted=${primariesUpserted} ` +
      `candidates=${candidatesInserted} parents_updated=${parentsUpdated}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
