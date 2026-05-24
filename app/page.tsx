import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import { BreakingStallsTabs } from "@/components/BreakingStallsTabs";
import { HomeHeader } from "@/components/HomeHeader";
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

// HO 133 dashboard layout pivot v2. STAGE DISTRIBUTION and COLOR KEY
// moved from grid quadrants into the header band; BREAKING + TOP STALLS
// merged into a single tabbed quadrant via `BreakingStallsTabs`. The
// remaining grid is 2x2 conceptually but visually 2 cols x (1 + full-
// width) rows: row 1 = tabs | activity, row 2 = topic distribution
// spanning both columns. BREAKING and ACTIVITY both cap at 5 rows + an
// `[ + N MORE → ]` expander linking to /news and /changes respectively.
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
      <HomeHeader filters={filters} />
      <ActiveFilterStrip filters={filters} />

      <main className="home-main">
        <div className="home-grid">
          <section className="home-quadrant">
            <BreakingStallsTabs
              breakingContent={<BreakingNewsBlock />}
              stallsContent={<TopStalls />}
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
