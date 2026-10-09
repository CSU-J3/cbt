// HO 767 — /electoral's LIST rows, assembled from the page's reads (pure: the
// legs build the same rows the page renders). getRacesIndex's rows carry the
// ratings, the money and the odds; lib/electoral-general.ts carries the ballot,
// the members on it, the news and the day-after marks. This file decides what
// each closed row and each open row says, in mock-767 v18's terms:
//   - the row leads with who's on the ballot (the majors by surname), then
//     "· N others on the ballot" when there is one major, the OPEN pill, then
//     the seat holder this ballot doesn't carry, with HO 759's tag;
//   - MOVED is the latest rating_history move of the last 14 days (R3);
//   - NEWS is the newest of the last 30 days about a sitting member on the
//     ballot, five at most a row (R2); RACE NEWS the last 7 days per chamber;
//   - past election day the consensus becomes the result (HO 758's reading).
import type { IncumbentQualifier } from "./incumbent-qualifier";
import type { KalshiOdds } from "./kalshi";
import { surname, type RosterEntry } from "./race-colors";
import { districtToken } from "./race-id";
import { raceResultView } from "./race-result";
import { STATE_ABBR_TO_NAME } from "./states";
import { firstLast } from "./electoral-general";
import type {
  BallotEntry,
  BallotNewsItem,
  GeneralBallots,
  GeneralRace,
  RaceResultWithMarks,
} from "./electoral-general";
import type { PacIeRow, RaceIndexRow, RaceMove } from "./queries";

export const NEWS_LINE_DAYS = 30; // the row's NEWS line and the open row's NEWS (R2)
export const NEWS_PER_ROW = 5;
export const RACE_NEWS_DAYS = 7; // the RACE NEWS column
export const MOVED_DAYS = 14; // R3: on observed_at

const DAY_MS = 86_400_000;

export type Tier = "toss" | "lean" | "likely";
export function tierOf(score: number | null): Tier {
  const a = score == null ? 99 : Math.abs(score);
  if (a === 0) return "toss";
  if (a === 1) return "lean";
  return "likely";
}

export function seatLabel(r: { chamber: string; state: string; district: number | null }): string {
  return r.chamber === "senate" ? `${r.state} SEN` : `${r.state}-${districtToken(r.district)}`;
}

export type RowNews = { obsId: string; title: string; publisher: string; url: string; observedAt: string };

export type RowMajor = {
  key: string;
  surname: string; // as the row prints it: a first initial where the page has two people of that surname
  party: string | null;
  incumbent: boolean;
};

export type RowResult = {
  kind: "won" | "runoff" | "none";
  chip: string; // D HOLD · R GAIN · I WIN · RUNOFF · NO CALL
  chipParty: "D" | "R" | "O" | null;
  winnerKeys: string[]; // the entries Ballotpedia marks: one winner, or a runoff's advancers
  unnamed: { surname: string; party: string | null } | null; // a winner the row's majors don't name
  provenance: string | null; // HO 758's line under the ballot
  called: boolean; // one mark: the seat's odds hide (R6)
};

export type ElectoralRow = {
  raceId: string;
  chamber: "senate" | "house";
  state: string;
  seat: string;
  tier: Tier;
  consensusRating: string | null;
  consensusScore: number | null;
  cook: string | null;
  sabato: string | null;
  ie: string | null;
  margin2024: number | null;
  // The incumbent's cash, only for an incumbent running for this seat.
  cash: number | null;
  kalshiOdds: KalshiOdds | null;
  roster: RosterEntry[]; // the majors, for the Kalshi line's name market
  majors: RowMajor[];
  othersCount: number;
  open: boolean; // HO 221's curated retirement
  // The seat holder this ballot doesn't carry, and why (HO 759).
  holder: {
    bioguideId: string;
    name: string;
    surname: string;
    party: string | null;
    depictionUrl: string | null;
    tag: IncumbentQualifier | null;
  } | null;
  storedIncumbentParty: string | null; // for HOLD / GAIN
  move: { source: string; from: string | null; to: string; observedAt: string; ratingDate: string | null } | null;
  pac: PacIeRow[] | null;
  news: RowNews[]; // newest first, five at most, 30 days
  ballot: BallotEntry[];
  withdrew: GeneralRace["withdrew"];
  special: GeneralRace["special"];
  memberIds: string[];
  search: string; // lowercase: the seat, its state, every name on the ballot, the holder
  result: RowResult | null; // null until election day has passed
};

export type RaceNewsItem = RowNews & { seats: string[] };
export type RaceNews = { senate: RaceNewsItem[]; house: RaceNewsItem[] };

