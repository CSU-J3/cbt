import Link from "next/link";
import { BillRow } from "@/components/BillRow";
import { ChamberToggle } from "@/components/ChamberToggle";
import { HeaderBar } from "@/components/HeaderBar";
import { Pagination } from "@/components/Pagination";
import { SortDropdown } from "@/components/SortDropdown";
import { StageFilter } from "@/components/StageFilter";
import { StageLegend } from "@/components/StageLegend";
import { TopicFilter } from "@/components/TopicFilter";
import { timed } from "@/lib/perf";
import {
  FEED_PAGE_SIZE,
  getFeedBills,
  isInWatchlist,
  sanitizeChamber,
  sanitizeSort,
  sanitizeStage,
  sanitizeTopics,
} from "@/lib/queries";

type SearchParams = {
  topics?: string;
  stage?: string;
  expanded?: string;
  q?: string;
  sponsor?: string;
  sort?: string;
  page?: string;
  chamber?: string;
};

export const revalidate = 300;

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const pageT0 = performance.now();
  const params = await searchParams;
  const topics = sanitizeTopics(params.topics);
  const stage = sanitizeStage(params.stage);
  const expandedParam = typeof params.expanded === "string" ? params.expanded : undefined;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const sponsor =
    typeof params.sponsor === "string" && params.sponsor.trim()
      ? params.sponsor.trim()
      : undefined;
  const sort = sanitizeSort(params.sort);
  const chamber = sanitizeChamber(params.chamber);
  const hasFilters = topics.length > 0 || !!stage || !!sponsor || !!chamber;
  const feedFilters = { topics, stage, q: q || undefined, sponsor, sort, chamber };

  const rawPage = Number.parseInt(params.page ?? "1", 10);
  const requestedPage = Number.isFinite(rawPage) ? rawPage : 1;
  const {
    bills,
    page: currentPage,
    totalPages,
    total: filteredCount,
  } = await timed("getFeedBills", () =>
    getFeedBills(feedFilters, {
      page: requestedPage,
      pageSize: FEED_PAGE_SIZE,
    }),
  );
  const expandedId = expandedParam && bills.some((b) => b.id === expandedParam)
    ? expandedParam
    : undefined;
  const onWatchlist = expandedId
    ? await timed("isInWatchlist", () => isInWatchlist(expandedId))
    : false;
  console.log(`[perf] /  page-data: ${Math.round(performance.now() - pageT0)}ms`);

  const carry = new URLSearchParams();
  if (topics.length > 0) carry.set("topics", topics.join(","));
  if (stage) carry.set("stage", stage);
  if (q) carry.set("q", q);
  if (sponsor) carry.set("sponsor", sponsor);
  if (sort && sort !== "action") carry.set("sort", sort);
  if (chamber) carry.set("chamber", chamber);

  const clearSearchParams = new URLSearchParams();
  if (topics.length > 0) clearSearchParams.set("topics", topics.join(","));
  if (stage) clearSearchParams.set("stage", stage);
  const clearSearchHref = clearSearchParams.toString()
    ? `/?${clearSearchParams.toString()}`
    : "/";

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar feedFilters={feedFilters} feedFilteredCount={filteredCount} />

      <main className="w-full flex-1 px-4 py-4">
        <section
          className="mb-3 flex flex-col gap-3"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <div className="filter-chips flex flex-wrap items-center gap-3">
            <StageFilter
              current={stage}
              topics={topics}
              q={q}
              sponsor={sponsor}
              sort={sort}
              chamber={chamber}
            />
            <ChamberToggle current={chamber} carry={carry} basePath="/" />
            <span
              className="ml-auto flex items-center gap-2 text-[12px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              Sort
              <SortDropdown current={sort} basePath="/" />
            </span>
            {hasFilters ? (
              <Link
                href={q ? `/?q=${encodeURIComponent(q)}` : "/"}
                className="text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
                style={{ color: "var(--text-dim)" }}
              >
                Clear filters ✕
              </Link>
            ) : null}
          </div>
          <div className="filter-chips flex flex-wrap items-center gap-3">
            <span
              className="text-[12px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              Topics
            </span>
            <TopicFilter
              selected={topics}
              stage={stage}
              q={q}
              sponsor={sponsor}
              sort={sort}
              chamber={chamber}
            />
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            carry={carry}
            basePath="/"
          />
        </section>

        <div
          className="border"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <StageLegend />
          <div className="feed-header-row">
            <span aria-hidden></span>
            <span>Bill</span>
            <span>Title / Sponsor</span>
            <span>Stage</span>
            <span className="col-date">Action</span>
            <span>Topics</span>
          </div>

          {bills.length === 0 ? (
            q ? (
              <div
                className="px-6 py-12 text-center"
                style={{ color: "var(--text-secondary)" }}
              >
                <p className="text-[14px] uppercase tracking-[0.5px]">
                  No bills match &quot;{q}&quot;
                </p>
                <p
                  className="mt-2 text-[13px]"
                  style={{ color: "var(--text-dim)" }}
                >
                  Try a broader term, check spelling, or clear the search.
                </p>
                <Link
                  href={clearSearchHref}
                  className="mt-4 inline-block border px-3 py-1 text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--bg-base)] hover:bg-[var(--accent-amber)]"
                  style={{
                    color: "var(--accent-amber)",
                    borderColor: "var(--accent-amber)",
                  }}
                >
                  [Clear search]
                </Link>
              </div>
            ) : (
              <div
                className="px-6 py-8 text-center text-[13px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-dim)" }}
              >
                No bills match these filters
              </div>
            )
          ) : (
            <>
              <ul>
                {bills.map((b) => (
                  <BillRow
                    key={b.id}
                    bill={b}
                    filters={{ topics, stage, q, sponsor, sort, chamber, page: currentPage }}
                    basePath="/"
                    expandedId={expandedId}
                    onWatchlist={expandedId === b.id ? onWatchlist : false}
                    introducedDate={b.introduced_date}
                  />
                ))}
              </ul>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                carry={carry}
                basePath="/"
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
