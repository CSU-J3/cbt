import { redirect } from "next/navigation";
import Link from "next/link";
import { BillRowList } from "@/components/BillRowList";
import { CeremonialToggle } from "@/components/CeremonialToggle";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
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
  getBillTopicRailCounts,
  getFeedBills,
  getWatchedBillIds,
  sanitizeChamber,
  sanitizeClusterId,
  sanitizeIncludeCeremonial,
  sanitizeSort,
  sanitizeStage,
  sanitizeTopics,
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
  // HO 501: NEWS is its own route now (/news). `mode=news` survives only as a
  // legacy alias — redirect it, carrying the news params through so old
  // bookmarks and any pre-HO-501 ⚡-chip hrefs land on the same scoped view.
  // sanitizeMode + SearchParams.mode are kept solely for this alias.
  if (sanitizeMode(params.mode) === "news") {
    const sp = new URLSearchParams();
    for (const k of ["source", "topic", "window", "bill", "signal", "page"] as const) {
      const v = params[k];
      if (typeof v === "string" && v) sp.set(k, v);
    }
    const qs = sp.toString();
    redirect(qs ? `/news?${qs}` : "/news");
  }

  const rawPage = Number.parseInt(params.page ?? "1", 10);
  const requestedPage = Number.isFinite(rawPage) ? rawPage : 1;
  // HO 490: one page-computed clock threaded to the feed rows so relative-age
  // buckets match across SSR/hydration (#418). See lib/format.ts.
  const nowMs = Date.now();

  // Two-URL nav toggle (HO 501): LEGISLATION stays on /bills preserving its own
  // bills filters (idempotent active-click); NEWS goes to bare /news — the
  // cross-carry is dropped, so bills filters are NOT ferried into /news.
  const buildModeHref = (next: FeedMode) => {
    if (next === "news") return "/news";
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "string" && v && k !== "page" && k !== "mode") {
        sp.set(k, v);
      }
    }
    const qs = sp.toString();
    return qs ? `/bills?${qs}` : "/bills";
  };

  const toggle = (
    <SegmentedToggle<FeedMode>
      current="bills"
      ariaLabel="Feed mode"
      segments={[
        { value: "bills", label: "LEGISLATION" },
        { value: "news", label: "NEWS" },
      ]}
      buildHref={buildModeHref}
    />
  );

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
  // HO 501: the NEWS-param round-trip is gone — /news is its own route now and
  // the cross-carry was dropped (probe HO 500, option a). BILLS carry holds
  // only bills params.

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
