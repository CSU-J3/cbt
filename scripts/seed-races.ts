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
  // HO 718: with `incumbent_running: 0`, `open_signal_date` / `open_signal_url`
  // (no `open_signal`) date the announcement for the 2028 NOT RUNNING qualifier.
  incumbent_running?: number | null;
  // HO 408: override the derived incumbent. backfill-races sets
  // incumbent_bioguide_id from members.next_election_year, so a wrong-class
  // member year mis-derives it (S-OK-2026 pointed at Lankford/Class-III instead
  // of the Class-II appointee-caretaker open seat). Additive: sets ONLY this
  // column (+ last_verified) when present, never clobbers other row data.
  incumbent_bioguide_id?: string | null;
  // HO 710: the LIKELY tier of the seat-outlook vocabulary. `"indicated"` is a
  // public signal SHORT of an announcement and requires BOTH a date and a URL;
  // `"clear"` retracts, NULLing all three columns. Omit to leave unchanged.
  // The date is the STATEMENT's, not the reporting article's.
  //
  // Deliberately NOT reusing `source_url`: that field gates the rating UPDATE
  // below (`hasRatingData`), which writes `rating = ?` from the entry — so a
  // signal-only entry carrying `source_url` would null the row's rating. The
  // signal gets its own provenance field for that reason alone.
  open_signal?: "indicated" | "clear" | null;
  open_signal_date?: string | null;
  open_signal_url?: string | null;
  candidates?: CandidateSeed[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function main() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  // HO 659: one reach stamp per invocation for `race_candidates.updated_at`,
  // bound into every roster write below. Full ISO (not `today`'s date-only
  // form) because the column identifies a RUN, and two seed runs can share a
  // date. An idempotent re-seed re-stamps — reach, not last content change.
  const runStamp = new Date().toISOString();

  const knownIdsRes = await db.execute("SELECT id FROM races");
  const knownIds = new Set(knownIdsRes.rows.map((r) => r.id as string));

  let updated = 0;
  let candidates = 0;
  let missingRaces = 0;
  let invalidRatings = 0;
  let flagged = 0;
  let incumbentSet = 0;
  let signalSet = 0;
  let signalCleared = 0;
  let invalidSignals = 0;

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

      // HO 718: a retirement entry that carries the announcement's date and URL
      // writes them too, so the seat outlook renders `NOT RUNNING · <MON YYYY> ↗`
      // rather than a bare `NOT RUNNING`. Same validation as the `indicated` arm
      // below, and the same skip: an entry that can't supply both is not
      // half-written (the flag above still lands; a bare tag is the visible
      // curation defect). Only when either field is present, so the 2026
      // retirement-only entries are untouched.
      if (
        race.incumbent_running === 0 &&
        (race.open_signal_date != null || race.open_signal_url != null)
      ) {
        if (!race.open_signal_date || !ISO_DATE.test(race.open_signal_date)) {
          console.warn(
            `  ${race.id}: incumbent_running 0 with a signal date needs YYYY-MM-DD (got '${race.open_signal_date ?? ""}') — date/url skipped`,
          );
          invalidSignals++;
        } else if (!race.open_signal_url?.startsWith("https://")) {
          console.warn(
            `  ${race.id}: incumbent_running 0 with a signal url needs https:// (got '${race.open_signal_url ?? ""}') — date/url skipped`,
          );
          invalidSignals++;
        } else {
          await db.execute({
            sql: `UPDATE races
                  SET open_signal_date = ?, open_signal_url = ?, last_verified = ?
                  WHERE id = ?`,
            args: [race.open_signal_date, race.open_signal_url, today, race.id],
          });
        }
      }
    }

    // HO 408: incumbent override — additive, sets ONLY incumbent_bioguide_id (+
    // last_verified), so a curated correction to a mis-derived incumbent never
    // clobbers rating/source/roster on the row.
    if (race.incumbent_bioguide_id != null) {
      await db.execute({
        sql: `UPDATE races SET incumbent_bioguide_id = ?, last_verified = ? WHERE id = ?`,
        args: [race.incumbent_bioguide_id, today, race.id],
      });
      incumbentSet++;
    }

    // HO 710: open_signal — additive, sets ONLY the three signal columns (+
    // last_verified), so it never clobbers rating/source/roster/incumbent on the
    // row. `"clear"` retracts. `"indicated"` REQUIRES a YYYY-MM-DD date and an
    // https:// URL: the render is dated copy with a source link, so an entry
    // that can't supply both is skipped rather than half-written. Warn-and-skip
    // matches the unknown-id and invalid-rating paths above — one bad entry
    // doesn't take down the pass.
    if (race.open_signal != null) {
      if (race.open_signal === "clear") {
        await db.execute({
          sql: `UPDATE races
                SET open_signal = NULL, open_signal_date = NULL,
                    open_signal_url = NULL, last_verified = ?
                WHERE id = ?`,
          args: [today, race.id],
        });
        signalCleared++;
      } else if (race.open_signal !== "indicated") {
        console.warn(
          `  ${race.id}: invalid open_signal '${race.open_signal}' — skip`,
        );
        invalidSignals++;
      } else if (!race.open_signal_date || !ISO_DATE.test(race.open_signal_date)) {
        console.warn(
          `  ${race.id}: open_signal 'indicated' needs a YYYY-MM-DD open_signal_date (got '${race.open_signal_date ?? ""}') — skip`,
        );
        invalidSignals++;
      } else if (!race.open_signal_url?.startsWith("https://")) {
        console.warn(
          `  ${race.id}: open_signal 'indicated' needs an https:// open_signal_url (got '${race.open_signal_url ?? ""}') — skip`,
        );
        invalidSignals++;
      } else {
        await db.execute({
          sql: `UPDATE races
                SET open_signal = ?, open_signal_date = ?, open_signal_url = ?,
                    last_verified = ?
                WHERE id = ?`,
          args: [
            race.open_signal,
            race.open_signal_date,
            race.open_signal_url,
            today,
            race.id,
          ],
        });
        signalSet++;
      }
    }

    for (const c of race.candidates ?? []) {
      await db.execute({
        sql: `INSERT INTO race_candidates
                (race_id, name, party, bioguide_id, status, source_url, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(race_id, name) DO UPDATE SET
                party = excluded.party,
                bioguide_id = excluded.bioguide_id,
                status = excluded.status,
                source_url = excluded.source_url,
                updated_at = excluded.updated_at`,
        args: [
          race.id,
          c.name,
          c.party ?? null,
          c.bioguide_id ?? null,
          c.status ?? null,
          race.source_url ?? null,
          runStamp,
        ],
      });
      candidates++;
    }
  }

  console.log(
    `Done. races_updated=${updated} incumbent_running_flagged=${flagged} incumbent_bioguide_set=${incumbentSet} open_signal_set=${signalSet} open_signal_cleared=${signalCleared} invalid_signals=${invalidSignals} candidates=${candidates} missing_races=${missingRaces} invalid_ratings=${invalidRatings}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
