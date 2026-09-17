"use client";

// HO 264 → 267: the single hearings meeting row (collapsed grid + click-to-
// expand panel), extracted from HearingsList so the Piece 4 secondary cuts
// (committee detail + bill hub) reuse it EXACTLY — no new treatment. The parent
// owns single-open state and passes isOpen/onToggle; this file owns the row
// markup and the watch cell. The expanded panel moved to HearingPanel at HO 730,
// so /hearings' agenda renders the same one.
//
// `hideBills` (HO 267) drops the collapsed bill-chip column for the bill-hub cut
// — there the bill is the current bill, so the chips are noise. The expanded
// panel's BILLS COVERED section is unaffected (a hearing can cover other bills).
import { HearingPanel } from "@/components/HearingPanel";
import {
  cleanMeetingTitle,
  etTimeLabel,
  hearingBadge,
  locationText,
  WATCH_LABEL,
  watchState,
} from "@/lib/hearings";
import { formatBillId } from "@/lib/format";
import {
  hasRecordedVotes,
  recordedVotesTitle,
  repositoryEventUrl,
} from "@/lib/meeting-documents";
import type { CommitteeMeeting } from "@/lib/queries";

const BILL_CHIP_CAP = 3;

function chamberLabel(chamber: "house" | "senate"): string {
  return chamber === "house" ? "HOUSE" : "SENATE";
}

function WatchCell({ m, nowMs }: { m: CommitteeMeeting; nowMs: number }) {
  const state = watchState(m, nowMs);
  // HO 617 (C4) — render NOTHING, not an empty cell. `.hearing-watch` carries
  // `padding: 8px 12px`, so a meeting with no video reserved a 24x62px empty box
  // on every such row: 10 of them on one committee page, 620px of the route's
  // 662px of M4. The row is `minmax(0,1fr) auto` and each <li> is its own grid,
  // so with one child the auto track is zero and the content simply spans.
  if (state === "none" || !m.videoUrl) return null;
  return (
    <a
      href={m.videoUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`hearing-watch state-${state}`}
      // stop the row toggle from also firing when the watch link is clicked
      onClick={(e) => e.stopPropagation()}
    >
      {WATCH_LABEL[state]}
    </a>
  );
}

// HO 717: the recorded-vote pointer. House meetings only, rendered only when the
// meeting carries at least one recorded-vote document — absence is the signal. It
// is a SIBLING of WatchCell rather than a wrapper around it, so a row with no votes
// renders byte-identically to before and WATCH's markup never moves; the stacking
// under WATCH is CSS (`.hearing-row:has(> .hearing-votes)`, globals.css).
// Two labels, one link: the full `RECORDED VOTES · n ↗` above 720px, and at ≤ 720px
// a bare `↗ n` that shows only when it can stack under a WATCH link already in the
// slot (so it adds no width to the row's auto track); with no WATCH at that width it
// is hidden and the expanded panel carries the pointer.
function VotesCell({ m }: { m: CommitteeMeeting }) {
  if (!hasRecordedVotes(m)) return null;
  const n = m.recordedVoteDocs;
  return (
    <a
      href={repositoryEventUrl(m.eventId)}
      target="_blank"
      rel="noopener noreferrer"
      className="hearing-votes"
      title={recordedVotesTitle(n)}
      aria-label={`Recorded votes: ${n} document${n === 1 ? "" : "s"} in the House Committee Repository`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="hearing-votes-full" aria-hidden>
        RECORDED VOTES · {n} ↗
      </span>
      <span className="hearing-votes-mini" aria-hidden>
        ↗ {n}
      </span>
    </a>
  );
}

export function HearingRow({
  m,
  committeeName,
  nowMs,
  isOpen,
  onToggle,
  hideBills = false,
}: {
  m: CommitteeMeeting;
  committeeName: string | null;
  nowMs: number;
  isOpen: boolean;
  onToggle: () => void;
  hideBills?: boolean;
}) {
  const badge = hearingBadge(m.meetingType);
  const loc = locationText(m);
  const title = cleanMeetingTitle(m.title);
  const shown = m.bills.slice(0, BILL_CHIP_CAP);
  const moreCount = m.bills.length - shown.length;

  return (
    <li className={`hearing-row${isOpen ? " is-open" : ""}`}>
      <div
        className={`hearing-row-btn${hideBills ? " hearing-row-btn--nobills" : ""}`}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className={`hearing-caret${isOpen ? " is-open" : ""}`} aria-hidden>
          ▸
        </span>
        <span className="hearing-time">{etTimeLabel(m.meetingDate)}</span>
        <span
          className={`hearing-type${badge === "MARKUP" ? " is-markup" : ""}`}
        >
          {badge}
        </span>
        <span className="hearing-main">
          <span className="hearing-title" title={title}>
            {title || "(untitled meeting)"}
          </span>
          <span className="hearing-meta">
            <span className={m.chamber === "house" ? "chamber-h" : "chamber-s"}>
              {chamberLabel(m.chamber)}
            </span>
            {committeeName ? (
              <>
                <span className="sep" aria-hidden>
                  ·
                </span>
                <span>{committeeName}</span>
              </>
            ) : null}
            {loc ? (
              <>
                <span className="sep" aria-hidden>
                  ·
                </span>
                <span>{loc}</span>
              </>
            ) : null}
          </span>
        </span>
        {hideBills ? null : (
          <span className="hearing-bills">
            {shown.map((b) => (
              <span key={b.id} className="hearing-chip">
                {formatBillId(b.bill_type, b.bill_number)}
              </span>
            ))}
            {moreCount > 0 ? (
              <span className="hearing-bills-more">·{moreCount} more</span>
            ) : null}
          </span>
        )}
      </div>

      <WatchCell m={m} nowMs={nowMs} />
      <VotesCell m={m} />

      {isOpen ? (
        <HearingPanel m={m} committeeName={committeeName} nowMs={nowMs} />
      ) : null}
    </li>
  );
}
