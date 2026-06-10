# HO 175 — Markets tape: kill the 60s scroll reset + hover-to-expand + size bump

## Why

Three things on the markets tape:

1. **The whole tape visibly jumps back to start every ~60s (BUG, priority).** That's the poll interval — HO 172's 60s `setInterval` poll of `/api/markets/latest` is restarting the scroll animation, the exact thing HO 172 claimed to prevent ("map fresh prices onto existing items keyed by symbol so React reconciles in place — the animated track never remounts, the marquee duration re-measured only on item-count change"). It's still resetting, so that design isn't holding in the deployed code. This needs real diagnosis against the current code, not an assumption that HO 172 worked.

2. **Hover-to-expand (new).** Hovering a ticker should show more detail — full instrument name + the day's change (and range if available). New feature. (Note: HO 172 added hover-to-*pause* via CSS `:hover` → `animation-play-state: paused`. That stays — the expand detail is additive, on top of the pause.)

3. **Bigger.** Bump the tape's font size / row height a bit — it reads small.

## Phase 1 — Diagnostic (HALT after)

The reset bug is the crux. Diagnose it against the actual current `MarketsTapeClient.tsx`, don't assume HO 172's described behavior is what's running.

### The 60s reset (find the real cause)
1. Read the current `MarketsTapeClient.tsx` end to end. Trace exactly what happens on each 60s poll tick:
   - Does `setCurrentTicks` (or whatever holds the polled data) cause the **animated track element to remount**? Look for: a `key` on the track that changes when data updates; the track being conditionally re-rendered; the poll result replacing the whole items array (new object identities) so React re-creates the `<g>`/item nodes instead of reconciling them.
   - Does the **measured `animationDuration` re-compute on the poll**, even when item count is unchanged? HO 172 said it re-measures "only on item-count change" — verify that's actually how the effect deps are written. A `useEffect` that re-runs on every `currentTicks` change (not just count) would reset the inline `animationDuration`, restarting the CSS animation.
   - Does the `ResizeObserver` fire on the poll-driven re-render (layout thrash) and re-measure, restarting the animation?
   - Is there a `useEffect` cleanup that resets/re-applies the animation on data change?
   Report the **exact line(s)** causing the restart. The most likely culprit: the animation restarts because either the keyframe-bearing element remounts, or its `animation`/`animationDuration` inline style is reassigned on the poll tick (reassigning the animation shorthand restarts it even to the same value).

2. **Propose the fix** so polled value updates change ONLY the text content of existing item nodes, never touching the track's identity, its `animation`/`animationDuration`, or triggering a re-measure. Options to evaluate: stable `key`s per symbol; updating only the price/change text via refs or memoized children so the track wrapper never re-renders; decoupling the measure effect so its deps are `[itemCount]` (or a measured-width that only changes on count), never the values. Report the cleanest approach for this code.

### Hover-to-expand
3. Report how each ticker item is currently structured (the `<span>`/`<a>` per symbol). Propose the expand-on-hover: a tooltip/popover showing full instrument name (e.g. "ITA" → "iShares U.S. Aerospace & Defense ETF") + day change %, and the day range if `market_ticks` carries high/low (check — it may only store close). Report what detail data is actually available per tick (does the row have more than price + change_pct?). If only price + change exist, the expand shows full-name + change, not a range — don't promise data that isn't there.
   - The full-name mapping (symbol → display name) — is there an existing map (the tape must label them somehow), or does it need a small lookup added? Report.
   - Hover-expand must NOT fight hover-pause: hovering pauses the scroll (good — lets you read) AND shows the detail. Confirm they compose (pause + tooltip on the same hover).
   - Must not cause the reset bug's cousin — a hover state change shouldn't restart the animation either.

### Size bump
4. Report the current tape font-size / height / item padding (CSS). Propose a modest bump (e.g. +2px font, proportional height) that stays within the Bloomberg-dense aesthetic and doesn't break the `<700px` hidden rule or the marquee measurement.

**HALT. Report: the exact cause of the 60s reset + the fix, the available per-tick detail data + the hover-expand approach, the full-name lookup situation, and the size-bump values. Wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

- **Fix the reset** per Phase 1 — polled updates touch only value text, never the track identity/animation/measurement. This is the acceptance bar: the tape must scroll continuously through multiple poll cycles with no visible jump.
- **Hover-to-expand** — tooltip with full name + change (+ range only if the data exists), composing with the existing hover-pause. Reuse the HO 147 Tooltip primitive if it fits the tape's inline/marquee context; if the marquee/animation makes the HO 147 tooltip awkward (it's a moving target), report and use the simplest robust approach (e.g. a CSS-positioned popover on the item, or pause-then-show). Don't break the scroll.
- **Size bump** per Phase 1 values.
- Preserve: hover-pause, reduced-motion, the staleness check, the `<700px` hidden rule, the 60s poll itself (just stop it from restarting the scroll).

## Verification

- Show the diff.
- **The reset:** confirm (structurally + describe) that a poll tick updates values without restarting the animation — the deps/identity analysis from Phase 1 should prove it. Corey will eyeball that the tape no longer jumps every 60s (the live confirmation).
- Hover a ticker → detail shows, scroll pauses, no animation restart.
- Confirm the size bump renders and `<700px` still hides the tape.
- Type check passes.

## Out of scope
- No new tick data source (if range isn't in `market_ticks`, the expand shows full-name + change only).
- No change to the cron / poll interval.
- No live-primary feature (parked).
