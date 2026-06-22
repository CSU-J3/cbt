import Link from "next/link";
import { Fragment } from "react";
import { BreadcrumbMasthead } from "@/components/BreadcrumbMasthead";
import { CeremonialToggle } from "@/components/CeremonialToggle";
import { MarketsTape } from "@/components/MarketsTape";
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
  { key: "feed", href: "/bills", icon: "▤", label: "Bills", tooltip: "Bills, news, stage changes, and the president's desk" },
  { key: "hearings", href: "/hearings", icon: "▦", label: "Hearings", tooltip: "Committee hearings, markups, and business meetings" },
  { key: "members", href: "/members", icon: "👥", label: "Members", tooltip: "All 536 Members, 2026 races, and the primary calendar" },
  { key: "races", href: "/races", icon: "🗳", label: "Races", tooltip: "Competitive 2026 races and forecaster ratings" },
  { key: "patterns", href: "/patterns", icon: "⊞", label: "Patterns", tooltip: "Bill shapes, long-run trends, and stalled bills" },
  { key: "reports", href: "/reports", icon: "⎘", label: "Reports", tooltip: "Weekly reports — newest first" },
  { key: "watchlist", href: "/watchlist", icon: "★", label: "Watchlist", tooltip: "Bills you've flagged with the watch star" },
];

// HO 230 (design items 9+10) — text-only PowerShell-path nav. Shared by the
// dashboard (HomeHeader, `variant="home"`) and inner pages (HeaderBar,
// `variant="bar"`) so the two never diverge. Each item is `\LABEL` (dim slash,
// no icons); the active item gets amber `[ \LABEL ]` brackets + amber-bright
// label + amber-bright underline, with bracket space reserved on every item so
// switching the active item causes no horizontal shift. Three groups split by
// short vertical rules: \DASHBOARD | \BILLS \HEARINGS \MEMBERS \RACES \PATTERNS
// | \REPORTS \WATCHLIST (dividers before index 1 and 6 — HO 264 inserted
// \HEARINGS into the middle group, bumping \REPORTS from 5 to 6). Styling lives under
// `.primary-nav .pnav-*` in globals.css (specificity beats `.home-header-nav a`).
export function PrimaryNav({
  active,
  variant,
}: {
  active: NavItemKey | null;
  variant: "home" | "bar";
}) {
  const wrapperClass =
    variant === "home"
      ? "primary-nav home-header-nav"
      : "primary-nav header-nav flex flex-wrap items-center gap-y-2 gap-x-3 text-[13px] uppercase tracking-[0.5px] whitespace-nowrap";
  return (
    <nav className={wrapperClass} aria-label="Primary navigation">
      {NAV_ITEMS.map((item, i) => (
        <Fragment key={item.key}>
          {i === 1 || i === 6 ? (
            <span className="pnav-divider" aria-hidden />
          ) : null}
          <Link
            href={item.href}
            title={item.tooltip}
            aria-label={item.tooltip}
            aria-current={active === item.key ? "page" : undefined}
            className="pnav-item"
          >
            <span className="pnav-bracket" aria-hidden>
              [
            </span>
            <span className="pnav-slash" aria-hidden>
              {"\\"}
            </span>
            <span className="pnav-text">{item.label}</span>
            <span className="pnav-bracket" aria-hidden>
              ]
            </span>
          </Link>
        </Fragment>
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
          The markets tape sits BELOW the title bar — HO 187 removed it from
          inner pages, HO 202 restored it app-wide, and HO 234 collapsed it to a
          single combined <MarketsTape /> (the same one HomeHeader mounts) so the
          tape is identical global chrome on every page. */}
      {/* HO 323 — standardized inner-page chrome: TITLE ROW (breadcrumb path
          ONLY) → NAV ROW (its own full-width row, the dashboard nav styling) →
          page content. The markets tape and the inline count/sync metadata were
          removed from inner pages (tickers + the stat readout are dashboard-only
          now); the blink caret falls back to the breadcrumb path end on every
          page. The now-unused count/sync computations + call-site props
          (pageCount/pageTitle/countMode/staleCounts/.../cursorAtEnd/
          liftSyncContrast) and the orphaned `.header-titlebar-sync` /
          `.header-titlebar-nav` classes are flagged for the backlog cleanup, not
          swept here. */}
      <div className="header-titlebar">
        <BreadcrumbMasthead
          segments={breadcrumbSegments(basePath, { mode, presidentAlias, detail })}
          cursor
        />
      </div>

      {/* Nav on its own full-width row, matching the dashboard: PrimaryNav
          variant="home" = the `.home-header-nav` styling (bracketed active item,
          group dividers, reserved bracket space → no horizontal jump, the subtle
          top-border separator). `.header-nav-row` adds the inner-page `--space-lg`
          padding so it aligns with the title + page content. */}
      <div className="header-nav-row">
        <PrimaryNav active={pathToNavKey(basePath)} variant="home" />
      </div>
      <MobileNavDrawer items={NAV_ITEMS} active={pathToNavKey(basePath)} />

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
