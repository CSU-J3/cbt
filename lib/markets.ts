// HO 142 markets ticker data layer. Source dispatch + fetchers for the
// per-symbol upstreams. The internal `symbol` is what gets written to
// `market_ticks`; `remote` is the upstream-specific identifier. Internal
// labels are intentionally decoupled so a source swap is a one-line edit.
//
// HO 168 shipped 8: SPX/WTI/TNX (kept) + ITA/XLK/XLV (defense/tech/health sector
// ETFs — they tie market movement to legislative activity) + GOLD + VIX. DXY
// was dropped (less Congress-relevant than the sector set). VIX is no longer
// deferred: Stooq doesn't carry it, but FRED `VIXCLS` (CBOE VIX daily close)
// is a working free source — end-of-day, same cadence as TNX. Gold is the
// Stooq `xauusd` spot feed (the recognizable "GOLD 4,486" number; it trades
// ~24h so its date can lead by a UTC day and carries no volume — both harmless
// since fetchStooq reads only Close + Date).
//
// HO 177 expanded to 14: + XLF/XLE/XLI (financials/energy/industrials sector
// ETFs) + NDQ (Nasdaq Composite — `^ndq`; `^ixic` returns N/D on Stooq) + DOW
// (Dow — `^dji`; `^dow` is N/D) + BTC (Bitcoin — `btcusd`; its volume cell is
// empty, harmless since fetchStooq reads only Close + Date). `fullName` is the
// long instrument name for the tape's hover popover; `label` stays the short
// group.
//
// HO 178 splits the tape into TWO counter-scrolling tapes via `group`:
//   equities (9): SPX NDQ DOW ITA XLK XLV XLF XLE XLI
//   commodities (8): WTI GOLD SILVER NATGAS DXY TNX VIX BTC
// + SILVER (`xagusd`), NATGAS (`ng.f`), DXY re-added (`dx.f`; `^dxy`/`^dx`/
// `dx-y.nyb` all N/D). COPPER was dropped — no clean free USD/lb source (`hgusd`
// N/D; `hg.f` returns cents/lb, e.g. 666.63 for ~$6.67, misleading). The 9/8
// imbalance is intentional. All Stooq adds join the intraday `?source=stooq`
// cron set; TNX/VIX stay FRED (end-of-day) in the commodities tape. The array is
// ordered equities-first then commodities so each group renders in tape order.
// All symbols verified live 2026-06-02.
//
// HO 227 — STOOQ IS DEAD. Stooq retired the `/q/l/` light-quote CSV endpoint
// (it 404s "page does not exist or has been moved" for every symbol; the only
// surviving data path, `/q/d/l/`, is now behind a JS browser-verification wall —
// unusable headless). All 15 Stooq symbols went stale 2026-06-05 while the cron
// kept reporting `success`. Re-sourced ALL-FREE:
//   - indices (SPX/NDQ/DOW) → FMP `/stable/quote` (intraday-ish, the FMP_API_KEY
//     already in env for trades; `^GSPC`/`^IXIC`/`^DJI`).
//   - rates/VIX (TNX/VIX) → FRED, unchanged (already EOD).
//   - commodities (WTI/NATGAS/BTC) → FRED, EOD.
//   - DROPPED: the 6 sector ETFs (ITA/XLK/XLV/XLF/XLE/XLI — no free programmatic
//     source; FMP free 402s them, FRED carries no ETF prices); SILVER + DXY (no
//     keep-list / DTWEXBGS is a different basket than ICE DXY); and GOLD — its
//     only FRED option (GOLDAMGBD228NLBM, the London fix) is DISCONTINUED and
//     404s (confirmed in the HO 227 probe). Tape 17 → 8.
//   - FRED commodity IDs (DCOILWTICO/DHHNGSP/CBBTCUSD) are documented-active series
//     but were NOT live-verifiable from the build env (FRED slow/blocked there —
//     valid series timed out downloading full history; only the dead GOLD id 404'd
//     fast). They tick fine in prod like TNX/VIX already do; the cron's per-symbol
//     resilience + the HO 227 failure-honesty surface any bad id within retention.
// FRED-sourced symbols are EOD and labeled `eod` on the tape so a stale close is
// never shown as a fresh intraday print (the same honesty as the cron-status fix).
//
// HO 228 — the "ticks fine in prod" assumption above was FALSE. An egress probe
// showed `fredgraph.csv` is bot-walled from Vercel (times out at the fetch
// timeout from the cloud IPs; reachable only from the laptop — the local-vs-egress
// trap). ALL 5 FRED symbols had been dark, not just the 3 new commodities. Fix:
// re-sourced fetchFred off `fredgraph.csv` → the official JSON API
// `api.stlouisfed.org/fred/series/observations` (a distinct host-path that DOES
// reach egress — confirmed clean 400 in ~200ms keyless for all 5 series), keyed by
// `FRED_API_KEY` (Vercel PRODUCTION env). All 5 series verified live + fresh
// (CBBTCUSD "Coinbase Bitcoin" updated Jun 9); none dropped, tape stays 8.

