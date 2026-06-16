import { BreadcrumbMasthead } from "@/components/BreadcrumbMasthead";
import { CyclingTimestamp } from "@/components/CyclingTimestamp";
import { MarketsTape } from "@/components/MarketsTape";
import { NAV_ITEMS, PrimaryNav } from "@/components/HeaderBar";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { getCorpusStats, getStageDistribution } from "@/lib/queries";
import type { Stage } from "@/lib/enums";

// Home-only header chrome. HO 244 redesign (commit 1):
//   Line 1: the 20px brand path (`Congressional Terminal:\119TH\Dashboard>`)
//     with, baseline-aligned after it, a 14px STAT READOUT — total + the four
//     headline stage counts, each number in its own color token. The blinking
//     amber cursor rides the END of the readout (desktop only).
//   Line 2 (under the brand): `· LAST SYNC <cycling stamp>` at 11px. The total
//     used to live here ("· N BILLS TRACKED") — it moved into the readout, so
//     the meta line is sync-only now (no double-print of the corpus total).
//   Tape: a single combined <MarketsTape /> between the masthead and the nav
//     (HO 234). Nav: the shared text-only path PrimaryNav (HO 230).
//
// The prose lead-in (getDashboardLead) was REMOVED here — the stat readout +
// the weekly band (commit 2) carry the glance answer, and the narrative
// survives via the weekly band's READ FULL → report. getDashboardLead() and
// its cron are intentionally LEFT INTACT (still generated each tick); they just
// render nowhere now. ORPHAN / cleanup-candidate — see HO 244 ship report.
//
// Readout predicate (Phase-1 check 2): total = getCorpusStats (non-ceremonial,
// includes unsummarized); the four segment counts = getStageDistribution.bars
// (same non-ceremonial set — getStageDistribution.total + offPath ===
// getCorpusStats.total by construction), so the readout is internally coherent.
// The dashboard↔inner-page divergence (inner pages also gate summary IS NOT
// NULL) is the pre-existing one the masthead-coherence diagnostic owns; not
// aligned here.
export async function HomeHeader() {
  const [corpus, stageDist] = await Promise.all([
    getCorpusStats(),
    getStageDistribution(),
  ]);

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
            {/* HO 244: the brand drops to 20px (was the 36px HO 162 hero) so the
                stat readout fits baseline-aligned after it. cursor={false} — the
                single caret now rides the readout end (below), not the path. */}
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
              {/* Desktop-only blinking caret at the readout's end. */}
              <span
                className="home-cursor-caret home-readout-caret"
                aria-hidden
              >
                _
              </span>
            </p>
          </div>

          {/* HO 157/183: 11px sync line; the time token cycles US zones
              (ET→CT→MT→PT→UTC) via CyclingTimestamp — the third named motion
              exception. Below 700px it drops the LAST SYNC affix via
              .show-desktop. The corpus total moved up into the readout. */}
          <p className="home-header-meta">
            ·{" "}
            <span className="show-desktop">LAST SYNC </span>
            <CyclingTimestamp iso={corpus.lastSync} />
          </p>
        </div>
      </div>

      <MobileNavDrawer items={NAV_ITEMS} active="dashboard" />

      {/* HO 234: one combined markets tape line (same single <MarketsTape />
          HeaderBar mounts), between the masthead and the nav. */}
      <MarketsTape />

      <PrimaryNav active="dashboard" variant="home" />
    </header>
  );
}
