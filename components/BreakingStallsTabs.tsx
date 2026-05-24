"use client";

import { type ReactNode, useState } from "react";

// HO 133: client-side toggle between the BREAKING news block and the TOP
// STALLS block inside a single home-page quadrant. State is local
// (useState, not URL) because tab membership isn't a routable view —
// users may flip between the two views many times a session without
// wanting their browser history littered. Different scope from HO 129's
// /search tabs, which are routable surfaces.
//
// Server side passes both blocks as pre-rendered children so the client
// island doesn't need to know how to fetch BreakingNewsBlock or
// TopStalls — both are async server components, and dragging them
// across a "use client" boundary would defeat the RSC pattern.
type Tab = "breaking" | "stalls";

export function BreakingStallsTabs({
  breakingContent,
  stallsContent,
  breakingCount,
  stallsCount,
}: {
  breakingContent: ReactNode;
  stallsContent: ReactNode;
  breakingCount: number;
  stallsCount: number;
}) {
  const [tab, setTab] = useState<Tab>("breaking");

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <nav
        className="search-tabs breaking-stalls-tabs"
        role="tablist"
        aria-label="Breaking news or top stalls"
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
      </nav>

      <div className="flex flex-1 flex-col min-h-0">
        {tab === "breaking" ? breakingContent : stallsContent}
      </div>
    </div>
  );
}
