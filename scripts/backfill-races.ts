// One-shot derivation of stub race rows from `members` (handoff 62).
//
// One row per (state, district, cycle) for the House and one per
// (state, cycle) for the Senate. The id expression is a SQL translation of
// `raceIdFromMember` in lib/race-id.ts — keep all four sites in sync (the other
// two are getSeatOutlook's CASE in lib/queries.ts and districtSeatId in
// lib/district-geo.ts). Senate ignores district by design.
//
// HO 711: House rows with a NULL district used to be filtered out wholesale,
// which swept the six AT-LARGE states (AK, DE, ND, SD, VT, WY) out along with
// the six territorial delegations. Only the delegations belong out — a delegate
// holds no contested seat. At-large seats now mint `{ST}-AL-{YYYY}` and store
// `district = 0`. THE 0 IS DERIVED HERE, not in `members`: Congress.gov gives
// at-large members no district and `members.district` stays NULL; `races.district`
// uses 0 so RaceHeader's `district === 0` branch, harvest-challengers' numeric
// join against `primary_candidates.district` (also 0) and raceLabelCompact all
// work with no change.
//
// HO 412: self-healing on `incumbent_bioguide_id` ONLY. Was `INSERT OR IGNORE`
// (conflicts left the stored incumbent stale — that's how S-CO-2026 kept Bennet
// after HO 411 moved his ney to 2028). Now `ON CONFLICT(id) DO UPDATE SET
// incumbent_bioguide_id = excluded.incumbent_bioguide_id` re-derives the seat's
// current officeholder on every run. Scoped to that ONE column, so rating /
// margin / incumbent_running / roster (race_candidates) are never touched, and
// `seed:races` still runs last to reassert genuine curated overrides (the lone
// one — S-OK-2026 → Armstrong — already derives to the same value post-HO 411).
// Safe only because the is_current=1 filter makes each id map to exactly one
// member (0 ambiguity, verified) — otherwise the SET would be nondeterministic.
import "dotenv/config";
import { getDb } from "../lib/db";
import { auditRaceRows, formatRaceRowAudit } from "../lib/race-row-audit";
import { TERRITORIAL_STATES, sqlStateList } from "../lib/states";

async function main() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const before = await db.execute("SELECT COUNT(*) AS n FROM races");
  console.log(`Races before: ${before.rows[0]?.n ?? 0}`);

  const result = await db.execute({
    sql: `
      INSERT INTO races
        (id, cycle, chamber, state, district, incumbent_bioguide_id, last_verified)
      SELECT
        CASE
          WHEN m.chamber = 'senate' THEN 'S-' || m.state || '-' || m.next_election_year
          WHEN m.district IS NULL THEN m.state || '-AL-' || m.next_election_year
          ELSE m.state || '-' || printf('%02d', m.district) || '-' || m.next_election_year
        END AS id,
        m.next_election_year,
        m.chamber,
        m.state,
        CASE
          WHEN m.chamber = 'senate' THEN NULL
          WHEN m.district IS NULL THEN 0
          ELSE m.district
        END,
        m.bioguide_id,
        ?
      FROM members m
      WHERE m.next_election_year IS NOT NULL
        AND m.state IS NOT NULL
        AND m.chamber IS NOT NULL
        -- HO 411: only currently-serving members seed a race incumbent. A
        -- departed senator (is_current=0) keeps a legacy fallback year-pair,
        -- so without this a future resignation could put two members at the
        -- same S-<state>-2026 id and recreate the two-at-2026 ambiguity that
        -- HO 410 caught on the CO card. The audit §3 population matches this.
        AND m.is_current = 1
        -- HO 711: the carve is TERRITORIAL, not district-IS-NULL. A delegate has
        -- no contested seat; an at-large member does. The list is INTERPOLATED
        -- from TERRITORIAL_STATES (lib/states.ts) through sqlStateList, so the
        -- constant is read here rather than transcribed; the emitted SQL text is
        -- byte-identical to the literal it replaces. Compile-time constants only,
        -- so no user input reaches this string.
        AND NOT (m.chamber = 'house' AND m.district IS NULL
                 AND m.state IN (${sqlStateList(TERRITORIAL_STATES)}))
      ON CONFLICT(id) DO UPDATE SET
        incumbent_bioguide_id = excluded.incumbent_bioguide_id
    `,
    args: [today],
  });
  console.log(`Inserted/updated (rowsAffected): ${result.rowsAffected}`);

  const after = await db.execute("SELECT COUNT(*) AS n FROM races");
  console.log(`Races after: ${after.rows[0]?.n ?? 0}`);

  // HO 711: the audit is the run's LAST line, on every run. A routine script
  // that DELETES rows is a hazard, so retraction stays a considered one-shot —
  // but a routine script that mints and stays silent about what it left behind
  // is how nine phantom rows survived from HO 411 to HO 711 unnoticed. This
  // does not act; it says.
  const byChamber = await db.execute(
    "SELECT chamber, COUNT(*) AS n FROM races GROUP BY chamber",
  );
  for (const row of byChamber.rows) {
    console.log(`  ${row.chamber}: ${row.n}`);
  }

  console.log(formatRaceRowAudit(await auditRaceRows(db)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
