import { BillRowList } from "@/components/BillRowList";
import {
  CHAMBER_SEGMENTS,
  SegmentedToggle,
} from "@/components/SegmentedToggle";
import { HeaderBar } from "@/components/HeaderBar";
import { SortDropdown } from "@/components/SortDropdown";
import { StageLegend } from "@/components/StageLegend";
import {
  getWatchlistBills,
  sanitizeChamber,
  sanitizeSort,
} from "@/lib/queries";

type SearchParams = {
  sort?: string;
  chamber?: string;
};

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const sort = sanitizeSort(params.sort);
  const chamber = sanitizeChamber(params.chamber);
  const bills = await getWatchlistBills(sort, chamber);

  const carry = new URLSearchParams();
  if (sort && sort !== "action") carry.set("sort", sort);
  if (chamber) carry.set("chamber", chamber);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/watchlist" />

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
          <SegmentedToggle
            current={(chamber ?? "") as "" | "house" | "senate"}
            ariaLabel="Chamber"
            segments={CHAMBER_SEGMENTS}
            buildHref={(value) => {
              const sp = new URLSearchParams(carry);
              sp.delete("page");
              if (value) sp.set("chamber", value);
              else sp.delete("chamber");
              const qs = sp.toString();
              return qs ? `/watchlist?${qs}` : "/watchlist";
            }}
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
              Add bills from any bill detail page by clicking ★ Watch.
            </p>
          </div>
        ) : (
          <div
            className="border"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <StageLegend />
            <BillRowList
              bills={bills}
              watchedIds={bills.map((b) => b.id)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
