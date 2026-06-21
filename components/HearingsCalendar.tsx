"use client";

// HO 306 — the shared hearings calendar. ONE client component renders both
// /hearings (calendar-only view, free height, two-week stack) and the
// /dashboard-v2 HEARINGS tab (embedded, single week, height-pinned to the RACES
// footprint). Replaces the two prior components (HearingsCalendar server grid +
// OnTheHillBand) so the surfaces can't drift.
//
// Presentation + one computed field (live status). Data is what the live page
// already reads (getUpcomingMeetings + getRecentMeetings, now widened to 14d so
// the week stat's prior-week delta is honest). Filter is client-state (instant,
// no navigation); all detail lives in a floating card portaled to <body> so the
// grid never reflows on hover/tap — the height-pinned tab and free-height page
// both hold.
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { formatBillId } from "@/lib/format";
import {
  addDaysToKey,
  cleanMeetingTitle,
  dayKeyParts,
  etDayKey,
  etTimeLabel,
  etTodayKey,
  hearingBadge,
  LIVE_WINDOW_MS,
  mondayOfKey,
  type HearingBadge,
} from "@/lib/hearings";
import type { CommitteeMeeting } from "@/lib/queries";

type TypeFilter = "" | "hearing" | "markup" | "business";
type ChamberFilter = "" | "house" | "senate";
type LiveStatus = "scheduled" | "live" | "concluded";

const TYPE_BADGE: Record<Exclude<TypeFilter, "">, HearingBadge> = {
  hearing: "HEARING",
  markup: "MARKUP",
  business: "BUSINESS",
};
const TYPE_NOUN: Record<TypeFilter, string> = {
  "": "MEETINGS",
  hearing: "HEARINGS",
  markup: "MARKUPS",
  business: "BUSINESS",
};
const TYPE_OPTS: ReadonlyArray<{ value: TypeFilter; label: string }> = [
  { value: "", label: "All" },
  { value: "hearing", label: "Hearings" },
  { value: "markup", label: "Markups" },
  { value: "business", label: "Business" },
];
const CHAMBER_OPTS: ReadonlyArray<{ value: ChamberFilter; label: string }> = [
  { value: "", label: "All" },
  { value: "house", label: "House" },
  { value: "senate", label: "Senate" },
];
const SUPPRESS_STATUS = new Set(["Canceled", "Postponed"]);

