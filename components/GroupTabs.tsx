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

export type Group = "feed" | "members" | "patterns";

type GroupTab = {
  slug: string;
  label: string;
  href: string;
};

export const GROUP_TABS: Record<Group, readonly GroupTab[]> = {
  feed: [
    { slug: "bills", label: "Bills", href: "/feed" },
    { slug: "news", label: "News", href: "/news" },
    { slug: "reports", label: "Reports", href: "/reports" },
    { slug: "changes", label: "Changes", href: "/changes" },
    { slug: "president", label: "President", href: "/president" },
  ],
  members: [
    { slug: "members", label: "Members", href: "/members" },
    { slug: "committees", label: "Committees", href: "/committees" },
    { slug: "races", label: "Races", href: "/races" },
    { slug: "primaries", label: "Primaries", href: "/primaries" },
  ],
  patterns: [
    { slug: "patterns", label: "Patterns", href: "/patterns" },
    { slug: "trends", label: "Trends", href: "/trends" },
    { slug: "stale", label: "Stale", href: "/stale" },
  ],
};

export type NavKey = "dashboard" | Group | "reports" | "watchlist";

// Inverts GROUP_TABS so HeaderBar can derive the active top-nav key
// from the basePath each page passes in. /watchlist is a standalone
// top-nav target with no group tabs.
//
// HO 154.5 added sub-route active states: when a detail page passes
// its actual URL as basePath (e.g. "/bill/119-hr-1"), the prefix
// matchers below light up the correct top-nav tab — /bill/* → feed,
// /committee/* / /race/* / /members/[bioguideId] → members,
// /reports/[slug] → reports. Detail pages on a category surface
// (Members, Feed, etc.) now keep that surface highlighted instead of
// dropping the nav back to "no active tab".
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
  if (basePath.startsWith("/members/")) return "members";
  if (basePath.startsWith("/committee/")) return "members";
  if (basePath.startsWith("/race/")) return "members";
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
      className="search-tabs"
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