// HO 251 — tape swapped to the econ/prediction spec set:
//   S&P · NASDAQ · 10Y · CPI · UNEMP · SHUTDOWN ODDS · FED CUT · WTI
// Dropped BTC/GOLD/DOW/NATGAS/VIX (the 8-symbol trim is what lets the row go
// STATIC full-width, HO 244-deferred). S&P/NASDAQ stay FMP intraday; 10Y/WTI
// stay FRED EOD; CPI/UNEMP are FRED monthly (CPI via units=pc1 → YoY %); SHUTDOWN
// and FED CUT are Kalshi prediction-market probabilities (computed/dynamic — see
// fetchKalshi). All four new symbols probed swap-ready from egress in HO 250.
// HO 259 — Polymarket macro signals (POLY-FEDCUT / POLY-SHUTDOWN) join the tape
// as a second source paired against the Kalshi macro ticks, for the v2 SIGNALS
// strip only. They write to market_ticks like every other symbol, but the bare
// `<MarketsTape />` on `/` + inner pages excludes source="polymarket" (see
// MarketsTape) so only the v2 paired tape surfaces them.
import { KALSHI_BASE } from "@/lib/kalshi";
import {
  fetchPolymarketFedCut,
  fetchPolymarketShutdown,
} from "@/lib/polymarket";

export type MarketSource = "fmp" | "fred" | "kalshi" | "polymarket";
export type MarketFormat = "index" | "yield" | "price" | "percent";
export type MarketGroup = "equities" | "commodities";
// HO 251 — release cadence, the input to the tape's per-symbol freshness model
// (MarketsTapeClient). `daily` keeps the 26h tickedAt STALE wash; `monthly`
// (CPI/UNEMP) is washed ONLY when its print is genuinely overdue (>~40d), so a
// fresh-but-unchanged monthly value never reads as a dead pipeline; `kalshi` is
// a live probability re-fetched each cron run (no change arrow — a % move on a
// probability misleads).
export type MarketCadence = "daily" | "monthly" | "kalshi";

export type MarketSymbol = {
  internal: string;
  source: MarketSource;
  remote: string; // FMP/FRED: the upstream series id. Kalshi: the SERIES ticker.
  label: string;
  fullName: string;
  format: MarketFormat;
  group: MarketGroup;
  cadence: MarketCadence;
  // FRED transform (e.g. CPI "pc1" → percent-change-from-year-ago = YoY %).
  // Omitted = FRED's default (lin) units.
  units?: string;
  // Kalshi headline compute: "single-yes" = the one market's yes-price (SHUTDOWN);
  // "cut-sum" = sum of the meeting's Cut* markets' yes-prices (FED CUT).
  kalshiKind?: "single-yes" | "cut-sum";
  // HO 259: which Polymarket macro market this symbol reads (source="polymarket").
  polyKind?: "fed" | "shutdown";
  // HO 289: keep this symbol OFF the bare static tape (/ + inner pages). The HO
  // 251 static row is sized for exactly 8 symbols, so the expanded B2 roster (the
  // tech/defense equities) renders on v2's SCROLLING MARKETS strip only — same
  // "extended roster, v2-only" treatment the polymarket "P" halves already get
  // (excluded by source). Default (omitted) = on the bare tape.
  bareTape?: boolean;
};

