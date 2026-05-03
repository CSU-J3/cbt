import { BillRow } from "@/components/BillRow";
import { FooterLegend } from "@/components/FooterLegend";
import { HeaderBar } from "@/components/HeaderBar";
import { getWatchlistBills, isInWatchlist } from "@/lib/queries";

type SearchParams = {
  expanded?: string;
};

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const expandedParam = typeof params.expanded === "string" ? params.expanded : undefined;
  const bills = await getWatchlistBills();
  const expandedId = expandedParam && bills.some((b) => b.id === expandedParam)
    ? expandedParam
    : undefined;
  const onWatchlist = expandedId ? await isInWatchlist(expandedId) : false;

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">
        <div
          className="mb-3 flex items-baseline gap-3 border-b pb-3 text-[10px] uppercase tracking-[0.5px]"
          style={{
            borderColor: "var(--border-strong)",
            color: "var(--text-dim)",
          }}
        >
          <span style={{ color: "var(--accent-amber)" }}>★ Watchlist</span>
          <span>·</span>
          <span>{bills.length} {bills.length === 1 ? "bill" : "bills"}</span>
        </div>

        {bills.length === 0 ? (
          <div
            className="border px-6 py-12 text-center text-[11px] uppercase tracking-[0.5px]"
            style={{
              borderColor: "var(--border-strong)",
              color: "var(--text-dim)",
            }}
          >
            <p style={{ color: "var(--text-muted)" }}>No bills on watchlist</p>
            <p className="mt-2 normal-case tracking-normal">
              Add bills from the feed by clicking ★ Watch on any expanded row.
            </p>
          </div>
        ) : (
          <div
            className="border"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <div className="feed-header-row">
              <span aria-hidden></span>
              <span>Bill</span>
              <span>Title / Sponsor</span>
              <span>Stage</span>
              <span className="col-date">Action</span>
              <span>Topics</span>
            </div>
            <ul>
              {bills.map((b) => (
                <BillRow
                  key={b.id}
                  bill={b}
                  filters={{ topics: [], stage: undefined }}
                  basePath="/watchlist"
                  expandedId={expandedId}
                  onWatchlist={expandedId === b.id ? onWatchlist : false}
                  introducedDate={b.introduced_date}
                />
              ))}
            </ul>
          </div>
        )}
      </main>

      <FooterLegend />
    </div>
  );
}
