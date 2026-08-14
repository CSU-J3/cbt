import Link from "next/link";
import { V2FeedList } from "@/components/V2FeedList";
import {
  type Chamber,
  getNewBillsThisWeek,
  getNewBillsThisWeekCount,
} from "@/lib/queries";

// HO 249 — the third dashboard feed tab (MOVERS / TOP STALLS / NEW THIS WEEK),
// completing the redesign spec. "New" = non-ceremonial bills introduced in the
// last 7 days. The list (getNewBillsThisWeek) and the tab-label count
// (getNewBillsThisWeekCount, read here for the [+N more] expander) share the
// SAME predicate, so the label and the rows can't disagree. It reused the
// TopStallsList collapsed-row + BillExpandedPanel exactly like TopStalls, with
// daysFrom="intro" the only difference (age since introduction, not staleness);
// HO 664 deleted that island with the dead non-v2 arm that was its only caller,
// so this now renders V2FeedList like the other two tabs. Server component for
// the data fetch.
// HO 627: 5 -> 30, filling the scrolling feed column. No variant split — see the
// ActivityTicker note (/dashboard-classic was removed at HO 608-610, so a
// variant-keyed depth would be an unreachable branch). Cost measured at HEAD
// fcf6009 on 2026-08-07: rows_read 1,027 -> 1,103 (+76), the ~1,000 baseline
// being the mention subquery rather than the LIMIT.
const ROW_LIMIT = 30;

export async function NewThisWeek({
  chamber,
  nowMs,
}: {
  // HO 642: the dashboard feed panel's chamber selector. BOTH calls take it —
  // the two share one predicate precisely so the label can't drift from the rows
  // (see the comment on getNewBillsThisWeekCount).
  chamber?: Chamber;
  // HO 490: page-computed clock threaded to the feed's client rows.
  nowMs: number;
}) {
  const [bills, total] = await Promise.all([
    getNewBillsThisWeek(ROW_LIMIT, chamber),
    getNewBillsThisWeekCount(chamber),
  ]);
  const remaining = Math.max(0, total - bills.length);

  if (bills.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[length:var(--fs-13)]"
        style={{ color: "var(--text-dim)" }}
      >
        No new bills introduced in the last 7 days.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <V2FeedList bills={bills} metricMode="new" nowMs={nowMs} />
      <Link href="/bills?sort=introduced" className="home-expander v2f-foot">
        {remaining > 0
          ? `[ + ${remaining.toLocaleString()} more → ]`
          : "[ View all new → ]"}
      </Link>
    </div>
  );
}
