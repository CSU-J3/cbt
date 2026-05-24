import Link from "next/link";
import { BillRow } from "@/components/BillRow";
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
const CAP = 5;

// Reuses the /changes query helper. Empty FeedFilters means getStageChanges
// excludes ceremonial bills by default (via buildFeedWhere). The dashboard
// click-to-filter state rides in via the 4th arg: stage matches transitions
// in either direction, topic narrows via json_each.
export async function ActivityTicker({
  filters,
}: {
  filters?: DashboardFilters;
}) {
  const [bills, counts, watchedIds] = await Promise.all([
    getStageChanges({}, 7, CAP, filters),
    getStageChangesCount({}, 7),
    getWatchedBillIds(),
  ]);
  const watchedSet = new Set(watchedIds);
  const remaining = Math.max(0, counts.total - bills.length);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {bills.length === 0 ? (
        <div
          className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[13px]"
          style={{ color: "var(--text-dim)" }}
        >
          No stage changes in the last 7 days.
        </div>
      ) : (
        <div className="flex-1">
          <ul>
            {bills.map((b) => (
              <BillRow
                key={b.id}
                bill={b}
                compact
                onWatchlist={watchedSet.has(b.id)}
              />
            ))}
          </ul>
        </div>
      )}
      <Link href="/changes" className="home-expander">
        {remaining > 0
          ? `[ + ${remaining.toLocaleString()} more → ]`
          : "[ View all changes → ]"}
      </Link>
    </div>
  );
}
