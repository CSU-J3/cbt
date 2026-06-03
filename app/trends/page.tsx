import { BillsTimeSeries } from "@/components/BillsTimeSeries";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { TopicMixByChamber } from "@/components/TopicMixByChamber";

// HO 126 — destination for the two SVG charts (HO 66 BillsTimeSeries + HO 76
// TopicMixByChamber) relocated off the home page. Both are corpus-wide
// reads, no filter controls; the page is a "data lens" surface a reader
// opts into rather than a dashboard widget surface that loads on every
// home visit. Mobile collapses the section padding via the existing
// .dashboard-pane responsive rules.

export default function TrendsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/trends" />

      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="patterns" active="trends" />

        <section
          className="dashboard-pane mb-3"
          style={{ backgroundColor: "var(--bg-panel)" }}
        >
          <p className="dashboard-pane-label">Bills introduced per month</p>
          <BillsTimeSeries />
        </section>

        <TopicMixByChamber />
      </main>
    </div>
  );
}
