// HO 222: shared rating/party/Kalshi color + resolution logic, factored out of
// RaceMapCard + RatingChip so the /races MAP card and the /races LIST render
// from ONE source (the spread bar, the divergence flag, the consensus chip, and
// the map card's rating text all key off the same functions — no drift).
//
// Helpers take PRIMITIVE values (a rating string, a signed score, a KalshiOdds
// object, a {name,party} roster) — NOT a CartogramContest or a RaceIndexRow.
// The two surfaces have different row shapes; each maps its own fields to these
// args at the call site.
import type { KalshiOdds } from "@/lib/kalshi";
import type { PartyKey } from "@/lib/queries";

export type RosterEntry = { name: string; party: PartyKey | null };

// The one canonical party-color helper (HO 468 — closes the ~8-way fork). Takes
// a raw `string` (not just PartyKey) and normalizes inline (uppercase; trims).
// Inlined NOT imported from lib/queries because this module is a leaf imported by
// client components — importing the queries value would drag next/cache into
// their bundles (the HO 425/430 rule).
//
// Two categories stay distinct: I / ID (independents — King/Sanders/Kiley) →
// independent purple; null / any UNRECOGNIZED code (e.g. "L") → --text-dim gray,
// the default every original helper (PartyTag, race-colors, MemberHeader) used.
export function partyColor(party: string | null | undefined): string {
  if (!party) return "var(--text-dim)";
  const p = party.trim().toUpperCase();
  if (p === "R") return "var(--party-republican)";
  if (p === "D") return "var(--party-democrat)";
  if (p === "I" || p === "ID") return "var(--party-independent)";
  return "var(--text-dim)";
}

// Lean-only rating color (mirrors RatingChip's colorFor): the rating's strength
// lives in the TEXT, the color carries direction only; Toss Up is the single
// amber state. NOT a strength-distinct tint axis — that would diverge from every
// other rating surface in the app (RatingChip explicitly rejects it).
export function ratingColor(rating: string | null | undefined): string {
  if (!rating) return "var(--text-dim)";
  if (rating === "Toss Up") return "var(--accent-amber-bright)";
  if (rating.endsWith(" D")) return "var(--party-democrat)";
  if (rating.endsWith(" R")) return "var(--party-republican)";
  return "var(--text-muted)";
}

// 40%-opacity border companions to ratingColor (matches RatingChip's
// borderColorFor) for the chip's 1px outline.
export function ratingBorderColor(rating: string | null | undefined): string {
  if (!rating) return "var(--border-strong)";
  if (rating === "Toss Up") return "rgba(251, 191, 36, 0.4)"; // --accent-amber-bright
  if (rating.endsWith(" D")) return "rgba(59, 130, 246, 0.4)"; // --party-democrat
  if (rating.endsWith(" R")) return "rgba(239, 68, 68, 0.4)"; // --party-republican
  return "var(--border-strong)";
}

export function partyWord(p: PartyKey | null): string {
  if (p === "R") return "Rep";
  if (p === "D") return "Dem";
  if (p === "I") return "Ind";
  return "—";
}

// Surname for dense lines; drop given names + Jr./Sr./III suffixes.
const NAME_SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
export function surname(name: string): string {
  const toks = name
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  while (toks.length > 1 && NAME_SUFFIX.has(toks[toks.length - 1]!.toLowerCase()))
    toks.pop();
  return toks[toks.length - 1] ?? name;
}
export const nameKey = (name: string) => surname(name).toLowerCase();

// A Kalshi market is "active" only if it exists and hasn't closed.
export function kalshiActive(
  odds: KalshiOdds | null | undefined,
): odds is KalshiOdds {
  if (!odds) return false;
  if (odds.closeTime && Date.parse(odds.closeTime) < Date.now()) return false;
  return true;
}

// Resolve the favored party of a Kalshi market. Party-labeled markets carry it
// directly; name-labeled markets resolve the surname against the roster
// (incumbent + any challengers). Returns null when unresolvable — never
// fabricate a party the API didn't give.
export function resolveKalshiFavoriteParty(
  odds: KalshiOdds,
  roster: RosterEntry[],
): PartyKey | null {
  if (odds.favoriteParty) return odds.favoriteParty;
  if (odds.favoriteIsParty) return null;
  const fk = nameKey(odds.favoriteLabel);
  const hit = roster.find((r) => r.name && nameKey(r.name) === fk);
  return hit ? hit.party : null;
}

// Divergence flag predicate (HO 222 LIST): Kalshi's favored party disagrees with
// the rater-consensus DIRECTION. Mirrors scripts/diagnostic/divergence-count.ts
// (= 4 today). False when no active market, no directional consensus (Toss Up /
// null), or no resolvable favored party — null-safe by construction.
export function kalshiDivergesFromConsensus(
  odds: KalshiOdds | null | undefined,
  consensusScore: number | null,
  roster: RosterEntry[],
): boolean {
  if (!kalshiActive(odds)) return false;
  if (consensusScore == null || consensusScore === 0) return false;
  const fav = resolveKalshiFavoriteParty(odds, roster);
  if (fav !== "R" && fav !== "D") return false;
  const cons = consensusScore > 0 ? "R" : "D";
  return fav !== cons;
}
