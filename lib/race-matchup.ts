// HO 305: matchup derivation for the v2 rich race card (the incumbent-vs-
// challenger block). Pure functions — the server-rendered RaceCard AND the
// CompetitiveRacesStrip (which needs the page-level footnote + surname
// disambiguation) both import these, so the shape logic lives in ONE place.
//
// The challenger names are already fetched by CompetitiveRacesBlock
// (getRaceCandidates) and handed to the card; this file turns the active roster
// + the market favorite into the card's four display shapes. No DB, no React.
import {
  kalshiActive,
  nameKey,
  partyWord,
  surname,
} from "@/lib/race-colors";
import type { PartyKey, RaceCandidate, RaceIndexRow } from "@/lib/queries";

// The shared favorite shape of KalshiOdds / PolymarketOdds (the fields both carry).
type FavoriteSource = {
  favoriteLabel: string;
  favoriteIsParty: boolean;
  favoriteParty: PartyKey | null;
};

// Roster statuses that mean the candidate is OUT — dropped before deriving the
// card shape (the handoff's "filter to active challengers").
const WITHDRAWN = new Set([
  "withdrew",
  "withdrawn",
  "lost",
  "loser",
  "eliminated",
]);

// HO 638: statuses that mean "this is the party's general-election candidate."
// `won_primary` is the ordinary route; `nominee` is the ballot-vacancy /
// convention-replacement route (ME 2026: Platner won the primary and withdrew,
// Troy Jackson was nominated at a party convention and never ran in one).
// Handled IDENTICALLY everywhere — the two are different HOW, not different
// WHAT. Do NOT collapse them: `won_primary` on a convention nominee is a false
// claim in a status column, and nothing downstream would ever re-read it.
// Mirrored in SQL at getRaceCandidates / getRaceCandidatesForCycle's ORDER BY
// CASE (lib/queries.ts) — a status added here needs adding there too.
//
// HO 691 gave this set a SECOND consumer with a different failure mode. It now
// also decides the `general` shape (every active challenger nominated → both
// parties have their candidate, no dagger, no footnote). A status missing from
// here used to cost sort position; it now also costs a seat its general-election
// reading, sending a decided race back to `leader` and re-lighting the
// "primary unresolved" footnote under it.
const NOMINATED = new Set(["won_primary", "nominee"]);

export type RosterMember = {
  name: string;
  party: PartyKey | null;
  isIncumbent: boolean;
  // True for either nomination route — NOT "won a primary" (a convention
  // nominee sets this without having run in one).
  isNominee: boolean;
};

// Active challengers: a name present, NOT the incumbent (when the roster carries
// the incumbent as a row), and not withdrawn/eliminated.
export function activeChallengers(
  candidates: RaceCandidate[],
  incumbentBioguideId: string | null,
): RaceCandidate[] {
  return candidates.filter(
    (c) =>
      !!c.name &&
      !(c.bioguide_id && c.bioguide_id === incumbentBioguideId) &&
      !(c.status && WITHDRAWN.has(c.status.toLowerCase())),
  );
}

function buildRoster(
  row: RaceIndexRow,
  active: RaceCandidate[],
): RosterMember[] {
  const r: RosterMember[] = [];
  if (row.incumbentName)
    r.push({
      name: row.incumbentName,
      party: row.incumbentParty,
      isIncumbent: true,
      isNominee: false,
    });
  for (const c of active)
    r.push({
      name: c.name,
      party: c.party,
      isIncumbent: false,
      isNominee: !!c.status && NOMINATED.has(c.status),
    });
  return r;
}

// Resolve a market's favored ROSTER member. Name market → surname match. Party
// market → that party's sole candidate, or its nominee (won_primary OR
// convention `nominee`). null when a party market can't name a single candidate
// (the caller falls back to a label).
export function favoredMember(
  fav: FavoriteSource | null | undefined,
  roster: RosterMember[],
): RosterMember | null {
  if (!fav) return null;
  if (!fav.favoriteIsParty && fav.favoriteLabel) {
    const fk = nameKey(fav.favoriteLabel);
    return roster.find((m) => nameKey(m.name) === fk) ?? null;
  }
  const p = fav.favoriteParty;
  if (!p) return null;
  const ofParty = roster.filter((m) => m.party === p);
  if (ofParty.length === 1) return ofParty[0]!;
  return ofParty.find((m) => m.isNominee) ?? null;
}

