import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTabs } from "@/components/ActivityTabs";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import { CompetitiveRacesBlock } from "@/components/CompetitiveRacesBlock";
import {
  DashboardTopicTreemap,
  type TopicDatum,
} from "@/components/DashboardTopicTreemap";
import { DashboardV2Header } from "@/components/DashboardV2Header";
import { DistributionsTabs } from "@/components/DistributionsTabs";
import { HearingsTab } from "@/components/HearingsTab";
import { NewThisWeek } from "@/components/NewThisWeek";
import { RacesBoxTabs } from "@/components/RacesBoxTabs";
import { StageFunnel } from "@/components/StageFunnel";
import { TopStalls } from "@/components/TopStalls";
import { WeeklyBand } from "@/components/WeeklyBand";
import {
  type DashboardFilters,
  getBreakingNewsForHomeCount,
  getCorpusStats,
  getNewBillsThisWeekCount,
  getPolarizationBand,
  getStageChangesCount,
  getStageDistribution,
  getTopicDistribution,
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
  searchParams: Promise<{ stage?: string; topics?: string }>;
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

  const [
    corpus,
    stageDistFull,
    stageDistFiltered,
    topicRows,
    breakingCount,
    activityCount,
    newBillsCount,
    polarization,
  ] = await Promise.all([
    getCorpusStats(true),
    getStageDistribution(undefined, true), // header segments — corpus-wide
    getStageDistribution(filters, true), // funnel — rebases on TOPIC
    getTopicDistribution(filters, true), // treemap — rebases on STAGE
    getBreakingNewsForHomeCount({ hours: 72, minConfidence: 0.7, filters }),
    getStageChangesCount({}, 7, filters),
    getNewBillsThisWeekCount(),
    getPolarizationBand(),
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
          <ActiveFilterStrip filters={filters} />

          {/* HEARINGS | RACES tabbed box (HO 270/271), hearings default. RACES
              re-houses the battlefield + cards + COMPETITIVE|PRIMARIES sub-tabs. */}
          <RacesBoxTabs
            defaultTab="hearings"
            hearingsContent={<HearingsTab />}
            racesContent={<CompetitiveRacesBlock showBattlefield variant="v2" nowMs={nowMs} />}
          />

          {/* Weekly line, divider rule above (its own border-top). HO 608 folded
              the HO 424 full-width PolarizationBand into it as three inline chips
              — the band is gone, its numbers survive in miniature (see §5 of the
              handoff; the mock overrides the backlog's flat CUT). getPolarizationBand()
              stays; /members reads the same query for its own ideology surfaces. */}
          <WeeklyBand band={polarization} />

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

            <section className="home-quadrant home-panel-distributions">
              <DistributionsTabs
                stageContent={<StageFunnel bars={stageDistFiltered.bars} />}
                topicContent={<DashboardTopicTreemap data={topicData} />}
              />
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
                <ActivityTicker variant="v2" filters={filters} nowMs={nowMs} />
              }
              stallsContent={<TopStalls variant="v2" nowMs={nowMs} />}
              newContent={<NewThisWeek variant="v2" nowMs={nowMs} />}
              activityCount={activityCount.total}
              stallsCount={TOP_STALLS_COUNT}
              newCount={newBillsCount}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
