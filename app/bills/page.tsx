import Link from "next/link";
import { BillRowList } from "@/components/BillRowList";
import { CeremonialToggle } from "@/components/CeremonialToggle";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { NewsFilters } from "@/components/NewsFilters";
import { NewsRow } from "@/components/NewsRow";
import { Pagination } from "@/components/Pagination";
import { SearchBox } from "@/components/SearchBox";
import {
  CHAMBER_SEGMENTS,
  SegmentedToggle,
} from "@/components/SegmentedToggle";
import { SortDropdown } from "@/components/SortDropdown";
import { StageFilter } from "@/components/StageFilter";
import { StageLegend } from "@/components/StageLegend";
import { TopicRailRow } from "@/components/TopicRailRow";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";
import {
  FEED_PAGE_SIZE,
  NEWS_DEFAULT_WINDOW,
  NEWS_FEED_PAGE_SIZE,
  getBillTopicRailCounts,
  getFeedBills,
  getNewsFeed,
  getWatchedBillIds,
  sanitizeBillId,
  sanitizeChamber,
  sanitizeClusterId,
  sanitizeIncludeCeremonial,
  sanitizeNewsSignal,
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
  signal?: string;
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
  // HO 490: one page-computed clock threaded to the feed rows / news rows so
  // relative-age buckets match across SSR/hydration (#418). See lib/format.ts.
  const nowMs = Date.now();

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
    return qs ? `/bills?${qs}` : "/bills";
  };

  const toggle = (
    <SegmentedToggle<FeedMode>
      current={mode}
      ariaLabel="Feed mode"
      segments={[
        { value: "bills", label: "LEGISLATION" },
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
      nowMs,
    });
  }
  return BillsView({
    params,
    requestedPage,
    toggle,
    nowMs,
  });
}

// ---- BILLS mode --------------------------------------------------------

