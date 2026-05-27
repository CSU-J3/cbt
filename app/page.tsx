import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTabs } from "@/components/ActivityTabs";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import {
  type BubbleDatum,
  DashboardBubbleChart,
} from "@/components/DashboardBubbleChart";
import { HomeHeader } from "@/components/HomeHeader";
import { StageFunnel } from "@/components/StageFunnel";
import { TopStalls } from "@/components/TopStalls";
import {
  type DashboardFilters,
  getBreakingNewsForHomeCount,
  getCorpusStats,
  getStageChangesCount,
  getStageDistribution,
  getTopicDistribution,
  sanitizeStage,
  sanitizeTopic,
} from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

const TOP_STALLS_COUNT = 5;

// Home-dashboard-cleanup layout. Three-column grid:
//   Col 1 (1.2fr) — STAGE DISTRIBUTION funnel (220px fixed) stacked
//                  over TOPIC DISTRIBUTION bubbles (flex-1).
//   Col 2 (1fr)   — ACTIVITY / TOP STALLS tabs.
//   Col 3 (1fr)   — BREAKING · LAST 72H.
//
// Drawer pattern dropped: clicks on a funnel row or a topic bubble
// rebase the dashboard in place. ACTIVITY and BREAKING both rebase
// (count + rows) to the filtered slice; the bubble chart rebases sizes
// when STAGE is selected; the funnel rebases counts when TOPIC is
// selected. Lead in the header stays corpus-wide (per HO 57).
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

  const [breakingCount, activityCount, stageDist, topicRows, corpus] =
    await Promise.all([
      getBreakingNewsForHomeCount({
        hours: 72,
        minConfidence: 0.7,
        filters,
      }),
      getStageChangesCount({}, 7, filters),
      getStageDistribution(filters),
      getTopicDistribution(filters),
      getCorpusStats(),
    ]);

  // Topic-bubble tooltip carries percentage of the (corpus-wide,
  // non-ceremonial) total — distinct from the topic-distribution
  // query's count, which is a *tag count* (bills can have multiple
  // topics). Percentage uses corpus.total as the denominator so the
  // number reads as "share of all bills tagged with this topic."
  const corpusTotal = corpus.total;
  const topicData: BubbleDatum[] = topicRows.map((t) => {
    const pct = corpusTotal > 0 ? (t.count / corpusTotal) * 100 : 0;
    return {
      id: t.topic,
      label: topicLabel(t.topic),
      count: t.count,
      color: topicColor(t.topic),
      tooltip: `${topicFullLabel(t.topic)} · ${t.count.toLocaleString()} bills · ${pct.toFixed(1)}%`,
    };
  });

  return (
    <div className="home-shell">
      <HomeHeader />
      <ActiveFilterStrip filters={filters} />

      <main className="home-main">
        <div className="home-grid">
          {/* Col 1: STAGE funnel + TOPIC bubbles stacked */}
          <div className="home-col-stack">
            <section className="home-quadrant home-panel-stage">
              <p
                className="home-quadrant-label"
                title="All bills by current legislative stage"
              >
                Stage Distribution
              </p>
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
              <div className="home-quadrant-body">
                <DashboardBubbleChart data={topicData} paramKey="topics" />
              </div>
            </section>
          </div>

          {/* Col 2: ACTIVITY / TOP STALLS tabs */}
          <section className="home-quadrant">
            <ActivityTabs
              activityContent={<ActivityTicker filters={filters} />}
              stallsContent={<TopStalls />}
              activityCount={activityCount.total}
              stallsCount={TOP_STALLS_COUNT}
            />
          </section>

          {/* Col 3: BREAKING · LAST 72H */}
          <section className="home-quadrant">
            <p
              className="home-quadrant-label"
              title="Recent news linked to tracked bills"
            >
              Breaking · Last 72h{" "}
              <span className="home-quadrant-label-count">
                ({breakingCount.toLocaleString()})
              </span>
            </p>
            <div className="home-quadrant-body">
              <BreakingNewsBlock filters={filters} />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
