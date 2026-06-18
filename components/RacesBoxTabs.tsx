"use client";

// HO 270 (Piece 1 of 3) — the v2 races box becomes a tabbed box with HEARINGS |
// RACES top tabs. Mirrors the ActivityTabs / RacesPanelTabs idiom: both panels
// are server-rendered and passed in as ReactNode props, so this island holds
// only the top-tab toggle.
//
// Both panels stay MOUNTED (the inactive one hidden via the `hidden` attribute,
// not unmounted) so the RACES panel's nested COMPETITIVE|PRIMARIES sub-tab state
// (RacesPanelTabs useState) survives HEARINGS↔RACES switches — the locked
// "sub-tab remembers its position" decision (HO 270 Phase 1).
import { type ReactNode, useState } from "react";

type TopTab = "hearings" | "races";

export function RacesBoxTabs({
  hearingsContent,
  racesContent,
  defaultTab = "hearings",
}: {
  hearingsContent: ReactNode;
  racesContent: ReactNode;
  defaultTab?: TopTab;
}) {
  const [tab, setTab] = useState<TopTab>(defaultTab);

  return (
    <section className="dv2-racesbox" aria-label="Hearings and races">
      <nav className="dv2-racesbox-tabs" role="tablist" aria-label="Hearings or races">
        <button
          type="button"
          role="tab"
          aria-current={tab === "hearings" ? "page" : undefined}
          className={`dv2-racesbox-tab${tab === "hearings" ? " is-active" : ""}`}
          onClick={() => setTab("hearings")}
        >
          Hearings
        </button>
        <button
          type="button"
          role="tab"
          aria-current={tab === "races" ? "page" : undefined}
          className={`dv2-racesbox-tab${tab === "races" ? " is-active" : ""}`}
          onClick={() => setTab("races")}
        >
          Races
        </button>
      </nav>

      {/* Both mounted; inactive hidden so nested sub-tab state persists. */}
      <div className="dv2-racesbox-panel" hidden={tab !== "hearings"}>
        {hearingsContent}
      </div>
      <div className="dv2-racesbox-panel" hidden={tab !== "races"}>
        {racesContent}
      </div>
    </section>
  );
}
