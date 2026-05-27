// HO 142 markets ticker data layer. Source dispatch + fetchers for the
// per-symbol upstreams. The internal `symbol` is what gets written to
// `market_ticks`; `remote` is the upstream-specific identifier. Internal
// labels are intentionally decoupled so a source swap is a one-line edit.
//
// v1 ships SPX/TNX/WTI/DXY. VIX is deferred — Stooq doesn't carry it and
// Yahoo's unauthed endpoints aren't stable enough for a 30-min refresh
// contract. See docs/backlog.md.

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
  { internal: "TNX", source: "fred", remote: "DGS10", label: "10Y Treasury", format: "yield" },
  { internal: "WTI", source: "stooq", remote: "cl.f", label: "WTI Crude", format: "price" },
  { internal: "DXY", source: "stooq", remote: "dx.f", label: "Dollar Index", format: "index" },
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
