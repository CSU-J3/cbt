"use client";

import { type ReactNode, useState } from "react";

// HO 233 — tab shell on the dashboard races panel (design item 8). Mirrors the
// ActivityTabs idiom (search-tabs / breaking-stalls-tabs markup, same active
// treatment): both views are server-rendered and passed in as ReactNode props,
// so this island holds only the toggle. COMPETITIVE is the default.
//
// The panel chrome (.dashboard-pane .home-races-pane) moved HERE from
// CompetitiveRacesStrip so the SAME element is still the popover's containment
// box (position:relative + overflow:hidden) — COMPETITIVE's hover-popover
// confinement (HO 230) is unchanged. The .races-panel-body min-height keeps the
// pane the same height on both tabs so the right column doesn't jump.
type Tab = "competitive" | "primaries";

export function RacesPanelTabs({
  competitiveContent,
  primariesContent,
  competitiveCount,
  primariesCount,
}: {
  competitiveContent: ReactNode;
  primariesContent: ReactNode;
  competitiveCount: number;
  primariesCount: number;
}) {
  const [tab, setTab] = useState<Tab>("competitive");

  return (
    <section className="dashboard-pane home-races-pane">
      <nav
        className="search-tabs breaking-stalls-tabs"
        role="tablist"
        aria-label="Competitive races or primaries"
      >
        <button
          type="button"
          role="tab"
          aria-current={tab === "competitive" ? "page" : undefined}
          onClick={() => setTab("competitive")}
        >
          Competitive
          <span className="count">({competitiveCount.toLocaleString()})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-current={tab === "primaries" ? "page" : undefined}
          onClick={() => setTab("primaries")}
        >
          Primaries
          <span className="count">({primariesCount.toLocaleString()})</span>
        </button>
      </nav>

      <div className="races-panel-body">
        {tab === "competitive" ? competitiveContent : primariesContent}
      </div>
    </section>
  );
}
