# 270 — v2 races box → tabbed shell (Piece 1 of 3)

The v2 races block (battlefield + cards + primaries) becomes one tabbed box with HEARINGS | RACES top tabs, in the same slot the races strip holds now (below tapes/nav, above the weekly line). This is the shell; 271 fills the HEARINGS tab, 272 adds the RACES-tab badges.

## Source of truth

The approved spec block below plus the existing v2 components are the source of truth. `dashboard-v2-tabbed-words.html` is **structural reference only** — the battlefield, rich race cards, and primaries inside RACES are existing v2 components (HO 253–260); **re-house them as they are, do not rebuild** them to match the mock's schematic stand-ins. Existing tokens, no new tokens. v2 route only.

## Supersession

This revises Piece 3 of the hearings handoff. Combined with 271, it replaces the standalone On the Hill band (HO 266/269) with a HEARINGS tab inside this box. **Do not build both.** 270 builds the shell around the existing races content; 271 moves the band content into the HEARINGS tab and removes the standalone band.

## Run order

HEARINGS is the default tab and its content lands in 271, so **do not ship 270 alone** — an empty default tab would sit at the top of v2. Run 270→271 back-to-back, or temporarily default to RACES in 270 and flip to HEARINGS in 271. Recommended: pair them.

## Depends on

The v2 battlefield + cards + primaries already built (HO 253–260).

## Pre-flight (confirm live before re-housing)

1. The current v2 races box structure in `app/dashboard-v2/page.tsx` — which components render there (battlefield, rich race cards, the COMPETITIVE | PRIMARIES sub-tabs, primaries timeline) and how they're laid out, so re-housing into the RACES panel is a move, not a rebuild. Confirm the existing sub-tab mechanism so it nests under the RACES tab unchanged.
2. The slot: confirm the races box sits below tapes/nav, above the weekly line. Note this is a **different slot** from the standalone band's (HO 269 placed that band *below* the weekly line); 271 vacates that band slot. 270 works only on the races box above the weekly line.

## Phase 1 diagnostic — confirm the two interaction decisions before building

1. **Default top tab = HEARINGS.** Confirm locked. Rationale: races move little day-to-day, hearings change daily.
2. **Sub-tab memory.** Does the RACES sub-tab (COMPETITIVE / PRIMARIES) remember its last position across HEARINGS↔RACES top-tab switches? Recommend yes (persist). Confirm.

## Approved design spec (source of truth)

```
## Approved design — Dashboard v2 races box → tabbed (HEARINGS | RACES)

SUPERSEDES the standalone "ON THE HILL band" (Piece 3 of the hearings handoff).
Hearings now lives as a tab inside the v2 races box, not a separate band. Do not
build both. v2 route only.

Layout: The v2 races block (battlefield + cards + primaries) becomes one tabbed
box, in the same slot the races strip occupies now (below tapes/nav, above the
weekly line). Top tabs HEARINGS | RACES. RACES holds the existing
COMPETITIVE | PRIMARIES sub-tabs and their current content, unchanged.

Blocks:
- Box header (bg --bg-panel): top tabs HEARINGS | RACES. Active tab
  --accent-amber-bright with a 2px amber bottom border; inactive --text-dim.
- HEARINGS panel: see Piece 2.
- RACES panel: a sub-bar with COMPETITIVE | PRIMARIES sub-tabs (bracket-active,
  --accent-amber-bright on active) at left and the Election Day chip
  (NOV 3 · N DAYS · N seats) / PRIMARIES chip at right; below it the existing
  battlefield + rich cards (COMPETITIVE) or primaries timeline + cards
  (PRIMARIES), re-housed as-is.

Interactions: top-tab click swaps HEARINGS/RACES panels; sub-tab click swaps
COMPETITIVE/PRIMARIES and the chip text. Default top tab = HEARINGS (races move
little day to day; hearings change daily). Optional ?tab= / ?sub= params.

Constraints: v2 route; desktop; static except tapes + cursor; existing tokens;
re-house the existing battlefield/cards/primaries — do not redesign them.

Open questions: confirm default = HEARINGS; whether the sub-tab remembers its
last position across top-tab switches.

Depends on: the v2 battlefield + cards + primaries already built (HO 253–260).
```

## Acceptance

1. Phase 1 decisions confirmed in chat (default HEARINGS; sub-tab memory).
2. The v2 races box is a tabbed box with HEARINGS | RACES top tabs in the same slot; active tab styled per spec (amber-bright + 2px amber bottom border, inactive dim).
3. RACES panel holds the existing COMPETITIVE | PRIMARIES sub-tabs and their current content (battlefield + rich cards / primaries timeline + cards) plus the Election Day / PRIMARIES chip, re-housed unchanged — no visual regression vs current v2.
4. Top-tab click swaps HEARINGS/RACES; sub-tab click swaps COMPETITIVE/PRIMARIES and the chip; sub-tab position per the locked decision. Optional `?tab=` / `?sub=` params.
5. HEARINGS panel content lands in 271 — do not ship 270 standalone with an empty default HEARINGS tab (pair with 271, or temporarily default to RACES).
6. Existing tokens, no new tokens; existing race components unchanged.
7. Ship per HO 252: push, then `npm run verify:deploy` until the deployed SHA matches HEAD.
8. Single commit: `feat: v2 races box tabbed shell (HO 270)`.
