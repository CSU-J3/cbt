// HO 813: the stage funnel's bar geometry, shared by the dashboard's StageFunnel
// and /welcome's LandingFunnel so the two funnels can't drift. Moved here from
// components/StageFunnel.tsx (the floor at :54, the width at :113-114).
//
// Floor in % of track width so the PRESIDENT row renders visibly even
// at count 0 (handoff: "min-width ~4-6px even at count 0"). The CSS
// also pins `min-width: 4px` on the bar element as a px-level backstop
// if the track gets very narrow at small viewports.
export const MIN_BAR_PCT = 2.2;

// A bar's width in % of its track: sqrt-scaled against the largest count, so the
// committee bulge doesn't flatten every other row, and never under MIN_BAR_PCT.
export function funnelWidthPct(count: number, maxCount: number): number {
  const sqrtMax = Math.sqrt(maxCount) || 1;
  return Math.max((Math.sqrt(count) / sqrtMax) * 100, MIN_BAR_PCT);
}
