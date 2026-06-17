// HO 256: per-seat Polymarket Senate odds, parallel to lib/kalshi.ts. The Gamma
// read API is public, no-auth, and reachable from Vercel egress (HO 255 probe —
// the trade-site US geoblock does NOT extend to gamma-api; see the
// reference_polymarket_source memory). Per-seat Senate races live as Gamma
// *events* ("Texas Senate Election Winner", slug `texas-senate-election-winner`)
// whose nested markets[] are per-candidate (or per-party) Yes/No binaries; the
// favored outcome is the nested market with the highest "Yes" price. We scan all
// 35 Senate-2026 seats by slug (an exact-seat scan, not a fuzzy search — avoids
// the closed-2024 ranking pollution entirely), parse the favorite, and keep
// volume + liquidity so a downstream card can flag thin markets. Fed to the
// polymarket_odds table by the per-seat odds cron (/api/cron/kalshi).
//
// Import-safe for client bundles (import type) — pulls in only lib/states + the
// global fetch, no next/cache.
import { STATE_ABBR_TO_NAME } from "@/lib/states";

export const GAMMA_BASE = "https://gamma-api.polymarket.com";

export type PolymarketOdds = {
  raceId: string; // our Senate raceId form: "S-TX-2026"
  slug: string; // the Gamma event slug, e.g. "texas-senate-election-winner"
  impliedPct: number; // 0-100, favored outcome's implied probability
  favoriteLabel: string; // candidate name (suffix stripped) OR a bare party word
  favoriteIsParty: boolean; // true when the label is a party, not a person
  favoriteParty: "D" | "R" | "I" | null; // from a "(R)" suffix or party word; null for a name-only label (resolve at render)
  volume: number | null; // event-level total volume (USD)
  liquidity: number | null; // event-level liquidity (USD) — the thin-market signal
  endDate: string | null;
};

// The 35 Senate-2026 seats (33 Class II + the FL & OH specials). Mirrors
// SENATE_STATES_2026 in lib/primaries-sync.ts (the authoritative set); kept
// local so this module stays import-safe and decoupled from the primaries sync.
const SENATE_STATES_2026 = [
  "AL", "AK", "AR", "CO", "DE", "GA", "ID", "IL", "IA", "KS",
  "KY", "LA", "ME", "MA", "MI", "MN", "MS", "MT", "NE", "NH",
  "NJ", "NM", "NC", "OK", "OR", "RI", "SC", "SD", "TN", "TX",
  "VA", "WV", "WY", "FL", "OH",
] as const;

// Markets below this liquidity AND volume are dead ghosts (the probe's $38 /
// $3.7K shutdown market shape) — excluded. Thin-but-live seats (the probe's GA
// at $23K) pass and keep their liquidity recorded for a low-confidence render.
const GHOST_LIQUIDITY = 2000;
const GHOST_VOLUME = 2000;

type GMarket = {
  outcomes?: string | null; // JSON-encoded: '["Yes","No"]'
  outcomePrices?: string | null; // JSON-encoded: '["0.555","0.445"]'
  groupItemTitle?: string | null; // "Ken Paxton (R)" / "Democrat"
  question?: string | null;
};
type GEvent = {
  slug?: string;
  closed?: boolean;
  endDate?: string | null;
  volume?: number | string | null;
  liquidity?: number | string | null;
  markets?: GMarket[];
};

