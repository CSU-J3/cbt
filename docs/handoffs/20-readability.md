# Handoff 20: Readability pass — bump font sizes

## Goal

The current Bloomberg-aesthetic font sizes are too small for comfortable reading on a personal dashboard. Bump everything roughly 15–20% while preserving the hierarchy and density that make the design work. This is a global typography pass, not a one-spot tweak.

## Approach

Audit first, scale uniformly, fix grid overflow second.

### Audit

Find every font-size declaration (or Tailwind text-* class) in the codebase. Likely places:

- `app/globals.css` (CSS vars, base styles, `.sponsor-row`, `.sponsor-header-row`, `.sponsor-expanded-panel`)
- `components/BillRow.tsx`
- `components/SponsorRow.tsx`
- `components/HeaderBar.tsx`
- `components/StageIndicator.tsx`, `TopicTags.tsx`, `FooterLegend.tsx`
- Filter dropdowns: `StageFilter.tsx`, `TopicFilter.tsx`, `PartyFilter.tsx`, `StateFilter.tsx`, `SearchBox.tsx`, `SortDropdown.tsx`
- Page-level files: `app/page.tsx`, `app/stale/page.tsx`, `app/president/page.tsx`, `app/sponsors/page.tsx`, `app/watchlist/page.tsx`, `app/bill/[id]/page.tsx`

Group what you find into tiers. Roughly:

- **Micro** — column headers, party badges, stage indicator labels, topic tag text, footer legend. Currently around `text-[10px]`/`text-xs` ish.
- **Body** — bill row content, sponsor row content, dropdown labels, search input. Currently around `text-xs`/`text-sm` ish.
- **Title** — bill titles in rows, page subtitles. A notch above body.
- **Summary** — expanded summary paragraphs on `/` and `/bill/[id]`. Need both size and line-height bumps; reading prose at 12px with 1.2 leading is the worst of it.

### Scale

Bump each tier roughly 15–20%. Concrete suggestion (adjust to whatever Tailwind classes already exist in the project):

- Micro: `text-[10px]` → `text-[12px]`
- Body: `text-xs` (12px) → `text-sm` (14px)
- Title: `text-sm` (14px) → `text-base` (16px)
- Summary: `text-sm` (14px) → `text-base` (16px), AND line-height from default to `leading-relaxed` (1.625)

These are illustrative; don't blindly apply. Read the current values, scale proportionally, keep relative hierarchy intact (micro stays smaller than body, body smaller than title).

### Fix grid overflow

Larger fonts will break the existing column grids. Specifically watch:

- `BillRow` grid `24px 70px 1fr 90px 80px 110px` — bill IDs like `119-hjres-12` will overflow 70px at the new size; `OTHER CHAMBER` stage label will overflow 90px; date column will overflow 80px.
- `SponsorRow` grid `24px 1fr 40px 50px 80px 110px` — bill count column probably fine, latest-action date column tight.

Bump fixed columns proportionally — 70 → 84, 90 → 108, 80 → 96, 110 → 130 — or convert to `min-content` / `auto` where the content is the natural arbiter (stage labels, party badges).

The 24px expand-arrow column doesn't need to change.

### Filter row and header

The header bar's `X OF Y BILLS` count line and the filter dropdowns should bump in lockstep with body text. Don't let the count line outsize the bills it's counting; if anything, the count line can be a notch larger than body since it's the page's anchor.

## Don't touch

- Don't change colors. This is a typography pass, not a contrast pass.
- Don't change layout structure. Same grids, same component composition.
- Don't change the monospace numeric columns. Keep `font-mono` on bill IDs, dates, days-since, bill counts.
- Don't introduce new CSS files or a typography utility module. Inline / Tailwind / existing globals only.
- Don't add a font-size toggle in the UI. One global setting; if the new size is wrong, that's a follow-up handoff, not a feature.

## Files to touch

Whichever ones the audit surfaces. Likely all of the components and CSS files listed above. Don't be surprised if it's a 15+ file diff.

`.claude/skills/cbt/SKILL.md` — update the design system section to reflect the new size tiers. The CSS color vars stay as documented.

## Acceptance

- Every page (`/`, `/stale`, `/president`, `/sponsors`, `/watchlist`, `/bill/[id]`) reads visibly larger.
- No text is cut off, wrapped unexpectedly, or pushed onto multiple lines in the bill or sponsor row grids.
- Summary paragraphs in expanded rows have noticeably more breathing room (line-height bump).
- Hierarchy preserved: column headers still read as smaller than body, body smaller than titles.
- Count lines, filter dropdowns, and search input all scale together — nothing looks orphaned at the old size.
- `npm run typecheck` clean. (Probably nothing for typecheck to catch in a pure styling change, but run it anyway.)

## Cost note

Zero.
