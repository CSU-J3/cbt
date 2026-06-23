# HO 282 — B4 box equal tab height + calendar fill

From the approved B4 spec. Two related changes to the tabbed box (HEARINGS | RACES): pin its height so tabs don't resize it, and make the hearings calendar fill that height. Races tab unchanged.

Locate the tabbed box and its two tab panels (HEARINGS calendar, RACES content); grep.

## 1. Equal tab height

Pin the box content height to the RACES tab's footprint (the competitive/primaries sub-tabs + battlefield + four cards), not an arbitrary fixed taller value. The HEARINGS tab renders into that same height. Result: switching HEARINGS <-> RACES never resizes the box or shifts the week strip (B5) below it.

Pick the mechanism that fits the current structure (measure the RACES panel and pin the box min-height to it, render RACES to set the floor, or an equivalent). The constraint: the height equals the RACES footprint, not a hardcoded value, and it's stable across tab switches.

## 2. Hearings calendar fills the height

The day grid stretches to the box bottom so the calendar occupies the pinned height instead of leaving dead space below:

- Each day caps at 6 meetings (up from the current 5) with comfortable row spacing, then a `+N more` line linking to the Hearings page when a day runs longer.
- Busy days fill out their column. Light days (1-2 meetings) sit top-aligned with a small gap below, reading as a quiet day. Empty days show a per-day `NO MEETINGS` label.
- Today keeps its amber top border (unchanged).

Note: the per-day `NO MEETINGS` here is the empty-column label, separate from the subbar's `NO MEETINGS SCHEDULED` fallback from 273. Don't conflate them.

## Constraints

- Races tab content and behavior unchanged.
- No data changes; box sizing and calendar layout only.

## Ship

Commit the height-pinning and the calendar-fill separately if cleanly separable, else one named commit. `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify: switch HEARINGS <-> RACES and confirm the box height holds and the week strip doesn't shift; the calendar fills on a busy day and top-aligns cleanly on a light/empty day. If the current week has no day over 6 meetings, note that the cap/`+N more` path couldn't be exercised live.
