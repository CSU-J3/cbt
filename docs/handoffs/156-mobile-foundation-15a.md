# 156 — Mobile foundation (spec 15a)

## What this is

The foundation pass for mobile. It sets the breakpoint vocabulary, the header collapse rules, and the global chrome tokens (gutter, title/nav/subhead font sizes) that every later mobile pass (15b–15d) inherits. It does **not** touch feed rows, scatters, filter bars, tooltips, or tickers — those are 15b–15d. This pass is the skeleton the rest hang on.

Desktop (≥1024px) ships **pixel-unchanged**. This pass only adds the two lower bands.

## Breakpoints (two lines, not four)

- **<700px** — phone, single column
- **700–1023px** — tablet: wrap, don't collapse
- **≥1024px** — desktop, unchanged from current

Reuse the existing **700px** line (the members two-scatter stacking from spec 7 is already specced against it). **Do not introduce a third breakpoint.** If a child element needs intermediate behavior, express it inside these two lines, not with a new media query.

## Phase 1 — Diagnostic (HALT for sign-off)

Read real artifacts, post findings, stop. No implementation.

### A. Current header markup

Read the actual header component (likely `components/HeaderBar.tsx`, but confirm — the dashboard redesign HO 126/131/133/140 may have restructured or renamed it). Report:

