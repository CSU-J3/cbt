import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTabs } from "@/components/ActivityTabs";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import { CompetitiveRacesBlock } from "@/components/CompetitiveRacesBlock";
import {
  DashboardTopicTreemap,
  type TopicDatum,
} from "@/components/DashboardTopicTreemap";
import { DistributionsTabs } from "@/components/DistributionsTabs";
import { HomeHeader } from "@/components/HomeHeader";
import { NewThisWeek } from "@/components/NewThisWeek";
import { StageFunnel } from "@/components/StageFunnel";
import { TopStalls } from "@/components/TopStalls";
import { WeeklyBand } from "@/components/WeeklyBand";
import {
  type DashboardFilters,
  getBreakingNewsForHomeCount,
  getNewBillsThisWeekCount,
  getStageChangesCount,
  getStageDistribution,
  getTopicDistribution,
  sanitizeStage,
  sanitizeTopic,
} from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

const TOP_STALLS_COUNT = 5;

// HO 311: this IS the former `/` dashboard, preserved verbatim at the unlinked
// `/dashboard-classic` route for one cycle as the v2-swap comparison + no-git
// undo surface. No nav entry — reachable only by direct URL. Sunset in a later
// handoff (logged as an open loop). The ONLY change from the old `app/page.tsx`
// is `basePath="/dashboard-classic"` on the three click-to-filter components, so
// the funnel / treemap / clear rebase THIS route instead of pushing to `/` (now
// v2, which ignores the params). Everything else — the non-gated getCorpusStats
// count via HomeHeader, the filtered feed — is unchanged.
//
// Click-to-filter (HO 132) is intact: funnel bars and topic cells push
// ?stage= / ?topics= to /dashboard-classic; ACTIVITY and BREAKING rebase to the
// filtered slice; bubble sizes rebase when STAGE is selected; the funnel rebases
// when TOPIC is selected. Lead stays corpus-wide.
type SearchParams = {
  stage?: string;
  topics?: string;
};

const FILTER_BASE = "/dashboard-classic";

export default async function DashboardClassicPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  // HO 490: one page-computed clock threaded to every feed/news client row on
  // the dashboard so relative-age buckets match across SSR/hydration (#418).
  const nowMs = Date.now();
  const filters: DashboardFilters = {
    stage: sanitizeStage(sp.stage),
    topic: sanitizeTopic(sp.topics),
  };

  const [breakingCount, activityCount, newBillsCount, stageDist, topicRows] =
    await Promise.all([
      getBreakingNewsForHomeCount({
        hours: 72,
        minConfidence: 0.7,
        filters,
      }),
      getStageChangesCount({}, 7, filters),
      getNewBillsThisWeekCount(),
      // HO 382: gated (`true`) so the FILTERED distributions use the partial
      // idx_bills_summary_stage_topics (WHERE summary IS NOT NULL) — the fix for the
      // /dashboard-classic?stage=committee / ?topics= 500. Ungated, the stage/topic
      // filter row-fetched the missing fat column over the whole corpus (no partial
      // index is usable without the summary clause). The headline getCorpusStats
      // count stays NON-gated, so the classic distributions now read ~the gated
      // (summarized) corpus while its total reads the full one — a small, accepted
      // divergence on this unlinked, sunsetting route (vs. breaking `/`'s index-only
      // plan with a non-partial index).
      getStageDistribution(filters, true),
      getTopicDistribution(filters, true),
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
      <HomeHeader />
      <ActiveFilterStrip filters={filters} basePath={FILTER_BASE} />

      <main className="home-main">
        <CompetitiveRacesBlock nowMs={nowMs} />

        <WeeklyBand />

        <div className="home-grid">
          {/* LEFT column (56%) */}
          <div className="home-col-stack home-col-left">
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
                stageContent={
                  <StageFunnel bars={stageDist.bars} basePath={FILTER_BASE} />
                }
                topicContent={
                  <DashboardTopicTreemap data={topicData} basePath={FILTER_BASE} />
                }
              />
            </section>
          </div>

          {/* RIGHT column (44%) — the feed. */}
          <div className="home-col-stack home-col-right">
            <section className="home-quadrant">
              <ActivityTabs
                activityContent={<ActivityTicker filters={filters} nowMs={nowMs} />}
                stallsContent={<TopStalls nowMs={nowMs} />}
                newContent={<NewThisWeek nowMs={nowMs} />}
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
