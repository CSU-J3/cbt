"use client";

import { type ReactNode, useState } from "react";

// HO 244 (commit 3) — merges the two separate STAGE / TOPIC distribution
// panels into ONE tabbed panel in the left column. Same idiom as ActivityTabs
// (MOVERS / TOP STALLS): a `search-tabs breaking-stalls-tabs` strip with the
// amber-underline active state, and only the active pane mounted so switching
// to TOPIC mounts the treemap fresh and it renders at the panel's width (the
// treemap is SVG-viewBox responsive — no JS measure needed).
//
// The panel body is a FIXED height (.distributions-panel-body, ~230px) so the
// bars stay dense AND the tab swap doesn't jump. Neither chart is rebuilt —
// stageContent is the existing StageFunnel (no legend row; the bars self-label),
// topicContent the existing DashboardTopicTreemap.
type Tab = "stage" | "topic";

export function DistributionsTabs({
  stageContent,
  topicContent,
}: {
  stageContent: ReactNode;
  topicContent: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("stage");

  return (
    <div className="distributions-tabs flex flex-col min-h-0">
      <nav
        className="search-tabs breaking-stalls-tabs"
        role="tablist"
        aria-label="Stage or topic distribution"
      >
        <button
          type="button"
          role="tab"
          aria-current={tab === "stage" ? "page" : undefined}
          onClick={() => setTab("stage")}
        >
          Stage Distribution
        </button>
        <button
          type="button"
          role="tab"
          aria-current={tab === "topic" ? "page" : undefined}
          onClick={() => setTab("topic")}
        >
          Topic Distribution
        </button>
      </nav>

      <div className="distributions-panel-body">
        {tab === "stage" ? stageContent : topicContent}
      </div>
    </div>
  );
}
