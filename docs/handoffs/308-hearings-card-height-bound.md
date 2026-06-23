# HO 308 — Hearings detail card: bound the card + title height

Confirm the next free number before saving (`ls docs/handoffs/ | sort | tail`). Body assumes 308; rename if taken.

## The bug

The HO 306 floating hearings detail card has a fixed ~340px width but no height bound. A committee meeting whose Congress.gov title is a full agenda of many measures (the omnibus business/markup meetings, e.g. the WED-17 Senate business item carrying +16 bills, whose title runs "S.4726, to promote efforts... S.3984, to authorize... S.4570, to incentivize..." for all sixteen) renders that entire run-on as the "full untruncated title," so the card grows vertically without limit and covers roughly half the screen.

## Scope

The shared HearingsCalendar floating detail card (HO 306), both surfaces. CSS/clamp only, no data change.

## Fix

1. **Cap the card height.** Give the card a max-height (viewport-relative, e.g. `min(70vh, <px>)`) with `overflow-y:auto`. Nothing on the card can exceed the viewport; a long card (long title or long related-bills list) scrolls internally. This is the backstop that kills the screen-eating case.
2. **Bound the title.** A giant agenda-title shouldn't bury the structured sections (COMMITTEE, DETAILS, RELATED BILLS) below it. Clamp the title to a sane number of lines (line-clamp ~4–6) so the rest of the card stays reachable without scrolling past a wall of text. The full agenda for these meetings is already in RELATED BILLS (the +N bills), so clamping the title loses nothing the card doesn't show elsewhere.

Keep the ~340px width and the portal / flip / anchor behavior from 306 unchanged.

## Premise

Confirm the card currently has no max-height and the title renders fully unclamped (the screenshot shows both). The omnibus meetings are the trigger; a normal one-line-title hearing is unaffected and should look identical after the fix.

## Constraints

- Mono house style, tokens only, no new vars. Static, no transitions.
- Don't touch the collapsed entry's 2-line title clamp (already bounded); this is the hover card only.
- Named `git add` per commit, eyeball the diff. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

Confirm: hovering the WED-17 (or any +N-bills omnibus) entry now opens a card bounded to the viewport with the title clamped and the COMMITTEE / DETAILS / RELATED BILLS sections visible; a long card scrolls internally rather than covering the screen; a normal one-line-title hearing's card is unchanged. Both surfaces. Build clean, verify:deploy SHA matches, `/` untouched.
