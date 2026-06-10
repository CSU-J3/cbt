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

export type MarketSource = "fmp" | "fred";
export type MarketFormat = "index" | "yield" | "price";
export type MarketGroup = "equities" | "commodities";

export type MarketSymbol = {
  internal: string;
  source: MarketSource;
  remote: string;
  label: string;
  fullName: string;
  format: MarketFormat;
  group: MarketGroup;
};

export const MARKET_SYMBOLS: readonly MarketSymbol[] = [
  // Indices — FMP /stable/quote (intraday, free on the existing key). HO 227.
  { internal: "SPX", source: "fmp", remote: "^GSPC", label: "S&P 500", fullName: "S&P 500", format: "index", group: "equities" },
  { internal: "NDQ", source: "fmp", remote: "^IXIC", label: "Nasdaq", fullName: "Nasdaq Composite", format: "index", group: "equities" },
  { internal: "DOW", source: "fmp", remote: "^DJI", label: "Dow", fullName: "Dow Jones Industrial Average", format: "index", group: "equities" },
  // Commodities + rates + VIX — FRED (end-of-day). HO 227 re-source.
  { internal: "WTI", source: "fred", remote: "DCOILWTICO", label: "WTI Crude", fullName: "Crude Oil (WTI)", format: "price", group: "commodities" },
  { internal: "NATGAS", source: "fred", remote: "DHHNGSP", label: "Nat Gas", fullName: "Natural Gas (Henry Hub Spot)", format: "price", group: "commodities" },
  { internal: "TNX", source: "fred", remote: "DGS10", label: "10Y Treasury", fullName: "10-Year Treasury Yield", format: "yield", group: "commodities" },
  { internal: "VIX", source: "fred", remote: "VIXCLS", label: "Volatility (VIX)", fullName: "CBOE Volatility Index", format: "index", group: "commodities" },
  { internal: "BTC", source: "fred", remote: "CBBTCUSD", label: "Bitcoin", fullName: "Bitcoin (USD)", format: "price", group: "commodities" },
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

// FRED's public fredgraph.csv returns full history with two columns
// (observation_date, value). Series like DGS10 publish daily with empty
// "." values on non-trading days. Take the most recent row whose value is
// numeric. End-of-day only — fine for rates as a policy-effect signal.
async function fetchFred(symbol: MarketSymbol): Promise<FetchedQuote> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(symbol.remote)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new FetchQuoteError(symbol.internal, `fred HTTP ${res.status}`);
  }
  const body = (await res.text()).trim();
  const lines = body.split(/\r?\n/);
  // Walk from the tail until we find a row with a numeric value.
  for (let i = lines.length - 1; i >= 1; i--) {
    const [date, value] = lines[i]!.split(",");
    if (!date || !value) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    return { price: n, marketDate: date };
  }
  throw new FetchQuoteError(symbol.internal, `fred returned no numeric rows`);
}

export async function fetchQuote(symbol: MarketSymbol): Promise<FetchedQuote> {
  switch (symbol.source) {
    case "fmp":
      return fetchFmp(symbol);
    case "fred":
      return fetchFred(symbol);
  }
}
