import Link from "next/link";
import { Fragment } from "react";
import { FilingExpandPanel } from "@/components/FilingExpandPanel";
import { FilingRow } from "@/components/FilingRow";
import { FirmsLeaderboard } from "@/components/FirmsLeaderboard";
import { HeaderBar } from "@/components/HeaderBar";
import { IssueRailRow } from "@/components/IssueRailRow";
import { LobbyingMiniBars } from "@/components/LobbyingMiniBars";
import { Pagination } from "@/components/Pagination";
import { type Segment, SegmentedToggle } from "@/components/SegmentedToggle";
import { TopicCrosswalk } from "@/components/TopicCrosswalk";
import { topicForCode } from "@/lib/lda-issue-topic-map";
import { topicColor } from "@/lib/topic-colors";
import {
  type FilingSummary,
  getFilingActivities,
  getLobbyingRollup,
  getRecentFilings,
  getTopFirms,
  getTopicCrosswalk,
  sanitizeFilingUuid,
  sanitizeIssueCode,
  sanitizeSearchQuery,
} from "@/lib/queries";

// Reads the DB (rollup blob + live feed); opt out of static prerender.
export const dynamic = "force-dynamic";

// HO 493 — PAGE_SIZE=13, NOT the larger 14 a uniform-row measurement suggests.
// The unscoped feed's content column must come in at/under the rail floor
// (~551px = the globals.css .lob-rail-scroll 520px bound + the 31px rail header)
// so both views share one rail-floored page height (~1369px @ 1280w). But feed
// rows are VARIABLE height — filings citing several bill chips wrap and cost
// ~33px each. Measured page 1: 14 rows ≈ 534px (17px slack, absorbs zero wrapped
// rows); 13 rows ≈ 501px (~50px slack, absorbs one). Both floor at the rail when
// they fit, so 14 buys one row in exchange for the section headers dropping below
// the fold on any day page 1 carries a wrapped row. The measured slack is a
// property of that day's feed, not of this constant — do NOT re-tune upward on a
// low-chip day. (MAX_FEED_PAGES below is the pager cap.)
const PAGE_SIZE = 13;
// The corpus feed is a RECENCY window, capped so the OFFSET stays cheap. A deep
// OFFSET can't short-circuit the idx_lda_filings_dt_posted walk — it scans up to
// all ~108k rows (measured 12.3s at the tail, HO 437), which trips the 10s
// boundedFetch cap → 500 (and the pager would even link to that tail page). 40
// pages = the 1,000 most-recent filings (offset ≤ 975, sub-second). The full
// corpus stays explorable via the issue rail → per-issue drill.
const MAX_FEED_PAGES = 40;

type SearchParams = {
  issue?: string;
  page?: string;
  expanded?: string;
  sort?: string; // HO 544 — "volume" selects the activity-count sort; else recent
  linked?: string; // HO 544 — "1" filters to bill-linked filings only
  q?: string; // HO 547 — registrant/client substring search (forces RECENT)
};