async function BillsView({
  params,
  requestedPage,
  toggle,
  nowMs,
}: {
  params: SearchParams;
  requestedPage: number;
  toggle: React.ReactNode;
  nowMs: number;
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
    { bills, total, page: currentPage, totalPages },
    watchedIds,
    railCounts,
  ] = await Promise.all([
    getFeedBills(feedFilters, { page: requestedPage, pageSize: FEED_PAGE_SIZE }),
    getWatchedBillIds(),
    // HO 496: rail rebases on the bounded dims only (stage/chamber/ceremonial);
    // getBillTopicRailCounts drops q/topics/sponsor internally. Bars rescale to
    // this filtered distribution's max.
    getBillTopicRailCounts(feedFilters),
  ]);
  const railMax = railCounts.reduce((m, r) => Math.max(m, r.count), 0);

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
    signal: params.signal,
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
    ? `/bills?${clearSearchParams.toString()}`
    : "/bills";

  // "Clear filters ✕" drops stage/topics/sponsor/chamber but keeps q +
  // ceremonial + cluster (matches the pre-HO-187 inline behavior).
  const clearFiltersParams = new URLSearchParams();
  if (q) clearFiltersParams.set("q", q);
  if (includeCeremonial) clearFiltersParams.set("ceremonial", "1");
  if (cluster) clearFiltersParams.set("cluster", cluster);
  const clearFiltersHref = clearFiltersParams.toString()
    ? `/bills?${clearFiltersParams.toString()}`
    : "/bills";

  const chamberHref = (value: "" | "house" | "senate") => {
    const sp = new URLSearchParams(carry);
    sp.delete("page");
    if (value) sp.set("chamber", value);
    else sp.delete("chamber");
    const qs = sp.toString();
    return qs ? `/bills?${qs}` : "/bills";
  };

  // HO 496: clear ALL topics (rail CLEAR + mc-ctx "× all topics"), keep every
  // other filter. topicRemoveHref clears just one topic (the per-chip ×). Both
  // reset to page 1 (a narrower topic set may not reach the current page).
  const railClearHref = (() => {
    const sp = new URLSearchParams(carry);
    sp.delete("topics");
    sp.delete("page");
    const qs = sp.toString();
    return qs ? `/bills?${qs}` : "/bills";
  })();
  const topicRemoveHref = (t: string) => {
    const sp = new URLSearchParams(carry);
    const rest = topics.filter((x) => x !== t);
    if (rest.length > 0) sp.set("topics", rest.join(","));
    else sp.delete("topics");
    sp.delete("page");
    const qs = sp.toString();
    return qs ? `/bills?${qs}` : "/bills";
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* HeaderBar renders bands 1-2 (title + sync). pageOwnsControls suppresses
          its transitional search/ceremonial — they live in the fbar below. */}
      <HeaderBar
        feedFilters={feedFilters}
        basePath="/bills"
        mode="bills"
        presidentAlias={isPresidentAlias}
        pageOwnsControls
      />

      <main className="w-full flex-1 px-4 py-4">
        {/* Above the pane — page-level nav (not rail concerns): the feed sub-nav
            (Changes·President·Reports) + the LEGISLATION/NEWS mode toggle. No tab
            is active in bills mode (HO 184). */}
        <GroupTabs group="feed" active="bills" />
        <div className="mb-3 mt-3 flex items-center gap-3">{toggle}</div>

        {/* Filter bar — the real filters (the 24-chip topic row is gone; it's the
            rail now). Scope count reflects the active filter set. */}
        <div className="mc-fbar">
          <span className="mc-fbar-count">
            <span className="mc-fbar-n">{total.toLocaleString()}</span> BILLS
            {topics.length > 0 ? (
              <>
                {" "}
                <span aria-hidden>·</span>{" "}
                {topics.map((t) => topicLabel(t)).join(" + ")}
              </>
            ) : null}
          </span>
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
            buildHref={chamberHref}
          />
          <CeremonialToggle checked={includeCeremonial} />
          <div className="control-search">
            <SearchBox basePath="/bills" compact />
          </div>
          <span className="mc-fbar-spacer" />
          {hasFilters ? (
            <Link
              href={clearFiltersHref}
              className="text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--text-secondary)]"
              style={{ color: "var(--text-dim)" }}
            >
              Clear ✕
            </Link>
          ) : null}
          <span
            className="control-sort flex items-center gap-2 text-[12px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-dim)" }}
          >
            Sort
            <SortDropdown current={sort} basePath="/bills" />
          </span>
        </div>

        {/* Two-pane browser: topic rail (spine) · bill content */}
        <div className="mc-pane bl-pane">
          {/* LEFT RAIL — 24 topics, VOL-desc, topic-colored bars, MULTI-SELECT.
              Counts rebase on stage/chamber/ceremonial (not the topic selection
              itself, and not q). */}
          <div className="mc-rail bl-rail">
            <div className="mc-rail-h">
              <span>TOPICS · {railCounts.length}</span>
              {topics.length > 0 ? (
                <Link href={railClearHref} className="bl-rail-clr">
                  CLEAR
                </Link>
              ) : (
                <span>VOL</span>
              )}
            </div>
            {railCounts.map((r) => (
              <TopicRailRow
                key={r.topic}
                topic={r.topic}
                fullLabel={topicFullLabel(r.topic)}
                count={r.count}
                pct={railMax > 0 ? (r.count / railMax) * 100 : 0}
                color={topicColor(r.topic)}
                selected={topics.includes(r.topic)}
              />
            ))}
          </div>

          {/* RIGHT PANE — keystrip + context + bill rows + pagers */}
          <div className="mc-content">
            {/* Keystrip — the old STAGE legend + party key row (StageLegend
                already renders both). */}
            <div className="bl-keystrip">
              <StageLegend bare />
            </div>

            {/* Context header — selected topics as removable chips (only when
                ?topics= is non-empty). */}
            {topics.length > 0 ? (
              <div className="mc-ctx bl-ctx">
                {topics.map((t) => (
                  <Link
                    key={t}
                    href={topicRemoveHref(t)}
                    className="bl-ctx-chip"
                    style={{ borderColor: topicColor(t), color: topicColor(t) }}
                  >
                    {topicLabel(t)} <span aria-hidden>×</span>
                  </Link>
                ))}
                <span className="mc-ctx-count">
                  · {total.toLocaleString()} bills · {totalPages.toLocaleString()}{" "}
                  pages
                </span>
                <span className="mc-ctx-spacer" />
                <Link href={railClearHref} className="mc-ctx-clr">
                  × all topics
                </Link>
              </div>
            ) : null}

            {/* Top pager */}
            {totalPages > 1 ? (
              <div className="bl-pager-top">
                <Pagination
                  inline
                  currentPage={currentPage}
                  totalPages={totalPages}
                  carry={carry}
                  basePath="/bills"
                />
              </div>
            ) : null}

            {/* Bill rows — unchanged (out of scope); expansion is the existing
                client single-open accordion (BillRowList), not a URL param. */}
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
                  nowMs={nowMs}
                  daysSinceMode={daysSinceMode}
                />
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  carry={carry}
                  basePath="/bills"
                />
              </>
            )}
          </div>
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
  nowMs,
}: {
  params: SearchParams;
  requestedPage: number;
  toggle: React.ReactNode;
  nowMs: number;
}) {
  const source = sanitizeNewsSource(params.source);
  const topic = sanitizeTopic(params.topic);
  const windowHours = sanitizeWindowHours(params.window) ?? NEWS_DEFAULT_WINDOW;
  const billId = sanitizeBillId(params.bill);
  const signal = sanitizeNewsSignal(params.signal);

  const {
    mentions,
    page: currentPage,
    totalPages,
    breakingCount,
  } = await getNewsFeed(
    { source, topic, windowHours, billId, signal },
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
  if (signal) newsCarry.set("signal", signal);
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
  // Seed signal so SOURCE/WINDOW/TOPIC chips preserve an active BREAKING
  // selection; the ALL/BREAKING chips toggle it via a `signal` override
  // (ALL passes `signal: undefined`, which buildHref deletes).
  if (signal) filterCarry.set("signal", signal);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/bills" mode="news" />

      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="feed" active="news" />
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
            signal={signal}
            breakingCount={breakingCount}
            carry={filterCarry}
          />
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            carry={newsCarry}
            basePath="/bills"
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
                  <NewsRow mention={m} showFullHeadline nowMs={nowMs} />
                </li>
              ))}
            </ul>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              carry={newsCarry}
              basePath="/bills"
            />
          </div>
        )}
      </main>
    </div>
  );
}