// The card-level favorite that drives the edge accent + the contested-leader
// dagger. Kalshi rides both chambers; Polymarket is the Senate fallback.
function cardFavorite(
  row: RaceIndexRow,
  roster: RosterMember[],
): RosterMember | null {
  if (kalshiActive(row.kalshiOdds)) {
    const m = favoredMember(row.kalshiOdds, roster);
    if (m) return m;
  }
  if (row.chamber === "senate" && row.polymarketOdds) {
    const m = favoredMember(row.polymarketOdds, roster);
    if (m) return m;
  }
  return null;
}

// The market strip cell's favorite name + party. Surname when a single candidate
// resolves; party word ("Dem") when a party market can't be narrowed; the raw
// label's surname when a name market doesn't match the roster.
export function marketFavorite(
  fav: FavoriteSource | null | undefined,
  roster: RosterMember[],
): { name: string; party: PartyKey | null } | null {
  if (!fav) return null;
  const m = favoredMember(fav, roster);
  if (m) return { name: surname(m.name), party: m.party };
  if (!fav.favoriteIsParty && fav.favoriteLabel)
    return { name: surname(fav.favoriteLabel), party: fav.favoriteParty };
  if (fav.favoriteParty)
    return { name: partyWord(fav.favoriteParty), party: fav.favoriteParty };
  return null;
}

export type ChallengerShape =
  // HO 644: `empty` and `unknown` are two different states that shipped as one.
  // See the initialiser in deriveMatchup for which is which and why.
  | { kind: "empty" }
  | { kind: "unknown" }
  | { kind: "nominee"; fullName: string; party: PartyKey | null }
  // HO 691 — BOTH parties have their candidate: the primaries are over and this
  // is the general-election field. The shape existed nowhere before, which is
  // why S-MI-2026 fell through to `leader` after Michigan voted on 2026-08-04 and
  // rendered El-Sayed with a dagger, under a page footnote reading "Democratic
  // primary unresolved" — a false statement, on the primary surface, for a month.
  | { kind: "general"; members: { fullName: string; party: PartyKey | null }[] }
  | { kind: "leader"; fullName: string; party: PartyKey | null; others: string[] }
  | { kind: "nolead"; fullNames: string[]; party: PartyKey | null; count: number };

export type Matchup = {
  // incumbent + active challengers, for the market strip's favorite resolution.
  roster: RosterMember[];
  // HO 692: the active challengers themselves, so a consumer can rebuild a
  // market-free shape for the same set (the odds-off fallback on a `leader`
  // card) without re-deriving the filter and risking a different answer.
  active: RaceCandidate[];
  favorite: RosterMember | null;
  favoredIsIncumbent: boolean;
  challenger: ChallengerShape;
  // The presumptive party when the shape is "leader" — feeds the page footnote.
  presumptiveParty: PartyKey | null;
};

// HO 692 — the `nolead` shape, extracted so it has ONE producer. `deriveMatchup`
// uses it for the real no-lead case, and RaceCard uses it to build the odds-off
// fallback for a `leader` card: with the markets hidden there is no favourite,
// so the honest rendering of that same active set is exactly what the card would
// have shown had no market existed. Extracted rather than duplicated because a
// hand-copied fallback is a second implementation that drifts silently — and the
// falsification harness asserts the two produce identical markup, which is only
// a real assertion if they share this function.
export function noLeadShape(
  active: RaceCandidate[],
): Extract<ChallengerShape, { kind: "nolead" }> {
  return {
    kind: "nolead",
    fullNames: active.map((c) => c.name),
    party: commonParty(active),
    count: active.length,
  };
}

function commonParty(cands: RaceCandidate[]): PartyKey | null {
  const set = new Set(cands.map((c) => c.party));
  return set.size === 1 ? (cands[0]?.party ?? null) : null;
}

