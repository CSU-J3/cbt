# 271 — v2 HEARINGS tab content (Piece 2 of 3)

Fills the HEARINGS panel of the tabbed races box (270) with the this-week committee calendar — the same content as the standalone On the Hill band (HO 266/269) — and removes the standalone band. This completes the supersession.

## Source of truth

The approved spec block below plus the existing `OnTheHillBand` component (HO 266/269) are the source of truth. `dashboard-v2-tabbed-words.html` is structural reference only; mock data is fabricated. Existing tokens, no new tokens. v2 route only.

## Supersession (the completing half)

The band content moves **into** the HEARINGS tab; the standalone `OnTheHillBand` render in `app/dashboard-v2/page.tsx` is **removed**. Recall the slot distinction: the tabbed races box sits above the weekly line, the standalone band sat below it (HO 269). After this, hearings on the dashboard is only the tab — the below-weekly band slot is vacated. **Do not build both.**

## Depends on

HO 263 (hearings data layer, live) and Piece 1 (270, the box shell).

## Phase 1

No new probe. The per-day cap = 5 was already confirmed during the band build (HO 265/266: max single weekday this week = 8 → cap 5 holds with `+N more`). The cap carries over unchanged.

## The change

1. Render the band content inside the HEARINGS panel. Reuse `OnTheHillBand` — the tab label replaces the band's own `ON THE HILL · THIS WEEK` title, so keep the sub-bar (live callout + `N MEETINGS · → HEARINGS`) and the grid, and suppress the standalone title (a variant/prop on the component, since the tab carries the label).
2. Remove the standalone `OnTheHillBand` render from the v2 page's below-weekly slot.

## Approved design spec (source of truth)

```
## Approved design — v2 races box: HEARINGS tab content

Layout: The HEARINGS panel = this-week (Mon–Fri) committee calendar, the same
content as the locked ON THE HILL band, housed in the tab (the tab label
replaces the band title).

Blocks:
- Sub-bar: green `● LIVE NOW · time · short title · committee` callout when a
  meeting is live; right-aligned `N MEETINGS · → HEARINGS` (links to /hearings).
- 5-col Mon–Fri grid (minmax(0,1fr)): day header (DOW + DOM + count; today amber
  + amber top edge), then meeting one-liners.
- One-liner: left tick (markup --accent-amber, else --border-strong) ·
  `[● live] time (right-aligned 46px) · title (ellipsis) · +N bills`.
  Cap 5/day + `+N more`.

Interactions: `→ HEARINGS` and `+N more` go to /hearings (latter focused on the
day). Static; no expand inside the tab.

Constraints: full-width (5 cols need the width; the box is full-width); desktop;
static; existing tokens.

Open questions: per-day cap = 5 (heavy days collapse to `+N more`).

Depends on: HO 263 hearings data layer; Piece 1 (the box shell).
```

## Acceptance

1. The HEARINGS tab renders the this-week Mon–Fri calendar — live callout when a meeting is live, `N MEETINGS · → HEARINGS`, 5-col grid, one-liners (tick, right-aligned time, title ellipsis, `+N bills`), cap 5/day + `+N more`, today highlighted.
2. The tab label replaces the band's standalone title; the rest of the band treatment is unchanged.
3. The standalone On the Hill band is **gone** from the v2 page (its below-weekly slot is vacated). Do not build both.
4. `→ HEARINGS` and `+N more` deep-link into `/hearings` (latter focused on the day) via the existing `hill-day-<key>` anchors, untouched.
5. Existing tokens, no new tokens.
6. Ship per HO 252: push, then `npm run verify:deploy` until the deployed SHA matches HEAD.
7. Single commit: `feat: v2 hearings tab content (HO 271)`.
