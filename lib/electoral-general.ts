// HO 767 — THE GENERAL-WINDOW READS FOR /electoral's LIST, batched for the page
// (mock-767 v18, ruled "as set"). Pure of Next, so the legs call what the page
// runs; lib/queries.ts caches each read. Six reads, each one statement batch
// for the whole page, never a query per row:
//
//   readGeneralBallots   every rated seat's ballot as the race page prints it:
//                        the stored incumbent when the incumbent rule
//                        (lib/ballot-incumbent.ts) finds them on their own
//                        ballot, then the roster (race_candidates, the race
//                        page's own ladder, `on_ballot` rows included: the one
//                        reader that carries them was getRaceRoster, per race).
//                        Each name carries how it got there, its primary or
//                        runoff date and share (the seat's rounds, keyed by
//                        lib/runoff-seat.ts: primaries.race_id is never
//                        written), and the sitting members on the ballot: the
//                        union of ballot identity (general_ballot.bioguide_id
//                        on a printed row) and HO 759's onOwnBallot, so S-AK's
//                        Sullivan, whose row has no bioguide, comes in through
//                        the second. The special-election line is the box's
//                        own words (general_ballot.box_prefix, R9).
//   readMemberFacts      what the member page knows about each of them: FEC
//                        totals, the 119th's missed votes (member_votes, the
//                        member page's own read, R10), DW-NOMINATE, bills
//                        sponsored and enacted, the tracker's grade.
//   readBallotNews       the observations about those members in a window (R2:
//                        no SEAT_NEWS_TERMS filter, no LIMIT; the page cuts
//                        each row to five).
//   readPalestinePools   the tracker's pool per chamber and its sync date.
//   readRaceResults      HO 758's reading for every rated seat, with the marked
//                        rows (lib/race-result.ts resultFromRows), for the day
//                        after.
//   readRecentRaceMoves  (HO 768) each race's newest rating move that the MOVED
//                        guard passes (lib/move-freshness.ts); the dashboard's
//                        race cards read it too.
import type { Client, InValue } from "@libsql/client";
import { findIncumbentOnBallot, normName, type BallotPerson } from "./ballot-incumbent";
import { senateClassForCycle } from "./derive-term";
import {
  isFreshMove,
  type GuardHorizons,
  type HistoryRunRow,
  type MoveChamber,
  type SyncRunRow,
} from "./move-freshness";
import { PALESTINE_POOLS_KEY } from "./palestine-config";
import type { RaceMove } from "./queries";
import { surname } from "./race-colors";
import { resultFromRows, type MarkedRow, type RaceResultReading } from "./race-result";
import { RUNOFF_SEAT_JOIN } from "./runoff-seat";

// A rated seat of the cycle: one with a rating row of its own cycle, as
// getRacesIndex's INNER JOIN reads it.
const RATED = `EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = r.cycle)`;

// How a name got onto the ballot, in the race page's vocabulary
// (components/RaceCandidates.tsx statusLabel), plus the incumbent's own card.
export type BallotHow =
  | "incumbent"
  | "won_primary"
  | "advanced"
  | "nominee"
  | "on_ballot"
  | "running"
  | "declared";

export type BallotRunoff = {
  date: string; // ISO, the runoff round's date
  pct: number | null; // the winner's share
  loser: string | null; // the runner-up, as the round prints them
  loserPct: number | null;
};

export type BallotEntry = {
  key: string; // stable within the race: the ballot row's person_key, else the roster name
  name: string; // in full, as the roster (or, for the incumbent, the ballot) prints it
  surname: string;
  party: string | null; // one letter: D R I L G O
  printedParty: string | null; // the ballot's print: a fusion line, or an O row's party name
  how: BallotHow;
  primaryDate: string | null; // ISO, for won_primary / advanced
  runoff: BallotRunoff | null; // a runoff this name won, in this seat's rounds
  bioguideId: string | null; // set only for a sitting member
  incumbent: boolean;
  major: boolean; // nominated, advanced, or the incumbent: what the row leads with
  ballotKey: string | null; // general_ballot.person_key, for the day-after marks
};

