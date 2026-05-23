import Link from "next/link";
import { BillRow } from "@/components/BillRow";
import { ChamberToggle } from "@/components/ChamberToggle";
import { HeaderBar } from "@/components/HeaderBar";
import { Pagination } from "@/components/Pagination";
import { SortDropdown } from "@/components/SortDropdown";
import { StageFilter } from "@/components/StageFilter";
import { StageLegend } from "@/components/StageLegend";
import { TopicFilter } from "@/components/TopicFilter";
import {
  FEED_PAGE_SIZE,
  getFeedBills,
  sanitizeChamber,
  sanitizeClusterId,
  sanitizeIncludeCeremonial,
  sanitizeSort,
  sanitizeStage,
  sanitizeTopics,
} from "@/lib/queries";

type SearchParams = {
  topics?: string;
  stage?: string;
  q?: string;
  sponsor?: string;
  sort?: string;
  page?: string;
  chamber?: string;
  ceremonial?: string;
  cluster?: string;
};

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const topics = sanitizeTopics(params.topics);
  const stage = sanitizeStage(params.stage);
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const sponsor =
    typeof params.sponsor === "string" && params.sponsor.trim()
      ? params.sponsor.trim()
      : undefined;
  const sort = sanitizeSort(params.sort);
  const chamber = sanitizeChamber(params.chamber);
  const includeCeremonial = sanitizeIncludeCeremonial(params.ceremonial);
  const cluster = sanitizeClusterId(params.cluster);
  const hasFilters =
    topics.length > 0 || !!stage || !!sponsor || !!chamber || !!cluster;
  const feedFilters = {
    topics,
    stage,
    q: q || undefined,
    sponsor,
    sort,
    chamber,
    includeCeremonial,
    cluster,
  };

  const rawPage = Number.parseInt(params.page ?? "1", 10);
  const requestedPage = Number.isFinite(rawPage) ? rawPage : 1;
  const {
    bills,
    page: currentPage,
    totalPages,
    total: filteredCount,
  } = await getFeedBills(feedFilters, {
    page: requestedPage,
    pageSize: FEED_PAGE_SIZE,
  });

  const carry = new URLSearchParams();
  if (topics.length > 0) carry.set("topics", topics.join(","));
  if (stage) carry.set("stage", stage);
  if (q) carry.set("q", q);
  if (sponsor) carry.set("sponsor", sponsor);
  if (sort && sort !== "action") carry.set("sort", sort);
  if (chamber) carry.set("chamber", chamber);
  if (includeCeremonial) carry.set("ceremonial", "1");
  if (cluster) carry.set("cluster", cluster);

  const clearSearchParams = new URLSearchParams();
  if (topics.length > 0) clearSearchParams.set("topics", topics.join(","));
  if (stage) clearSearchParams.set("stage", stage);
  if (includeCeremonial) clearSearchParams.set("ceremonial", "1");
  if (cluster) clearSearchParams.set("cluster", cluster);
  const clearSearchHref = clearSearchParams.toString()
    ? `/feed?${clearSearchParams.toString()}`
    : "/feed";

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        feedFilters={feedFilters}
        feedFilteredCount={filteredCount}
        basePath="/feed"
      />

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
              ceremonial={includeCeremonial}
              cluster={cluster}
            />
            <ChamberToggle current={chamber} carry={carry} basePath="/feed" />
            <span
              className="ml-auto flex items-center gap-2 text-[12px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              Sort
              <SortDropdown current={sort} basePath="/feed" />
            </span>
            {hasFilters ? (
              <Link
                href={(() => {
                  const sp = new URLSearchParams();
                  if (q) sp.set("q", q);
                  if (includeCeremonial) sp.set("ceremonial", "1");
                  if (cluster) sp.set("cluster", cluster);
                  const qs = sp.toString();
                  return qs ? `/feed?${qs}` : "/feed";
                })()}
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
              ceremonial={includeCeremonial}
              cluster={cluster}
            />
          </div>
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            carry={carry}
            basePath="/feed"
          />
        </section>

        <div
          className="border"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <StageLegend />

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
                  <BillRow key={b.id} bill={b} />
                ))}
              </ul>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                carry={carry}
                basePath="/feed"
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
