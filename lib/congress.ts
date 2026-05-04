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