export type GeneralRace = {
  raceId: string;
  readStatus: string | null;
  // The box's <h5> words when they name a special ("Special general election").
  special: { label: string; termEnds: number | null } | null;
  // The stored incumbent on their own printed ballot: true / false, or null
  // with no `box` read (nothing says either way).
  incumbentOnBallot: boolean | null;
  entries: BallotEntry[];
  withdrew: { name: string; party: string | null }[];
  memberIds: string[]; // sitting members on this ballot, the incumbent first
  holder: { bioguideId: string; lastName: string | null; senateClass: number | null } | null;
  raterDates: Record<string, string | null>; // rater source → rating_date (race_ratings)
};

export type GeneralBallots = {
  races: Record<string, GeneralRace>;
  // Every sitting member on a rated ballot, and every seat holder who is off
  // theirs (their grade and face print on SEAT HELD BY): the member-facts key.
  memberIds: string[];
};

const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number(v));

// getRaceRoster's matcher (lib/queries.ts): first and last token after the
// census normalization, generational suffixes dropped.
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
export function firstLast(s: string): string {
  const t = normName(s)
    .split(" ")
    .filter((x) => x && !SUFFIXES.has(x));
  return `${t[0] ?? ""} ${t[t.length - 1] ?? ""}`;
}

// getRaceRoster's ladder: rung 0 the nominated (won_primary, nominee,
// advanced), then running, declared, on_ballot, withdrew.
const NOMINATED = new Set(["won_primary", "nominee", "advanced"]);
const RUNG_SQL = `CASE
    WHEN status IN ('won_primary', 'nominee', 'advanced') THEN 0
    WHEN status = 'running' THEN 1
    WHEN status = 'declared' THEN 2
    WHEN status = 'on_ballot' THEN 3
    WHEN status = 'withdrew' THEN 4
    ELSE 5
  END`;

type BallotRow = BallotPerson & {
  party: string | null;
  printed_party: string | null;
  withdrawn: number;
  marked: number;
  box_prefix: string | null;
  current: boolean;
};
type RoundCandidate = { name: string; bioguideId: string | null; status: string; votePct: number | null };
type Round = { id: string; party: string; date: string | null; round: string; special: boolean; candidates: RoundCandidate[] };

// A primary-candidate row is this ballot name: by bioguide when both carry
// one, else by first and last name.
function sameCandidate(c: RoundCandidate, name: string, bioguideId: string | null): boolean {
  if (bioguideId && c.bioguideId) return c.bioguideId === bioguideId;
  return firstLast(c.name) === firstLast(name);
}

// The year a special's winner serves to (R9): the next regular election year
// after the cycle whose class is the holder's, plus one (its January).
export function specialTermEnds(cycle: number, senateClass: number | null): number | null {
  if (senateClass == null) return null;
  for (let y = cycle + 1; y <= cycle + 6; y++) if (senateClassForCycle(y) === senateClass) return y + 1;
  return null;
}

