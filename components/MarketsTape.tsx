// HO 149 — markets ticker tape. Server parent fetches the four HO 142
// MarketTicks, then hands them to the client marquee for animation +
// staleness + pause toggle. Empty/failed fetch falls through to the
// MarketsTapeClient's no-data branch (rendered when `ticks` is empty)
// so the strip never collapses height.
import { MarketsTapeClient } from "@/components/MarketsTapeClient";
import { getLatestMarketTicks } from "@/lib/queries";

export async function MarketsTape() {
  let ticks: Awaited<ReturnType<typeof getLatestMarketTicks>> = [];
  try {
    ticks = await getLatestMarketTicks();
  } catch {
    // Swallow — the client falls through to the no-data state below.
  }
  return <MarketsTapeClient ticks={ticks} />;
}
