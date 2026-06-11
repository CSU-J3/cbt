// HO 149 — markets ticker tape. Server parent fetches the MarketTicks, then
// hands them to the client marquee for animation + staleness.
//
// HO 178 — the tape can render a single symbol GROUP. HO 234 (design item 1)
// collapsed the dashboard's dual counter-scrolling pair back to ONE combined
// line: both the dashboard (HomeHeader) and every inner page (HeaderBar) now
// mount a single no-group `<MarketsTape />` (all symbols, one direction, single
// AS OF) — uniform global chrome. The `group`/`reverse`/`showMeta` props are
// retained for the grouped form but no longer used. `placeholderSymbols` (the group's full
// internal-symbol list) drives both the no-data placeholder row and the client's
// poll filter, so a tape only ever updates its own symbols.
import { MarketsTapeClient } from "@/components/MarketsTapeClient";
import { MARKET_SYMBOLS, type MarketGroup } from "@/lib/markets";
import { getLatestMarketTicks } from "@/lib/queries";

export async function MarketsTape({
  group,
  reverse = false,
  showMeta = true,
}: {
  group?: MarketGroup;
  reverse?: boolean;
  showMeta?: boolean;
} = {}) {
  let ticks: Awaited<ReturnType<typeof getLatestMarketTicks>> = [];
  try {
    ticks = await getLatestMarketTicks();
  } catch {
    // Swallow — the client falls through to the no-data state below.
  }
  const groupTicks = group ? ticks.filter((t) => t.group === group) : ticks;
  const placeholderSymbols = MARKET_SYMBOLS.filter(
    (s) => !group || s.group === group,
  ).map((s) => s.internal);
  return (
    <MarketsTapeClient
      ticks={groupTicks}
      reverse={reverse}
      placeholderSymbols={placeholderSymbols}
      showMeta={showMeta}
    />
  );
}