export const MARKET_SYMBOLS: readonly MarketSymbol[] = [
  // Indices — FMP /stable/quote (intraday, free on the existing key). HO 227.
  { internal: "SPX", source: "fmp", remote: "^GSPC", label: "S&P 500", fullName: "S&P 500", format: "index", group: "equities", cadence: "daily" },
  { internal: "NDQ", source: "fmp", remote: "^IXIC", label: "Nasdaq", fullName: "Nasdaq Composite", format: "index", group: "equities", cadence: "daily" },
  // HO 289 (B2): individual equities — tech + defense — via FMP /stable/quote
  // (intraday, same key/endpoint as the indices; HO 288 confirmed all five return
  // clean price + change from prod egress). RTX/NOC/GD were specced but 402 on the
  // FMP free tier (tier-determined, confirmed in 288) so they're out. Intraday like
  // the indices → eod=false → NO EOD micro-tag (an EOD tag on a live intraday print
  // would be the exact mislabel the tag exists to prevent). bareTape:false keeps
  // them on v2's scrolling MARKETS strip only (the static bare row fits 8).
  { internal: "NVDA", source: "fmp", remote: "NVDA", label: "Nvidia", fullName: "NVIDIA Corp.", format: "price", group: "equities", cadence: "daily", bareTape: false },
  { internal: "AAPL", source: "fmp", remote: "AAPL", label: "Apple", fullName: "Apple Inc.", format: "price", group: "equities", cadence: "daily", bareTape: false },
  { internal: "MSFT", source: "fmp", remote: "MSFT", label: "Microsoft", fullName: "Microsoft Corp.", format: "price", group: "equities", cadence: "daily", bareTape: false },
  { internal: "GOOGL", source: "fmp", remote: "GOOGL", label: "Alphabet", fullName: "Alphabet Inc.", format: "price", group: "equities", cadence: "daily", bareTape: false },
  { internal: "LMT", source: "fmp", remote: "LMT", label: "Lockheed", fullName: "Lockheed Martin Corp.", format: "price", group: "equities", cadence: "daily", bareTape: false },
  // Rates — FRED EOD.
  { internal: "TNX", source: "fred", remote: "DGS10", label: "10Y Treasury", fullName: "10-Year Treasury Yield", format: "yield", group: "commodities", cadence: "daily" },
  // Econ — FRED monthly. CPI uses units=pc1 → YoY % directly (the raw index ~334
  // is meaningless on a tape, HO 250). UNEMP is already a %.
  { internal: "CPI", source: "fred", remote: "CPIAUCSL", units: "pc1", label: "CPI (YoY)", fullName: "CPI Inflation, YoY", format: "percent", group: "commodities", cadence: "monthly" },
  { internal: "UNEMP", source: "fred", remote: "UNRATE", label: "Unemployment", fullName: "Unemployment Rate", format: "percent", group: "commodities", cadence: "monthly" },
  // Prediction markets — Kalshi (public/no-auth, same client as the race-odds
  // cron). Dynamic nearest-open-event discovery + compute in fetchKalshi.
  { internal: "SHUTDOWN", source: "kalshi", remote: "KXGOVTSHUTDOWN", kalshiKind: "single-yes", label: "Shutdown Odds", fullName: "Govt Shutdown Odds", format: "percent", group: "commodities", cadence: "kalshi" },
  { internal: "FEDCUT", source: "kalshi", remote: "KXFEDDECISION", kalshiKind: "cut-sum", label: "Fed Cut Odds", fullName: "Fed Rate-Cut Odds", format: "percent", group: "commodities", cadence: "kalshi" },
  // HO 259: Polymarket macro pairs — same questions as the Kalshi macro above,
  // rendered as the "P" half of the v2 SIGNALS pair. Excluded from the bare tape
  // on `/` + inner pages via source="polymarket" (MarketsTape). remote is unused
  // (discovery is by Gamma search in fetchPolymarket*); polyKind selects which.
  { internal: "POLY-SHUTDOWN", source: "polymarket", remote: "", polyKind: "shutdown", label: "Shutdown (Polymarket)", fullName: "Govt Shutdown Odds — Polymarket", format: "percent", group: "commodities", cadence: "kalshi" },
  { internal: "POLY-FEDCUT", source: "polymarket", remote: "", polyKind: "fed", label: "Fed Cut (Polymarket)", fullName: "Fed Rate-Cut Odds — Polymarket", format: "percent", group: "commodities", cadence: "kalshi" },
  // Commodities — FRED EOD.
  { internal: "WTI", source: "fred", remote: "DCOILWTICO", label: "WTI Crude", fullName: "Crude Oil (WTI)", format: "price", group: "commodities", cadence: "daily" },
] as const;

