"use client";

// HO 306 → HO 611 — the /hearings AGENDA: two weeks, each a ribbon over stacked
// day sections. It is no longer a Mon–Fri grid; that description survived one
// commit past the grid's removal, which is the stale-claim-on-main class this
// arc keeps filing, so it is corrected here rather than left for a sweep.
//
// HO 610 moved the dashboard HEARINGS tab off this component (it had used an
// `embedded` single-week, per-day-capped mode pinned to the RACES footprint) and
// deleted the `embedded`/`cap` props in the same commit that orphaned them. HO
// 611 re-ran the grep and confirms it: NOTHING passes `embedded`, and there was
// nothing left to strip. The dashboard now renders HearingsDaySchedule; what the
// two surfaces still share is the per-meeting detail card (HearingDetailCard),
// which is the part that would actually drift. The row SHAPE is deliberately not
// shared — this one wraps its title because a browse list has nothing to protect,
// while the dashboard's ellipsizes to hold a pinned box.
//
// Presentation + one computed field (live status). Data is what the live page
// already reads (getUpcomingMeetings + getRecentMeetings, widened to 14d so the
// week stat's prior-week delta is honest). Filter is client-state (instant, no
// navigation); all detail lives in a floating card portaled to <body>, so
// opening one never reflows the agenda.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  type HearingBadge,
} from "@/lib/hearings";
import type { CommitteeMeeting } from "@/lib/queries";

