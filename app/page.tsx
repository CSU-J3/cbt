import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import { BreakingStallsTabs } from "@/components/BreakingStallsTabs";
import { HomeHeader } from "@/components/HomeHeader";
import { StageFunnel } from "@/components/StageFunnel";
import { TopicDistribution } from "@/components/TopicDistribution";
import { TopStalls } from "@/components/TopStalls";
import {
  type DashboardFilters,
  getBreakingNewsForHomeCount,
  sanitizeStage,
  sanitizeTopic,
} from "@/lib/queries";

const TOP_STALLS_COUNT = 5;

type SearchParams = {
  stage?: string;
  topics?: string;
};

// HO 133 / 134 dashboard layout. Header band carries title stack +
// nav row + persistent COLOR KEY stages strip (HO 134). Grid is
// 2 cols x (1 + full-width) rows: row 1 = 3-tab quadrant (BREAKING /
// TOP STALLS / STAGE DIST) | ACTIVITY, row 2 = TOPIC DISTRIBUTION
// spanning both columns. BREAKING and ACTIVITY cap at 5 rows + an
// `[ + N MORE → ]` expander linking to /news and /changes
// respectively. Default tab stays BREAKING.
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

  const breakingCount = await getBreakingNewsForHomeCount({
    hours: 72,
    minConfidence: 0.7,
  });

  return (
    <div className="home-shell">
      <HomeHeader />
      <ActiveFilterStrip filters={filters} />

      <main className="home-main">
        <div className="home-grid">
          <section className="home-quadrant">
            <BreakingStallsTabs
              breakingContent={<BreakingNewsBlock />}
              stallsContent={<TopStalls />}
              stageContent={<StageFunnel filters={filters} />}
              breakingCount={breakingCount}
              stallsCount={TOP_STALLS_COUNT}
            />
          </section>

          <section className="home-quadrant">
            <p className="home-quadrant-label">Activity · Last 7 Days</p>
            <div className="home-quadrant-body">
              <ActivityTicker filters={filters} />
            </div>
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
