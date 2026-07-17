"use client";

// HO 164 — single-open accordion state + per-row data cache, extracted from
// BillRowList so the dashboard TOP STALLS accordion (TopStallsList) shares the
// exact same contract: one open row at a time, and the lazy-loaded panel
// payload cached by id so re-opening a row never refetches.
//
// HO 166 — generic over the cached payload `T`. Default `PanelData` keeps the
// HO 164 callers (BillRowList, TopStallsList) calling `useSingleOpenPanel()`
// unchanged; the competitive-races drawer caches `RaceHubData` via
// `useSingleOpenPanel<RaceHubData>()`.
import { useCallback, useEffect, useState } from "react";
import type { PanelData } from "@/components/BillExpandedPanel";

export function useSingleOpenPanel<T = PanelData>() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [panelCache, setPanelCache] = useState<Map<string, T>>(() => new Map());

  // HO 473 — Esc closes the open row, matching the electoral district modal.
  // Guard on null so no listener is attached when nothing's open. All four
  // consumers (BillRowList, TopStallsList, V2FeedList, CompetitiveRacesStrip)
  // inherit this from the shared hook.
  useEffect(() => {
    if (expandedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  const toggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleLoaded = useCallback((id: string, data: T) => {
    setPanelCache((prev) => {
      if (prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(id, data);
      return next;
    });
  }, []);

  return { expandedId, toggle, panelCache, handleLoaded };
}
