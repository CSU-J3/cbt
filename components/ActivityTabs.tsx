"use client";

import { type ReactNode, useState } from "react";

// HO 132: replaces BreakingStallsTabs on row 1 right. TOP STALLS was
// lifted out of the old BREAKING quadrant and joins MOVERS here as
// a sibling tab. State is local — tab membership isn't a routable
// view, same rationale as the prior BreakingStallsTabs.
//
// Tab counts: MOVERS shows total stage changes (last 7d), TOP
// STALLS shows the row cap (5). Both fed in from page.tsx so the
// client island stays free of data fetches.
//
// HO 232 (design item 5, absorbed in place): the left tab was renamed
// ACTIVITY → MOVERS. The tab already ran the /changes stage-transition
// predicate (getStageChanges), so it WAS the movers feed — a separate
// MOVERS tab would have been a twin. Only the label + tab identifier
// changed here; the from→to arrow rendering + hop-count sort land
// together in the future log-accrual handoff (stage_transitions, planted
// write-only in this same HO). The activityContent/Count props keep their
// names — they're the parent's wiring contract, not the tab's identity.
type Tab = "movers" | "stalls";

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
  const [tab, setTab] = useState<Tab>("movers");

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <nav
        className="search-tabs breaking-stalls-tabs"
        role="tablist"
        aria-label="Movers or top stalls"
      >
        <button
          type="button"
          role="tab"
          aria-current={tab === "movers" ? "page" : undefined}
          onClick={() => setTab("movers")}
        >
          Movers
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
        {tab === "movers" ? activityContent : stallsContent}
      </div>
    </div>
  );
}
