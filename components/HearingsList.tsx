"use client";

// HO 264 (Piece 1 of 5) — the grouped /hearings list with single-open
// click-to-expand rows. Server hands down the already-banded meetings, a
// systemCode→name map, and a frozen `nowMs` (so badge/watch-state/day math is
// identical on server render and client hydration — no Date.now() drift). This
// component owns only the open-row state; all derivation is the shared lib.
import { useState } from "react";
import Link from "next/link";
import { PartyTag } from "@/components/PartyTag";
import { StageIndicator } from "@/components/StageIndicator";
import {
  etDayKey,
  etDayLabel,
  etRelativeDay,
  etTimeLabel,
  hearingBadge,
  watchState,
  type WatchState,
} from "@/lib/hearings";
import { formatBillId } from "@/lib/format";
import type { CommitteeMeeting } from "@/lib/queries";

export type HearingsBand = {
  key: string;
  label: string;
  meetings: CommitteeMeeting[];
};

const BILL_CHIP_CAP = 3;

const WATCH_LABEL: Record<Exclude<WatchState, "none">, string> = {
  live: "● LIVE",
  watch: "▶ WATCH",
  stream: "STREAM ↗",
};

function chamberLabel(chamber: "house" | "senate"): string {
  return chamber === "house" ? "HOUSE" : "SENATE";
}

function locationText(m: CommitteeMeeting): string | null {
  const parts = [m.building, m.room].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function WatchCell({ m, nowMs }: { m: CommitteeMeeting; nowMs: number }) {
  const state = watchState(m, nowMs);
  if (state === "none" || !m.videoUrl) {
    return <span className="hearing-watch" aria-hidden />;
  }
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

function ExpandedPanel({
  m,
  committeeName,
  nowMs,
}: {
  m: CommitteeMeeting;
  committeeName: string | null;
  nowMs: number;
}) {
  const state = watchState(m, nowMs);
  const loc = locationText(m);
  return (
    <div className="hearing-panel">
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

      {/* BILLS COVERED · N — uncapped */}
      {m.bills.length > 0 ? (
        <div className="hearing-panel-sec">
          <span className="hearing-panel-cap">
            Bills covered · {m.bills.length}
          </span>
          <div>
            {m.bills.map((b) => (
              <div key={b.id} className="hearing-bill-line">
                <Link href={`/bill/${b.id}`} className="bill-id">
                  {formatBillId(b.bill_type, b.bill_number)}
                </Link>
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

function HearingRow({
  m,
  committeeName,
  nowMs,
  isOpen,
  onToggle,
}: {
  m: CommitteeMeeting;
  committeeName: string | null;
  nowMs: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const badge = hearingBadge(m.meetingType);
  const loc = locationText(m);
  const shown = m.bills.slice(0, BILL_CHIP_CAP);
  const moreCount = m.bills.length - shown.length;

  return (
    <li className={`hearing-row${isOpen ? " is-open" : ""}`}>
      <div
        className="hearing-row-btn"
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
          <span className="hearing-title" title={m.title}>
            {m.title || "(untitled meeting)"}
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
      </div>

      <WatchCell m={m} nowMs={nowMs} />

      {isOpen ? (
        <ExpandedPanel m={m} committeeName={committeeName} nowMs={nowMs} />
      ) : null}
    </li>
  );
}

export function HearingsList({
  bands,
  committeeNames,
  nowMs,
}: {
  bands: HearingsBand[];
  committeeNames: Record<string, string>;
  nowMs: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (bands.length === 0) {
    return <div className="hearings-empty">No meetings match these filters.</div>;
  }

  return (
    <div>
      {bands.map((band) => {
        // group this band's meetings into ET calendar days, preserving the
        // helper's date order (upcoming ASC / recent DESC) within each day.
        const days: { key: string; meetings: CommitteeMeeting[] }[] = [];
        const byKey = new Map<string, CommitteeMeeting[]>();
        for (const m of band.meetings) {
          const key = etDayKey(m.meetingDate);
          let arr = byKey.get(key);
          if (!arr) {
            arr = [];
            byKey.set(key, arr);
            days.push({ key, meetings: arr });
          }
          arr.push(m);
        }

        return (
          <section key={band.key}>
            <h2 className="hearings-band-head">
              {band.label}
              <span className="hearings-band-rule" aria-hidden />
            </h2>
            {days.map((day) => {
              const first = day.meetings[0]!;
              const rel = etRelativeDay(first.meetingDate, nowMs);
              return (
                <div key={day.key} className="hearings-list">
                  <div className="hearings-day-head">
                    <span>
                      {etDayLabel(first.meetingDate)}
                      {rel ? (
                        <>
                          {" "}
                          <span className="today">· {rel}</span>
                        </>
                      ) : null}
                    </span>
                    <span className="day-count">{day.meetings.length}</span>
                  </div>
                  <ul>
                    {day.meetings.map((m) => (
                      <HearingRow
                        key={m.eventId}
                        m={m}
                        committeeName={
                          m.committeeSystemCode
                            ? (committeeNames[m.committeeSystemCode] ?? null)
                            : null
                        }
                        nowMs={nowMs}
                        isOpen={openId === m.eventId}
                        onToggle={() =>
                          setOpenId((prev) =>
                            prev === m.eventId ? null : m.eventId,
                          )
                        }
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
