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

export type NavKey = "dashboard" | Group | "watchlist";

// Inverts GROUP_TABS so HeaderBar can derive the active top-nav key
// from the basePath each page already passes in. /watchlist is a
// standalone top-nav target with no group tabs. /search, /bill/[id],
// etc. return null (no top-nav highlight).
//
// Note: `/` is intentionally NOT handled here. The home page renders
// HomeHeader (not HeaderBar), which sets its own Dashboard-active
// highlight via the NavItemKey == "dashboard" check (HO 140). HeaderBar's
// default basePath="/" must therefore return null so detail pages that
// omit an explicit basePath (/watchlist, /bill/[id], /members/[bioguideId],
// /race/[id], /reports/[slug]) don't falsely light up the Dashboard tab.
export function pathToNavKey(basePath: string): NavKey | null {
  if (basePath === "/watchlist") return "watchlist";
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
