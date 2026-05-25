"use client";

import { type ReactNode, useState } from "react";

// HO 132: replaces BreakingStallsTabs on row 1 right. TOP STALLS was
// lifted out of the old BREAKING quadrant and joins ACTIVITY here as
// a sibling tab. State is local — tab membership isn't a routable
// view, same rationale as the prior BreakingStallsTabs.
//
// Tab counts: ACTIVITY shows total stage changes (last 7d), TOP
// STALLS shows the row cap (5). Both fed in from page.tsx so the
// client island stays free of data fetches.
type Tab = "activity" | "stalls";

export function ActivityTabs({
  activityContent,
  stallsContent,
  activityCount,
  stallsCount,
}: {
  activityContent: ReactNode;
  stallsContent: ReactNode;
  activityCount: number;
  stallsCount: number;
}) {
  const [tab, setTab] = useState<Tab>("activity");

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <nav
        className="search-tabs breaking-stalls-tabs"
        role="tablist"
        aria-label="Activity or top stalls"
      >
        <button
          type="button"
          role="tab"
          aria-current={tab === "activity" ? "page" : undefined}
          onClick={() => setTab("activity")}
        >
          Activity
          <span className="count">({activityCount.toLocaleString()})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-current={tab === "stalls" ? "page" : undefined}
          onClick={() => setTab("stalls")}
        >
          Top Stalls
          <span className="count">({stallsCount.toLocaleString()})</span>
        </button>
      </nav>

      <div className="flex flex-1 flex-col min-h-0">
        {tab === "activity" ? activityContent : stallsContent}
      </div>
    </div>
  );
}
