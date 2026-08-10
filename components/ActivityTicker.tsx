import Link from "next/link";
import { BillRowList } from "@/components/BillRowList";
import { V2FeedList } from "@/components/V2FeedList";
import {
  type DashboardFilters,
  getStageChanges,
  getStageChangesCount,
  getWatchedBillIds,
} from "@/lib/queries";

// HO 133: row cap drops from 15 to 5, footer becomes [ + N MORE → ]
// linked to /changes. The expander makes the existing /changes view
// more discoverable than the prior `[ View all changes → ]` chrome and
// keeps the home page no-scroll at 1920x1080 inside its new tabbed
// quadrant neighbor.
//
// HO 627: 5 -> 30. The dashboard gives this feed a full-viewport sticky column
// that scrolls internally (the scroller is `.v2f` itself, overflow-y:auto, inside
// `.dash-bills` — NOT the `.bills`/`.feed` classes the 627 handoff names, which do
// not exist in the shipped DOM), so a 5-row slice capped the column at ~370px and
// left the rest of the viewport beside it empty. A pre-arc content LIMIT surviving
// into a shell that budgets far more room — not the layout arc misbehaving.
//
// NO VARIANT SPLIT, deliberately: `/dashboard-classic` was REMOVED at HO 608-610
// (the route 404s), and app/page.tsx is the only caller of this component, always
// with variant="v2". A depth constant keyed on the variant would have been an
// unreachable branch carrying a comment about a page that no longer exists — the
// Group-D "delete dead code, don't feed it" rule. (The `variant` prop still
// branches the RENDERER; that its fallback arm is now also unreachable is a
// separate cleanup, noted not done.)
//
// Cost of the deeper slice, measured at HEAD fcf6009 on 2026-08-07 against a
// 17,463-bill corpus: rows_read 1,018 -> 1,094 (+76). The ~1,000 baseline is the
// mention subquery's news_mentions GROUP BY, not the LIMIT — the walk is a
// pre-ordered idx_bills_stage_observed_at range that short-circuits at LIMIT
// either way, so depth here is close to free.
const CAP = 30;

// Reuses the /changes query helper. Empty FeedFilters means getStageChanges
// excludes ceremonial bills by default (via buildFeedWhere). The dashboard
// click-to-filter state rides in via the 4th arg: stage matches transitions
// in either direction, topic narrows via json_each.
export async function ActivityTicker({
  filters,
  variant,
  nowMs,
}: {
  filters?: DashboardFilters;
  // HO 257: "v2" renders the mock-matching V2FeedList (rich rows + expand);
  // default keeps the `/` dashboard's compact BillRowList untouched.
  variant?: "v2";
  // HO 490: page-computed clock threaded to the feed's client rows.
  nowMs: number;
}) {
  const [bills, counts, watchedIds] = await Promise.all([
    getStageChanges({}, 7, CAP, filters),
    getStageChangesCount({}, 7),
    getWatchedBillIds(),
  ]);
  const remaining = Math.max(0, counts.total - bills.length);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {bills.length === 0 ? (
        <div
          className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[length:var(--fs-13)]"
          style={{ color: "var(--text-dim)" }}
        >
          No stage changes in the last 7 days.
        </div>
      ) : variant === "v2" ? (
        <V2FeedList bills={bills} metricMode="movers" nowMs={nowMs} />
      ) : (
        // HO 164: compact rows that expand into the full BillExpandedPanel,
        // single-open within this tab (resets when you switch to TOP STALLS).
        <BillRowList compact bills={bills} watchedIds={watchedIds} nowMs={nowMs} />
      )}
      <Link href="/changes" className="home-expander v2f-foot">
        {remaining > 0
          ? `[ + ${remaining.toLocaleString()} more → ]`
          : "[ View all changes → ]"}
      </Link>
    </div>
  );
}
