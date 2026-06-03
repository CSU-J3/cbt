import Link from "next/link";
import { BillRowList } from "@/components/BillRowList";
import { CeremonialToggle } from "@/components/CeremonialToggle";
import {
  CHAMBER_SEGMENTS,
  SegmentedToggle,
} from "@/components/SegmentedToggle";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { SearchBox } from "@/components/SearchBox";
import { StageLegend } from "@/components/StageLegend";
import { TopicFilter } from "@/components/TopicFilter";
import {
  getStageChanges,
  getStageChangesCount,
  getWatchedBillIds,
  sanitizeChamber,
  sanitizeClusterId,
  sanitizeIncludeCeremonial,
  sanitizeTopics,
} from "@/lib/queries";

type SearchParams = {
  topics?: string;
  q?: string;
  chamber?: string;
  ceremonial?: string;
  cluster?: string;
};

const DAYS = 7;

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const topics = sanitizeTopics(params.topics);
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const chamber = sanitizeChamber(params.chamber);
  const includeCeremonial = sanitizeIncludeCeremonial(params.ceremonial);
  const cluster = sanitizeClusterId(params.cluster);
  const hasFilters = topics.length > 0 || !!chamber || !!cluster;
  const feedFilters = {
    topics,
    q: q || undefined,
    chamber,
    includeCeremonial,
    cluster,
  };

  const [bills, counts, watchedIds] = await Promise.all([
    getStageChanges(feedFilters, DAYS),
    getStageChangesCount(feedFilters, DAYS),
    getWatchedBillIds(),
  ]);

  const clearSearchParams = new URLSearchParams();
  if (topics.length > 0) clearSearchParams.set("topics", topics.join(","));
  if (includeCeremonial) clearSearchParams.set("ceremonial", "1");
  if (cluster) clearSearchParams.set("cluster", cluster);
  const clearSearchHref = clearSearchParams.toString()
    ? `/changes?${clearSearchParams.toString()}`
    : "/changes";

  const carry = new URLSearchParams();
  if (topics.length > 0) carry.set("topics", topics.join(","));
  if (q) carry.set("q", q);
  if (chamber) carry.set("chamber", chamber);
  if (includeCeremonial) carry.set("ceremonial", "1");
  if (cluster) carry.set("cluster", cluster);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        feedFilters={feedFilters}
        basePath="/changes"
        countMode="changes"
        changesCounts={counts}
        pageOwnsControls
      />

      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="feed" active="changes" />
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
            ceremonial={includeCeremonial}
            cluster={cluster}
            basePath="/changes"
          />
          <SegmentedToggle
            current={(chamber ?? "") as "" | "house" | "senate"}
            ariaLabel="Chamber"
            segments={CHAMBER_SEGMENTS}
            buildHref={(value) => {
              const sp = new URLSearchParams(carry);
              sp.delete("page");
              if (value) sp.set("chamber", value);
              else sp.delete("chamber");
              const qs = sp.toString();
              return qs ? `/changes?${qs}` : "/changes";
            }}
          />
          {/* HO 187 sub-stage 4: search + ceremonial relocated here from
              HeaderBar's transitional legacy band (suppressed by
              pageOwnsControls above). */}
          <div className="control-search">
            <SearchBox basePath="/changes" compact />
          </div>
          <CeremonialToggle checked={includeCeremonial} />
          {hasFilters ? (
            <Link
              href={(() => {
                const sp = new URLSearchParams();
                if (q) sp.set("q", q);
                if (includeCeremonial) sp.set("ceremonial", "1");
                if (cluster) sp.set("cluster", cluster);
                const qs = sp.toString();
                return qs ? `/changes?${qs}` : "/changes";
              })()}
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
          <StageLegend />

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
            <BillRowList bills={bills} watchedIds={watchedIds} />
          )}
        </div>
      </main>
    </div>
  );
}
