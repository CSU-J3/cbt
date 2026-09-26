// HO 213 Part A: harvest non-incumbent primary winners from `primary_candidates`
// into `race_candidates` as the general-election challenger(s) for EVERY 2026
// `races` row whose primary has voted. Pure DB-to-DB — no scraping, no external
// dependency. The primary winner of the OTHER party (or any non-incumbent
// advancer) is the challenger; a winner who IS the seat's incumbent is excluded.
//
// HO 741 — THE RATING GATE IS GONE, AND THE SENTENCE ABOVE IS WHAT IT CHANGED.
// This read "for the getRacesIndex (rated, 2026) seats" from HO 213, and that
// was right when it was written: the rated index's cards were the roster's only
// consumer, so harvesting a seat nobody rated filled a table nothing read.
// `/race/[id]` has been a consumer for EVERY seat since the stubs were minted
// (`raceIdFromMember` in lib/race-id.ts; the member hub links to it), and on an
// unrated seat it rendered the incumbent card plus "Incumbent running for
// re-election. No competitive rating yet." and NO roster — a true sentence beside
// an omission, while the same database held the seat's settled primary.
//
// MEASURED BEFORE IT WAS REMOVED (2026-09-20), by running this SELECT with and
// without the clause and writing nothing:
//   today (gate on)   246 rows / 177 races
//   widened (gate off) 528 rows / 411 races      delta +282 / +234
// All 282 are HOUSE. By type: `open` 218 -> won_primary, `top_two` 47 ->
// advanced, NULL 14 -> won_primary, `top_four` 3 -> advanced. EVERY ONE of the
// 234 delta races carried ZERO `race_candidates` beforehand, so the widening
// adds rosters and changes none; the incumbent-leak count was 0.
//
// WHAT DID NOT CHANGE, deliberately: `getRacesIndex` is still rated-only for its
// own stated reason (the 432 House stubs would be 90% noise on the page), so
// `/electoral` and its cartogram list exactly what they listed before — the
// builder keys roster rows to the INDEX rows, so rows for non-index races are
// fetched and never matched. What changed is what a race page says when someone
// arrives at it. The INSERT, the sentinel, the NOT EXISTS guard, the incumbent
// exclusion and the CASE are all untouched.
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
// HO 660: extracted from scripts/backfill-race-challengers.ts so the daily cron
// (/api/cron/race-challengers, 30 12 * * *) and the manual npm run share ONE
// implementation. The SQL moved byte-identical — the refactor's equivalence was
// gated on the HO 659 stamp instrument, not on reading. `db` is an argument
// (the logRatingHistory pattern) and there is no dotenv import here: the server
// runtime carries env, and the script wrapper keeps its own.
import type { Client } from "@libsql/client";

export const CYCLE = 2026;
export const HARVEST_SOURCE = "harvest:primary_winner";

export type HarvestResult = {
  runStamp: string;
  cleared: number;
  inserted: number;
  rows: number;
  races: number;
  // HO 741: every 2026 `races` row — the denominator this harvest now works
  // against. `ratedIndex` stays beside it as the INDEX's own census, so the
  // payload can print both and neither stands in for the other.
  seats: number;
  ratedIndex: number;
};

