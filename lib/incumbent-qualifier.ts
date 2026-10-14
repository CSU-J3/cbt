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
// HO 779 (Corey's ruling): a `moved` or `senate` kind carries its own race's
// OUTCOME, read from that race's marks the way its page reads its own
// (lib/race-result.ts): one marked printed row of a `box` read decides it, two
// or more are a runoff, none is not called. Their row marked: elected, or in
// the runoff; another's: lost, or out of the runoff. The read carries it
// whatever the clock; the merge points show it only once election day has
// passed (lib/incumbent-tag.ts incumbentTagAt).
// HO 779 (Corey's ruling): the `governor` kind, after `moved` and `senate`, before the
// reasons: the race's stored incumbent is on a November governor ballot by the
// curated list (data/governor-runs-2026.json, a source each; the ballots CBT
// reads hold no governor race). A kind beats the curated flag here as well:
// S-AL's Tuberville, curated incumbent_running = 0, reads RUNNING FOR GOVERNOR,
// not RETIRING.
// THE REASON, for `none` only, first match in this order:
//   retiring      the curated races.incumbent_running = 0 (HO 221);
//   withdrew      a row with their bioguide in any withdrawn block of the
//                 cycle (general_ballot.withdrawn = 1; the box's "Withdrawn or
//                 disqualified candidates" list, so a disqualification too);
//   lost_primary  an unmarked row (status 'running') in a decided primary of
//                 the cycle (one with a 'winner' row), matched by bioguide AND
//                 by name: primary_candidates.bioguide_id was assigned by a
//                 member match that let namesakes through (TX-22's "Trever
//                 Nehls" carried Troy Nehls's), so the printed name must also
//                 pass HO 751's name check (tokenCheck, lib/ballot-incumbent.ts:
//                 every surname token, and a first-name token whole or as a
//                 prefix of three letters or more either way). HO 764: the
//                 match is by identity or behind the underline now, and
//                 repair:primary-identity cleared the five namesakes; the check
//                 stays as the second guard. Identity also ties a House member
//                 on a SENATE primary's row, so one who lost a Senate primary
//                 reads lost_primary on the House seat (six at HO 764: IL-02,
//                 IL-08, MA-06, MI-11, TX-30, TX-38, each `absent` before).
//                 HO 773: a tie the page makes needs no name check. A row the
//                 page links to the member's own title (its person_key is
//                 titleKey of their resolved-or-stored title) or underlines
//                 in their seat (primary_candidates.incumbent) is the member,
//                 so it is `trusted`; the name check stays as the guard for a
//                 row tied any other way. TN-05's Andy Ogles, stored first name
//                 Andrew, read `absent` until HO 773, though his row is tied
//                 both ways;
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
import { titleKey } from "./ballotpedia-key";
import governorRuns2026 from "../data/governor-runs-2026.json";

export type IncumbentReason = "retiring" | "withdrew" | "lost_primary" | "absent";
// HO 779: how a `moved` or `senate` incumbent's own race went (above); absent
// while it is not called.
export type TagOutcome = "elected" | "lost" | "runoff" | "out_of_runoff";
export type IncumbentQualifier =
  | { kind: "moved"; raceId: string; outcome?: TagOutcome }
  | { kind: "senate"; raceId: string; outcome?: TagOutcome }
  // HO 779: `ran` is the clock's, set past election day at the merge points.
  | { kind: "governor"; state: string; ran?: boolean }
  | { kind: "none"; reason: IncumbentReason };

// HO 779: the curated list (data/governor-runs-2026.json): one entry per member,
// with its race, office, state, source and as-of.
export type GovernorRun = { race: string; bioguide: string; name: string; office: string; state: string; source: string; asOf: string };
export const GOVERNOR_RUNS: GovernorRun[] = governorRuns2026.entries.filter((e) => e.office === "governor");

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
export type QualifierBallotRow = BallotPerson & { race_id: string; withdrawn: number; marked: number };
// HO 783: a race's general runoff row (general_runoff), for a tag's outcome.
export type QualifierRunoffRow = { race_id: string; bioguide_id: string | null; on_ballot: number; marked: number };
export type QualifierRaceRef = { state: string; chamber: string; readStatus?: string | null };
// `trusted`: the page itself ties the row to the member, by identity (its
// person_key is the member's own title key) or by its underline (HO 773).
export type QualifierPrimaryRow = { bioguide_id: string; name: string; status: string; decided: boolean; trusted: boolean };

// Every reading the rule could take for one race, before the order picks one:
// the legs read `reasons` whole, so an incumbent in two classes shows.
export type QualifierReading = {
  onOwnBallot: boolean;
  moved: string[];
  senate: string[];
  governor: boolean; // HO 779: on the curated governor list for this race
  reasons: Exclude<IncumbentReason, "absent">[];
  qualifier: IncumbentQualifier | null;
};

