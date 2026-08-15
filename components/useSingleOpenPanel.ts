"use client";

// HO 164 — single-open accordion state + per-row data cache, extracted from
// BillRowList so the dashboard TOP STALLS accordion (TopStallsList) could share
// the exact same contract: one open row at a time, and the lazy-loaded panel
// payload cached by id so re-opening a row never refetches. TopStallsList is
// deleted at HO 664 (its only callers were the dead non-v2 feed arms); the
// contract stands, with BillRowList and V2FeedList as the consumers.
//
// HO 166 — generic over the cached payload `T`. Default `PanelData` keeps the
// HO 164 callers calling `useSingleOpenPanel()`
// unchanged. The generic was added for the competitive-races drawer's
// `useSingleOpenPanel<RaceHubData>()`; that drawer became a CSS hover popover at
// HO 178 and the popover is deleted at HO 658, so nothing instantiates `T` today
// — every live caller takes the default.
import { useCallback, useEffect, useState } from "react";
import type { PanelData } from "@/components/bill-panel-types";

export function useSingleOpenPanel<T = PanelData>() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [panelCache, setPanelCache] = useState<Map<string, T>>(() => new Map());

  // HO 473 — Esc closes the open row, matching the electoral district modal.
  // Guard on null so no listener is attached when nothing's open. Both
  // consumers (BillRowList, V2FeedList) inherit this from the shared hook;
  // TopStallsList was the third until HO 664 deleted it.
  // HO 658: the list said FOUR and named CompetitiveRacesStrip —
  // that surface stopped using the hook at HO 178 (hover popover, no state) and
  // is deleted now; it was never a consumer of this Esc behaviour.
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
