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
import type { KalshiOdds } from "@/lib/kalshi";
import type {
  PacIeRow,
  PartyKey,
  PrimaryWithCandidates,
  RaceCandidate,
  RaceIndexRow,
} from "@/lib/queries";


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
  raceId?: string; // HO 225: the getRacesIndex race id (= a House district's seatId), so the modal can match a clicked polygon's seatId to its contest
  incumbentFirstElected?: number | null; // HO 225: earliest term startYear from members.terms_json; drives the district-modal card's tenure / FIRST ELECTED
  party?: PartyKey | null; // incumbent party (for the [party] chip)
  rating?: string | null; // consensus rating label
  ratingScore?: number | null; // consensus score (for chip color/sort)
  raterSpread?: { cook: string | null; sabato: string | null; ie: string | null }; // HO 225: per-rater ratings for the district-modal card's 3-segment spread (consensus alone can't drive it)
  incumbentDepictionUrl?: string | null;
  incumbentCashOnHand?: number | null; // HO 212: cents; null = no FEC filing, 0 = filed-empty
  margin2024?: number | null; // HO 214: signed 2024 House margin (R+ / D−); null = none/RCV/Senate
  kalshiOdds?: KalshiOdds | null; // HO 218: per-seat market odds; null = no Kalshi general market
  isOpen?: boolean; // HO 221: incumbent not running (retirement flag) → OPEN seat
  challengers?: CartogramChallenger[]; // race_candidates (mostly empty today)
  pacIe?: PacIeRow[]; // HO 393: UDP IE direction rows for this seat (the PAC SPENDING line); undefined/empty on seats with no tracked spend
  // ── PRIMARIES card (Pass 2) — undefined on races contests ──
  primary?: PrimaryWithCandidates; // raw row for the HO 207 ShareBar / sched list
};

export type CartogramCell = {
  state: string;
  active: boolean;
  count: number | null; // RACES: competitive-race count (drives purple ramp)
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
  // HO 393: race_id → UDP IE direction rows, so a state's pinned card can render
  // the PAC SPENDING line. Pure builder — the page fetches getPacIeSpending.
  pacByRace: Record<string, PacIeRow[]> = {},
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
      raceId: r.raceId,
      incumbentFirstElected: r.incumbentFirstElected,
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
      raterSpread: {
        cook: r.cookRating,
        sabato: r.sabatoRating,
        ie: r.ieRating,
      },
      incumbentDepictionUrl: r.incumbentDepictionUrl,
      incumbentCashOnHand: r.incumbentCashOnHand,
      margin2024: r.margin2024,
      kalshiOdds: r.kalshiOdds,
      isOpen: r.incumbentRunning === 0,
      challengers: challengersByRace.get(r.raceId) ?? [],
      pacIe: pacByRace[r.raceId],
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
    cells.push({ state, active: true, count: contests.length, contests });
  }

  const summary = `${rows.length} RACES · ${senate} SEN · ${house} HOUSE`;
  return { cells, summary };
}

// ─── PRIMARIES ────────────────────────────────────────────────────────────

