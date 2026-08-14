import Link from "next/link";
import { V2FeedList } from "@/components/V2FeedList";
import {
  type Chamber,
  type DashboardFilters,
  getStageChanges,
  getStageChangesCount,
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
// NO VARIANT SPLIT: `/dashboard-classic` was REMOVED at HO 608-610 (the route
// 404s), and app/page.tsx is the only caller of this component. HO 627 declined a
// variant-keyed depth constant as an unreachable branch (the Group-D "delete dead
// code, don't feed it" rule) and noted the renderer's own fallback arm as a
// separate cleanup not done; HO 664 is that cleanup. The `variant` prop and its
// `<BillRowList compact>` arm are gone, so there is one renderer and no fallback.
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
  chamber,
  nowMs,
}: {
  filters?: DashboardFilters;
  // HO 642: the dashboard feed panel's chamber selector. Feed-panel scope only —
  // see the note where `chamber` is derived in app/page.tsx.
  chamber?: Chamber;
  // HO 490: page-computed clock threaded to the feed's client rows.
  nowMs: number;
}) {
  const [bills, counts] = await Promise.all([
    getStageChanges({ chamber }, 7, CAP, filters),
    // The count takes EVERY dimension the row query takes — chamber AND the
    // dashboard stage/topic filters. `remaining` below drives the `[ + N more → ]`
    // footer, so a count narrower or wider than the rows makes that number
    // silently wrong and clamps it to 0 once the count drops under the rendered
    // rows. That is the HO 637 Group A coupling and this is the same arithmetic.
    //
    // The `filters` third argument closes the last loose dimension (HO 642
    // follow-up): the rows had taken it since HO 320 while the count did not, so
    // under an active ?stage= / ?topics= the footer OVERSTATED what was left. It
    // is the identical call app/page.tsx makes for the tab badge, so it shares
    // that unstable_cache entry — no new query, no new key.
    //
    // It is `.filtered`, NOT `.total`, and that is load-bearing: getStageChangesCount
    // computes `total` from buildChangesWhere({}, days, dashboard) — it DROPS its
    // own `filters` argument by construction, so a chamber passed in would never
    // reach it. `.filtered` is the arm that reads the filters. With no chamber and
    // no dashboard filter the two arms are byte-identical, so this is a no-op on
    // the unfiltered default.
    getStageChangesCount({ chamber }, 7, filters),
  ]);
  const remaining = Math.max(0, counts.filtered - bills.length);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {bills.length === 0 ? (
        <div
          className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[length:var(--fs-13)]"
          style={{ color: "var(--text-dim)" }}
        >
          No stage changes in the last 7 days.
        </div>
      ) : (
        <V2FeedList bills={bills} metricMode="movers" nowMs={nowMs} />
      )}
      <Link href="/changes" className="home-expander v2f-foot">
        {remaining > 0
          ? `[ + ${remaining.toLocaleString()} more → ]`
          : "[ View all changes → ]"}
      </Link>
    </div>
  );
}
