// HO 292/303 — curated per-item descriptor for the markets-tape hover box. Each
// entry carries a `sector` (a short uppercase descriptor shown dim beside the
// name) and an optional `note` (the policy / Congress angle, shown muted below).
// Keyed by the roster's INTERNAL symbol: TickItem passes tick.symbol (SPX/NVDA/
// TNX/CPI/…), PairItem passes the primary/Kalshi symbol (SHUTDOWN/FEDCUT/
// FEDCUT-SEP/RECESSION). An item with no entry shows neither line; an entry with
// no `note` shows the sector only (no empty note slot).
//
// THIS IS THE SINGLE EDITABLE SOURCE for the sector + note copy — edit here.
// Banked: later the note links into CBT's own bill/topic data (the news-linkage
// arc — hover/click reaching the relevant bills); static curated copy is interim.
export type PolicyHook = { sector: string; note?: string };

export const POLICY_HOOKS: Record<string, PolicyHook> = {
  // Indices + equities (internal symbols; 10Y = TNX).
  SPX: { sector: "US large-cap index" },
  NDQ: { sector: "US tech-heavy index" },
  TNX: { sector: "US sovereign rate", note: "Moves on Fed path and fiscal supply" },
  WTI: { sector: "Energy · $/bbl" },
  NVDA: { sector: "Semiconductors", note: "Exposed to chip export controls" },
  AAPL: { sector: "Consumer tech", note: "Antitrust and tariff exposure" },
  MSFT: { sector: "Software / cloud", note: "Federal cloud and AI policy" },
  GOOGL: { sector: "Search / ads", note: "Active antitrust litigation" },
  LMT: { sector: "Defense prime", note: "Tracks NDAA appropriations" },
  CPI: { sector: "Inflation · YoY" },
  UNEMP: { sector: "Labor · U-3" },
  // Odds (Kalshi primary symbols; FED CUT JUL = FEDCUT, SEP = FEDCUT-SEP).
  SHUTDOWN: { sector: "Prediction market", note: "Funding lapse if no CR passes" },
  FEDCUT: { sector: "Prediction market" },
  "FEDCUT-SEP": { sector: "Prediction market" },
  RECESSION: { sector: "Prediction market", note: "NBER-defined" },
};

export function policyHook(symbol: string): PolicyHook | undefined {
  return POLICY_HOOKS[symbol];
}