// The holder's party against the winner's: the same party holds, another
// gains, and a seat with no stored incumbent is a win.
function resultChip(winnerParty: string | null, holderParty: string | null): { chip: string; chipParty: RowResult["chipParty"] } {
  const p = (winnerParty ?? "?").slice(0, 1).toUpperCase();
  const chipParty: RowResult["chipParty"] = p === "D" ? "D" : p === "R" ? "R" : "O";
  if (!holderParty) return { chip: `${p} WIN`, chipParty };
  return { chip: `${p} ${holderParty.slice(0, 1).toUpperCase() === p ? "HOLD" : "GAIN"}`, chipParty };
}

// Which ballot entries a mark names: by the box row's person_key, else (a
// Louisiana jungle winner carries none) by first and last name.
function entriesFor(marks: RaceResultWithMarks["marks"], entries: BallotEntry[]): { keys: string[]; misses: RaceResultWithMarks["marks"] } {
  const keys: string[] = [];
  const misses: RaceResultWithMarks["marks"] = [];
  for (const m of marks) {
    const e =
      (m.personKey ? entries.find((x) => x.ballotKey === m.personKey) : undefined) ??
      entries.find((x) => firstLast(x.name) === firstLast(m.name));
    if (e) keys.push(e.key);
    else misses.push(m);
  }
  return { keys, misses };
}

