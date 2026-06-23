# 309 — v2 HEARINGS tab: stop the tall day column escaping the pinned box

Confirm the next free number before saving (`ls docs/handoffs/ | sort -V | tail`). Body assumes 309; rename if taken.

## The bug

On `/dashboard-v2`, HEARINGS tab. The tallest day column (this week WED, 8 meetings → capped list + "+N more") overflows the bottom of the pinned B4 box and paints **over** the elements below it: the weekly line, the BREAKING section, and the MOVERS box. In the capture, WED's last entries (the `+16 BILLS S.4726` business item, the Walter Clayton hearing, and "+2 more") render below the box border, on top of the weekly strip and into BREAKING. A light week never reproduces it — no day hits the cap, so nothing overflows. It surfaces only when a single day hits the per-day cap, which WED does this week.

## Resolved premise — HO 304, do not re-derive

HO 304 pinned the B4 box body to a fixed height (the RACES tab's footprint, the mock used ~318px) with a flex column so both tabs share one height and switching HEARINGS↔RACES doesn't jump the box:

```
.body { height: <races footprint>; display: flex; flex-direction: column; }
.cal  { flex: 1 1 auto; min-height: 0; }
```

It kept the per-day cap at six rows + "+N more". That's the latent bug. Six two-line meeting rows plus the "+N more" line are taller than the pinned grid region, and `.cal` has `min-height:0` but **no** `overflow:hidden` — so `min-height:0` lets flex shrink the track while the content still paints outside it. On a heavy day the column escapes the box instead of being clipped.

The pin is deliberate and stays. **Do not** remove it (that brings back the tab-switch jump HO 304 fixed) and **do not** let the dashboard box grow to fit its tallest column (that's the `/hearings` free-height behavior, not the dashboard tab). The fix reconciles the cap to the pin and adds the missing clip.

## Confirm live first

Grep before touching; the `/mnt/project` copy and these docs lag the repo.

1. The B4 box body in the v2 page / its component. Confirm it's height-pinned with the flex column from HO 304, read the actual pinned px value, and confirm whether the grid region (`.cal`, the 5-col wrapper) already has `overflow:hidden`. The bug says it does not.
2. The per-day cap value and where it's enforced (the `OnTheHillBand` grid / day-column render). HO 304 says six.
3. Whether the calendar is one shared component across `/dashboard-v2` and `/hearings` (HO 306 says it is) or two. This decides where the fix lands.

## Fix

Two parts, both scoped to the dashboard tab's pinned context.

1. **Clip the pinned grid.** Add `overflow:hidden` to the grid region (`.cal`, the 5-col wrapper) inside the pinned body. This is the backstop: no day column can paint outside the box onto the weekly strip / BREAKING / MOVERS again, regardless of cap math. The `min-height:0` from HO 304 was necessary but not sufficient; the clip is what was missing.

2. **Make the tallest column fit.** With the clip in, an over-height column would get a row chopped mid-height and could hide "+N more". So bring the **dashboard** per-day cap down to the number of whole rows that fit the pinned grid height with the "+N more" line still fully visible. Measure against the live row height; don't hard-code blind. From the capture the grid region holds about five two-line rows: cap 4 + "+N more" fits with margin, cap 5 is marginal. Pick the largest cap where the tallest realistic day shows whole rows plus a visible "+N more" and nothing crosses the box bottom. Each day column reads: header (fixed) → rows (fill, clipped) → "+N more" pinned at the column bottom when over cap. "+N more" stays clickable and still deep-links to `/hearings` focused on that day (HO 271 acceptance #4); the clip must not eat it.

## Scope guard

- `/dashboard-v2` HEARINGS tab only. The `/hearings` page calendar is free-height and must stay unbounded and unclipped — do not apply the pin, the clip, or the lowered cap there. If the calendar is the shared component (HO 306), gate the clip + lowered cap behind the same dashboard variant/prop that already pins the box; the base component and `/hearings` keep growing and keep the higher cap.
- RACES tab unchanged; both tabs keep the shared pinned height, no jump on switch.
- `/` untouched.

## Constraints

- Mono house style, existing tokens, no new vars. Static, no transitions.
- Named `git add` per commit, eyeball the diff. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

Confirm on `/dashboard-v2`: the HEARINGS tab's tallest day column (WED this week) now ends inside the box — whole rows plus a visible, clickable "+N more" — with nothing painting over the weekly line, BREAKING, or MOVERS; switching HEARINGS↔RACES still doesn't jump the box height; `/hearings` still grows freely and shows its full per-day cap; build clean; `verify:deploy` SHA matches HEAD; `/` untouched. State the cap you landed on and the pinned height you confirmed.