- The real DOM structure: title, subhead/sync line, nav (primary row + secondary STALE·CHANGES·PRESIDENT·WATCHLIST row), and the lead-in prose block with the blinking-cursor terminal idiom (spec #1).
- Where each piece lives — same component, or is the lead-in a separate component the page composes above the header?
- Current font sizes and gutter for title, nav, subhead (so the desktop ≥1024px values can be frozen exactly, not guessed).
- How the two nav rows are currently laid out (flex, grid, stacked divs?) — this determines how the wrap and the hamburger collapse attach.
- Whether the blinking cursor is CSS animation or JS, and confirm it's scoped so it can be gated to ≥1024px.

### B. Global chrome surfaces

The gutter token applies app-wide, not just the header. Find where the current page gutter is set (SKILL.md line 242 says `px-4` on `w-full` containers across pages, `HeaderBar`, `FooterLegend`). Report whether gutter is a single shared value/class or repeated per-page, so the three-band gutter can be applied in one place rather than scattered.

### C. Existing breakpoint usage

```
grep -rn "max-width: 700\|min-width: 700\|max-width: 1023\|min-width: 1024\|@media" app/globals.css components/
```

Report every existing media query. SKILL.md line 246 documents a `@media (max-width: 700px)` block (date column hidden, stage short-form, topics first+N, filter chips wrap). Confirm the new bands compose with that existing block rather than fighting it — the 700px line must stay the single source.

### D. Report format

1. Real header component name + DOM structure of each piece (title, subhead, nav rows, lead-in).
2. Current desktop font sizes + gutter (the values to freeze).
3. Nav layout mechanism (how the wrap + hamburger attach).
4. Blinking-cursor implementation + gating feasibility.
5. Gutter: single shared value or scattered.
6. Existing media queries + confirmation the new bands compose with the 700px block.
7. Proposed Phase 2 file list + where the hamburger drawer state lives (it's the one client interaction in this pass).

### HALT. Wait for sign-off.

## Phase 2 — Implementation (after sign-off)

### Header collapse (in death order as width shrinks)

- **Lead-in prose** ("Congress saw N stage transitions…") + its blinking-cursor terminal idiom: visible **≥1024px only**. Hidden below both bands.
- **Subhead**: full (`· LAST SYNC HH:MM MT · 15,903 BILLS TRACKED`) at ≥700px; abbreviated to `· HH:MM MT · 15,903 BILLS` below 700px (drop `LAST SYNC` and `TRACKED`).
- **Title** `Congress Terminal:\>`: one line at all widths, no wrap, no truncate. `:\>` stays `--accent-amber`.
- **Nav**:
  - ≥1024px — single combined row as today (primary row + secondary STALE·CHANGES·PRESIDENT·WATCHLIST row stacked, unchanged).
  - 700–1023px — nav wraps via `flex-wrap`; secondary nav inlines after primary on the wrapped block.
  - <700px — both rows collapse into one hamburger drawer.

### Global chrome tokens (app-wide)

| Token | <700 | 700–1023 | ≥1024 |
|---|---|---|---|
| Page gutter | 12px | 16px | current desktop value (read in Phase 1, freeze) |
| Title font-size | 19px | 21px | 22px |
| Nav font-size | 10.5px | 10.5px | 10px |
| Subhead font-size | ~9.5px | ~9.5px | ~9.5px |

All existing palette tokens unchanged. **No new color tokens.** These are sizing/spacing values; put them where the existing chrome values live (CSS vars or per-band media queries on the real classes, per Phase 1's gutter finding).

### Hamburger drawer (<700px)

- Tap the hamburger toggles a drawer that slides the full nav list (primary + secondary items) **down below the title**. Vertical disclosure, not a horizontal scroll strip — scroll hides items with no affordance, which is the thing this avoids.
- **Animation: instant show/hide (`display` toggle), not a slide.** Per the spec's static constraint and its own recommendation. A tap-triggered disclosure reading instant is deliberate (same as the chevron rotate), not broken. This does **not** become a sanctioned motion exception; the static-below-1024px rule holds. If touch testing in a later pass says the instant toggle reads as broken, 15c revisits it.
- **Dismiss (minimal, this pass only):** tapping a nav item closes the drawer (navigation dismisses it), and tapping the hamburger again closes it. **Tap-outside-to-dismiss and an explicit close glyph are deferred to 15c**'s global touch convention. This pass ships a usable drawer with an exit; it doesn't pre-decide 15c.
- **15c coupling flag:** the drawer's open/close convention must align with whatever 15c lands as the global touch-toggle convention. Note this in SKILL.md so 15c doesn't ship a conflicting pattern.

### Motion constraint

Static below 1024px. The blinking-cursor lead-in is the sole motion exception and it's desktop-only (gated ≥1024px), so **no motion ships below 1024px**. The drawer is an instant toggle, not motion.

### Desktop freeze

≥1024px is pixel-unchanged. Verify the desktop band renders identically to current — the two new bands are additive media queries, they must not alter any ≥1024px value. The Phase 1 frozen font sizes/gutter are the reference.

## Out of scope

- Feed rows / accordion mobile behavior (15b).
- Members two-scatter stacking, scatter touch tooltips (15b/scatter pass).
- The HO 147 tooltip primitive's mobile equivalent (15c).
- Filter bars / segmented toggle wrapping (15b).
- Markets tape + breaking-news marquee on touch (15d).
- Tap-outside dismiss + close glyph for the drawer (15c).
- Light mode (never).
- Any change to desktop ≥1024px.

## Acceptance

1. Phase 1 report posted with all seven sections; header structure + frozen desktop values + drawer-state location signed off before Phase 2.
2. Two media bands added (<700, 700–1023); the existing 700px block is reused, no third breakpoint introduced.
3. Header collapses per the death-order rules at each band; title stays one line at all widths; `:\>` stays amber.
4. Nav: combined rows ≥1024, flex-wrap 700–1023 with secondary inlined, hamburger drawer <700.
5. Global chrome tokens applied app-wide at the three bands per the table.
6. Hamburger drawer: instant show/hide, vertical disclosure, dismisses on nav-item tap and hamburger re-tap.
7. Blinking-cursor lead-in gated ≥1024px; no motion renders below 1024px.
8. Desktop ≥1024px pixel-unchanged (verified against frozen Phase 1 values).
9. `npm run typecheck` and `npm run build` clean.
10. `SKILL.md` updated: the two-band breakpoint vocabulary, the header collapse rules, the global chrome token table, and the drawer convention with its 15c coupling flag.
11. Single commit: `feat: mobile foundation — breakpoints, header collapse, chrome tokens (HO 156, spec 15a)`.

## Notes

- **This is the foundation 15b–15d inherit.** The breakpoint vocabulary (two lines, 700px reused) and the gutter/font bands set here are what every later mobile pass references. Getting the vocabulary clean matters more than any single visual call in this pass — a sloppy third breakpoint or a scattered gutter would compound across 15b–15d.
- **Why instant drawer, not slide.** The static-below-1024px constraint is a deliberate identity choice (terminal aesthetic, no ambient motion). A hamburger drawer is a discrete tap response, not ambient motion, so an instant `display` toggle stays inside the constraint while still reading as intentional. Treating it as a motion exception would be the camel's nose — easier to hold the line and let 15c revisit with real touch data if needed.
- **Why the drawer needs a dismiss now even though 15c owns the convention.** Shipping a drawer that opens but can't close (pending 15c) is a broken state, not a deferral. The minimal exit (nav-tap + hamburger re-tap) is the floor; 15c adds the richer convention (tap-outside, close glyph) on top without conflicting.
- **Title never wraps or truncates.** `Congress Terminal:\>` is the brand mark; it holds one line at 19px on the narrowest phone. If Phase 1 finds a width where 19px overflows the narrowest realistic viewport (~320px), flag it — don't silently shrink below 19px.
