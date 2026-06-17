// HO 260: D↔R spread-bar axis math for the v2 rich race cards (the mock can't
// encode the data wiring). Axis: 0% = solid D (left), 50% = toss-up (center),
// 100% = solid R (right) — matching the .sb-track blue→slate→red gradient.
//
// Pure functions only (no React) so the server-rendered RaceCard imports them.
// Color/party/Kalshi-favorite resolution lives in lib/race-colors.ts; this owns
// the position math + divergence logic the handoff specifies.
import { nameKey, type RosterEntry } from "@/lib/race-colors";
import type { PartyKey } from "@/lib/queries";

// HO 254 per-source vocab → signed lean score (D negative, R positive):
// Solid/Safe ±3, Likely ±2, Lean ±1, Tilt ±0.5, Toss-up 0. null when the rating
// is absent or unrecognized (no dot for that rater).
export function ratingToAxisScore(
  rating: string | null | undefined,
): number | null {
  if (!rating) return null;
  const r = rating.trim();
  if (/^toss\s*up$/i.test(r)) return 0;
  let mag: number | null = null;
  if (/solid|safe/i.test(r)) mag = 3;
  else if (/likely/i.test(r)) mag = 2;
  else if (/lean/i.test(r)) mag = 1;
  else if (/tilt/i.test(r)) mag = 0.5;
  if (mag === null) return null;
  if (r.endsWith(" D")) return -mag;
  if (r.endsWith(" R")) return mag;
  return null;
}

// Signed lean score (−3..+3) → axis position %.
export function axisPos(score: number): number {
  return ((score + 3) / 6) * 100;
}

// A market's P(R wins) on the axis, from its favorite party + implied %:
// favorite R → P(R) = implied; favorite D → P(R) = 100 − implied. Returns null
// when the favorite party is unresolvable (an Independent or a name market that
// doesn't resolve) — can't place it on the D↔R axis, so no diamond.
export function marketRPos(
  favoriteParty: PartyKey | null,
  impliedPct: number,
): number | null {
  if (favoriteParty === "R") return impliedPct;
  if (favoriteParty === "D") return 100 - impliedPct;
  return null;
}

// Resolve the favored party of a Kalshi/Polymarket market. Party-labeled markets
// carry it directly; name-labeled markets resolve the surname against the roster
// (incumbent + any challengers). Generic over both odds shapes (same fields).
// Never fabricates a party the source didn't give.
export function resolveFavoriteParty(
  fav: {
    favoriteParty: PartyKey | null;
    favoriteIsParty: boolean;
    favoriteLabel: string;
  },
  roster: RosterEntry[],
): PartyKey | null {
  if (fav.favoriteParty) return fav.favoriteParty;
  if (fav.favoriteIsParty) return null;
  const fk = nameKey(fav.favoriteLabel);
  const hit = roster.find((r) => r.name && nameKey(r.name) === fk);
  return hit ? hit.party : null;
}

export type MarketDot = { party: PartyKey | null; rPos: number | null };

// Divergence chip (HO 260, conditional). Fires on real disagreement:
//   1. Both markets present + far apart (|kals_pos − poly_pos| ≥ SPLIT) → MARKETS SPLIT.
//   2. Else a market's favorite party is on the opposite side of center from the
//      rater consensus → "{SOURCE} BREAKS {D|R}" (glyph = which market).
//   3. Else null.
// Thresholds tuned to fire on real disagreement, not noise.
const SPLIT_PTS = 10;
export function divergenceChip(
  kalshi: MarketDot | null,
  poly: MarketDot | null,
  consensusScore: number | null,
): { glyph: string; text: string } | null {
  const kP = kalshi?.rPos ?? null;
  const pP = poly?.rPos ?? null;
  if (kP != null && pP != null && Math.abs(kP - pP) >= SPLIT_PTS) {
    return { glyph: "◇◆", text: "MARKETS SPLIT" };
  }
  const cons =
    consensusScore == null || consensusScore === 0
      ? null
      : consensusScore > 0
        ? "R"
        : "D";
  if (cons) {
    const checks: Array<[MarketDot | null, string, string]> = [
      [kalshi, "◇", "KALSHI"],
      [poly, "◆", "POLYMARKET"],
    ];
    for (const [m, glyph, src] of checks) {
      if (m && (m.party === "D" || m.party === "R") && m.party !== cons) {
        return { glyph, text: `${src} BREAKS ${m.party}` };
      }
    }
  }
  return null;
}
