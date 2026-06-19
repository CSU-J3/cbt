// HO 266 (Piece 3 of 5) — the dashboard "ON THE HILL" band: a full-width,
// this-week (Mon–Fri) compact committee calendar that sits below the weekly band
// and leads the two-column body. Self-contained server block (like WeeklyBand) —
// static, no expand; drill into /hearings. Reuses Piece 1's treatments (the
// watchState rule for the LIVE NOW callout + the markup tint) via the shared lib,
// but is an independent compact component, not a Piece 1 import.
import Link from "next/link";
import {
  addDaysToKey,
  cleanMeetingTitle,
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

// HO 271: `embedded` houses the band inside the v2 HEARINGS tab — the tab label
// carries the section name, so the standalone `On the Hill · This week` title is
// suppressed and the band's own top-divider drops (the box supplies the chrome).
// The live callout + `N meetings · → Hearings` sub-bar and the grid are unchanged.
export async function OnTheHillBand({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
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

  // Non-live fallback (most of the day): the next upcoming meeting this week, so
  // the sub-bar's left side never sits empty. `upcoming` is meeting_date >= now
  // ASC, so the first this-week entry is the soonest. If nothing's left this
  // week, the render falls through to a muted NO MEETINGS SCHEDULED.
  const nextUp = live
    ? null
    : (upcoming.find(
        (m) =>
          weekKeySet.has(etDayKey(m.meetingDate)) &&
          Date.parse(m.meetingDate) >= nowMs,
      ) ?? null);

  return (
    <section
      className={`hill-band${embedded ? " hill-band--embedded" : ""}`}
      aria-label="On the Hill — this week"
    >
      <div className="hill-band-head">
        {embedded ? null : (
          <span className="hill-band-title">On the Hill · This week</span>
        )}

        {live ? (
          <Link
            href={dayHref(etDayKey(live.meetingDate))}
            className="hill-band-live"
          >
            <span aria-hidden>●</span> LIVE NOW ·{" "}
            <span className="tabular-nums">{etTimeLabel(live.meetingDate)}</span>{" "}
            ·{" "}
            <span className="hill-band-live-title">
              {cleanMeetingTitle(live.title)}
            </span>
            {liveCommittee ? ` · ${liveCommittee}` : ""}
          </Link>
        ) : nextUp ? (
          <Link
            href={dayHref(etDayKey(nextUp.meetingDate))}
            className="hill-band-next"
          >
            NEXT ·{" "}
            <span className="tabular-nums">
              {dayKeyParts(etDayKey(nextUp.meetingDate)).dow}{" "}
              {etTimeLabel(nextUp.meetingDate)}
            </span>{" "}
            ·{" "}
            <span className="hill-band-live-title">
              {cleanMeetingTitle(nextUp.title)}
            </span>
          </Link>
        ) : (
          <span className="hill-band-none">NO MEETINGS SCHEDULED</span>
        )}

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
                    const title = cleanMeetingTitle(m.title);
                    return (
                      <div
                        key={m.eventId}
                        className={`hill-line${badge === "MARKUP" ? " is-markup" : ""}`}
                        title={title}
                      >
                        <span className="hill-line-dot" aria-hidden>
                          {isLive ? "●" : ""}
                        </span>
                        <span className="hill-line-time tabular-nums">
                          {etTimeLabel(m.meetingDate)}
                        </span>
                        <span className="hill-line-title">
                          {title || "(untitled)"}
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
