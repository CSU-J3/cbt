// HO 292 — curated one-line policy / Congress angle per markets-tape item, shown
// as the dim third line in the tape hover box (below the name + as-of). Keyed by
// the roster's INTERNAL symbol: TickItem passes tick.symbol (SPX/NVDA/TNX/CPI/…),
// PairItem passes the primary/Kalshi symbol (SHUTDOWN/FEDCUT/RECESSION). An item
// with no entry omits the line (no empty slot).
//
// THIS IS THE SINGLE EDITABLE SOURCE for the hook copy — edit the strings here.
// Banked: later the hook links into CBT's own bill/topic data (the news-linkage
// arc — hover/click reaching the relevant bills); static curated copy is interim.
export const POLICY_HOOKS: Record<string, string> = {
  // Indices + equities (internal symbols; 10Y = TNX).
  SPX: "Broad market; moves on fiscal and tax policy",
  NDQ: "Tech-heavy index; sensitive to antitrust and trade",
  NVDA: "AI chips; exposed to export controls",
  AAPL: "Hardware and services; trade and antitrust exposure",
  MSFT: "Cloud and AI; federal contracts and antitrust",
  GOOGL: "Search and ads; antitrust scrutiny",
  LMT: "Defense prime; tracks the appropriations cycle",
  TNX: "Benchmark yield; the government's borrowing cost",
  WTI: "Crude; energy policy and the strategic reserve",
  CPI: "Inflation; drives the Fed's rate path",
  UNEMP: "Labor market; the Fed's other mandate",
  // Odds (Kalshi primary symbols; FED CUT = FEDCUT).
  SHUTDOWN: "Odds of a funding lapse before the appropriations deadline",
  FEDCUT: "Odds the Fed cuts at its next meeting",
  RECESSION: "Odds of a recession this year; backdrop for fiscal fights",
};

export function policyHook(symbol: string): string | undefined {
  return POLICY_HOOKS[symbol];
}
