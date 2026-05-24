import Link from "next/link";
import { BillIdRail } from "@/components/BillIdRail";
import { MediaAttentionCell } from "@/components/MediaAttentionCell";
import { PartyTag } from "@/components/PartyTag";
import { StagePillStrip } from "@/components/StagePillStrip";
import { TopicTags } from "@/components/TopicTags";
import { WatchStar } from "@/components/WatchStar";
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

// HO 125 redesign + HO 127 row-level watch star. The outer <li> is the grid
// container so the WatchStar can live as a sibling of the navigable Link
// — putting a <button> inside an <a> would be invalid HTML and break
// keyboard semantics. The Link covers rail + content (everything that
// navigates to /bill/[id]); the star and the optional days-since slot
// each occupy their own grid cell to the right.
//
// `daysSinceMode` is honored by /stale and /president — adds a right-edge
// column with the colored days-since metric. `compact` is opt-in for
// ActivityTicker — slimmer rail, no inline summary, no View Detail span,
// smaller star. `onWatchlist` carries the membership read from the page
// (see getWatchedBillIds in lib/queries.ts) so initial render shows the
// right ★/☆ without per-row server fetches.
export function BillRow({
  bill,
  daysSinceMode,
  compact = false,
  onWatchlist = false,
}: {
  bill: FeedBill;
  daysSinceMode?: DaysSinceMode;
  compact?: boolean;
  onWatchlist?: boolean;
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
    <li className={rowClass}>
      <Link href={href} prefetch={false} className="feed-row-link">
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
      </Link>

      {daysSinceMode ? (
        <span
          className="row-days-since"
          style={{
            color: bill.latest_action_date
              ? daysSinceColor(daysSince(bill.latest_action_date), daysSinceMode)
              : "var(--text-dim)",
          }}
        >
          {bill.latest_action_date
            ? `${daysSince(bill.latest_action_date)}d`
            : "—"}
        </span>
      ) : null}

      <MediaAttentionCell
        billId={bill.id}
        count={bill.mentionCount7d ?? 0}
      />

      <span className="row-star">
        <WatchStar
          billId={bill.id}
          initial={onWatchlist}
          size={compact ? "sm" : "md"}
        />
      </span>
    </li>
  );
}
