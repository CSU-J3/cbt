import Link from "next/link";
import { CeremonialToggle } from "@/components/CeremonialToggle";
import { SearchBox } from "@/components/SearchBox";
import { getClusterPattern } from "@/lib/cluster-patterns";
import { currentCongressLabel } from "@/lib/congress";
import { formatLastUpdated } from "@/lib/format";
import {
  type FeedCount,
  type FeedFilters,
  getCorpusStats,
  getFeedStats,
} from "@/lib/queries";

type CountMode = "feed" | "stale" | "changes" | "president" | "sponsors";
type HeaderVariant = "feed" | "dashboard";

// HO 131: shared nav-item config consumed by both HeaderNav (top-right
// chrome on /feed-shaped pages) and HomeHeader (under-title row on /).
// Each item carries a one-line tooltip (HO 131 ask 7) matching the HO 123
// vocabulary — short, sentence case, no trailing period. Append-only
// when adding nav targets; deletions ripple through both surfaces.
export type NavItemKey =
  | "feed"
  | "news"
  | "reports"
  | "sponsor"
  | "races"
  | "primaries"
  | "patterns"
  | "trends"
  | "stale"
  | "changes"
  | "president"
  | "watchlist";

export type NavItem = {
  key: NavItemKey;
  href: string;
  label: string;
  tooltip: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "feed", href: "/feed", label: "▤ Feed", tooltip: "Browse all bills" },
  { key: "news", href: "/news", label: "⚡ News", tooltip: "Bills in the press, last 24h" },
  { key: "reports", href: "/reports", label: "⎘ Reports", tooltip: "Weekly written reports on the corpus" },
  { key: "sponsor", href: "/members", label: "👥 Members", tooltip: "All 536 current Members of Congress" },
  { key: "races", href: "/races", label: "🗳 Races", tooltip: "2026 House and Senate races" },
  { key: "primaries", href: "/primaries", label: "▦ Primaries", tooltip: "Primary calendar and candidate filings" },
  { key: "patterns", href: "/patterns", label: "⊞ Patterns", tooltip: "Bill shapes — facility-naming, awareness designations" },
  { key: "trends", href: "/trends", label: "📈 Trends", tooltip: "Long-run bill volume and topic-mix charts" },
  { key: "stale", href: "/stale", label: "⏳ Stale", tooltip: "Bills with no action in 60+ days" },
  { key: "changes", href: "/changes", label: "⇄ Changes", tooltip: "Bills that moved stage in the last 7 days" },
  { key: "president", href: "/president", label: "▸▸▸▸ President", tooltip: "Bills at the president's desk, closest to veto deadline" },
  { key: "watchlist", href: "/watchlist", label: "★ Watchlist", tooltip: "Bills you've flagged with the watch star" },
];

export type NavActive = Partial<Record<NavItemKey, boolean>>;

// HO 126: shared nav rendered in both header variants. The dashboard
// variant used to omit the nav entirely (when JUMP TO sat in the home
// grid), but with JUMP TO retired and SubViewLinkStrip deleted the home
// page would otherwise have zero in-page navigation. `activeMode` carries
// the highlight for nav targets whose active state is interesting; pages
// without a corresponding mode just inherit the default dim color.
function HeaderNav({ active = {} }: { active?: NavActive }) {
  const amber = "var(--accent-amber)";
  return (
    <nav
      className="header-nav flex items-center gap-4 text-[16px] uppercase tracking-[0.5px] whitespace-nowrap"
      style={{ color: "var(--text-dim)" }}
    >
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          title={item.tooltip}
          aria-label={item.tooltip}
          className="transition hover:text-[var(--text-secondary)]"
          style={{ color: active[item.key] ? amber : undefined }}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export async function HeaderBar({
  feedFilters,
  basePath = "/",
  countMode = "feed",
  variant = "feed",
  staleCounts,
  changesCounts,
  presidentCounts,
  sponsorCounts,
  feedFilteredCount,
  pageTitle,
  pageCount,
  pageCountLabel = "items",
}: {
  feedFilters?: FeedFilters;
  basePath?: string;
  countMode?: CountMode;
  // "dashboard" drops search/filters/nav and shows corpus count + last sync.
  variant?: HeaderVariant;
  staleCounts?: FeedCount;
  changesCounts?: FeedCount;
  presidentCounts?: FeedCount;
  sponsorCounts?: FeedCount;
  // Filtered count for the feed view, provided by the page so HeaderBar
  // doesn't need to re-run the same COUNT(*) query getFeedBills already did.
  feedFilteredCount?: number;
  // For non-feed pages that still want the standard header chrome with a
  // distinct title and count (e.g. /news). Bypasses the bill-count line.
  pageTitle?: string;
  pageCount?: number;
  pageCountLabel?: string;
}) {
  if (variant === "dashboard") {
    const corpus = await getCorpusStats();
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
          <span
            className="ml-4 text-[13px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {corpus.total.toLocaleString()} bills tracked
            <span> · </span>
            last sync {formatLastUpdated(corpus.lastSync)}
          </span>
          <div className="ml-auto">
            <HeaderNav />
          </div>
        </div>
      </header>
    );
  }

  const includeCeremonial = !!feedFilters?.includeCeremonial;
  const cluster = feedFilters?.cluster;
  const stats = await getFeedStats(includeCeremonial, cluster);
  const showSearch = !!feedFilters;
  // Suppressed on /watchlist and /bill/[id] (no feedFilters threaded in).
  // Also suppressed when a cluster is active — cluster bypasses the
  // ceremonial gate, so the toggle would be a dead control.
  const showCeremonialToggle = !!feedFilters && !cluster;
  const clusterName = cluster ? getClusterPattern(cluster)?.name ?? cluster : null;
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
      !!cluster ||
      (feedFilters?.topics?.length ?? 0) > 0);
  const isFeedMode = basePath === "/feed";
  const isStaleMode = countMode === "stale";
  const isChangesMode = countMode === "changes";
  const isPresidentMode = countMode === "president";
  const isSponsorMode = countMode === "sponsors";
  const isNewsMode = basePath === "/news";
  const isReportsMode = basePath === "/reports";
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
            {pageTitle ? (
              <>
                <span style={{ color: "var(--accent-amber)" }}>
                  {pageTitle}
                </span>
                {pageCount !== undefined ? (
                  <>
                    <span> · </span>
                    <span
                      className="tabular-nums"
                      style={{ color: "var(--accent-amber-bright)" }}
                    >
                      {pageCount.toLocaleString()}
                    </span>
                    <span> {pageCountLabel}</span>
                  </>
                ) : null}
              </>
            ) : counts && (isFiltering || isStaleMode || isChangesMode || isPresidentMode || isSponsorMode) ? (
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
                {clusterName ? (
                  <>
                    <span> · </span>
                    <span style={{ color: "var(--accent-amber)" }}>
                      in {clusterName}
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

        {showCeremonialToggle ? (
          <CeremonialToggle checked={includeCeremonial} />
        ) : null}

        <HeaderNav
          active={{
            feed: isFeedMode,
            news: isNewsMode,
            reports: isReportsMode,
            sponsor: isSponsorMode,
            stale: isStaleMode,
            changes: isChangesMode,
            president: isPresidentMode,
          }}
        />
      </div>
    </header>
  );
}
