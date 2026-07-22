"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { BillIdRail } from "@/components/BillIdRail";
import { MediaAttentionCell } from "@/components/MediaAttentionCell";
import { PartyTag } from "@/components/PartyTag";
import { SponsorHoverName } from "@/components/SponsorHoverName";
import { StagePillStrip } from "@/components/StagePillStrip";
import { TopicChips } from "@/components/TopicChips";
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

// HO 371 — /stale momentum overlay. The cosponsor support figure, banded by the
// tuned live-distribution thresholds (n=515 non-null: p75=12, p90=32). high lands
// ≈ top 11%. NULL renders an em-dash (not stored), not the 0-cosponsor value.
function supportFigure(count: number | null | undefined): {
  cls: "high" | "mid" | "low" | "nul";
  text: string;
} {
  if (count == null) return { cls: "nul", text: "—" };
  if (count >= 30) return { cls: "high", text: `+${count}` };
  if (count >= 10) return { cls: "mid", text: `+${count}` };
  return { cls: "low", text: `+${count}` };
}

// HO 148 — when an `onToggle` callback is provided (rows wrapped in
// BillRowList), the rail+content becomes a div-role-button click target
// that fires `onToggle` and the row renders `expandedPanel` below itself
// inside the same <li>. When no callback (compact rows on the ticker,
// search results, committee detail, patterns drilldown), the original HO
// 125 + HO 127 shape is preserved: outer <Link> for navigation, star and
// media-attention as right-edge siblings. HO 148 also drops the inline
// summary and "View detail →" text from every full-row consumer; the
// summary moves into the expanded panel, navigation moves to the panel's
// `full bill page →` chip.
//
// HO 164 — expandability no longer excludes compact rows: a compact row that
// IS given `onToggle` (dashboard ACTIVITY via `<BillRowList compact />`) now
// expands like a full row. Compact callers that pass no `onToggle` (search,
// committee, patterns) are unaffected and stay link-only.
export function BillRow({
  bill,
  nowMs,
  daysSinceMode,
  compact = false,
  showMomentum = false,
  onWatchlist = false,
  isOpen = false,
  onToggle,
  expandedPanel,
}: {
  bill: FeedBill;
  // HO 490: page-computed clock for the stage-pill ages + days-since cell, so
  // SSR and hydration bucket identically (this is a client component).
  nowMs: number;
  daysSinceMode?: DaysSinceMode;
  compact?: boolean;
  // HO 371: /stale-only momentum overlay (see BillRowList). Adds the line-1
  // support figure + HEARD slot before the age cell; gated so it never leaks to
  // the other shared BillRow surfaces.
  showMomentum?: boolean;
  onWatchlist?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  expandedPanel?: ReactNode;
}) {
  const topics = parseTopics(bill.topics);
  const href = `/bill/${bill.id}`;
  const expandable = typeof onToggle === "function";

  const partyState =
    bill.sponsor_party || bill.sponsor_state ? (
      <PartyTag party={bill.sponsor_party} state={bill.sponsor_state} />
    ) : null;

  // HO 192: on expandable rows (the /bills accordion is a div role=button, so
  // a nested member <a> is valid) the short sponsor name gets the same
  // highlight + hover card as the expanded panel. Link-only/compact rows wrap
  // the whole row in a real <Link>, where a nested anchor is invalid HTML — and
  // those feeds don't SELECT the bioguide/photo anyway — so they keep plain
  // text. The card content is full-name regardless of the short trigger.
  const sponsorShort = shortSponsor(bill.sponsor_name);
  const sponsorBlock = bill.sponsor_name ? (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      {expandable && bill.sponsor_bioguide_id ? (
        <SponsorHoverName
          bill={bill}
          label={sponsorShort}
          anchorClassName="bill-expanded-link truncate"
        />
      ) : (
        <span className="truncate" style={{ color: "var(--text-muted)" }}>
          {sponsorShort}
        </span>
      )}
      {partyState}
    </span>
  ) : null;

  const rowClass = [
    "feed-row",
    daysSinceMode ? "has-days-since" : "",
    showMomentum ? "has-momentum" : "",
    compact ? "feed-row--compact" : "",
    expandable ? "feed-row--expandable" : "",
    isOpen ? "is-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // HO 371: collapsed-row momentum cluster — support figure + reserved HEARD slot
  // (always 52px so rows with/without the badge stay column-aligned). Renders
  // before the age cell; /stale-only.
  const support = showMomentum ? supportFigure(bill.cosponsor_count) : null;

  const inner = (
    <>
      <BillIdRail
        billType={bill.bill_type}
        billNumber={bill.bill_number}
        tooltip={bill.title}
      />

      <span className="row-content">
        <span className="row-title">{bill.title}</span>

        <StagePillStrip
          stage={bill.stage}
          introducedDate={bill.introduced_date}
          stageChangedAt={bill.stage_changed_at ?? null}
          nowMs={nowMs}
        />

        <span className="row-meta">
          {sponsorBlock}
          {topics.length > 0 ? (
            <span className="inline-flex">
              <TopicChips topics={topics} responsive />
            </span>
          ) : null}
          {expandable ? (
            <span
              className={`row-chevron${isOpen ? " is-open" : ""}`}
              aria-hidden
            >
              ▸
            </span>
          ) : null}
        </span>
      </span>
    </>
  );

  // Compact and non-expandable rows keep the HO 125 navigable <Link>. Full
  // rows wired into BillRowList become a div-role-button — navigation moves
  // to the panel's `full bill page →` chip.
  const navigableShell = expandable ? (
    <div
      className="feed-row-link feed-row-link--button"
      role="button"
      tabIndex={0}
      aria-expanded={isOpen}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle?.();
        }
      }}
    >
      {inner}
    </div>
  ) : (
    <Link href={href} prefetch={false} className="feed-row-link">
      {inner}
    </Link>
  );

  return (
    <li className={rowClass}>
      {navigableShell}

      {support ? (
        <span className="row-momentum">
          <span className={`row-support ${support.cls}`}>{support.text}</span>
          <span className="row-hslot">
            {bill.heard ? <span className="heard-badge">HEARD</span> : null}
          </span>
        </span>
      ) : null}

      {daysSinceMode ? (
        <span
          className="row-days-since"
          style={{
            color: bill.latest_action_date
              ? daysSinceColor(
                  daysSince(bill.latest_action_date, nowMs),
                  daysSinceMode,
                )
              : "var(--text-dim)",
          }}
        >
          {bill.latest_action_date
            ? `${daysSince(bill.latest_action_date, nowMs)}d`
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

      {expandable && isOpen ? expandedPanel : null}
    </li>
  );
}
