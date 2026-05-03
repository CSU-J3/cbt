import Link from "next/link";
import { BillRow } from "@/components/BillRow";
import { FooterLegend } from "@/components/FooterLegend";
import { HeaderBar } from "@/components/HeaderBar";
import { StageFilter } from "@/components/StageFilter";
import { TopicFilter } from "@/components/TopicFilter";
import {
  getFeedBills,
  isInWatchlist,
  sanitizeStage,
  sanitizeTopics,
} from "@/lib/queries";

type SearchParams = {
  topics?: string;
  stage?: string;
  expanded?: string;
};

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const topics = sanitizeTopics(params.topics);
  const stage = sanitizeStage(params.stage);
  const expandedParam = typeof params.expanded === "string" ? params.expanded : undefined;
  const hasFilters = topics.length > 0 || !!stage;

  const bills = await getFeedBills({ topics, stage }, 50);
  const expandedId = expandedParam && bills.some((b) => b.id === expandedParam)
    ? expandedParam
    : undefined;
  const onWatchlist = expandedId ? await isInWatchlist(expandedId) : false;

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">
        <section
          className="filter-chips mb-3 flex flex-wrap items-center gap-3 border-b pb-3"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <span
            className="text-[10px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            Stage
          </span>
          <StageFilter current={stage} topics={topics} />
          <span
            className="ml-2 text-[10px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            Topics
          </span>
          <TopicFilter selected={topics} stage={stage} />
          {hasFilters ? (
            <Link
              href="/"
              className="ml-auto text-[10px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
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
            <span className="col-date">Action</span>
            <span>Topics</span>
          </div>

          {bills.length === 0 ? (
            <div
              className="px-6 py-8 text-center text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              No bills match these filters
            </div>
          ) : (
            <ul>
              {bills.map((b) => (
                <BillRow
                  key={b.id}
                  bill={b}
                  filters={{ topics, stage }}
                  basePath="/"
                  expandedId={expandedId}
                  onWatchlist={expandedId === b.id ? onWatchlist : false}
                  introducedDate={b.introduced_date}
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
