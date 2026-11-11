import type { Metadata } from "next";
import { Fragment } from "react";
import { type NavItemKey, NAV_ITEMS } from "@/components/HeaderBar";
import { LandingCTAs } from "@/components/LandingCTAs";
import { LandingFunnel } from "@/components/LandingFunnel";
import { sourceLabel } from "@/components/RatingChip";
import { RATER_ORDER } from "@/components/RatingSourcesLine";
import { ACCOUNT_UI } from "@/lib/account-ui";
import {
  congressTermDates,
  currentCongressLabel,
  formatTermDate,
  getCurrentCongress,
  ordinal,
} from "@/lib/congress";
import { RACE_RATING_PAGES_2026, RACE_RATING_SOURCES } from "@/lib/enums";
import { addDaysToKey, etDayKey, etTodayKey, mondayOfKey } from "@/lib/hearings";
import {
  getCorpusStats,
  getDashboardReportSnapshot,
  getRaterFreshness,
  getRecentMeetings,
  getStageChangesCount,
  getStageDistribution,
  getUpcomingMeetings,
} from "@/lib/queries";
import { monDd } from "@/lib/week-summary";
import { Panel, loadBoard } from "./panels";
import styles from "./landing.module.css";

// HO 813 — /welcome rebuilt as the LOBBY, ruled by Corey on docs/design/mock-813-landing-scroll.html (v7, 3:44 PM MST Nov 10).
// One typeface, a 1200px column, the stage funnel beside the headline, the live
// board kept as the preview, and the terminal's chrome left behind the door: no
// rail, no BREAKING, no tapes, no clock, no bottom rail, all of which the
// dashboard keeps. Top to bottom: the top bar (the wordmark, Beta, the last sync,
// *Open the terminal*) · the hero (headline, lead, facts, the button and the
// search, the funnel card beside them) · the week line · Live (the HO 670 board,
// restyled) · What's inside (the nine pages) · How it's built · the footer.
// Supersedes the HO 670 board, which is record (docs/design/welcome-formats-mock.html format 1).
//
// THREE PLACES DEPART FROM THE MOCK, by the handoff's ruling: the week line
// prints the week its report covers rather than "This week in Congress."; the
// third How-it's-built heading is "Where the data comes from" and the facts line
// counts no sources; and Members prints no count, because the mock's 536 is the
// nav tooltip's literal and the build prints a count only from a query.
//
// THREE MORE LINES WERE CORRECTED FOR TRUTH at the FF go (Nov 10): *Six stages*
// says the count of laws is checked against the official list, not each bill's
// stage (the check is HO 812's tracked script, scripts/diagnostic/laws-vs-official-812.ts);
// Live's sub is "Nine feeds, in rotation.", true at every width, where "three at
// a time" wasn't on a phone; and Roll Call, the third configured news feed
// (lib/news-sources.ts), joins The Hill and Politico in both source lists.
//
// STILL A SERVER COMPONENT. Its one client island is LandingCTAs, mounted twice
// (the hero's button, the top bar's link); the search is a plain GET form, the
// funnel and the board are server-rendered, and the board's motion is CSS.
// force-dynamic so the cached reads stay fresh (revalidated by the sync cron's
// tags), same as the dashboard.
export const dynamic = "force-dynamic";

// The lead: the ruled BOTH, the hook then the statement (Corey, 1:46 and 5:11 PM
// MST Nov 10). The Congress comes from currentCongressLabel(), not a literal.
const HOOK = "Ever wanted to know the ROI on your Congress Critter?";
function statement(congressLabel: string): string {
  return `Congressional Terminal tracks every bill in the ${congressLabel}: a summary, its stage from introduction to enactment, its sponsor, the hearings and lobbying filings, and the news that mentions it.`;
}

export function generateMetadata(): Metadata {
  const description = `${HOOK} ${statement(currentCongressLabel())}`;
  return {
    title: "Congressional Terminal",
    description,
    openGraph: {
      title: "Congressional Terminal",
      description,
      url: "/welcome",
      type: "website",
    },
  };
}

