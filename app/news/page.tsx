import Link from "next/link";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { NewsFilters } from "@/components/NewsFilters";
import { NewsRow } from "@/components/NewsRow";
import { NewsTopicRailRow } from "@/components/NewsTopicRailRow";
import { Pagination } from "@/components/Pagination";
import { RaceNewsRow } from "@/components/RaceNewsRow";
import { SegmentedToggle } from "@/components/SegmentedToggle";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";
import {
  NEWS_DEFAULT_WINDOW,
  NEWS_FEED_PAGE_SIZE,
  getMember,
  getMemberNews,
  getNewsFeed,
  getNewsTopicRailCounts,
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
  member?: string;
  page?: string;
};

// HO 512: member mode is a semantic BRANCH to the observation layer (the way
// ?bill= is), not a WHERE clause on the mention feed. It serves getMemberNews
// — the exact query the record box's Press tab previews — so the out-link lands
// on the same rows, not a bill-matched subset. NEWS_MEMBER_CAP is file-local
// (the HO 493 file-local-constant precedent; /lobbying's PAGE_SIZE is the
// sibling); getMemberNews carries the member-news cache tag already (HO 414).
const NEWS_MEMBER_CAP = 50;

// bioguide ids are alphanumeric (e.g. "S000033") — guard the URL input. Copied
// page-local from app/trades/page.tsx; not worth a shared helper for a
// two-consumer 5-liner.
function parseMember(raw: string | undefined): string | undefined {
  return typeof raw === "string" && /^[A-Za-z0-9]+$/.test(raw) ? raw : undefined;
}

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
  const member = parseMember(params.member);

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

  // HO 512 — member mode. When ?member= parses it OWNS the view: bill / source /
  // topic / window / signal / page are ignored (not errored, just not applied
  // and not carried). getMember null (valid-shape but unknown bioguide) renders
  // member mode with the raw id label + empty state — never a 404. A parse-fail
  // leaves `member` undefined, so control falls through to the unscoped feed.
  if (member) {
    const [memberNews, memberRow] = await Promise.all([
      getMemberNews(member, NEWS_MEMBER_CAP),
      getMember(member),
    ]);
    const memberLabel = memberRow?.name ?? member;
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
              source={undefined}
              topic={undefined}
              windowHours={NEWS_DEFAULT_WINDOW}
              billId={undefined}
              signal={undefined}
              breakingCount={0}
              carry={new URLSearchParams()}
              basePath="/news"
              memberId={member}
              memberLabel={memberLabel}
            />
          </section>

          {memberNews.length === 0 ? (
            <p
              className="py-16 text-center text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              No recent news linked to this member.
            </p>
          ) : (
            // Same bordered container as the mention feed; RaceNewsRow is the
            // member-hub idiom (headline · source · age, no bill cell — an
            // observation keyed to a person carries no bill). No Pagination in
            // this mode (getMemberNews returns a single capped page), and no
            // .news-header-row (its Bill column would misalign the --no-bill grid).
            <div
              className="border"
              style={{ borderColor: "var(--border-strong)" }}
            >
              <ul>
                {memberNews.map((n) => (
                  <li key={n.obsId} className="px-3">
                    <RaceNewsRow item={n} nowMs={nowMs} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>
      </div>
    );
  }

  // HO 515 — three modes now, stated so the next session doesn't read a hidden
  // rail as a bug:
  //   • DEFAULT (mention feed): the TOPIC RAIL renders and scopes the feed.
  //   • BILL-scoped (?bill=): rail does NOT render — one bill's history is a
  //     single-topic slice, so a topic rail over it is one row (noise). The feed
  //     renders full-width, byte-identical to pre-515.
  //   • MEMBER-scoped (?member=, HO 512): handled by the early branch above — a
  //     different table (observations), topic doesn't apply. Byte-identical.
  // The rail lives ONLY in DEFAULT mode. Axis B ("IN THE NEWS" member group as a
  // SECOND group in this same rail) will reopen the member seam later; it is NOT
  // in this HO (and carries its own window semantics — the 24h head collapses to
  // 6 members, HO 514 — so it can't rebase on ?window=).
  const showRail = !billId;
  const [feed, railCounts] = await Promise.all([
    getNewsFeed(
      { source, topic, windowHours, billId, signal },
      { page: requestedPage, pageSize: NEWS_FEED_PAGE_SIZE },
    ),
    // Rebases on source/window/signal, self-excludes topic (never passed → can't
    // collapse the rail). null on a bad read → the rail hides, feed still renders.
    showRail
      ? getNewsTopicRailCounts({ source, windowHours, signal })
      : Promise.resolve(null),
  ]);
  const { mentions, page: currentPage, totalPages, breakingCount } = feed;
  // The rail hides (falls back to the topic chip row) when a bill scopes the
  // view OR the rail read failed. hideTopics tracks whether the rail RENDERS, so
  // a failed rail read restores the chips rather than losing topic filtering.
  const railRendered = showRail && railCounts != null;
  const railMax = railCounts?.[0]?.count ?? 0;
  // CLEAR (rail header) drops ?topic= + ?page=, preserving source/window/signal.
  const clearTopicHref = (() => {
    const sp = new URLSearchParams();
    if (source) sp.set("source", source);
    if (windowHours !== NEWS_DEFAULT_WINDOW) sp.set("window", String(windowHours));
    if (signal) sp.set("signal", signal);
    const qs = sp.toString();
    return qs ? `/news?${qs}` : "/news";
  })();

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

  // The right-pane / bill-mode body: the filter chips (topics hidden when the
  // rail renders them) + the mention feed. ONE definition — wrapped in the
  // two-pane shell in DEFAULT mode, rendered bare (full-width) in BILL mode so
  // that mode stays byte-identical to pre-515.
  const feedContent = (
    <>
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
          hideTopics={railRendered}
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
        <div className="border" style={{ borderColor: "var(--border-strong)" }}>
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
    </>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/news" />

      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="feed" active="news" />
        <div className="mb-3 flex items-center gap-3">{toggle}</div>

        {railRendered && railCounts ? (
          // DEFAULT mode: TOPIC RAIL (spine, left) + mention feed (content, right).
          <div className="mc-pane nw-pane">
            <div className="mc-rail nw-rail">
              <div className="mc-rail-h">
                <span>TOPICS · {railCounts.length}</span>
                {topic ? (
                  <Link href={clearTopicHref} className="mc-rail-on">
                    CLEAR
                  </Link>
                ) : (
                  <span>VOL</span>
                )}
              </div>
              <div className="nw-rail-scroll">
                {railCounts.map((r) => (
                  <NewsTopicRailRow
                    key={r.topic}
                    topic={r.topic}
                    label={topicLabel(r.topic)}
                    fullLabel={topicFullLabel(r.topic)}
                    count={r.count}
                    pct={railMax > 0 ? (r.count / railMax) * 100 : 0}
                    barColor={topicColor(r.topic)}
                    selected={topic === r.topic}
                  />
                ))}
              </div>
            </div>
            <div className="mc-content nw-content">{feedContent}</div>
          </div>
        ) : (
          // BILL mode (or a failed rail read): full-width feed, no rail.
          feedContent
        )}
      </main>
    </div>
  );
}
