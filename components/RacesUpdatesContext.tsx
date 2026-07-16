"use client";

// HO 272 — shared client state for the v2 RACES-tab update badges. The provider
// (RacesBoxTabs) holds the per-browser "last opened RACES" timestamp (from
// localStorage) and a registry of which featured races have moved since it; the
// per-card RaceMovedIndicator consumes `lastViewMs` to decide whether to render
// MOVED, and registers itself so the tab badge count is literally the sum of the
// per-card indicators. Default value is inert (no provider, e.g. on `/`): null
// timestamp + no-op register, so nothing renders and nothing registers.
//
// HO 432 — a parallel news registry (registerNews/unregisterNews) beside the
// moved pair, feeding the previously-dark NEW badge. The single lastViewMs gates
// both: opening RACES marks moves AND news viewed (one "last opened" stamp resets
// both badges), matching the current UX.
import { createContext } from "react";

export type RacesUpdates = {
  // null until hydrated from localStorage; 0 = first visit (count all real
  // moves); otherwise ms epoch of the last RACES open.
  lastViewMs: number | null;
  registerMoved: (raceId: string) => void;
  unregisterMoved: (raceId: string) => void;
  registerNews: (raceId: string) => void;
  unregisterNews: (raceId: string) => void;
};

export const RacesUpdatesContext = createContext<RacesUpdates>({
  lastViewMs: null,
  registerMoved: () => {},
  unregisterMoved: () => {},
  registerNews: () => {},
  unregisterNews: () => {},
});
