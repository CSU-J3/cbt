# 150 — Dashboard composition (spec 1)

## What this is

Spec 1 (#1, #2, #3) from the design session: the dashboard reflows into a single-column chrome stack (masthead → tape → nav) over a full-width BREAKING strip and a two-equal-column content grid, with the old third column removed. It also folds in the trimmed color key (#2) and the BREAKING truncation/flush fix (#3).

Most of the pieces already exist — the masthead/lead, the HO 149 tape, the HO 147 `ColorKeyStrip`, the HO 132 stage/topic bubbles, the ACTIVITY / TOP STALLS tabs, the BREAKING block. This handoff is the layout reflow that arranges them per spec 1, plus the six-item nav, not a from-scratch build. The risk is reconciliation: the dashboard has been through HOs 131, 133, 134, and 149, so the current structure has to be read and mapped before anything moves.

This also updates the shared nav to the six top-level items confirmed in planning: **Dashboard · Feed · Members · Patterns · Reports · Watchlist**. Per-page masthead parity, sub-route active states, and the tape-everywhere decision stay with the cleanup audit (HO 154).

## Phase 1 — Diagnostic (HALT for sign-off)

Read the current dashboard and its blocks, post a current→target mapping, stop. No layout changes.

### A. Current dashboard structure

Read `app/page.tsx` and report the current block layout as it stands after HOs 131/133/134/149: the chrome stack order, how many content columns, what's in each, and where the HO 149 tape currently sits. Spec 1's target is masthead → tape → nav → full-width BREAKING → two-equal-column grid (left: STAGE over TOPIC; right: ACTIVITY / TOP STALLS tabs). Map current to target block by block: what moves, what stays, what gets removed (the third column), what's new.

### B. Masthead / lead

Confirm the current masthead: the `Congress Terminal:\>` prompt line, the weekly-summary prose (the `writeDashboardLead` output), and the sync subhead. Spec 1 wants them fused into one monospace command line — `Congress Terminal` in `--text-primary` ~18px, `:\>` in `--accent-amber`, the summary prose inline in mono ~15px `--text-muted`, ending in a blinking `--accent-amber-bright` underscore (~1.1s step-end). Report what renders today and whether the blinking underscore already exists or is new. The prompt line is monospace by decision (CMD/PowerShell look), not sans — confirm current font.

### C. Color key (HO 147 reconciliation)

HO 147 shipped `ColorKeyStrip` with the LEGEND `?` badge that pops PARTIES / BILL TYPES / ACCENT. Confirm what it renders *inline* today: spec 1 #2 wants STAGES + TOPICS inline only, boxed top-right ~172px, with the `?` covering the rest (already built). Report whether the inline content is already trimmed to STAGES + TOPICS, and whether the prior BILL TYPES row rendering glitch (#2 mentions it) is already gone or still needs fixing in this pass.

### D. BREAKING block (#3 fix)

Read the current BREAKING block. Report two things spec 1 #3 calls out: does it truncate the headline (the fix wants headline at highest flex priority so it never truncates, bill ID ~110px `--accent-amber`, then source + relative date), and does its border stretch into a tall empty box when there are few items (the fix wants the border to cap flush to the last row / VIEW ALL NEWS). Describe the current structure so Phase 2 knows whether it's a flex-rule tweak or a bigger rework.

### E. Content grid + its blocks

Report the current grid (column count, widths). Confirm the components exist and their current homes: STAGE DISTRIBUTION, TOPIC DISTRIBUTION (the HO 132 bubble cluster), ACTIVITY, TOP STALLS. Spec 1's target: two equal columns (1fr / 1fr), left stacks STAGE over TOPIC (bubbles at full half-width so small topics read), right is ACTIVITY / TOP STALLS tabs. The shorter column caps flush to its content — no height-matched empty border. Note whether the third-column content being removed needs to go somewhere or is genuinely dropped.

### F. Tape + nav

Confirm the HO 149 tape sits between masthead and nav and won't break in the reflow. Confirm whether the nav is a single shared component (so updating it to six items propagates app-wide from one change) or per-page. Report the current nav items so Phase 2 maps them to the six-item target.

### G. Below-grid slot

Spec 6 puts a weekly-report snapshot strip below the two-column grid (the freed "whatever else" slot). That's HO 153, not this handoff. Confirm there's a clean place below the grid to slot it later; Phase 2 reserves the space, doesn't fill it.

### Report format

1. Current→target block mapping (the load-bearing output).
2. Masthead state + what's new (blinking underscore, font).
3. ColorKeyStrip inline state + whether the trim/glitch is already done.
4. BREAKING current structure + scope of the #3 fix.
5. Grid current state + the third-column disposition.
6. Tape position confirmed + nav shared-vs-per-page + current nav items.
7. Proposed Phase 2 scope: files, what moves, any token needs (expected: none).

### HALT. Wait for sign-off.

## Phase 2 — Implementation (after sign-off)

Per spec 1 and the Phase 1 mapping:

### Chrome stack

Masthead (fused mono command line + sync subhead) → HO 149 tape → six-item nav. Masthead prose wraps in the width left of the color key, which is boxed top-right ~172px.

### Full-width BREAKING

Below nav, full width. Headline at highest flex priority (never truncates); bill ID `--accent-amber` ~110px; source + relative date trailing. Border caps flush to the last row / VIEW ALL NEWS — no stretched empty box.

### Two-equal-column grid

1fr / 1fr. Left column stacks STAGE DISTRIBUTION over TOPIC DISTRIBUTION (bubbles at full half-width). Right column is the ACTIVITY / TOP STALLS tab block. Shorter column caps flush to content. Old third column removed.

### Nav

Update the shared nav to six top-level items: Dashboard · Feed · Members · Patterns · Reports · Watchlist. Active item uses the existing `--accent-amber-bright` treatment. Sub-route active states (highlighting Members when on `/committee`, etc.) and full per-page parity are HO 154 — here, just land the six items and confirm they render on the dashboard.

### Interactions (preserve existing)

Legend `?` hover popover (HO 147). Stage bars and topic bubbles keep their `?stage=` / `?topics=` click-to-filter (HO 132 in-place rebase). Cursor blink and the tape marquee are the only motion.

### Below-grid slot

Reserve the area below the grid for the HO 153 reports snapshot. Don't fill it.

## Out of scope

- The reports snapshot strip itself (HO 153 / spec 6) — only the reserved slot.
- Per-page masthead/header parity across non-dashboard routes, sub-route active states, tape-everywhere — all HO 154 cleanup.
- Mobile layout. Deferred to the #15 mobile pass.
- Any change to the bubble charts' internals, the BREAKING data layer, the lead-generation pipeline, or the tape component. This is layout composition; the blocks are consumed as-is.
- New tokens or new motion. Topic colors from `lib/topic-colors.ts`.

## Acceptance

1. Phase 1 mapping posted; current→target reconciliation signed off before any layout change.
2. Dashboard renders the chrome stack (masthead → tape → nav), full-width BREAKING, two-equal-column grid, no third column.
3. Masthead is one fused mono command line with the blinking `--accent-amber-bright` underscore and the sync subhead below; prose wraps left of the ~172px color key.
4. Color key shows STAGES + TOPICS inline with the `?` popover for the rest; no BILL TYPES rendering glitch.
5. BREAKING headline never truncates; border caps flush with no stretched empty box.
6. Grid columns are equal; left stacks STAGE over TOPIC bubbles at full half-width; right is ACTIVITY / TOP STALLS tabs; shorter column flush.
7. Nav shows the six top-level items with correct active treatment on the dashboard.
8. Tape unbroken in its masthead→nav position; click-to-filter and the legend popover still work.
9. `npm run typecheck` and `npm run build` clean.
10. `SKILL.md` updated with the dashboard layout (chrome stack, grid, the six-item nav) and a note that HO 154 owns per-page parity.
11. Single commit: `feat: dashboard composition (HO 150)`.

## Notes

- **Why a Phase 1 on a layout handoff.** The dashboard is the most-revised surface in the app (131, 133, 134, 149). Restructuring it blind risks fighting decisions those handoffs locked. The mapping step makes the reflow a known transform, not a guess.
- **The nav update propagates.** If Phase 1 confirms one shared nav component, changing it to six items here updates every page at once — which is fine and means HO 154 verifies parity rather than rebuilding the nav. If it's per-page, scope only the dashboard's nav here and HO 154 handles the rest.
- **Motion budget is now two things.** Cursor blink (masthead underscore) and the tape marquee (HO 149, opt-out-able). Nothing else animates. The grid reflow, BREAKING fix, and column-flush are all static.
- **Reserve, don't build, the snapshot slot.** Spec 6's reports snapshot wants the below-grid space. Building it here would couple two handoffs; leaving a clean slot keeps HO 153 independent.
