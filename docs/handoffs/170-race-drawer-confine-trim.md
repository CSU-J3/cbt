# HO 170 — Race drawer: confine to column + trim to preview

## Why

HO 166 shipped the race-card drawer as a full-width block below the 4-across strip, rendering the complete `RaceHubBody` (rating block + incumbent photo card + candidate roster + verified footer + full-race link). Seen live it's too heavy — ~400px of near-`/race/[id]` content dropping below the whole strip. Two changes fix it together:

1. **Confine the drawer to the clicked card's column** — it opens directly under that card, the other three columns stay put. No full-width block.
2. **Trim the drawer to preview content** — rating chips + candidate roster + `full race page →`. Drop the incumbent photo card and the verified-date footer (those live on `/race/[id]`).

The two reinforce each other: a single-column-width drawer (~280px) can't hold the photo card gracefully, and trimming makes the narrow drawer tidy. Doing only one (confine-but-keep-full-hub) just trades a wide-heavy drawer for a tall-cramped one.

This modifies HO 166's `CompetitiveRacesStrip` + `RaceHubBody` + the strip CSS. Ground against the post-166 state (the drawer is currently a full-width sibling after `.competitive-races-grid`, using `useSingleOpenPanel<RaceHubData>` + `/api/race/[id]/hub`).

## Phase 1 — Diagnostic (HALT after)

The layout mechanism is the risk (HO 166 Phase 1 flagged that anchoring a drawer under a specific card in a wrapping grid needs grid-row math). Don't build yet.

1. **Read the current `CompetitiveRacesStrip` + the `.competitive-races-grid` / `.competitive-race-drawer` CSS** (post-166). Report how the drawer is mounted today (full-width sibling after the grid) and how single-open state maps a drawer to a card.

2. **Column-confined mechanism.** Determine the cleanest way to make the drawer open *inside the clicked card's grid column*, under that card, without disturbing the other three columns. Options to evaluate:
   - The drawer becomes a child of the card cell; the row uses `align-items: start` so the expanded column grows taller while neighbors stay their natural height (leaving empty space below the short cards — confirm that reads acceptably, not broken).
   - Or each card+drawer is its own grid item and the drawer renders within it.
   Report which is cleanest for this grid and how it behaves at the responsive breakpoints (`repeat(4,1fr)` → `repeat(2,1fr)` ≤1023 → `1fr` ≤700). At 1-col the "column" is full width anyway, so the confined drawer naturally becomes full-width-under-the-card there — confirm that's the behavior.

3. **Preview content shape.** `RaceHubBody` currently renders the full hub. Determine the cleanest trim: a `compact`/`preview` prop on `RaceHubBody` that hides the incumbent photo card + verified footer (keeping rating + candidate roster + full-race link), OR a separate lighter `RaceHubPreview` component. **Prefer the prop** — keep one component, one source of truth, so the hub page (`/race/[id]`) renders full and the drawer renders preview from the same component. Report which fields the preview keeps vs. drops:
   - **Keep:** rating chips (multi-source), candidate roster (status-ordered, withdrawn dimmed), `full race page →` link.
   - **Drop (in preview only):** incumbent photo card, "view member profile" link, source URL + last-verified footer.
   - Confirm the candidate roster fits a ~280px column (names + party, may need to wrap or truncate — report how it lays out narrow).

4. **Data fetch.** With the photo card dropped, does the preview still need the incumbent `Member` from `/api/race/[id]/hub`? If the preview doesn't render the photo, it may not need `getMember` — report whether the hub endpoint can stay as-is (over-fetching slightly) or trim. **Lean: leave the endpoint as-is** (it backs the full hub too via the shared component path) unless trimming is trivial — don't over-optimize a working endpoint.

**HALT. Report the confined-layout mechanism, the preview-prop approach, and the narrow-column candidate layout, then wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

Based on Phase 1:

- **Confine the drawer to the clicked card's column.** Implement the Phase-1-agreed mechanism so the drawer opens under its card, neighbors undisturbed, row uses `align-items: start` (or equivalent). At ≤700 (1-col) it's naturally full-width under the card.
- **Trim to preview** via a `preview` prop on `RaceHubBody` (hides photo card + verified footer; keeps rating + candidates + full-race link). `/race/[id]` keeps rendering the full body (no `preview` prop); the drawer passes `preview`.
- Keep single-open, the `full race page →` link (real `<a href>`), and the `useSingleOpenPanel` wiring from 166.
- Narrow-column candidate roster: lay out per Phase 1 (wrap or truncate names cleanly at ~280px).
- Match dashboard density, no new color tokens.

## Verification

- Show the diff.
- Confirm clicking a card opens a drawer **confined to that card's column**, neighbors undisturbed, at desktop (4-col).
- Confirm the drawer shows preview content only (rating + candidates + full-race link), no photo card or verified footer.
- Confirm `/race/[id]` still renders the FULL hub (the `preview` prop is drawer-only) — regression check on the shared component.
- Confirm the responsive collapse (4→2→1) behaves: the confined drawer stays under its card at each breakpoint.
- Type check passes.

## Out of scope

- No change to `/race/[id]`'s full rendering (only the drawer trims).
- No change to the strip's data (Senate-led mix stays).
- No hover behavior — this stays click-to-expand.
