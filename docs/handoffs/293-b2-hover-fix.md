# HO 293 — B2 tape hover box: placement fix

Symptom (Corey's prod screenshot): hovering a MARKETS item (SPX), the box drops below the item and lands on top of the ODDS strip and the nav, tangled with live content instead of floating in clear space. Only `+1.06% · as of 2026-06-18` is legible; the name and the 292 hook line aren't visible.

The tape is two thin strips packed between a stats line and the nav, so "drop below the hovered item" has nowhere clean to land — a MARKETS-strip item's box drops onto the ODDS strip, an ODDS-strip item's box drops into the nav.

## Diagnose first

Find the tape hover component and confirm the actual cause before changing anything:
- Is the box portaled to `<body>`, or does it render inside the tape/marquee container (overflow:hidden for the scroll would clip it)? 286's weekly-band tooltip portals to body — use the same escape if this one doesn't.
- Background: solid or semi-transparent? A see-through box over a strip is part of why it reads as tangled.
- z-index relative to the strips and the nav.
- Anchor: is it positioned below the hovered item, or below the whole tape?
- Is the 292 hook line actually rendering for this item (the screenshot doesn't show it; could be clipped, or the map key may not match the roster key for SPX)?

## Fix

Confirm against what you find, but the target shape:
- Anchor the box below the entire two-strip tape block, at the hovered item's x-position. That keeps it pointing at the right item while never covering a strip, whichever strip the item is on.
- Solid opaque background so it cleanly occludes whatever's beneath (nav/content) instead of blending.
- z-index above both strips and the nav; portaled to body so no tape-level overflow clips it.
- Once it shows in full, confirm the 292 hook line renders. If it doesn't, check the hook map key against the roster's actual key for the item.

## Ship

Commit (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify on prod: hover a MARKETS item and an ODDS item, at a few positions across the scroll. The full box (name, value/change, as-of date, hook line) must show in clear space, opaque, above everything, never overlapping a strip or the nav.
