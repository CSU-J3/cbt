# 126 — Home reorganization per image 1 mockup

## What this is

Image 1 wireframe shows a tighter home page than what's live. Above the fold: LEAD + BREAKING (3 rows, down from 5). Below: a clean 4-quadrant block of STAGE DISTRIBUTION + ACTIVITY (with inline stage transitions per HO 125's compact BillRow) + TOP STALLS (new) + TOPIC DISTRIBUTION. The chart-heavy lower half of today's home disappears.

Three changes:

1. Add TOP STALLS as a new home quadrant. Top N bills by days-since-stage-change. Data already exists (powers `/stale`); new rendering on home.
2. Reorganize the existing three-pane row into a 4-quadrant block, contract BREAKING from 5 to 3 rows.
3. Drop or relocate the lower-half charts. BILLS INTRODUCED PER MONTH (HO 66), TOPIC MIX BY CHAMBER (HO 76), and COMPETITIVE RACES leave the home page. Competitive races already lives at `/races` (HO 84). The other two: move to a new `/trends` page or delete.

The BillRow vocabulary from HO 125 is in place; ActivityTicker already uses the compact variant. STAGE DISTRIBUTION, TOPIC DISTRIBUTION, and the new TOP STALLS slot into the new grid using the same tokens.

Multi-layer (page layout + new TOP STALLS component + possibly new `/trends` route). Phase 1 audits current home structure and proposes relocations. Phase 2 builds.

Prior art:
- HO 53 — dashboard shell foundation
- HO 54 — activity ticker
- HO 55 — topic distribution
- HO 57 — dashboard lead
- HO 66 — time-series chart (BILLS INTRODUCED PER MONTH)
- HO 76 — topic mix by chamber
- HO 81 — stage funnel (likely the STAGE DISTRIBUTION quadrant)
- HO 84 — races index
- HO 101 — 118 vs 119 chart (verify if this is on home today)
- HO 118 — BREAKING dedup
- HO 125 — BillRow + ActivityTicker compact variant

This is the second domino of the design-language pivot. BillRow set the row vocabulary; this sets the home layout vocabulary.

## Phase 1 — Diagnostic (HALT for sign-off)

### A. Current home layout audit

`app/page.tsx` — list every section in render order with component name and query helper. Expected (verify):

- Header bar
- LEAD section (HO 57)
- BREAKING · LAST 24H (HO 118 dedup, currently `limit=5`)
- Three-pane row: STAGE DISTRIBUTION | ACTIVITY · LAST 7 DAYS | (JUMP TO + TOPIC DISTRIBUTION on the right)
- BILLS INTRODUCED PER MONTH (HO 66)
- TOPIC MIX · BY CHAMBER (HO 76)
- COMPETITIVE RACES · 2026 block
- Footer / legend

### B. TOP STALLS data shape

`/stale` already shows bills by days-since-stage-change. Two paths:

1. Reuse `getStaleBills` with a `limit=5` param for the home quadrant. Cheapest, no new query.
2. New `getTopStallsForHome` query helper if home wants different filters (e.g., minimum days threshold, exclude ceremonial differently than `/stale` does).

Phase 1 picks one with rationale. Default lean: (1) with a small `limit` add.

### C. Lower-half charts destination

For each of BILLS INTRODUCED PER MONTH (HO 66) and TOPIC MIX BY CHAMBER (HO 76):

- Does the chart appear anywhere else today?
- Destination options after home drops it:
  - New `/trends` page hosting both
  - Fold into an existing page (`/feed`, `/changes`)
  - Delete entirely
- User preference voiced earlier: relocate, not delete. The data lens stays alive, just somewhere you opt into.

Phase 1 proposes a destination for each.

For COMPETITIVE RACES: confirm `/races` exists from HO 84. If so, just drop from home and add a JUMP TO or top-nav entry if not already linked.

### D. ActivityTicker readiness

HO 125 converted ActivityTicker to the compact BillRow variant. Image 1 shows stage transitions inline (e.g., `HR 1234 [D-NJ] → ▶ COMMITTEE`). Confirm:

- Does the current rendered ticker match image 1's visual, or are tweaks still needed?
- Compact variant has rail + title + StagePillStrip + sponsor strip. Image 1 looks aligned.

If it matches, no work here; if not, scope the deltas.

### E. Layout grid

Propose the new CSS Grid for the 4-quadrant block. Image 1 shows ACTIVITY taking more horizontal space than the other three. Likely shape:

