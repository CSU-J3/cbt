import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import { ColorKey } from "@/components/ColorKey";
import { HomeHeader } from "@/components/HomeHeader";
import { StageFunnel } from "@/components/StageFunnel";
import { TopicDistribution } from "@/components/TopicDistribution";
import { TopStalls } from "@/components/TopStalls";
import {
  type DashboardFilters,
  sanitizeStage,
  sanitizeTopic,
} from "@/lib/queries";

type SearchParams = {
  stage?: string;
  topics?: string;
};

// HO 131 dashboard redesign foundation. HomeHeader replaces the old
// `HeaderBar variant="dashboard"` chrome and folds DashboardLead into the
// header. Body is a 3x2 grid that fills the viewport without scrolling at
// 2560x1440 (primary) and 1920x1080 (secondary). Each quadrant is
// `overflow: hidden` so its content decides how many rows show — the
// cell does not impose a hardcoded row cap. TOPIC quadrant keeps an
// inner scroll until HO 132 swaps in the bubble chart. ACTIVITY quadrant
// shows whatever rows fit; HO 133 redesigns it with proper paging.
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

  return (
    <div className="home-shell">
      <HomeHeader />
      <ActiveFilterStrip filters={filters} />

      <main className="home-main">
        <div className="home-grid">
          <section className="home-quadrant">
            <p className="home-quadrant-label">Breaking · Last 72h</p>
            <div className="home-quadrant-body">
              <BreakingNewsBlock />
            </div>
          </section>

          <section className="home-quadrant">
            <p className="home-quadrant-label">Activity · Last 7 Days</p>
            <div className="home-quadrant-body">
              <ActivityTicker filters={filters} />
            </div>
          </section>

          <section className="home-quadrant">
            <p className="home-quadrant-label">Top Stalls</p>
            <div className="home-quadrant-body">
              <TopStalls />
            </div>
          </section>

          <section className="home-quadrant">
            <p className="home-quadrant-label">Stage Distribution</p>
            <div className="home-quadrant-body">
              <StageFunnel filters={filters} />
            </div>
          </section>

          <section className="home-quadrant">
            <p className="home-quadrant-label">Topic Distribution</p>
            <div className="home-quadrant-body home-quadrant-body--scroll">
              <TopicDistribution filters={filters} />
            </div>
          </section>

          <section className="home-quadrant">
            <p className="home-quadrant-label">Color Key</p>
            <div className="home-quadrant-body">
              <ColorKey />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
