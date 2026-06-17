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

// HO 259: Polymarket macro signals (fed-cut + shutdown) for the v2 SIGNALS tape,
// paired against the Kalshi macro ticks. One headline % each, normalized to the
// SAME question Kalshi answers so the K/P pair is apples-to-apples (verified live
// at wire time, not assumed — see the per-market notes below).
export type PolymarketMacroQuote = {
  pct: number; // 0-100 headline probability
  resolveDate: string | null; // the market's resolution date (YYYY-MM-DD)
};
export type PolymarketMacro = {
  fed: PolymarketMacroQuote | null;
  shutdown: PolymarketMacroQuote | null;
};

// Macro markets demand a STRICTER ghost gate than the seats. The seat gate is an
// AND (reject only when liquidity AND volume are both sub-threshold), which lets a
// thin-but-live seat through on liquidity alone. But Polymarket's same-question
// shutdown market is a $39-volume / $3.7K-liquidity shell (HO 255 probe, re-
// confirmed at wire) — it passes the seat AND-gate on liquidity yet is dead. A
// macro pair must NOT show a price off an untraded shell, so require BOTH floors
// (reject if EITHER is below). The live fed market clears these by ~1000×.
const MACRO_MIN_VOLUME = 25_000;
const MACRO_MIN_LIQUIDITY = 10_000;

type GSearch = { events?: GEvent[] };

// Discover via Gamma's search (purpose-built, slug-change-proof — the per-meeting
// fed slug rolls july→september and the shutdown slug carries a timestamp suffix)
// and read the nested markets from the SAME response (search returns them inline,
// confirmed live). closed-out and wrong-question events are filtered by slug.
async function searchEvents(query: string): Promise<GEvent[]> {
  const url =
    `${GAMMA_BASE}/public-search?q=${encodeURIComponent(query)}` +
    `&limit_per_type=20&events_status=active`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "application/json", "user-agent": "cbt/1.0" },
  });
  if (!res.ok) throw new Error(`gamma search HTTP ${res.status}`);
  const data = (await res.json()) as GSearch;
  return Array.isArray(data?.events) ? data.events : [];
}

function endMs(e: GEvent): number {
  return e.endDate ? Date.parse(e.endDate) : Number.POSITIVE_INFINITY;
}
function marketYes(m: GMarket): number | null {
  const outcomes = parseJsonArray(m.outcomes);
  const prices = parseJsonArray(m.outcomePrices);
  const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
  const yes = parseFloat(prices[yesIdx >= 0 ? yesIdx : 0] ?? "");
  return Number.isFinite(yes) ? yes : null;
}

// FED CUT — P(any cut) at the next FOMC decision, to MATCH Kalshi's cut-sum
// (KXFEDDECISION). Polymarket's per-meeting "fed-decision-in-{month}" event is
// multi-outcome (No change / 25 bps inc / 50+ inc / 25 bps dec / 50+ dec), so the
// cut probability is the SUM of the two "decrease" legs' Yes prices — not a single
// market. Pick the soonest still-open decision event so K and P track the same
// meeting as they roll (today both resolve 2026-07-29 = July; verified live).
export async function fetchPolymarketFedCut(): Promise<PolymarketMacroQuote | null> {
  const events = await searchEvents("fed decision");
  const decisions = events
    .filter((e) => e.slug && /^fed-decision-in-[a-z]+(-\d+)?$/.test(e.slug) && !e.closed)
    .sort((a, b) => endMs(a) - endMs(b));
  const next = decisions[0];
  if (!next) return null;
  let sum = 0;
  let found = false;
  for (const m of next.markets ?? []) {
    const title = m.groupItemTitle || m.question || "";
    if (!/decrease/i.test(title)) continue; // the cut legs only
    const yes = marketYes(m);
    if (yes !== null) {
      sum += yes;
      found = true;
    }
  }
  if (!found) return null;
  return { pct: sum * 100, resolveDate: next.endDate?.slice(0, 10) ?? null };
}

// SHUTDOWN — P(government shutdown by the funding deadline), to MATCH Kalshi's
// KXGOVTSHUTDOWN single-yes. Polymarket's same-question market
// ("government-shutdown-by-{deadline}") is a single Yes/No binary. Pair ONLY when
// it clears the macro ghost floors AND is that same question; the lone liquid
// shutdown-adjacent market ("...house-winner...") asks a DIFFERENT question and is
// excluded by the slug filter. Today the same-question market is a $39 ghost → this
// returns null → the tape's P slot reads N/A (the designed fallback).
export async function fetchPolymarketShutdown(): Promise<PolymarketMacroQuote | null> {
  const events = await searchEvents("government shutdown");
  const cands = events
    .filter((e) => e.slug && /^government-shutdown-by-/.test(e.slug) && !e.closed)
    .sort((a, b) => endMs(a) - endMs(b));
  const ev = cands[0];
  if (!ev) return null;
  const volume = num(ev.volume);
  const liquidity = num(ev.liquidity);
  if ((volume ?? 0) < MACRO_MIN_VOLUME || (liquidity ?? 0) < MACRO_MIN_LIQUIDITY) {
    return null; // ghost shell — degrade to N/A, never price off it
  }
  const m = (ev.markets ?? [])[0];
  if (!m) return null;
  const yes = marketYes(m);
  if (yes === null) return null;
  return { pct: yes * 100, resolveDate: ev.endDate?.slice(0, 10) ?? null };
}

// Both macro signals, each non-fatal (a failure → null → N/A, never throws the
// pair). Parallel — the two are independent markets.
export async function fetchPolymarketMacro(): Promise<PolymarketMacro> {
  const [fed, shutdown] = await Promise.all([
    fetchPolymarketFedCut().catch(() => null),
    fetchPolymarketShutdown().catch(() => null),
  ]);
  return { fed, shutdown };
}

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
