"use client";

// HO 272 — shared client state for the v2 RACES-tab update badges. The provider
// (RacesBoxTabs) holds the per-browser "last opened RACES" timestamp (from
// localStorage) and registries of which featured races have moved / carry fresh
// news; the per-card indicators register themselves so a tab badge count is
// literally the sum of the per-card indicators. Default value is inert (no
// provider): null timestamps + no-op registers, so nothing renders and nothing
// registers.
//
// HO 432 — a parallel news registry (registerNews/unregisterNews) beside the
// moved pair, feeding the previously-dark NEW badge.
//
// HO 684 — THE ONE STAMP BECAME TWO, AND THAT IS THE WHOLE POINT OF THIS FILE.
// This header used to read: "The single lastViewMs gates both: opening RACES
// marks moves AND news viewed (one 'last opened' stamp resets both badges),
// matching the current UX." Every clause of that was true and the design it
// described was broken — because one variable was serving two jobs:
//
//   ACKNOWLEDGE (lastViewMs) — what the click writes, so the badges clear.
//   DISPLAY     (sinceMs)    — what the chips render against.
//
// While they were the same value, `openTab("races")` restamped it synchronously
// in the click handler, every indicator re-evaluated false BEFORE the panel was
// painted visible, and the panel opened with ZERO markers on it. The badge
// promised N things and the click destroyed the evidence. The chips had been
// built, styled and mounted since HO 272/432 and were structurally invisible on
// the primary flow for ~250 handoffs.
//
// So: registration still keys on `lastViewMs` (badges clear on open, unchanged),
// and rendering keys on `sinceMs`, which is FROZEN at the value `lastViewMs`
// held BEFORE the restamp. The chips are visible for the whole visit; a later
// re-open re-freezes to the previous open's stamp, so each open shows what is
// new since the PREVIOUS open — the same semantic the badge has, one open later.
//
// Decided behaviours, so they read as rulings rather than accidents:
//   - a mid-visit RELOAD rehydrates sinceMs to the just-written stamp and the
//     chips are gone (reload = new visit; those items were acknowledged);
//   - the localStorage value stays a single ms epoch — no schema change;
//   - sinceMs is IN-MEMORY ONLY and is never persisted.
import { createContext } from "react";

export type RacesUpdates = {
  // ACKNOWLEDGE. null until hydrated from localStorage; 0 = first visit (count
  // all real moves); otherwise ms epoch of the last RACES open. Drives
  // REGISTRATION (→ the tab badges) only.
  lastViewMs: number | null;
  // DISPLAY. null until hydrated; hydrates equal to lastViewMs, then freezes at
  // the pre-restamp value on each RACES open. Drives whether a chip RENDERS.
  // Never written to localStorage.
  sinceMs: number | null;
  registerMoved: (raceId: string) => void;
  unregisterMoved: (raceId: string) => void;
  registerNews: (raceId: string) => void;
  unregisterNews: (raceId: string) => void;
};

export const RacesUpdatesContext = createContext<RacesUpdates>({
  lastViewMs: null,
  sinceMs: null,
  registerMoved: () => {},
  unregisterMoved: () => {},
  registerNews: () => {},
  unregisterNews: () => {},
});
