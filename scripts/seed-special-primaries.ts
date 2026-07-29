// Idempotent loader for SPECIAL primary contests (HO 560).
//
// A special primary is a primary-shaped contest for a seat whose regular
// primary already happened — so it lives as additional `primaries` rows with a
// distinct id (suffix `-special-{party}`) and `election_round='primary'`, NOT a
// new round vocabulary: `getPrimaryCalendar` and the feed queries filter to
// 'primary', so a 'primary'-round row flows into PrimaryTimeline as a new date
// tick with zero consumer changes. Its distinct id also keeps it OUT of the
// `senate-{ST}-2026-{party}` set that `syncCalendar` / `syncSenateCandidates`
// write, so the regular June rows and the special rows never overwrite each
// other.
//
// This deliberately COPIES the seed-runoffs.ts shape rather than extending it:
// a runoff and a special primary are different contests, and globbing both
// vocabularies through one loader would conflate them. Hand-curated seeds exist
// because Ballotpedia often hasn't built the special-election page yet (SC 2026
// 404s as of HO 560); a row with an empty `candidates` array is correct — it
// renders as a scheduled tick, and the roster is reingested when the page lands.
//
// Idempotent: `primaries` upserts on its PK; `primary_candidates` is
// delete-then-insert per primary_id ONLY for a non-empty roster — an empty/
// absent `candidates` array leaves the roster untouched (see the asymmetry note
// at the write). Re-running after editing any JSON is the refresh workflow.
//
//   npm run seed:special-primaries
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../lib/db";

const SEED_DIR = join("data", "special-primary-seeds");

interface SpecialCandidateSeed {
  name: string;
  party: string;
  incumbent?: boolean;
}

interface SpecialPrimarySeed {
  id: string;
  state: string;
  chamber: string;
  district: string | null;
  party: string;
  primary_date: string;
  runoff_date: string | null;
  primary_type: string | null;
  race_id: string | null;
  candidates: SpecialCandidateSeed[];
}

interface SeedFile {
  note?: string;
  primaries: SpecialPrimarySeed[];
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

  for (const { path, seed } of files) {
    console.log(`${path}:`);

    for (const row of seed.primaries) {
      // election_round is fixed to 'primary' here (like seed-runoffs fixes
      // 'runoff') — a special primary IS a primary, just for a special election.
      await db.execute({
        sql: `INSERT INTO primaries
                (id, state, district, chamber, party, primary_date, runoff_date,
                 primary_type, race_id, election_round, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'primary', ?)
              ON CONFLICT(id) DO UPDATE SET
                state = excluded.state,
                district = excluded.district,
                chamber = excluded.chamber,
                party = excluded.party,
                primary_date = excluded.primary_date,
                runoff_date = excluded.runoff_date,
                primary_type = excluded.primary_type,
                race_id = excluded.race_id,
                election_round = 'primary',
                updated_at = excluded.updated_at`,
        args: [
          row.id,
          row.state,
          row.district,
          row.chamber,
          row.party,
          row.primary_date,
          row.runoff_date,
          row.primary_type,
          row.race_id,
          now,
        ],
      });
      primariesUpserted++;

      // Roster write is ASYMMETRIC on purpose (HO 560 amend). An empty/absent
      // `candidates` array means "no assertion about the roster" — NOT "assert
      // the roster is empty" — so it MUST NOT clear an existing roster. Deleting
      // on empty would let a routine re-run destroy a field that landed later
      // (the HO 552 class: a routine op silently converting data into permanent
      // loss). Only a NON-EMPTY array asserts a roster, and it keeps the
      // delete-then-insert refresh semantics unchanged.
      const roster = row.candidates ?? [];
      if (roster.length === 0) {
        console.log(`  ${row.id}: roster untouched (no seeded field)`);
      } else {
        await db.execute({
          sql: `DELETE FROM primary_candidates WHERE primary_id = ?`,
          args: [row.id],
        });
        for (const c of roster) {
          await db.execute({
            sql: `INSERT INTO primary_candidates
                    (primary_id, name, party, incumbent, bioguide_id, status,
                     vote_pct, updated_at)
                  VALUES (?, ?, ?, ?, NULL, 'running', NULL, ?)`,
            args: [row.id, c.name, c.party, c.incumbent ? 1 : 0, now],
          });
          candidatesInserted++;
        }
        console.log(`  ${row.id}: ${roster.length} candidates (${row.primary_date})`);
      }
    }
  }

  console.log(
    `Done. files=${files.length} primaries_upserted=${primariesUpserted} ` +
      `candidates=${candidatesInserted}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