export async function readGeneralBallots(db: Client, cycle: number): Promise<GeneralBallots> {
  const [racesRs, rosterRs, ballotRs, roundsRs, ratersRs] = await db.batch(
    [
      {
        sql: `SELECT r.id, r.chamber, r.incumbent_bioguide_id, r.incumbent_running,
                     m.last_name, m.senate_class, rd.status AS read_status
                FROM races r
                LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
                LEFT JOIN general_ballot_reads rd ON rd.race_id = r.id
               WHERE r.cycle = ? AND ${RATED}`,
        args: [cycle],
      },
      {
        sql: `SELECT race_id, name, party, printed_party, bioguide_id, status
                FROM race_candidates
               WHERE race_id IN (SELECT r.id FROM races r WHERE r.cycle = ? AND ${RATED})
               ORDER BY race_id, ${RUNG_SQL}, name ASC`,
        args: [cycle],
      },
      {
        sql: `SELECT g.race_id, g.person_key, g.name, g.party, g.printed_party, g.bioguide_id,
                     g.incumbent_marked, g.on_ballot, g.withdrawn, g.marked, g.box_prefix,
                     COALESCE(m.is_current, 0) AS is_current
                FROM general_ballot g
                LEFT JOIN members m ON m.bioguide_id = g.bioguide_id
               WHERE g.race_id IN (SELECT r.id FROM races r WHERE r.cycle = ? AND ${RATED})`,
        args: [cycle],
      },
      {
        // Every round of each rated seat, first rounds and runoffs alike, by
        // the seat key HO 763 made the one key (lib/runoff-seat.ts).
        sql: `SELECT r.id AS race_id, p.id, p.party, p.primary_date, p.election_round,
                     pc.name, pc.bioguide_id, pc.status, pc.vote_pct
                FROM races r
                JOIN primaries p ON ${RUNOFF_SEAT_JOIN}
                LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
               WHERE r.cycle = ? AND ${RATED}
               ORDER BY r.id, p.primary_date, p.id`,
        args: [cycle],
      },
      {
        sql: `SELECT race_id, source, rating_date FROM race_ratings
               WHERE cycle = ? AND race_id IN (SELECT r.id FROM races r WHERE r.cycle = ? AND ${RATED})`,
        args: [cycle, cycle],
      },
    ],
    "read",
  );

  const group = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
    return m;
  };

  const rosterByRace = group(
    rosterRs!.rows.map((r) => ({
      race_id: String(r.race_id),
      name: String(r.name),
      party: str(r.party),
      printed_party: str(r.printed_party),
      bioguide_id: str(r.bioguide_id),
      status: str(r.status),
    })),
    (r) => r.race_id,
  );
  const ballotByRace = group(
    ballotRs!.rows.map(
      (g): BallotRow & { race_id: string } => ({
        race_id: String(g.race_id),
        person_key: String(g.person_key),
        name: String(g.name),
        party: str(g.party),
        printed_party: str(g.printed_party),
        bioguide_id: str(g.bioguide_id),
        incumbent_marked: Number(g.incumbent_marked),
        on_ballot: Number(g.on_ballot),
        withdrawn: Number(g.withdrawn),
        marked: Number(g.marked ?? 0),
        box_prefix: str(g.box_prefix),
        current: Number(g.is_current) === 1,
      }),
    ),
    (r) => r.race_id,
  );
  const roundsByRace = new Map<string, Round[]>();
  for (const r of roundsRs!.rows) {
    const raceId = String(r.race_id);
    const rounds = roundsByRace.get(raceId) ?? roundsByRace.set(raceId, []).get(raceId)!;
    let round = rounds.find((x) => x.id === String(r.id));
    if (!round) {
      round = {
        id: String(r.id),
        party: String(r.party),
        date: str(r.primary_date),
        round: String(r.election_round ?? "primary"),
        special: String(r.id).includes("-special-"),
        candidates: [],
      };
      rounds.push(round);
    }
    if (r.name != null)
      round.candidates.push({ name: String(r.name), bioguideId: str(r.bioguide_id), status: String(r.status ?? "running"), votePct: num(r.vote_pct) });
  }
  const raterDates = new Map<string, Record<string, string | null>>();
  for (const r of ratersRs!.rows) {
    const id = String(r.race_id);
    (raterDates.get(id) ?? raterDates.set(id, {}).get(id)!)[String(r.source)] = str(r.rating_date);
  }

  const races: Record<string, GeneralRace> = {};
  const memberSet = new Set<string>();
  for (const r of racesRs!.rows) {
    const raceId = String(r.id);
    const readStatus = str(r.read_status);
    const incBio = str(r.incumbent_bioguide_id);
    const ballot = ballotByRace.get(raceId) ?? [];
    const printed = ballot.filter((b) => b.on_ballot === 1);
    const rounds = roundsByRace.get(raceId) ?? [];
    const firstRounds = rounds.filter((x) => x.round !== "runoff");
    const runoffs = rounds.filter((x) => x.round === "runoff");

    // HO 759's onOwnBallot: decided only on a `box` read.
    const found = incBio && readStatus === "box" ? findIncumbentOnBallot(ballot, { bioguideId: incBio, lastName: str(r.last_name) }) : null;
    const incumbentOnBallot = incBio == null || readStatus !== "box" ? null : found!.row != null;

    const wonRunoff = (name: string, bio: string | null): BallotRunoff | null => {
      for (const ro of runoffs) {
        const w = ro.candidates.find((c) => c.status === "winner" && sameCandidate(c, name, bio));
        if (!w || !ro.date) continue;
        const loser = ro.candidates
          .filter((c) => c !== w)
          .sort((a, b) => (b.votePct ?? -1) - (a.votePct ?? -1))[0];
        return { date: ro.date, pct: w.votePct, loser: loser?.name ?? null, loserPct: loser?.votePct ?? null };
      }
      return null;
    };
    // The first round a nominated name came through: the round of its party
    // (the 'open' round for a top-two/four advancer) where it is marked, else
    // the seat's regular round of that party.
    const primaryDate = (how: string, party: string | null, name: string, bio: string | null): string | null => {
      if (how !== "won_primary" && how !== "advanced") return null;
      const want = how === "advanced" ? "open" : party;
      const mine = firstRounds.filter((x) => x.party === want);
      const won = mine.find((x) => x.candidates.some((c) => c.status === "winner" && sameCandidate(c, name, bio)));
      return (won ?? mine.find((x) => !x.special) ?? mine[0])?.date ?? null;
    };

    const entries: BallotEntry[] = [];
    if (found?.row) {
      const row = found.row;
      const bio = incBio!;
      entries.push({
        key: row.person_key,
        name: row.name,
        surname: str(r.last_name) ?? surname(row.name),
        party: row.party,
        printedParty: row.printed_party && row.printed_party !== row.party ? row.printed_party : null,
        how: "incumbent",
        primaryDate: null,
        runoff: wonRunoff(row.name, bio),
        bioguideId: bio,
        incumbent: true,
        major: true,
        ballotKey: row.person_key,
      });
    }
    const withdrew: GeneralRace["withdrew"] = [];
    const used = new Set<string>();
    for (const c of rosterByRace.get(raceId) ?? []) {
      if (c.status === "withdrew") {
        withdrew.push({ name: c.name, party: c.party });
        continue;
      }
      // The ballot row this roster name is: by name and identity, else the one
      // printed row with the same first and last name (getRaceRoster's rule).
      const byName = printed.filter((b) => !used.has(b.person_key) && firstLast(b.name) === firstLast(c.name));
      const g =
        printed.find((b) => !used.has(b.person_key) && b.name === c.name && (c.bioguide_id == null || b.bioguide_id === c.bioguide_id)) ??
        (byName.length === 1 ? byName[0]! : null);
      if (g) used.add(g.person_key);
      const bio = g?.bioguide_id && g.current ? g.bioguide_id : null;
      const how = (c.status ?? "on_ballot") as BallotHow;
      entries.push({
        key: g?.person_key ?? `roster:${c.name}`,
        name: c.name,
        surname: surname(c.name),
        party: c.party,
        printedParty: c.printed_party,
        how,
        primaryDate: primaryDate(how, c.party, c.name, bio ?? c.bioguide_id),
        runoff: NOMINATED.has(how) ? wonRunoff(c.name, bio ?? c.bioguide_id) : null,
        bioguideId: bio,
        incumbent: false,
        major: NOMINATED.has(how) || how === "running" || how === "declared",
        ballotKey: g?.person_key ?? null,
      });
    }

    // The members on this ballot: ballot identity on a printed row, and the
    // stored incumbent where the incumbent rule finds them (R1's union).
    const memberIds: string[] = [];
    if (found?.row) memberIds.push(incBio!);
    for (const b of printed) if (b.bioguide_id && b.current && !memberIds.includes(b.bioguide_id)) memberIds.push(b.bioguide_id);
    for (const id of memberIds) memberSet.add(id);
    if (incBio && incumbentOnBallot === false) memberSet.add(incBio);

    const prefix = ballot.find((b) => b.box_prefix)?.box_prefix ?? null;
    races[raceId] = {
      raceId,
      readStatus,
      special:
        prefix && /special/i.test(prefix)
          ? { label: prefix, termEnds: String(r.chamber) === "senate" ? specialTermEnds(cycle, num(r.senate_class)) : null }
          : null,
      incumbentOnBallot,
      entries,
      withdrew,
      memberIds,
      holder: incBio ? { bioguideId: incBio, lastName: str(r.last_name), senateClass: num(r.senate_class) } : null,
      raterDates: raterDates.get(raceId) ?? {},
    };
  }
  return { races, memberIds: [...memberSet].sort() };
}