export function deriveMatchup(
  row: RaceIndexRow,
  candidates: RaceCandidate[],
): Matchup {
  const active = activeChallengers(candidates, row.incumbentBioguideId);
  const roster = buildRoster(row, active);
  const favorite = cardFavorite(row, roster);
  const favoredIsIncumbent = favorite?.isIncumbent === true;

  // HO 644 — these are two different states and the card rendered both as one.
  //   candidates.length === 0  -> nothing has ever been harvested for this seat.
  //     The card knows NOTHING about the challenger field. `unknown`.
  //   candidates.length > 0, active.length === 0 -> a roster exists and contains
  //     no active non-incumbent. That is a real finding. `empty`.
  // Measured at HO 642 P1: 129 of 186 rated seats are the first case and ZERO are
  // the second, so the branch that shipped ("no challenger filed") has never once
  // been true. See roadmap R1.
  //
  // SUB-CASE NAMED, NOT BUILT FOR: `activeChallengers` also filters WITHDRAWN, so
  // a roster whose challengers have all withdrawn lands on `empty` and renders
  // "no challenger filed" — arguably wrong for a field that WAS filed and then
  // vacated. It has zero members today. It is flagged here so the next reader
  // meets it as a known edge rather than a surprise; a third variant on zero
  // evidence is the mistake this change exists to fix.
  let challenger: ChallengerShape =
    candidates.length === 0 ? { kind: "unknown" } : { kind: "empty" };
  let presumptiveParty: PartyKey | null = null;

  if (active.length > 0) {
    const won = active.filter((c) => !!c.status && NOMINATED.has(c.status));
    const nominee =
      active.length === 1 ? active[0]! : won.length === 1 ? won[0]! : null;
    if (nominee) {
      challenger = {
        kind: "nominee",
        fullName: nominee.name,
        party: nominee.party,
      };
    } else if (active.length >= 2 && won.length === active.length) {
      // HO 691 — every active challenger is NOMINATED, so there is no primary
      // left to have a leader in. PARTY MIX IS DELIBERATELY IRRELEVANT: a
      // top-two seat (CA/WA) can send two candidates of the same party to
      // November, and "D v D · nominees" is the honest label for that. Testing
      // for one-of-each would silently fall back to `leader` there and put a
      // dagger on a decided contest — the exact defect this shape closes.
      //
      // Reachable only after the single-nominee test above fails, which needs
      // active.length >= 2, so the two branches cannot both fire.
      challenger = {
        kind: "general",
        members: active.map((c) => ({ fullName: c.name, party: c.party })),
      };
      // presumptiveParty stays null: nothing here is presumptive, so the page
      // footnote cannot fire for this seat. That is the mechanism, not a
      // side effect — CompetitiveRacesStrip collects presumptiveParty and
      // renders the "† presumptive — … primary unresolved" line from it.
    } else {
      // ≥2 active, no single nominee. Leader iff the market favorite is one of
      // them; otherwise the favorite is the incumbent/party → no-lead primary.
      const favActive =
        favorite && !favorite.isIncumbent
          ? (active.find((c) => nameKey(c.name) === nameKey(favorite.name)) ??
            null)
          : null;
      if (favActive) {
        challenger = {
          kind: "leader",
          fullName: favActive.name,
          party: favActive.party,
          others: active.filter((c) => c !== favActive).map((c) => c.name),
        };
        presumptiveParty = favActive.party;
      } else {
        challenger = noLeadShape(active);
      }
    }
  }

  return { roster, active, favorite, favoredIsIncumbent, challenger, presumptiveParty };
}

// Page-level surname disambiguation: a surname shared by ≥2 DISTINCT people
// across the displayed cards is ambiguous (the live four: Susan Collins ME +
// Mike Collins GA). The renderer adds a first initial only for these.
export function ambiguousSurnames(names: string[]): Set<string> {
  const byLast = new Map<string, Set<string>>();
  for (const n of names) {
    if (!n) continue;
    const sn = surname(n).toLowerCase();
    const set = byLast.get(sn) ?? new Set<string>();
    set.add(n.trim().toLowerCase());
    byLast.set(sn, set);
  }
  const out = new Set<string>();
  for (const [sn, full] of byLast) if (full.size > 1) out.add(sn);
  return out;
}

// Render a name as a bare surname, or "M. Collins" when the surname is ambiguous
// on the page.
export function displaySurname(
  fullName: string,
  ambiguous: Set<string>,
): string {
  const sn = surname(fullName);
  if (!ambiguous.has(sn.toLowerCase())) return sn;
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  const initial = first ? `${first[0]!.toUpperCase()}.` : "";
  return initial ? `${initial} ${sn}` : sn;
}

// Full party adjective for the presumptive footnote ("Democratic primary …").
export function partyAdjective(p: PartyKey | null): string {
  if (p === "R") return "Republican";
  if (p === "D") return "Democratic";
  if (p === "I") return "Independent";
  return "";
}
