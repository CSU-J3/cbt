// HO 758 — WHAT A DECIDED RACE SHOWS (the election-night line, ruled C: the
// result). Two halves, both pure of Next so the legs call what the page runs:
//   · readRaceResult(db, raceId): the race's result as Ballotpedia marks it,
//     from its November box (general_ballot.marked, HO 758) or, for a
//     Louisiana seat, its Nov-3 jungle box (primary_candidates.status
//     'winner', read by /api/cron/primaries). lib/queries.ts caches it
//     (getRaceResult).
//   · raceResultView(reading, cycle, nowMs): what the page says. DORMANT before
//     election day: every field null or false, so nothing on the page changes
//     until daysToElection(cycle) < 0 (lib/format.ts, on lib/clock.ts's now).
// The seat's incumbent is never a roster row, so re-elected / defeated are read
// from the incumbent's own ballot row, found by the incumbent rule
// (lib/ballot-incumbent.ts), as the stub's getIncumbentOnBallot finds it.
import type { Client } from "@libsql/client";
import { findIncumbentOnBallot } from "./ballot-incumbent";
import { daysToElection, electionDay } from "./format";

export type RaceResultReading = {
  // Where the result is read from: the race's `box`, Louisiana's jungle box,
  // a read that found no general box (`no_box` or `ambiguous`, e.g. FL-10,
  // whose general was canceled), or nowhere (no read yet).
  source: "box" | "jungle" | "no_box" | null;
  // When Ballotpedia was read: general_ballot_reads.read_at for a box, the
  // jungle contest's primaries.updated_at (the primaries cron's last write).
  readAt: string | null;
  // A winner is marked: EXACTLY ONE printed row of the box, or exactly one
  // jungle winner. Two or more marks are a runoff (HO 758's review: a general
  // that goes to a runoff, as Georgia's do, marks both advancers), not a result.
  anyMarked: boolean;
  // Two or more marks: the box's printed rows, or the jungle box's winners.
  runoff: boolean;
  // The stored incumbent: on the race's ballot (null without a reading or a
  // stored incumbent), and marked the winner.
  incumbent: { stored: boolean; onBallot: boolean | null; marked: boolean; inRunoff: boolean };
  // Louisiana: winners marked and the runoff's date (primaries.runoff_date, as
  // HOUSE_PRIMARY_OVERRIDES writes it).
  jungle: { winners: number; runoffDate: string | null } | null;
};

