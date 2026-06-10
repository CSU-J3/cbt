# HO 166 — Race card expand drawer (full hub inline)

## Why

The competitive-races strip (HO 163) renders 4 cards that link out to `/race/[id]`. We want each card to **expand in place** into the full race-hub content — the same drawer affordance the activity rows got (HO 164) and the bill rows have (HO 148). Clicking a card opens the complete `/race/[id]` view inline rather than (or before) navigating away.

## Design intent (decided)

- **Full hub inline.** The drawer shows everything `/race/[id]` shows: rating block (multi-source chips), incumbent card, candidate roster (from `race_candidates`, ordered won_primary → running → declared → withdrew → name, withdrawn dimmed), days-to-election countdown, source URL + last-verified date.
- Single-open within the strip (one card expanded at a time), matching the activity/bill accordion behavior.
- A `full race page →` link inside the drawer (real `<a href={/race/[id]}>` so cmd/middle-click opens the hub in a new tab), same pattern as the bill drawer's `full bill page →` chip.

## Phase 1 — Diagnostic (HALT after)

Don't build yet. The key risk is duplicating the `/race/[id]` page wholesale instead of reusing it. Establish reuse, then halt.

1. **Read `app/race/[id]/page.tsx`.** Report how the hub renders its content: is the rating block / incumbent card / candidate roster already broken into reusable components (e.g. `RaceIncumbentCard` is a known client island per SKILL), or is it inline JSX in the page? List what's componentized vs. inline.

2. **Identify the reusable unit.** Determine whether there's a clean "race hub body" component that can be rendered both on `/race/[id]` and inside the dashboard drawer, or whether one needs to be extracted. **Strongly prefer extracting a shared `RaceHubBody` (or similar) over copying the JSX** — we don't want two copies of the race view drifting apart. Report the cleanest extraction boundary.

3. **Data for the drawer.** The card currently has `getMostCompetitiveRaces` output (raceId, ratings, chamber, incumbent*). The full hub needs more: candidate roster (`getRaceCandidates`), the race row (`getRace`), days-to-election. Report what the drawer must fetch on open vs. what the card already has. Propose: lazy-fetch the extra hub data on first expand (like the bill panel fetches committees/news), cached per-card so re-opening doesn't refetch — reuse the `useSingleOpenPanel` pattern from HO 164 if it fits, or a parallel race-specific version.

4. **Accordion mechanism.** `CompetitiveRacesBlock` is currently a server component (it renders links). To get single-open expand it needs client state. Report whether to make `CompetitiveRacesBlock` a client island or wrap the cards in a small client accordion component (preferred — keep the data fetch server-side, hand the cards to a client wrapper that holds expand state). Mirror the HO 164 Path B approach (server fetches, client wrapper holds state + lazy-loads the panel).

5. **Layout reality.** The cards are in a 4-across grid (`.competitive-races-grid`). An expanded drawer under one card in a 4-col grid is awkward — expanding card 1 would either push the whole row down or the drawer needs to span full width below the grid row. Report how the bill/activity drawers handle the "expand inside a multi-column layout" case and propose the cleanest behavior here (likely: the drawer spans full-width below the card's grid row, `grid-column: 1/-1`, similar to how `.bill-expanded-panel` spans the compact grid).

**HALT. Report findings + the proposed extraction + accordion + layout approach, and wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

Based on Phase 1:

- Extract the race-hub body into a shared component used by both `/race/[id]` and the dashboard drawer. Don't copy JSX.
- Make the cards expandable: client wrapper holds single-open state, lazy-fetches the full hub data on first open, caches per-card. Reuse `useSingleOpenPanel` if it fits the shape.
- The drawer renders the full race-hub body + a `full race page →` link.
- Layout: the expanded drawer spans full-width below its grid row (`grid-column: 1/-1` or equivalent), so the 4-col grid stays intact and the drawer reads cleanly. Match the bill/activity drawer's full-width-span behavior.
- Single-open across the strip; clicking another card closes the first.
- Preserve the card's existing link-to-`/race/[id]` as the `full race page →` affordance (cmd/middle-click still opens the hub in a new tab).

## Verification

- Show the diff.
- Confirm clicking a race card expands the full hub inline (rating, incumbent, candidate roster, countdown, source/verified), single-open.
- Confirm `/race/[id]` still renders correctly using the extracted shared component (no regression to the hub page).
- Confirm the 4-col grid layout stays intact when a drawer is open (full-width span, no broken grid).
- Type check passes.

## Out of scope

- No new race data sources (no polling/margin — the drawer shows what `/race/[id]` shows today).
- No change to `/race/[id]`'s routing or the strip's data sort (Senate-led mix stays).
- No color-key changes (HO 167).
