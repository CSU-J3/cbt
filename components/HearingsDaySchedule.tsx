"use client";

// HO 610 (P3 slice 3) — the dashboard HEARINGS tab's interior, per the mock's
// three-part hearings block (docs/design/dashboard-layout-target.html: `.hbar` /
// `.rib` / `.sched-wrap`). REPLACES the five-column week grid (the shared
// HearingsCalendar in its now-removed `embedded` mode), which spent ~475px on
// five equal columns whose empty days each reserved a 358px "No meetings" box —
// the two standing M4 blocks and all three M2 stretched-panel hits on `/`.
//
// The three parts:
//   .hsch-bar   — TODAY · WED AUG 6 · 5 SCHEDULED. When today has nothing it
//                 shows the next day that does (NEXT · MON AUG 10 · 3 SCHEDULED);
//                 it never shows an empty day.
//   .hsch-rib   — the week ribbon: five compact MON..FRI cells, `—` for an empty
//                 day, a bold count for a scheduled one, `on` marking the shown
//                 day, then `N THIS WEEK ▼d` as the trailing total. C4: ONE dash
//                 in a ribbon is the entire footprint an empty day gets.
//   .hsch-wrap  — the SHOWN DAY's schedule only. One column, two at >=1700px
//                 with a soft divider. Past rows dim to 0.42; when the shown day
//                 is today a thin now-marker sits between past and upcoming.
//
// Recess behaviour is the C4 point: a week with nothing renders the bar (pointing
// into next week if that is where the next meeting is), a ribbon of dashes, and
// one dim line — no grid, no reserved box.
//
// Data is exactly what fed the grid (getUpcomingMeetings + getRecentMeetings), so
// no query changed; the next-day-with-meetings lookahead reads the upcoming set
// the accessor already returns (~2 weeks ahead, HO 261).
//
// The per-meeting detail (watch link, committee, related bills) is the SHARED
// HearingDetailCard, extracted from HearingsCalendar in this same commit so the
// two surfaces cannot drift.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  HearingDetailCard,
  liveStatus,
} from "@/components/HearingDetailCard";
import {
  addDaysToKey,
  cleanMeetingTitle,
  dayKeyParts,
  etDayKey,
  etTimeLabel,
  etTodayKey,
  hearingBadge,
  mondayOfKey,
} from "@/lib/hearings";
import type { CommitteeMeeting } from "@/lib/queries";

// Two columns at >=1700px (the mock's `.sched-wrap` breakpoint); below that the
// shown day is one column and this is never consulted.
const SPLIT_MIN_ROWS = 6;

