"use client";

// HO 610 — extracted VERBATIM from HearingsCalendar so the dashboard's new day
// schedule (HearingsDaySchedule, the mock's three-part hearings interior) and the
// /hearings week grid share ONE detail card rather than growing two. Nothing in
// the card's markup, positioning or copy changed in the move; the only edit is
// that `liveStatus` is now exported (HearingsCalendar's Entry still calls it).
//
// Positioning: fixed + portaled to <body>, measured in a useLayoutEffect and
// flipped/clamped against the viewport, so no ancestor overflow can clip it.
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BillIdChip } from "@/components/BillIdChip";
import {
  cleanMeetingTitle,
  dayKeyParts,
  etDayKey,
  etTimeLabel,
  LIVE_WINDOW_MS,
} from "@/lib/hearings";
import type { CommitteeMeeting } from "@/lib/queries";

export type LiveStatus = "scheduled" | "live" | "concluded";

const SUPPRESS_STATUS = new Set(["Canceled", "Postponed"]);

export function liveStatus(m: CommitteeMeeting, nowMs: number): LiveStatus {
  const start = Date.parse(m.meetingDate);
  if (Number.isNaN(start) || nowMs < start) return "scheduled";
  if (!SUPPRESS_STATUS.has(m.meetingStatus) && nowMs <= start + LIVE_WINDOW_MS)
    return "live";
  return "concluded";
}

function chamberLabel(c: "house" | "senate"): string {
  return c === "house" ? "HOUSE" : "SENATE";
}
function locationText(m: CommitteeMeeting): string | null {
  const parts = [m.building, m.room].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export function HearingDetailCard({
  m,
  committeeName,
  nowMs,
  anchor,
  onPointerEnter,
  onPointerLeave,
}: {
  m: CommitteeMeeting;
  committeeName: string | null;
  nowMs: number;
  anchor: DOMRect;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const card = el.getBoundingClientRect();
    const W = card.width || 340;
    const H = card.height;
    const gap = 8;
    const overlap = 6; // a few px under the entry so the pointer can cross in
    let left = anchor.right - overlap + gap;
    if (left + W > window.innerWidth - 8) left = anchor.left + overlap - gap - W;
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
    let top = anchor.top;
    if (top + H > window.innerHeight - 8) top = window.innerHeight - H - 8;
    top = Math.max(8, top);
    setPos({ left, top });
  }, [anchor]);

  const status = liveStatus(m, nowMs);
  const loc = locationText(m);
  const title = cleanMeetingTitle(m.title);
  const watchText = !m.videoUrl
    ? "no livestream"
    : status === "live"
      ? "live now"
      : status === "scheduled"
        ? "scheduled livestream"
        : "concluded · recording";

  const card = (
    <div
      ref={ref}
      className="hcal-card"
      role="dialog"
      style={{
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : 0,
        visibility: pos ? "visible" : "hidden",
      }}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <div className={`hcal-card-chamber chamber-${m.chamber}`}>
        {chamberLabel(m.chamber)}
      </div>
      <div className="hcal-card-title">{title || "(untitled meeting)"}</div>

      <div className="hcal-card-sec">
        <span className="hcal-card-cap">Watch</span>
        {m.videoUrl ? (
          <a
            href={m.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`hcal-card-watch status-${status}`}
          >
            {status === "live" ? "● " : ""}
            {watchText} ↗
          </a>
        ) : (
          <span className="hcal-card-watch is-none">{watchText}</span>
        )}
      </div>

      {m.committeeSystemCode ? (
        <div className="hcal-card-sec">
          <span className="hcal-card-cap">Committee</span>
          <Link
            href={`/committee/${m.committeeSystemCode}`}
            className="hcal-card-link"
          >
            {committeeName ?? m.committeeSystemCode} →
          </Link>
        </div>
      ) : null}

      <div className="hcal-card-sec">
        <span className="hcal-card-cap">Details</span>
        <div className="hcal-card-details">
          {m.meetingType ? (
            <span>
              <span className="k">Type</span> {m.meetingType}
            </span>
          ) : null}
          <span>
            <span className="k">Status</span>{" "}
            <span className={status === "live" ? "is-live" : undefined}>
              {status === "live"
                ? "Live"
                : status === "scheduled"
                  ? "Scheduled"
                  : "Concluded"}
            </span>
          </span>
          {loc ? (
            <span>
              <span className="k">Where</span> {loc}
            </span>
          ) : null}
          <span>
            <span className="k">When</span>{" "}
            {dayKeyParts(etDayKey(m.meetingDate)).dow}{" "}
            {dayKeyParts(etDayKey(m.meetingDate)).mon}{" "}
            {dayKeyParts(etDayKey(m.meetingDate)).dom} {etTimeLabel(m.meetingDate)}{" "}
            ET
          </span>
        </div>
      </div>

      {m.bills.length > 0 ? (
        <div className="hcal-card-sec">
          <span className="hcal-card-cap">Related bills · {m.bills.length}</span>
          <div className="hcal-card-bills">
            {m.bills.map((b) => (
              <div key={b.id} className="hcal-card-bill">
                <BillIdChip
                  billType={b.bill_type}
                  billNumber={b.bill_number}
                  href={`/bill/${b.id}`}
                />
                <Link href={`/bill/${b.id}`} className="hcal-card-billtitle">
                  {b.title}
                </Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(card, document.body);
}