export type FetchedQuote = {
  price: number;
  marketDate: string; // YYYY-MM-DD
};

class FetchQuoteError extends Error {
  constructor(public readonly symbol: string, message: string) {
    super(`[${symbol}] ${message}`);
    this.name = "FetchQuoteError";
  }
}

// FMP /stable/quote returns a JSON array with one quote object:
// [{"symbol":"^GSPC","name":"S&P 500","price":7386.31,"changePercentage":-0.26,
//   "change":-19.42,"volume":...,"timestamp":1749...}]
// Intraday (the replacement for Stooq's light-quote feed, HO 227). Uses the
// FMP_API_KEY already in env for the trades pipeline. The quote carries its own
// change, but we keep the route's prior-session diff for consistency — so we
// only need price + the trading date. marketDate from the `timestamp` when
// present, else today (the fetch is intraday, so "today" is the right date).
async function fetchFmp(symbol: MarketSymbol): Promise<FetchedQuote> {
  const key = process.env.FMP_API_KEY;
  if (!key) {
    throw new FetchQuoteError(symbol.internal, `FMP_API_KEY not configured`);
  }
  const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol.remote)}&apikey=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new FetchQuoteError(symbol.internal, `fmp HTTP ${res.status}`);
  }
  const data: unknown = await res.json();
  const row = Array.isArray(data) ? data[0] : data;
  const price = (row as { price?: unknown })?.price;
  if (typeof price !== "number" || !Number.isFinite(price)) {
    throw new FetchQuoteError(symbol.internal, `fmp no numeric price`);
  }
  const ts = (row as { timestamp?: unknown })?.timestamp;
  const marketDate =
    typeof ts === "number" && Number.isFinite(ts)
      ? new Date(ts * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  return { price, marketDate };
}

// FRED via the official JSON API (api.stlouisfed.org). HO 228 swapped this off
// the old `fredgraph.csv` graph endpoint, which is bot-walled from Vercel egress
// (it times out from the cloud IPs the cron actually runs on — confirmed by an
// egress probe; the laptop-reachable graph CSV was the local-vs-egress trap that
// broke HO 227). The JSON API is a distinct host-path that DOES reach egress
// (probe: clean 400 in ~200ms keyless for all 5 series) and needs a free key in
// `FRED_API_KEY` (Vercel PRODUCTION env, not the repo).
//
// `sort_order=desc` returns newest-first. FRED publishes "." as the missing-value
// sentinel on non-trading days / not-yet-released dates, so we pull a small window
// and walk to the first numeric observation — the same resilience the old CSV-tail
// walk had (a "." most-recent row must not fail the symbol when a real value sits
// one row back). End-of-day only — labeled `eod` on the tape via source==='fred'.
async function fetchFred(symbol: MarketSymbol): Promise<FetchedQuote> {
  const rawKey = process.env.FRED_API_KEY;
  if (!rawKey) {
    throw new FetchQuoteError(symbol.internal, `FRED_API_KEY not configured`);
  }
  // Trim defensively: env values pasted via CLI/dashboard can pick up a
  // trailing newline/space, which FRED rejects with a 400 ("not a 32
  // character alpha-numeric lower-case string") even when the key itself is
  // valid. The real key is 32 lowercase alphanumerics — trimming is safe.
  const key = rawKey.trim();
  // HO 251: optional units transform (CPI = pc1 → YoY %). Default (omitted) =
  // FRED's `lin` raw level.
  const unitsParam = symbol.units ? `&units=${encodeURIComponent(symbol.units)}` : "";
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${encodeURIComponent(symbol.remote)}` +
    `&api_key=${key}&file_type=json&sort_order=desc&limit=10${unitsParam}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    // Surface FRED's error body — a 400/403 here is actionable (bad/expired
    // api_key, malformed param) and otherwise invisible behind the status.
    // keyLen (raw/trimmed) is non-secret and pinpoints whitespace vs a wrong
    // value if the key is still rejected after the trim.
    const detail = (await res.text().catch(() => "")).slice(0, 160).replace(/\s+/g, " ").trim();
    throw new FetchQuoteError(
      symbol.internal,
      `fred HTTP ${res.status} (keyLen ${rawKey.length}/${key.length})${detail ? `: ${detail}` : ""}`,
    );
  }
  const data: unknown = await res.json();
  const observations = (data as { observations?: unknown })?.observations;
  if (!Array.isArray(observations)) {
    throw new FetchQuoteError(symbol.internal, `fred no observations array`);
  }
  // Newest-first; walk to the first row with a numeric value (skip the "."
  // missing-value sentinel rather than NaN-ing it into a tick).
  for (const obs of observations) {
    const date = (obs as { date?: unknown })?.date;
    const value = (obs as { value?: unknown })?.value;
    if (typeof date !== "string" || typeof value !== "string") continue;
    if (value === ".") continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    return { price: n, marketDate: date };
  }
  throw new FetchQuoteError(symbol.internal, `fred returned no numeric rows`);
}

