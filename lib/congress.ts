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

const TERM_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "Jan 3, 2025", read in UTC so the day can't move with the server's zone.
export function formatTermDate(d: Date): string {
  return `${TERM_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
