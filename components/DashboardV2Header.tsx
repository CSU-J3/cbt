import { BreadcrumbMasthead } from "@/components/BreadcrumbMasthead";
import { CyclingTimestamp } from "@/components/CyclingTimestamp";
import { NAV_ITEMS, PrimaryNav } from "@/components/HeaderBar";
import { MarketsTape } from "@/components/MarketsTape";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import type { Stage } from "@/lib/enums";
import type { CorpusStats } from "@/lib/queries";

// HO 253 — Dashboard v2 header. A RESTACK of HomeHeader, not a new visual
// language: it reuses every existing header class (.home-header, the 20px brand,
// the .home-stat-readout number tokens, the 11px sync line, the shared
// PrimaryNav) so the type scale (brand 20 / readout + nav 14 / tape + sync 11)
// and styling come for free. Two things differ from `/`'s HomeHeader:
//   1. The corpus numbers are passed IN (summary-gated, fetched once in the v2
//      route) rather than fetched here, so the masthead total + its four stage
//      segments are the SAME gated read as the v2 body — one number page-wide.
//   2. The single combined tape becomes a TWO-tape stack (MARKETS over SIGNALS),
//      each a presentation split of the one getLatestMarketTicks() feed.
// `/` (app/page.tsx + HomeHeader) is untouched.

// The two-tape symbol split (HO 251's 8-symbol set). Order here IS render order.
const MARKETS_TAPE = ["SPX", "NDQ", "TNX", "WTI"];
const SIGNALS_TAPE = ["SHUTDOWN", "FEDCUT", "CPI", "UNEMP"];

export function DashboardV2Header({
  corpus,
  stageDist,
}: {
  corpus: CorpusStats;
  // Structurally just needs the bars' stage + count; StageDistribution[] (which
  // also carries percentage) is assignable here.
  stageDist: { bars: { stage: Stage; count: number }[] };
}) {
  const stageCount = (stage: Stage) =>
    stageDist.bars.find((b) => b.stage === stage)?.count ?? 0;
  const committee = stageCount("committee");
  const floor = stageCount("floor");
  const otherChamber = stageCount("other_chamber");
  const enacted = stageCount("enacted");

  return (
    <header className="home-header">
      <div className="home-header-top">
        <div className="home-header-title">
          <div className="home-header-prompt-row">
            <BreadcrumbMasthead segments={["Dashboard"]} cursor={false} />

            <p className="home-stat-readout">
              <span className="stat-num stat-total">
                {corpus.total.toLocaleString()}
              </span>{" "}
              bills tracked
              <span className="stat-sep"> · </span>
              <span className="stat-num stat-committee">
                {committee.toLocaleString()}
              </span>{" "}
              in committee
              <span className="stat-sep"> · </span>
              <span className="stat-num stat-floor">
                {floor.toLocaleString()}
              </span>{" "}
              on the floor
              <span className="stat-sep"> · </span>
              <span className="stat-num stat-other">
                {otherChamber.toLocaleString()}
              </span>{" "}
              other chamber
              <span className="stat-sep"> · </span>
              <span className="stat-num stat-enacted">
                {enacted.toLocaleString()}
              </span>{" "}
              enacted
              <span
                className="home-cursor-caret home-readout-caret"
                aria-hidden
              >
                _
              </span>
            </p>
          </div>

          {/* Line 2: sync on its own line under the readout, 11px text-dim. */}
          <p className="home-header-meta">
            ·{" "}
            <span className="show-desktop">LAST SYNC </span>
            <CyclingTimestamp iso={corpus.lastSync} />
          </p>
        </div>
      </div>

      <MobileNavDrawer items={NAV_ITEMS} active="dashboard" />

      {/* Two stacked tapes — MARKETS (closes) over SIGNALS (always LIVE). */}
      <div className="dv2-tapes">
        <MarketsTape symbols={MARKETS_TAPE} kind="markets" />
        <MarketsTape symbols={SIGNALS_TAPE} kind="signals" />
      </div>

      <PrimaryNav active="dashboard" variant="home" />
    </header>
  );
}
