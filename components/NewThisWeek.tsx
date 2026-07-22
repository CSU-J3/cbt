import Link from "next/link";
import { TopStallsList } from "@/components/TopStallsList";
import { V2FeedList } from "@/components/V2FeedList";
import { getNewBillsThisWeek, getNewBillsThisWeekCount } from "@/lib/queries";

// HO 249 — the third dashboard feed tab (MOVERS / TOP STALLS / NEW THIS WEEK),
// completing the redesign spec. "New" = non-ceremonial bills introduced in the
// last 7 days. The list (getNewBillsThisWeek) and the tab-label count
// (getNewBillsThisWeekCount, read here for the [+N more] expander) share the
// SAME predicate, so the label and the rows can't disagree. Reuses the
// TopStallsList collapsed-row + BillExpandedPanel exactly like TopStalls — the
// only difference is daysFrom="intro" (age since introduction, not staleness).
// Server component for the data fetch; the accordion state lives in the client
// TopStallsList island.
const ROW_LIMIT = 5;

export async function NewThisWeek({
  variant,
  nowMs,
}: {
  variant?: "v2";
  // HO 490: page-computed clock threaded to the feed's client rows.
  nowMs: number;
}) {
  const [bills, total] = await Promise.all([
    getNewBillsThisWeek(ROW_LIMIT),
    getNewBillsThisWeekCount(),
  ]);
  const remaining = Math.max(0, total - bills.length);

  if (bills.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[13px]"
        style={{ color: "var(--text-dim)" }}
      >
        No new bills introduced in the last 7 days.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {variant === "v2" ? (
        <V2FeedList bills={bills} metricMode="new" nowMs={nowMs} />
      ) : (
        <TopStallsList bills={bills} daysFrom="intro" nowMs={nowMs} />
      )}
      <Link href="/bills?sort=introduced" className="home-expander">
        {remaining > 0
          ? `[ + ${remaining.toLocaleString()} more → ]`
          : "[ View all new → ]"}
      </Link>
    </div>
  );
}
