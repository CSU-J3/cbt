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
// HO 807: TOP STALLS' count is now the stale set's size
// (getStaleBillsCount), not the row cap, which HO 627 raised to 60
// while the badge kept reading 5.
//
// HO 232 (design item 5, absorbed in place): the left tab was renamed
// ACTIVITY → MOVERS. The tab already ran the /changes stage-transition
// predicate (getStageChanges), so it WAS the movers feed — a separate
// MOVERS tab would have been a twin. Only the label + tab identifier
// changed here; the from→to arrow rendering + hop-count sort land
// together in the future log-accrual handoff (stage_transitions, planted
// write-only in this same HO). The activityContent/Count props keep their
// names — they're the parent's wiring contract, not the tab's identity.
//
// HO 249: third tab NEW THIS WEEK added (newContent/newCount), completing
// the redesign spec's MOVERS / TOP STALLS / NEW THIS WEEK feed. newCount is
// getNewBillsThisWeekCount — the same window its row list uses, so the label
// can't drift from the rows. Still data-fetch-free here; content is wired in.
//
// HO 642: `filterSlot` renders INSIDE this nav, after the three tab buttons and
// separated by a dim middot — packed left against the last tab, never anchored to
// the panel's right edge (C1). It is a rendered node, not data: the page builds
// the chamber <Link>s server-side so the toggle is real navigation and the state
// is shareable, and this island stays free of both data fetches and URL logic.
// HO 797 moved the slot out of the nav to its own row.
//
// HO 797: the order is NEW THIS WEEK / MOVERS / TOP STALLS, and the page chooses
// the open tab through `initialTab` (app/page.tsx says when it is MOVERS). The
// chamber selector is its own row under the strip, `.feed-chamber-row`, in the
// /hearings filter idiom: docs/design/mock-797-feed-tabs.html (ruled: option C).
export type Tab = "movers" | "stalls" | "new";

export function ActivityTabs({
  activityContent,
  stallsContent,
  newContent,
  activityCount,
  stallsCount,
  newCount,
  filterSlot,
  initialTab,
}: {
  activityContent: ReactNode;
  stallsContent: ReactNode;
  newContent: ReactNode;
  activityCount: number;
  stallsCount: number;
  newCount: number;
  filterSlot?: ReactNode;
  initialTab: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <nav
        className="search-tabs breaking-stalls-tabs"
        role="tablist"
        aria-label="New this week, movers, or top stalls"
      >
        <button
          type="button"
          role="tab"
          aria-current={tab === "new" ? "page" : undefined}
          onClick={() => setTab("new")}
        >
          New This Week
          <span className="count">({newCount.toLocaleString()})</span>
        </button>
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
      {filterSlot ? <div className="feed-chamber-row">{filterSlot}</div> : null}

      <div className="flex flex-1 flex-col min-h-0">
        {tab === "movers"
          ? activityContent
          : tab === "stalls"
            ? stallsContent
            : newContent}
      </div>
    </div>
  );
}