```
grid-template-columns: 1fr 2fr 1fr 1fr
grid-template-rows: auto
```

Or a 2x2 grid where ACTIVITY spans two cells. Phase 1 picks based on the actual content density of each quadrant.

### F. JUMP TO sidebar

Image 1 doesn't render a JUMP TO sidebar — top nav handles all navigation. Live page has both, which is redundant.

Phase 1 confirms: drop JUMP TO entirely (recovering vertical space and matching the mockup), or keep it (some users may rely on the in-page sticky nav)? My lean is drop; the top nav already covers every destination.

### Report format

Post findings in chat. Sections:

1. Current home layout — component-by-component render order
2. TOP STALLS data path proposal
3. Lower-half charts destination per chart
4. ActivityTicker visual confirmation or deltas
5. Layout grid proposal
6. JUMP TO drop-or-keep decision

### HALT

Wait for sign-off on Phase 2 scope.

## Phase 2 — Implementation (after Phase 1 sign-off)

Shape depends on Phase 1.

### TOP STALLS component

New `components/TopStalls.tsx`. Renders top 5 bills by days-since-stage-change, using a compact display (rail + title + days-since indicator). Uses the chosen data path from Phase 1.

### Layout rewrite

`app/page.tsx`:
- Header (unchanged)
- LEAD (unchanged)
- BREAKING (`limit=3` from current `limit=5`)
- 4-quadrant block per Phase 1's grid proposal
- Footer

Remove BILLS INTRODUCED PER MONTH, TOPIC MIX BY CHAMBER, and COMPETITIVE RACES sections.

### Chart relocation

Per Phase 1's destinations. If `/trends` is new:
- `app/trends/page.tsx` hosts both charts
- Add to top nav and/or JUMP TO
- Header chrome matches CBT vocabulary (existing header pattern from other pages)

### CSS

`app/globals.css` gets the new 4-quadrant grid. Drop styles for removed sections (`.bills-per-month`, `.topic-mix-by-chamber`, `.home-competitive-races` or whatever the class names are).

If JUMP TO is dropped, remove its styles and the corresponding component from `app/page.tsx`.

### Verification

1. Home renders the new 4-quadrant block with all four quadrants populated
2. BREAKING shows 3 rows; HO 118 dedup behavior intact
3. TOP STALLS top entry matches `/stale` page's leader row
4. ActivityTicker continues to render with HO 125's compact BillRow
5. `/trends` (if created) renders the relocated charts cleanly
6. `/races` reachable from top nav (already present per HO 84) or JUMP TO if it survives
7. Type-check clean, no dead imports, no orphaned components in `components/`

## Out of scope

- BillRow design (HO 125 just landed)
- `/search` tabbed entity results (separate handoff)
- `/patterns` bubble cluster (separate handoff)
- New visualizations on `/trends` beyond moving the existing two charts
- Stage funnel internal rework (HO 81 territory; STAGE DISTRIBUTION just gets relocated, not redesigned)
- Mobile responsive audit (follows the design-language pivot generally; desktop ship for this handoff)

## Acceptance

1. Phase 1 report posted with all six sections
2. Sign-off obtained
3. Phase 2 implemented per sign-off
4. Home page renders the 4-quadrant block with TOP STALLS as a new quadrant
5. BREAKING contracted to 3 rows
6. Lower-half charts relocated or deleted per Phase 1 decisions
7. JUMP TO handled per Phase 1 decision
8. Type-check clean, working tree clean, pushed
9. Commit: `feat: home reorganization per image 1 mockup (HO 126)`

## Notes

- TOP STALLS as a new home surface answers a question the live page doesn't: "What's stuck?" Pairs with BREAKING ("What's moving?") to give the LEAD + BREAKING + STAGE + ACTIVITY + STALLS + TOPICS layout a complete WTF-snapshot view.
- The 5 → 3 BREAKING contraction is per the mockup. The full breaking list moves to wherever the news page lives (verify in Phase 1 — likely the existing `/news` or `/reports` route).
- If the JUMP TO sidebar is dropped, scan for any orphaned anchor IDs or in-page links that depended on it; remove or repurpose during Phase 2.
- HO 125's tooltip parity (bill type on rail, stage labels on pills, topic tags) applies automatically to TOP STALLS since it uses the same BillRow vocabulary. No new tooltip work.
- If Monday's `/api/sync` tick lands tight and the report split becomes HO 127, that's orthogonal to this handoff and ships on its own track.