// ---- What the member page knows, for the members on the ballots ----------

export type MemberFacts = {
  bioguideId: string;
  name: string;
  lastName: string | null;
  party: string | null;
  chamber: string | null;
  state: string | null;
  district: number | null;
  birthYear: number | null;
  depictionUrl: string | null;
  tookOffice: number | null; // the earliest term's startYear (terms_json), as the row's incumbentFirstElected
  fundraising: {
    cycle: number;
    raised: number | null; // cents
    cashOnHand: number | null;
    smallPct: number | null; // MemberFundraisingLine's split: small / (small + large)
    coverageEnd: string | null;
    sourceUrl: string | null;
    isSenateCampaign: boolean; // HO 416: a House member whose committee is a Senate one
  } | null;
  // getMemberVoteStats' figure: not_voting / total over the 119th's roll calls.
  missed: { pct: number; total: number } | null;
  dim1: number | null;
  sponsored: number;
  enacted: number;
  grade: { grade: string; rank: number | null; total: string | null; sponsor: string | null; voting: string | null } | null;
};

function earliestStartYear(termsJson: string | null): number | null {
  if (!termsJson) return null;
  try {
    const terms = JSON.parse(termsJson) as Array<{ startYear?: unknown }>;
    const years = terms.map((t) => Number(t.startYear)).filter((y) => Number.isFinite(y) && y > 0);
    return years.length ? Math.min(...years) : null;
  } catch {
    return null;
  }
}

