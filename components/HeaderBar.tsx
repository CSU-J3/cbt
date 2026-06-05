import Link from "next/link";
import { BreadcrumbMasthead } from "@/components/BreadcrumbMasthead";
import { CeremonialToggle } from "@/components/CeremonialToggle";
import { DualMarketsTape } from "@/components/DualMarketsTape";
import { type NavKey, pathToNavKey } from "@/components/GroupTabs";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { SearchBox } from "@/components/SearchBox";
import { breadcrumbSegments } from "@/lib/breadcrumb";
import { getClusterPattern } from "@/lib/cluster-patterns";
import { formatLastUpdated } from "@/lib/format";
import {
  type FeedCount,
  type FeedFilters,
  getFeedStats,
} from "@/lib/queries";

type CountMode = "feed" | "stale" | "changes" | "president" | "sponsors";

// HO 131 / 134: shared nav-item config consumed by both HeaderNav
// (top-right chrome on /bills-shaped pages) and HomeHeader (under-title
// row on /). HO 134 collapsed 12 individual destinations to a handful of
// group landings — every secondary destination now lives inside a GroupTabs
// strip on the group landing page. NavItemKey mirrors NavKey from
// GroupTabs since the top nav's vocabulary is exactly the set of values
// pathToNavKey() can return (the sub-nav groups — feed / members / races
// (HO 173) / patterns — plus standalone /watchlist and the top-level
// /reports and Dashboard).
export type NavItemKey = NavKey;

export type NavItem = {
  key: NavItemKey;
  href: string;
  /** Glyph rendered separately from the label so the home header can
   * size icons (16px) independently from text (14px) per the home
   * dashboard cleanup handoff. */
  icon: string;
  label: string;
  tooltip: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", href: "/", icon: "⌂", label: "Dashboard", tooltip: "Dashboard summary" },
  { key: "feed", href: "/bills", icon: "▤", label: "Bills|News", tooltip: "Bills, news, stage changes, and the president's desk" },
  { key: "members", href: "/members", icon: "👥", label: "Members", tooltip: "All 536 Members, 2026 races, and the primary calendar" },
  { key: "races", href: "/races", icon: "🗳", label: "Races", tooltip: "Competitive 2026 races and forecaster ratings" },
  { key: "patterns", href: "/patterns", icon: "⊞", label: "Patterns", tooltip: "Bill shapes, long-run trends, and stalled bills" },
  { key: "reports", href: "/reports", icon: "⎘", label: "Reports", tooltip: "Weekly reports — newest first" },
  { key: "watchlist", href: "/watchlist", icon: "★", label: "Watchlist", tooltip: "Bills you've flagged with the watch star" },
];

function HeaderNav({ active }: { active: NavItemKey | null }) {
  const amber = "var(--accent-amber)";
  return (
    <nav
      className="header-nav flex flex-wrap items-center gap-y-2 gap-4 text-[13px] uppercase tracking-[0.5px] whitespace-nowrap"
      style={{ color: "var(--text-dim)" }}
    >
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          title={item.tooltip}
          aria-label={item.tooltip}
          className="transition hover:text-[var(--text-secondary)]"
          style={{ color: active === item.key ? amber : undefined }}
        >
          <span aria-hidden>{item.icon}</span> {item.label}
        </Link>
      ))}
    </nav>
  );
}