export function readQualifier(
  race: QualifierRace,
  races: Map<string, QualifierRaceRef>,
  ballotByRace: Map<string, QualifierBallotRow[]>,
  ballotByBioguide: Map<string, QualifierBallotRow[]>,
  primariesByBioguide: Map<string, QualifierPrimaryRow[]>,
  governorRuns: GovernorRun[] = GOVERNOR_RUNS,
  // HO 783: each race's general runoff rows.
  runoffByRace: Map<string, QualifierRunoffRow[]> = new Map(),
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
  const governor = governorRuns.find((e) => e.race === race.id && e.bioguide === bio) ?? null;
  const reasons: QualifierReading["reasons"] = [];
  if (race.incumbentRunning === 0) reasons.push("retiring");
  if ((ballotByBioguide.get(bio) ?? []).some((g) => g.withdrawn === 1)) reasons.push("withdrew");
  const member = { firstName: race.firstName, lastName: race.lastName, member: race.name ?? "" };
  if ((primariesByBioguide.get(bio) ?? []).some((p) => p.decided && p.status !== "winner" && (p.trusted || tokenCheck(p.name, member).ok))) reasons.push("lost_primary");
  // HO 779: the outcome in the race they're printed in, by its marks.
  const outcomeIn = (raceId: string): TagOutcome | undefined => {
    // HO 783: a race decided in its general runoff, by that box's one mark.
    const won = (runoffByRace.get(raceId) ?? []).filter((g) => g.on_ballot === 1 && g.marked === 1);
    if (won.length === 1) return won[0]!.bioguide_id === bio ? "elected" : "lost";
    if (races.get(raceId)?.readStatus !== "box") return undefined;
    const marked = (ballotByRace.get(raceId) ?? []).filter((g) => g.on_ballot === 1 && g.marked === 1);
    if (marked.length === 0) return undefined;
    const theirs = marked.some((g) => g.bioguide_id === bio);
    if (marked.length === 1) return theirs ? "elected" : "lost";
    return theirs ? "runoff" : "out_of_runoff";
  };
  const withOutcome = <Q extends { kind: "moved" | "senate"; raceId: string }>(q: Q): Q & { outcome?: TagOutcome } => {
    const outcome = outcomeIn(q.raceId);
    return outcome ? { ...q, outcome } : q;
  };
  let qualifier: IncumbentQualifier | null = null;
  if (!onOwnBallot) {
    if (moved.length) qualifier = withOutcome({ kind: "moved", raceId: moved[0]! });
    else if (senate.length) qualifier = withOutcome({ kind: "senate", raceId: senate[0]! });
    else if (governor) qualifier = { kind: "governor", state: governor.state };
    else qualifier = { kind: "none", reason: reasons[0] ?? "absent" };
  }
  return { onOwnBallot, moved, senate, governor: governor != null, reasons, qualifier };
}

// The cycle's readings in one batch (the compact surfaces print every rated
// seat at once, so a per-race read would be a cache entry per row).
export async function readIncumbentQualifierReadings(db: Client, cycle: number): Promise<Map<string, QualifierReading>> {
  const [racesRs, ballotRs, primaryRs, runoffRs] = await db.batch(
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
        sql: `SELECT g.race_id, g.person_key, g.name, g.bioguide_id, g.incumbent_marked, g.on_ballot, g.withdrawn, g.marked
                FROM general_ballot g JOIN races r ON r.id = g.race_id
               WHERE r.cycle = ?`,
        args: [cycle],
      },
      {
        sql: `SELECT c.bioguide_id, c.name, c.status, c.person_key, c.incumbent,
                     COALESCE(NULLIF(TRIM(mi.ballotpedia_title_resolved), ''), mi.ballotpedia_title) AS title,
                     EXISTS (SELECT 1 FROM primary_candidates w WHERE w.primary_id = c.primary_id AND w.status = 'winner') AS decided
                FROM primary_candidates c JOIN primaries p ON p.id = c.primary_id
                LEFT JOIN member_ids mi ON mi.bioguide_id = c.bioguide_id
               WHERE c.bioguide_id IN (SELECT incumbent_bioguide_id FROM races WHERE cycle = ? AND incumbent_bioguide_id IS NOT NULL)
                 AND substr(p.primary_date, 1, 4) = ?`,
        args: [cycle, String(cycle)],
      },
      {
        sql: `SELECT ro.race_id, ro.bioguide_id, ro.on_ballot, ro.marked
                FROM general_runoff ro JOIN races r ON r.id = ro.race_id
               WHERE r.cycle = ?`,
        args: [cycle],
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
  const byId = new Map(races.map((r) => [r.id, { state: r.state, chamber: r.chamber, readStatus: r.readStatus }]));
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
      marked: Number(g.marked ?? 0),
    };
    (ballotByRace.get(row.race_id) ?? ballotByRace.set(row.race_id, []).get(row.race_id)!).push(row);
    if (row.bioguide_id) (ballotByBioguide.get(row.bioguide_id) ?? ballotByBioguide.set(row.bioguide_id, []).get(row.bioguide_id)!).push(row);
  }
  const primariesByBioguide = new Map<string, QualifierPrimaryRow[]>();
  for (const p of primaryRs!.rows) {
    const title = p.title == null ? "" : String(p.title).trim();
    const byIdentity = p.person_key != null && title !== "" && String(p.person_key) === titleKey(title);
    const row: QualifierPrimaryRow = {
      bioguide_id: String(p.bioguide_id),
      name: String(p.name),
      status: String(p.status),
      decided: Number(p.decided) === 1,
      trusted: byIdentity || Number(p.incumbent) === 1,
    };
    (primariesByBioguide.get(row.bioguide_id) ?? primariesByBioguide.set(row.bioguide_id, []).get(row.bioguide_id)!).push(row);
  }
  const runoffByRace = new Map<string, QualifierRunoffRow[]>();
  for (const g of runoffRs!.rows) {
    const row: QualifierRunoffRow = { race_id: String(g.race_id), bioguide_id: str(g.bioguide_id), on_ballot: Number(g.on_ballot), marked: Number(g.marked ?? 0) };
    (runoffByRace.get(row.race_id) ?? runoffByRace.set(row.race_id, []).get(row.race_id)!).push(row);
  }
  const out = new Map<string, QualifierReading>();
  for (const race of races) {
    const reading = readQualifier(race, byId, ballotByRace, ballotByBioguide, primariesByBioguide, GOVERNOR_RUNS, runoffByRace);
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
