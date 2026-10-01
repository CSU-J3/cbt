// Idempotent loader for runoff contests (handoff 107; globbed in HO 174).
//
// A runoff is a primary-shaped contest, so it lives as additional `primaries`
// rows (id suffix `-runoff`, `election_round='runoff'`) with rosters in
// `primary_candidates` — see the HO 107 schema decision. This script globs
// every data/runoff-seeds/*.json file and loads each one. Hand-curated seeds
// exist because a runoff often has no results yet and Ballotpedia may not have
// built the page. HO 761 landed the scraper: the page's runoff box is written
// onto the seeded row by name, marks included (lib/primaries-sync.ts
// writeRunoffRounds: the primaries sync while the row is unsettled, and
// `npm run repair:runoffs` for a row settled by expiry), and the seed JSON
// stays as the row's origin. So once the page has decided a runoff (a row is
// 'winner'), a re-run here keeps that roster rather than resetting it to
// 'running'; before that it refreshes the roster as it always has. HO 174
// switched the single hardcoded import to a directory glob (mirrors
// seed:ratings) so a new runoff is drop-a-file, no script edit.
//
// Idempotent: the `primaries` row upserts on its PK; `primary_candidates` is
// delete-then-insert per primary_id, the same pattern syncSenateCandidates
// uses. Re-running after editing any JSON is the refresh workflow, for a
// runoff the page has not decided (HO 761, above).
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../lib/db";

const SEED_DIR = join("data", "runoff-seeds");

interface RunoffCandidateSeed {
  name: string;
  party: string;
  incumbent?: boolean;
}

interface RunoffSeed {
  id: string;
  party: string;
  candidates: RunoffCandidateSeed[];
}

interface SeedFile {
  raceId: string;
  state: string;
  chamber: string;
  district: string | null;
  runoffDate: string;
  parentPrimaryIds: string[];
  runoffs: RunoffSeed[];
}

function readSeedFiles(): { path: string; seed: SeedFile }[] {
  return readdirSync(SEED_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const path = join(SEED_DIR, name);
      const seed = JSON.parse(readFileSync(path, "utf8")) as SeedFile;
      return { path, seed };
    });
}

async function main() {
  const db = getDb();
  const now = new Date().toISOString();
  const files = readSeedFiles();

  if (files.length === 0) {
    console.warn(`No seed files matched ${SEED_DIR}/*.json`);
    return;
  }

  let primariesUpserted = 0;
  let candidatesInserted = 0;
  let parentsUpdated = 0;

  for (const { path, seed } of files) {
    console.log(`${path} (race ${seed.raceId}):`);

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

      // HO 761: a roster the page has decided is the page's; keep it.
      const decided = await db.execute({
        sql: `SELECT 1 FROM primary_candidates WHERE primary_id = ? AND status = 'winner' LIMIT 1`,
        args: [runoff.id],
      });
      if (decided.rows.length > 0) {
        console.log(`  ${runoff.id}: roster kept (decided on the page; HO 761's writeRunoffRounds wrote its marks)`);
        continue;
      }

      // Delete-then-insert the roster so a re-run after a JSON edit is clean. One
      // batch (HO 761): the keep above makes a decided roster permanent, so a
      // roster must never be left half-written for the page to decide.
      await db.batch(
        [
          { sql: `DELETE FROM primary_candidates WHERE primary_id = ?`, args: [runoff.id] },
          ...runoff.candidates.map((c) => ({
            sql: `INSERT INTO primary_candidates
                    (primary_id, name, party, incumbent, bioguide_id, status,
                     vote_pct, updated_at)
                  VALUES (?, ?, ?, ?, NULL, 'running', NULL, ?)`,
            args: [runoff.id, c.name, c.party, c.incumbent ? 1 : 0, now],
          })),
        ],
        "write",
      );
      candidatesInserted += runoff.candidates.length;
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
            `(run the primaries sync for ${seed.state} first). The runoff ` +
            `still surfaces on the race its seat reaches (HO 763: ` +
            `getRunoffsForRace keys on state, chamber, cycle and district).`,
        );
      } else {
        parentsUpdated++;
      }
    }
  }

  console.log(
    `Done. files=${files.length} primaries_upserted=${primariesUpserted} ` +
      `candidates=${candidatesInserted} parents_updated=${parentsUpdated}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
