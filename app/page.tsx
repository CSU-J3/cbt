import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTicker } from "@/components/ActivityTicker";
import { DashboardLead } from "@/components/DashboardLead";
import { HeaderBar } from "@/components/HeaderBar";
import { StageFunnel } from "@/components/StageFunnel";
import { SubViewLinkStrip } from "@/components/SubViewLinkStrip";
import { TopicDistribution } from "@/components/TopicDistribution";
import {
  type DashboardFilters,
  sanitizeStage,
  sanitizeTopic,
} from "@/lib/queries";

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

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar variant="dashboard" />
      <DashboardLead />
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

          <div className="dashboard-right">
            <section className="dashboard-pane">
              <p className="dashboard-pane-label">Jump To</p>
              <SubViewLinkStrip />
            </section>
            <section className="dashboard-pane">
              <p className="dashboard-pane-label">Topic Distribution</p>
              <TopicDistribution filters={filters} />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