type TypeFilter = "" | "hearing" | "markup" | "business";
type ChamberFilter = "" | "house" | "senate";

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
// ── week stat (count + WoW delta), hover opens the breakdown ──
// HO 366: bare — the noun dropped (it now lives in the filter-bar corpus readout,
// reactive to TYPE), the stat clusters immediately after the WEEK OF label.
function WeekStat({
  count,
  delta,
  onEnter,
  onLeave,
}: {
  count: number;
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
      <span className="hcal-weekstat-n">{count.toLocaleString()}</span>
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
  // HO 611: ONE line — time · kind · title · badges, packed left. It was two
  // lines (a meta row over a clamped title) because it lived in a 1/5-width
  // column; in the full-width agenda that shape put `.hcal-entry-badges` on a
  // `margin-left: auto` across ~2,400px, which is the C1 defect this phase
  // removes, and the clamp had nothing left to clamp. Same element, same
  // handlers, same detail card — only the internal layout changed.
  return (
    <div
      ref={ref}
      className={`hcal-entry${n > 0 ? " has-bills" : ""}${badge === "MARKUP" ? " is-markup" : ""}${status === "concluded" ? " is-past" : ""}`}
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
      <span className="hcal-entry-time">{etTimeLabel(m.meetingDate)}</span>
      <span className="hcal-entry-kind">{badge}</span>
      <span className="hcal-entry-title">{title || "(untitled meeting)"}</span>
      {status === "live" ? (
        <span className="hcal-badge-live">● LIVE</span>
      ) : null}
      {n > 0 ? <span className="hcal-badge-bills">+{n} bills</span> : null}
    </div>
  );
}

export function HearingsCalendar({
  meetings,
  committeeNames,
  nowMs,
  weeks = 2,
  showCorpus = false,
}: {
  meetings: CommitteeMeeting[];
  committeeNames: Record<string, string>;
  nowMs: number;
  weeks?: number;
  // HO 366: render the filter-reactive corpus readout on the filter bar's right
  // edge. Its one caller (/hearings) sets it; the default keeps the flag opt-in.
  showCorpus?: boolean;
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

  // HO 366 corpus readout (gated to /hearings). It's a WINDOW, not the full
  // 119th-Congress total: the count is the visible calendar scope (the rendered
  // weeks, Mon–Fri), filtered by the same TYPE/CHAMBER state that drives the grid.
  // It reconciles with the on-screen week stats (its total === the sum of the
  // week strips). The range qualifier makes that window explicit.
  const visibleDays = new Set<string>();
  for (const mon of weekMons)
    for (let i = 0; i < 5; i++) visibleDays.add(addDaysToKey(mon, i));
  let corpusTotal = 0;
  let corpusHouse = 0;
  let corpusSenate = 0;
  for (const m of filtered) {
    if (!visibleDays.has(etDayKey(m.meetingDate))) continue;
    corpusTotal++;
    if (m.chamber === "house") corpusHouse++;
    else if (m.chamber === "senate") corpusSenate++;
  }
  const firstMon = weekMons[0]!;
  const lastFri = addDaysToKey(weekMons[weekMons.length - 1]!, 4);
  const fp = dayKeyParts(firstMon);
  const lp = dayKeyParts(lastFri);
  const rangeLabel = `${fp.mon} ${fp.dom}–${lp.mon} ${lp.dom}`;

  return (
    <div className="hcal">
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

        {showCorpus ? (
          <span className="hcal-corpus">
            <span className="hcal-corpus-n">{corpusTotal.toLocaleString()}</span>{" "}
            <span className="hcal-corpus-noun">{noun}</span>
            {chamber === "" ? (
              <>
                {" · "}
                <span className="hcal-corpus-n">
                  {corpusHouse.toLocaleString()}
                </span>{" "}
                <span className="hcal-corpus-tag">HOUSE</span>
                {" / "}
                <span className="hcal-corpus-n">
                  {corpusSenate.toLocaleString()}
                </span>{" "}
                <span className="hcal-corpus-tag">SENATE</span>
              </>
            ) : (
              <>
                {" · "}
                <span className="hcal-corpus-tag">
                  {chamber === "house" ? "HOUSE" : "SENATE"}
                </span>
              </>
            )}
            <span className="hcal-corpus-range"> · {rangeLabel}</span>
          </span>
        ) : null}
      </div>

      {weekMons.map((monKey, wi) => {
        const p = dayKeyParts(monKey);
        const count = weekCount(monKey);
        const isCurrent = monKey === currentMon;
        const delta = count - priorCount;
        // Mon-Fri keys that actually carry meetings under the active filters.
        const activeDays = Array.from({ length: 5 }, (_, i) =>
          addDaysToKey(monKey, i),
        ).filter((k) => (byDay.get(k)?.length ?? 0) > 0);
        return (
          <section key={monKey} className="hcal-week">
            <div className="hcal-weekhead">
              <span className="hcal-weekof">
                WEEK OF {p.mon} {p.dom}
              </span>
              <span className="hcal-weekhead-mid" aria-hidden>
                ·
              </span>
              <WeekStat
                count={count}
                delta={isCurrent ? delta : null}
                onEnter={(rect) =>
                  setStatOpen({ rect, count, priorCount, priorMon })
                }
                onLeave={() => setStatOpen(null)}
              />
            </div>
            {/* HO 611 — the week ribbon. Five MON–FRI cells; an empty day's ENTIRE
                footprint is its dash (C4 at route scale — it used to be a
                150px-min bordered column reading "No meetings"). A day with
                meetings is an in-page anchor to its section below: a plain <a>,
                no state machinery. Cells reuse the dashboard ribbon's .hsch-cell
                because the two genuinely share a visual; the row that holds them
                is route-owned. */}
            <div className="hcal-rib">
              {Array.from({ length: 5 }, (_, i) => {
                const dayKey = addDaysToKey(monKey, i);
                const n = byDay.get(dayKey)?.length ?? 0;
                const dp = dayKeyParts(dayKey);
                const cls = `hsch-cell${n > 0 ? " has" : ""}${dayKey === todayKey ? " on" : ""}`;
                const body = (
                  <>
                    {dp.dow}
                    <br />
                    {n > 0 ? <b>{n}</b> : "—"}
                  </>
                );
                return n > 0 ? (
                  <a key={dayKey} className={cls} href={`#hcal-day-${dayKey}`}>
                    {body}
                  </a>
                ) : (
                  <span key={dayKey} className={cls}>
                    {body}
                  </span>
                );
              })}
            </div>

            {/* Stacked day sections, DAYS WITH MEETINGS ONLY, uncapped. The cap
                was the embedded tab's constraint (a pinned box), never the
                route's — this is the browse surface `→ ALL` exists to reach. */}
            {activeDays.length === 0 ? (
              <div className="hcal-week-empty">Nothing scheduled this week.</div>
            ) : (
              activeDays.map((dayKey) => {
                const dm = byDay.get(dayKey) ?? [];
                const dp = dayKeyParts(dayKey);
                const isToday = dayKey === todayKey;
                return (
                  <section
                    key={dayKey}
                    id={`hcal-day-${dayKey}`}
                    className={`hcal-agenda-day${isToday ? " is-today" : ""}`}
                  >
                    <h3 className="hcal-agenda-head">
                      <span className="dow">{dp.dow}</span>{" "}
                      <span className="dom">
                        {dp.mon} {dp.dom}
                      </span>
                      {isToday ? <span className="today-tag">Today</span> : null}
                      <span className="sep" aria-hidden>
                        ·
                      </span>
                      <span className="cnt">{dm.length}</span>
                    </h3>
                    {dm.map((m) => (
                      <Entry
                        key={m.eventId}
                        m={m}
                        nowMs={nowMs}
                        onOpen={onOpen}
                        onLeave={scheduleClose}
                      />
                    ))}
                  </section>
                );
              })
            )}
          </section>
        );
      })}

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
