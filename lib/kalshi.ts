// HO 218: per-seat Kalshi prediction-market odds. Kalshi's API is public,
// no-auth, free (external-api.kalshi.com — HO 217 probe). We scan the
// open-events feed with nested markets (the series_ticker filter is unreliable
// and the markets feed is too large to page; the events feed surfaces the
// congressional markets in ~37 pages of 200), filter to 2026 House/Senate
// GENERAL seat markets, parse each ticker to our raceId, and keep the favored
// outcome per seat. Fed to getRacesIndex via the kalshi_odds table; refreshed
// by the GitHub Actions cron (Hobby caps cron at daily, and odds move intraday).
//
// This module is import-safe for client bundles via `import type` — it pulls in
// no next/cache, only the global fetch.

export const KALSHI_BASE = "https://external-api.kalshi.com/trade-api/v2";

export type KalshiOdds = {
  raceId: string; // our raceId form: "PA-07-2026" | "S-ME-2026"
  eventTicker: string;
  impliedPct: number; // 0-100, favored outcome's implied probability
  favoriteLabel: string; // candidate name OR a bare party string
  favoriteIsParty: boolean; // true when the label is a party, not a person (65% of markets)
  favoriteParty: "D" | "R" | "I" | null; // set from a party label; null for a name (resolved at render)
  openInterest: number | null;
  closeTime: string | null;
};

type KMarket = {
  last_price_dollars?: string | null;
  yes_sub_title?: string | null;
  no_sub_title?: string | null;
  open_interest_fp?: string | number | null;
  close_time?: string | null;
};
type KEvent = { event_ticker?: string; markets?: KMarket[] };

// HO 219: chamber-control (House/Senate balance of power). Two fixed event
// tickers, each with a D + R outcome market. We store BOTH exact pcts — the two
// last_price_dollars do NOT sum to 100 (live: House 78+23=101, Senate 41+58=99),
// so the loser is never 100−fav. Lives in dashboard_state, not kalshi_odds
// (that's a per-seat table), keyed 'kalshi_chamber_control'.
export type ChamberOdds = {
  favParty: "D" | "R" | "I";
  favPct: number; // 0-100
  otherParty: "D" | "R" | "I";
  otherPct: number; // 0-100
};
export type ChamberControl = {
  house: ChamberOdds | null;
  senate: ChamberOdds | null;
};

const PARTY_RE = /party|^(democrat(ic)?|republican|gop|independent|libertarian|green)$/i;
function partyFromLabel(label: string): "D" | "R" | "I" | null {
  if (/republican|gop/i.test(label)) return "R";
  if (/democrat/i.test(label)) return "D";
  if (/independent/i.test(label)) return "I";
  return null;
}

function houseRace(st: string, ddRaw: string) {
  const dd = ddRaw === "AL" ? "AL" : String(parseInt(ddRaw, 10)).padStart(2, "0");
  return { raceId: `${st}-${dd}-2026`, chamber: "house" as const };
}

