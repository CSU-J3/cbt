"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { BillIdRail } from "@/components/BillIdRail";
import { PartyTag } from "@/components/PartyTag";
import { SponsorHoverName } from "@/components/SponsorHoverName";
import { StagePillStrip } from "@/components/StagePillStrip";
import { TopicChips } from "@/components/TopicChips";
import { WatchStar } from "@/components/WatchStar";
import { daysSince, parseTopics } from "@/lib/format";
import type { FeedBill } from "@/lib/queries";

type DaysSinceMode = "staleness" | "desk-time";

// HO 618 — THE PARTY-RED AGE HEAT DIES HERE. `--party-republican` was painting
// staleness and desk-time overrun; the oddity was filed at HO 610 and the SKILL
// party rule has forbidden it since — a party token carries party, so a red
// number reads Republican before it reads old.
//
// The two modes get different answers because they mean different things.
// STALENESS is not an alarm: on the route whose entire premise is staleness,
// per-row red is noise, and the number plus the oldest-first sort already carry
// it. It renders flat now, and dim comes from the row rather than from here.
// DESK-TIME is a real threshold — past 10 days a bill has outrun the
// constitutional veto clock — so it keeps a hot end, on amber, which is this
// app's urgency colour and not anybody's party.
function daysSinceColor(days: number, mode: DaysSinceMode): string | undefined {
  if (mode === "desk-time") {
    if (days >= 10) return "var(--accent-amber-bright)";
    if (days >= 5) return "var(--accent-amber)";
    return undefined;
  }
  return undefined;
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
          {/* HO 613: the expand caret LEADS, was on `margin-left: auto`. It is
              the same defect as the star one level deeper — an affordance pinned
              to the right edge of row-meta, ~1,900px from the content on a short
              row — and the same fix, matching the leading caret on .mc-row and
              the v2 feed rows. */}
          {expandable ? (
            <span
              className={`row-chevron${isOpen ? " is-open" : ""}`}
              aria-hidden
            >
              ▸
            </span>
          ) : null}
          {sponsorBlock}
          {/* HO 613: the press count was a fixed 40px column pinned at the row's
              right edge; it is DATA, and row-meta is where the row's data lives.
              Plain text, not a link — row-meta sits inside the row's navigable
              shell, and a nested anchor there is invalid HTML on the compact
              <Link> path (the exact reason HO 130 put it outside). /news?bill=
              stays reachable from the expanded panel's RELATED NEWS. */}
          {(bill.mentionCount7d ?? 0) > 0 ? (
            <span
              className="row-media-meta"
              title={`${bill.mentionCount7d} news mention${bill.mentionCount7d === 1 ? "" : "s"}, last 7 days`}
            >
              <span aria-hidden>⚡</span>
              <span className="tabular-nums">{bill.mentionCount7d}</span>
            </span>
          ) : null}
          {topics.length > 0 ? (
            <span className="inline-flex">
              {/* HO 619 — plain on EVERY BillRow surface, not just /stale. The
                  chip rule decides by function, and these chips have none: the
                  probe walked every one on all nine BillRow surfaces and found
                  0 that are a link, a button, or a filter. They are spans inside
                  a Tooltip — a label with a hover gloss. The `showMomentum` gate
                  HO 618 shipped made the dress depend on which ROUTE was
                  rendering rather than on what the chip does, which is the
                  divergence this commit removes. */}
              <TopicChips topics={topics} responsive plain />
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
      {/* HO 613 (C1): the star LEADS. It was a fixed 36px column at the row's
          right edge, so a short row put ~1,900px between its content and its
          only affordance. A leading star is a stable click target on every row
          and needs no exemption — the HO 609 caret precedent: far-right
          affordances reposition, they do not get carved out. */}
      <span className="row-star">
        <WatchStar
          billId={bill.id}
          initial={onWatchlist}
          size={compact ? "sm" : "md"}
        />
      </span>

      {navigableShell}

      {support ? (
        <span className="row-momentum">
          <span className={`row-support ${support.cls}`}>{support.text}</span>
          {/* HO 618 (C4) — the slot renders only when it has a badge. It was a
              52px RESERVED EMPTY box on 45 of /stale's 50 rows (HEARD shows on
              5), and with the flex gap and the days-since column's own
              right-alignment slack it opened a uniform 121px gap — one pixel
              over threshold, on every row, which was the whole of /stale's M1.
              Reserving it bought nothing: the badge is right-aligned against
              the age column either way. */}
          {bill.heard ? (
            <span className="row-hslot">
              <span className="heard-badge">HEARD</span>
            </span>
          ) : null}
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

      {expandable && isOpen ? expandedPanel : null}
    </li>
  );
}