export async function readMemberFacts(db: Client, bioguideIds: string[], congress: number): Promise<Record<string, MemberFacts>> {
  if (bioguideIds.length === 0) return {};
  const ph = bioguideIds.map(() => "?").join(",");
  const ids: InValue[] = bioguideIds;
  const [mRs, fRs, iRs, bRs, vRs, sRs] = await db.batch(
    [
      {
        sql: `SELECT bioguide_id, name, last_name, party, chamber, state, district, birth_year,
                     depiction_url, terms_json, fec_candidate_id
                FROM members WHERE bioguide_id IN (${ph})`,
        args: ids,
      },
      {
        // getMemberFundraising's row: the member's most recent cycle.
        sql: `SELECT mf.bioguide_id, mf.cycle, mf.total_raised, mf.cash_on_hand, mf.coverage_end_date,
                     mf.source_url, mf.small_dollar, mf.large_dollar
                FROM member_fundraising mf
               WHERE mf.bioguide_id IN (${ph})
                 AND mf.cycle = (SELECT MAX(m2.cycle) FROM member_fundraising m2 WHERE m2.bioguide_id = mf.bioguide_id)`,
        args: ids,
      },
      { sql: `SELECT bioguide_id, nominate_dim1 FROM member_ideology WHERE bioguide_id IN (${ph})`, args: ids },
      {
        // getMemberStats' figures: non-ceremonial bills sponsored, and enacted.
        sql: `SELECT sponsor_bioguide_id AS b, COUNT(*) AS sponsored,
                     SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted
                FROM bills
               WHERE sponsor_bioguide_id IN (${ph}) AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
               GROUP BY sponsor_bioguide_id`,
        args: ids,
      },
      {
        // getMemberVoteStats' figure, batched (R10): the member page's own read.
        sql: `SELECT bioguide_id, COUNT(*) AS total,
                     SUM(CASE WHEN position = 'not_voting' THEN 1 ELSE 0 END) AS not_voting
                FROM member_votes
               WHERE bioguide_id IN (${ph}) AND vote_id IN (SELECT id FROM votes WHERE congress = ?)
               GROUP BY bioguide_id`,
        args: [...ids, congress],
      },
      { sql: `SELECT bioguide_id, grade, rank, total_score, sponsor_score, voting_score FROM palestine_scorecard WHERE bioguide_id IN (${ph})`, args: ids },
    ],
    "read",
  );
  const byId = <T>(rows: T[], key: (r: T) => string) => new Map(rows.map((r) => [key(r), r]));
  const f = byId(fRs!.rows, (r) => String(r.bioguide_id));
  const ideo = byId(iRs!.rows, (r) => String(r.bioguide_id));
  const bills = byId(bRs!.rows, (r) => String(r.b));
  const votes = byId(vRs!.rows, (r) => String(r.bioguide_id));
  const grades = byId(sRs!.rows, (r) => String(r.bioguide_id));
  const out: Record<string, MemberFacts> = {};
  for (const m of mRs!.rows) {
    const id = String(m.bioguide_id);
    const fr = f.get(id);
    const v = votes.get(id);
    const total = Number(v?.total ?? 0);
    const b = bills.get(id);
    const g = grades.get(id);
    const small = num(fr?.small_dollar);
    const large = num(fr?.large_dollar);
    const split = (small ?? 0) + (large ?? 0);
    out[id] = {
      bioguideId: id,
      name: String(m.name),
      lastName: str(m.last_name),
      party: str(m.party),
      chamber: str(m.chamber),
      state: str(m.state),
      district: num(m.district),
      birthYear: num(m.birth_year),
      depictionUrl: str(m.depiction_url),
      tookOffice: earliestStartYear(str(m.terms_json)),
      fundraising: fr
        ? {
            cycle: Number(fr.cycle),
            raised: num(fr.total_raised),
            cashOnHand: num(fr.cash_on_hand),
            smallPct: small != null && large != null && split > 0 ? Math.round((small / split) * 100) : null,
            coverageEnd: str(fr.coverage_end_date),
            sourceUrl: str(fr.source_url),
            isSenateCampaign: m.chamber === "house" && (str(m.fec_candidate_id) ?? "").startsWith("S"),
          }
        : null,
      missed: total > 0 ? { pct: Math.round((Number(v?.not_voting ?? 0) / total) * 100), total } : null,
      dim1: num(ideo.get(id)?.nominate_dim1),
      sponsored: Number(b?.sponsored ?? 0),
      enacted: Number(b?.enacted ?? 0),
      grade: g?.grade
        ? { grade: String(g.grade), rank: num(g.rank), total: str(g.total_score), sponsor: str(g.sponsor_score), voting: str(g.voting_score) }
        : null,
    };
  }
  return out;
}

