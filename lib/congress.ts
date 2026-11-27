export function getCurrentCongress(date: Date = new Date()): number {
  const year = date.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 3));
  const effectiveYear = date < startOfYear ? year - 1 : year;
  const congressStartYear =
    effectiveYear % 2 === 1 ? effectiveYear : effectiveYear - 1;
  return Math.floor((congressStartYear - 2025) / 2) + 119;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"] as const;
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? "th");
}

export function currentCongressLabel(date: Date = new Date()): string {
  return `${ordinal(getCurrentCongress(date))} Congress`;
}

// HO 813: a Congress's term, for /welcome's facts line. Each runs Jan 3 to Jan 3
// two years on, and the 119th began Jan 3, 2025, so the nth begins in
// 2025 + 2(n − 119); the next Congress's start is this one's end. UTC dates,
// because these are calendar days rather than instants.
export function congressTermDates(n: number): { start: Date; end: Date } {
  const startYear = 2025 + 2 * (n - 119);
  return {
    start: new Date(Date.UTC(startYear, 0, 3)),
    end: new Date(Date.UTC(startYear + 2, 0, 3)),
  };
}

// HO 838: the laws-enacted chart's pair (HO 712's product call). It compares
// the current Congress with the one before it, so at 00:00Z on Jan 3 of an odd
// year it moves on by one.
export function lawsComparisonPair(date: Date = new Date()): {
  current: number;
  previous: number;
} {
  const current = getCurrentCongress(date);
  return { current, previous: current - 1 };
}

// HO 838: where a Congress's enacted laws are stored. `historical_laws` is the
// static backfill and holds the 118th and earlier. `bills` holds every Congress
// the sync has fetched, from the 119th on, with stage 'enacted' for a law.
export function enactedLawsSource(congress: number): "bills" | "historical_laws" {
  return congress >= 119 ? "bills" : "historical_laws";
}

const WEEK_MS = 7 * 86_400_000;

// HO 838: the week of session a calendar day falls in, counted from the
// Congress's Jan 3 start (0 = its first seven days). A day before the start
// counts as week 0, as the laws reader always counted it. An unparseable day
// gives null.
export function weekOfSession(day: string, congress: number): number | null {
  const t = Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const start = congressTermDates(congress).start.getTime();
  return Math.max(0, Math.floor((t - start) / WEEK_MS));
}

// HO 838 (backlog line 71): for seven days after a switch, the vote syncs also
// fetch the previous Congress's second session. A roll recorded after the last
// daily tick before Jan 3, or posted late by the Clerk or the Senate, is
// otherwise never fetched, since the syncs read only getCurrentCongress()'s
// sessions. The window is [switch, switch + 7 days): at 2027-01-03T00:00:00Z
// the 120th begins and the tail is { congress: 119, session: 2 }; at
// 2027-01-10T00:00:00Z the instant seven days back is the 120th's too, so the
// tail is null. Null outside the window.
const TAIL_MS = 7 * 86_400_000;

export function previousCongressTail(
  now: Date = new Date(),
): { congress: number; session: 2 } | null {
  const current = getCurrentCongress(now);
  if (getCurrentCongress(new Date(now.getTime() - TAIL_MS)) === current) return null;
  return { congress: current - 1, session: 2 };
}

// HO 838 (the HO 838 ruling 4): the ideology strip and the polarization band
// read only the scores' Congress, the latest one `member_ideology` holds. The
// table is upserted per member, so when `sync:ideology` writes a new
// Congress's file, sitting members' rows move to it and a departed member's
// row stays on the old one. Until then every row is the same Congress's and
// the condition keeps them all. One condition for both queries, so they keep
// the agreement the strip's header comment documents; `check:rollover` case 5
// runs it against an in-memory fixture. `mi` is member_ideology's alias.
export const SCORES_CONGRESS_SQL =
  "mi.congress = (SELECT MAX(congress) FROM member_ideology)";

const TERM_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "Jan 3, 2025", read in UTC so the day can't move with the server's zone.
export function formatTermDate(d: Date): string {
  return `${TERM_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
