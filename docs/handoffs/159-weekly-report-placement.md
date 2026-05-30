# 159 — Weekly report up under breaking; archive row off dashboard

## What this is

The design project's IA decision (option A): the weekly-report snapshot — the HO 153 block currently sitting *below* the two-column grid — moves **up to directly under the BREAKING strip**, and the previous-weeks archive row (`PREVIOUS · dates · ALL →`) leaves the dashboard entirely.

The report is the only dashboard block that answers "WTF is going on in Congress?" in sentences. Breaking (72h) and the weekly report (7d) are the same kind of content at two time scales; stacked and both visible, they read as a pair. Today the report is the last block past a long scroll (worse on mobile, where everything single-columns), and it duplicates the nav REPORTS item. Moving it up fixes desktop and mobile in one DOM reorder.

This is placement only. **The report's content and generation (`writeDashboardLead` / the HO 153 snapshot query) are untouched.**

## Current dashboard order (from HO 150 / 153)

```
chrome stack (masthead → tape → nav)
  → full-width BREAKING
  → two-column grid (left: STAGE over TOPIC · right: ACTIVITY / TOP STALLS tabs)
  → weekly-report snapshot strip (HO 153)
  → previous-weeks archive row
```

## Target order

```
chrome stack
  → full-width BREAKING
  → WEEKLY REPORT snapshot          ← moved up
  → two-column grid (unchanged)
  (previous-weeks archive row removed)
```

Mobile single-column bands inherit the same DOM order stacked, so no separate narrow-band placement rule — the reorder fixes both at once.

## Phase 1 — Diagnostic (HALT for sign-off)

Short. Read real artifacts, post findings, stop. Two things genuinely shape Phase 2.

### A. Grid mechanics for the report block

Read `app/page.tsx` and the dashboard grid in `globals.css` (the HO 131/133/150 quadrant/two-column layout). Report:

- Where the HO 153 snapshot strip currently renders in the DOM and how it spans (full-width below the grid? its own row?).
- How BREAKING spans — it's full-width per HO 150. The report goes immediately after it; confirm the report block should match BREAKING's full-width span (my expectation: yes, full-width, so breaking + report stack as two full-width narrative blocks above the grid).
- Whether moving the block up is a clean DOM reorder (the grid is a separate wrapper the report sits outside of) or whether the report is currently *inside* the grid wrapper and extraction is needed. This is the one thing that decides if Phase 2 is a move or a small restructure.

### B. Archive-row disposition (relocate vs delete)

The design left this open with a clear tiebreak: **if the REPORTS page already lists past weeks, delete the dashboard archive row as redundant; if not, relocate it to REPORTS.**

Read the REPORTS page (confirm route — likely `app/reports/page.tsx`). Report whether it already renders a list/index of past weekly reports. Recommend delete (if REPORTS already has the archive) or relocate (if it doesn't). Don't implement either yet — just report which and why.

### C. Report format

1. Current DOM position + span of the HO 153 snapshot; is it inside or outside the grid wrapper.
2. BREAKING's span, and confirmation the report should match it full-width.
3. Move-vs-restructure call for getting the block above the grid.
4. REPORTS page: does it already list past weeks → delete-or-relocate recommendation for the archive row.
5. Proposed Phase 2 scope: files, the reorder mechanism, the mobile clamp.

### HALT. Wait for sign-off.

## Phase 2 — Implementation (after sign-off)

### Reorder

Move the HO 153 weekly-report snapshot block to render immediately after the full-width BREAKING strip and before the two-column grid. Full-width span matching BREAKING (per Phase 1 confirmation). The grid itself is unchanged — same two columns, same contents.

### Archive row

Per Phase 1's recommendation: delete from the dashboard (if REPORTS already lists past weeks) or relocate to the REPORTS page (if it doesn't). Either way it leaves the dashboard — it's navigation into history, not current narrative.

### Mobile height clamp (narrow bands only, <1024)

The report prose is tall; stacked second on a phone it would dominate the scroll. On the narrow bands, clamp the report block to its **first 1–2 paragraphs** with a `more →` link into the REPORTS page. Desktop (≥1024, column room) shows it full. Static clamp + link — **no motion exception** (no expand animation; the `more →` is a plain link to REPORTS, not an in-place expander).

- Implement the clamp with CSS (`line-clamp` or a max-height on the narrow-band media query), not JS, to stay static.
- The `more →` link target is the REPORTS page, not an in-dashboard toggle.

## Out of scope

- Report content / generation (`writeDashboardLead`, the snapshot query). Placement only.
- The two-column grid contents and layout (STAGE/TOPIC/ACTIVITY/TOP STALLS). Unchanged.
- Any tab or toggle coupling breaking + report. The design explicitly rejected tabbing — both visible by default.
- New color tokens. None.
- The markets tape and nav (shipped, untouched).

## Acceptance

1. Phase 1 report posted; grid move-vs-restructure call and archive-row delete-vs-relocate recommendation signed off before Phase 2.
2. Weekly-report snapshot renders directly under BREAKING, above the two-column grid, full-width.
3. Previous-weeks archive row no longer on the dashboard (deleted or relocated to REPORTS per Phase 1).
4. Two-column grid unchanged in contents and layout.
5. Mobile (<1024) clamps the report to 1–2 paragraphs with a `more →` link to REPORTS; desktop shows full; clamp is CSS, no motion.
6. Breaking + report read as a stacked narrative pair at the top, both visible by default, no tab.
7. `npm run typecheck` and `npm run build` clean.
8. `SKILL.md` updated: the new dashboard block order, the report-under-breaking placement, the archive-row disposition, and the mobile clamp rule.
9. Single commit: `feat: weekly report under breaking, archive row off dashboard (HO 159)`.

## Notes

- **This is moving HO 153's block, not building a new one.** The weekly-report snapshot already exists (HO 153, in the slot HO 150 reserved below the grid). This handoff relocates it. Naming it as a move keeps Phase 2 from re-deriving a report block that's already shipped.
- **Why full-width, not into the grid.** Breaking is full-width above the grid; the report is its narrative pair. Putting the report into a grid column would visually divorce it from breaking and shrink the prose into a half-width box. Full-width, stacked under breaking, keeps the two narrative blocks reading as a unit.
- **Why the mobile clamp links out instead of expanding in place.** An in-place expander on the dashboard would be a motion exception (and re-opens the expand-state question 155 just closed). The report already has a full home — the REPORTS page. Clamp + link-to-REPORTS keeps the dashboard static and sends depth-seekers to the surface built for it.
- **Archive row tiebreak is data, not taste.** Don't deliberate it — Phase 1 reads whether REPORTS lists past weeks and that answers it. Redundant → delete; absent → relocate.
