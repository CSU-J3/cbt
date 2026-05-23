import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import { DashboardLead } from "@/components/DashboardLead";
import { HeaderBar } from "@/components/HeaderBar";
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

// HO 126 home reorganization. Above the fold: LEAD + BREAKING. Below: a
// 2x2 balanced grid of STAGE DIST / ACTIVITY / TOP STALLS / TOPIC DIST.
// The lower-half SVG charts (HO 66 BillsTimeSeries + HO 76 TopicMix) moved
// to /trends; the CompetitiveRacesBlock was retired entirely (full
// coverage at /races). JUMP TO went away with SubViewLinkStrip — the top
// nav already covers every destination it linked to.
//
// BillRow / TopStalls / StagePillStrip vocabulary from HO 125 carries
// through. TOP STALLS uses a minimal one-line row (rather than compact
// BillRow) because the 2x2 quadrant width is too narrow for a 3-line
// stacked content column.
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
    <div className="flex min-h-screen flex-col">
      <HeaderBar variant="dashboard" />
      <DashboardLead />
      <BreakingNewsBlock />
      <ActiveFilterStrip filters={filters} />

      <main className="w-full flex-1 px-4 py-4">
        <div className="dashboard-grid">
          <section className="dashboard-pane">
            <p className="dashboard-pane-label">Stage Distribution</p>
            <StageFunnel filters={filters} />
          </section>

          <section className="dashboard-pane">
            <p className="dashboard-pane-label">Activity · Last 7 Days</p>
            <ActivityTicker filters={filters} />
          </section>

          <section className="dashboard-pane">
            <p className="dashboard-pane-label">Top Stalls</p>
            <TopStalls />
          </section>

          <section className="dashboard-pane">
            <p className="dashboard-pane-label">Topic Distribution</p>
            <TopicDistribution filters={filters} />
          </section>
        </div>
      </main>
    </div>
  );
}
