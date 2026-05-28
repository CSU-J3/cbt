"use client";

// HO 148 — owns the single-open accordion state across a feed-shaped list.
// Renders the full <ul> of BillRow accordions; opening one closes any other.
// Per-bill panel data (committees + news) is cached here keyed by bill id
// so re-expanding the same row does not refetch.
import { useCallback, useMemo, useState } from "react";
import {
  BillExpandedPanel,
  type PanelData,
} from "@/components/BillExpandedPanel";
import { BillRow } from "@/components/BillRow";
import type { FeedBill } from "@/lib/queries";

type DaysSinceMode = "staleness" | "desk-time";

export function BillRowList({
  bills,
  watchedIds,
  daysSinceMode,
  className,
}: {
  bills: FeedBill[];
  watchedIds: string[];
  daysSinceMode?: DaysSinceMode;
  className?: string;
}) {
  const watchedSet = useMemo(() => new Set(watchedIds), [watchedIds]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [panelCache, setPanelCache] = useState<Map<string, PanelData>>(
    () => new Map(),
  );

  const handleToggle = useCallback((id: string) => {
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

  return (
    <ul className={className}>
      {bills.map((b) => {
        const isOpen = expandedId === b.id;
        return (
          <BillRow
            key={b.id}
            bill={b}
            daysSinceMode={daysSinceMode}
            onWatchlist={watchedSet.has(b.id)}
            isOpen={isOpen}
            onToggle={() => handleToggle(b.id)}
            expandedPanel={
              isOpen ? (
                <BillExpandedPanel
                  bill={b}
                  cached={panelCache.get(b.id) ?? null}
                  onLoaded={(data) => handleLoaded(b.id, data)}
                />
              ) : null
            }
          />
        );
      })}
    </ul>
  );
}
