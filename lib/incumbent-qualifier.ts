// HO 759 — WHAT A CARD SAYS OF AN INCUMBENT WHO IS NOT ON THIS SEAT'S BALLOT
// (the backlog's HO 747 class line, ruled C on docs/design/mock-moved-incumbent.html:
// by kind, and the reason where the data carries one). Pure of Next, so the
// legs call what the pages run; lib/queries.ts caches it (getIncumbentQualifiers).
//
// WHO: a race of the cycle with a stored incumbent and a `box` read whose
// incumbent the rule in lib/ballot-incumbent.ts finds on no printed row of
// that box (94 of the 461 box races with a stored incumbent at HO 758's STEP 0).
// An incumbent on their own ballot gets nothing, and so does a race with no
// `box` read (Louisiana's six, whose Nov-3 box is the jungle, and FL-10, whose
// general was canceled): nothing says they are off it.
//
// THE KIND, first, by identity (general_ballot.bioguide_id, set from the page
// title only, so a namesake never ties):
//   moved   a printed row (on_ballot = 1) in another House race of the state;
//   senate  a printed row in an `S-` race;
//   none    neither.
// Kind beats the curated flag: IA-02's Hinson, curated incumbent_running = 0,
// is printed on S-IA's ballot and reads RUNNING FOR SENATE, not RETIRING.
// THE REASON, for `none` only, first match in this order:
//   retiring      the curated races.incumbent_running = 0 (HO 221);
//   withdrew      a row with their bioguide in any withdrawn block of the
//                 cycle (general_ballot.withdrawn = 1; the box's "Withdrawn or
//                 disqualified candidates" list, so a disqualification too);
//   lost_primary  an unmarked row (status 'running') in a decided primary of
//                 the cycle (one with a 'winner' row), matched by bioguide AND
//                 by name: primary_candidates.bioguide_id is assigned by a
//                 member match that lets namesakes through (TX-22's "Trever
//                 Nehls" carries Troy Nehls's), so the printed name must also
//                 pass HO 751's name check (tokenCheck, lib/ballot-incumbent.ts:
//                 every surname token, and a first-name token whole or as a
//                 prefix of three letters or more either way);
//   absent        none of these.
// A runoff round is a primary of its own (primaries.election_round), and a
// round that went to a runoff marks its advancers 'winner'. So an incumbent who
// advanced and then lost the runoff is marked in the first round and unmarked
// in the runoff, a decided primary of the cycle, and reads `lost_primary` by
// the clause above with no rule of its own. Until HO 761 the table held no
// runoff round the page printed (only three seeded ones, unmarked), and TX-09's
// Al Green, TX-32's Julie Johnson and S-TX's John Cornyn read `absent` at HO
// 759's STEP 0; HO 761 ingests the runoff boxes (lib/primaries-sync.ts,
// writeRunoffRounds), and its leg 3 reads the three as `lost_primary`.
import type { Client } from "@libsql/client";
import { findIncumbentOnBallot, tokenCheck, type BallotPerson } from "./ballot-incumbent";

export type IncumbentReason = "retiring" | "withdrew" | "lost_primary" | "absent";
export type IncumbentQualifier =
  | { kind: "moved"; raceId: string }
  | { kind: "senate"; raceId: string }
  | { kind: "none"; reason: IncumbentReason };

export type QualifierRace = {
  id: string;
  state: string;
  chamber: string;
  incumbentBioguideId: string | null;
  incumbentRunning: number | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  readStatus: string | null;
};
export type QualifierBallotRow = BallotPerson & { race_id: string; withdrawn: number };
export type QualifierPrimaryRow = { bioguide_id: string; name: string; status: string; decided: boolean };

// Every reading the rule could take for one race, before the order picks one:
// the legs read `reasons` whole, so an incumbent in two classes shows.
export type QualifierReading = {
  onOwnBallot: boolean;
  moved: string[];
  senate: string[];
  reasons: Exclude<IncumbentReason, "absent">[];
  qualifier: IncumbentQualifier | null;
};

export function readQualifier(
  race: QualifierRace,
  races: Map<string, { state: string; chamber: string }>,
  ballotByRace: Map<string, QualifierBallotRow[]>,
  ballotByBioguide: Map<string, QualifierBallotRow[]>,
  primariesByBioguide: Map<string, QualifierPrimaryRow[]>,
): QualifierReading | null {
  const bio = race.incumbentBioguideId;
  if (bio == null || race.readStatus !== "box") return null;
  const own = findIncumbentOnBallot(ballotByRace.get(race.id) ?? [], { bioguideId: bio, lastName: race.lastName });
  const onOwnBallot = own.row != null;
  const elsewhere = (ballotByBioguide.get(bio) ?? []).filter((g) => g.race_id !== race.id);
  const printed = elsewhere.filter((g) => g.on_ballot === 1).map((g) => g.race_id).sort();
  const moved = printed.filter((id) => {
    const r = races.get(id);
    return r != null && r.chamber === "house" && r.state === race.state;
  });
  const senate = printed.filter((id) => id.startsWith("S-"));
  const reasons: QualifierReading["reasons"] = [];
  if (race.incumbentRunning === 0) reasons.push("retiring");
  if ((ballotByBioguide.get(bio) ?? []).some((g) => g.withdrawn === 1)) reasons.push("withdrew");
  const member = { firstName: race.firstName, lastName: race.lastName, member: race.name ?? "" };
  if ((primariesByBioguide.get(bio) ?? []).some((p) => p.decided && p.status !== "winner" && tokenCheck(p.name, member).ok)) reasons.push("lost_primary");
  let qualifier: IncumbentQualifier | null = null;
  if (!onOwnBallot) {
    if (moved.length) qualifier = { kind: "moved", raceId: moved[0]! };
    else if (senate.length) qualifier = { kind: "senate", raceId: senate[0]! };
    else qualifier = { kind: "none", reason: reasons[0] ?? "absent" };
  }
  return { onOwnBallot, moved, senate, reasons, qualifier };
}

