// HO 265 (Piece 2 of 5) — the two-week Mon–Fri calendar grid for /hearings.
// Pure server component: no per-block expand (drill via the list view), so it
// renders fully static from the same getUpcomingMeetings / getRecentMeetings
// data the list uses, already filtered by the page. Weekends are dropped
// (Congress doesn't sit them — Phase 1: zero weekend meetings). Watch glyphs and
// the markup tint reuse Piece 1's rules via the shared lib.
import {
  addDaysToKey,
  dayKeyParts,
  etDayKey,
  etTimeLabel,
  etTodayKey,
  hearingBadge,
  mondayOfKey,
  watchState,
  type WatchState,
} from "@/lib/hearings";
import type { CommitteeMeeting } from "@/lib/queries";

// Phase 1: max single weekday = 16, median ~4-5. Cap keeps cell heights bounded
// and roughly uniform; the overflow surfaces as "+N more" (full set is the list
// view — calendar has no per-block expand).
const CELL_CAP = 5;
const WEEKDAYS = 5; // Mon–Fri

const WATCH_GLYPH: Record<Exclude<WatchState, "none">, string> = {
  live: "●",
  watch: "▶",
  stream: "↗",
};

function Block({ m, nowMs }: { m: CommitteeMeeting; nowMs: number }) {
  const badge = hearingBadge(m.meetingType);
  const ws = watchState(m, nowMs);
  const n = m.bills.length;
  return (
    <div className={`hearings-cal-block${badge === "MARKUP" ? " is-markup" : ""}`}>
      <div className="hearings-cal-block-top">
        {ws !== "none" ? (
          <span className={`g state-${ws}`} aria-hidden>
            {WATCH_GLYPH[ws]}
          </span>
        ) : null}
        <span className="t">{etTimeLabel(m.meetingDate)}</span>
        <span className="ty">{badge}</span>
        {n > 0 ? (
          <span className="b">
            +{n} {n === 1 ? "bill" : "bills"}
          </span>
        ) : null}
      </div>
      <div className="hearings-cal-block-title" title={m.title}>
        {m.title || "(untitled meeting)"}
      </div>
    </div>
  );
}

function Cell({
  dayKey,
  meetings,
  todayKey,
  nowMs,
}: {
  dayKey: string;
  meetings: CommitteeMeeting[];
  todayKey: string;
  nowMs: number;
}) {
  const { dow, dom } = dayKeyParts(dayKey);
  const isToday = dayKey === todayKey;
  const shown = meetings.slice(0, CELL_CAP);
  const more = meetings.length - shown.length;
  return (
    <div className={`hearings-cal-cell${isToday ? " is-today" : ""}`}>
      <div className="hearings-cal-cellhead">
        <span className="dow">{dow}</span>
        <span className="dom">{dom}</span>
        <span className="cnt">{meetings.length || ""}</span>
      </div>
      {meetings.length === 0 ? (
        <div className="hearings-cal-empty" aria-hidden>
          –
        </div>
      ) : (
        <div className="hearings-cal-blocks">
          {shown.map((m) => (
            <Block key={m.eventId} m={m} nowMs={nowMs} />
          ))}
          {more > 0 ? (
            <div className="hearings-cal-more">+{more} more</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function HearingsCalendar({
  meetings,
  nowMs,
}: {
  meetings: CommitteeMeeting[];
  nowMs: number;
}) {
  const todayKey = etTodayKey(nowMs);
  const week1Mon = mondayOfKey(todayKey);
  const weekMondays = [week1Mon, addDaysToKey(week1Mon, 7)];

  // bucket by ET day, then order each day's blocks by start time (ascending —
  // the recent-meetings helper hands them back DESC, so a same-day mix needs a
  // local sort to read top-to-bottom chronologically).
  const byDay = new Map<string, CommitteeMeeting[]>();
  for (const m of meetings) {
    const k = etDayKey(m.meetingDate);
    const arr = byDay.get(k);
    if (arr) arr.push(m);
    else byDay.set(k, [m]);
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => Date.parse(a.meetingDate) - Date.parse(b.meetingDate));
  }

  return (
    <div className="hearings-cal">
      {weekMondays.map((mon) => {
        const p = dayKeyParts(mon);
        return (
          <section key={mon} className="hearings-cal-week">
            <h2 className="hearings-cal-weekhead">
              WEEK OF {p.mon} {p.dom}
            </h2>
            <div className="hearings-cal-grid">
              {Array.from({ length: WEEKDAYS }, (_, i) => {
                const dayKey = addDaysToKey(mon, i);
                return (
                  <Cell
                    key={dayKey}
                    dayKey={dayKey}
                    meetings={byDay.get(dayKey) ?? []}
                    todayKey={todayKey}
                    nowMs={nowMs}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
