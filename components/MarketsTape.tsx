// HO 149 — markets ticker tape. Server parent fetches the MarketTicks, then
// hands them to the client marquee for animation + staleness.
//
// HO 178 — the tape can render a single symbol GROUP. The dashboard (HomeHeader)
// mounts two: `<MarketsTape group="equities" />` and
// `<MarketsTape group="commodities" reverse />` (counter-scrolling). Every other
// page (HeaderBar, HO 154.2) mounts `<MarketsTape />` with no group → one
// combined tape of all symbols, single direction. `placeholderSymbols` (the
// group's full internal-symbol list) drives both the no-data placeholder row and
// the client's poll filter, so a tape only ever updates its own symbols.
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
