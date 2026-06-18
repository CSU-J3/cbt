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
//
// HO 272 — this island also owns the RACES-tab update state: it provides
// RacesUpdatesContext (the localStorage "last opened RACES" timestamp + a
// moved-race registry) so the per-card RaceMovedIndicators can both render and
// register, and renders the MOVES badge (= registry size) on the RACES tab. The
// NEW badge slot is dark until the news→race linkage lands. Keeping both panels
// mounted means the (hidden) RACES cards still register, so MOVES shows while the
// user sits on HEARINGS. Opening RACES marks-viewed → registry clears → badge 0.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { RacesUpdatesContext } from "@/components/RacesUpdatesContext";

type TopTab = "hearings" | "races";

const LAST_VIEW_KEY = "cbt:racesLastView";

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

  // null until hydrated; 0 on first visit (count every real move), else the ms
  // epoch of the last RACES open. Read from localStorage after mount so server
  // and first client render agree (both render no badges).
  const [lastViewMs, setLastViewMs] = useState<number | null>(null);
  const [movedSet, setMovedSet] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const raw = window.localStorage.getItem(LAST_VIEW_KEY);
    setLastViewMs(raw ? Number(raw) : 0);
  }, []);

  const registerMoved = useCallback((raceId: string) => {
    setMovedSet((prev) => {
      if (prev.has(raceId)) return prev;
      const next = new Set(prev);
      next.add(raceId);
      return next;
    });
  }, []);
  const unregisterMoved = useCallback((raceId: string) => {
    setMovedSet((prev) => {
      if (!prev.has(raceId)) return prev;
      const next = new Set(prev);
      next.delete(raceId);
      return next;
    });
  }, []);

  const openTab = useCallback((next: TopTab) => {
    setTab(next);
    // Opening RACES marks it viewed: stamp now so every card's "moved since" goes
    // false (effects unregister → MOVES badge clears). HEARINGS doesn't reset.
    if (next === "races") {
      const now = Date.now();
      window.localStorage.setItem(LAST_VIEW_KEY, String(now));
      setLastViewMs(now);
    }
  }, []);

  const movesCount = movedSet.size;
  const newCount = 0; // NEW = news→race linkage (absent); slot stays dark (HO 272).

  return (
    <RacesUpdatesContext.Provider
      value={{ lastViewMs, registerMoved, unregisterMoved }}
    >
      <section className="dv2-racesbox" aria-label="Hearings and races">
        <nav
          className="dv2-racesbox-tabs"
          role="tablist"
          aria-label="Hearings or races"
        >
          <button
            type="button"
            role="tab"
            aria-current={tab === "hearings" ? "page" : undefined}
            className={`dv2-racesbox-tab${tab === "hearings" ? " is-active" : ""}`}
            onClick={() => openTab("hearings")}
          >
            Hearings
          </button>
          <button
            type="button"
            role="tab"
            aria-current={tab === "races" ? "page" : undefined}
            className={`dv2-racesbox-tab${tab === "races" ? " is-active" : ""}`}
            onClick={() => openTab("races")}
          >
            Races
            {movesCount > 0 ? (
              <span className="rbx-badge rbx-badge-moves">
                Moves {movesCount}
              </span>
            ) : null}
            {newCount > 0 ? (
              <span className="rbx-badge rbx-badge-new">New {newCount}</span>
            ) : null}
          </button>
        </nav>

        {/* Both mounted; inactive hidden so nested sub-tab state + the hidden
            RACES cards' move-registration persist. */}
        <div className="dv2-racesbox-panel" hidden={tab !== "hearings"}>
          {hearingsContent}
        </div>
        <div className="dv2-racesbox-panel" hidden={tab !== "races"}>
          {racesContent}
        </div>
      </section>
    </RacesUpdatesContext.Provider>
  );
}
