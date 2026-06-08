// Applies the hand-curated rating + candidate layer from
// data/races-seed.json on top of auto-derived stubs (handoff 62).
//
// Idempotent: re-running after editing the JSON is the refresh workflow.
// Races referenced by the seed JSON that don't yet exist in the races
// table get warn-and-skip (run `npm run backfill:races` first or fix the
// id). Invalid ratings are skipped with a warning rather than aborted so
// one typo doesn't take down the whole pass.
import "dotenv/config";
import { getDb } from "../lib/db";
import seed from "../data/races-seed.json";

const VALID_RATINGS = new Set([
  "safe_r",
  "likely_r",
  "lean_r",
  "tossup",
  "lean_d",
  "likely_d",
  "safe_d",
]);

interface CandidateSeed {
  name: string;
  party?: string | null;
  bioguide_id?: string | null;
  status?: string | null;
}

interface RaceSeed {
  id: string;
  rating?: string | null;
  rating_source?: string | null;
  rating_updated_at?: string | null;
  source_url?: string | null;
  // HO 221: 0 = incumbent not running (OPEN seat), 1 = running, omit = leave
  // unchanged. A retirement-only entry carries just `id` + `incumbent_running`.
  incumbent_running?: number | null;
  candidates?: CandidateSeed[];
}

async function main() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const knownIdsRes = await db.execute("SELECT id FROM races");
  const knownIds = new Set(knownIdsRes.rows.map((r) => r.id as string));

  let updated = 0;
  let candidates = 0;
  let missingRaces = 0;
  let invalidRatings = 0;
  let flagged = 0;

  for (const race of (seed.races as RaceSeed[]) ?? []) {
    if (!knownIds.has(race.id)) {
      console.warn(`  unknown race id '${race.id}' — skip`);
      missingRaces++;
      continue;
    }
    if (race.rating && !VALID_RATINGS.has(race.rating)) {
      console.warn(`  ${race.id}: invalid rating '${race.rating}' — skip`);
      invalidRatings++;
      continue;
    }

    // Only run the rating/source UPDATE for entries that actually carry that
    // data — so a retirement-only entry (just id + incumbent_running) can't
    // null out an existing rating/source. (HO 221.)
    const hasRatingData =
      race.rating != null ||
      race.rating_source != null ||
      race.source_url != null;
    if (hasRatingData) {
      await db.execute({
        sql: `UPDATE races
              SET rating = ?, rating_source = ?, rating_updated_at = ?,
                  source_url = ?, last_verified = ?
              WHERE id = ?`,
        args: [
          race.rating ?? null,
          race.rating_source ?? null,
          race.rating_updated_at ?? null,
          race.source_url ?? null,
          today,
          race.id,
        ],
      });
      updated++;
    }

    // HO 221: incumbent-running flag — additive, sets ONLY this column (+
    // last_verified), so it never clobbers rating/source on the row.
    if (race.incumbent_running != null) {
      await db.execute({
        sql: `UPDATE races SET incumbent_running = ?, last_verified = ? WHERE id = ?`,
        args: [race.incumbent_running, today, race.id],
      });
      flagged++;
    }

    for (const c of race.candidates ?? []) {
      await db.execute({
        sql: `INSERT INTO race_candidates
                (race_id, name, party, bioguide_id, status, source_url)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(race_id, name) DO UPDATE SET
                party = excluded.party,
                bioguide_id = excluded.bioguide_id,
                status = excluded.status,
                source_url = excluded.source_url`,
        args: [
          race.id,
          c.name,
          c.party ?? null,
          c.bioguide_id ?? null,
          c.status ?? null,
          race.source_url ?? null,
        ],
      });
      candidates++;
    }
  }

  console.log(
    `Done. races_updated=${updated} incumbent_running_flagged=${flagged} candidates=${candidates} missing_races=${missingRaces} invalid_ratings=${invalidRatings}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
