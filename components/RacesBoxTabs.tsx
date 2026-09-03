"use client";

// HO 270 (Piece 1 of 3) — the v2 races box becomes a tabbed box with HEARINGS |
// RACES top tabs. Mirrors the ActivityTabs idiom: both panels are
// server-rendered and passed in as ReactNode props, so this island holds only
// the top-tab toggle.
//
// Both panels stay MOUNTED (the inactive one hidden via the `hidden` attribute,
// not unmounted). HALF OF THAT RATIONALE IS NOW DEAD, and saying so is the point
// (HO 657): it was written to preserve the RACES panel's nested
// COMPETITIVE|PRIMARIES sub-tab state across HEARINGS↔RACES switches, and those
// sub-tabs — with RacesPanelTabs itself — were deleted when the panel merged to
// one body. There is no nested tab position left to remember. What survives is
// the cheaper reason to keep mounting: the panels hold client state worth not
// discarding (this island's own RacesUpdatesContext registries below).
//
// AND DO NOT CREDIT `.races-panel-body`'s min-height with steadying this flip —
// measured at HO 657, the box goes 980px on RACES to 102px on HEARINGS, so the
// flip jumps by design and always did. That min-height was SUB-tab parity
// (competitive vs primaries), it is currently INERT (the body renders 879px
// against a 240px floor), and it now only matters if the competitive body ever
// shrinks below 240. Kept as a harmless floor; retiring it is a separate call.
//
// HO 272 — this island also owns the RACES-tab update state: it provides
// RacesUpdatesContext (the localStorage "last opened RACES" timestamp + the
// moved/news registries) so the per-card indicators can both render and
// register, and renders the MOVES / NEW badges (= registry sizes) on the RACES
// tab. Keeping both panels mounted means the (hidden) RACES cards still
// register, so the badges show while the user sits on HEARINGS. Opening RACES
// marks-viewed → registry clears → badge 0.
//
// HO 684 — AND THAT LAST SENTENCE IS STILL TRUE, WHICH IS EXACTLY WHY IT NEEDED
// A SECOND ONE. The stamp that clears the badge used to be the same value the
// chips rendered against, so the click that acknowledged N updates also unmounted
// all N markers before the panel was painted — the badge promised N things and
// opening it destroyed the evidence. This island now carries TWO timestamps:
// `lastViewMs` (ACKNOWLEDGE — restamped on open, drives registration → badges)
// and `sinceMs` (DISPLAY — frozen at the value lastViewMs held BEFORE the
// restamp, drives whether a chip renders). See RacesUpdatesContext's header for
// the full contract and the decided edge behaviours.
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
  // HO 684 — the DISPLAY stamp. Hydrates EQUAL to lastViewMs (so a first paint
  // shows exactly what the badges count), then diverges: openTab freezes it at
  // the pre-restamp value while lastViewMs moves to now. In-memory only — never
  // written to localStorage, so a reload rehydrates it to the stored stamp and
  // the chips are correctly gone (reload = new visit).
  const [sinceMs, setSinceMs] = useState<number | null>(null);
  const [movedSet, setMovedSet] = useState<Set<string>>(() => new Set());
  // HO 432: the news registry, parallel to movedSet — feeds the NEW badge the
  // same way movedSet feeds MOVES.
  const [newsSet, setNewsSet] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const raw = window.localStorage.getItem(LAST_VIEW_KEY);
    const stored = raw ? Number(raw) : 0;
    setLastViewMs(stored);
    setSinceMs(stored);
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
  const registerNews = useCallback((raceId: string) => {
    setNewsSet((prev) => {
      if (prev.has(raceId)) return prev;
      const next = new Set(prev);
      next.add(raceId);
      return next;
    });
  }, []);
  const unregisterNews = useCallback((raceId: string) => {
    setNewsSet((prev) => {
      if (!prev.has(raceId)) return prev;
      const next = new Set(prev);
      next.delete(raceId);
      return next;
    });
  }, []);

  const openTab = useCallback(
    (next: TopTab) => {
      setTab(next);
      // Opening RACES marks it viewed: stamp now so every card's "moved since"
      // goes false (effects unregister → the badges clear). HEARINGS doesn't
      // reset.
      //
      // HO 684 — FREEZE BEFORE STAMPING, and the order is the entire fix.
      // `sinceMs` takes the value lastViewMs holds right now, so the chips keep
      // rendering against the PREVIOUS open for the whole of this visit while the
      // badges clear exactly as they always did.
      //
      // `lastViewMs` IS A REAL DEPENDENCY AND IS DECLARED AS ONE. The tempting
      // alternative — reading the previous value out of a `setLastViewMs(prev =>
      // …)` updater to keep the dep array empty — puts a `setSinceMs` call inside
      // an updater, and React may invoke an updater twice (StrictMode). It would
      // be harmless here only because the write is idempotent, which is an
      // argument about this instance rather than about the rule. The cost of the
      // honest version is nil: openTab is consumed by two inline arrow handlers
      // that are recreated every render anyway, so re-identifying it buys nothing
      // back.
      if (next === "races") {
        const now = Date.now();
        // A click before hydration freezes null → no chips, matching today's
        // hydration guard exactly (null is never > anything).
        setSinceMs(lastViewMs);
        setLastViewMs(now);
        window.localStorage.setItem(LAST_VIEW_KEY, String(now));
      }
    },
    [lastViewMs],
  );

  const movesCount = movedSet.size;
  // HO 432: NEW = featured seats whose latest incumbent news postdates last view
  // (sum of the per-card RaceNewIndicators). openTab("races") stamps lastViewMs,
  // which unregisters them → badge clears on open, exactly like MOVES.
  // HO 684: registration — and therefore both counts — still keys on lastViewMs,
  // deliberately unchanged. Only the chips' RENDER predicate moved to sinceMs, so
  // the badge behaviour these two lines describe is byte-for-byte what it was.
  const newCount = newsSet.size;

  return (
    <RacesUpdatesContext.Provider
      value={{
        lastViewMs,
        sinceMs,
        registerMoved,
        unregisterMoved,
        registerNews,
        unregisterNews,
      }}
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

        {/* Both mounted; inactive hidden so the hidden RACES cards' move/news
            registration persists — that is what lets a badge show while the user
            sits on HEARINGS.

            HO 684 CORRECTS THE REST OF THIS COMMENT, which described a layout
            reversed four HOs after it was written. It claimed RACES stays in flow
            to pin the box height, that HEARINGS overlays absolutely at desktop so
            a tab switch never resizes the box, and that the display:none is
            MOBILE-ONLY. HO 610 undid all three: the hearings interior became a day
            schedule ~a third of the RACES height, so pinning would hold ~240px of
            dead space open under the DEFAULT tab (C4/C7), and each panel now sizes
            to its own content — a tab switch DOES change the box height and shift
            the week strip below it, by decision. The live rule is unconditional at
            every width and carries no media query at all:
              .dv2-racesbox-panel--races[aria-hidden="true"] { display: none }
            RACES therefore still uses aria-hidden rather than the `hidden`
            attribute, but as a CSS hook, not for height-pinning. */}
        <div className="dv2-racesbox-panels">
          <div
            className="dv2-racesbox-panel dv2-racesbox-panel--hearings"
            hidden={tab !== "hearings"}
          >
            {hearingsContent}
          </div>
          <div
            className="dv2-racesbox-panel dv2-racesbox-panel--races"
            aria-hidden={tab !== "races"}
          >
            {racesContent}
          </div>
        </div>
      </section>
    </RacesUpdatesContext.Provider>
  );
}
