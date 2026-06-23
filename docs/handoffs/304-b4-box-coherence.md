# HO 304 — Dashboard v2 B4 box: coherence pass against the v3 mock

Confirm the next free number before saving (`ls docs/handoffs/ | sort | tail`). Body assumes 304; rename if taken.

## Scope

`/dashboard-v2` B4 box (the HEARINGS | RACES tabbed box) only. No data or query work beyond reading fields that already exist. Don't touch `/`.

## What this fixes

The B4 mock was retightened in v3 ("tighter height"). Two confirmed gaps where the live box lags it, plus one small badge fix. The "missing names in races" item is NOT in here, pending Corey pointing at the exact view; it lands as a follow-up or an add to this file.

## Resolved premises (confirmed from the live render)

- The live HEARINGS box runs taller than the RACES tab's footprint, leaving dead space below the capped meeting lists. The box height jumps when switching RACES → HEARINGS.
- The HEARINGS subhead left slot shows "NO MEETINGS SCHEDULED" while 17 meetings render in the grid below it. The string is describing today (a weekend, empty), sitting in the slot the mock uses for the week date range.
- The RACES cards and band already match the mock (four labeled markers, lean axis, rating line, war chest + market odds).

## Changes

### 1. Pin the box height to the races footprint (headline)

Grep the B4 box body first. If it's auto-height, or taller than the RACES content, lock it. The mock pins the body to a fixed height equal to the races footprint (it uses 318px) with a flex column so the calendar fills it:

```
.body { height: <races footprint>; display: flex; flex-direction: column; }
.cal  { flex: 1 1 auto; min-height: 0; }   /* grid stretches to the box bottom */
```

Both tabs then share one height, so switching tabs doesn't jump. HEARINGS loses its slack and the calendar fills to the bottom. Keep the per-day cap at six rows + "+N MORE" (already in the live). Light days keeping a small gap below is the intended read, leave it. Use the live races content height as the lock value; the mock's 318px is the reference, match whatever the RACES tab actually occupies.

### 2. HEARINGS subhead: week date range, not a today-status string

The left subhead should show the week date range the grid is displaying (the mock: `JUN 15 – 19`), not "NO MEETINGS SCHEDULED". Find where the subhead left text is set; it's currently pulling a today/empty status. Swap it for the week range that matches the grid's Mon–Fri window. The right side ("17 MEETINGS · → HEARINGS") is correct, leave it.

### 3. NJ-07 card badge: one badge, not two

The NJ-07 card shows both the INCUMBENT badge and the "2024 R+5.4" margin. The mock swaps one for the other (`.rb.mg` replaces the "Incumbent" badge with the margin). Match it: when a card shows a 2024-margin badge, drop the INCUMBENT badge on that card. The margin appears for NJ-07 only in both live and mock, so this is a single-card change.

## Out of scope

- Missing names in races: pending Corey's pointer to the exact view (PRIMARIES tab vs the challenger slot on the cards vs something else). Not in this pass.
- Typography: staying all-mono per the standing decision. The mock's `--sans` on meeting titles and candidate names doesn't ship.
- Casing on "competitive seats" in the band caption: leave it.

## Constraints

- Mono-only UI, tokens only, no new CSS vars.
- Named `git add` per commit, eyeball the diff. Stale `.next`: verify the stylesheet loads (no 404 on `layout.css`); `rm -rf .next` and restart if the dev server has been up a while. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

On `/dashboard-v2`: confirm the B4 box is the same height on both tabs with no jump on switch; the HEARINGS calendar fills to the box bottom with days capped at six; the HEARINGS subhead reads the week date range, not a "no meetings" string; and NJ-07 shows a single badge. State the height value you locked to. Confirm `/`'s feed is unchanged. Build clean, verify:deploy SHA matches.
