import Link from "next/link";
import { BillRow } from "@/components/BillRow";
import { FooterLegend } from "@/components/FooterLegend";
import { HeaderBar } from "@/components/HeaderBar";
import { StageFilter } from "@/components/StageFilter";
import { TopicFilter } from "@/components/TopicFilter";
import {
  getStaleBills,
  getStaleCount,
  isInWatchlist,
  sanitizeStaleStage,
  sanitizeTopics,
  STALE_FILTER_STAGES,
} from "@/lib/queries";

type SearchParams = {
  topics?: string;
  stage?: string;
  expanded?: string;
  q?: string;
};

export default async function StalePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const topics = sanitizeTopics(params.topics);
  const stage = sanitizeStaleStage(params.stage);
  const expandedParam =
    typeof params.expanded === "string" ? params.expanded : undefined;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const hasFilters = topics.length > 0 || !!stage;
  const feedFilters = { topics, stage, q: q || undefined };

  const [bills, counts] = await Promise.all([
    getStaleBills(feedFilters, 50),
    getStaleCount(feedFilters),
  ]);
  const expandedId =
    expandedParam && bills.some((b) => b.id === expandedParam)
      ? expandedParam
      : undefined;
  const onWatchlist = expandedId ? await isInWatchlist(expandedId) : false;

  const clearSearchParams = new URLSearchParams();
  if (topics.length > 0) clearSearchParams.set("topics", topics.join(","));
  if (stage) clearSearchParams.set("stage", stage);
  const clearSearchHref = clearSearchParams.toString()
    ? `/stale?${clearSearchParams.toString()}`
    : "/stale";

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        feedFilters={feedFilters}
        basePath="/stale"
        countMode="stale"
        staleCounts={counts}
      />

      <main className="w-full flex-1 px-4 py-4">
        <p
          className="mb-3 text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          no action in 60+ days, oldest first
        </p>

        <section
          className="filter-chips mb-3 flex flex-wrap items-center gap-3 border-b pb-3"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <span
            className="text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            Stage
          </span>
          <StageFilter
            current={stage}
            topics={topics}
            q={q}
            basePath="/stale"
            availableStages={STALE_FILTER_STAGES}
          />
          <span
            className="ml-2 text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            Topics
          </span>
          <TopicFilter
            selected={topics}
            stage={stage}
            q={q}
            basePath="/stale"
          />
          {hasFilters ? (
            <Link
              href={q ? `/stale?q=${encodeURIComponent(q)}` : "/stale"}
              className="ml-auto text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
              style={{ color: "var(--text-dim)" }}
            >
              Clear filters ✕
            </Link>
          ) : null}
        </section>

        <div
          className="border"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <div className="feed-header-row">
            <span aria-hidden></span>
            <span>Bill</span>
            <span>Title / Sponsor</span>
            <span>Stage</span>
            <span className="col-date">Stale</span>
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
            <ul>
              {bills.map((b) => (
                <BillRow
                  key={b.id}
                  bill={b}
                  filters={{ topics, stage, q }}
                  basePath="/stale"
                  expandedId={expandedId}
                  onWatchlist={expandedId === b.id ? onWatchlist : false}
                  introducedDate={b.introduced_date}
                  daysSinceMode="staleness"
                />
              ))}
            </ul>
          )}
        </div>
      </main>

      <FooterLegend />
    </div>
  );
}
