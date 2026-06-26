import Link from "next/link";
import { BillRowList } from "@/components/BillRowList";
import { CeremonialToggle } from "@/components/CeremonialToggle";
import { ProceduralToggle } from "@/components/ProceduralToggle";
import {
  CHAMBER_SEGMENTS,
  SegmentedToggle,
} from "@/components/SegmentedToggle";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { SearchBox } from "@/components/SearchBox";
import { StageFilter } from "@/components/StageFilter";
import { StageLegend } from "@/components/StageLegend";
import { TopicFilter } from "@/components/TopicFilter";
import {
  getStaleBills,
  getStaleCommitteeCount,
  getWatchedBillIds,
  sanitizeChamber,
  sanitizeClusterId,
  sanitizeIncludeCeremonial,
  sanitizeIncludeProcedural,
  sanitizeStaleStage,
  sanitizeTopics,
  STALE_FILTER_STAGES,
} from "@/lib/queries";

type SearchParams = {
  topics?: string;
  stage?: string;
  q?: string;
  chamber?: string;
  ceremonial?: string;
  procedural?: string;
  cluster?: string;
};

export default async function StalePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const topics = sanitizeTopics(params.topics);
  const stage = sanitizeStaleStage(params.stage);
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const chamber = sanitizeChamber(params.chamber);
  const includeCeremonial = sanitizeIncludeCeremonial(params.ceremonial);
  const includeProcedural = sanitizeIncludeProcedural(params.procedural);
  const cluster = sanitizeClusterId(params.cluster);
  const hasFilters = topics.length > 0 || !!stage || !!chamber || !!cluster;
  const feedFilters = {
    topics,
    stage,
    q: q || undefined,
    chamber,
    includeCeremonial,
    includeProcedural,
    cluster,
  };

  const carry = new URLSearchParams();
  if (topics.length > 0) carry.set("topics", topics.join(","));
  if (stage) carry.set("stage", stage);
  if (q) carry.set("q", q);
  if (chamber) carry.set("chamber", chamber);
  if (includeCeremonial) carry.set("ceremonial", "1");
  if (includeProcedural) carry.set("procedural", "1");
  if (cluster) carry.set("cluster", cluster);

  const [bills, committeeCount, watchedIds] = await Promise.all([
    getStaleBills(feedFilters, 50),
    getStaleCommitteeCount(),
    getWatchedBillIds(),
  ]);

  const clearSearchParams = new URLSearchParams();
  if (topics.length > 0) clearSearchParams.set("topics", topics.join(","));
  if (stage) clearSearchParams.set("stage", stage);
  if (includeCeremonial) clearSearchParams.set("ceremonial", "1");
  if (includeProcedural) clearSearchParams.set("procedural", "1");
  if (cluster) clearSearchParams.set("cluster", cluster);
  const clearSearchHref = clearSearchParams.toString()
    ? `/stale?${clearSearchParams.toString()}`
    : "/stale";

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar feedFilters={feedFilters} basePath="/stale" pageOwnsControls />

      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="patterns" active="stale" />
        <p
          className="text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          past committee · stalled 60+ days · furthest first
        </p>
        <p
          className="mb-3 text-[12px]"
          style={{ color: "var(--text-dim)" }}
        >
          The committee backlog sits one click away under the stage filter.
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
            chamber={chamber}
            ceremonial={includeCeremonial}
            cluster={cluster}
            basePath="/stale"
            availableStages={STALE_FILTER_STAGES}
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
              return qs ? `/stale?${qs}` : "/stale";
            }}
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
            chamber={chamber}
            ceremonial={includeCeremonial}
            cluster={cluster}
            basePath="/stale"
          />
          {/* HO 187 sub-stage 4: search + ceremonial relocated here from
              HeaderBar's transitional legacy band (suppressed by
              pageOwnsControls above). */}
          <div className="control-search">
            <SearchBox basePath="/stale" compact />
          </div>
          <CeremonialToggle checked={includeCeremonial} />
          <ProceduralToggle checked={includeProcedural} />
          {hasFilters ? (
            <Link
              href={(() => {
                const sp = new URLSearchParams();
                if (q) sp.set("q", q);
                if (includeCeremonial) sp.set("ceremonial", "1");
                if (includeProcedural) sp.set("procedural", "1");
                if (cluster) sp.set("cluster", cluster);
                const qs = sp.toString();
                return qs ? `/stale?${qs}` : "/stale";
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
            <BillRowList
              bills={bills}
              watchedIds={watchedIds}
              daysSinceMode="staleness"
              showMomentum
            />
          )}
        </div>

        {/* HO 350 — the hidden committee backlog as a footer line (computed
            live), with a one-click jump into the STAGE → COMMITTEE view. */}
        <p
          className="mt-3 text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-dim)" }}
        >
          <Link
            href={`/stale?${(() => {
              const sp = new URLSearchParams(carry);
              sp.set("stage", "committee");
              sp.delete("page");
              return sp.toString();
            })()}`}
            className="transition hover:text-[var(--text-secondary)]"
          >
            {committeeCount.toLocaleString()} more sit in committee →
          </Link>
        </p>
      </main>
    </div>
  );
}
