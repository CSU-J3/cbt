# HO 294 — B2 hover box: pop over the ticker, not below the nav

293 fixed the paint-over: the box is now portaled to body, opaque, z-1000, and shows full content. But it anchors below the entire `.dv2-tapes` block, and the nav sits below the tapes too, so the box lands far down over the HEARINGS / page content. It should pop out over the ticker instead.

Now that the box is portaled, opaque, and z-1000 (293), it can overlay the tape strips cleanly — it paints on top. So it no longer needs to drop below the whole block to avoid the sibling strip; the z-index and opaque background already handle that.

## Change

Re-anchor the box to overlay the ticker at the hovered item's x, popping out over the tape strips rather than below the tape+nav block. It should sit over the ticker near where you hover, on top, opaque. Don't let it land below the nav or over the page content.

Pick the exact vertical anchor that reads best (anchored to the hovered item or the ticker block, overlaying the strips), but it must pop over the ticker for items on BOTH strips, never over the nav. Keep everything else from 293: portal-to-body, position:fixed, z-1000, opaque background, clamped x.

## Ship

Commit (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify at a narrow and a normal width: hover a MARKETS item and an ODDS item; the box pops out over the ticker (overlapping the tape), on top, opaque, full content, never landing below the nav over the page.
