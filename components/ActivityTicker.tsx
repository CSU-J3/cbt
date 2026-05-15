import Link from "next/link";
import { BillRow } from "@/components/BillRow";
import { type DashboardFilters, getStageChanges } from "@/lib/queries";

const TICKER_LIMIT = 15;

// Reuses the /changes query helper. Empty FeedFilters means getStageChanges
// excludes ceremonial bills by default (via buildFeedWhere). The dashboard
// click-to-filter state rides in via the 4th arg: stage matches transitions
// in either direction, topic narrows via json_each.
export async function ActivityTicker({
  filters,
}: {
  filters?: DashboardFilters;
}) {
  const bills = await getStageChanges({}, 7, TICKER_LIMIT, filters);

  return (
    <div className="flex flex-1 flex-col">
      {bills.length === 0 ? (
        <div
          className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[13px]"
          style={{ color: "var(--text-dim)" }}
        >
          No stage changes in the last 7 days.
        </div>
      ) : (
        <div className="changes-feed flex-1">
          <ul>
            {bills.map((b) => (
              <BillRow
                key={b.id}
                bill={b}
                filters={{ topics: [], stage: undefined }}
                basePath="/feed"
                expandedId={undefined}
                onWatchlist={false}
                introducedDate={b.introduced_date}
                showStageTransition
              />
            ))}
          </ul>
        </div>
      )}
      <Link href="/changes" className="activity-ticker-footer">
        [ View all changes → ]
      </Link>
    </div>
  );
}
