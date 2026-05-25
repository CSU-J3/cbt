import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTabs } from "@/components/ActivityTabs";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import { HomeHeader } from "@/components/HomeHeader";
import { TopicDistribution } from "@/components/TopicDistribution";
import { TopStalls } from "@/components/TopStalls";
import {
  type DashboardFilters,
  getBreakingNewsForHomeCount,
  getStageChangesCount,
  sanitizeStage,
  sanitizeTopic,
} from "@/lib/queries";

const TOP_STALLS_COUNT = 5;

type SearchParams = {
  stage?: string;
  topics?: string;
};

// HO 132 dashboard layout. Row 1: BREAKING single-view (no tab strip,
// label-only header) | ACTIVITY tabs (ACTIVITY default, TOP STALLS
// reachable). Row 2 still holds the TOPIC DISTRIBUTION bar chart for
// this commit (commit A); commit C swaps it for the stage + topic
// bubble pair sized 50/50.
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

  const [breakingCount, activityCount] = await Promise.all([
    getBreakingNewsForHomeCount({ hours: 72, minConfidence: 0.7 }),
    getStageChangesCount({}, 7),
  ]);

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

          <section className="home-quadrant home-quadrant--topic">
            <p className="home-quadrant-label">Topic Distribution</p>
            <div className="home-quadrant-body home-quadrant-body--scroll">
              <TopicDistribution filters={filters} />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
