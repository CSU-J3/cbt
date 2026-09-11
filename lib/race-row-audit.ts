// HO 711 — race-row integrity, as a READING rather than an action.
//
// `backfill:races` mints and never retracts: it creates a row at whatever
// `next_election_year` a member carried on the day, and nothing removes it when
// the year moves. HO 411 moved eighteen senator-years and left the rows behind;
// HO 412 deleted the two 2026 phantoms it could see and no others; HO 711's
// House term-math fix moved four more. Each time, the rows that went stale were
// invisible until somebody went looking.
//
// Retraction stays MANUAL — a routine script that deletes rows is a hazard, and
// the HO 412 shape (enumerate dependents, delete with them, prove the backfill
// cannot recreate them) is a considered pass, not a cron. What changes here is
// that the silence ends: `backfill:races` prints this audit as its last line on
// every run, and the standing guard prints it as SECTION 5. One implementation,
// two callers, so the two can never disagree.
import type { Client } from "@libsql/client";
import { districtToken } from "./race-id";

export type RaceRowAudit = {
  scopeFromCycle: number;
  phantoms: string[];
  departedIncumbent: string[];
  atLargeMismatches: string[];
};

// Scope: cycles at or after the current year. Past cycles are HISTORY — their
// departed incumbent is the record of who vacated the seat, and the six 2025
// rows this HO removes were removed by a considered one-shot, not by a rule that
// would also have taken every legitimate past contest with them.
export function auditScopeFromCycle(now = new Date()): number {
  return now.getUTCFullYear();
}

export async function auditRaceRows(
  db: Client,
  fromCycle = auditScopeFromCycle(),
): Promise<RaceRowAudit> {
  const rows = (
    await db.execute({
      sql: `SELECT r.id, r.cycle, r.chamber, r.state, r.district,
                   r.incumbent_bioguide_id,
                   m.is_current, m.next_election_year, m.state AS m_state,
                   m.district AS m_district
              FROM races r
              LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
             WHERE r.cycle >= ?
             ORDER BY r.cycle, r.id`,
      args: [fromCycle],
    })
  ).rows;

  // One row per (state, cycle) that a sitting senator actually stands in.
  const senateStands = new Set(
    (
      await db.execute(
        `SELECT state, next_election_year FROM members
          WHERE chamber = 'senate' AND is_current = 1
            AND next_election_year IS NOT NULL`,
      )
    ).rows.map((m) => `${m.state}|${m.next_election_year}`),
  );

  const phantoms: string[] = [];
  const departedIncumbent: string[] = [];
  const atLargeMismatches: string[] = [];

  for (const r of rows) {
    const id = String(r.id);
    const cycle = Number(r.cycle);

    // SENATE PHANTOM — no sitting senator of that state stands at this cycle.
    //
    // This is the members-side derivation read back against the races side, and
    // it is deliberately NOT the class residue. `senateClassForCycle(cycle)`
    // against the state's sitting members looks equivalent and is not: a SPECIAL
    // ELECTION legitimately puts a Class 3 senator on a Class 2 ballot, so the
    // class test flags S-FL-2026 and S-OH-2026 — two rated, market-linked rows
    // that HO 710's outlook links to as its TBD deciding contests. It was the
    // handoff's original predicate and it would have deleted them. The class is
    // fully determined by the cycle for SEATS and not for special elections,
    // which is exactly why it must never be the audit.
    if (r.chamber === "senate") {
      if (!senateStands.has(`${r.state}|${cycle}`)) phantoms.push(id);
    }

    // HOUSE PHANTOM — an odd cycle whose incumbent is sitting but whose own
    // derived id is some other row. The odd cycle alone is the wrong test: past
    // odd-cycle rows can be legitimate records of real special elections, and
    // the scope clause above is not what should be carrying that distinction.
    // This is the stale-derivation shape instead — the row disagrees with what
    // today's derivation says its own incumbent's seat id is.
    if (r.chamber === "house" && cycle % 2 === 1 && r.is_current === 1) {
      const derived = `${r.m_state}-${districtToken(
        r.m_district == null ? null : Number(r.m_district),
      )}-${r.next_election_year}`;
      if (derived !== id) phantoms.push(id);
    }

    // DEPARTED INCUMBENT — a reading with three dispositions, never an automatic
    // action. It heals on the next backfill if a sitting member maps to the id;
    // it is NULLed if the seat is simply vacant at a regular cycle; it is
    // deleted only when the row is also a phantom.
    if (r.incumbent_bioguide_id != null && r.is_current === 0) {
      departedIncumbent.push(id);
    }

    // AT-LARGE SANITY — the two halves of the HO 711 convention must agree:
    // `district = 0` and an id carrying the AL token. Checked ANCHORED, because
    // a bare `-AL-` substring also matches `S-AL-2026`, the Alabama Senate seat.
    if (r.chamber === "house") {
      const idIsAtLarge = /^[A-Z]{2}-AL-\d{4}$/.test(id);
      const colIsAtLarge = r.district != null && Number(r.district) === 0;
      if (idIsAtLarge !== colIsAtLarge) atLargeMismatches.push(id);
    }
  }

  return {
    scopeFromCycle: fromCycle,
    phantoms,
    departedIncumbent,
    atLargeMismatches,
  };
}

const list = (ids: string[]) => (ids.length ? ` [${ids.join(", ")}]` : "");

export function formatRaceRowAudit(a: RaceRowAudit): string {
  return (
    `race rows >= ${a.scopeFromCycle}: ` +
    `phantoms ${a.phantoms.length}${list(a.phantoms)} · ` +
    `departed-incumbent ${a.departedIncumbent.length}${list(a.departedIncumbent)} · ` +
    `at-large mismatches ${a.atLargeMismatches.length}${list(a.atLargeMismatches)}`
  );
}
