import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTabs } from "@/components/ActivityTabs";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import { StageKey } from "@/components/ColorKeyStrip";
import { CompetitiveRacesBlock } from "@/components/CompetitiveRacesBlock";
import {
  DashboardTopicTreemap,
  type TopicDatum,
} from "@/components/DashboardTopicTreemap";
import { EnactedBanner } from "@/components/EnactedBanner";
import { HomeHeader } from "@/components/HomeHeader";
import { ReportSnapshot } from "@/components/ReportSnapshot";
import { StageFunnel } from "@/components/StageFunnel";
import { TopStalls } from "@/components/TopStalls";
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
        {/* HO 178 decision 2: the HO 153 weekly-report snapshot stays a
            full-width band above the 56/44 grid (the spec didn't relocate it).
            Returns null when zero reports exist, leaving the slot empty. */}
        <div className="home-snapshot-slot">
          <ReportSnapshot />
        </div>

        {/* HO 232 (design item 6): ENACTED THIS WEEK band, directly under the
            weekly-report snapshot and above the grid. Always renders — the N=0
            state is intentionally visible (muted). */}
        <EnactedBanner />

        {/* HO 178: 56/44 two-column body. LEFT (56%): BREAKING → STAGE →
            TOPIC. RIGHT (44%): COMPETITIVE RACES (2×2 hover) → ACTIVITY. */}
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

            <section className="home-quadrant home-panel-stage">
              <p
                className="home-quadrant-label"
                title="All bills by current legislative stage"
              >
                Stage Distribution
              </p>
              {/* HO 167: STAGES key sits with the funnel it decodes — under
                  the label, above the body, so it's visible without scrolling
                  past the chart. */}
              <StageKey />
              <div className="home-quadrant-body">
                <StageFunnel bars={stageDist.bars} />
              </div>
            </section>

            <section className="home-quadrant home-panel-topic">
              <p
                className="home-quadrant-label"
                title="All bills by topic tag"
              >
                Topic Distribution
              </p>
              {/* HO 180: the TOPICS group legend (TopicKey) was removed — bubbles
                  are now per-topic colored and the hover popover decodes them. */}
              <div className="home-quadrant-body">
                <DashboardTopicTreemap data={topicData} />
              </div>
            </section>
          </div>

          {/* RIGHT column (44%) — dims to 0.4 while a BREAKING row is hovered
              (HO 178: the overrun headline pops over it). */}
          <div className="home-col-stack home-col-right">
            {/* HO 178: races moved from a full-width strip into the right
                column; stage 4 converts it to a 2×2 grid + hover popover. */}
            <CompetitiveRacesBlock />

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
