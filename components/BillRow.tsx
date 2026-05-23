import Link from "next/link";
import { BillIdRail } from "@/components/BillIdRail";
import { PartyTag } from "@/components/PartyTag";
import { StagePillStrip } from "@/components/StagePillStrip";
import { TopicTags } from "@/components/TopicTags";
import { daysSince, parseTopics } from "@/lib/format";
import type { FeedBill } from "@/lib/queries";

type DaysSinceMode = "staleness" | "desk-time";

function daysSinceColor(days: number, mode: DaysSinceMode): string {
  if (mode === "desk-time") {
    if (days >= 10) return "var(--party-republican)";
    if (days >= 5) return "var(--accent-amber)";
    return "var(--text-secondary)";
  }
  if (days >= 365) return "var(--party-republican)";
  if (days >= 180) return "var(--accent-amber)";
  return "var(--text-secondary)";
}

function shortSponsor(name: string | null): string {
  if (!name) return "";
  const noPrefix = name.replace(/^(Rep\.|Sen\.|Del\.|Res\.)\s*/i, "").trim();
  const lastName = noPrefix.split(",")[0]?.trim();
  return lastName ?? noPrefix;
}

// HO 125 redesign. Replaces the prior horizontal `[expand-arrow] [HR 1234]
// [title/sponsor] [stage] [date] [topics]` grid with a vertical rail + a
// stacked content column (title → summary excerpt → stage strip → meta
// strip). Expand-to-reveal is gone; the whole row links straight to
// /bill/[id], and the inline summary excerpt absorbs the fast-scan
// workflow the expanded panel used to handle.
//
// `daysSinceMode` is still honored by /stale and /president — adds a right-
// edge column with the colored days-since metric. The `showStageTransition`
// prop is gone: the StagePillStrip is now always rendered, and it shows
// the transition narrative inherently.
//
// `compact` is opt-in for ActivityTicker — slimmer rail, no inline summary,
// no View Detail span. Pass it from the dashboard center pane only.
export function BillRow({
  bill,
  daysSinceMode,
  compact = false,
}: {
  bill: FeedBill;
  daysSinceMode?: DaysSinceMode;
  compact?: boolean;
}) {
  const topics = parseTopics(bill.topics);
  const href = `/bill/${bill.id}`;

  const partyState =
    bill.sponsor_party || bill.sponsor_state ? (
      <PartyTag party={bill.sponsor_party} state={bill.sponsor_state} />
    ) : null;

  const sponsorBlock = bill.sponsor_name ? (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="truncate" style={{ color: "var(--text-muted)" }}>
        {shortSponsor(bill.sponsor_name)}
      </span>
      {partyState}
    </span>
  ) : null;

  const rowClass = [
    "feed-row",
    daysSinceMode ? "has-days-since" : "",
    compact ? "feed-row--compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className={rowClass}
      >
        <BillIdRail
          billType={bill.bill_type}
          billNumber={bill.bill_number}
        />

        <span className="row-content">
          <span className="row-title">{bill.title}</span>

          {!compact && bill.summary ? (
            <span className="row-summary">{bill.summary}</span>
          ) : null}

          <StagePillStrip
            stage={bill.stage}
            introducedDate={bill.introduced_date}
            stageChangedAt={bill.stage_changed_at ?? null}
          />

          <span className="row-meta">
            {sponsorBlock}
            {topics.length > 0 ? (
              <span className="inline-flex">
                <TopicTags topics={topics} responsive />
              </span>
            ) : null}
            {compact ? null : (
              <span className="row-view-detail">View detail →</span>
            )}
          </span>
        </span>

        {daysSinceMode && bill.latest_action_date ? (
          <span
            className="row-days-since"
            style={{
              color: daysSinceColor(
                daysSince(bill.latest_action_date),
                daysSinceMode,
              ),
            }}
          >
            {daysSince(bill.latest_action_date)}d
          </span>
        ) : daysSinceMode ? (
          <span
            className="row-days-since"
            style={{ color: "var(--text-dim)" }}
          >
            —
          </span>
        ) : null}
      </Link>
    </li>
  );
}
