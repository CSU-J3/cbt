"use client";

// HO 730: the meeting detail panel, moved VERBATIM out of HearingRow (where it was
// ExpandedPanel) so /hearings' agenda can render it in flow under an open entry.
// Its consumers: HearingRow (the /committee/[systemCode] and /bill/[id] embeds)
// and HearingsCalendar. The one addition is `variant`, which sets a class ON this
// component — `hearing-panel--agenda` carries the agenda's own indent — never an
// ancestor-scoped override (SKILL's shared-component layout rule).
import Link from "next/link";
import { BillIdChip } from "@/components/BillIdChip";
import { PartyTag } from "@/components/PartyTag";
import { StageIndicator } from "@/components/StageIndicator";
import {
  etDayLabel,
  etTimeLabel,
  locationText,
  WATCH_LABEL,
  watchState,
} from "@/lib/hearings";
import {
  hasRecordedVotes,
  recordedVotesTitle,
  repositoryEventUrl,
} from "@/lib/meeting-documents";
import type { CommitteeMeeting } from "@/lib/queries";

export function HearingPanel({
  m,
  committeeName,
  nowMs,
  variant = "row",
}: {
  m: CommitteeMeeting;
  committeeName: string | null;
  nowMs: number;
  variant?: "row" | "agenda";
}) {
  const state = watchState(m, nowMs);
  const loc = locationText(m);
  return (
    <div className={variant === "agenda" ? "hearing-panel hearing-panel--agenda" : "hearing-panel"}>
      {/* WATCH — full link + state copy */}
      {m.videoUrl && state !== "none" ? (
        <div className="hearing-panel-sec">
          <span className="hearing-panel-cap">Watch</span>
          <a
            href={m.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`hearing-panel-watch state-${state}`}
          >
            {WATCH_LABEL[state]}
            <span className="hearing-panel-watch-note">
              {state === "live"
                ? "— in session now"
                : state === "stream"
                  ? "— scheduled livestream"
                  : "— recording"}
            </span>
          </a>
        </div>
      ) : null}

      {/* RECORDED VOTES — HO 717; the ≤ 720px home of the pointer */}
      {hasRecordedVotes(m) ? (
        <div className="hearing-panel-sec">
          <span className="hearing-panel-cap">Recorded votes</span>
          <a
            href={repositoryEventUrl(m.eventId)}
            target="_blank"
            rel="noopener noreferrer"
            className="hearing-panel-link"
            title={recordedVotesTitle(m.recordedVoteDocs)}
          >
            {m.recordedVoteDocs} document{m.recordedVoteDocs === 1 ? "" : "s"} · House Committee
            Repository ↗
          </a>
        </div>
      ) : null}

      {/* BILLS COVERED · N — uncapped */}
      {m.bills.length > 0 ? (
        <div className="hearing-panel-sec">
          <span className="hearing-panel-cap">
            Bills covered · {m.bills.length}
          </span>
          <div>
            {m.bills.map((b) => (
              <div key={b.id} className="hearing-bill-line">
                <BillIdChip
                  billType={b.bill_type}
                  billNumber={b.bill_number}
                  href={`/bill/${b.id}`}
                />
                <Link href={`/bill/${b.id}`} className="bill-title truncate">
                  {b.title}
                </Link>
                <span className="bill-sponsor">
                  {b.sponsor_name ? b.sponsor_name : "—"}{" "}
                  <PartyTag party={b.sponsor_party} state={b.sponsor_state} />
                </span>
                <StageIndicator stage={b.stage} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* COMMITTEE — link via systemCode */}
      {m.committeeSystemCode ? (
        <div className="hearing-panel-sec">
          <span className="hearing-panel-cap">Committee</span>
          <Link
            href={`/committee/${m.committeeSystemCode}`}
            className="hearing-panel-link"
          >
            {committeeName ?? m.committeeSystemCode} →
          </Link>
        </div>
      ) : null}

      {/* DETAILS — raw type · status · location · date+time */}
      <div className="hearing-panel-sec">
        <span className="hearing-panel-cap">Details</span>
        <div className="hearing-panel-details">
          <span>
            <span className="k">Type</span> {m.meetingType || "—"}
          </span>
          <span>
            <span className="k">Status</span> {m.meetingStatus || "—"}
          </span>
          <span>
            <span className="k">Where</span> {loc ?? "—"}
          </span>
          <span>
            <span className="k">When</span> {etDayLabel(m.meetingDate)}{" "}
            {etTimeLabel(m.meetingDate)} ET
          </span>
        </div>
      </div>
    </div>
  );
}