// What's inside: the nav's pages less Dashboard, in nav order, each with the
// mock's line verbatim. NAV_ITEMS is HeaderBar's, read here, not edited (and
// its tooltips aren't either). A nav item without a ruled line isn't listed;
// smoke's "lists the nine pages" test holds this list to NAV_ITEMS, so a new
// nav item fails it until its line is written.
const PAGE_LINES: Partial<Record<NavItemKey, string>> = {
  feed: "Every bill, its news and its stage changes, and the President's desk.",
  hearings: "Committee hearings, markups and business meetings, by day.",
  members: "Every member, their bills and laws, their 2026 race, and the primary calendar.",
  races: "The competitive 2026 races with each forecaster's rating, and the primary calendar.",
  patterns: "Bill shapes, long-run trends, and the bills that stalled.",
  lobbying: "What's being lobbied: LD-2 filings by issue, and who's paying.",
  nominations: "Presidential nominations, by agency and status.",
  amendments: "Floor amendments: who's amending which bills, and the few that get a vote.",
  reports: "A weekly report on what moved, newest first.",
};

// The search's quick picks, each its own /search?q=.
const TRIES = ["HR 3978", "Markey", "veterans", "shutdown"];

// The Hearings count reads the dashboard's THIS WEEK input: the upcoming
// meetings and the last RECENT_DAYS days' (components/HearingsTab.tsx:22-27). A
// copy of that file's 14, since its const isn't exported and the dashboard isn't
// edited here; app/hearings/page.tsx holds the same 14.
const RECENT_DAYS = 14;

// The six stage names under *Six stages*, in their --stage-* colours.
const STAGE_TRAIL: { label: string; color: string }[] = [
  { label: "Introduced", color: "var(--stage-introduced)" },
  { label: "Committee", color: "var(--stage-committee)" },
  { label: "Floor", color: "var(--stage-floor)" },
  { label: "Other chamber", color: "var(--stage-other-chamber)" },
  { label: "President", color: "var(--stage-president)" },
  { label: "Law", color: "var(--stage-enacted)" },
];