// races (ALL 2026 rows since HO 741) ↔ primaries by state + chamber + district. races.district
// is INTEGER; primaries.district is zero-padded TEXT → CAST. Winner exclusion:
// drop the seat's own incumbent (bioguide match). A winner with a NULL bioguide
// passes as a challenger. The HO 213 probe found no incumbent winner without a
// bioguide, but HO 747 measured two, CA-14 Aisha Wahab and S-SC Darline Graham,
// each published as a challenger in her own race. That defect belongs to the
// backlog line "The harvest's incumbent exclusion trusts a bioguide the ingest
// assigns by surname…" (HO 747); HO 748 leaves it as it is.
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
    -- HO 748: IS NOT, not <>. With no stored incumbent, <> reads NULL and dropped every winner carrying a bioguide (FL-20).
    AND ( pc.bioguide_id IS NULL OR pc.bioguide_id IS NOT r.incumbent_bioguide_id )
    -- HO 748: jungle is held out (see the note above the INSERT). IS NOT keeps a NULL type in.
    AND p.primary_type IS NOT 'jungle'
    AND NOT EXISTS (
      SELECT 1 FROM race_candidates rc
      WHERE rc.race_id = r.id
        AND ( rc.source_url IS NULL OR rc.source_url <> '${HARVEST_SOURCE}' )
    )`;

export async function harvestChallengers(db: Client): Promise<HarvestResult> {
  // HO 659: one stamp per invocation, bound into every row this run writes, so
  // "which run touched this" is a GROUP BY on `updated_at` rather than a range
  // guess. Reach semantic — the harvest DELETEs and re-derives, so an unchanged
  // roster still re-stamps, and that is the point: the column records what the
  // run reached, which is the quantity HO 642/656 had to bracket behaviourally.
  // It lives INSIDE the function so both callers get one stamp per invocation.
  const runStamp = new Date().toISOString();

  // 1. Clear prior harvested rows (idempotent refresh). Never touches curated
  //    rows — they don't carry the sentinel.
  const del = await db.execute({
    sql: `DELETE FROM race_candidates WHERE source_url = ?`,
    args: [HARVEST_SOURCE],
  });

  // 2. Insert non-incumbent winners for index races with no curated roster.
  //    status='won_primary' / 'advanced' surfaces them first in the card's
  //    roster ordering — both rungs tie at 0 (lib/queries.ts).
  //
  //    HO 736 — WHY A STATUS AND NOT A LABEL. A top-four or top-two advancer
  //    did not win a party primary; four of them advance from one contest, and
  //    `won_primary` renders as "Won primary" / "primary winner" / "the party's
  //    general-election nominee", which is a nomination nobody received. HO 638
  //    set the precedent with `nominee`: a convention nominee never ran in a
  //    primary either, and got its own status rather than a relabelled
  //    `won_primary`, because the false claim would sit in a status column that
  //    nothing downstream re-reads. Same reasoning, same shape.
  //
  //    THE DATA PATH IS THIS FUNCTION'S OWN RE-DERIVE. No one-off UPDATE was
  //    written: the DELETE above clears every sentinel row and this INSERT
  //    rebuilds them, so changing what it writes re-flows on the next scheduled
  //    run (/api/cron/race-challengers, 30 12 * * *) with zero manual writes.
  //
  //    THE `ranked_choice` EXCLUSION IS ABOUT MEANING, NOT ABOUT ROWS. Neither
  //    type reaches this SELECT today (measured HO 736: open 211, NULL 19,
  //    top_two 13, top_four 2, ranked_choice 0, jungle 0; HO 748 re-read both
  //    at 0 winners), so no reading can falsify the `ranked_choice` one.
  //    `jungle` is a row filter since HO 748, and HO 748's leg 2 read it:
  //      · `ranked_choice` — Maine's six are ORDINARY party primaries that
  //        happen to be counted by RCV. One nominee each, so `won_primary` is
  //        true of them and `advanced` would be the false claim.
  //      · `jungle` — Louisiana's all-party contest is the GENERAL with a
  //        runoff, a different shape entirely (HO 577/584). HO 748: the
  //        exclusion is now ENFORCED in HARVEST_FROM_WHERE
  //        (`p.primary_type IS NOT 'jungle'`) rather than asserted here,
  //        because the six rows are dated 2026-11-03 and their winners get
  //        marked once the polls close. It holds until "What a race page shows
  //        once its race is decided is unruled…" (HO 747) is ruled: an outright
  //        jungle winner is elected, and no roster status says so.
  //
  //    THE CASE IS SINGLE-VALUED PER ROW, AND THAT IS LOAD-BEARING.
  //    `race_candidates` is PRIMARY KEY (race_id, name) and this is
  //    INSERT OR IGNORE, so if one (race, candidate) reached the SELECT under
  //    two different `primary_type` values the CASE would emit two rows and
  //    whichever arrived first would silently win. Measured at HO 736: 0 of 245
  //    (race, candidate) pairs reach it under more than one type, max 1 type
  //    per pair. What would break it is a state whose primaries rows for ONE
  //    seat disagree on `primary_type` — re-measure that before trusting this.
  //
  //    HO 741 — THAT MEASUREMENT WAS TAKEN WITH A NULL-BLIND INSTRUMENT, AND
  //    THE CORRECTED ONE IS NAMED HERE. `COUNT(DISTINCT p.primary_type)`
  //    ignores NULL, so a pair reachable under (NULL, 'top_two') counts ONE
  //    distinct type and passes — while the CASE emits `won_primary` for the
  //    NULL row and `advanced` for the other, which is precisely the hazard
  //    this note exists for. The quantity that matters is distinct CASE
  //    RESULTS per pair:
  //      SELECT COUNT(*) FROM (
  //        SELECT r.id, pc.name, COUNT(DISTINCT CASE WHEN p.primary_type IN
  //               ('top_four','top_two') THEN 'advanced' ELSE 'won_primary' END) n
  //        <HARVEST_FROM_WHERE> GROUP BY r.id, pc.name HAVING n > 1 )
  //    Re-measured 2026-09-20 against the SELECT with the rating gate removed
  //    (the widest set this CASE could ever see): 0 of 528 pairs, max 1 status,
  //    and 0 pairs reachable under both a NULL and a non-NULL type. The blind
  //    instrument could not see 33 NULL-type pairs; the invariant holds anyway.
  const ins = await db.execute({
    sql: `INSERT OR IGNORE INTO race_candidates
            (race_id, name, party, bioguide_id, status, source_url, updated_at)
          SELECT DISTINCT r.id, pc.name, pc.party, pc.bioguide_id,
                 CASE WHEN p.primary_type IN ('top_four', 'top_two')
                      THEN 'advanced' ELSE 'won_primary' END,
                 '${HARVEST_SOURCE}', ?
          ${HARVEST_FROM_WHERE}`,
    args: [runStamp],
  });

  // 3. Fill census.
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
  // HO 741: the widened denominator. Kept SEPARATE from `idx` rather than
  // replacing it — the index census is still the right number for the index, and
  // a payload that printed only one of the two would hide which scope moved.
  const seats = await db.execute(
    `SELECT COUNT(*) AS n FROM races WHERE cycle = ${CYCLE}`,
  );

  return {
    runStamp,
    cleared: del.rowsAffected,
    inserted: ins.rowsAffected,
    rows: Number(filled.rows[0]?.rows ?? 0),
    races: Number(filled.rows[0]?.races ?? 0),
    seats: Number(seats.rows[0]?.n ?? 0),
    ratedIndex: Number(idx.rows[0]?.n ?? 0),
  };
}
