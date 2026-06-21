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
  getRecentMeetings,
  getUpcomingMeetings,
  type CommitteeMeeting,
} from "@/lib/queries";

// Phase 1: max single weekday this week = 8 (median ~4-5); cap keeps the columns
// compact and uniform, overflow drills into /hearings on that day. HO 282 lifts
// the cap 5→6 now that the embedded calendar fills the box's pinned height.
const DAY_CAP = 6;
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

  // HO 304 — the left subhead slot is the WEEK DATE RANGE the grid displays (the
  // v3 mock: "JUN 15 – 19"), spanning the same Mon–Fri window as the columns.
  // It previously pulled a today/empty status (LIVE NOW / NEXT / NO MEETINGS
  // SCHEDULED), which read "NO MEETINGS SCHEDULED" on a weekend even while the
  // grid showed the week's meetings below it. The grid's per-day ● still marks a
  // live meeting; the right side keeps the "N meetings · → Hearings" count.
  const monParts = dayKeyParts(monKey);
  const friParts = dayKeyParts(addDaysToKey(monKey, 4));
  const weekRange =
    monParts.mon === friParts.mon
      ? `${monParts.mon} ${monParts.dom} – ${friParts.dom}`
      : `${monParts.mon} ${monParts.dom} – ${friParts.mon} ${friParts.dom}`;

  const [upcoming, recent] = await Promise.all([
    getUpcomingMeetings(),
    getRecentMeetings(RECENT_DAYS),
  ]);

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

  return (
    <section
      className={`hill-band${embedded ? " hill-band--embedded" : ""}`}
      aria-label="On the Hill — this week"
    >
      <div className="hill-band-head">
        {embedded ? null : (
          <span className="hill-band-title">On the Hill · This week</span>
        )}

        <span className="hill-band-week">{weekRange}</span>

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
                // HO 282: per-day empty-column label (distinct from the sub-bar's
                // NO MEETINGS SCHEDULED fallback) — reads as a quiet day.
                <div className="hill-day-empty">NO MEETINGS</div>
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
