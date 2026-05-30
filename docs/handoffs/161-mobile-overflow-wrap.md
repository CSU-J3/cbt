# 161 — Mobile overflow: wrap-static across four surfaces

## What this is

The design project's overflow-convention decision. Four surfaces have horizontal content that can overflow a narrow viewport. The convention is **wrap-to-multiple-lines, static, no motion** — one rule, one documented exception (the markets tape stays desktop-only). The scroll-x-with-fade alternative was declined specifically to avoid opening a sub-1024 motion exception; wrap is fully static and keeps the no-motion-below-1024 rule intact.

This fixes one real latent bug (`HeaderBar` nav has no overflow handling) and makes the other three degrade identically, so every horizontal strip in the app wraps the same way on a phone.

## The four surfaces

1. **GroupTabs** (landing sub-nav strip) — `flex-wrap`, gap-consistent, active/first tab stays top-left. No scroll, no truncate.
2. **Filter bars** (feed + members chips) — `flex-wrap`. This is **already the <700 behavior** per the existing media block, so confirm-and-tidy, not change. Add consistent chip height + gap so wrapped rows stay tidy. No `+N` collapse.
3. **HeaderBar `.header-nav`** (6 items) — add `flex-wrap` to match `.home-header-nav`. **This is the actual fix** — the HO 160 sweep found `.header-nav` has no flex-wrap and no scroll fallback, so it clips rather than degrades if nav grows. Both nav elements should degrade identically after this.
4. **Markets tape** — **no change.** Stays desktop-only (hidden <700 per commit 4c15a64). Not resurrected this pass. Listed here only so it's explicit it was considered and deliberately left cut.

## Step 1 — Audit (mandatory, quick — no formal HALT)

Read the real classes and current state before editing. The HO 160 sweep updated SKILL.md with the real nav class names — read the live SKILL.md and source, don't trust this handoff's class names if they differ.

- Confirm `.header-nav` (HeaderBar) lacks `flex-wrap` and `.home-header-nav` (HomeHeader) has it — the asymmetry the sweep flagged. Confirm the exact class names.
- Confirm GroupTabs' real class (`.group-tabs`? read the component) and whether it currently wraps, scrolls, or clips at <700.
- Confirm the filter-chip class and that it already wraps at <700 (existing media block) — this surface is likely already correct and just needs the tidy (consistent height/gap), not a wrap addition.
- Report what each of the three editable surfaces does today vs. the wrap target, so the diff is known before applying.

If any surface already wraps correctly, say so and leave it — don't re-add what's there.

## Step 2 — Apply

- **HeaderBar `.header-nav`**: add `flex-wrap: wrap` (match whatever `.home-header-nav` uses — same gap/row-gap treatment so they look identical wrapped). This closes the clip bug.
- **GroupTabs**: add `flex-wrap: wrap` if it doesn't already; ensure consistent `gap`/`row-gap` so wrapped tabs align; active/first tab lands top-left naturally (wrap is left-to-right, so first item is already top-left — confirm no reorder needed).
- **Filter bars**: confirm existing wrap; add consistent chip height + gap if wrapped rows look ragged. No structural change if already wrapping cleanly.
- **Markets tape**: nothing. Confirm it's still hidden <700 and leave it.

All edits live inside the `<700` (or `<1024` if the tablet band also needs it — check whether these overflow at 700–1023 too, not just <700) media blocks. Desktop ≥1024 untouched.

## Constraints

- Desktop ≥1024 unchanged — wrap behavior is narrow-band only.
- **No sub-1024 motion exception** — wrap is static, no scroll easing, no fade. The approval gate was declined; don't add motion.
- No new color tokens.
- `MobileNavDrawer` stays dormant — it's the future fallback if nav ever outgrows two wrapped lines. Don't wire it in here.
- Tap targets unchanged — wrapping is layout-only, no interaction change.

## Out of scope

- Resurrecting the markets tape on mobile (separate future call).
- Any `+N`/truncate/collapse affordance — the convention is wrap, not hide.
- Scroll-x anything — declined.
- 15b (feed accordion / members scatter) and 15c (touch tooltips) — separate passes.
- The `MobileNavDrawer` — dormant, untouched.

## Acceptance

1. Step 1 audit posted: real class names, current state of each surface vs. wrap target, which surfaces already wrap.
2. `HeaderBar .header-nav` wraps at narrow bands, matching `.home-header-nav`'s treatment — the clip bug is closed.
3. GroupTabs wraps (flex-wrap, consistent gap, first tab top-left); no scroll, no truncate.
4. Filter bars confirmed wrapping cleanly; chip height/gap tidied if needed.
5. Markets tape unchanged (still desktop-only).
6. All edits inside narrow-band media blocks; desktop ≥1024 pixel-unchanged.
7. No motion added; no new tokens.
8. `npm run typecheck` and `npm run build` clean.
9. `SKILL.md` updated: the wrap-static overflow convention, the four surfaces and their dispositions, the markets-tape exception, and that the `.header-nav` clip bug is closed.
10. Single commit: `feat: mobile overflow wrap convention across nav/tabs/filters (HO 161)`.

## Notes

- **Why wrap over scroll-x.** Scroll-x with an edge fade is denser and more terminal-appropriate, but the fade/easing is motion, and the app holds a hard no-motion-below-1024 line. Wrap costs vertical space but stays static, so it needs no exception. The design call was that the vertical-space cost is cheaper than cracking the motion constraint for a whole class of surfaces.
- **The HeaderBar nav is the only real bug here.** GroupTabs and filters either already wrap or wrap trivially; the tape is left alone. `.header-nav` is the one with no fallback — it fits six labels today but clips the moment nav grows. This handoff is mostly "make the other surfaces match the one correct nav, and fix the one broken nav."
- **Ragged wrap is a styling fix, not a convention change.** If filter chips wrap unevenly (varying widths), the answer is fixed chip height + tighter gap, handled here if it shows up. It's not a reason to reconsider wrap vs scroll.
- **Don't trust this handoff's class names.** The HO 160 sweep is the current source of truth for nav/tab/chip class names — read the live SKILL.md and components, work from real names.
