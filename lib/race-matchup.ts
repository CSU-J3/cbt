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

export type RosterMember = {
  name: string;
  party: PartyKey | null;
  isIncumbent: boolean;
  wonPrimary: boolean;
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
      wonPrimary: false,
    });
  for (const c of active)
    r.push({
      name: c.name,
      party: c.party,
      isIncumbent: false,
      wonPrimary: c.status === "won_primary",
    });
  return r;
}

// Resolve a market's favored ROSTER member. Name market → surname match. Party
// market → that party's sole candidate, or its won_primary nominee. null when a
// party market can't name a single candidate (the caller falls back to a label).
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
  return ofParty.find((m) => m.wonPrimary) ?? null;
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
  | { kind: "empty" }
  | { kind: "nominee"; fullName: string; party: PartyKey | null }
  | { kind: "leader"; fullName: string; party: PartyKey | null; others: string[] }
  | { kind: "nolead"; fullNames: string[]; party: PartyKey | null; count: number };

export type Matchup = {
  // incumbent + active challengers, for the market strip's favorite resolution.
  roster: RosterMember[];
  favorite: RosterMember | null;
  favoredIsIncumbent: boolean;
  challenger: ChallengerShape;
  // The presumptive party when the shape is "leader" — feeds the page footnote.
  presumptiveParty: PartyKey | null;
};

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

  let challenger: ChallengerShape = { kind: "empty" };
  let presumptiveParty: PartyKey | null = null;

  if (active.length > 0) {
    const won = active.filter((c) => c.status === "won_primary");
    const nominee =
      active.length === 1 ? active[0]! : won.length === 1 ? won[0]! : null;
    if (nominee) {
      challenger = {
        kind: "nominee",
        fullName: nominee.name,
        party: nominee.party,
      };
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
        challenger = {
          kind: "nolead",
          fullNames: active.map((c) => c.name),
          party: commonParty(active),
          count: active.length,
        };
      }
    }
  }

  return { roster, favorite, favoredIsIncumbent, challenger, presumptiveParty };
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
