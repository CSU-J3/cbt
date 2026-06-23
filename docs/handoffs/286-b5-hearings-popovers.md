# HO 286 — B5 week strip: HEARINGS metric + hover popovers

Part 2 of the B5 spec, building on 283 (which added the WoW deltas to the existing three metrics). Two additions: a fourth metric (HEARINGS) and a hover popover on every metric. Strip stays one thin line.

Locate the week-strip component and the `getWeeklyBandPriorWeek()` helper added in 283 (grep).

## 1. HEARINGS metric

Add HEARINGS as a fourth metric on the strip, same shape as the others: value (bold, --text-primary) + label (--text-muted) + WoW delta (▲ --up / ▼ --down / dim ±0, the tape tokens).

It needs this-week and prior-week committee-meeting counts. Extend the 283 prior-week helper (or add a parallel aggregate) to compute the meeting count for this week and the prior 7-day window, using the same like-for-like bounds the other metrics use. Source the count from the hearings/meetings data layer. If prior-week meeting data isn't retained far enough back to compute a delta, render the value with a ±0 / no-delta state rather than a wrong number, and note it.

## 2. Hover popovers on every metric

Each metric (the three from 283 plus HEARINGS) gets a hover popover with the full breakdown: `This week X · last week (DATE) Y · ▲/▼ delta`, where DATE is the prior week's start. Reuse the existing tooltip/popover primitive (HO 147). The strip stays one thin line; the popover drops below it (the strip doesn't clip).

## Constraints

- Strip stays a single row.
- Reuse 283's delta tokens/colors and the existing popover primitive; don't introduce new ones.
- No change to the three existing metrics' values or the READ FULL link (283 settled those).

## Ship

Commit the HEARINGS metric and the popovers separately if cleanly separable, else one named commit. `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify: HEARINGS shows a value plus a correct delta; every metric's hover popover shows the this/last-week breakdown and drops below the strip without clipping.