// Kalshi prediction-market probabilities (HO 251). Public/no-auth, same host as
// the race-odds cron (HO 217/218). Two-step, because these markets are
// date-bound and ephemeral — there is no permanent "shutdown"/"fed-cut" ticker:
//   1. DISCOVER the nearest still-open event in the series (`events?series_ticker
//      =<series>&status=open`, soonest by strike_date/close_time). FED CUT rolls
//      from the Jun meeting to Jul automatically once Jun closes; SHUTDOWN tracks
//      the live funding deadline.
//   2. COMPUTE the headline from that event's markets — single-yes (SHUTDOWN =
//      the one yes/no market's yes-price) or cut-sum (FED CUT = sum of the
//      meeting's Cut* markets' yes-prices). last_price_dollars is a 0–1 string;
//      ×100 = a percentage. marketDate = the event's resolution date (drives the
//      hover's "resolves {date}" and an optional label). No change arrow: a % move
//      on a probability misleads, so the cron nulls changePct for kalshi symbols.
// The event's resolution date. Kalshi is inconsistent across series: FEDDECISION
// events carry `strike_date`/`close_time` in the events-list response, but
// SHUTDOWN events do NOT (the date lives only on the market, or in the ticker
// suffix). So derive: prefer the event's own date fields, else parse the ticker
// suffix — `-26OCT01` → 2026-10-01, `-26JUN` → 2026-06-01 (day defaults to 01).
const KALSHI_MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
function parseTickerDate(eventTicker: string): string | null {
  const m = eventTicker.match(/-(\d{2})([A-Z]{3})(\d{2})?$/);
  if (!m) return null;
  const mon = KALSHI_MONTHS[m[2]!];
  if (!mon) return null;
  const yy = 2000 + Number(m[1]);
  const dd = m[3] ? Number(m[3]) : 1;
  return `${yy}-${String(mon).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
function kalshiEventDate(e: {
  event_ticker?: unknown;
  strike_date?: unknown;
  close_time?: unknown;
}): string | null {
  if (typeof e.strike_date === "string") return e.strike_date;
  if (typeof e.close_time === "string") return e.close_time;
  if (typeof e.event_ticker === "string") return parseTickerDate(e.event_ticker);
  return null;
}

function kalshiYesPrice(m: Record<string, unknown>): number | null {
  const lp = Number(m.last_price_dollars);
  if (Number.isFinite(lp) && lp > 0) return lp;
  // No recent trade → fall back to the bid/ask midpoint if quoted.
  const bid = Number(m.yes_bid_dollars);
  const ask = Number(m.yes_ask_dollars);
  if ((Number.isFinite(bid) && bid > 0) || (Number.isFinite(ask) && ask > 0)) {
    return (bid + ask) / 2;
  }
  return Number.isFinite(lp) ? lp : null; // a genuine 0¢ last is a valid 0%
}

async function fetchKalshi(symbol: MarketSymbol): Promise<FetchedQuote> {
  // 1. Discover the soonest open event in the series.
  const evUrl =
    `${KALSHI_BASE}/events?series_ticker=${encodeURIComponent(symbol.remote)}` +
    `&status=open&limit=200`;
  const evRes = await fetch(evUrl, { signal: AbortSignal.timeout(10_000) });
  if (!evRes.ok) {
    throw new FetchQuoteError(symbol.internal, `kalshi events HTTP ${evRes.status}`);
  }
  const evData: unknown = await evRes.json();
  const events = (evData as { events?: unknown })?.events;
  if (!Array.isArray(events)) {
    throw new FetchQuoteError(symbol.internal, `kalshi no events array`);
  }
  const dated = events
    .map((e) => {
      const et = (e as { event_ticker?: unknown }).event_ticker;
      const when = kalshiEventDate(e as Record<string, unknown>);
      return typeof et === "string" && typeof when === "string"
        ? { et, when, ms: Date.parse(when) }
        : null;
    })
    .filter((e): e is { et: string; when: string; ms: number } => e !== null && Number.isFinite(e.ms))
    .sort((a, b) => a.ms - b.ms);
  const soonest = dated[0];
  if (!soonest) {
    throw new FetchQuoteError(symbol.internal, `kalshi no open event for ${symbol.remote}`);
  }

  // 2. Fetch that event's markets and compute the headline.
  const mkRes = await fetch(
    `${KALSHI_BASE}/markets?event_ticker=${encodeURIComponent(soonest.et)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!mkRes.ok) {
    throw new FetchQuoteError(symbol.internal, `kalshi markets HTTP ${mkRes.status}`);
  }
  const mkData: unknown = await mkRes.json();
  const markets = (mkData as { markets?: unknown })?.markets;
  if (!Array.isArray(markets) || markets.length === 0) {
    throw new FetchQuoteError(symbol.internal, `kalshi no markets for ${soonest.et}`);
  }

  let prob: number; // 0–1
  if (symbol.kalshiKind === "cut-sum") {
    // The meeting's Cut* legs (tickers end -C25 / -C26). Sum their yes-prices.
    let sum = 0;
    let found = false;
    for (const m of markets) {
      const t = (m as { ticker?: unknown }).ticker;
      if (typeof t === "string" && /-C\d+$/.test(t)) {
        const yp = kalshiYesPrice(m as Record<string, unknown>);
        if (yp !== null) {
          sum += yp;
          found = true;
        }
      }
    }
    if (!found) {
      throw new FetchQuoteError(symbol.internal, `kalshi no cut markets in ${soonest.et}`);
    }
    prob = sum;
  } else {
    // single-yes: the event's single yes/no market.
    const yp = kalshiYesPrice(markets[0] as Record<string, unknown>);
    if (yp === null) {
      throw new FetchQuoteError(symbol.internal, `kalshi no price for ${soonest.et}`);
    }
    prob = yp;
  }

  return { price: prob * 100, marketDate: soonest.when.slice(0, 10) };
}