function SchedRow({
  m,
  nowMs,
  onOpen,
  onLeave,
}: {
  m: CommitteeMeeting;
  nowMs: number;
  onOpen: (m: CommitteeMeeting, rect: DOMRect) => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const badge = hearingBadge(m.meetingType);
  const status = liveStatus(m, nowMs);
  const title = cleanMeetingTitle(m.title);
  const n = m.bills.length;
  const open = useCallback(() => {
    const el = ref.current;
    if (el) onOpen(m, el.getBoundingClientRect());
  }, [m, onOpen]);

  return (
    <div
      ref={ref}
      className={`hsch-row${status === "concluded" ? " is-past" : ""}${
        badge === "MARKUP" ? " is-markup" : ""
      }`}
      role="button"
      tabIndex={0}
      onMouseEnter={open}
      onMouseLeave={onLeave}
      onClick={open}
      onFocus={open}
      onBlur={onLeave}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
    >
      <span className="hsch-time">{etTimeLabel(m.meetingDate)}</span>
      <span className="hsch-kind">{badge}</span>
      <span className="hsch-title">{title || "(untitled meeting)"}</span>
      {status === "live" ? <span className="hsch-live">● LIVE</span> : null}
      {n > 0 ? <span className="hsch-bills">+{n} →</span> : null}
    </div>
  );
}

export function HearingsDaySchedule({
  meetings,
  committeeNames,
  nowMs,
}: {
  meetings: CommitteeMeeting[];
  committeeNames: Record<string, string>;
  nowMs: number;
}) {
  const [open, setOpen] = useState<{ m: CommitteeMeeting; rect: DOMRect } | null>(
    null,
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    clearClose();
    closeTimer.current = setTimeout(() => setOpen(null), 140);
  }, [clearClose]);
  const onOpen = useCallback(
    (m: CommitteeMeeting, rect: DOMRect) => {
      clearClose();
      setOpen({ m, rect });
    },
    [clearClose],
  );

  // Tap-elsewhere closes (touch parity with the calendar's entries).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".hcal-card")) return;
      if (t?.closest(".hsch-row")) return;
      setOpen(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const byDay = new Map<string, CommitteeMeeting[]>();
  for (const m of meetings) {
    const k = etDayKey(m.meetingDate);
    if (!k) continue;
    const arr = byDay.get(k);
    if (arr) arr.push(m);
    else byDay.set(k, [m]);
  }
  for (const arr of byDay.values())
    arr.sort((a, b) => Date.parse(a.meetingDate) - Date.parse(b.meetingDate));

  const todayKey = etTodayKey(nowMs);
  const monday = mondayOfKey(todayKey);
  const weekKeys = Array.from({ length: 5 }, (_, i) => addDaysToKey(monday, i));
  const countOf = (k: string) => byDay.get(k)?.length ?? 0;
  const weekTotal = weekKeys.reduce((a, k) => a + countOf(k), 0);
  const priorMonday = addDaysToKey(monday, -7);
  const priorTotal = Array.from({ length: 5 }, (_, i) =>
    countOf(addDaysToKey(priorMonday, i)),
  ).reduce((a, b) => a + b, 0);
  const delta = weekTotal - priorTotal;

  // The shown day: today when today has meetings, else the NEXT day that does —
  // which may sit past Friday, hence the scan over every known key, not just the
  // current week. Keys are YYYY-MM-DD, so a lexical compare is a date compare.
  let shownKey: string | null = countOf(todayKey) > 0 ? todayKey : null;
  if (!shownKey) {
    const ahead = Array.from(byDay.keys())
      .filter((k) => k > todayKey && (byDay.get(k)?.length ?? 0) > 0)
      .sort();
    shownKey = ahead[0] ?? null;
  }
  const isToday = shownKey === todayKey;
  const rows = shownKey ? (byDay.get(shownKey) ?? []) : [];

  // The now-marker index: the first upcoming row on today's schedule. Only drawn
  // when the shown day IS today and the marker would fall between two rows.
  const firstUpcoming = rows.findIndex(
    (m) => liveStatus(m, nowMs) !== "concluded",
  );
  const markerAt =
    isToday && firstUpcoming > 0 && firstUpcoming < rows.length
      ? firstUpcoming
      : -1;

  // Two columns at >=1700px: split the shown day's rows in half, seam after the
  // now-marker where one exists so the marker stays with the rows it separates.
  const splitAt =
    rows.length >= SPLIT_MIN_ROWS ? Math.ceil(rows.length / 2) : rows.length;
  const colA = rows.slice(0, splitAt);
  const colB = rows.slice(splitAt);

  const parts = shownKey ? dayKeyParts(shownKey) : null;

  const renderRows = (list: CommitteeMeeting[], offset: number) =>
    list.map((m, i) => (
      <div key={m.eventId}>
        {offset + i === markerAt ? (
          <div className="hsch-now" aria-hidden>
            <span className="hsch-now-lbl">NOW</span>
            <span className="hsch-now-line" />
          </div>
        ) : null}
        <SchedRow m={m} nowMs={nowMs} onOpen={onOpen} onLeave={scheduleClose} />
      </div>
    ));

  return (
    <div className="hsch">
      <div className="hsch-bar">
        <span className="hsch-day">
          {parts ? (
            <>
              <span className="hsch-day-lab">{isToday ? "TODAY" : "NEXT"}</span> ·{" "}
              {parts.dow} {parts.mon} {parts.dom}{" "}
              <span className="hsch-day-n">· {rows.length} SCHEDULED</span>
            </>
          ) : (
            <span className="hsch-day-lab">NOTHING SCHEDULED</span>
          )}
        </span>

        <span className="hsch-rib">
          {weekKeys.map((k) => {
            const n = countOf(k);
            const p = dayKeyParts(k);
            // HO 623 — a past day dims, matching the schedule rows' .is-past.
            // Without it the ribbon ARGUES WITH THE BAR: in NEXT mode the bar
            // reads "NEXT · THU SEP 17" while the ribbon still shows TUE 7 ·
            // WED 9 · THU 4 at full strength, which reads as three pending days
            // the bar is ignoring. The counts are correct — the ribbon is a
            // week total, not a forecast — so this is a DISPLAY contradiction,
            // not a data one, and dimming resolves it: past days read `done`.
            // Keys are YYYY-MM-DD so a lexical compare is a date compare.
            const isPast = k < todayKey;
            return (
              <span
                key={k}
                className={`hsch-cell${n > 0 ? " has" : ""}${
                  k === shownKey ? " on" : ""
                }${isPast ? " is-past" : ""}`}
              >
                {p.dow}
                <br />
                {n > 0 ? <b>{n}</b> : "—"}
              </span>
            );
          })}
          <span className="hsch-tot">
            {weekTotal} THIS WEEK{" "}
            {priorTotal > 0 || weekTotal > 0 ? (
              <span
                className={`hsch-delta${
                  delta > 0 ? " up" : delta < 0 ? " down" : ""
                }`}
              >
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "±"}
                {Math.abs(delta)}
              </span>
            ) : null}
          </span>
        </span>

        {/* C1 — no far-right anchor: the drill link follows the ribbon rather
            than being pushed to the panel's right edge by a spacer (the mock's
            `.sp`). Same deviation as the masthead; SKILL owns the conventions. */}
        <Link href="/hearings" className="hsch-all">
          → ALL
        </Link>
      </div>

      {rows.length === 0 ? (
        // C4 — a week with nothing is ONE dim line, not a reserved box.
        <div className="hsch-none">
          No committee meetings scheduled in the published calendar.
        </div>
      ) : (
        <div className="hsch-wrap">
          <div>{renderRows(colA, 0)}</div>
          {colB.length > 0 ? <div>{renderRows(colB, splitAt)}</div> : null}
        </div>
      )}

      {open ? (
        <HearingDetailCard
          m={open.m}
          committeeName={
            open.m.committeeSystemCode
              ? (committeeNames[open.m.committeeSystemCode] ?? null)
              : null
          }
          nowMs={nowMs}
          anchor={open.rect}
          onPointerEnter={clearClose}
          onPointerLeave={scheduleClose}
        />
      ) : null}
    </div>
  );
}