// Locked HO 218 Phase 1 parser. House: FOUR ticker schemes tried in order — the
// competitive seats live on the bare HOUSE{ST}{D} scheme, NOT KXHOUSERACE
// (KXHOUSERACE-only covers safe seats and silently drops all 60 competitive
// House seats). Senate: SENATE{ST}-26 + the FL/OH 'S'-suffix specials; the
// optional NOV suffix covers LA with no per-state hardcode. Strict anchoring
// means primary markets (KXSENATE{ST}{D|R}-26) and derivative markets
// (MOV/ADVANCE/SEATS/CONTROL/…) fall through to null on their own.
export function tickerToRaceId(
  et: string,
): { raceId: string; chamber: "house" | "senate" } | null {
  let m: RegExpMatchArray | null;
  if ((m = et.match(/^KXHOUSERACE-([A-Z]{2})(\d{1,2}|AL)-26$/))) return houseRace(m[1]!, m[2]!);
  if ((m = et.match(/^HOUSEPARTY-?([A-Z]{2})(\d{1,2}|AL)-26$/))) return houseRace(m[1]!, m[2]!);
  if ((m = et.match(/^KXHOUSE([A-Z]{2})(\d{1,2}|AL)-26$/))) return houseRace(m[1]!, m[2]!);
  if ((m = et.match(/^HOUSE([A-Z]{2})(\d{1,2}|AL)-26$/))) return houseRace(m[1]!, m[2]!);
  if ((m = et.match(/^(?:KX)?SENATE(FL|OH)S-26$/)))
    return { raceId: `S-${m[1]}-2026`, chamber: "senate" };
  if ((m = et.match(/^(?:KX)?SENATE([A-Z]{2})-26(?:NOV)?$/)))
    return { raceId: `S-${m[1]}-2026`, chamber: "senate" };
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function kalshiGet<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) {
      await sleep(5_000);
      continue;
    }
    if (!res.ok) throw new Error(`kalshi HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }
  throw new Error("kalshi 429 retries exhausted");
}

// Favored outcome of one event = the nested market with the highest implied
// prob. Label comes from whichever of yes_/no_sub_title is populated.
function favorite(ev: KEvent): KalshiOdds | null {
  const et = ev.event_ticker || "";
  const map = tickerToRaceId(et);
  if (!map) return null;
  const ms = (ev.markets ?? []).filter(
    (m) => m.last_price_dollars != null && m.last_price_dollars !== "",
  );
  if (ms.length === 0) return null;
  let best = ms[0]!;
  let bestP = parseFloat(best.last_price_dollars as string);
  for (const m of ms) {
    const p = parseFloat(m.last_price_dollars as string);
    if (Number.isFinite(p) && p > bestP) {
      best = m;
      bestP = p;
    }
  }
  if (!Number.isFinite(bestP)) return null;
  const label = (best.yes_sub_title || best.no_sub_title || "").trim();
  if (!label) return null;
  const isParty = PARTY_RE.test(label);
  return {
    raceId: map.raceId,
    eventTicker: et,
    impliedPct: Math.round(bestP * 100),
    favoriteLabel: label,
    favoriteIsParty: isParty,
    favoriteParty: isParty ? partyFromLabel(label) : null,
    openInterest:
      best.open_interest_fp != null ? Math.round(Number(best.open_interest_fp)) : null,
    closeTime: best.close_time ?? null,
  };
}

// Scan the open-events feed and return the favored outcome for every 2026
// House/Senate general seat Kalshi runs. Highest open-interest market wins when
// a seat has markets under more than one ticker scheme (e.g. both a bare
// HOUSE{ST}{D} and a KXHOUSERACE market). Throttled (250ms) to stay under the
// 429 threshold; the page cap is a runaway backstop.
export async function fetchKalshiSeatOdds(): Promise<KalshiOdds[]> {
  const byRace = new Map<string, KalshiOdds>();
  let cursor = "";
  let pages = 0;
  while (pages < 60) {
    const url = `${KALSHI_BASE}/events?status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ""}`;
    const d = await kalshiGet<{ events?: KEvent[]; cursor?: string }>(url);
    const evs = d.events ?? [];
    pages++;
    for (const ev of evs) {
      const et = (ev.event_ticker || "").toUpperCase();
      // cheap prefilter — only House/Senate -26 events reach the strict parser
      if (!/^(KX)?(HOUSE|SENATE)/.test(et)) continue;
      if (!/-26($|[^0-9])/.test(et)) continue;
      const odds = favorite(ev);
      if (!odds) continue;
      const prev = byRace.get(odds.raceId);
      if (!prev || (odds.openInterest ?? 0) > (prev.openInterest ?? 0)) {
        byRace.set(odds.raceId, odds);
      }
    }
    cursor = d.cursor || "";
    if (!cursor) break;
    await sleep(250);
  }
  return [...byRace.values()];
}

type KControlMarket = {
  ticker?: string;
  last_price_dollars?: string | null;
  yes_sub_title?: string | null;
  no_sub_title?: string | null;
};

// One chamber-control event → {fav, other} with both exact pcts. Party comes
// from the outcome-market ticker suffix (CONTROLH-2026-D / -R), falling back to
// the label. Returns null if fewer than two outcomes price (degrade, don't
// crash). Favored = higher implied prob; an exact tie keeps a stable order.
async function readControl(eventTicker: string): Promise<ChamberOdds | null> {
  const d = await kalshiGet<{ markets?: KControlMarket[] }>(
    `${KALSHI_BASE}/markets?event_ticker=${eventTicker}&limit=8`,
  );
  const byParty = new Map<"D" | "R" | "I", number>();
  for (const m of d.markets ?? []) {
    const p = parseFloat(m.last_price_dollars ?? "");
    if (!Number.isFinite(p)) continue;
    const tk = (m.ticker || "").toUpperCase();
    let party: "D" | "R" | "I" | null = null;
    if (tk.endsWith("-D")) party = "D";
    else if (tk.endsWith("-R")) party = "R";
    else if (tk.endsWith("-I")) party = "I";
    else party = partyFromLabel(m.yes_sub_title || m.no_sub_title || "");
    if (party) byParty.set(party, Math.round(p * 100));
  }
  const entries = [...byParty.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length < 2) return null;
  const [fav, other] = entries as [
    ["D" | "R" | "I", number],
    ["D" | "R" | "I", number],
  ];
  return { favParty: fav[0], favPct: fav[1], otherParty: other[0], otherPct: other[1] };
}

// House + Senate balance-of-power odds in parallel. Two direct event reads —
// these tickers are fixed (no scanning); the per-chamber catch keeps one bad
// read from nulling the other.
export async function fetchChamberControl(): Promise<ChamberControl> {
  const [house, senate] = await Promise.all([
    readControl("CONTROLH-2026").catch(() => null),
    readControl("CONTROLS-2026").catch(() => null),
  ]);
  return { house, senate };
}