// ---- The news about the members on the ballots (R2) -----------------------

export type BallotNewsItem = {
  obsId: string;
  title: string;
  publisher: string;
  url: string;
  observedAt: string;
  bioguides: string[];
};

// readObservationNews' projection (lib/queries.ts), with a time window in place
// of its LIMIT and no title filter: the page cuts each row to five and the
// RACE NEWS column to seven days.
export async function readBallotNews(db: Client, bioguideIds: string[], sinceIso: string): Promise<BallotNewsItem[]> {
  if (bioguideIds.length === 0) return [];
  const rs = await db.execute({
    sql: `SELECT o.obs_id, o.title,
                 json_extract(o.source, '$.publisher') AS publisher,
                 json_extract(o.source, '$.url') AS url,
                 o.observed_at,
                 GROUP_CONCAT(DISTINCT oe.entity_value) AS entity_values
            FROM observation_entities oe
            JOIN observations o ON o.obs_id = oe.obs_id
           WHERE oe.entity_type = 'person'
             AND oe.entity_value IN (${bioguideIds.map(() => "?").join(",")})
             AND o.observed_at >= ?
           GROUP BY o.obs_id
           ORDER BY o.observed_at DESC`,
    args: [...bioguideIds, sinceIso],
  });
  return rs.rows
    .map((r) => ({
      obsId: String(r.obs_id),
      title: String(r.title),
      publisher: str(r.publisher) ?? "",
      url: str(r.url) ?? "",
      observedAt: String(r.observed_at),
      bioguides: String(r.entity_values ?? "")
        .split(",")
        .filter((b) => b.length > 0),
    }))
    .filter((n) => n.url.length > 0);
}

// ---- The tracker's pools ---------------------------------------------------

export type PalestinePools = { senate: number; house: number; syncedAt: string | null };

// The grade's "#N of {pool}". HO 768: the pool is the graded rows the sync last
// read off each chamber's tab (dashboard_state PALESTINE_POOLS_KEY, written by
// `npm run sync:palestine -- --write`), not the rows it matched, so a member
// the matcher misses never shrinks the denominator. Where the key has no count
// for a chamber, the table's rows per chamber of the member they score (the
// table holds no chamber of its own), as before. syncedAt is the last sync.
export async function readPalestinePools(db: Client): Promise<PalestinePools> {
  const [rs, ks] = await db.batch(
    [
      `SELECT m.chamber AS chamber, COUNT(*) AS n, MAX(ps.synced_at) AS synced
         FROM palestine_scorecard ps JOIN members m ON m.bioguide_id = ps.bioguide_id
        GROUP BY m.chamber`,
      { sql: `SELECT value FROM dashboard_state WHERE key = ?`, args: [PALESTINE_POOLS_KEY] },
    ],
    "read",
  );
  let senate = 0;
  let house = 0;
  let syncedAt: string | null = null;
  for (const r of rs!.rows) {
    if (r.chamber === "senate") senate = Number(r.n);
    if (r.chamber === "house") house = Number(r.n);
    const s = str(r.synced);
    if (s && (!syncedAt || s > syncedAt)) syncedAt = s;
  }
  const read = trackerPools(str(ks!.rows[0]?.value));
  return { senate: read.senate ?? senate, house: read.house ?? house, syncedAt };
}

