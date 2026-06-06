// HO 210: pure builders that fold already-fetched query results into the
// cartogram cell model. No DB access here — the pages fetch via the existing
// helpers (getRacesIndex / getUpcomingPrimaries / getPastPrimaries) and hand
// the rows in, so this stays testable and free of unstable_cache.
//
// THE KEY CORRECTNESS RULE (pre-flight #1): the RACES tile count reuses the
// EXACT rows getRacesIndex returns (INNER JOIN race_ratings existence — "any
// seeded rating for the cycle"), so a state's tile count === the number of
// rows the LIST shows for that state. It is NOT the ABS(score)<=1 cut (that's
// getMostCompetitiveRaces, a different query for the dashboard block).

import { formatDateShort } from "@/lib/format";
import type {
  PartyKey,
  PrimaryWithCandidates,
  RaceCandidate,
  RaceIndexRow,
} from "@/lib/queries";

export type CartogramVariant = "races" | "primaries";
export type PrimaryBand = "voted" | "soon" | "later";

export type CartogramChallenger = {
  name: string;
  party: PartyKey | null;
  bioguideId: string | null;
  status: string | null;
};

export type CartogramContest = {
  label: string; // "PA-07" | "PA SEN" | "PA-07 D"
  chamber: "house" | "senate";
  meta: string; // incumbent · rating | date · field/result
  href: string | null; // race hub / contest detail
  incumbent: { name: string; bioguideId: string | null } | null;
  searchTerms: string[]; // raw strings the search box resolves against
  // ── RACES card (Pass 2) — undefined on primaries contests ──
  party?: PartyKey | null; // incumbent party (for the [party] chip)
  rating?: string | null; // consensus rating label
  ratingScore?: number | null; // consensus score (for chip color/sort)
  incumbentDepictionUrl?: string | null;
  challengers?: CartogramChallenger[]; // race_candidates (mostly empty today)
  // ── PRIMARIES card (Pass 2) — undefined on races contests ──
  primary?: PrimaryWithCandidates; // raw row for the HO 207 ShareBar / sched list
};

export type CartogramCell = {
  state: string;
  active: boolean;
  count: number | null; // RACES: competitive-race count (drives purple ramp)
  band: PrimaryBand | null; // PRIMARIES: recency band (drives hue)
  contests: CartogramContest[];
};

export type CartogramData = {
  cells: CartogramCell[];
  summary: string;
};

function seatLabel(chamber: "house" | "senate", state: string, district: number | null): string {
  if (chamber === "senate") return `${state} SEN`;
  return `${state}-${String(district ?? 0).padStart(2, "0")}`;
}

// ─── RACES ──────────────────────────────────────────────────────────────────

