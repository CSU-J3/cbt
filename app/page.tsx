import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AbsenceWatchBand } from "@/components/AbsenceWatchBand";
import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTabs } from "@/components/ActivityTabs";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import { CompetitiveRacesBlock } from "@/components/CompetitiveRacesBlock";
import type { TopicDatum } from "@/components/TopicDistributionList";
import { DashboardV2Header } from "@/components/DashboardV2Header";
import { HearingsTab } from "@/components/HearingsTab";
import { NewThisWeek } from "@/components/NewThisWeek";
import { RacesBoxTabs } from "@/components/RacesBoxTabs";
import { StageFunnel } from "@/components/StageFunnel";
import { TopicDistributionList } from "@/components/TopicDistributionList";
import { TopStalls } from "@/components/TopStalls";
import { WeeklyBand } from "@/components/WeeklyBand";
import {
  type DashboardFilters,
  getAbsenceWatch,
  getBreakingNewsForHomeCount,
  getCorpusStats,
  getNewBillsThisWeekCount,
  getStageChangesCount,
  getStageDistribution,
  getTopicDistribution,
  sanitizeChamber,
  sanitizeStage,
  sanitizeTopic,
} from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

const TOP_STALLS_COUNT = 5;

// Dynamic render: the dashboard reads live DB aggregates AND awaits searchParams
// for the distributions click-to-filter (below), both of which opt the route out
// of static prerender.
export const dynamic = "force-dynamic";

