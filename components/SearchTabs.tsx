"use client";

import Link from "next/link";
import { SEARCH_TABS, type SearchTab } from "@/lib/queries";

const TAB_LABELS: Record<SearchTab, string> = {
  bills: "Bills",
  members: "Members",
  news: "News",
  reports: "Reports",
};

// Plain server-rendered Links — no router.push, no state, no JS needed
// for navigation. The "use client" boundary buys us nothing here today,
// but isolating the tab strip keeps the door open for a count-stream
// upgrade later without touching the page server component.
export function SearchTabs({
  q,
  active,
  counts,
}: {
  q: string;
  active: SearchTab;
  counts: Record<SearchTab, number>;
}) {
  return (
    <nav className="search-tabs" role="tablist" aria-label="Search result categories">
      {SEARCH_TABS.map((tab) => {
        const sp = new URLSearchParams();
        if (q) sp.set("q", q);
        sp.set("tab", tab);
        const href = `/search?${sp.toString()}`;
        const isActive = tab === active;
        const count = counts[tab];
        return (
          <Link
            key={tab}
            href={href}
            scroll={false}
            role="tab"
            aria-current={isActive ? "page" : undefined}
            data-empty={count === 0 ? "true" : undefined}
          >
            {TAB_LABELS[tab]}
            <span className="count">({count.toLocaleString()})</span>
          </Link>
        );
      })}
    </nav>
  );
}
