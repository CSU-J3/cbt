// HO 149 — markets ticker tape. Server parent fetches the MarketTicks, then
// hands them to the client marquee for animation + staleness.
//
// HO 178 — the tape can render a single symbol GROUP. HO 234 (design item 1)
// collapsed the dashboard's dual counter-scrolling pair back to ONE combined
// line: both the dashboard (HomeHeader) and every inner page (HeaderBar) now
// mount a single no-group `<MarketsTape />` (all symbols, single AS OF). HO 251
// made that row STATIC (no crawl) and swapped to the 8-symbol econ/prediction
// set; the `reverse` prop is gone with the marquee. `group`/`showMeta` are
// retained for the grouped form but unused. `placeholderSymbols` (the group's
// full internal-symbol list) drives both the no-data placeholder row and the
// client's poll filter, so a tape only ever updates its own symbols.
import { MarketsTapeClient } from "@/components/MarketsTapeClient";
import { MARKET_SYMBOLS, type MarketGroup } from "@/lib/markets";
import { getLatestMarketTicks } from "@/lib/queries";

export async function MarketsTape({
  group,
  showMeta = true,
  symbols,
  kind = "markets",
}: {
  group?: MarketGroup;
  showMeta?: boolean;
  // HO 253: the v2 two-tape split. `symbols` is an explicit internal-symbol
  // allowlist (e.g. ["SPX","NDQ","TNX","WTI"]); when present it overrides the
  // `group` filter and ALSO drives render ORDER (the client lays symbols out in
  // this exact sequence), so MARKETS reads S&P / NASDAQ / 10Y / WTI and SIGNALS
  // reads SHUTDOWN / FEDCUT / CPI / UNEMP regardless of MARKET_SYMBOLS order.
  symbols?: readonly string[];
  // `kind="signals"` tells the client this strip has no market-hours close
  // (prediction + monthly-econ series run 24/7): it never washes/flags CLOSED
  // and right-pins a green LIVE dot instead. STALE (dead cron) still applies.
  kind?: "markets" | "signals";
} = {}) {
  let ticks: Awaited<ReturnType<typeof getLatestMarketTicks>> = [];
  try {
    ticks = await getLatestMarketTicks();
  } catch {
    // Swallow — the client falls through to the no-data state below.
  }
  const symbolSet = symbols ? new Set(symbols) : null;
  const groupTicks = symbolSet
    ? ticks.filter((t) => symbolSet.has(t.symbol))
    : group
      ? ticks.filter((t) => t.group === group)
      : ticks;
  const placeholderSymbols = symbols
    ? [...symbols]
    : MARKET_SYMBOLS.filter((s) => !group || s.group === group).map(
        (s) => s.internal,
      );
  return (
    <MarketsTapeClient
      ticks={groupTicks}
      placeholderSymbols={placeholderSymbols}
      showMeta={showMeta}
      kind={kind}
    />
  );
}
