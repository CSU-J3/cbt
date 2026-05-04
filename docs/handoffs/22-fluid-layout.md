# Handoff 22: Fluid full-width layout

## Goal

The page is currently capped at `max-w-6xl` (1152px) and centered, which leaves large empty margins on wide displays. Remove the cap so the feed uses the full window width and resizes fluidly when the window is resized.

## Change

Find the outermost layout container in `app/layout.tsx` (or wherever the `max-w-*` lives — possibly in individual page files like `app/page.tsx`). It's almost certainly `max-w-6xl mx-auto` plus some horizontal padding.

Replace `max-w-6xl mx-auto` with `w-full` and keep modest horizontal padding (`px-6` or whatever's already there). The grid columns inside `BillRow` and `SponsorRow` already use `1fr` for the title/name column, so they'll absorb the extra width automatically.

Apply to:

- The main page container wrapping every route (`app/layout.tsx` is the most likely single edit point)
- `HeaderBar` if it constrains width independently
- `FooterLegend` if it constrains width independently

If the cap is set per-page in `app/page.tsx`, `app/stale/page.tsx`, etc., do the edit at the layout level if possible so it applies everywhere in one change.

## What this means at very wide widths

On a 2400px+ display, bill titles in the `1fr` column will stretch wide. That's fine for readability of long titles, but if it ever feels too sparse, the follow-up fix is to add `max-w-[1200px]` to specifically the title column inside `BillRow` — not to re-cap the whole page. Don't do that prophylactically.

## Files to touch

- `app/layout.tsx` — most likely the only file
- Possibly `components/HeaderBar.tsx`, `components/FooterLegend.tsx` if they have their own width caps
- `.claude/skills/cbt/SKILL.md` — note in the design system section that the layout is full-width fluid, not capped

## Acceptance

- Resizing the browser window from 1000px to 2400px shows the feed expanding to fill width at every step.
- No empty margins on either side of the page (beyond the small horizontal padding).
- Bill row grids stretch the title column to absorb extra width; fixed columns (BILL, STAGE, ACTION, TOPICS) stay the same width as set in handoff 20.
- Header bar and footer legend span the full width too — no orphaned narrower components.
- All pages (`/`, `/stale`, `/president`, `/sponsors`, `/watchlist`, `/bill/[id]`) get the new layout.
- `npm run typecheck` clean.

## Don't

- Don't add a new max-w cap at any larger breakpoint. The user wants fluid; let it be fluid.
- Don't change grid column widths from handoff 20. Only the outer container changes.
- Don't add a sidebar, secondary panel, or any new layout structure. Same single-column feed, just wider.

## Cost note

Zero.
