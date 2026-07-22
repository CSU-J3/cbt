import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import { SearchBox } from "@/components/SearchBox";
import { SearchResultsBills } from "@/components/SearchResultsBills";
import { SearchResultsMembers } from "@/components/SearchResultsMembers";
import { SearchResultsNews } from "@/components/SearchResultsNews";
import { SearchResultsReports } from "@/components/SearchResultsReports";
import { SearchTabs } from "@/components/SearchTabs";
import {
  SEARCH_TABS,
  type SearchTab,
  sanitizeQ,
  sanitizeSearchTab,
  searchBillsCount,
  searchMembersCount,
  searchNewsCount,
  searchReportsCount,
} from "@/lib/queries";

type SearchParams = {
  q?: string;
  tab?: string;
};

const TAB_LABELS: Record<SearchTab, string> = {
  bills: "LEGISLATION",
  members: "MEMBERS",
  news: "NEWS",
  reports: "REPORTS",
};

// Empty-state hint: when the active tab has zero matches but another tab
// has matches, surface the largest non-empty tab so a "no matches" result
// is still a launchpad, not a dead end.
function highestNonEmptyTab(
  counts: Record<SearchTab, number>,
  exclude: SearchTab,
): { tab: SearchTab; count: number } | null {
  let best: { tab: SearchTab; count: number } | null = null;
  for (const tab of SEARCH_TABS) {
    if (tab === exclude) continue;
    const count = counts[tab];
    if (count > 0 && (!best || count > best.count)) {
      best = { tab, count };
    }
  }
  return best;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = sanitizeQ(params.q);
  const active = sanitizeSearchTab(params.tab);
  // HO 490: page-computed clock threaded to the bills/news result rows (#418).
  const nowMs = Date.now();

  // Parallel count queries — every tab runs on every page load so the
  // strip stays informative. Result fetch only on the active tab.
  const [billsCount, membersCount, newsCount, reportsCount] =
    await Promise.all([
      searchBillsCount(q),
      searchMembersCount(q),
      searchNewsCount(q),
      searchReportsCount(q),
    ]);
  const counts: Record<SearchTab, number> = {
    bills: billsCount,
    members: membersCount,
    news: newsCount,
    reports: reportsCount,
  };
  const total = billsCount + membersCount + newsCount + reportsCount;
  const activeCount = counts[active];
  const fallback =
    activeCount === 0 && total > 0
      ? highestNonEmptyTab(counts, active)
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/search" />

      <main className="w-full flex-1 px-4 py-4">
        <div className="search-layout">
          <div className="mb-3 max-w-md">
            <SearchBox basePath="/search" placeholder="search everything..." />
          </div>

          {!q ? (
            <p className="search-empty-hint">
              Enter a query to search bills, members, news, and reports.
            </p>
          ) : (
            <>
              <div
                className="mb-3 text-[12px] uppercase tracking-[0.5px] tabular-nums"
                style={{ color: "var(--text-muted)" }}
              >
                <span style={{ color: "var(--accent-amber)" }}>
                  {activeCount.toLocaleString()}
                </span>{" "}
                {activeCount === 1 ? "result" : "results"} in {TAB_LABELS[active]} ·{" "}
                <span style={{ color: "var(--text-secondary)" }}>&quot;{q}&quot;</span>
              </div>

              <SearchTabs q={q} active={active} counts={counts} />

              {activeCount === 0 ? (
                <p className="search-empty-hint">
                  No matches in {TAB_LABELS[active]}
                  {fallback ? (
                    <>
                      {" · "}
                      <Link
                        href={`/search?q=${encodeURIComponent(q)}&tab=${fallback.tab}`}
                        scroll={false}
                      >
                        TRY {TAB_LABELS[fallback.tab]} ({fallback.count.toLocaleString()} MATCHES) →
                      </Link>
                    </>
                  ) : (
                    <> for &quot;{q}&quot; across bills, members, news, or reports.</>
                  )}
                </p>
              ) : (
                <>
                  {active === "bills" ? <SearchResultsBills q={q} nowMs={nowMs} /> : null}
                  {active === "members" ? <SearchResultsMembers q={q} /> : null}
                  {active === "news" ? <SearchResultsNews q={q} nowMs={nowMs} /> : null}
                  {active === "reports" ? <SearchResultsReports q={q} /> : null}
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