// HO 311 — the dashboard. This is the v2 redesign (HOs 253–310), promoted from
// the parallel `/dashboard-v2` route to `/`; `/dashboard-v2` permanently
// redirects here. The old `/` dashboard was preserved unlinked on its own
// classic route and removed at HO 608.
//
// Masthead-count decision (HO 253): every corpus count is read through the
// summary-gated predicate — the headline total, its four stage segments, and the
// body's stage + topic panels — so `/`'s "tracked" number agrees with the inner
// pages it links to (getFeedStats / buildFeedWhere also gate `summary IS NOT
// NULL`). This is intentionally the gated (~15.2k) number, not the old non-gated
// getCorpusStats (~16.2k); `/` now matches /bills and the rest.
//
// Distributions click-to-filter (HO 320, ported from the classic dashboard): the
// funnel + treemap push `?stage=` / `?topics=` and the page rebases the STAGE +
// TOPIC distributions, the MOVERS feed, and BREAKING to that slice (with
// `ActiveFilterStrip` + × CLEAR + VIEW IN /bills →). The distributions stay
// summary-gated (`true` arg) so the gated count agreement holds while filtered.
// TWO stage distributions: the header's four segments stay corpus-wide
// (`stageDistFull`); the funnel rebases (`stageDistFiltered`). The masthead total
// and TOP STALLS / NEW THIS WEEK stay corpus-wide (classic parity — those two
// feed queries don't take DashboardFilters).
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; topics?: string; chamber?: string }>;
}) {
  // HO 361 — first-touch landing gate (no middleware; A1 deliberately added none).
  // An anonymous visitor with no `ct_seen` cookie is bounced to /welcome; the
  // landing's "Enter terminal" sets that cookie (and "Sign in" gives a session),
  // so both paths return here without a loop. A returning cookie OR a session
  // renders the terminal directly.
  const [cookieStore, session] = await Promise.all([cookies(), auth()]);
  if (!cookieStore.get("ct_seen") && !session) {
    redirect("/welcome");
  }

  const sp = await searchParams;
  // HO 490: one page-computed clock threaded to every feed/news client row on
  // the dashboard so relative-age buckets match across SSR/hydration (#418).
  const nowMs = Date.now();
  const filters: DashboardFilters = {
    stage: sanitizeStage(sp.stage),
    topic: sanitizeTopic(sp.topics),
  };
  // HO 642 — the feed panel's chamber selector. THIS PARAM IS FEED-PANEL SCOPE
  // ONLY, and it is written down because a URL param that reshapes exactly one
  // panel is surprising and the next reader will otherwise "fix" it: `chamber`
  // does NOT enter DashboardFilters, does NOT touch WeeklyBand (a whole-Congress
  // week strip), and does NOT rebase BREAKING, the distributions, the masthead
  // counts or the races panel. It narrows MOVERS / TOP STALLS / NEW THIS WEEK and
  // nothing else.
  const chamber = sanitizeChamber(sp.chamber);
  // Built here (not in the client tab island) so the toggle is real navigation and
  // the state is shareable. Copied from app/bills/page.tsx's chamberHref: preserve
  // the other params, delete the key on the empty option.
  const chamberHref = (value: "" | "house" | "senate") => {
    const next = new URLSearchParams();
    if (filters.stage) next.set("stage", filters.stage);
    if (filters.topic) next.set("topics", filters.topic);
    if (value) next.set("chamber", value);
    const qs = next.toString();
    return qs ? `/?${qs}` : "/";
  };
  const CHAMBER_OPTIONS: { value: "" | "house" | "senate"; label: string }[] = [
    { value: "", label: "All" },
    { value: "house", label: "House" },
    { value: "senate", label: "Senate" },
  ];

  const [
    corpus,
    stageDistFull,
    stageDistFiltered,
    topicRows,
    breakingCount,
    activityCount,
    newBillsCount,
    absent,
  ] = await Promise.all([
    getCorpusStats(true),
    getStageDistribution(undefined, true), // header segments — corpus-wide
    getStageDistribution(filters, true), // funnel — rebases on TOPIC
    getTopicDistribution(filters, true), // treemap — rebases on STAGE
    getBreakingNewsForHomeCount({ hours: 72, minConfidence: 0.7, filters }),
    getStageChangesCount({ chamber }, 7, filters),
    getNewBillsThisWeekCount(chamber),
    getAbsenceWatch(),
  ]);

  const topicData: TopicDatum[] = topicRows.map((t) => ({
    id: t.topic,
    label: topicLabel(t.topic),
    count: t.count,
    color: topicColor(t.topic),
    fullName: topicFullLabel(t.topic),
  }));

  return (
    <div className="home-shell">
      {/* HO 608 (P3 slice 1) — the two regions of
          docs/design/dashboard-layout-target.html. The bills column runs the full
          page height from the very top, LEVEL WITH THE MASTHEAD (the arc's
          defining move); everything else — masthead, tapes, nav, hearings, week
          strip, breaking, distributions — stacks in the left region. Below
          1400px .dash-page is one column and the feed simply follows the stack.
          This slice MOVES regions; no panel's interior is redesigned (feed rows
          are HO 609, the hearings interior + packing are HO 610). */}
      <main className="home-main dash-page">
        <div className="dash-left">
          <DashboardV2Header corpus={corpus} stageDist={stageDistFull} />

          {/* Conditional chrome — renders nothing unless a filter is active, which
              is C4-compliant as-is, so it keeps its slot at the top of the left
              region even though the mock (an unfiltered snapshot) doesn't show it. */}
          <ActiveFilterStrip filters={filters} chamber={chamber} />

          {/* HO 622 — Absence Watch, the mock's slot: directly after the nav,
              above hearings. Conditional by construction — with nobody on a
              30-roll streak this renders null and the stack closes over it (C4),
              which is the good-news state, not a missing panel. */}
          <AbsenceWatchBand members={absent} nowMs={nowMs} />

          {/* HEARINGS | RACES tabbed box (HO 270/271), hearings default. RACES
              re-houses the battlefield + cards + COMPETITIVE|PRIMARIES sub-tabs. */}
          <RacesBoxTabs
            defaultTab="hearings"
            hearingsContent={<HearingsTab />}
            racesContent={<CompetitiveRacesBlock showBattlefield variant="v2" nowMs={nowMs} />}
          />

          {/* Weekly line, divider rule above (its own border-top). The HO 424
              full-width PolarizationBand was cut from `/` at HO 608, which kept its
              numbers alive as one inline chip in this strip; HO 642 cut the chip too,
              on an owner ruling that ideology belongs to /members only. So `/` no
              longer reads getPolarizationBand at all — the query itself stays, and
              /members still reads it for its own three ideology surfaces. */}
          <WeeklyBand />

          {/* The mock's .twoup — breaking BESIDE the distributions (they were
              stacked in the old left column), align-items:start. */}
          <div className="dash-twoup">
            <section className="home-quadrant home-breaking-panel">
              <p
                className="home-quadrant-label"
                title="Recent news linked to tracked bills"
              >
                Breaking · Last 72h{" "}
                <span className="home-quadrant-label-count">
                  ({breakingCount.toLocaleString()})
                </span>
              </p>
              <BreakingNewsBlock filters={filters} nowMs={nowMs} />
            </section>

            {/* HO 627 — the tabs are retired; BY STAGE and BY TOPIC are stacked
                and CO-VISIBLE, per the committed mock
                (docs/design/dashboard-layout-target.html:294-313). Shipped kept
                HO 320's tabs, so TOPIC sat behind a click and the panel rendered
                at half its designed height — one of the two causes of the dead
                space beside the feed. Mock wins, the standing precedent.
                Click-to-filter survives on BOTH halves identically (HO 56/320):
                the funnel writes ?stage=, the topic list writes ?topics=, each
                toggles, and the cross-rebase still holds — stageDistFiltered
                rebases on TOPIC and topicRows on STAGE, exactly as before. */}
            <section className="home-quadrant home-panel-distributions">
              <p className="home-quadrant-label">
                Distribution{" "}
                <span className="home-quadrant-label-count">
                  ({corpus.total.toLocaleString()} bills)
                </span>
              </p>
              <div className="dist-sub dist-sub--first">By stage</div>
              <StageFunnel bars={stageDistFiltered.bars} />
              <div className="dist-sub">By topic</div>
              <TopicDistributionList data={topicData} />
            </section>
          </div>
        </div>

        <div className="dash-bills">
          {/* home-feed-panel: overflow-visible (HO 300) so the expanded row's
              sponsor hover card can escape the quadrant's overflow:hidden. That
              is also why .dash-bills is sticky but NOT internally scrolled —
              see the CSS comment; HO 609 resolves it with the row rework. */}
          <section className="home-quadrant home-feed-panel">
            <ActivityTabs
              activityContent={
                <ActivityTicker
                  variant="v2"
                  filters={filters}
                  chamber={chamber}
                  nowMs={nowMs}
                />
              }
              stallsContent={
                <TopStalls variant="v2" chamber={chamber} nowMs={nowMs} />
              }
              newContent={
                <NewThisWeek variant="v2" chamber={chamber} nowMs={nowMs} />
              }
              // `.filtered`, not `.total`: getStageChangesCount derives `total`
              // from buildChangesWhere({}, …), which drops its own `filters` arg,
              // so a chamber passed in never reaches it. The two arms are
              // byte-identical when no chamber is set, so the unfiltered badge is
              // unchanged. Same reasoning as ActivityTicker's footer count.
              activityCount={activityCount.filtered}
              stallsCount={TOP_STALLS_COUNT}
              newCount={newBillsCount}
              filterSlot={
                <span className="feed-chamber" aria-label="Chamber">
                  {CHAMBER_OPTIONS.map((o) => (
                    <Link
                      key={o.value || "all"}
                      href={chamberHref(o.value)}
                      className={`feed-chamber-opt${
                        (chamber ?? "") === o.value ? " is-on" : ""
                      }`}
                      aria-current={
                        (chamber ?? "") === o.value ? "true" : undefined
                      }
                    >
                      {o.label}
                    </Link>
                  ))}
                </span>
              }
            />
          </section>
        </div>
      </main>
    </div>
  );
}
