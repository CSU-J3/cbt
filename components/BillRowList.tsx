"use client";

// HO 148 — owns the single-open accordion state across a feed-shaped list.
// Renders the <ul> of BillRow accordions; opening one closes any other.
// Per-bill panel data (committees + news) is cached keyed by bill id so
// re-expanding the same row does not refetch. HO 164 lifted the open-state +
// cache into the shared useSingleOpenPanel hook and added a `compact`
// passthrough so the dashboard ACTIVITY ticker can render compact rows that
// still expand.
import { useMemo } from "react";
import { BillExpandedPanel } from "@/components/BillExpandedPanel";
import { BillRow } from "@/components/BillRow";
import { useSingleOpenPanel } from "@/components/useSingleOpenPanel";
import type { FeedBill } from "@/lib/queries";

type DaysSinceMode = "staleness" | "desk-time";

export function BillRowList({
  bills,
  watchedIds,
  daysSinceMode,
  className,
  compact = false,
}: {
  bills: FeedBill[];
  watchedIds: string[];
  daysSinceMode?: DaysSinceMode;
  className?: string;
  compact?: boolean;
}) {
  const watchedSet = useMemo(() => new Set(watchedIds), [watchedIds]);
  const { expandedId, toggle, panelCache, handleLoaded } = useSingleOpenPanel();

  return (
    <ul className={className}>
      {bills.map((b) => {
        const isOpen = expandedId === b.id;
        return (
          <BillRow
            key={b.id}
            bill={b}
            compact={compact}
            daysSinceMode={daysSinceMode}
            onWatchlist={watchedSet.has(b.id)}
            isOpen={isOpen}
            onToggle={() => toggle(b.id)}
            expandedPanel={
              isOpen ? (
                <BillExpandedPanel
                  bill={b}
                  compact={compact}
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