// The last-sync stamps render server-side in MT, as the HO 670 foot did.
//
// `formatInZone` is NOT imported here even though it emits exactly this string:
// `lib/zone-cycle.ts` also exports the `useZoneCycle` HOOK, which makes the whole
// module client-only ("You're importing a component that needs useState"), so a
// server component cannot reach the pure formatter sitting beside it.
const MT_TZ = "America/Denver";
let mtFormatter: Intl.DateTimeFormat | undefined;
function formatMt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  mtFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: MT_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${mtFormatter.format(d)} MT`;
}

export default async function WelcomePage() {
  const [moversCount, corpus, stageDist, freshness, snap, upcoming, recent] = await Promise.all([
    getStageChangesCount({}, 7),
    getCorpusStats(true),
    getStageDistribution(undefined, true),
    // HO 784: the raters' dates, for the footer's "as of".
    getRaterFreshness(),
    // The week line's summary and the Reports count. The line is optional, so a
    // failed read drops it rather than failing the landing.
    getDashboardReportSnapshot().catch(() => null),
    // The Hearings count's input, the dashboard's THIS WEEK's: the upcoming
    // meetings and the last 14 days'. loadBoard reads both too, from the same
    // cache entries, so the count costs no read of its own.
    getUpcomingMeetings(),
    getRecentMeetings(RECENT_DAYS),
  ]);
  // HO 490: page-computed clock for every relative age below (#418).
  const nowMs = Date.now();
  const moved7d = moversCount.total;
  const board = await loadBoard(nowMs, moved7d);

  const congress = getCurrentCongress();
  const congressLabel = currentCongressLabel();
  const term = congressTermDates(congress);

  // HO 784: the footer's one date phrase for the raters: a single date while they
  // agree, the oldest to the newest when they don't, nothing when none has one.
  // HO 786: kept as its two ends, so each date stays whole and only "to" breaks.
  const raterDates = RATER_ORDER.map((s) => freshness[s]?.asOf)
    .filter((d): d is string => typeof d === "string")
    .sort();
  const ratingsAsOf =
    raterDates.length === 0
      ? null
      : { from: raterDates[0]!, to: raterDates[raterDates.length - 1]! };

  const enacted = stageDist.bars.find((b) => b.stage === "enacted")?.count ?? 0;
  const lawRatio = corpus.total > 0 ? (enacted / corpus.total) * 100 : 0;

  // Hearings this week, the number the dashboard's THIS WEEK prints
  // (HearingsDaySchedule's weekTotal): of the upcoming meetings and the last 14
  // days', those whose ET day falls Monday to Friday of the current ET week. A
  // week's earlier days are in the recent list, which the upcoming one alone
  // missed (it read 3 on a Tuesday evening). A meeting both lists hold is counted
  // once, by its event id.
  const monday = mondayOfKey(etTodayKey(nowMs));
  const weekDays = new Set(Array.from({ length: 5 }, (_, i) => addDaysToKey(monday, i)));
  const hearingsThisWeek = new Set(
    [...upcoming, ...recent]
      .filter((m) => weekDays.has(etDayKey(m.meetingDate)))
      .map((m) => m.eventId),
  ).size;

  // A count beside a page's name, only from a read this page already makes.
  const PAGE_COUNTS: Partial<Record<NavItemKey, string>> = {
    feed: `${moved7d.toLocaleString("en-US")} moved this week`,
    hearings: `${hearingsThisWeek.toLocaleString("en-US")} this week`,
    races: `${RATER_ORDER.length} raters`,
    ...(board.lobbyingFilings !== null
      ? { lobbying: `${board.lobbyingFilings.toLocaleString("en-US")} filings` }
      : {}),
    ...(snap ? { reports: `Newest ${monDd(snap.latest.weekStart)}` } : {}),
  };
  const pages = NAV_ITEMS.filter((it) => it.key !== "dashboard" && PAGE_LINES[it.key]);

  const summary = snap?.summary ?? null;
  const reportHref =
    snap && summary && summary.weekStart === snap.latest.weekStart
      ? `/reports/${snap.latest.slug}`
      : "/reports";

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.top}>
          <span className={styles.brand}>
            <span>
              Congressional Terminal<span className={styles.mark}>:\&gt;</span>
            </span>{" "}
            <span className={styles.pill}>Beta</span>
          </span>
          <span className={styles.sp} />
          <span className={styles.sync}>
            Last sync <b>{formatMt(corpus.lastSync)}</b>
          </span>
          <LandingCTAs
            primaryClassName={styles.toplink ?? ""}
            showLogin={false}
            label="Open the terminal"
            variant="link"
          />
        </div>

        <div className={styles.hero}>
          <div>
            <h1 className={styles.h1}>WTF is going on in Congress?</h1>
            <p className={styles.lead}>
              <b>{HOOK}</b> {statement(congressLabel)}
            </p>
            <p className={styles.facts}>
              The {ordinal(congress)} Congress runs{" "}
              <b>
                {formatTermDate(term.start)} to {formatTermDate(term.end)}
              </b>
              ; the {ordinal(congress + 1)} starts {formatTermDate(term.end)}. Synced four times a
              day from congress.gov and the sources named below.
            </p>
            <div className={styles.actions}>
              <LandingCTAs
                primaryClassName={`${styles.btn} ${styles.btnPrimary}`}
                secondaryClassName={styles.btn ?? ""}
                showLogin={ACCOUNT_UI}
                label="Enter the terminal"
              />
              <span className={styles.quiet}>No account needed.</span>
            </div>
            <div className={styles.search}>
              <form action="/search" method="get" role="search">
                <input
                  name="q"
                  type="search"
                  placeholder="Search bills, members, news, and reports"
                  aria-label="Search bills, members, news, and reports"
                  autoComplete="off"
                />
                <button type="submit">Search</button>
              </form>
              <div className={styles.tries}>
                <span>Try</span>
                {TRIES.map((t) => (
                  <a key={t} href={`/search?q=${encodeURIComponent(t)}`}>
                    {t}
                  </a>
                ))}
              </div>
            </div>
          </div>
          <LandingFunnel
            bars={stageDist.bars}
            total={corpus.total}
            enacted={enacted}
            lawRatio={lawRatio}
            congressLabel={congressLabel}
          />
        </div>

        {summary ? (
          <div className={styles.week}>
            <span>
              <b>The week of {monDd(summary.weekStart)}.</b> {summary.text}
            </span>
            <a href={reportHref}>Read the {monDd(summary.weekStart)} report</a>
          </div>
        ) : null}

        <section className={styles.sec}>
          <h2 className={styles.h2}>Live</h2>
          <p className={styles.sub2}>Nine feeds, in rotation.</p>
          <div className={styles.board}>
            {board.panels.map((p, i) => (
              <Panel key={p.key} panel={p} live={i === 0} />
            ))}
          </div>
        </section>

        <section className={styles.sec}>
          <h2 className={styles.h2}>What&apos;s inside</h2>
          <p className={styles.sub2}>Nine pages, all open without an account.</p>
          <div className={styles.pages}>
            {pages.map((it) => (
              <a key={it.key} className={styles.pg} href={it.href}>
                <span className={styles.nm}>
                  {it.label}
                  {PAGE_COUNTS[it.key] ? (
                    <span className={styles.num}>{PAGE_COUNTS[it.key]}</span>
                  ) : null}
                </span>
                <p>{PAGE_LINES[it.key]}</p>
              </a>
            ))}
          </div>
        </section>

        <section className={`${styles.sec} ${styles.last}`}>
          <h2 className={styles.h2}>How it&apos;s built</h2>
          <div className={styles.how}>
            <div>
              <h3>Every bill, summarized</h3>
              <p>
                Each bill gets a summary written from its text, with its topics. The ceremonial
                ones, like namings, awareness designations and honoring resolutions, are tagged
                and set aside from the counts.
              </p>
            </div>
            <div>
              <h3>Six stages</h3>
              <p>
                A bill&apos;s stage is read from its latest action. The count of laws is
                checked against the official list of public laws, so a bill that became law and
                then received a committee report still counts as a law.
              </p>
              <div className={styles.stages}>
                {STAGE_TRAIL.map((s, i) => (
                  <Fragment key={s.label}>
                    {i > 0 ? <i aria-hidden>→</i> : null}
                    <span style={{ color: s.color }}>{s.label}</span>
                  </Fragment>
                ))}
              </div>
            </div>
            <div>
              <h3>Where the data comes from</h3>
              <p>
                <b>congress.gov</b> for bills, actions, members, hearings, nominations and
                amendments. <b>FRED</b> for the markets. <b>Kalshi</b> and <b>Polymarket</b> for
                the odds, never blended. <b>FEC</b> for fundraising, <b>lda.gov</b> for lobbying,{" "}
                <b>Ballotpedia</b> for ballots and incumbents, <b>The Hill</b>, <b>Politico</b>{" "}
                and <b>Roll Call</b> for news.
              </p>
            </div>
          </div>
        </section>

        {/* HO 784 (mock-784 v3): every ratings surface names its three raters,
            links each to its House page (the board mixes chambers), and says how
            old its ratings are, in --rating-freshness. */}
        <footer className={styles.foot}>
          <div className={styles.fr}>
            <span>
              <b>Congressional Terminal</b>, the {congressLabel}
            </span>
            <span className={styles.sp} />
            <span>
              Race ratings from{" "}
              {RATER_ORDER.map((s, i) => (
                <Fragment key={s}>
                  {i === 0 ? null : i === RATER_ORDER.length - 1 ? " and " : ", "}
                  <a
                    href={RACE_RATING_PAGES_2026[s]?.house}
                    title={RACE_RATING_SOURCES[s]}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {sourceLabel(s)}
                  </a>
                </Fragment>
              ))}
              {ratingsAsOf ? (
                <>
                  ,{" "}
                  <em>
                    as of <span className="whitespace-nowrap">{ratingsAsOf.from}</span>
                    {ratingsAsOf.to !== ratingsAsOf.from ? (
                      <>
                        {" to "}
                        <span className="whitespace-nowrap">{ratingsAsOf.to}</span>
                      </>
                    ) : null}
                  </em>
                </>
              ) : null}
              , via Ballotpedia
            </span>
          </div>
          <div className={styles.fr}>
            <span>
              Sources: congress.gov, FRED, Kalshi, Polymarket, FEC, lda.gov, Ballotpedia, The
              Hill, Politico, Roll Call
            </span>
            <span className={styles.sp} />
            <span>
              Synced four times a day, last at <b>{formatMt(corpus.lastSync)}</b>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
