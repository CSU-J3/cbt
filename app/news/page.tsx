import Link from "next/link";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { NewsFilters } from "@/components/NewsFilters";
import { NewsMemberRailRow } from "@/components/NewsMemberRailRow";
import { NewsRow } from "@/components/NewsRow";
import { NewsTopicRailRow } from "@/components/NewsTopicRailRow";
import { Pagination } from "@/components/Pagination";
import { RaceNewsRow } from "@/components/RaceNewsRow";
import { SegmentedToggle } from "@/components/SegmentedToggle";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";
import {
  NEWS_DEFAULT_WINDOW,
  NEWS_FEED_PAGE_SIZE,
  NEWS_MEMBER_RAIL_WINDOW_DAYS,
  type NewsMemberRailItem,
  getMember,
  getMemberNews,
  getNewsFeed,
  getNewsMemberRailCounts,
  getNewsMemberRailPin,
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

// HO 517 — the "IN THE NEWS" rail group shows the top N by 30d article count; the
// header discloses "N of {total}". 24 topics + an uncapped 39+ member group would
// push the 2nd group permanently out of the 520px bound; 15 is enough for a
// "who's hot" read. An active member outside this set is PINNED (call 5).
const NEWS_MEMBER_RAIL_SHOWN = 15;

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

  // ── modes (HO 512 → HO 517) ──────────────────────────────────────────────
  //   • DEFAULT / ?topic= (mention feed): rail renders, the TOPIC group scopes
  //     the feed.
  //   • ?member= (the HO 512 mode; rail added HO 517): the rail STILL renders
  //     (the HO 515 seam is CLOSED) with the MEMBER group as the selection, and
  //     the pane is the observation feed (getMemberNews). The member OWNS the
  //     view (ignores source/window/signal/bill), so the topic group shows BARE
  //     mention-feed counts — clicking a topic clears member (call 3) and returns
  //     the mention feed scoped to that topic.
  //   • ?bill= (HO 130): NO rail — one bill's history is a single-topic slice, so
  //     a rail over it is noise; full-width feed, byte-identical.
  // ONE selection across both groups: a topic clears member, a member clears
  // topic (the row components delete the other param), so at most one row is lit.
  const showRail = !billId || !!member; // member overrides bill; only bare-bill hides it

  const [feed, memberFetch, topicRail, memberRail] = await Promise.all([
    // Mention feed for the non-member modes; member mode reads the observation feed.
    member
      ? Promise.resolve(null)
      : getNewsFeed(
          { source, topic, windowHours, billId, signal },
          { page: requestedPage, pageSize: NEWS_FEED_PAGE_SIZE },
        ),
    member
      ? Promise.all([
          getMemberNews(member, NEWS_MEMBER_CAP),
          getMember(member),
        ] as const)
      : Promise.resolve(null),
    // Topic group: BARE counts in member mode (member ignores those dims), else
    // rebased on the active source/window/signal. Self-excludes topic always.
    // null on a bad read → the topic group hides + the chip row returns.
    showRail
      ? getNewsTopicRailCounts(member ? {} : { source, windowHours, signal })
      : Promise.resolve(null),
    // Member group: FIXED 30d, independent of every page dim (call 1).
    showRail ? getNewsMemberRailCounts() : Promise.resolve(null),
  ]);

  // Pin the active member if they're outside the shown top-15 (call 5). If they
  // have ≥1 obs they're in the full ranked rows (just below the cut); a member
  // with only >30d coverage isn't, so the point lookup fills the row (count 0).
  let memberPin: NewsMemberRailItem | null = null;
  if (member && memberRail) {
    const inShown = memberRail.rows
      .slice(0, NEWS_MEMBER_RAIL_SHOWN)
      .some((r) => r.bioguide === member);
    if (!inShown) {
      memberPin =
        memberRail.rows.find((r) => r.bioguide === member) ??
        (await getNewsMemberRailPin(member));
    }
  }

  // Rail renders in all non-bill modes as long as ≥1 group read succeeded.
  const railRendered = showRail && (topicRail != null || memberRail != null);
  const topicRailMax = topicRail?.[0]?.count ?? 0;

  // CLEAR (topic-group header) drops ?topic= + ?page=, preserving source/window/
  // signal (feed mode only — member mode has no active topic).
  const clearTopicHref = (() => {
    const sp = new URLSearchParams();
    if (source) sp.set("source", source);
    if (windowHours !== NEWS_DEFAULT_WINDOW) sp.set("window", String(windowHours));
    if (signal) sp.set("signal", signal);
    const qs = sp.toString();
    return qs ? `/news?${qs}` : "/news";
  })();

  // Pager + chip carry: ONLY the active news params. `page` is never carried —
  // the pager and the chips (which sp.delete("page")) own it.
  const newsCarry = new URLSearchParams();
  if (source) newsCarry.set("source", source);
  if (topic) newsCarry.set("topic", topic);
  if (windowHours !== NEWS_DEFAULT_WINDOW)
    newsCarry.set("window", String(windowHours));
  if (billId) newsCarry.set("bill", billId);
  if (signal) newsCarry.set("signal", signal);
  const filterCarry = new URLSearchParams(newsCarry);

  // ── content: the mention feed (feed/bill mode) OR the observation feed
  //    (member mode). Only one is non-null per request. ────────────────────────
  const mentionFeedContent = feed ? (
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
          breakingCount={feed.breakingCount}
          carry={filterCarry}
          basePath="/news"
          // hide the chip row only when the TOPIC group actually renders (a
          // failed topic read restores the chips so topic filtering survives).
          hideTopics={topicRail != null}
        />
        <Pagination
          currentPage={feed.page}
          totalPages={feed.totalPages}
          carry={newsCarry}
          basePath="/news"
        />
      </section>

      {feed.mentions.length === 0 ? (
        <p
          className="py-16 text-center text-[length:var(--fs-13)]"
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
            {feed.mentions.map((m) => (
              <li key={m.id} className="px-3">
                <NewsRow mention={m} showFullHeadline nowMs={nowMs} />
              </li>
            ))}
          </ul>
          <Pagination
            currentPage={feed.page}
            totalPages={feed.totalPages}
            carry={newsCarry}
            basePath="/news"
          />
        </div>
      )}
    </>
  ) : null;

  const memberNews = memberFetch ? memberFetch[0] : [];
  const memberLabel = memberFetch ? (memberFetch[1]?.name ?? member ?? "") : "";
  const memberFeedContent = member ? (
    <>
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
          className="py-16 text-center text-[length:var(--fs-13)]"
          style={{ color: "var(--text-muted)" }}
        >
          No recent news linked to this member.
        </p>
      ) : (
        // RaceNewsRow is the member-hub idiom (headline · source · age, no bill
        // cell). No pager (single capped page), no news-header-row (its Bill
        // column would misalign the --no-bill grid).
        <div className="border" style={{ borderColor: "var(--border-strong)" }}>
          <ul>
            {memberNews.map((n) => (
              <li key={n.obsId} className="px-3">
                <RaceNewsRow item={n} nowMs={nowMs} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  ) : null;

  const content = member ? memberFeedContent : mentionFeedContent;

  // ── the rail: TOPICS group + "IN THE NEWS" member group, ONE bounded scroll
  //    (no nested scroll for the 2nd group — HO 517). ──────────────────────────
  const memberShown = memberRail
    ? memberRail.rows.slice(0, NEWS_MEMBER_RAIL_SHOWN)
    : [];
  const memberRows = memberPin ? [memberPin, ...memberShown] : memberShown;

  const railBlock = (
    <div className="mc-rail nw-rail">
      <div className="nw-rail-scroll">
        {topicRail ? (
          <>
            <div className="mc-rail-h">
              <span>TOPICS · {topicRail.length}</span>
              {topic && !member ? (
                <Link href={clearTopicHref} className="mc-rail-on">
                  CLEAR
                </Link>
              ) : (
                <span>VOL</span>
              )}
            </div>
            {topicRail.map((r) => (
              <NewsTopicRailRow
                key={r.topic}
                topic={r.topic}
                label={topicLabel(r.topic)}
                fullLabel={topicFullLabel(r.topic)}
                count={r.count}
                pct={topicRailMax > 0 ? (r.count / topicRailMax) * 100 : 0}
                barColor={topicColor(r.topic)}
                selected={!member && topic === r.topic}
              />
            ))}
          </>
        ) : null}
        {memberRail ? (
          <>
            <div className="mc-rail-h nw-mrail-h">
              <span>
                IN THE NEWS · {NEWS_MEMBER_RAIL_WINDOW_DAYS}d ·{" "}
                {memberShown.length} of {memberRail.total}
              </span>
            </div>
            {memberRows.map((r) => (
              <NewsMemberRailRow
                key={r.bioguide}
                bioguide={r.bioguide}
                name={r.name}
                party={r.party}
                count={r.count}
                selected={member === r.bioguide}
                pinned={memberPin?.bioguide === r.bioguide}
              />
            ))}
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/news" />

      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="feed" active="news" />
        <div className="mb-3 flex items-center gap-3">{toggle}</div>

        {railRendered ? (
          <div className="mc-pane nw-pane">
            {railBlock}
            <div className="mc-content nw-content">{content}</div>
          </div>
        ) : (
          // BILL mode (or both rail reads failed): full-width feed, no rail.
          content
        )}
      </main>
    </div>
  );
}
