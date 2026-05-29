import Link from "next/link";
import { BillRowList } from "@/components/BillRowList";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { NewsFilters } from "@/components/NewsFilters";
import { NewsRow } from "@/components/NewsRow";
import { Pagination } from "@/components/Pagination";
import {
  CHAMBER_SEGMENTS,
  SegmentedToggle,
} from "@/components/SegmentedToggle";
import { SortDropdown } from "@/components/SortDropdown";
import { StageFilter } from "@/components/StageFilter";
import { StageLegend } from "@/components/StageLegend";
import { TerminalPrompt } from "@/components/TerminalPrompt";
import { TopicFilter } from "@/components/TopicFilter";
import {
  FEED_PAGE_SIZE,
  NEWS_DEFAULT_WINDOW,
  NEWS_FEED_PAGE_SIZE,
  getFeedBills,
  getNewsFeed,
  getWatchedBillIds,
  sanitizeBillId,
  sanitizeChamber,
  sanitizeClusterId,
  sanitizeIncludeCeremonial,
  sanitizeNewsSource,
  sanitizeSort,
  sanitizeStage,
  sanitizeTopic,
  sanitizeTopics,
  sanitizeWindowHours,
} from "@/lib/queries";

type FeedMode = "bills" | "news";

type SearchParams = {
  mode?: string;
  // BILLS-only:
  topics?: string;
  stage?: string;
  q?: string;
  sponsor?: string;
  sort?: string;
  chamber?: string;
  ceremonial?: string;
  cluster?: string;
  // NEWS-only:
  source?: string;
  topic?: string;
  window?: string;
  bill?: string;
  // Shared:
  page?: string;
};

function sanitizeMode(raw: string | null | undefined): FeedMode {
  return raw === "news" ? "news" : "bills";
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const mode = sanitizeMode(params.mode);
  const rawPage = Number.parseInt(params.page ?? "1", 10);
  const requestedPage = Number.isFinite(rawPage) ? rawPage : 1;

  // Shared toggle href helper. Per HO 151 per-mode scoping: switching
  // modes does NOT clear the other mode's params; they persist in the
  // URL across switches. `page` always resets to 1 on mode change.
  const buildModeHref = (next: FeedMode) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "string" && v && k !== "page" && k !== "mode") {
        sp.set(k, v);
      }
    }
    if (next === "news") sp.set("mode", "news");
    const qs = sp.toString();
    return qs ? `/feed?${qs}` : "/feed";
  };

  const toggle = (
    <SegmentedToggle<FeedMode>
      current={mode}
      ariaLabel="Feed mode"
      segments={[
        { value: "bills", label: "BILLS" },
        { value: "news", label: "NEWS" },
      ]}
      buildHref={buildModeHref}
    />
  );

  if (mode === "news") {
    return NewsView({
      params,
      requestedPage,
      toggle,
    });
  }
  return BillsView({
    params,
    requestedPage,
    toggle,
  });
}

// ---- BILLS mode --------------------------------------------------------

async function BillsView({
  params,
  requestedPage,
  toggle,
}: {
  params: SearchParams;
  requestedPage: number;
  toggle: React.ReactNode;
}) {
  const topics = sanitizeTopics(params.topics);
  const stage = sanitizeStage(params.stage);
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const sponsor =
    typeof params.sponsor === "string" && params.sponsor.trim()
      ? params.sponsor.trim()
      : undefined;
  // HO 151: capture whether the user explicitly chose a sort before
  // sanitization defaults `action`. The president alias only applies
  // desk-time + oldest-first when there's NO explicit override.
  const sortExplicit =
    typeof params.sort === "string" &&
    (params.sort === "action" || params.sort === "introduced");
  const sort = sanitizeSort(params.sort);
  const chamber = sanitizeChamber(params.chamber);
  const includeCeremonial = sanitizeIncludeCeremonial(params.ceremonial);
  const cluster = sanitizeClusterId(params.cluster);
  const hasFilters =
    topics.length > 0 || !!stage || !!sponsor || !!chamber || !!cluster;

  // President alias: stage=president as the sole active stage with no
  // explicit ?sort. Keeps the desk-time column AND the oldest-at-desk
  // sort coherent — shipping one without the other would mismatch the
  // visible column with the visible order.
  const isPresidentAlias = stage === "president" && !sortExplicit;
  const direction = isPresidentAlias ? ("asc" as const) : undefined;
  const daysSinceMode = isPresidentAlias ? ("desk-time" as const) : undefined;

  const feedFilters = {
    topics,
    stage,
    q: q || undefined,
    sponsor,
    sort,
    chamber,
    includeCeremonial,
    cluster,
    direction,
  };

  const [
    { bills, page: currentPage, totalPages, total: filteredCount },
    watchedIds,
  ] = await Promise.all([
    getFeedBills(feedFilters, { page: requestedPage, pageSize: FEED_PAGE_SIZE }),
    getWatchedBillIds(),
  ]);

  const carry = new URLSearchParams();
  // mode=bills is implicit (default); don't write it.
  if (topics.length > 0) carry.set("topics", topics.join(","));
  if (stage) carry.set("stage", stage);
  if (q) carry.set("q", q);
  if (sponsor) carry.set("sponsor", sponsor);
  if (sort && sort !== "action") carry.set("sort", sort);
  if (chamber) carry.set("chamber", chamber);
  if (includeCeremonial) carry.set("ceremonial", "1");
  if (cluster) carry.set("cluster", cluster);
  // Preserve any NEWS-mode params already in the URL so a switch back
  // to NEWS returns to the same filtered view.
  const news = {
    source: params.source,
    topic: params.topic,
    window: params.window,
    bill: params.bill,
  };
  for (const [k, v] of Object.entries(news)) {
    if (typeof v === "string" && v) carry.set(k, v);
  }

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
        <GroupTabs group="feed" active="bills" />
        <div className="page-masthead">
          <TerminalPrompt name="Feed" />
        </div>
        <div className="mb-3 flex items-center gap-3">{toggle}</div>
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
                return qs ? `/feed?${qs}` : "/feed";
              }}
            />
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
              <BillRowList
                bills={bills}
                watchedIds={watchedIds}
                daysSinceMode={daysSinceMode}
              />
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