function stateSlug(abbr: string): string {
  // "NH" → "New Hampshire" → "new-hampshire"
  const name = STATE_ABBR_TO_NAME[abbr] ?? abbr;
  return name.toLowerCase().replace(/[^a-z]+/g, "-");
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

// Resolve a Gamma outcome label to {clean label, party, isParty}. Three forms:
// "Ken Paxton (R)" → name + party from suffix; "Democrat" → party word;
// "Mary Peltola" → name only, party null (resolved against the roster at render,
// the same null-safe path as a Kalshi name market).
function resolveLabel(raw: string): {
  label: string;
  party: "D" | "R" | "I" | null;
  isParty: boolean;
} {
  const trimmed = raw.trim();
  const suffix = trimmed.match(/\(([RDI])\)\s*$/);
  if (suffix) {
    return {
      label: trimmed.replace(/\s*\([RDI]\)\s*$/, "").trim(),
      party: suffix[1] as "D" | "R" | "I",
      isParty: false,
    };
  }
  if (/^(republican|gop)$/i.test(trimmed)) return { label: trimmed, party: "R", isParty: true };
  if (/^democrat(ic)?$/i.test(trimmed)) return { label: trimmed, party: "D", isParty: true };
  if (/^independent$/i.test(trimmed)) return { label: trimmed, party: "I", isParty: true };
  return { label: trimmed, party: null, isParty: false };
}

function parseJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

// Favored outcome of one Senate event = the nested market with the highest "Yes"
// implied price. Returns null when the event is closed, isn't a 2026 general
// (endDate sanity), has no priced market, or is a sub-threshold ghost.
function favorite(abbr: string, ev: GEvent): PolymarketOdds | null {
  if (!ev || ev.closed) return null;
  const endDate = ev.endDate ?? null;
  // Sane endDate guard: reject only an explicitly WRONG-year endDate (a stale
  // closed-2024 event slipping through). A null endDate is allowed — FL's 2026
  // special carries none, yet is a live market — because the exact 2026 slug +
  // closed=false already vouch for the cycle.
  if (endDate && !endDate.startsWith("2026")) return null;

  let bestYes = -1;
  let bestLabel = "";
  for (const m of ev.markets ?? []) {
    const outcomes = parseJsonArray(m.outcomes);
    const prices = parseJsonArray(m.outcomePrices);
    const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
    const idx = yesIdx >= 0 ? yesIdx : 0;
    const yes = parseFloat(prices[idx] ?? "");
    if (!Number.isFinite(yes)) continue;
    if (yes > bestYes) {
      bestYes = yes;
      bestLabel = (m.groupItemTitle || m.question || "").trim();
    }
  }
  if (bestYes <= 0 || !bestLabel) return null;

  const volume = num(ev.volume);
  const liquidity = num(ev.liquidity);
  if ((liquidity ?? 0) < GHOST_LIQUIDITY && (volume ?? 0) < GHOST_VOLUME) {
    return null; // dead ghost
  }

  const { label, party, isParty } = resolveLabel(bestLabel);
  return {
    raceId: `S-${abbr}-2026`,
    slug: ev.slug ?? "",
    impliedPct: Math.round(bestYes * 100),
    favoriteLabel: label,
    favoriteIsParty: isParty,
    favoriteParty: party,
    volume,
    liquidity,
    endDate,
  };
}

async function gammaGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "application/json", "user-agent": "cbt/1.0" },
  });
  if (!res.ok) throw new Error(`gamma HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Scan all 35 Senate-2026 seats by slug and return the favored outcome for every
// seat Polymarket runs a live, non-ghost general market on. A per-seat fetch
// (not a feed scan) because Gamma has no reliable "all 2026 Senate" filter and
// fetching the exact 2026 slug sidesteps the closed-2024 ranking pollution. One
// bad seat fetch is non-fatal (skipped); throttled to stay polite.
export async function fetchPolymarketSeatOdds(): Promise<PolymarketOdds[]> {
  const out: PolymarketOdds[] = [];
  for (const abbr of SENATE_STATES_2026) {
    const slug = `${stateSlug(abbr)}-senate-election-winner`;
    try {
      const events = await gammaGet<GEvent[]>(
        `${GAMMA_BASE}/events?slug=${slug}&closed=false`,
      );
      const ev = Array.isArray(events) ? events[0] : undefined;
      const odds = ev ? favorite(abbr, ev) : null;
      if (odds) out.push(odds);
    } catch {
      // skip this seat — never let one fetch fail the whole scan
    }
    await sleep(120);
  }
  return out;
}
