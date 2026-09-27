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
//
// HO 750 — THE HARVEST YIELDS TO THE BALLOT. The paragraphs above describe the
// primary-sourced derivation, which now serves only races WITHOUT a `box` read
// in general_ballot_reads. Every race with one publishes the November ballot
// as HO 749's reader stored it (planBallotRoster, below), because a primary
// result diverges from the ballot whenever an advancer or nominee leaves it
// after the primary: HO 747 measured 40 published names off the ballot (35 of
// them harvested runoff losers) and about 60 major-party candidates on it and
// unpublished. The seat's incumbent is told apart by identity, with the
// underline-and-surname fallback, in lib/ballot-incumbent.ts, not by a
// bioguide the ingest assigns by surname. Curated rosters are untouched.
import type { Client, InStatement } from "@libsql/client";
import { findIncumbentOnBallot, findIncumbentRow, normName, type BallotPerson, type IncumbentRoute } from "./ballot-incumbent";
import { TOP_FOUR_STATES, TOP_TWO_STATES } from "./primary-calendar-scrape";

export const CYCLE = 2026;
// HO 750 — TWO SENTINELS. `harvest:primary_winner` is the primary-sourced
// derivation below, kept for every race WITHOUT a `box` read in
// general_ballot_reads (Louisiana's jungle seats, FL-10's canceled general, any
// race the ballot reader has not read). `harvest:general_ballot` is the
// ballot-sourced roster (planBallotRoster). Both are harvested rows: the DELETE
// clears both, and the curated guard treats neither as curated.
export const HARVEST_SOURCE = "harvest:primary_winner";
export const BALLOT_SOURCE = "harvest:general_ballot";
export const HARVEST_SOURCES = [HARVEST_SOURCE, BALLOT_SOURCE] as const;

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
  // HO 750: rows and races by sentinel, the incumbent rule's routes over the
  // ballot-sourced races, the ballot rows planned against those inserted (a
  // (race_id, name) collision is ignored by INSERT OR IGNORE and counted here,
  // never silent), and the curated races whose active roster differs from the
  // ballot's in-scope set, named.
  bySource: Record<string, { rows: number; races: number }>;
  ballotRaces: number;
  ballotPlanned: number;
  ballotIgnored: number;
  incumbentRoutes: Record<IncumbentRoute, number>;
  curatedDivergence: string[];
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
// HO 750: this primary-sourced WHERE now serves only the races WITHOUT a `box`
// read; a race with one publishes from the ballot (planBallotRoster). The
// curated guard counts both sentinels as harvested. HO 748's two clauses stand.
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
    -- HO 750: a race with a box read publishes from the ballot instead. The box
    -- races are the PLAN's (one JSON argument), not re-read here: a ballot tick
    -- committing between the plan's read and this batch would otherwise leave a
    -- race with both sentinels' rows, or with none, until the next harvest.
    AND r.id NOT IN (SELECT value FROM json_each(?))
    AND NOT EXISTS (
      SELECT 1 FROM race_candidates rc
      WHERE rc.race_id = r.id
        AND ( rc.source_url IS NULL OR rc.source_url NOT IN ('${HARVEST_SOURCE}', '${BALLOT_SOURCE}') )
    )`;

// HO 750 — THE BALLOT-SOURCED ROSTER. For every 2026 race whose
// general_ballot_reads.status is `box` and which carries no curated row, the
// roster is the ballot's (lib/general-ballot.ts, HO 749), not the primary's:
//   · candidates: on_ballot = 1 and write_in = 0, less the incumbent's row (the
//     rule in lib/ballot-incumbent.ts). In a top-two or top-four state every
//     one of them; otherwise those whose party is D or R. Whether race pages
//     list third parties and independents is Corey's call, filed; this
//     publishes what the harvest published before, corrected by the ballot.
//   · status: `advanced` in a top-two or top-four state; otherwise `won_primary`
//     when the same person was marked winner in a kept primary box on the page
//     (primary_marked = 1), and `nominee` when not (a convention, a
//     replacement, a canceled primary).
//   · `withdrew`: primary_marked = 1, on_ballot = 0 and withdrawn = 1, so an
//     advancer who left the ballot is shown leaving it (S-AK's Leslie) rather
//     than vanishing. A runoff loser has none of these and is not published.
//     The stored incumbent is never a `withdrew` row: NC-11's Chuck Edwards won
//     his primary and withdrew, and what a card says of an incumbent who left
//     the ballot is Corey's (HO 750 departure, named).
//   · bioguide_id and party from the ballot row, so the bioguide is identity's,
//     never the ingest's surname match.
// Results are out of scope (the election-night line): nothing here reads the
// winner marks.
export type PlannedRow = { race_id: string; name: string; party: string | null; bioguide_id: string | null; status: string };
export type BallotPlan = {
  rows: PlannedRow[];
  ballotRaces: string[];
  // Every race with a `box` read in the plan's snapshot, curated or not: the
  // primary-sourced INSERT…SELECT excludes exactly these.
  boxRaces: string[];
  incumbentRoutes: Record<IncumbentRoute, number>;
  curatedDivergence: string[];
};
// lib/race-matchup.ts WITHDRAWN: statuses that mean the candidate is out.
const OUT_STATUSES = new Set(["withdrew", "withdrawn", "lost", "loser", "eliminated"]);
// Same person when the first and last name tokens agree, so a printed middle
// name is not a divergence (S-ME's curated "Troy Jackson", the ballot's "Troy
// Dale Jackson").
const firstLast = (name: string) => {
  const t = normName(name).split(" ").filter((x) => x && !["jr", "sr", "ii", "iii", "iv"].includes(x));
  return `${t[0] ?? ""} ${t[t.length - 1] ?? ""}`;
};
type GbRow = BallotPerson & { race_id: string; party: string | null; write_in: number; withdrawn: number; primary_marked: number };

export async function planBallotRoster(db: Client): Promise<BallotPlan> {
  // One read transaction, so the reads and the rows are one snapshot.
  const [racesRs, curatedRs, gbRs, boxRs] = await db.batch(
    [
      {
        sql: `SELECT r.id, r.state, r.incumbent_bioguide_id, m.last_name
                FROM races r LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
               WHERE r.cycle = ?`,
        args: [CYCLE],
      },
      {
        sql: `SELECT race_id, name, status FROM race_candidates
               WHERE source_url IS NULL OR source_url NOT IN (?, ?)`,
        args: [HARVEST_SOURCE, BALLOT_SOURCE],
      },
      {
        sql: `SELECT g.race_id, g.person_key, g.name, g.party, g.bioguide_id, g.incumbent_marked,
                     g.write_in, g.on_ballot, g.withdrawn, g.primary_marked
                FROM general_ballot g
                JOIN general_ballot_reads rd ON rd.race_id = g.race_id AND rd.status = 'box'
               ORDER BY g.race_id, g.person_key`,
        args: [],
      },
      // A race with a box read but no rows (every person a write-in, say)
      // still has a box: it gets no ballot rows and no primary-sourced rows.
      { sql: `SELECT race_id FROM general_ballot_reads WHERE status = 'box'`, args: [] },
    ],
    "read",
  );
  const races = new Map(
    racesRs!.rows.map((r) => [
      String(r.id),
      {
        state: String(r.state),
        incumbent: r.incumbent_bioguide_id == null ? null : String(r.incumbent_bioguide_id),
        lastName: r.last_name == null ? null : String(r.last_name),
      },
    ]),
  );
  const curated = new Map<string, { name: string; status: string | null }[]>();
  for (const r of curatedRs!.rows) {
    const k = String(r.race_id);
    (curated.get(k) ?? curated.set(k, []).get(k)!).push({ name: String(r.name), status: r.status == null ? null : String(r.status) });
  }
  const byRace = new Map<string, GbRow[]>();
  for (const r of gbRs!.rows) {
    const row: GbRow = {
      race_id: String(r.race_id),
      person_key: String(r.person_key),
      name: String(r.name),
      party: r.party == null ? null : String(r.party),
      bioguide_id: r.bioguide_id == null ? null : String(r.bioguide_id),
      incumbent_marked: Number(r.incumbent_marked),
      write_in: Number(r.write_in),
      on_ballot: Number(r.on_ballot),
      withdrawn: Number(r.withdrawn),
      primary_marked: Number(r.primary_marked),
    };
    (byRace.get(row.race_id) ?? byRace.set(row.race_id, []).get(row.race_id)!).push(row);
  }
  const boxRaces = new Set(boxRs!.rows.map((r) => String(r.race_id)));

  const plan: BallotPlan = { rows: [], ballotRaces: [], boxRaces: [...boxRaces].sort(), incumbentRoutes: { identity: 0, "underline-surname": 0, none: 0 }, curatedDivergence: [] };
  for (const id of [...boxRaces].filter((x) => races.has(x)).sort()) {
    const race = races.get(id)!;
    const rows = byRace.get(id) ?? [];
    const stored = race.incumbent ? { bioguideId: race.incumbent, lastName: race.lastName } : null;
    const inc = stored ? findIncumbentOnBallot(rows, stored) : null;
    // A top-two or top-four STATE, by the calendar's own sets, not by
    // primaries.primary_type: Washington's ten rows carry NULL there, and a
    // branch on the column would miss a whole top-two state (HO 750 review).
    const tx = TOP_TWO_STATES.has(race.state) || TOP_FOUR_STATES.has(race.state);
    const inScope = rows.filter(
      (r) => r.on_ballot === 1 && r.write_in === 0 && r !== inc?.row && (tx || r.party === "D" || r.party === "R"),
    );
    const cur = curated.get(id);
    if (cur) {
      // Curated races are untouched; their divergence from the ballot is named.
      const cs = new Set(cur.filter((c) => !OUT_STATUSES.has((c.status ?? "").toLowerCase())).map((c) => firstLast(c.name)));
      const bs = new Set(inScope.map((r) => firstLast(r.name)));
      const onlyCur = cur.filter((c) => !OUT_STATUSES.has((c.status ?? "").toLowerCase()) && !bs.has(firstLast(c.name))).map((c) => c.name);
      const onlyBal = inScope.filter((r) => !cs.has(firstLast(r.name))).map((r) => r.name);
      if (onlyCur.length || onlyBal.length) plan.curatedDivergence.push(`${id}: curated only [${onlyCur.join(", ")}]; ballot only [${onlyBal.join(", ")}]`);
      continue;
    }
    plan.ballotRaces.push(id);
    if (inc) plan.incumbentRoutes[inc.route]++;
    for (const r of inScope) {
      plan.rows.push({
        race_id: id,
        name: r.name,
        party: r.party,
        bioguide_id: r.bioguide_id,
        status: tx ? "advanced" : r.primary_marked === 1 ? "won_primary" : "nominee",
      });
    }
    // The incumbent's row anywhere on the page, by the rule's two routes, so an
    // incumbent under a stale title who withdrew is not published as their own
    // `withdrew` challenger, and a race with no stored incumbent excludes no one
    // (a bare `bioguide_id !== incumbent` read null !== null as false there and
    // dropped every NULL-bioguide withdrawal; HO 750 review).
    const incAnywhere = findIncumbentRow(rows, stored);
    for (const r of rows) {
      if (r.on_ballot === 0 && r.withdrawn === 1 && r.primary_marked === 1 && r !== incAnywhere) {
        plan.rows.push({ race_id: id, name: r.name, party: r.party, bioguide_id: r.bioguide_id, status: "withdrew" });
      }
    }
  }
  return plan;
}

export async function harvestChallengers(db: Client): Promise<HarvestResult> {
  // HO 659: one stamp per invocation, bound into every row this run writes, so
  // "which run touched this" is a GROUP BY on `updated_at` rather than a range
  // guess. Reach semantic — the harvest DELETEs and re-derives, so an unchanged
  // roster still re-stamps, and that is the point: the column records what the
  // run reached, which is the quantity HO 642/656 had to bracket behaviourally.
  // It lives INSIDE the function so both callers get one stamp per invocation.
  const runStamp = new Date().toISOString();

  // 0. HO 750: plan the ballot-sourced roster (read only, one snapshot).
  const plan = await planBallotRoster(db);

  // 1. Clear prior harvested rows under BOTH sentinels (idempotent refresh).
  //    Never touches curated rows, which carry neither.
  const stmts: InStatement[] = [
    { sql: `DELETE FROM race_candidates WHERE source_url IN (?, ?)`, args: [HARVEST_SOURCE, BALLOT_SOURCE] },
  ];
  // 1b. HO 750: the ballot-sourced rows, 100 to a statement.
  for (let i = 0; i < plan.rows.length; i += 100) {
    const part = plan.rows.slice(i, i + 100);
    stmts.push({
      sql: `INSERT OR IGNORE INTO race_candidates
              (race_id, name, party, bioguide_id, status, source_url, updated_at)
            VALUES ${part.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      args: part.flatMap((r) => [r.race_id, r.name, r.party, r.bioguide_id, r.status, BALLOT_SOURCE, runStamp]),
    });
  }

  // 2. Insert non-incumbent winners for the races WITHOUT a box read and with
  //    no curated roster (HO 750: the primary-sourced half).
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
  stmts.push({
    sql: `INSERT OR IGNORE INTO race_candidates
            (race_id, name, party, bioguide_id, status, source_url, updated_at)
          SELECT DISTINCT r.id, pc.name, pc.party, pc.bioguide_id,
                 CASE WHEN p.primary_type IN ('top_four', 'top_two')
                      THEN 'advanced' ELSE 'won_primary' END,
                 '${HARVEST_SOURCE}', ?
          ${HARVEST_FROM_WHERE}`,
    args: [runStamp, JSON.stringify(plan.boxRaces)],
  });

  // HO 750: ONE TRANSACTION. Until HO 750 the DELETE and the INSERT…SELECT were
  // two `execute` calls, so a failure between them left a race with no
  // harvested rows at all. Now the DELETE and every INSERT commit together or
  // not at all, and a throw after the DELETE leaves the old rows in place.
  const done = await db.batch(stmts, "write");
  const cleared = done[0]!.rowsAffected;
  const ballotInserted = done.slice(1, -1).reduce((a, r) => a + r.rowsAffected, 0);
  const primaryInserted = done[done.length - 1]!.rowsAffected;

  // 3. Fill census, both sentinels together and each on its own.
  const filled = await db.execute({
    sql: `SELECT COUNT(DISTINCT race_id) AS races, COUNT(*) AS rows
          FROM race_candidates WHERE source_url IN (?, ?)`,
    args: [HARVEST_SOURCE, BALLOT_SOURCE],
  });
  const perSource = await db.execute({
    sql: `SELECT source_url, COUNT(*) AS rows, COUNT(DISTINCT race_id) AS races
          FROM race_candidates WHERE source_url IN (?, ?) GROUP BY source_url`,
    args: [HARVEST_SOURCE, BALLOT_SOURCE],
  });
  const bySource: Record<string, { rows: number; races: number }> = {
    [HARVEST_SOURCE]: { rows: 0, races: 0 },
    [BALLOT_SOURCE]: { rows: 0, races: 0 },
  };
  for (const r of perSource.rows) bySource[String(r.source_url)] = { rows: Number(r.rows), races: Number(r.races) };
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
    cleared,
    inserted: ballotInserted + primaryInserted,
    rows: Number(filled.rows[0]?.rows ?? 0),
    races: Number(filled.rows[0]?.races ?? 0),
    seats: Number(seats.rows[0]?.n ?? 0),
    ratedIndex: Number(idx.rows[0]?.n ?? 0),
    bySource,
    ballotRaces: plan.ballotRaces.length,
    ballotPlanned: plan.rows.length,
    ballotIgnored: plan.rows.length - ballotInserted,
    incumbentRoutes: plan.incumbentRoutes,
    curatedDivergence: plan.curatedDivergence,
  };
}
