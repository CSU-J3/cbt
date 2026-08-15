"use client";

// HO 148 — owns the single-open accordion state across a feed-shaped list.
// Renders the <ul> of BillRow accordions; opening one closes any other.
// Per-bill panel data (committees + news + meetings) is cached keyed by bill id
// so re-expanding the same row does not refetch. HO 164 lifted the open-state +
// cache into the shared useSingleOpenPanel hook (and added a `compact`
// passthrough, since removed — see the HO 666 paragraph below).
//
// HO 317 — /bills renders the SHARED components/BillExpandPanel (the same rich
// panel the dashboard `/` shows, click-to-expand here vs hover there). That
// panel is presentational, so the list owns the lazy fetch.
//
// HO 666 — the `compact` passthrough is GONE, and `BillExpandPanel` is now the
// only panel this list can render. RECORD of the chain: HO 164 added the
// passthrough so the dashboard ACTIVITY ticker could render compact rows that
// still expanded, via the pipeline-only `BillExpandedPanel` (which self-fetched
// nothing in compact mode); HO 608 deleted the classic route that path served;
// HO 664 stripped ActivityTicker's dead non-v2 arm, the passthrough's last
// caller, and filed the strip QUEUED rather than widening that commit; this HO
// closed it. `components/BillExpandedPanel.tsx` was deleted with the branch —
// it was its last consumer — and the four `/api/bill/[id]/panel` payload types
// it carried moved to `components/bill-panel-types.ts`.
//
// `BillRow`'s OWN compact prop was never part of this and stays live, link-only,
// on SearchResultsBills / /patterns / /committee/[systemCode].
import { useEffect, useMemo } from "react";
import { BillExpandPanel } from "@/components/BillExpandPanel";
import { BillRow } from "@/components/BillRow";
import { useSingleOpenPanel } from "@/components/useSingleOpenPanel";
import type { PanelData } from "@/components/bill-panel-types";
import type { FeedBill } from "@/lib/queries";

type DaysSinceMode = "staleness" | "desk-time";

export function BillRowList({
  bills,
  watchedIds,
  nowMs,
  daysSinceMode,
  className,
  showMomentum = false,
}: {
  bills: FeedBill[];
  watchedIds: string[];
  // HO 490: page-computed clock threaded to the rows + panels so relative-age
  // buckets match between SSR and hydration. See lib/format.ts.
  nowMs: number;
  daysSinceMode?: DaysSinceMode;
  className?: string;
  // HO 371: gate the /stale momentum overlay (collapsed support figure + HEARD,
  // expand cosponsor bar + "then silent" line). True only from the /stale page —
  // BillRow + BillExpandPanel are shared across surfaces, so without this the
  // overlay would leak everywhere.
  showMomentum?: boolean;
}) {
  const watchedSet = useMemo(() => new Set(watchedIds), [watchedIds]);
  const { expandedId, toggle, panelCache, handleLoaded } = useSingleOpenPanel();

  // HO 317: the shared full panel is presentational, so the list fetches the
  // open row's committees / news / meetings here.
  useEffect(() => {
    if (!expandedId || panelCache.has(expandedId)) return;
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
  }, [expandedId, panelCache, handleLoaded]);

  return (
    <ul className={className}>
      {bills.map((b) => {
        const isOpen = expandedId === b.id;
        return (
          <BillRow
            key={b.id}
            bill={b}
            nowMs={nowMs}
            daysSinceMode={daysSinceMode}
            showMomentum={showMomentum}
            onWatchlist={watchedSet.has(b.id)}
            isOpen={isOpen}
            onToggle={() => toggle(b.id)}
            expandedPanel={
              isOpen ? (
                <BillExpandPanel
                  bill={b}
                  nowMs={nowMs}
                  panel={panelCache.get(b.id) ?? null}
                  showMomentum={showMomentum}
                />
              ) : null
            }
          />
        );
      })}
    </ul>
  );
}
