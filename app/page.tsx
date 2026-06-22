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
  getBreakingNewsForHomeCount,
  getCorpusStats,
  getNewBillsThisWeekCount,
  getStageChangesCount,
  getStageDistribution,
  getTopicDistribution,
} from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

const TOP_STALLS_COUNT = 5;

// Dynamic render: the dashboard reads live DB aggregates, and the reused
// distribution blocks (StageFunnel / DashboardTopicTreemap) call
// useSearchParams() even in staticMode, so declare dynamic — otherwise Next
// tries to statically prerender and the useSearchParams() CSR-bailout fails the
// build. (The page itself takes no searchParams.)
export const dynamic = "force-dynamic";

// HO 311 — the dashboard. This is the v2 redesign (HOs 253–310), promoted from
// the parallel `/dashboard-v2` route to `/`. The old `/` dashboard is preserved
// unlinked at `/dashboard-classic`; `/dashboard-v2` now permanently redirects
// here.
//
// Masthead-count decision (HO 253): every corpus count is read through the
// summary-gated predicate — the headline total, its four stage segments, and the
// body's stage + topic panels — so `/`'s "tracked" number agrees with the inner
// pages it links to (getFeedStats / buildFeedWhere also gate `summary IS NOT
// NULL`). Fetched once here, fed to both header and body. This is intentionally
// the gated (~15.2k) number, not the old non-gated getCorpusStats (~16.2k); `/`
// now matches /bills and the rest.
//
// Static distributions (HO 311 swap decision): the page takes no searchParams,
// so the funnel + treemap render in `staticMode` — a clean non-interactive chart
// (no router.push, no ?stage=/?topics= written, no selected/dimmed state). The
// old `/`'s click-to-filter lives on at /dashboard-classic; porting it into this
// composition is a future handoff (open loop).
export default async function DashboardPage() {
  const [
    corpus,
    stageDist,
    topicRows,
    breakingCount,
    activityCount,
    newBillsCount,
  ] = await Promise.all([
    getCorpusStats(true),
    getStageDistribution(undefined, true),
    getTopicDistribution(undefined, true),
    getBreakingNewsForHomeCount({ hours: 72, minConfidence: 0.7 }),
    getStageChangesCount({}, 7),
    getNewBillsThisWeekCount(),
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
      <DashboardV2Header corpus={corpus} stageDist={stageDist} />

      <main className="home-main">
        {/* HEARINGS | RACES tabbed box (HO 270/271), hearings default. RACES
            re-houses the battlefield + cards + COMPETITIVE|PRIMARIES sub-tabs. */}
        <RacesBoxTabs
          defaultTab="hearings"
          hearingsContent={<HearingsTab />}
          racesContent={<CompetitiveRacesBlock showBattlefield variant="v2" />}
        />

        {/* Weekly line, full width, divider rule above (its own border-top). */}
        <WeeklyBand />

        {/* 49/51 two-column body. LEFT: breaking over the tabbed STAGE | TOPIC
            distributions (gated, static). RIGHT: the feed (shared expand). */}
        <div className="dv2-grid">
          <div className="home-col-stack dv2-col-left">
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
              <BreakingNewsBlock />
            </section>

            <section className="home-quadrant home-panel-distributions">
              <DistributionsTabs
                stageContent={<StageFunnel bars={stageDist.bars} staticMode />}
                topicContent={
                  <DashboardTopicTreemap data={topicData} staticMode />
                }
              />
            </section>
          </div>

          <div className="home-col-stack dv2-col-right">
            {/* home-feed-panel: overflow-visible (HO 300) so the expanded row's
                sponsor hover card can escape the quadrant's overflow:hidden. */}
            <section className="home-quadrant home-feed-panel">
              <ActivityTabs
                activityContent={<ActivityTicker variant="v2" />}
                stallsContent={<TopStalls variant="v2" />}
                newContent={<NewThisWeek variant="v2" />}
                activityCount={activityCount.total}
                stallsCount={TOP_STALLS_COUNT}
                newCount={newBillsCount}
              />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