export async function HeaderBar({
  feedFilters,
  basePath = "/",
  countMode = "feed",
  staleCounts,
  changesCounts,
  presidentCounts,
  sponsorCounts,
  feedFilteredCount,
  pageTitle,
  pageCount,
  pageCountLabel = "items",
  detail,
  mode,
  presidentAlias,
  pageOwnsControls,
  cursorAtEnd,
  liftSyncContrast,
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
  // For non-feed pages that still want the standard header chrome with a
  // distinct title and count (e.g. /news). Bypasses the bill-count line.
  pageTitle?: string;
  pageCount?: number;
  pageCountLabel?: string;
  // HO 185 breadcrumb inputs: `detail` is the detail-page last segment
  // (HR 9081, member last name, committee name, …); `mode` lets /bills pick
  // Bills vs News; `presidentAlias` adds the "President" segment for the
  // /bills?stage=president alias. Sourced from data the page already fetched.
  detail?: string;
  mode?: "bills" | "news";
  presidentAlias?: boolean;
  // HO 187: when a page renders its own band-3 control strip (compact search +
  // ceremonial + filters), it passes this so HeaderBar suppresses the
  // transitional legacy-controls band below the sync strip. /bills owns its
  // controls; /changes + /stale flip this in their sub-stage. TRANSITIONAL —
  // remove the prop + the legacy band once every feed page owns its controls.
  pageOwnsControls?: boolean;
  // HO 195: Members-only chrome divergences. `cursorAtEnd` moves the blinking
  // caret off the breadcrumb `>` (suppressed there) to the END of the inline
  // sync string. `liftSyncContrast` lifts the sync run to --text-muted and the
  // count number to --text-secondary. Both default off — every other page keeps
  // the cursor glued to `>` and the dim sync (no regression).
  cursorAtEnd?: boolean;
  liftSyncContrast?: boolean;
}) {
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
  const isStaleMode = countMode === "stale";
  const isChangesMode = countMode === "changes";
  const isPresidentMode = countMode === "president";
  const isSponsorMode = countMode === "sponsors";
  const useAccentBright =
    isStaleMode || isChangesMode || isPresidentMode || isSponsorMode;

  return (
    <header style={{ position: "relative", backgroundColor: "var(--bg-panel)" }}>
      {/* Inner-page chrome (HO 187 band consolidation):
          Band 1 — TITLE BAR: the PowerShell path (left) + the main nav (right)
          on one row, merging HO 185's separate masthead + nav rows. flex-wrap
          so a deep detail path bumps the nav to a second line rather than
          wrapping the path itself (the path is the identity).
          The dual markets tape sits BELOW the title bar — HO 187 removed it
          from inner pages, then HO 202 restored it app-wide (the dual
          counter-scrolling pair, the same <DualMarketsTape> the dashboard's
          HomeHeader mounts), matching the dashboard's masthead → tape → nav
          order. */}
      <div className="header-titlebar">
        <BreadcrumbMasthead
          segments={breadcrumbSegments(basePath, { mode, presidentAlias, detail })}
          cursor={!cursorAtEnd}
        />
        {/* HO 189: sync inline after the breadcrumb cursor
            (`…Bills>_ · N BILLS · UPDATED MT`); the HO 187 standalone band is
            gone. The span ALWAYS renders with `flex: 1 1 0` — basis 0 so its
            content width never triggers the nav to wrap; it grows to fill the
            path→nav gap and ellipsis-truncates when the gap is tight (the sync
            gives first; the nav wraps only when path+nav alone overflow). Empty
            on detail pages (deep paths, corpus count isn't page-specific) — it
            still flex-grows to keep the nav right-aligned, just shows nothing
            (no dangling ellipsis). */}
        <span
          className="header-titlebar-sync"
          style={
            liftSyncContrast ? { color: "var(--text-muted)" } : undefined
          }
        >
          {detail ? null : (
            <>
            {" · "}
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
              <>
                <span
                  style={
                    liftSyncContrast
                      ? { color: "var(--text-secondary)" }
                      : undefined
                  }
                >
                  {stats.total.toLocaleString()}
                </span>{" "}
                bills
              </>
            )}
            <span> · </span>
            updated {formatLastUpdated(stats.lastUpdated)}
            {/* HO 195: on Members the caret trails the full sync string
                (cursor suppressed on the breadcrumb `>`) — a deliberate
                divergence from Bills, where it stays glued to `>`. */}
            {cursorAtEnd ? (
              <span aria-hidden className="home-cursor-caret">
                {" _"}
              </span>
            ) : null}
            </>
          )}
        </span>
        <div className="header-titlebar-nav">
          <HeaderNav active={pathToNavKey(basePath)} />
          <MobileNavDrawer items={NAV_ITEMS} active={pathToNavKey(basePath)} />
        </div>
      </div>

      {/* HO 202: the dual markets tape, restored to every inner page (one mount
          here reaches all HeaderBar pages, mirroring HomeHeader's single mount
          for the dashboard). Below the title bar to match the dashboard's
          masthead → tape → nav order. Hidden <700px by the global .markets-tape
          rule, same as the dashboard. */}
      <DualMarketsTape />

      {/* Transitional (HO 187): feed pages that haven't built their own band-3
          control strip yet (/changes, /stale until their sub-stage) still get
          search + ceremonial here. /bills passes pageOwnsControls and renders
          them in its own control strip, so this is suppressed there. Remove
          this block + the prop once every feed page owns its controls. */}
      {!pageOwnsControls && showSearch ? (
        <div className="header-legacy-controls">
          <div className="control-search">
            <SearchBox basePath={basePath} compact />
          </div>
          {showCeremonialToggle ? (
            <CeremonialToggle checked={includeCeremonial} />
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
