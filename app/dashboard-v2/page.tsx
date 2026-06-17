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
import { NewThisWeek } from "@/components/NewThisWeek";
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

// Dynamic render: the dashboard reads live DB aggregates, and reused client
// blocks (StageFunnel et al.) call useSearchParams() for `/`'s click-to-filter.
// `/` is implicitly dynamic because it awaits searchParams; v2 takes none, so
// declare it — otherwise Next tries to statically prerender and the
// useSearchParams() CSR-bailout fails the build.
export const dynamic = "force-dynamic";

// HO 253 — Dashboard v2 (the approved 2-col redesign), a SEPARATE route from `/`
// so the swap is reversible. This handoff stands up the shell: the stacked
// header + two-tape (DashboardV2Header), the full-width races strip and weekly
// line, and the 49/51 two-column body. Every body block is reused unchanged from
// `/` (CompetitiveRacesBlock, WeeklyBand, BreakingNewsBlock, the merged
// distributions panel, ActivityTabs) — the battlefield timeline and rich race
// cards land in later handoffs into these same slots.
//
// Masthead-count decision (HO 253, the pin 241 flagged): v2 reads EVERY corpus
// count through the summary-gated predicate — the headline total, its four stage
// segments, and the body's stage + topic panels — so v2's "tracked" number agrees
// with the inner pages it links to (getFeedStats / buildFeedWhere also gate
// `summary IS NOT NULL`). Fetched once here, fed to both header and body, so v2
// never re-forks the number internally. `/` keeps its non-gated getCorpusStats.
//
// Static page (no click-to-filter): the only motion is the two tape strips and
// the masthead caret. So no searchParams, and the reused blocks render
// corpus-wide (no filters prop).
export default async function DashboardV2Page() {
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
        {/* Full-width races strip directly under the header. HO 254 opts the
            D↔R battlefield axis in at the top of the COMPETITIVE tab (above the
            card grid, which is unchanged). `/` leaves it off. */}
        <CompetitiveRacesBlock showBattlefield />

        {/* Weekly line, full width, divider rule above (its own border-top). */}
        <WeeklyBand />

        {/* 49/51 two-column body. LEFT: breaking over the tabbed STAGE | TOPIC
            distributions (gated). RIGHT: the feed (shared expand). */}
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
                stageContent={<StageFunnel bars={stageDist.bars} />}
                topicContent={<DashboardTopicTreemap data={topicData} />}
              />
            </section>
          </div>

          <div className="home-col-stack dv2-col-right">
            <section className="home-quadrant">
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
