"use client";

// HO 164 — single-open accordion state + per-bill panel cache, extracted from
// BillRowList so the dashboard TOP STALLS accordion (TopStallsList) shares the
// exact same contract: one open row at a time, and /api/bill/[id]/panel
// results cached by bill id so re-opening a row never refetches.
import { useCallback, useState } from "react";
import type { PanelData } from "@/components/BillExpandedPanel";

export function useSingleOpenPanel() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [panelCache, setPanelCache] = useState<Map<string, PanelData>>(
    () => new Map(),
  );

  const toggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleLoaded = useCallback((id: string, data: PanelData) => {
    setPanelCache((prev) => {
      if (prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(id, data);
      return next;
    });
  }, []);

  return { expandedId, toggle, panelCache, handleLoaded };
}