// HO 544 — the corpus fbar sort segment (RECENT ⇄ VOLUME). VOLUME = per-filing
// activity count ("meatiest filings"), the GO cut from the HO 543 probe (dollars
// were declined at HO 442). Only meaningful on the UNSCOPED corpus feed.
type SortMode = "recent" | "volume";
const SORT_SEGMENTS: readonly Segment<SortMode>[] = [
  { value: "recent", label: "RECENT" },
  { value: "volume", label: "VOLUME" },
];

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export default async function LobbyingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  // Rollup first (O(1) blob) — its stats.filings sizes the pager, so we can clamp
  // the requested page BEFORE the feed query and never issue a tail-of-table OFFSET.
  // topFirms + topicCrosswalk are sibling O(1) blobs (HO 442/444); all null together
  // pre-first-cron, so the rollup null-guard below covers them too.
  const [rollup, topFirms, topicCrosswalk] = await Promise.all([
    getLobbyingRollup(),
    getTopFirms(),
    getTopicCrosswalk(),
  ]);

  // The rollup blob is precomputed by the LDA cron / `npm run lda:rollup`. Before
  // the first rollup lands it's null — render an honest empty state.
  if (!rollup || rollup.issues.length === 0) {
    return (
      <div className="flex min-h-screen flex-col">
        <HeaderBar basePath="/lobbying" />
        <main className="w-full flex-1 px-4 py-4">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            Lobbying
          </h1>
          <p className="mt-6 text-[13px]" style={{ color: "var(--text-dim)" }}>
            Lobbying data is being prepared. Check back shortly.
          </p>
        </main>
      </div>
    );
  }

  const { stats, issues, drill } = rollup;

  // Scope is driven ONLY by an explicit ?issue= (the /members ?committee= idiom):
  // no code → unscoped corpus browser; a code with a drill → scoped to that issue.
  // A well-formed-but-unknown code (drill missing) falls back to unscoped rather
  // than an empty pane.
  const selected = sanitizeIssueCode(params.issue);
  const selectedDrill = selected ? (drill[selected] ?? null) : null;
  const scoped = selectedDrill !== null;

  const billLinkedPct = stats.billLinkedPct.toFixed(1);
  const maxFilings = issues.reduce((m, i) => Math.max(m, i.filings), 0);

  // HO 463 — group every corpus issue code under its CBT topic so the crosswalk
  // bars (Section below) can drill into their constituent codes' per-code drills.
  const topicCodes: Record<
    string,
    { code: string; display: string; filings: number }[]
  > = {};
  for (const i of issues) {
    const t = topicForCode(i.code);
    (topicCodes[t] ??= []).push({
      code: i.code,
      display: i.display,
      filings: i.filings,
    });
  }
  for (const group of Object.values(topicCodes)) {
    group.sort((a, b) => b.filings - a.filings);
  }

  // HO 544 — fbar controls apply to the UNSCOPED corpus feed ONLY. When scoped
  // (?issue=), the page serves the precomputed drill.recent sample, which can't be
  // re-sorted/re-filtered live (the HO 437 >25s per-issue wall), so sort/linked are
  // inert there and the controls are hidden below.
  const sortMode: SortMode = params.sort === "volume" ? "volume" : "recent";
  const billLinked = params.linked === "1";
  // HO 547 — registrant/client search. Unscoped-only (hidden when scoped, like the
  // HO 544 controls); a term FORCES RECENT (VOLUME defeats the LIMIT short-circuit
  // and spikes ~7.8s cold — HO 547). `activeQuery` is the human term (display + URL);
  // getRecentFilings does the LIKE %/_ escaping.
  const activeQuery = scoped ? undefined : sanitizeSearchQuery(params.q);
  const searchActive = activeQuery != null;
  // Toggle-on pagination total rides the blob stat — a live COUNT(DISTINCT) over
  // lda_activity_bills is the ~1s TEMP-B-TREE scan the HO 543 probe measured. Blobs
  // written before HO 544 lack billLinkedFilings → fall back to the pct·filings
  // estimate until the next daily rollup repopulates it (then it's the exact int).
  const billLinkedTotal =
    stats.billLinkedFilings ?? Math.round((stats.billLinkedPct / 100) * stats.filings);
  // NON-search pager rides the blob total (clamp the page BEFORE the query so a deep
  // OFFSET never hits the 12.3s tail — HO 437). SEARCH can't know its total upfront,
  // so it clamps to MAX_FEED_PAGES (RECENT+search deep OFFSET is ≤~700ms — HO 547)
  // and derives the real totalPages from the live COUNT the query returns.
  const blobTotal = !scoped && billLinked ? billLinkedTotal : stats.filings;
  const blobTotalPages = Math.min(
    Math.max(1, Math.ceil(blobTotal / PAGE_SIZE)),
    MAX_FEED_PAGES,
  );
  const page = Math.min(
    Math.max(1, parsePage(params.page)),
    searchActive ? MAX_FEED_PAGES : blobTotalPages,
  );

  let feedItems: FilingSummary[] = [];
  let feedPage = page;
  let searchTotal: number | undefined;
  if (!scoped) {
    const feed = await getRecentFilings({
      page,
      pageSize: PAGE_SIZE,
      sort: sortMode, // getRecentFilings forces recent when q is set
      billLinked,
      q: activeQuery,
    });
    feedItems = feed.items;
    feedPage = feed.page;
    searchTotal = feed.total;
  }
  const feedTotal = searchActive ? (searchTotal ?? 0) : blobTotal;
  const totalPages = searchActive
    ? Math.min(Math.max(1, Math.ceil(feedTotal / PAGE_SIZE)), MAX_FEED_PAGES)
    : blobTotalPages;
  const rows = scoped && selectedDrill ? selectedDrill.recent : feedItems;

  // Expand read (HO 486) — the one new live query. Fetch only when the ?expanded=
  // uuid is actually in the rendered set (the /members constraint); a valid uuid
  // that isn't on screen attaches nothing, so skip the read entirely.
  const expandedUuid = sanitizeFilingUuid(params.expanded);
  const activities =
    expandedUuid && rows.some((f) => f.filingUuid === expandedUuid)
      ? await getFilingActivities(expandedUuid)
      : null;

  const feedCarry = new URLSearchParams();
  if (params.issue) feedCarry.set("issue", params.issue);
  // HO 544/547 — carry the active sort/filter/search across pagination (unscoped feed
  // only). A search forces RECENT, so sort=volume is inert then and dropped.
  if (activeQuery) feedCarry.set("q", activeQuery);
  if (sortMode === "volume" && !searchActive) feedCarry.set("sort", "volume");
  if (billLinked) feedCarry.set("linked", "1");

  // Per-row expand toggle target — carries the active scope (?issue=) + pager
  // position (?page=) + sort/filter (HO 544) so expanding never drops them;
  // toggles ?expanded=.
  const buildToggleHref = (uuid: string, rowExpanded: boolean): string => {
    const sp = new URLSearchParams();
    if (params.issue) sp.set("issue", params.issue);
    if (params.page) sp.set("page", params.page);
    if (activeQuery) sp.set("q", activeQuery);
    if (sortMode === "volume" && !searchActive) sp.set("sort", "volume");
    if (billLinked) sp.set("linked", "1");
    if (!rowExpanded) sp.set("expanded", uuid);
    const qs = sp.toString();
    return qs ? `/lobbying?${qs}` : "/lobbying";
  };

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/lobbying" />

      <main className="w-full flex-1 px-4 py-4">
        {/* Corpus readout + one-line blurb */}
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            Lobbying
          </h1>
          <span
            className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {stats.filings.toLocaleString()} filings ·{" "}
            {stats.activities.toLocaleString()} activities ·{" "}
            {stats.registrants.toLocaleString()} registrants ·{" "}
            {stats.clients.toLocaleString()} clients · {billLinkedPct}% name a
            tracked bill
          </span>
        </div>
        <p
          className="mb-4 max-w-[70ch] text-[12px] leading-snug"
          style={{ color: "var(--text-muted)", fontFamily: "var(--sans)" }}
        >
          Who&rsquo;s paying to move what — LD-2 quarterly lobbying reports for the
          119th, bucketed by issue area, with the numbered-bill link as an overlay.
        </p>

        {/* Filter bar — count + (HO 544) sort segment & bill-linked toggle. The
            controls apply to the UNSCOPED corpus feed ONLY: when ?issue= is set the
            page serves the precomputed drill.recent sample (the HO 437 >25s per-issue
            wall), which can't be re-sorted/re-filtered live — so they're hidden, not
            rendered dead. Search stays deferred (its own FTS follow-on). */}
        <div className="mc-fbar">
          <span className="mc-fbar-count">
            {scoped && selectedDrill ? (
              <>
                <span className="mc-fbar-n">
                  {selectedDrill.filings.toLocaleString()}
                </span>{" "}
                FILINGS <span aria-hidden> · </span>
                <span className="mc-fbar-n">
                  {selectedDrill.distinctClients.toLocaleString()}
                </span>{" "}
                CLIENTS <span aria-hidden> · </span>
                {selectedDrill.display}
              </>
            ) : searchActive ? (
              <>
                <span className="mc-fbar-n">{feedTotal.toLocaleString()}</span>{" "}
                FILINGS <span aria-hidden> · </span>MATCHING &ldquo;{activeQuery}
                &rdquo;
              </>
            ) : billLinked ? (
              <>
                <span className="mc-fbar-n">{feedTotal.toLocaleString()}</span>{" "}
                FILINGS <span aria-hidden> · </span>NAME A TRACKED BILL
              </>
            ) : (
              <>
                <span className="mc-fbar-n">{stats.filings.toLocaleString()}</span>{" "}
                FILINGS <span aria-hidden> · </span>
                <span className="mc-fbar-n">{stats.clients.toLocaleString()}</span>{" "}
                CLIENTS
              </>
            )}
          </span>
          <span className="mc-fbar-spacer" />
          {!scoped ? (
            <div className="lob-fbar-controls">
              {/* HO 547 — a search term forces RECENT: VOLUME defeats the LIMIT
                  short-circuit (~7.8s cold, HO 547), so the sort segment is replaced
                  by a disabled variant (RECENT active, VOLUME inert + title). The
                  shared SegmentedToggle is NOT widened for a disabled state. */}
              {searchActive ? (
                <span
                  className="lob-fbar-sort-off"
                  role="group"
                  aria-label="Sort — recent (volume unavailable while searching)"
                  title="Sort by volume is unavailable while searching"
                >
                  <span className="lob-seg-on">RECENT</span>
                  <span className="lob-seg-off" aria-disabled="true">
                    VOLUME
                  </span>
                </span>
              ) : (
                <SegmentedToggle<SortMode>
                  current={sortMode}
                  segments={SORT_SEGMENTS}
                  ariaLabel="Sort filings by recency or activity volume"
                  buildHref={(value) => {
                    const sp = new URLSearchParams();
                    if (value === "volume") sp.set("sort", "volume");
                    if (billLinked) sp.set("linked", "1");
                    const qs = sp.toString();
                    return qs ? `/lobbying?${qs}` : "/lobbying";
                  }}
                />
              )}
              <Link
                href={(() => {
                  const sp = new URLSearchParams();
                  if (activeQuery) sp.set("q", activeQuery);
                  if (sortMode === "volume" && !searchActive) sp.set("sort", "volume");
                  if (!billLinked) sp.set("linked", "1"); // toggle on; when on, omit → off
                  const qs = sp.toString();
                  return qs ? `/lobbying?${qs}` : "/lobbying";
                })()}
                scroll={false}
                className="lob-fbar-linked"
                data-active={billLinked ? "true" : undefined}
                aria-pressed={billLinked}
                title="Show only filings that name a tracked bill"
              >
                BILL-LINKED
              </Link>
              {/* Search: form GET writes ?q= (server-driven, no client island —
                  matches the page's <Link>-driven idiom). Submit resets sort→recent
                  + page→1 (fields omitted); the bill-linked filter is preserved. */}
              <form
                method="GET"
                action="/lobbying"
                className="lob-fbar-search"
                role="search"
              >
                {billLinked ? (
                  <input type="hidden" name="linked" value="1" />
                ) : null}
                <input
                  type="text"
                  name="q"
                  defaultValue={activeQuery ?? ""}
                  placeholder="Search firm or client…"
                  maxLength={64}
                  aria-label="Search registrant or client name"
                  className="lob-fbar-search-input"
                />
                {searchActive ? (
                  <Link
                    href={billLinked ? "/lobbying?linked=1" : "/lobbying"}
                    scroll={false}
                    className="lob-fbar-search-clear"
                    aria-label="Clear search"
                  >
                    ×
                  </Link>
                ) : null}
              </form>
            </div>
          ) : null}
        </div>

        {/* Two-pane browser: issue rail (spine) · filings content */}
        <div className="mc-pane">
          {/* LEFT RAIL — LDA issue codes, VOL-desc, topic-colored bars */}
          <div className="mc-rail lob-rail">
            <div className="mc-rail-h">
              <span>ISSUES · {issues.length}</span>
              <span>VOL</span>
            </div>
            {/* HO 492: rows in a bounded scroll region so the 79-code rail stops
                setting the pane height. Header above stays put. */}
            <div className="lob-rail-scroll">
              {issues.map((i) => (
                <IssueRailRow
                  key={i.code}
                  code={i.code}
                  display={i.display}
                  filings={i.filings}
                  pct={maxFilings > 0 ? (i.filings / maxFilings) * 100 : 0}
                  barColor={topicColor(topicForCode(i.code))}
                  selected={selected === i.code}
                />
              ))}
            </div>
          </div>

          {/* RIGHT PANE — filings content */}
          <div className="mc-content lob-content">
            {/* Context header + who's-who (scoped only) */}
            {scoped && selectedDrill ? (
              <>
                <div className="mc-ctx">
                  <span className="mc-ctx-ch">{selectedDrill.code}</span>
                  <span className="mc-ctx-name">{selectedDrill.display}</span>
                  <span className="mc-ctx-count">
                    · {selectedDrill.filings.toLocaleString()} filings ·{" "}
                    {selectedDrill.distinctClients.toLocaleString()} clients ·{" "}
                    {selectedDrill.billLinked.toLocaleString()} bill-linked
                  </span>
                  <span className="mc-ctx-spacer" />
                  <Link href="/lobbying" className="mc-ctx-clr">
                    × all filings
                  </Link>
                </div>
                <div className="lob-ww">
                  <LobbyingMiniBars
                    label="Top clients"
                    rows={selectedDrill.topClients}
                  />
                  <LobbyingMiniBars
                    label="Top firms"
                    rows={selectedDrill.topFirms}
                  />
                </div>
              </>
            ) : null}

            {/* Column header (grid-aligned with the filing rows) */}
            <div className="mc-row mc-row-hdr lob-filing-row">
              <span aria-hidden />
              <span>AGE</span>
              <span>REGISTRANT → CLIENT</span>
              <span>ISSUES</span>
              <span>BILLS</span>
            </div>

            {rows.length > 0 ? (
              rows.map((f) => (
                <Fragment key={f.filingUuid}>
                  <FilingRow
                    filing={f}
                    expandable
                    isExpanded={f.filingUuid === expandedUuid}
                    toggleHref={buildToggleHref(
                      f.filingUuid,
                      f.filingUuid === expandedUuid,
                    )}
                  />
                  {f.filingUuid === expandedUuid && activities ? (
                    <FilingExpandPanel activities={activities} filing={f} />
                  ) : null}
                </Fragment>
              ))
            ) : searchActive ? (
              <div className="mc-empty">
                No filings match &ldquo;{activeQuery}&rdquo;
              </div>
            ) : (
              <div className="mc-empty">No filings on file</div>
            )}

            {/* Pager — unscoped corpus feed only.
                Scoped view serves the precomputed drill.recent sample, so no pager here.
                A live per-issue feed is the HO 437 abandoned query (>25s cold) — do not
                "fix" this into pagination without re-probing the per-code cost. */}
            {!scoped && totalPages > 1 ? (
              <Pagination
                currentPage={feedPage}
                totalPages={totalPages}
                carry={feedCarry}
                basePath="/lobbying"
              />
            ) : null}
          </div>
        </div>

        {/* HO 492: crosswalk + firms side-by-side (each internally bounded) so
            they're reachable without scrolling a full-width stack. Both are
            sibling O(1) blobs that render together, so the 2-col grid is never
            a lone half-width panel in practice (the null-both case early-returns
            above). Stacks single-column below 900px. */}
        <div className="lob-secs">
          {/* CBT-topic crosswalk: the corpus in CBT's 24-topic vocabulary — a
              parallel lens + the topic-color legend for the rail bars (HO 444/463) */}
          {topicCrosswalk?.topics.length ? (
            <TopicCrosswalk
              topics={topicCrosswalk.topics}
              topicCodes={topicCodes}
              selected={selected}
            />
          ) : null}

          {/* Corpus-wide top-firms leaderboard (HO 442) */}
          {topFirms?.firms.length ? (
            <FirmsLeaderboard
              firms={topFirms.firms}
              totalRegistrants={topFirms.totalRegistrants}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
