# HO 179 — Reflow chrome fixes (on ho-178, before merge)

## Why

The HO 178 reflow is fundamentally sound — masthead prose-right, 56/44 body, races 2×2 + hover popover (runoff + candidates render great), breaking hover-expand, activity expand all work. But the eyeball surfaced four **chrome bugs** in the masthead + dual tapes that must be fixed before merge. All four are on the `ho-178-dashboard-reflow` branch.

## The four bugs

### 1. Two blinking cursors at once (desktop)
The masthead shows a `_` after the title (`Congress Terminal:\>_`) AND a `_` at the end of the prose simultaneously. The spec: cursor at **prose end when ≥700**, cursor on **title end only when <700** — never both. The `<700` title cursor isn't being hidden at ≥700. It's a conditional-render/CSS-visibility bug: only ONE cursor should show at a given breakpoint.
- **Fix:** ≥700 → prose cursor only, title cursor hidden. <700 → prose removed, title cursor only. Confirm exactly one blinks at every width.

### 2. Tape "AS OF {time} UTC" meta overlaps the last ticker
On BOTH tapes, the right-aligned `AS OF 7:38 PM UTC` meta paints over the last scrolling symbol (e.g. "XLK 197.8|AS OF", "VIX...|AS OF"). The scrolling track runs under the meta.
- **Fix:** the meta needs to sit above the track with a solid background (so the scrolling content is hidden behind it), OR the track must clip/end before the meta's left edge. The meta should be a fixed right-anchored element with an opaque bg matching the tape, and the marquee scrolls *behind* it cleanly. Confirm no symbol text bleeds through/under the meta on either tape.

### 3. Both tapes too sparse
At 9 (equities) and 8 (commodities) symbols, the tapes have large empty gaps between symbols — they read sparse, not dense. Diagnose which: (a) per-symbol width pins over-reserving (dead space inside slots), (b) item padding/gap too generous, or (c) the track is shorter than the viewport so there's a blank stretch before the loop repeats (the duplicate-half hasn't entered yet).
- **Fix:** tighten so each tape reads dense and continuous. If it's (c) — track shorter than viewport — the fix is to ensure enough duplication that content always fills the visible width (the marquee should never show empty track). Report the cause, then fix. **Constraint: must stay jump-proof** (per-symbol pins stay static; tightening padding/gap is safe, don't reintroduce value-dependent widths).

### 4. Tape hover popover renders BEHIND the bottom tape
An equities-tape (top) hover popover opens downward and renders behind the commodities (bottom) tape — the "Industrials · — · as of..." popover was clipped behind the lower tape. With two stacked tapes, each tape is its own stacking context, so the top tape's popover (z-60 *within its own context*) loses to the bottom tape's context.
- **Fix:** the popover must escape both tapes' stacking contexts and render above everything in the tape block. Options: hoist the popover's stacking context to the tape-block container (so both tapes' popovers share one context above the nav); or for the TOP tape, open the popover downward but ensure its z-index beats the sibling bottom tape (may require the tape-block wrapper to establish the context, not each tape). Evaluate whether the bottom tape's popover (opening down) clears the nav too. Report the cleanest stacking fix so any popover from either tape sits above both tapes + the nav.

### 5. Remove the `?` LegendBadge from the masthead
The `?` popover beside the title (the `LegendBadge` — PARTIES / BILL TYPES / ACCENT, extracted in HO 162) is no longer wanted. HO 167 moved the stage/topic color keys into the chart panels, and the party-dot / bill-type meanings are self-evident enough that the badge is clutter.
- **Fix:** remove the `LegendBadge` from the masthead and clean up its now-unused component/import if nothing else references it (confirm it's not used elsewhere before deleting the component file — just remove the masthead usage if it is). The masthead title row is then just the prompt + (prose to the right).

## Phase 1 — Diagnostic (HALT after)

1. **Cursor:** read the masthead cursor render logic (the ≥700 prose cursor + <700 title cursor). Report why both show at once and the fix (conditional render or CSS `display` per breakpoint) so exactly one shows.
2. **Tape meta overlap:** read the `.markets-tape-meta` + track layout. Report why the meta overlaps the track and the fix (opaque bg + stacking, or track-clip-before-meta).
3. **Sparse tapes:** measure — is it dead-space-in-pins, padding/gap, or track-shorter-than-viewport (the loop gap)? Report the actual cause with the per-tape track width vs viewport width, then the fix.
4. **Popover stacking:** read the two-tape mount + popover positioning + z-index/stacking contexts. Report the fix to hoist popovers above both tapes + nav.
5. **LegendBadge:** confirm whether `LegendBadge` is referenced anywhere besides the masthead. If masthead-only, remove the component + usage; if shared, just remove the masthead usage.

**HALT. Report all four causes + fixes. These are tightly scoped chrome fixes — if any is trivial/obvious you can fold the report briefly, but confirm the sparse-tape cause (3) and the stacking fix (4) specifically, since those have a wrong-fix risk. Wait for sign-off.**

## Phase 2 — Implementation (after sign-off)
- Fix all four per Phase 1.
- Preserve: jump-proof geometry (both tapes), hover-pause, hover popover content, the <700 behaviors, charts.

## Verification
- Exactly one cursor blinks at every width (resize across 700 to confirm the swap).
- Neither tape's meta overlaps a ticker; symbols scroll cleanly behind the meta.
- Both tapes read dense (no large empty gaps); still jump-proof through 2+ poll cycles.
- A hover popover from EITHER tape renders above both tapes + the nav (not clipped behind the bottom tape).
- The `?` LegendBadge is gone from the masthead; no orphaned import/component.
- Type check passes.
- Stay on ho-178; Corey re-eyeballs, then the whole reflow (178 + these fixes) merges to main as one unit.

## Also confirm (not a bug, just unverified)
- Breaking hover-overrun: the hover-expand works (full headline on opaque overlay), but a long-enough headline overrunning INTO the races column + dimming races to 0.4 wasn't visually confirmed (the tested headlines fit the left column). Confirm the cross-column overrun + `:has()` dim trigger on a long headline — if they don't fire, report (may be a separate small fix).

## Out of scope
- No body/chart changes (the 56/44 reflow is good).
- No new symbols/data.
