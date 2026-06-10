# HO 176 — Tape: tighten spacing + make hover popover readable

## Why

HO 175 killed the 60s scroll jump by pinning fixed `ch` slot widths (price 8ch, arrow 1.2ch, change 7ch) sized for the widest value. **The jump is confirmed fixed** — keep the width-pinning, it's load-bearing. But it has two cosmetic costs to fix:

1. **Spacing is off / uneven.** Sizing every slot for the widest value (GOLD ~4,483.70 needs 8ch) means small values (VIX ~15.32) sit in oversized slots with dead space, so the tape reads sparse and unevenly spaced.
2. **Hover popover isn't readable.** The detail popover (full name + change + "as of") is too small/low-contrast/cramped to read comfortably.

**Critical constraint: do NOT reintroduce the jump.** The jump came from item *width changing on a poll*. The fix is not "remove the pinning" — it's "pin each item to a tighter-but-still-stable width" so normal value fluctuation can't change width, without padding small values into oceans of space.

## Phase 1 — Diagnostic (HALT after)

1. **Spacing.** Read the current pinned-width CSS (the 8ch/1.2ch/7ch slots from HO 175) and the item gap/padding. Report what creates the visible dead space. Propose a tighter approach that keeps width **stable per item across polls** (so the jump stays dead) while removing the global over-pad. Options to evaluate:
   - **Per-symbol / per-format right-sizing:** pin each slot to the realistic max width for *that symbol's* value range (VIX ~5ch, GOLD ~8ch), not the global max. Tabular/`tabular-nums` + right-align so normal fluctuation never changes rendered width.
   - **Digit-boundary safety:** confirm whether any symbol realistically crosses a digit-count boundary between polls (e.g. 999→1,001). If so, that symbol's pin must accommodate its max digit count so it stays stable. Report which symbols are at risk (most won't move enough between polls to cross a boundary).
   - Report the cleanest way to get tight, even-looking spacing that's still jump-proof. The test: an observer should see evenly-spaced tickers, AND the track `max-content` width must stay constant across polls.

2. **Hover legibility.** Read the current `.markets-tape-detail` popover CSS. Report why it's hard to read (font-size, color/contrast, padding, width, background). Propose fixes: readable font-size, sufficient contrast against the dark panel (proper `--bg-panel`/`--text-primary` tokens, a border, maybe a subtle shadow for separation), comfortable padding, and a width that fits the full instrument name on one line (or wraps cleanly). The full name (`MarketTick.label`) must be clearly legible — it's the point of the hover.

3. Confirm both fixes preserve: the jump fix (stable per-item width), hover-pause, the `<700px` hide, reduced-motion, and the marquee measurement.

**HALT. Report the tighter-spacing approach (proving it stays jump-proof), the hover-legibility fixes, and the per-symbol width risk analysis. Wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

- **Spacing:** retune the slot widths per Phase 1 — tight and even, but each item's width stays stable across polls (the jump must NOT return). Use `tabular-nums` + right-align so digits don't reflow. Verify the track `max-content` width is still constant after first paint.
- **Hover:** make the popover readable per Phase 1 — legible font, proper contrast/border/background, comfortable padding, full name fits/wraps cleanly. Keep `position:absolute` + `pointer-events:none` so it can't reflow the track or re-trigger the jump.
- Keep the HO 175 size bump (38px/14px) and everything else intact.

## Verification

- Show the diff.
- **Jump regression (critical):** confirm structurally that per-item width is still stable across polls (the track `max-content` can't change) — this is the thing we must not break. Corey re-eyeballs the live no-jump through 2+ poll cycles.
- Spacing reads tight and even (Corey eyeballs).
- Hover popover is readable with the full name legible (Corey eyeballs).
- Type check passes.
- Run on the ho-176 branch (or continue on ho-175) so Corey can eyeball locally before merge — same hold-for-eyeball pattern as HO 175, since the jump regression risk means live confirmation before merge.

## Out of scope
- No change to the poll, cron, or data.
- No removal of width-pinning (it's the jump fix) — only retuning it tighter.