// The key's graded count per chamber, or null where it carries none (a
// missing key, a malformed value, a count that isn't a positive integer).
function trackerPools(value: string | null): { senate: number | null; house: number | null } {
  let v: unknown = null;
  try {
    v = value == null ? null : JSON.parse(value);
  } catch {
    v = null;
  }
  const graded = (c: "senate" | "house"): number | null => {
    const n = (v as Record<string, { graded?: unknown } | undefined> | null)?.[c]?.graded;
    return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
  };
  return { senate: graded("senate"), house: graded("house") };
}

// ---- HO 758's reading for every rated seat ----------------------------------

export type RaceResultWithMarks = RaceResultReading & { marks: MarkedRow[] };

// readRaceResult's reading, batched: the same four reads over the cycle's
// rated seats, each race's rows handed to resultFromRows (lib/race-result.ts),
// the one function the race page's reading runs too.
export async function readRaceResults(db: Client, cycle: number): Promise<Record<string, RaceResultWithMarks>> {
  const [raceRs, readRs, rowsRs, jungleRs, runoffRs] = await db.batch(
    [
      {
        sql: `SELECT r.id, r.incumbent_bioguide_id, m.last_name, r.state, r.cycle
                FROM races r LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
               WHERE r.cycle = ? AND ${RATED}`,
        args: [cycle],
      },
      {
        sql: `SELECT rd.race_id, rd.status, rd.read_at FROM general_ballot_reads rd
               WHERE rd.race_id IN (SELECT r.id FROM races r WHERE r.cycle = ? AND ${RATED})`,
        args: [cycle],
      },
      {
        sql: `SELECT g.race_id, g.person_key, g.name, g.party, g.bioguide_id, g.incumbent_marked, g.on_ballot, g.marked
                FROM general_ballot g
               WHERE g.race_id IN (SELECT r.id FROM races r WHERE r.cycle = ? AND ${RATED})`,
        args: [cycle],
      },
      {
        sql: `SELECT r.id AS race_id, p.runoff_date, p.updated_at, pc.name, pc.party, pc.bioguide_id, pc.status
                FROM races r
                JOIN primaries p
                  ON p.state = r.state AND p.chamber = r.chamber
                 AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
                 AND p.primary_type = 'jungle' AND p.election_round IS NOT 'runoff'
                JOIN primary_candidates pc ON pc.primary_id = p.id
               WHERE r.cycle = ? AND ${RATED}`,
        args: [cycle],
      },
      {
        // HO 783: each rated seat's general runoff rows.
        sql: `SELECT ro.race_id, ro.person_key, ro.name, ro.party, ro.bioguide_id, ro.incumbent_marked, ro.on_ballot, ro.marked, ro.box_date, ro.read_at
                FROM general_runoff ro
               WHERE ro.race_id IN (SELECT r.id FROM races r WHERE r.cycle = ? AND ${RATED})`,
        args: [cycle],
      },
    ],
    "read",
  );
  const groupRows = <T extends Record<string, unknown>>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const id = String(r.race_id);
      (m.get(id) ?? m.set(id, []).get(id)!).push(r);
    }
    return m;
  };
  const reads = new Map(readRs!.rows.map((r) => [String(r.race_id), r]));
  const rows = groupRows(rowsRs!.rows as unknown as Record<string, unknown>[]);
  const jungle = groupRows(jungleRs!.rows as unknown as Record<string, unknown>[]);
  const runoff = groupRows(runoffRs!.rows as unknown as Record<string, unknown>[]);
  const out: Record<string, RaceResultWithMarks> = {};
  for (const r of raceRs!.rows) {
    const id = String(r.id);
    out[id] = resultFromRows(
      r.incumbent_bioguide_id == null ? null : { bioguideId: String(r.incumbent_bioguide_id), lastName: str(r.last_name) },
      reads.get(id) ?? null,
      rows.get(id) ?? [],
      jungle.get(id) ?? [],
      runoff.get(id) ?? [],
      { state: String(r.state), cycle: Number(r.cycle) },
    );
  }
  return out;
}

