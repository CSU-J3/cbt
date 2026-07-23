import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { NewsFilters } from "@/components/NewsFilters";
import { NewsRow } from "@/components/NewsRow";
import { Pagination } from "@/components/Pagination";
import { SegmentedToggle } from "@/components/SegmentedToggle";
import {
  NEWS_DEFAULT_WINDOW,
  NEWS_FEED_PAGE_SIZE,
  getNewsFeed,
  sanitizeBillId,
  sanitizeNewsSignal,
  sanitizeNewsSource,
  sanitizeTopic,
  sanitizeWindowHours,
} from "@/lib/queries";

// HO 501 — /news is now its own route, extracted from the /bills ?mode=news
// mode (probe HO 500). It carries ONLY news params — source, topic, window,
// bill, signal, page. The HO 151 cross-carry of the eight BILLS-mode params
// (topics/stage/q/sponsor/sort/chamber/ceremonial/cluster) was dropped when
// the modes became separate routes (option a): a route advertising params it
// never reads was exactly the confusion the split ends. /bills?mode=news
// legacy-redirects here carrying its news params (see app/bills/page.tsx);
// the LEGISLATION/NEWS toggle below is now a two-URL nav between /bills and
// /news. Dynamic per-request via `await searchParams`, so the HO 490 nowMs
// clock runs fresh (no force-dynamic needed).

type FeedMode = "bills" | "news";

type SearchParams = {
  source?: string;
  topic?: string;
  window?: string;
  bill?: string;
  signal?: string;
  page?: string;
};

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const rawPage = Number.parseInt(params.page ?? "1", 10);
  const requestedPage = Number.isFinite(rawPage) ? rawPage : 1;
  // HO 490: one page-computed clock threaded to the news rows so relative-age
  // buckets match across SSR/hydration (#418). See lib/format.ts.
  const nowMs = Date.now();

  const source = sanitizeNewsSource(params.source);
  const topic = sanitizeTopic(params.topic);
  const windowHours = sanitizeWindowHours(params.window) ?? NEWS_DEFAULT_WINDOW;
  const billId = sanitizeBillId(params.bill);
  const signal = sanitizeNewsSignal(params.signal);

  // Two-URL nav toggle (HO 501): NEWS stays on /news preserving its own news
  // params (idempotent active-click); LEGISLATION goes to bare /bills — the
  // cross-carry is dropped, so switching modes does NOT ferry news params into
  // the bills route.
  const buildModeHref = (next: FeedMode) => {
    if (next === "bills") return "/bills";
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === "string" && v && k !== "page") sp.set(k, v);
    }
    const qs = sp.toString();
    return qs ? `/news?${qs}` : "/news";
  };
  const toggle = (
    <SegmentedToggle<FeedMode>
      current="news"
      ariaLabel="Feed mode"
      segments={[
        { value: "bills", label: "LEGISLATION" },
        { value: "news", label: "NEWS" },
      ]}
      buildHref={buildModeHref}
    />
  );

  const {
    mentions,
    page: currentPage,
    totalPages,
    breakingCount,
  } = await getNewsFeed(
    { source, topic, windowHours, billId, signal },
    { page: requestedPage, pageSize: NEWS_FEED_PAGE_SIZE },
  );

  // Pager + chip carry: ONLY the active news params. No mode marker (the route
  // is the mode now), no BILLS-param round-trip. `page` is never carried — the
  // pager and the chips (which sp.delete("page")) own it.
  const newsCarry = new URLSearchParams();
  if (source) newsCarry.set("source", source);
  if (topic) newsCarry.set("topic", topic);
  if (windowHours !== NEWS_DEFAULT_WINDOW)
    newsCarry.set("window", String(windowHours));
  if (billId) newsCarry.set("bill", billId);
  if (signal) newsCarry.set("signal", signal);

  // The NewsFilters chips override the one dim they own per click; seeding the
  // full active-news set means a click preserves the others (including an
  // active bill scope and a BREAKING signal).
  const filterCarry = new URLSearchParams(newsCarry);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/news" />

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
            basePath="/news"
          />
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            carry={newsCarry}
            basePath="/news"
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
              basePath="/news"
            />
          </div>
        )}
      </main>
    </div>
  );
}
