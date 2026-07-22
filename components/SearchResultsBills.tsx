import { BillRow } from "@/components/BillRow";
import { getWatchedBillIds, searchBills } from "@/lib/queries";

// Reuses BillRow compact (HO 125's ActivityTicker shape). Watchlist
// membership is pre-resolved on the server so the inline star renders
// correctly on first paint — matches /patterns drill-in and /changes.
export async function SearchResultsBills({
  q,
  nowMs,
}: {
  q: string;
  // HO 490: page-computed clock for the compact rows' stage-pill ages.
  nowMs: number;
}) {
  const [bills, watchedIds] = await Promise.all([
    searchBills(q),
    getWatchedBillIds(),
  ]);
  const watchedSet = new Set(watchedIds);

  return (
    <ul className="search-results-bills">
      {bills.map((b) => (
        <BillRow
          key={b.id}
          bill={b}
          nowMs={nowMs}
          compact
          onWatchlist={watchedSet.has(b.id)}
        />
      ))}
    </ul>
  );
}