// HO 259: Polymarket macro quote. Reads only the one market this symbol needs
// (fed or shutdown). A null result (no liquid same-question market — e.g. the
// shutdown ghost) THROWS so processSymbol writes no tick → the tape's P slot reads
// N/A, never a fabricated zero. A previously-good value persists (last tick stays)
// and washes STALE after 26h if it goes dark — the same degrade as every symbol.
async function fetchPolymarketMacroQuote(symbol: MarketSymbol): Promise<FetchedQuote> {
  const q =
    symbol.polyKind === "fed"
      ? await fetchPolymarketFedCut()
      : await fetchPolymarketShutdown();
  if (!q) {
    throw new FetchQuoteError(
      symbol.internal,
      `polymarket ${symbol.polyKind} N/A (no liquid same-question market)`,
    );
  }
  return {
    price: q.pct,
    marketDate: q.resolveDate ?? new Date().toISOString().slice(0, 10),
  };
}

export async function fetchQuote(symbol: MarketSymbol): Promise<FetchedQuote> {
  switch (symbol.source) {
    case "fmp":
      return fetchFmp(symbol);
    case "fred":
      return fetchFred(symbol);
    case "kalshi":
      return fetchKalshi(symbol);
    case "polymarket":
      return fetchPolymarketMacroQuote(symbol);
  }
}
