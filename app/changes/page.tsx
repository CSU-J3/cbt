import Link from "next/link";
import { BillRow } from "@/components/BillRow";
import { ChamberToggle } from "@/components/ChamberToggle";
import { HeaderBar } from "@/components/HeaderBar";
import { StageLegend } from "@/components/StageLegend";
import { TopicFilter } from "@/components/TopicFilter";
import { timed } from "@/lib/perf";
import {
  getStageChanges,
  getStageChangesCount,
  isInWatchlist,
  sanitizeChamber,
  sanitizeTopics,
} from "@/lib/queries";

type SearchParams = {
  topics?: string;
  expanded?: string;
  q?: string;
  chamber?: string;
};

const DAYS = 7;

export const revalidate = 300;

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const topics = sanitizeTopics(params.topics);
  const expandedParam =
    typeof params.expanded === "string" ? params.expanded : undefined;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const chamber = sanitizeChamber(params.chamber);
  const hasFilters = topics.length > 0 || !!chamber;
  const feedFilters = { topics, q: q || undefined, chamber };

  const pageT0 = performance.now();
  const [bills, counts] = await Promise.all([
    timed("getStageChanges", () => getStageChanges(feedFilters, DAYS)),
    timed("getStageChangesCount", () => getStageChangesCount(feedFilters, DAYS)),
  ]);
  const expandedId =
    expandedParam && bills.some((b) => b.id === expandedParam)
      ? expandedParam
      : undefined;
  const onWatchlist = expandedId
    ? await timed("isInWatchlist", () => isInWatchlist(expandedId))
    : false;
  console.log(`[perf] /changes page-data: ${Math.round(performance.now() - pageT0)}ms`);

  const clearSearchParams = new URLSearchParams();
  if (topics.length > 0) clearSearchParams.set("topics", topics.join(","));
  const clearSearchHref = clearSearchParams.toString()
    ? `/changes?${clearSearchParams.toString()}`
    : "/changes";

  const carry = new URLSearchParams();
  if (topics.length > 0) carry.set("topics", topics.join(","));
  if (q) carry.set("q", q);
  if (chamber) carry.set("chamber", chamber);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        feedFilters={feedFilters}
        basePath="/changes"
        countMode="changes"
        changesCounts={counts}
      />

      <main className="w-full flex-1 px-4 py-4">
        <p
          className="mb-3 text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          last 7 days, most recent first
        </p>

        <section
          className="filter-chips mb-3 flex flex-wrap items-center gap-3 border-b pb-3"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <span
            className="text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            Topics
          </span>
          <TopicFilter
            selected={topics}
            stage={undefined}
            q={q}
            chamber={chamber}
            basePath="/changes"
          />
          <ChamberToggle current={chamber} carry={carry} basePath="/changes" />
          {hasFilters ? (
            <Link
              href={q ? `/changes?q=${encodeURIComponent(q)}` : "/changes"}
              className="ml-auto text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
              style={{ color: "var(--text-dim)" }}
            >
              Clear filters ✕
            </Link>
          ) : null}
        </section>

        <div
          className="changes-feed border"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <StageLegend />
          <div className="feed-header-row">
            <span aria-hidden></span>
            <span>Bill</span>
            <span>Title / Sponsor</span>
            <span>Stage Change</span>
            <span className="col-date">Changed</span>
            <span>Topics</span>
          </div>

          {bills.length === 0 ? (
            counts.total === 0 ? (
              <div
                className="px-6 py-8 text-center text-[13px]"
                style={{ color: "var(--text-muted)" }}
              >
                No stage changes in the last 7 days.
              </div>
            ) : q ? (
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
            <ul>
              {bills.map((b) => (
                <BillRow
                  key={b.id}
                  bill={b}
                  filters={{ topics, stage: undefined, q, chamber }}
                  basePath="/changes"
                  expandedId={expandedId}
                  onWatchlist={expandedId === b.id ? onWatchlist : false}
                  introducedDate={b.introduced_date}
                  showStageTransition
                />
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
