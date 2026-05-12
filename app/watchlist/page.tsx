import { BillRow } from "@/components/BillRow";
import { ChamberToggle } from "@/components/ChamberToggle";
import { HeaderBar } from "@/components/HeaderBar";
import { SortDropdown } from "@/components/SortDropdown";
import { StageLegend } from "@/components/StageLegend";
import { timed } from "@/lib/perf";
import {
  getWatchlistBills,
  isInWatchlist,
  sanitizeChamber,
  sanitizeSort,
} from "@/lib/queries";

type SearchParams = {
  expanded?: string;
  sort?: string;
  chamber?: string;
};

export const revalidate = 300;

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const pageT0 = performance.now();
  const params = await searchParams;
  const expandedParam = typeof params.expanded === "string" ? params.expanded : undefined;
  const sort = sanitizeSort(params.sort);
  const chamber = sanitizeChamber(params.chamber);
  const bills = await timed("getWatchlistBills", () =>
    getWatchlistBills(sort, chamber),
  );
  const expandedId = expandedParam && bills.some((b) => b.id === expandedParam)
    ? expandedParam
    : undefined;
  const onWatchlist = expandedId
    ? await timed("isInWatchlist", () => isInWatchlist(expandedId))
    : false;
  console.log(`[perf] /watchlist page-data: ${Math.round(performance.now() - pageT0)}ms`);

  const carry = new URLSearchParams();
  if (sort && sort !== "action") carry.set("sort", sort);
  if (chamber) carry.set("chamber", chamber);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar />

      <main className="w-full flex-1 px-4 py-4">
        <div
          className="mb-3 flex items-baseline gap-3 border-b pb-3 text-[12px] uppercase tracking-[0.5px]"
          style={{
            borderColor: "var(--border-strong)",
            color: "var(--text-dim)",
          }}
        >
          <span style={{ color: "var(--accent-amber)" }}>★ Watchlist</span>
          <span>·</span>
          <span>{bills.length} {bills.length === 1 ? "bill" : "bills"}</span>
          <ChamberToggle
            current={chamber}
            carry={carry}
            basePath="/watchlist"
          />
          <span className="ml-auto flex items-center gap-2">
            <span>Sort</span>
            <SortDropdown current={sort} basePath="/watchlist" />
          </span>
        </div>

        {bills.length === 0 ? (
          <div
            className="border px-6 py-12 text-center text-[13px] uppercase tracking-[0.5px]"
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
            <StageLegend />
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
                  filters={{ topics: [], stage: undefined, sort, chamber }}
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
    </div>
  );
}