// ---- NEWS mode --------------------------------------------------------

async function NewsView({
  params,
  requestedPage,
  toggle,
}: {
  params: SearchParams;
  requestedPage: number;
  toggle: React.ReactNode;
}) {
  const source = sanitizeNewsSource(params.source);
  const topic = sanitizeTopic(params.topic);
  const windowHours = sanitizeWindowHours(params.window) ?? NEWS_DEFAULT_WINDOW;
  const billId = sanitizeBillId(params.bill);

  const { mentions, page: currentPage, totalPages, total } = await getNewsFeed(
    { source, topic, windowHours, billId },
    { page: requestedPage, pageSize: NEWS_FEED_PAGE_SIZE },
  );

  // Carry for the news filter chips themselves preserves BILLS-mode
  // params so a switch back to BILLS keeps that view's filters too.
  // NEWS-specific params (source/topic/window/bill) are written by the
  // NewsFilters chips themselves; this carry only holds the persisted
  // BILLS state plus the mode marker.
  const newsCarry = new URLSearchParams();
  newsCarry.set("mode", "news");
  if (source) newsCarry.set("source", source);
  if (topic) newsCarry.set("topic", topic);
  if (windowHours !== NEWS_DEFAULT_WINDOW) newsCarry.set("window", String(windowHours));
  if (billId) newsCarry.set("bill", billId);
  // BILLS-mode params kept in the URL for round-trip:
  for (const k of ["topics", "stage", "q", "sponsor", "sort", "chamber", "ceremonial", "cluster"] as const) {
    const v = params[k];
    if (typeof v === "string" && v) newsCarry.set(k, v);
  }

  // The chips themselves only need the persisted BILLS-mode params +
  // the mode marker (so they don't clobber it); NEWS-specific params
  // are set per-click by NewsFilters' buildHref.
  const filterCarry = new URLSearchParams();
  filterCarry.set("mode", "news");
  for (const k of ["topics", "stage", "q", "sponsor", "sort", "chamber", "ceremonial", "cluster"] as const) {
    const v = params[k];
    if (typeof v === "string" && v) filterCarry.set(k, v);
  }
  // Preserve NEWS dims not currently being toggled — NewsFilters
  // override the one it owns per click.
  if (source) filterCarry.set("source", source);
  if (topic) filterCarry.set("topic", topic);
  if (windowHours !== NEWS_DEFAULT_WINDOW) filterCarry.set("window", String(windowHours));
  if (billId) filterCarry.set("bill", billId);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        basePath="/feed"
        pageTitle="News mentions"
        pageCount={total}
        pageCountLabel="mentions"
      />

      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="feed" active="news" />
        <div className="page-masthead">
          <TerminalPrompt name="Feed" />
        </div>
        <div className="mb-3 flex items-center gap-3">{toggle}</div>

        <section
          className="mb-3 flex flex-col gap-3"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <NewsFilters
            source={source}
            topic={topic}
            windowHours={windowHours}
            billId={billId}
            carry={filterCarry}
          />
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            carry={newsCarry}
            basePath="/feed"
          />
        </section>

        {mentions.length === 0 ? (
          <p
            className="py-16 text-center text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            {billId
              ? `No news mentions yet for this bill.`
              : "No news mentions match these filters."}
          </p>
        ) : (
          <div
            className="border"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <div className="news-header-row px-3">
              <span>Bill</span>
              <span>Headline</span>
              <span className="source">Source</span>
              <span className="age">Age</span>
            </div>
            <ul>
              {mentions.map((m) => (
                <li key={m.id} className="px-3">
                  <NewsRow mention={m} showFullHeadline linkBillToDetail />
                </li>
              ))}
            </ul>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              carry={newsCarry}
              basePath="/feed"
            />
          </div>
        )}
      </main>
    </div>
  );
}
