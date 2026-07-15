import Link from "next/link";
import { Fragment } from "react";
import { auth } from "@/auth";
import { AuthButton } from "@/components/AuthButton";
import { BreadcrumbMasthead } from "@/components/BreadcrumbMasthead";
import { CeremonialToggle } from "@/components/CeremonialToggle";
import { CyclingTimestamp } from "@/components/CyclingTimestamp";
import { type NavKey, pathToNavKey } from "@/components/GroupTabs";
import { MobileNavDrawer } from "@/components/MobileNavDrawer";
import { SearchBox } from "@/components/SearchBox";
import { breadcrumbSegments } from "@/lib/breadcrumb";
import { type FeedFilters, getCorpusStats } from "@/lib/queries";

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
  { key: "feed", href: "/bills", icon: "▤", label: "Legislation", tooltip: "Legislation, news, stage changes, and the president's desk" },
  { key: "hearings", href: "/hearings", icon: "▦", label: "Hearings", tooltip: "Committee hearings, markups, and business meetings" },
  { key: "members", href: "/members", icon: "👥", label: "Members", tooltip: "All 536 Members, 2026 races, and the primary calendar" },
  { key: "races", href: "/electoral", icon: "🗳", label: "Electoral", tooltip: "Competitive 2026 races, forecaster ratings, and the primary calendar" },
  { key: "patterns", href: "/patterns", icon: "⊞", label: "Patterns", tooltip: "Bill shapes, long-run trends, and stalled bills" },
  { key: "lobbying", href: "/lobbying", icon: "$", label: "Lobbying", tooltip: "What's being lobbied — LD-2 filings by issue area, and who's paying" },
  { key: "nominations", href: "/nominations", icon: "◈", label: "Nominations", tooltip: "Presidential nominations — who's being confirmed, by agency and status" },
  { key: "amendments", href: "/amendments", icon: "Δ", label: "Amendments", tooltip: "Floor amendments — who's amending which bills, and the sliver that gets voted on" },
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
// \LOBBYING \NOMINATIONS | \REPORTS \WATCHLIST (dividers before index 1 and 8 — HO
// 264 inserted \HEARINGS, HO 437 inserted \LOBBYING, and HO 456 inserted
// \NOMINATIONS into the middle group, bumping \REPORTS from 5 → 6 → 7 → 8).
// Styling lives under
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
          {i === 1 || i === 8 ? (
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
  detail,
  mode,
  presidentAlias,
  pageOwnsControls,
}: {
  feedFilters?: FeedFilters;
  basePath?: string;
  // HO 185 breadcrumb inputs: `detail` is the detail-page last segment
  // (HR 9081, member last name, committee name, …); `mode` lets /bills pick
  // Bills vs News; `presidentAlias` adds the "President" segment for the
  // /bills?stage=president alias. Sourced from data the page already fetched.
  detail?: string;
  mode?: "bills" | "news";
  presidentAlias?: boolean;
  // HO 187: when a page renders its own band-3 control strip (compact search +
  // ceremonial + filters), it passes this so HeaderBar suppresses the
  // transitional legacy-controls band below the nav row. /bills owns its
  // controls; /changes + /stale flip this in their sub-stage. TRANSITIONAL —
  // remove the prop + the legacy band once every feed page owns its controls.
  pageOwnsControls?: boolean;
}) {
  const includeCeremonial = !!feedFilters?.includeCeremonial;
  const cluster = feedFilters?.cluster;
  // HO 325: the LAST SYNC subhead reads the dashboard's EXACT source —
  // getCorpusStats(true).lastSync (global, filter-independent) — so the inner-page
  // time can't drift from the dashboard's on filtered pages (getFeedStats's
  // lastUpdated varies with includeCeremonial/cluster; this doesn't).
  const corpus = await getCorpusStats(true);
  // HO 355: read identity server-side and hand it to the AuthButton island (no
  // SessionProvider). A1 gates nothing — anonymous browsing is unaffected.
  const session = await auth();
  const showSearch = !!feedFilters;
  // Suppressed on /watchlist and /bill/[id] (no feedFilters threaded in).
  // Also suppressed when a cluster is active — cluster bypasses the
  // ceremonial gate, so the toggle would be a dead control.
  const showCeremonialToggle = !!feedFilters && !cluster;

  return (
    <header style={{ position: "relative", backgroundColor: "var(--bg-panel)" }}>
      {/* HO 323 — standardized inner-page chrome: TITLE ROW (breadcrumb path
          ONLY) → LAST SYNC subhead (HO 325) → NAV ROW (its own full-width row,
          the dashboard nav styling) → page content. The markets tape and the
          inline count metadata were removed from inner pages (tickers + the stat
          readout are dashboard-only now); the blink caret falls back to the
          breadcrumb path end on every page. HO 326 swept the dead count path:
          the count/stats computations, the call-site count props, and the
          orphaned `.header-titlebar-sync` / `.header-titlebar-nav` classes are
          gone. */}
      <div className="header-titlebar">
        <BreadcrumbMasthead
          segments={breadcrumbSegments(basePath, { mode, presidentAlias, detail })}
          cursor
        />
        <span style={{ marginLeft: "auto" }}>
          <AuthButton user={session?.user ? { name: session.user.name ?? null } : null} />
        </span>
      </div>

      {/* HO 325 — LAST SYNC subhead on its own line, between the title row and the
          nav row, matching the dashboard's `· LAST SYNC <time>` exactly: same
          label, the HO 183 zone-cycling time (CyclingTimestamp), reading the same
          global source (getCorpusStats(true).lastSync). No caret (the dashboard's
          subhead has none). The count does NOT return (HO 323). */}
      <p className="header-sync-sub">
        ·{" "}
        <span className="show-desktop">LAST SYNC </span>
        <CyclingTimestamp iso={corpus.lastSync} />
      </p>

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
