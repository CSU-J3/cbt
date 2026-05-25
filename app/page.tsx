import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTabs } from "@/components/ActivityTabs";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import {
  type BubbleDatum,
  DashboardBubbleChart,
} from "@/components/DashboardBubbleChart";
import { HomeHeader } from "@/components/HomeHeader";
import { TopStalls } from "@/components/TopStalls";
import { STAGE_LABELS, type Stage } from "@/lib/enums";
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

const STAGE_BUBBLE_LABELS: Record<Stage, string> = {
  introduced: "INTRO",
  committee: "COMMITTEE",
  floor: "FLOOR",
  other_chamber: "OTHER CHAMBER",
  president: "PRESIDENT",
  enacted: "ENACTED",
};

const STAGE_BUBBLE_COLORS: Record<Stage, string> = {
  introduced: "var(--stage-introduced)",
  committee: "var(--stage-committee)",
  floor: "var(--stage-floor)",
  other_chamber: "var(--stage-other-chamber)",
  president: "var(--stage-president)",
  enacted: "var(--stage-enacted)",
};

type SearchParams = {
  stage?: string;
  topics?: string;
};

// HO 132 dashboard layout. Row 1: BREAKING single-view | ACTIVITY +
// STALLS tabs. Row 2: STAGE DISTRIBUTION bubbles | TOPIC DISTRIBUTION
// bubbles, 50/50. Both bubble charts feed off the existing
// getStageDistribution / getTopicDistribution queries and link to
// /feed with the appropriate filter param (?stage= or ?topics=).
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

  const [breakingCount, activityCount, stageDist, topicRows] = await Promise.all([
    getBreakingNewsForHomeCount({ hours: 72, minConfidence: 0.7 }),
    getStageChangesCount({}, 7),
    getStageDistribution(filters),
    getTopicDistribution(filters),
  ]);

  // getStageDistribution returns all 6 FUNNEL_STAGES (zero-filled), so
  // president stays in the chart at zero-count rendering when it's empty.
  const stageData: BubbleDatum[] = stageDist.bars.map((b) => ({
    id: b.stage,
    label: STAGE_BUBBLE_LABELS[b.stage],
    count: b.count,
    color: STAGE_BUBBLE_COLORS[b.stage],
    tooltip: `${STAGE_LABELS[b.stage]} — ${b.count.toLocaleString()} bills`,
  }));

  const topicData: BubbleDatum[] = topicRows.map((t) => ({
    id: t.topic,
    label: topicLabel(t.topic),
    count: t.count,
    color: topicColor(t.topic),
    tooltip: `${topicFullLabel(t.topic)} — ${t.count.toLocaleString()} bills`,
  }));

  return (
    <div className="home-shell">
      <HomeHeader />
      <ActiveFilterStrip filters={filters} />

      <main className="home-main">
        <div className="home-grid">
          <section className="home-quadrant">
            <p className="home-quadrant-label">
              Breaking · Last 72h{" "}
              <span className="home-quadrant-label-count">
                ({breakingCount.toLocaleString()})
              </span>
            </p>
            <div className="home-quadrant-body">
              <BreakingNewsBlock />
            </div>
          </section>

          <section className="home-quadrant">
            <ActivityTabs
              activityContent={<ActivityTicker filters={filters} />}
              stallsContent={<TopStalls />}
              activityCount={activityCount.total}
              stallsCount={TOP_STALLS_COUNT}
            />
          </section>

          <section className="home-quadrant">
            <p className="home-quadrant-label">Stage Distribution</p>
            <div className="home-quadrant-body">
              <DashboardBubbleChart data={stageData} paramKey="stage" />
            </div>
          </section>

          <section className="home-quadrant">
            <p className="home-quadrant-label">Topic Distribution</p>
            <div className="home-quadrant-body">
              <DashboardBubbleChart data={topicData} paramKey="topics" />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
