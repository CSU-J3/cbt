// HO 142 markets ticker data layer. Source dispatch + fetchers for the
// per-symbol upstreams. The internal `symbol` is what gets written to
// `market_ticks`; `remote` is the upstream-specific identifier. Internal
// labels are intentionally decoupled so a source swap is a one-line edit.
//
// HO 168 ships 8: SPX/WTI/TNX (kept) + ITA/XLK/XLV (defense/tech/health sector
// ETFs — they tie market movement to legislative activity) + GOLD + VIX. DXY
// was dropped (less Congress-relevant than the sector set). VIX is no longer
// deferred: Stooq doesn't carry it, but FRED `VIXCLS` (CBOE VIX daily close)
// is a working free source — end-of-day, same cadence as TNX. Gold is the
// Stooq `xauusd` spot feed (the recognizable "GOLD 4,486" number; it trades
// ~24h so its date can lead by a UTC day and carries no volume — both harmless
// since fetchStooq reads only Close + Date). All symbols verified live
// 2026-06-01.

export type MarketSource = "stooq" | "fred";
export type MarketFormat = "index" | "yield" | "price";

export type MarketSymbol = {
  internal: string;
  source: MarketSource;
  remote: string;
  label: string;
  format: MarketFormat;
};

export const MARKET_SYMBOLS: readonly MarketSymbol[] = [
  { internal: "SPX", source: "stooq", remote: "^spx", label: "S&P 500", format: "index" },
  { internal: "WTI", source: "stooq", remote: "cl.f", label: "WTI Crude", format: "price" },
  { internal: "TNX", source: "fred", remote: "DGS10", label: "10Y Treasury", format: "yield" },
  { internal: "ITA", source: "stooq", remote: "ita.us", label: "Aerospace & Defense", format: "price" },
  { internal: "XLK", source: "stooq", remote: "xlk.us", label: "Technology", format: "price" },
  { internal: "XLV", source: "stooq", remote: "xlv.us", label: "Health Care", format: "price" },
  { internal: "GOLD", source: "stooq", remote: "xauusd", label: "Gold (spot)", format: "price" },
  { internal: "VIX", source: "fred", remote: "VIXCLS", label: "Volatility (VIX)", format: "index" },
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

// Stooq daily CSV with f=sd2t2ohlcv returns one data row:
// "Symbol,Date,Time,Open,High,Low,Close,Volume"
// "^SPX,2026-05-27,17:26:15,7526.3,7530.4,7506.5,7510.2,654450638"
// When a symbol doesn't exist the data cells are literal "N/D".
async function fetchStooq(symbol: MarketSymbol): Promise<FetchedQuote> {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol.remote)}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new FetchQuoteError(symbol.internal, `stooq HTTP ${res.status}`);
  }
  const body = (await res.text()).trim();
  const lines = body.split(/\r?\n/);
  if (lines.length < 2) {
    throw new FetchQuoteError(symbol.internal, `stooq returned no data row`);
  }
  const cells = lines[1]!.split(",");
  // Stooq sentinel for "no data" is literal "N/D" in every cell.
  const date = cells[1];
  const close = cells[6];
  if (!date || date === "N/D" || !close || close === "N/D") {
    throw new FetchQuoteError(symbol.internal, `stooq N/D — symbol may be wrong`);
  }
  const price = Number(close);
  if (!Number.isFinite(price)) {
    throw new FetchQuoteError(symbol.internal, `stooq non-numeric close: ${close}`);
  }
  return { price, marketDate: date };
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
    case "stooq":
      return fetchStooq(symbol);
    case "fred":
      return fetchFred(symbol);
  }
}
