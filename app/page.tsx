import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTabs } from "@/components/ActivityTabs";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import { CompetitiveRacesBlock } from "@/components/CompetitiveRacesBlock";
import {
  DashboardTopicTreemap,
  type TopicDatum,
} from "@/components/DashboardTopicTreemap";
import { DistributionsTabs } from "@/components/DistributionsTabs";
import { HomeHeader } from "@/components/HomeHeader";
import { StageFunnel } from "@/components/StageFunnel";
import { TopStalls } from "@/components/TopStalls";
import { WeeklyBand } from "@/components/WeeklyBand";
import {
  type DashboardFilters,
  getBreakingNewsForHomeCount,
  getStageChangesCount,
  getStageDistribution,
  getTopicDistribution,
  sanitizeStage,
  sanitizeTopic,
} from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

const TOP_STALLS_COUNT = 5;

// HO 150 layout: chrome stack (masthead + tape + nav) → full-width BREAKING
// strip → two-equal-column grid (left: STAGE over TOPIC bubbles; right:
// ACTIVITY / TOP STALLS tabs) → HO 153 reports-snapshot slot (reserved,
// empty). The HO 131/133/134 three-column no-scroll grid is gone — spec 1
// preserves the answer-above-fold (masthead prose + BREAKING) but lets the
// page scroll so the bubbles can breathe at full half-width.
//
// Click-to-filter (HO 132) is unchanged: funnel bars and topic bubbles
// push ?stage= / ?topics=; ACTIVITY and BREAKING both rebase to the
// filtered slice; bubble sizes rebase when STAGE is selected; the funnel
// rebases when TOPIC is selected. Lead stays corpus-wide.
type SearchParams = {
  stage?: string;
  topics?: string;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filters: DashboardFilters = {
    stage: sanitizeStage(sp.stage),
    topic: sanitizeTopic(sp.topics),
  };

  const [breakingCount, activityCount, stageDist, topicRows] =
    await Promise.all([
      getBreakingNewsForHomeCount({
        hours: 72,
        minConfidence: 0.7,
        filters,
      }),
      getStageChangesCount({}, 7, filters),
      getStageDistribution(filters),
      getTopicDistribution(filters),
    ]);

  // HO 180: each bubble carries its full category name for the hover popover
  // (per-topic colors mean the abbreviation alone no longer needs decoding from
  // a legend). The count rides the popover too; the old percentage-of-corpus
  // tooltip string was dropped with the native <title>.
  const topicData: TopicDatum[] = topicRows.map((t) => ({
    id: t.topic,
    label: topicLabel(t.topic),
    count: t.count,
    color: topicColor(t.topic),
    fullName: topicFullLabel(t.topic),
  }));

  return (
    <div className="home-shell">
      <HomeHeader />
      <ActiveFilterStrip filters={filters} />

      <main className="home-main">
        {/* HO 244 (commit 2): races moved to FULL WIDTH directly under the
            header (was the right-column top in HO 178). Both COMPETITIVE /
            PRIMARIES tabs (HO 233 RacesPanelTabs) move with it; no internal
            card changes. */}
        <CompetitiveRacesBlock />

        {/* HO 244 (commit 2): the weekly band — full-width, directly under
            races, divider rule above (its border-top). Replaces the HO 153
            ReportSnapshot teaser AND folds in the HO 232 standalone
            EnactedBanner (both removed). */}
        <WeeklyBand />

        {/* HO 244 (commit 2): two-column body below the weekly band. LEFT
            (56%): BREAKING → STAGE → TOPIC (the two distribution panels merge
            into one tabbed panel in commit 3). RIGHT (44%): the feed
            (MOVERS / TOP STALLS), now the only thing in the right column. */}
        <div className="home-grid">
          {/* LEFT column (56%) */}
          <div className="home-col-stack home-col-left">
            {/* HO 178: BREAKING moved from the full-width strip into the left
                column. home-breaking-panel marks it for the stage-5 hover-
                overrun (overflow override + cross-column dim). */}
            <section className="home-quadrant home-breaking-panel">
              <p
                className="home-quadrant-label"
                title="Recent news linked to tracked bills"
              >
                Breaking · Last 72h{" "}
                <span className="home-quadrant-label-count">
                  ({breakingCount.toLocaleString()})
                </span>
              </p>
              <BreakingNewsBlock filters={filters} />
            </section>

            {/* HO 244 (commit 3): the STAGE + TOPIC panels merge into ONE
                tabbed panel (STAGE DISTRIBUTION | TOPIC DISTRIBUTION, amber
                underline active) at a fixed compact height so the bars stay
                dense and the tab swap doesn't jump. The stage pane drops its
                StageKey legend — the funnel bars self-label. Neither chart is
                rebuilt. */}
            <section className="home-quadrant home-panel-distributions">
              <DistributionsTabs
                stageContent={<StageFunnel bars={stageDist.bars} />}
                topicContent={<DashboardTopicTreemap data={topicData} />}
              />
            </section>
          </div>

          {/* RIGHT column (44%) — the feed. Dims to 0.4 while a BREAKING row is
              hovered (HO 178: the overrun headline pops over it). */}
          <div className="home-col-stack home-col-right">
            <section className="home-quadrant">
              <ActivityTabs
                activityContent={<ActivityTicker filters={filters} />}
                stallsContent={<TopStalls />}
                activityCount={activityCount.total}
                stallsCount={TOP_STALLS_COUNT}
              />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
