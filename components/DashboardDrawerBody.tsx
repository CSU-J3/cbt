import Link from "next/link";
import { BillRow } from "@/components/BillRow";
import { STAGE_LABELS, type Stage, type Topic } from "@/lib/enums";
import {
  getDashboardDrawerBills,
  getWatchedBillIds,
} from "@/lib/queries";
import { topicFullLabel } from "@/lib/topic-colors";

// Short uppercase stage label matching the bubble form (COMMITTEE,
// OTHER CHAMBER, etc.) — STAGE_LABELS is descriptive prose ("In
// committee; under review") which is too long for a chip.
function stageChipLabel(stage: Stage): string {
  return stage.replace(/_/g, " ").toUpperCase();
}

// HO 132.1 drawer body. Server component fed the dashboard's
// single-topic filter shape; queried via getDashboardDrawerBills
// (thin wrapper over getFeedBills, capped at 10 rows). Rendered as
// `children` of the client DashboardBillsDrawer so the data fetch
// stays server-side and re-runs on URL change via the standard App
// Router flow — no Suspense, no client fetch.
const DRAWER_LIMIT = 10;

export async function DashboardDrawerBody({
  stage,
  topic,
}: {
  stage?: Stage;
  topic?: Topic;
}) {
  const [{ bills, total }, watchedIds] = await Promise.all([
    getDashboardDrawerBills({ stage, topic }, DRAWER_LIMIT),
    getWatchedBillIds(),
  ]);
  const watchedSet = new Set(watchedIds);

  const feedParams = new URLSearchParams();
  if (stage) feedParams.set("stage", stage);
  if (topic) feedParams.set("topics", topic);
  const feedHref = `/feed?${feedParams.toString()}`;

  // Per-dimension clear hrefs preserve the OTHER param. Used by the
  // chip × buttons in the header.
  const clearStageParams = new URLSearchParams();
  if (topic) clearStageParams.set("topics", topic);
  const clearStageHref = clearStageParams.toString()
    ? `/?${clearStageParams.toString()}`
    : "/";

  const clearTopicParams = new URLSearchParams();
  if (stage) clearTopicParams.set("stage", stage);
  const clearTopicHref = clearTopicParams.toString()
    ? `/?${clearTopicParams.toString()}`
    : "/";

  return (
    <>
      <div className="bills-drawer-chips">
        {stage ? (
          <span className="bills-drawer-chip" title={STAGE_LABELS[stage]}>
            <span className="bills-drawer-chip-key">Stage</span>
            <span className="bills-drawer-chip-value">
              {stageChipLabel(stage)}
            </span>
            <Link
              href={clearStageHref}
              scroll={false}
              className="bills-drawer-chip-clear"
              aria-label={`Clear stage filter (${stageChipLabel(stage)})`}
            >
              ×
            </Link>
          </span>
        ) : null}
        {topic ? (
          <span className="bills-drawer-chip">
            <span className="bills-drawer-chip-key">Topic</span>
            <span className="bills-drawer-chip-value">
              {topicFullLabel(topic)}
            </span>
            <Link
              href={clearTopicHref}
              scroll={false}
              className="bills-drawer-chip-clear"
              aria-label={`Clear topic filter (${topicFullLabel(topic)})`}
            >
              ×
            </Link>
          </span>
        ) : null}
      </div>

      <div className="bills-drawer-meta">
        <span className="bills-drawer-count">
          {total.toLocaleString()} {total === 1 ? "bill" : "bills"}
        </span>
        <Link
          href={feedHref}
          className="bills-drawer-feed-link"
          scroll={false}
        >
          View in /feed →
        </Link>
      </div>

      {bills.length === 0 ? (
        <p className="bills-drawer-empty">No bills match this filter.</p>
      ) : (
        <ul className="bills-drawer-list">
          {bills.map((b) => (
            <BillRow
              key={b.id}
              bill={b}
              compact
              onWatchlist={watchedSet.has(b.id)}
            />
          ))}
        </ul>
      )}

      {bills.length > 0 ? (
        <Link href={feedHref} className="home-expander">
          [ View all {total.toLocaleString()} in /feed → ]
        </Link>
      ) : null}
    </>
  );
}