// The cycle's readings in one batch (the compact surfaces print every rated
// seat at once, so a per-race read would be a cache entry per row).
export async function readIncumbentQualifierReadings(db: Client, cycle: number): Promise<Map<string, QualifierReading>> {
  const [racesRs, ballotRs, primaryRs] = await db.batch(
    [
      {
        sql: `SELECT r.id, r.state, r.chamber, r.incumbent_bioguide_id, r.incumbent_running,
                     m.name, m.first_name, m.last_name, rd.status AS read_status
                FROM races r
                LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
                LEFT JOIN general_ballot_reads rd ON rd.race_id = r.id
               WHERE r.cycle = ?`,
        args: [cycle],
      },
      {
        sql: `SELECT g.race_id, g.person_key, g.name, g.bioguide_id, g.incumbent_marked, g.on_ballot, g.withdrawn
                FROM general_ballot g JOIN races r ON r.id = g.race_id
               WHERE r.cycle = ?`,
        args: [cycle],
      },
      {
        sql: `SELECT c.bioguide_id, c.name, c.status,
                     EXISTS (SELECT 1 FROM primary_candidates w WHERE w.primary_id = c.primary_id AND w.status = 'winner') AS decided
                FROM primary_candidates c JOIN primaries p ON p.id = c.primary_id
               WHERE c.bioguide_id IN (SELECT incumbent_bioguide_id FROM races WHERE cycle = ? AND incumbent_bioguide_id IS NOT NULL)
                 AND substr(p.primary_date, 1, 4) = ?`,
        args: [cycle, String(cycle)],
      },
    ],
    "read",
  );
  const str = (v: unknown) => (v == null ? null : String(v));
  const races: QualifierRace[] = racesRs!.rows.map((r) => ({
    id: String(r.id),
    state: String(r.state),
    chamber: String(r.chamber),
    incumbentBioguideId: str(r.incumbent_bioguide_id),
    // Only an explicit 0 is the curated retirement; NULL is no statement.
    incumbentRunning: r.incumbent_running == null ? null : Number(r.incumbent_running),
    name: str(r.name),
    firstName: str(r.first_name),
    lastName: str(r.last_name),
    readStatus: str(r.read_status),
  }));
  const byId = new Map(races.map((r) => [r.id, { state: r.state, chamber: r.chamber }]));
  const ballotByRace = new Map<string, QualifierBallotRow[]>();
  const ballotByBioguide = new Map<string, QualifierBallotRow[]>();
  for (const g of ballotRs!.rows) {
    const row: QualifierBallotRow = {
      race_id: String(g.race_id),
      person_key: String(g.person_key),
      name: String(g.name),
      bioguide_id: str(g.bioguide_id),
      incumbent_marked: Number(g.incumbent_marked),
      on_ballot: Number(g.on_ballot),
      withdrawn: Number(g.withdrawn),
    };
    (ballotByRace.get(row.race_id) ?? ballotByRace.set(row.race_id, []).get(row.race_id)!).push(row);
    if (row.bioguide_id) (ballotByBioguide.get(row.bioguide_id) ?? ballotByBioguide.set(row.bioguide_id, []).get(row.bioguide_id)!).push(row);
  }
  const primariesByBioguide = new Map<string, QualifierPrimaryRow[]>();
  for (const p of primaryRs!.rows) {
    const row: QualifierPrimaryRow = { bioguide_id: String(p.bioguide_id), name: String(p.name), status: String(p.status), decided: Number(p.decided) === 1 };
    (primariesByBioguide.get(row.bioguide_id) ?? primariesByBioguide.set(row.bioguide_id, []).get(row.bioguide_id)!).push(row);
  }
  const out = new Map<string, QualifierReading>();
  for (const race of races) {
    const reading = readQualifier(race, byId, ballotByRace, ballotByBioguide, primariesByBioguide);
    if (reading) out.set(race.id, reading);
  }
  return out;
}

// What the pages read: race id → qualifier, for the races that have one. A
// plain object, because unstable_cache JSON-serializes its result.
export async function readIncumbentQualifiers(db: Client, cycle: number): Promise<Record<string, IncumbentQualifier>> {
  const out: Record<string, IncumbentQualifier> = {};
  for (const [id, r] of await readIncumbentQualifierReadings(db, cycle)) if (r.qualifier) out[id] = r.qualifier;
  return out;
}
