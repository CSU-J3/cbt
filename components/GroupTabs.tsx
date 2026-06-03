import Link from "next/link";

// HO 134 Phase 3: group-level tab strip that sits directly below the
// HeaderBar on every group-member page. GROUP_TABS is the single source
// of truth for which routes belong to which group — HeaderBar inverts
// it via pathToNavKey() to highlight the right top-nav entry, and each
// page hard-codes its own (group, active) pair at the call site for
// grep-ability.
//
// Visually reuses the .search-tabs CSS class from SearchTabs.tsx; the
// .count / .data-empty rules there harmlessly don't match here.

export type Group = "feed" | "members" | "races" | "patterns";

type GroupTab = {
  slug: string;
  label: string;
  href: string;
};

export const GROUP_TABS: Record<Group, readonly GroupTab[]> = {
  // HO 184: Bills + News dropped from this row. The BILLS|NEWS segmented
  // toggle on the /bills page is the canonical mode switch, so listing them
  // here too was a redundant second way to switch the same mode. What remains
  // are sibling / derived views of the bill feed. Reports is deliberately kept
  // (it's also a top-level nav item — a pre-existing intentional special-case,
  // out of scope for this cleanup). Tradeoff: in bills/news mode no tab in this
  // row is active — accepted in HO 184.
  feed: [
    { slug: "changes", label: "Changes", href: "/changes" },
    { slug: "president", label: "President", href: "/president" },
    { slug: "reports", label: "Reports", href: "/reports" },
  ],
  members: [
    { slug: "members", label: "Members", href: "/members" },
    { slug: "committees", label: "Committees", href: "/committees" },
  ],
  // HO 173: electoral surfaces split out of the members group into their
  // own sub-nav. Keyed "races" (not "electoral") so the group key unifies
  // with the existing top-nav `races` NavItem — pathToNavKey's group loop
  // then returns "races" for both /races and /primaries with no extra
  // matcher, and /primaries lights the Races top-nav tab.
  races: [
    { slug: "races", label: "Races", href: "/races" },
    { slug: "primaries", label: "Primaries", href: "/primaries" },
  ],
  patterns: [
    { slug: "patterns", label: "Patterns", href: "/patterns" },
    { slug: "trends", label: "Trends", href: "/trends" },
    { slug: "stale", label: "Stale", href: "/stale" },
  ],
};

// "races" is no longer listed separately — it's a Group as of HO 173.
export type NavKey = "dashboard" | Group | "reports" | "watchlist";

// Inverts GROUP_TABS so HeaderBar can derive the active top-nav key
// from the basePath each page passes in. /watchlist is a standalone
// top-nav target with no group tabs.
//
// HO 154.5 added sub-route active states: when a detail page passes
// its actual URL as basePath (e.g. "/bill/119-hr-1"), the prefix
// matchers below light up the correct top-nav tab — /bill/* → feed,
// /committee/* / /members/[bioguideId] → members, /race/* → races
// (HO 173), /reports/[slug] → reports. Detail pages on a category
// surface now keep that surface highlighted instead of dropping the
// nav back to "no active tab".
//
// /reports is BOTH a top-level nav item (HO 150) AND a sub-tab inside
// the `feed` group, so it's special-cased before the group loop —
// without this check the loop would return `"feed"` and the Reports
// landing would light up the Feed tab.
//
// Note: `/` is intentionally NOT handled here. The home page renders
// HomeHeader (not HeaderBar), which sets its own Dashboard-active
// highlight via the NavItemKey == "dashboard" check (HO 140).
// HeaderBar's default basePath="/" therefore must return null so any
// page that omits an explicit basePath doesn't falsely light up the
// Dashboard tab; with HO 154.5 every detail page passes its actual
// URL so this fallback is just defensive.
export function pathToNavKey(basePath: string): NavKey | null {
  if (basePath === "/watchlist") return "watchlist";
  if (basePath === "/reports" || basePath.startsWith("/reports/"))
    return "reports";
  if (basePath === "/bill" || basePath.startsWith("/bill/")) return "feed";
  // HO 184: /bills (the Bills|News landing) no longer has a GROUP_TABS entry —
  // Bills/News were dropped from the feed sub-nav (the segmented toggle owns
  // mode switching). Match it explicitly so the top-nav "Bills|News" still
  // highlights. The bills, news, and president-alias views all render at
  // basePath "/bills".
  if (basePath === "/bills") return "feed";
  if (basePath.startsWith("/members/")) return "members";
  if (basePath.startsWith("/committee/")) return "members";
  // `/race/[id]` detail → Races. The `/races` index and `/primaries` are
  // left to the group loop below: both live in the `races` GROUP_TABS group
  // (HO 173), so the loop returns "races" for them. This matcher only needs
  // to catch the dynamic detail route, which has no exact GROUP_TABS href.
  if (basePath.startsWith("/race/")) return "races";
  for (const group of Object.keys(GROUP_TABS) as Group[]) {
    if (GROUP_TABS[group].some((t) => t.href === basePath)) {
      return group;
    }
  }
  return null;
}

export function GroupTabs({
  group,
  active,
}: {
  group: Group;
  active: string;
}) {
  const tabs = GROUP_TABS[group];
  return (
    <nav
      className="search-tabs flex-wrap"
      role="tablist"
      aria-label={`${group} group tabs`}
    >
      {tabs.map((tab) => {
        const isActive = tab.slug === active;
        return (
          <Link
            key={tab.slug}
            href={tab.href}
            role="tab"
            aria-current={isActive ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
