// HO 266 (Piece 3 of 5) — the dashboard "ON THE HILL" band: a full-width,
// this-week (Mon–Fri) compact committee calendar that sits below the weekly band
// and leads the two-column body. Self-contained server block (like WeeklyBand) —
// static, no expand; drill into /hearings. Reuses Piece 1's treatments (the
// watchState rule for the LIVE NOW callout + the markup tint) via the shared lib,
// but is an independent compact component, not a Piece 1 import.
import Link from "next/link";
import {
  addDaysToKey,
  dayKeyParts,
  etDayKey,
  etTimeLabel,
  etTodayKey,
  hearingBadge,
  mondayOfKey,
  watchState,
} from "@/lib/hearings";
import {
  getCommitteesIndex,
  getRecentMeetings,
  getUpcomingMeetings,
  type CommitteeMeeting,
} from "@/lib/queries";

// Phase 1: max single weekday this week = 8 (median ~4-5); cap keeps the columns
// compact and uniform, overflow drills into /hearings on that day.
const DAY_CAP = 5;
const RECENT_DAYS = 7;

// "+N more" and the LIVE callout deep-link to the list view's day group; the
// HearingsList day wrappers carry matching `hill-day-<key>` ids (HO 266).
function dayHref(dayKey: string): string {
  return `/hearings#hill-day-${dayKey}`;
}

export async function OnTheHillBand() {
  const nowMs = Date.now();
  const todayKey = etTodayKey(nowMs);
  const monKey = mondayOfKey(todayKey);
  const weekKeys = Array.from({ length: 5 }, (_, i) => addDaysToKey(monKey, i));
  const weekKeySet = new Set(weekKeys);

  const [upcoming, recent, committees] = await Promise.all([
    getUpcomingMeetings(),
    getRecentMeetings(RECENT_DAYS),
    getCommitteesIndex(),
  ]);
  const committeeNames: Record<string, string> = {};
  for (const c of committees) committeeNames[c.systemCode] = c.name;

  // this week's meetings only, bucketed by ET day, each day time-sorted asc.
  const byDay = new Map<string, CommitteeMeeting[]>();
  let total = 0;
  for (const m of [...upcoming, ...recent]) {
    const k = etDayKey(m.meetingDate);
    if (!weekKeySet.has(k)) continue;
    const arr = byDay.get(k);
    if (arr) arr.push(m);
    else byDay.set(k, [m]);
    total += 1;
  }
  for (const arr of byDay.values()) {
    arr.sort((a, b) => Date.parse(a.meetingDate) - Date.parse(b.meetingDate));
  }

  // LIVE NOW callout — the first meeting live right now under Piece 1's rule.
  const live =
    [...upcoming, ...recent]
      .filter((m) => weekKeySet.has(etDayKey(m.meetingDate)))
      .sort((a, b) => Date.parse(a.meetingDate) - Date.parse(b.meetingDate))
      .find((m) => watchState(m, nowMs) === "live") ?? null;
  const liveCommittee = live?.committeeSystemCode
    ? (committeeNames[live.committeeSystemCode] ?? null)
    : null;

  return (
    <section className="hill-band" aria-label="On the Hill — this week">
      <div className="hill-band-head">
        <span className="hill-band-title">On the Hill · This week</span>

        {live ? (
          <Link
            href={dayHref(etDayKey(live.meetingDate))}
            className="hill-band-live"
          >
            <span aria-hidden>●</span> LIVE NOW ·{" "}
            <span className="tabular-nums">{etTimeLabel(live.meetingDate)}</span>{" "}
            · <span className="hill-band-live-title">{live.title}</span>
            {liveCommittee ? ` · ${liveCommittee}` : ""}
          </Link>
        ) : null}

        <span className="hill-band-right">
          <span className="tabular-nums">{total.toLocaleString()}</span> meetings
          <span aria-hidden> · </span>
          <Link href="/hearings" className="hill-band-link">
            → Hearings
          </Link>
        </span>
      </div>

      <div className="hill-band-grid">
        {weekKeys.map((dayKey) => {
          const meetings = byDay.get(dayKey) ?? [];
          const { dow, dom } = dayKeyParts(dayKey);
          const isToday = dayKey === todayKey;
          const shown = meetings.slice(0, DAY_CAP);
          const more = meetings.length - shown.length;
          return (
            <div
              key={dayKey}
              className={`hill-day${isToday ? " is-today" : ""}`}
            >
              <div className="hill-day-head">
                <span className="dow">{dow}</span>
                <span className="dom">{dom}</span>
                <span className="cnt">{meetings.length || ""}</span>
              </div>
              {meetings.length === 0 ? (
                <div className="hill-day-empty" aria-hidden>
                  –
                </div>
              ) : (
                <>
                  {shown.map((m) => {
                    const badge = hearingBadge(m.meetingType);
                    const isLive = watchState(m, nowMs) === "live";
                    return (
                      <div
                        key={m.eventId}
                        className={`hill-line${badge === "MARKUP" ? " is-markup" : ""}`}
                        title={m.title}
                      >
                        <span className="hill-line-dot" aria-hidden>
                          {isLive ? "●" : ""}
                        </span>
                        <span className="hill-line-time tabular-nums">
                          {etTimeLabel(m.meetingDate)}
                        </span>
                        <span className="hill-line-title">
                          {m.title || "(untitled)"}
                        </span>
                        {m.bills.length > 0 ? (
                          <span className="hill-line-bills">
                            +{m.bills.length}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                  {more > 0 ? (
                    <Link href={dayHref(dayKey)} className="hill-more">
                      +{more} more
                    </Link>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