// ---- HO 768: each race's newest move the MOVED guard passes ----------------

// getRecentRaceMoves's read (lib/queries.ts caches it; /electoral's rows and the
// dashboard's race cards both read it), here so the legs run what the page
// runs. One batch: every post-baseline move for the ids, newest first per race,
// not just the newest (a race whose newest move fails the guard shows its
// newest move that passes, and a race with none has no entry); the ratings
// sync's runs; the rating-history tick's successes; each route's first run.
// lib/move-freshness.ts holds the rule. A move is any rating_history row later
// than its (race, source) pair's first, which is the baseline (HO 272/684); the
// order within a race is HO 684's, observed_at then source, both descending.
export const RATINGS_SYNC_ROUTE = "/api/sync-race-ratings";
export const RATING_HISTORY_ROUTE = "/api/cron/rating-history";

export async function readRecentRaceMoves(db: Client, raceIds: string[]): Promise<Record<string, RaceMove>> {
  if (raceIds.length === 0) return {};
  const placeholders = raceIds.map(() => "?").join(",");
  const [movesRs, syncRs, histRs, firstRs] = await db.batch(
    [
      {
        sql: `WITH h AS (
                SELECT rh.race_id, rh.source, rh.rating, rh.observed_at,
                       LAG(rh.rating) OVER (
                         PARTITION BY rh.race_id, rh.source ORDER BY rh.observed_at
                       ) AS prev_rating,
                       MIN(rh.observed_at) OVER (
                         PARTITION BY rh.race_id, rh.source
                       ) AS baseline_at
                FROM rating_history rh
                WHERE rh.race_id IN (${placeholders})
              )
              SELECT race_id, observed_at, source, rating AS to_rating, prev_rating AS from_rating
                FROM h
               WHERE observed_at > baseline_at
               ORDER BY race_id, observed_at DESC, source DESC`,
        args: raceIds,
      },
      {
        sql: `SELECT started_at, status, payload FROM cron_runs WHERE route = ? ORDER BY started_at, id`,
        args: [RATINGS_SYNC_ROUTE],
      },
      {
        sql: `SELECT started_at, status FROM cron_runs WHERE route = ? AND status = 'success' ORDER BY started_at, id`,
        args: [RATING_HISTORY_ROUTE],
      },
      {
        sql: `SELECT route, MIN(started_at) AS first FROM cron_runs WHERE route IN (?, ?) GROUP BY route`,
        args: [RATINGS_SYNC_ROUTE, RATING_HISTORY_ROUTE],
      },
    ],
    "read",
  );
  const syncRuns: SyncRunRow[] = syncRs!.rows.map((r) => ({
    startedAt: String(r.started_at),
    status: String(r.status),
    payload: str(r.payload),
  }));
  const historyRuns: HistoryRunRow[] = histRs!.rows.map((r) => ({ startedAt: String(r.started_at), status: String(r.status) }));
  const firstOf = (route: string) => str(firstRs!.rows.find((r) => r.route === route)?.first);
  const horizons: GuardHorizons = { sync: firstOf(RATINGS_SYNC_ROUTE), history: firstOf(RATING_HISTORY_ROUTE) };
  // The verdict turns on the day, the chamber and (HO 770) the move's rater
  // alone, so it is taken once per triple.
  const verdicts = new Map<string, boolean>();
  const out: Record<string, RaceMove> = {};
  for (const r of movesRs!.rows) {
    const raceId = String(r.race_id);
    if (out[raceId]) continue;
    const date = String(r.observed_at);
    const source = String(r.source);
    // lib/race-id.ts: a Senate id is S-<STATE>-<YYYY>.
    const chamber: MoveChamber = raceId.startsWith("S-") ? "senate" : "house";
    const key = `${date}|${chamber}|${source}`;
    let fresh = verdicts.get(key);
    if (fresh === undefined) {
      fresh = isFreshMove(date, chamber, syncRuns, historyRuns, horizons, source);
      verdicts.set(key, fresh);
    }
    if (!fresh) continue;
    out[raceId] = {
      date,
      source,
      to: String(r.to_rating),
      from: str(r.from_rating),
    };
  }
  return out;
}
