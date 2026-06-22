"use client";

// HO 148 — owns the single-open accordion state across a feed-shaped list.
// Renders the <ul> of BillRow accordions; opening one closes any other.
// Per-bill panel data (committees + news + meetings) is cached keyed by bill id
// so re-expanding the same row does not refetch. HO 164 lifted the open-state +
// cache into the shared useSingleOpenPanel hook and added a `compact`
// passthrough so the dashboard ACTIVITY ticker can render compact rows that
// still expand.
//
// HO 317 — /bills now renders the SHARED components/BillExpandPanel (the same
// rich panel the dashboard `/` shows, click-to-expand here vs hover there). That
// panel is presentational, so the list owns the lazy fetch. The compact path
// (the old dashboard ACTIVITY ticker, now /dashboard-classic) keeps the
// pipeline-only BillExpandedPanel, which self-fetches nothing in compact mode.
import { useEffect, useMemo } from "react";
import { BillExpandPanel } from "@/components/BillExpandPanel";
import { BillExpandedPanel } from "@/components/BillExpandedPanel";
import { BillRow } from "@/components/BillRow";
import { useSingleOpenPanel } from "@/components/useSingleOpenPanel";
import type { PanelData } from "@/components/BillExpandedPanel";
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

  // HO 317: the shared full panel is presentational, so the list fetches the
  // open row's committees / news / meetings here (compact keeps self-managing
  // via BillExpandedPanel, which does 0 queries in compact mode).
  useEffect(() => {
    if (compact || !expandedId || panelCache.has(expandedId)) return;
    let cancelled = false;
    fetch(`/api/bill/${encodeURIComponent(expandedId)}/panel`)
      .then((r) => (r.ok ? (r.json() as Promise<PanelData>) : Promise.reject(r.status)))
      .then((json) => {
        if (!cancelled) handleLoaded(expandedId, json);
      })
      .catch(() => {
        if (!cancelled)
          handleLoaded(expandedId, { committees: [], news: [], meetings: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [compact, expandedId, panelCache, handleLoaded]);

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
                compact ? (
                  <BillExpandedPanel
                    bill={b}
                    compact
                    cached={panelCache.get(b.id) ?? null}
                    onLoaded={(data) => handleLoaded(b.id, data)}
                  />
                ) : (
                  <BillExpandPanel bill={b} panel={panelCache.get(b.id) ?? null} />
                )
              ) : null
            }
          />
        );
      })}
    </ul>
  );
}
