// HO 234 (design item 1) — NYSE regular-session open/closed signal for the
// markets tape. Net-new: no market-hours concept existed anywhere before (HO 229
// P-check). Pure + client-safe (called from MarketsTapeClient). ET is derived via
// Intl.DateTimeFormat(America/New_York) — no timezone library, per the constraint.
//
// Early-close half-days (the 1pm ET closes the day before Independence Day, the
// day after Thanksgiving, Christmas Eve) are OUT OF SCOPE for v1 — those sessions
// read as open until 16:00 ET. An acceptable approximation; revisit if half-day
// accuracy ever matters.

// Official 2026 NYSE full-day closures, as OBSERVED dates (ET, YYYY-MM-DD):
//   New Year's Day          Thu Jan 1
//   MLK Jr. Day             Mon Jan 19
//   Washington's Birthday   Mon Feb 16
//   Good Friday             Fri Apr 3
//   Memorial Day            Mon May 25
//   Juneteenth              Fri Jun 19
//   Independence Day (obs.) Fri Jul 3   (Jul 4 falls on Saturday → observed Fri)
//   Labor Day               Mon Sep 7
//   Thanksgiving            Thu Nov 26
//   Christmas Day           Fri Dec 25
const NYSE_HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
]);

const OPEN_MINUTES = 9 * 60 + 30; // 9:30 ET
const CLOSE_MINUTES = 16 * 60; // 16:00 ET

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Wall-clock pieces in America/New_York for an instant (DST handled by the
// IANA zone, so no manual offset math).
function nyParts(now: Date): {
  isoDate: string;
  weekday: number;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // hour12:false can emit "24" at midnight
  return {
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
    minutes: hour * 60 + Number(get("minute")),
  };
}

// True during the NYSE regular session: 9:30–16:00 ET, Mon–Fri, excluding the
// 2026 full-day holidays. 9:30 reads open, 16:00 reads closed (boundary: 9:29
// closed, 9:31 open).
export function isMarketOpen(now: Date): boolean {
  const { isoDate, weekday, minutes } = nyParts(now);
  if (weekday === 0 || weekday === 6) return false;
  if (NYSE_HOLIDAYS_2026.has(isoDate)) return false;
  return minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES;
}
