import { ActiveFilterStrip } from "@/components/ActiveFilterStrip";
import { ActivityTabs } from "@/components/ActivityTabs";
import { ActivityTicker } from "@/components/ActivityTicker";
import { BreakingNewsBlock } from "@/components/BreakingNewsBlock";
import { ColorKeyStrip } from "@/components/ColorKeyStrip";
import { CompetitiveRacesBlock } from "@/components/CompetitiveRacesBlock";
import {
  type BubbleDatum,
  DashboardBubbleChart,
} from "@/components/DashboardBubbleChart";
import { HomeHeader } from "@/components/HomeHeader";
import { ReportSnapshot } from "@/components/ReportSnapshot";
import { StageFunnel } from "@/components/StageFunnel";
import { TopStalls } from "@/components/TopStalls";
import {
  type DashboardFilters,
  getBreakingNewsForHomeCount,
  getCorpusStats,
  getStageChangesCount,
  getStageDistribution,
  getTopicDistribution,
  sanitizeStage,
  sanitizeTopic,
} from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

const TOP_STALLS_COUNT = 5;

// HO 150 layout: chrome stack (masthead + tape + nav) → full-width BREAKING
// strip → two-equal-column grid (left: STAGE over TOPIC bubbles; right:
// ACTIVITY / TOP STALLS tabs) → HO 153 reports-snapshot slot (reserved,
// empty). The HO 131/133/134 three-column no-scroll grid is gone — spec 1
// preserves the answer-above-fold (masthead prose + BREAKING) but lets the
// page scroll so the bubbles can breathe at full half-width.
//
// Click-to-filter (HO 132) is unchanged: funnel bars and topic bubbles
// push ?stage= / ?topics=; ACTIVITY and BREAKING both rebase to the
// filtered slice; bubble sizes rebase when STAGE is selected; the funnel
// rebases when TOPIC is selected. Lead stays corpus-wide.
type SearchParams = {
  stage?: string;
  topics?: string;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filters: DashboardFilters = {
    stage: sanitizeStage(sp.stage),
    topic: sanitizeTopic(sp.topics),
  };

  const [breakingCount, activityCount, stageDist, topicRows, corpus] =
    await Promise.all([
      getBreakingNewsForHomeCount({
        hours: 72,
        minConfidence: 0.7,
        filters,
      }),
      getStageChangesCount({}, 7, filters),
      getStageDistribution(filters),
      getTopicDistribution(filters),
      getCorpusStats(),
    ]);

  // Topic-bubble tooltip carries percentage of the (corpus-wide,
  // non-ceremonial) total — distinct from the topic-distribution
  // query's count, which is a *tag count* (bills can have multiple
  // topics). Percentage uses corpus.total as the denominator so the
  // number reads as "share of all bills tagged with this topic."
  const corpusTotal = corpus.total;
  const topicData: BubbleDatum[] = topicRows.map((t) => {
    const pct = corpusTotal > 0 ? (t.count / corpusTotal) * 100 : 0;
    return {
      id: t.topic,
      label: topicLabel(t.topic),
      count: t.count,
      color: topicColor(t.topic),
      tooltip: `${topicFullLabel(t.topic)} · ${t.count.toLocaleString()} bills · ${pct.toFixed(1)}%`,
    };
  });

  return (
    <div className="home-shell">
      <HomeHeader />
      <ActiveFilterStrip filters={filters} />

      <main className="home-main">
        {/* Full-width BREAKING strip (HO 150) — above the two-column grid,
            no quadrant chrome; border caps flush to the row list because
            there's no flex-1 parent stretching the box. */}
        <section className="home-breaking-strip">
          <p
            className="home-quadrant-label"
            title="Recent news linked to tracked bills"
          >
            Breaking · Last 72h{" "}
            <span className="home-quadrant-label-count">
              ({breakingCount.toLocaleString()})
            </span>
          </p>
          <BreakingNewsBlock filters={filters} />
        </section>

        {/* Weekly report snapshot — moved directly under BREAKING in HO 159
            so breaking (72h) + report (7d) stack as a full-width narrative
            pair above the grid. ReportSnapshot returns null when zero
            reports exist, leaving the slot empty. */}
        <div className="home-snapshot-slot">
          <ReportSnapshot />
        </div>

        {/* HO 163: competitive-races strip — Senate-led chamber mix (top 2
            Senate + top 2 House), between the report band and the grid. */}
        <CompetitiveRacesBlock />

        <div className="home-grid">
          {/* Left column: STAGE funnel + TOPIC bubbles stacked */}
          <div className="home-col-stack">
            <section className="home-quadrant home-panel-stage">
              <p
                className="home-quadrant-label"
                title="All bills by current legislative stage"
              >
                Stage Distribution
              </p>
              <div className="home-quadrant-body">
                <StageFunnel bars={stageDist.bars} />
              </div>
            </section>

            <section className="home-quadrant home-panel-topic">
              <p
                className="home-quadrant-label"
                title="All bills by topic tag"
              >
                Topic Distribution
              </p>
              <div className="home-quadrant-body">
                <DashboardBubbleChart data={topicData} paramKey="topics" />
              </div>
            </section>
          </div>

          {/* Right column: ACTIVITY / TOP STALLS tabs */}
          <section className="home-quadrant">
            <ActivityTabs
              activityContent={<ActivityTicker filters={filters} />}
              stallsContent={<TopStalls />}
              activityCount={activityCount.total}
              stallsCount={TOP_STALLS_COUNT}
            />
          </section>
        </div>
      </main>

      {/* HO 162: STAGES + TOPICS legend relocated here from the masthead's
          boxed top-right rail. Full-width muted reference strip at the bottom
          of the scrollable page; PARTIES/BILL TYPES/ACCENT stay behind the
          header `?` badge. */}
      <footer className="home-footer">
        <ColorKeyStrip />
      </footer>
    </div>
  );
}
