import { MarketsTape } from "@/components/MarketsTape";

// HO 185 — the dual counter-scrolling markets tapes (equities → , commodities ←)
// lifted out of HomeHeader (HO 178/179.1) into one shared mount so EVERY page
// gets both, not just the dashboard. The bottom (commodities) tape shows the
// single shared AS OF stamp — which cycles US zones via HO 183 `useZoneCycle`
// inside MarketsTapeClient, so the cycling stamp now rides every page for free;
// the top (equities) tape passes showMeta={false}. The `.markets-tape-block`
// wrapper carries the z-index stacking (top tape z-31 over bottom z-30) so a
// tape's hover popover paints above the other tape + the nav. Hidden <700px by
// the same `.markets-tape` rule. The HO 175/176 jump-proofing lives in
// MarketsTapeClient, so it holds here unchanged.
//
// (MarketsTape still accepts the no-group "combined" form, but with this mount
// replacing HeaderBar's single tape, nothing calls it that way anymore — left
// in place rather than retired, to keep this diff tight.)
export function DualMarketsTape() {
  return (
    <div className="markets-tape-block">
      <MarketsTape group="equities" showMeta={false} />
      <MarketsTape group="commodities" reverse />
    </div>
  );
}