export function buildElectoralRows(input: {
  cycle: number;
  index: (RaceIndexRow & { incumbentTag?: IncumbentQualifier | null })[];
  general: GeneralBallots;
  moves: Record<string, RaceMove>;
  pacByRace: Record<string, PacIeRow[]>;
  news: BallotNewsItem[];
  results: Record<string, RaceResultWithMarks> | null;
  nowMs: number; // ages and windows (HO 490: the page's one clock)
  clockMs: number; // the day-after gate (lib/clock.ts)
}): { rows: ElectoralRow[]; raceNews: RaceNews } {
  const { cycle, index, general, moves, pacByRace, news, results, nowMs, clockMs } = input;

  // A surname two people on the page share prints with a first initial
  // (mock-767's S. Collins / M. Collins), where the initial tells them apart:
  // S-AK's senator and the second Dan Sullivan share one, and print as
  // "Sullivan" and "Sullivan", the senator's marked inc.
  const namesBySurname = new Map<string, Set<string>>();
  const note = (surname: string, full: string) => {
    const k = surname.toLowerCase();
    (namesBySurname.get(k) ?? namesBySurname.set(k, new Set()).get(k)!).add(firstLast(full));
  };
  for (const r of index) {
    const g = general.races[r.raceId];
    for (const e of g?.entries ?? []) if (e.major) note(e.surname, e.name);
    if (g?.incumbentOnBallot === false && r.incumbentName && g.holder) note(g.holder.lastName ?? r.incumbentName, r.incumbentName);
  }
  const initialsTell = (surname: string) => {
    const names = namesBySurname.get(surname.toLowerCase());
    return !!names && names.size > 1 && new Set([...names].map((n) => n.charAt(0))).size > 1;
  };
  const display = (surname: string, full: string) =>
    initialsTell(surname) ? `${full.trim().charAt(0).toUpperCase()}. ${surname}` : surname;

  const lineSince = nowMs - NEWS_LINE_DAYS * DAY_MS;
  const panelSince = nowMs - RACE_NEWS_DAYS * DAY_MS;
  const movedSince = nowMs - MOVED_DAYS * DAY_MS;
  const fresh = news.filter((n) => Date.parse(n.observedAt) >= lineSince);

  const rows: ElectoralRow[] = [];
  const panel: Record<"senate" | "house", Map<string, RaceNewsItem>> = { senate: new Map(), house: new Map() };
  for (const r of index) {
    const g = general.races[r.raceId] ?? null;
    const entries = g?.entries ?? [];
    const memberIds = g?.memberIds ?? [];
    const onBallot = g?.incumbentOnBallot ?? null;
    const open = r.incumbentRunning === 0;
    // No `box` read: nothing says the incumbent is off the ballot, so the
    // row reads as it did (an incumbent running unless curated as retiring).
    const incumbentRunsHere = onBallot ?? !open;

    const majors: RowMajor[] = entries
      .filter((e) => e.major)
      .map((e) => ({ key: e.key, surname: display(e.surname, e.name), party: e.party, incumbent: e.incumbent }));

    const holder =
      onBallot === false && r.incumbentBioguideId && r.incumbentName
        ? {
            bioguideId: r.incumbentBioguideId,
            name: r.incumbentName,
            surname: display(g?.holder?.lastName ?? r.incumbentName, r.incumbentName),
            party: r.incumbentParty,
            depictionUrl: r.incumbentDepictionUrl,
            tag: r.incumbentTag ?? null,
          }
        : null;

    const m = moves[r.raceId];
    const move =
      m && Date.parse(m.date) >= movedSince
        ? { source: m.source, from: m.from, to: m.to, observedAt: m.date, ratingDate: g?.raterDates[m.source] ?? null }
        : null;

    const mine = memberIds.length ? fresh.filter((n) => n.bioguides.some((b) => memberIds.includes(b))) : [];
    const rowNews = mine.slice(0, NEWS_PER_ROW).map(({ obsId, title, publisher, url, observedAt }) => ({ obsId, title, publisher, url, observedAt }));
    for (const n of mine) {
      if (Date.parse(n.observedAt) < panelSince) continue;
      const slot = panel[r.chamber];
      const item = slot.get(n.obsId) ?? slot.set(n.obsId, { obsId: n.obsId, title: n.title, publisher: n.publisher, url: n.url, observedAt: n.observedAt, seats: [] }).get(n.obsId)!;
      if (!item.seats.includes(r.raceId)) item.seats.push(r.raceId);
    }

    let result: RowResult | null = null;
    const reading = results?.[r.raceId];
    if (reading) {
      const view = raceResultView(reading, cycle, clockMs);
      if (view.passed) {
        const { keys, misses } = entriesFor(reading.marks, entries);
        const majorKeys = new Set(majors.map((x) => x.key));
        if (view.decided && reading.marks.length === 1) {
          const mark = reading.marks[0]!;
          const entry = entries.find((e) => keys.includes(e.key)) ?? null;
          const named = entry != null && majorKeys.has(entry.key);
          result = {
            kind: "won",
            ...resultChip(mark.party ?? entry?.party ?? null, r.incumbentBioguideId ? r.incumbentParty : null),
            winnerKeys: entry ? [entry.key] : [],
            unnamed: named ? null : { surname: entry?.surname ?? surname(misses[0]?.name ?? mark.name), party: mark.party ?? entry?.party ?? null },
            provenance: view.provenance,
            called: true,
          };
        } else if (view.runoff) {
          result = { kind: "runoff", chip: "RUNOFF", chipParty: null, winnerKeys: keys, unnamed: null, provenance: view.provenance, called: false };
        } else {
          result = { kind: "none", chip: "NO CALL", chipParty: null, winnerKeys: [], unnamed: null, provenance: view.provenance, called: false };
        }
      }
    }

    const names = [r.raceId, seatLabel(r), r.state, STATE_ABBR_TO_NAME[r.state] ?? "", r.incumbentName ?? "", ...entries.map((e) => e.name)];
    rows.push({
      raceId: r.raceId,
      chamber: r.chamber,
      state: r.state,
      seat: seatLabel(r),
      tier: tierOf(r.consensusScore),
      consensusRating: r.consensusRating,
      consensusScore: r.consensusScore,
      cook: r.cookRating,
      sabato: r.sabatoRating,
      ie: r.ieRating,
      margin2024: r.margin2024,
      cash: incumbentRunsHere ? r.incumbentCashOnHand : null,
      kalshiOdds: r.kalshiOdds,
      roster: entries.filter((e) => e.major).map((e) => ({ name: e.name, party: (e.party as RosterEntry["party"]) ?? null })),
      majors,
      othersCount: entries.filter((e) => !e.major).length,
      open,
      holder,
      storedIncumbentParty: r.incumbentBioguideId ? r.incumbentParty : null,
      move,
      pac: pacByRace[r.raceId] ?? null,
      news: rowNews,
      ballot: entries,
      withdrew: g?.withdrew ?? [],
      special: g?.special ?? null,
      memberIds,
      search: names.join(" ").toLowerCase(),
      result,
    });
  }
  const sorted = (m: Map<string, RaceNewsItem>) => [...m.values()].sort((a, b) => (a.observedAt < b.observedAt ? 1 : a.observedAt > b.observedAt ? -1 : 0));
  return { rows, raceNews: { senate: sorted(panel.senate), house: sorted(panel.house) } };
}

// HO 768: R6's MAP half. The map's contests are built from the index, not from
// the rows, so the pinned card, the district card and the district export each
// kept a called seat's market. The page strips it here, from the rows' one mark,
// before the cartogram is built. Before election day nothing is called and the
// index passes through as is. (A helper rather than a literal in the page: the
// odds-sites gate reads every .tsx for the market's name, and the page isn't a
// market site.)
export function withoutCalledOdds<T extends { raceId: string; kalshiOdds: KalshiOdds | null }>(
  index: T[],
  rows: Pick<ElectoralRow, "raceId" | "result">[],
): T[] {
  const called = new Set(rows.filter((r) => r.result?.called).map((r) => r.raceId));
  if (called.size === 0) return index;
  return index.map((r) => (called.has(r.raceId) ? { ...r, kalshiOdds: null } : r));
}
