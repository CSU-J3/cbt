import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";
import { currentCongressLabel } from "@/lib/congress";
import { formatLastUpdated } from "@/lib/format";
import {
  type FeedCount,
  type FeedFilters,
  getFeedStats,
} from "@/lib/queries";

type CountMode = "feed" | "stale" | "changes" | "president" | "sponsors";

export async function HeaderBar({
  feedFilters,
  basePath = "/",
  countMode = "feed",
  staleCounts,
  changesCounts,
  presidentCounts,
  sponsorCounts,
  feedFilteredCount,
}: {
  feedFilters?: FeedFilters;
  basePath?: string;
  countMode?: CountMode;
  staleCounts?: FeedCount;
  changesCounts?: FeedCount;
  presidentCounts?: FeedCount;
  sponsorCounts?: FeedCount;
  // Filtered count for the feed view, provided by the page so HeaderBar
  // doesn't need to re-run the same COUNT(*) query getFeedBills already did.
  feedFilteredCount?: number;
}) {
  const stats = await getFeedStats();
  const showSearch = !!feedFilters;
  const counts = showSearch
    ? countMode === "stale"
      ? (staleCounts ?? null)
      : countMode === "changes"
        ? (changesCounts ?? null)
        : countMode === "president"
          ? (presidentCounts ?? null)
          : countMode === "sponsors"
            ? (sponsorCounts ?? null)
            : feedFilteredCount !== undefined
              ? ({
                  total: stats.total,
                  filtered: feedFilteredCount,
                } as FeedCount)
              : null
    : null;
  const q = feedFilters?.q?.trim() ?? "";
  const sponsor = feedFilters?.sponsor?.trim() ?? "";
  const isFiltering =
    showSearch &&
    (!!q ||
      !!feedFilters?.stage ||
      !!feedFilters?.sponsor ||
      (feedFilters?.topics?.length ?? 0) > 0);
  const isStaleMode = countMode === "stale";
  const isChangesMode = countMode === "changes";
  const isPresidentMode = countMode === "president";
  const isSponsorMode = countMode === "sponsors";
  const useAccentBright =
    isStaleMode || isChangesMode || isPresidentMode || isSponsorMode;

  return (
    <header
      className="border-b"
      style={{
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-strong)",
      }}
    >
      <div className="header-inner flex w-full items-center gap-x-4 px-4 py-3">
        <div className="flex flex-col leading-tight">
          <Link
            href="/"
            className="text-[16px] font-medium uppercase tracking-[0.5px] whitespace-nowrap"
            style={{ color: "var(--accent-amber)" }}
          >
            CBT <span style={{ color: "var(--text-dim)" }}>//</span>{" "}
            {currentCongressLabel()}
          </Link>
          <span
            className="text-[11px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            {counts && (isFiltering || isStaleMode || isChangesMode || isPresidentMode || isSponsorMode) ? (
              <>
                <span
                  style={{
                    color: useAccentBright
                      ? "var(--accent-amber-bright)"
                      : "var(--accent-amber)",
                  }}
                >
                  {counts.filtered.toLocaleString()}
                </span>
                <span> of </span>
                <span>
                  {counts.total.toLocaleString()}{" "}
                  {isStaleMode
                    ? "stale bills"
                    : isChangesMode
                      ? "stage changes"
                      : isPresidentMode
                        ? "bills at desk"
                        : isSponsorMode
                          ? "sponsors"
                          : "bills"}
                </span>
                {q ? (
                  <>
                    <span> · </span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      &quot;{q}&quot;
                    </span>
                  </>
                ) : null}
                {sponsor && !isSponsorMode ? (
                  <>
                    <span> · </span>
                    <span style={{ color: "var(--accent-amber)" }}>
                      sponsored by {sponsor}
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              <>{stats.total.toLocaleString()} bills</>
            )}
            <span> · </span>
            updated {formatLastUpdated(stats.lastUpdated)}
          </span>
        </div>

        {showSearch ? (
          <div className="header-search">
            <SearchBox basePath={basePath} />
          </div>
        ) : null}

        <nav
          className="header-nav flex items-center gap-4 text-[16px] uppercase tracking-[0.5px] whitespace-nowrap"
          style={{ color: "var(--text-dim)" }}
        >
          <Link
            href="/sponsors"
            className="transition hover:text-[var(--text-secondary)]"
            style={{
              color: isSponsorMode ? "var(--accent-amber)" : undefined,
            }}
          >
            👥 Sponsors
          </Link>
          <Link
            href="/stale"
            className="transition hover:text-[var(--text-secondary)]"
            style={{
              color: isStaleMode ? "var(--accent-amber)" : undefined,
            }}
          >
            ⏳ Stale
          </Link>
          <Link
            href="/changes"
            className="transition hover:text-[var(--text-secondary)]"
            style={{
              color: isChangesMode ? "var(--accent-amber)" : undefined,
            }}
          >
            ⇄ Changes
          </Link>
          <Link
            href="/president"
            className="transition hover:text-[var(--text-secondary)]"
            style={{
              color: isPresidentMode ? "var(--accent-amber)" : undefined,
            }}
          >
            ▸▸▸▸ President
          </Link>
          <Link
            href="/watchlist"
            className="transition hover:text-[var(--text-secondary)]"
          >
            ★ Watchlist
          </Link>
        </nav>
      </div>
    </header>
  );
}
