"use client";

import { type ReactNode, useState } from "react";

// HO 133 / 134: client-side toggle across three home-page panes —
// BREAKING news, TOP STALLS, STAGE DIST. State is local (useState,
// not URL) because tab membership isn't a routable view — users may
// flip between the panes many times a session without wanting their
// browser history littered.
//
// HO 134 dropped the COLOR KEY tab; that legend now sits as a
// persistent strip below the home nav row (ColorKeyStrip).
type Tab = "breaking" | "stalls" | "stage";

export function BreakingStallsTabs({
  breakingContent,
  stallsContent,
  stageContent,
  breakingCount,
  stallsCount,
}: {
  breakingContent: ReactNode;
  stallsContent: ReactNode;
  stageContent: ReactNode;
  breakingCount: number;
  stallsCount: number;
}) {
  const [tab, setTab] = useState<Tab>("breaking");

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <nav
        className="search-tabs breaking-stalls-tabs"
        role="tablist"
        aria-label="Breaking news, top stalls, or stage distribution"
      >
        <button
          type="button"
          role="tab"
          aria-current={tab === "breaking" ? "page" : undefined}
          onClick={() => setTab("breaking")}
        >
          Breaking
          <span className="count">({breakingCount.toLocaleString()})</span>
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
        <button
          type="button"
          role="tab"
          aria-current={tab === "stage" ? "page" : undefined}
          onClick={() => setTab("stage")}
        >
          Stage Dist
        </button>
      </nav>

      <div className="flex flex-1 flex-col min-h-0">
        {tab === "breaking"
          ? breakingContent
          : tab === "stalls"
            ? stallsContent
            : stageContent}
      </div>
    </div>
  );
}
