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

const TERM_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "Jan 3, 2025", read in UTC so the day can't move with the server's zone.
export function formatTermDate(d: Date): string {
  return `${TERM_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