function liveStatus(m: CommitteeMeeting, nowMs: number): LiveStatus {
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

// ── the floating detail card (portaled to body, fixed, flips at the right edge) ──
function DetailCard({
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
  const watchText =
    !m.videoUrl
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
            <span className="k">When</span> {dayKeyParts(etDayKey(m.meetingDate)).dow}{" "}
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
                <Link href={`/bill/${b.id}`} className="hcal-card-billid">
                  {formatBillId(b.bill_type, b.bill_number)}
                </Link>
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

// ── week stat (count + noun + WoW delta), hover opens the breakdown ──
function WeekStat({
  count,
  noun,
  delta,
  onEnter,
  onLeave,
}: {
  count: number;
  noun: string;
  delta: number | null;
  onEnter: (rect: DOMRect) => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const dir =
    delta == null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return (
    <span
      ref={ref}
      className="hcal-weekstat"
      onMouseEnter={() => {
        if (delta != null && ref.current) onEnter(ref.current.getBoundingClientRect());
      }}
      onMouseLeave={onLeave}
    >
      <span className="hcal-weekstat-n">{count.toLocaleString()}</span> {noun}
      {dir ? (
        <span className={`hcal-weekstat-delta delta-${dir}`}>
          {dir === "flat"
            ? " ±0"
            : ` ${dir === "up" ? "▲" : "▼"}${Math.abs(delta as number).toLocaleString()}`}
        </span>
      ) : null}
    </span>
  );
}

// ── a single collapsed entry ──
function Entry({
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
  const badge = hearingBadge(m.meetingType);
  const status = liveStatus(m, nowMs);
  const title = cleanMeetingTitle(m.title);
  const n = m.bills.length;
  const ref = useRef<HTMLDivElement>(null);
  const open = useCallback(() => {
    const el = ref.current;
    if (el) onOpen(m, el.getBoundingClientRect());
  }, [m, onOpen]);
  return (
    <div
      ref={ref}
      className={`hcal-entry${n > 0 ? " has-bills" : ""}${badge === "MARKUP" ? " is-markup" : ""}`}
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
      <div className="hcal-entry-top">
        <span className="hcal-entry-time">{etTimeLabel(m.meetingDate)}</span>
        <span className="hcal-entry-kind">{badge}</span>
        <span className="hcal-entry-badges">
          {n > 0 ? <span className="hcal-badge-bills">+{n} bills</span> : null}
          {status === "live" ? (
            <span className="hcal-badge-live">● LIVE</span>
          ) : null}
        </span>
      </div>
      <div className="hcal-entry-title">{title || "(untitled meeting)"}</div>
    </div>
  );
}

export function HearingsCalendar({
  meetings,
  committeeNames,
  nowMs,
  weeks = 2,
  embedded = false,
  cap,
}: {
  meetings: CommitteeMeeting[];
  committeeNames: Record<string, string>;
  nowMs: number;
  weeks?: number;
  embedded?: boolean;
  cap?: number;
}) {
  const [type, setType] = useState<TypeFilter>("");
  const [chamber, setChamber] = useState<ChamberFilter>("");
  const [open, setOpen] = useState<{ m: CommitteeMeeting; rect: DOMRect } | null>(
    null,
  );
  const [statOpen, setStatOpen] = useState<{
    rect: DOMRect;
    count: number;
    priorCount: number;
    priorMon: string;
  } | null>(null);
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

  // Tap-elsewhere closes (touch): any pointerdown outside the card + entries.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest(".hcal-card")) return;
      if (t && t.closest(".hcal-entry")) return;
      setOpen(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const filtered = meetings.filter(
    (m) =>
      (chamber === "" || m.chamber === chamber) &&
      (type === "" || hearingBadge(m.meetingType) === TYPE_BADGE[type]),
  );
  const byDay = new Map<string, CommitteeMeeting[]>();
  for (const m of filtered) {
    const k = etDayKey(m.meetingDate);
    const arr = byDay.get(k);
    if (arr) arr.push(m);
    else byDay.set(k, [m]);
  }
  for (const arr of byDay.values())
    arr.sort((a, b) => Date.parse(a.meetingDate) - Date.parse(b.meetingDate));

  const todayKey = etTodayKey(nowMs);
  const currentMon = mondayOfKey(todayKey);
  const priorMon = addDaysToKey(currentMon, -7);
  const weekMons =
    weeks <= 1 ? [currentMon] : [currentMon, addDaysToKey(currentMon, 7)];

  const weekCount = (monKey: string) => {
    let n = 0;
    for (let i = 0; i < 5; i++) n += byDay.get(addDaysToKey(monKey, i))?.length ?? 0;
    return n;
  };
  const priorCount = weekCount(priorMon);
  const noun = TYPE_NOUN[type];

  return (
    <div className={`hcal${embedded ? " hcal--embedded" : ""}`}>
      {/* Filter bar: TYPE + CHAMBER, client-state. Active = amber bracketed. */}
      <div className="hcal-filterbar">
        <span className="hcal-filter-group">
          <span className="hcal-filter-label">TYPE</span>
          {TYPE_OPTS.map((o) => (
            <button
              key={o.value || "all"}
              type="button"
              className={`hcal-filter-opt${type === o.value ? " is-active" : ""}`}
              aria-pressed={type === o.value}
              onClick={() => setType(o.value)}
            >
              {o.label}
            </button>
          ))}
        </span>
        <span className="hcal-filter-group">
          <span className="hcal-filter-label">CHAMBER</span>
          {CHAMBER_OPTS.map((o) => (
            <button
              key={o.value || "all"}
              type="button"
              className={`hcal-filter-opt${chamber === o.value ? " is-active" : ""}`}
              aria-pressed={chamber === o.value}
              onClick={() => setChamber(o.value)}
            >
              {o.label}
            </button>
          ))}
        </span>
      </div>

      {weekMons.map((monKey, wi) => {
        const p = dayKeyParts(monKey);
        const count = weekCount(monKey);
        const isCurrent = monKey === currentMon;
        const delta = count - priorCount;
        return (
          <section key={monKey} className="hcal-week">
            <div className="hcal-weekhead">
              <span className="hcal-weekof">
                WEEK OF {p.mon} {p.dom}
              </span>
              <WeekStat
                count={count}
                noun={noun}
                delta={isCurrent ? delta : null}
                onEnter={(rect) =>
                  setStatOpen({ rect, count, priorCount, priorMon })
                }
                onLeave={() => setStatOpen(null)}
              />
            </div>
            <div className="hcal-grid">
              {Array.from({ length: 5 }, (_, i) => {
                const dayKey = addDaysToKey(monKey, i);
                const dm = byDay.get(dayKey) ?? [];
                const dp = dayKeyParts(dayKey);
                const isToday = dayKey === todayKey;
                const shown = cap != null ? dm.slice(0, cap) : dm;
                const more = dm.length - shown.length;
                return (
                  <div
                    key={dayKey}
                    className={`hcal-day${isToday ? " is-today" : ""}`}
                  >
                    <div className="hcal-dayhead">
                      <span className="dow">{dp.dow}</span>
                      <span className="dom">{dp.dom}</span>
                      {isToday ? <span className="today-tag">Today</span> : null}
                      <span className="cnt">{dm.length || ""}</span>
                    </div>
                    {dm.length === 0 ? (
                      <div className="hcal-day-empty">No meetings</div>
                    ) : (
                      <div className="hcal-day-list">
                        {shown.map((m) => (
                          <Entry
                            key={m.eventId}
                            m={m}
                            nowMs={nowMs}
                            onOpen={onOpen}
                            onLeave={scheduleClose}
                          />
                        ))}
                        {more > 0 ? (
                          <Link href="/hearings" className="hcal-more">
                            +{more} more
                          </Link>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {embedded ? (
        <Link href="/hearings" className="hcal-drill">
          → All hearings
        </Link>
      ) : null}

      {open ? (
        <DetailCard
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

      {statOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="hcal-stat-tip"
              role="tooltip"
              style={{
                left: Math.max(
                  8,
                  Math.min(statOpen.rect.left, window.innerWidth - 280 - 8),
                ),
                top: statOpen.rect.bottom + 6,
              }}
            >
              <span className="hcal-stat-tip-label">
                {noun} · WEEK OVER WEEK
              </span>
              <span className="hcal-stat-tip-body">
                {`This week ${statOpen.count.toLocaleString()} · last week (${statOpen.priorMon}) ${statOpen.priorCount.toLocaleString()} · ${
                  statOpen.count - statOpen.priorCount > 0
                    ? `▲${Math.abs(statOpen.count - statOpen.priorCount)}`
                    : statOpen.count - statOpen.priorCount < 0
                      ? `▼${Math.abs(statOpen.count - statOpen.priorCount)}`
                      : "±0"
                }`}
              </span>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
