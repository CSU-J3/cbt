import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";
import { currentCongressLabel } from "@/lib/congress";
import { formatLastUpdated } from "@/lib/format";
import {
  type FeedCount,
  type FeedFilters,
  getFeedCount,
  getFeedStats,
} from "@/lib/queries";

type CountMode = "feed" | "stale" | "desk" | "sponsors";

export async function HeaderBar({
  feedFilters,
  basePath = "/",
  countMode = "feed",
  staleCounts,
  deskCounts,
  sponsorCounts,
}: {
  feedFilters?: FeedFilters;
  basePath?: string;
  countMode?: CountMode;
  staleCounts?: FeedCount;
  deskCounts?: FeedCount;
  sponsorCounts?: FeedCount;
}) {
  const stats = await getFeedStats();
  const showSearch = !!feedFilters;
  const counts = showSearch
    ? countMode === "stale"
      ? (staleCounts ?? null)
      : countMode === "desk"
        ? (deskCounts ?? null)
        : countMode === "sponsors"
          ? (sponsorCounts ?? null)
          : await getFeedCount(feedFilters)
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
  const isDeskMode = countMode === "desk";
  const isSponsorMode = countMode === "sponsors";
  const useAccentBright = isStaleMode || isDeskMode || isSponsorMode;

  return (
    <header
      className="border-b"
      style={{
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-strong)",
      }}
    >
      <div className="header-inner flex w-full items-center gap-x-4 px-4 py-3">
        <Link
          href="/"
          className="text-[16px] font-medium uppercase tracking-[0.5px] whitespace-nowrap"
          style={{ color: "var(--accent-amber)" }}
        >
          CBT <span style={{ color: "var(--text-dim)" }}>//</span>{" "}
          {currentCongressLabel()}
        </Link>

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
            Sponsors
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
            href="/president"
            className="transition hover:text-[var(--text-secondary)]"
            style={{
              color: isDeskMode ? "var(--accent-amber)" : undefined,
            }}
          >
            Desk
          </Link>
          <Link
            href="/watchlist"
            className="transition hover:text-[var(--text-secondary)]"
          >
            ★ Watchlist
          </Link>
          <span>
            {counts && (isFiltering || isStaleMode || isDeskMode || isSponsorMode) ? (
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
                    : isDeskMode
                      ? "at president's desk"
                      : isSponsorMode
                        ? "sponsors"
                        : "bills"}
                </span>
                {q ? (
                  <>
                    <span style={{ color: "var(--text-dim)" }}> · </span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      &quot;{q}&quot;
                    </span>
                  </>
                ) : null}
                {sponsor && !isSponsorMode ? (
                  <>
                    <span style={{ color: "var(--text-dim)" }}> · </span>
                    <span style={{ color: "var(--accent-amber)" }}>
                      sponsored by {sponsor}
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              <>
                {stats.total.toLocaleString()} bills
                <span style={{ color: "var(--text-dim)" }}> · </span>
                updated {formatLastUpdated(stats.lastUpdated)}
              </>
            )}
          </span>
        </nav>
      </div>
    </header>
  );
}
