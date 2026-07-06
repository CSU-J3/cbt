// Strict statistical median, pinned to the polarization band's method.
// Zero imports so server queries, the client island, and node scripts all share it.
// sort ascending; empty -> null; odd -> middle; even -> mean of the two middle.
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] as number;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + hi) / 2 : hi;
}