export async function readRaceResult(db: Client, raceId: string): Promise<RaceResultReading> {
  const [raceRs, readRs, rowsRs, jungleRs] = await db.batch(
    [
      {
        sql: `SELECT r.incumbent_bioguide_id, m.last_name
                FROM races r LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
               WHERE r.id = ?`,
        args: [raceId],
      },
      { sql: `SELECT status, read_at FROM general_ballot_reads WHERE race_id = ?`, args: [raceId] },
      {
        sql: `SELECT person_key, name, bioguide_id, incumbent_marked, on_ballot, marked
                FROM general_ballot WHERE race_id = ?`,
        args: [raceId],
      },
      {
        sql: `SELECT p.id, p.runoff_date, p.updated_at, pc.name, pc.bioguide_id, pc.status
                FROM races r
                JOIN primaries p
                  ON p.state = r.state AND p.chamber = r.chamber
                 AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
                 AND p.primary_type = 'jungle' AND p.election_round IS NOT 'runoff'
                JOIN primary_candidates pc ON pc.primary_id = p.id
               WHERE r.id = ?`,
        args: [raceId],
      },
    ],
    "read",
  );
  const inc = raceRs!.rows[0]?.incumbent_bioguide_id;
  const stored = inc == null ? null : { bioguideId: String(inc), lastName: raceRs!.rows[0]?.last_name == null ? null : String(raceRs!.rows[0]!.last_name) };
  const read = readRs!.rows[0];
  if (read?.status === "box") {
    const rows = rowsRs!.rows.map((r) => ({
      person_key: String(r.person_key),
      name: String(r.name),
      bioguide_id: r.bioguide_id == null ? null : String(r.bioguide_id),
      incumbent_marked: Number(r.incumbent_marked),
      on_ballot: Number(r.on_ballot),
      marked: Number(r.marked ?? 0),
    }));
    const found = stored ? findIncumbentOnBallot(rows, stored) : null;
    const nMarked = rows.filter((r) => r.on_ballot === 1 && r.marked === 1).length;
    const incMarked = found?.row?.marked === 1;
    return {
      source: "box",
      readAt: read.read_at == null ? null : String(read.read_at),
      anyMarked: nMarked === 1,
      runoff: nMarked >= 2,
      incumbent: { stored: !!stored, onBallot: stored ? found!.route !== "none" : null, marked: incMarked && nMarked === 1, inRunoff: incMarked && nMarked >= 2 },
      jungle: null,
    };
  }
  const jr = jungleRs!.rows;
  if (jr.length > 0) {
    const winners = jr.filter((r) => r.status === "winner").length;
    const incRow = stored ? jr.find((r) => r.bioguide_id != null && String(r.bioguide_id) === stored.bioguideId) : undefined;
    return {
      source: "jungle",
      readAt: jr[0]!.updated_at == null ? null : String(jr[0]!.updated_at),
      anyMarked: winners === 1,
      runoff: winners >= 2,
      incumbent: { stored: !!stored, onBallot: stored ? !!incRow : null, marked: !!incRow && incRow.status === "winner" && winners === 1, inRunoff: !!incRow && incRow.status === "winner" && winners === 2 },
      jungle: { winners, runoffDate: jr[0]!.runoff_date == null ? null : String(jr[0]!.runoff_date) },
    };
  }
  // A read that found no general box (FL-10's canceled general, an ambiguous
  // page): no result to read, but the read happened and its time is kept.
  if (read?.status === "no_box" || read?.status === "ambiguous") {
    return { source: "no_box", readAt: read.read_at == null ? null : String(read.read_at), anyMarked: false, runoff: false, incumbent: { stored: !!stored, onBallot: null, marked: false, inRunoff: false }, jungle: null };
  }
  return { source: null, readAt: null, anyMarked: false, runoff: false, incumbent: { stored: !!stored, onBallot: null, marked: false, inRunoff: false }, jungle: null };
}

export type RaceResultView = {
  passed: boolean; // election day has passed (the only gate)
  decided: boolean;
  runoff: boolean;
  header: string | null; // replaces the countdown: "Decided · Nov 3, 2026" / "Runoff Dec 12" / "Not yet called"
  qualifier: string | null; // the incumbent card's: re-elected / defeated / not on the ballot / runoff Dec 12
  provenance: string | null; // under the roster
};
export const DORMANT: RaceResultView = { passed: false, decided: false, runoff: false, header: null, qualifier: null, provenance: null };

const monthDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
// "Nov 4, 2026, 8:14 AM MT": the read's time in Mountain Time (the owner's).
export function formatReadMt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Denver" })} MT`;
}

export function raceResultView(r: RaceResultReading, cycle: number, nowMs: number): RaceResultView {
  if (daysToElection(cycle, nowMs) >= 0) return DORMANT;
  const runoff = r.runoff;
  const decided = !runoff && (r.anyMarked || r.incumbent.marked);
  // Louisiana's runoff date is the jungle row's; a general box carries none.
  const runoffLabel = r.jungle?.runoffDate ? `Runoff ${monthDay(new Date(`${r.jungle.runoffDate}T00:00:00Z`))}` : "Runoff";
  const header = decided ? `Decided · ${monthDay(electionDay(cycle))}, ${cycle}` : runoff ? runoffLabel : "Not yet called";
  let qualifier: string | null = null;
  if (r.incumbent.stored) {
    if (r.incumbent.onBallot === false) qualifier = "not on the ballot";
    else if (runoff) qualifier = r.incumbent.inRunoff ? runoffLabel.replace(/^Runoff/, "runoff") : r.incumbent.onBallot ? "defeated" : null;
    else if (decided && r.incumbent.marked) qualifier = "re-elected";
    else if (decided && r.incumbent.onBallot) qualifier = "defeated";
  }
  const read = r.readAt ? ` · read ${formatReadMt(r.readAt)}` : "";
  const provenance = decided
    ? `Called by Ballotpedia${read}`
    : r.source === "no_box"
      ? `No general-election box on Ballotpedia${read}`
      : `No call on Ballotpedia${read}`;
  return { passed: true, decided, runoff, header, qualifier, provenance };
}