export function buildRacesCartogram(
  rows: RaceIndexRow[],
  candidates: RaceCandidate[] = [],
): CartogramData {
  // Group the flat candidate list (challengers; the incumbent stays on the race
  // row) by race_id for the card's expanded view.
  const challengersByRace = new Map<string, CartogramChallenger[]>();
  for (const c of candidates) {
    const ch: CartogramChallenger = {
      name: c.name,
      party: c.party,
      bioguideId: c.bioguide_id,
      status: c.status,
    };
    const arr = challengersByRace.get(c.race_id);
    if (arr) arr.push(ch);
    else challengersByRace.set(c.race_id, [ch]);
  }

  const byState = new Map<string, CartogramContest[]>();
  let senate = 0;
  let house = 0;

  for (const r of rows) {
    if (r.chamber === "senate") senate++;
    else house++;
    const label = seatLabel(r.chamber, r.state, r.district);
    const meta = `${r.incumbentName ?? "OPEN SEAT"} · ${r.consensusRating ?? "—"}`;
    const contest: CartogramContest = {
      label,
      chamber: r.chamber,
      meta,
      href: `/race/${r.raceId}`,
      incumbent: r.incumbentName
        ? { name: r.incumbentName, bioguideId: r.incumbentBioguideId }
        : null,
      searchTerms: [
        label,
        label.replace(/[\s-]/g, ""), // "PA07", "PASEN"
        r.state,
        ...(r.incumbentName ? [r.incumbentName] : []),
      ],
      party: r.incumbentParty,
      rating: r.consensusRating,
      ratingScore: r.consensusScore,
      incumbentDepictionUrl: r.incumbentDepictionUrl,
      challengers: challengersByRace.get(r.raceId) ?? [],
    };
    const arr = byState.get(r.state);
    if (arr) arr.push(contest);
    else byState.set(r.state, [contest]);
  }

  const cells: CartogramCell[] = [];
  for (const [state, contests] of byState) {
    // Senate before House, then the section's own competitiveness sort already
    // baked into getRacesIndex order is preserved by push order.
    contests.sort((a, b) => {
      if (a.chamber !== b.chamber) return a.chamber === "senate" ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    cells.push({ state, active: true, count: contests.length, band: null, contests });
  }

  const summary = `${rows.length} RACES · ${senate} SEN · ${house} HOUSE`;
  return { cells, summary };
}

// ─── PRIMARIES ────────────────────────────────────────────────────────────

// SOON = the next N (=4) distinct FUTURE state-uniform primary dates, rolling
// (not a fixed 30-day window — that goes dark in the Aug–Sep gap). Ties share:
// every state on one of those 4 dates is SOON. VOTED takes precedence over
// SOON (a state that has results shows cyan, not "up next"), so the window is
// computed over NOT-yet-voted states only — that's why LA (voted May 16, with
// a June 27 runoff date) lands VOTED, not SOON.
const SOON_WINDOW = 4;

export function buildPrimariesCartogram(
  upcoming: PrimaryWithCandidates[],
  past: PrimaryWithCandidates[],
  todayISO: string,
): CartogramData {
  const all = [...upcoming, ...past];
  const byState = new Map<string, PrimaryWithCandidates[]>();
  for (const p of all) {
    const arr = byState.get(p.state);
    if (arr) arr.push(p);
    else byState.set(p.state, [p]);
  }

  const stateVoted = new Map<string, boolean>();
  const stateMaxDate = new Map<string, string>();
  for (const [state, list] of byState) {
    const voted = list.some((p) => p.candidates.some((c) => c.vote_pct != null));
    stateVoted.set(state, voted);
    let max = "";
    for (const p of list) if (p.primary_date && p.primary_date > max) max = p.primary_date;
    if (max) stateMaxDate.set(state, max);
  }

  // distinct future dates among NOT-voted states, ascending
  const futureDates = new Set<string>();
  for (const [state, max] of stateMaxDate) {
    if (!stateVoted.get(state) && max >= todayISO) futureDates.add(max);
  }
  const soonDates = new Set([...futureDates].sort((a, b) => a.localeCompare(b)).slice(0, SOON_WINDOW));

  let votedContests = 0;
  const cells: CartogramCell[] = [];
  for (const [state, list] of byState) {
    const voted = stateVoted.get(state)!;
    const max = stateMaxDate.get(state) ?? null;
    let band: PrimaryBand;
    if (voted) band = "voted";
    else if (max && soonDates.has(max)) band = "soon";
    else band = "later";

    const contests: CartogramContest[] = [];
    for (const p of list) {
      const chamber = p.chamber === "senate" ? "senate" : "house";
      const district = p.district ? Number(p.district) : null;
      const partyTag = p.party === "open" ? "" : ` ${p.party}`;
      const label = `${seatLabel(chamber, state, district)}${partyTag}`;
      const contestVoted = p.candidates.some((c) => c.vote_pct != null);
      const dateStr = p.primary_date ? formatDateShort(p.primary_date) : "—";
      const fieldStr = contestVoted
        ? "voted"
        : `${p.candidates.length} cand${p.candidates.length === 1 ? "" : "s"}`;
      if (contestVoted) votedContests++;
      const incRow = p.candidates.find((c) => c.incumbent && c.bioguide_id);
      contests.push({
        label,
        chamber,
        meta: `${dateStr} · ${fieldStr}`,
        href: p.race_id ? `/race/${p.race_id}` : null,
        incumbent: incRow ? { name: incRow.name, bioguideId: incRow.bioguide_id } : null,
        searchTerms: [
          label,
          label.replace(/[\s-]/g, ""),
          state,
          ...p.candidates.map((c) => c.name),
        ],
        primary: p,
      });
    }
    contests.sort((a, b) => {
      if (a.chamber !== b.chamber) return a.chamber === "senate" ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    cells.push({ state, active: contests.length > 0, count: null, band, contests });
  }

  const summary = `${all.length} PRIMARIES · ${votedContests} VOTED · ${byState.size} STATES`;
  return { cells, summary };
}
