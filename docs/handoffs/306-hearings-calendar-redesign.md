# HO 306 — Hearings calendar redesign (shared: /hearings + v2 HEARINGS tab)

Confirm the next free number before saving (`ls docs/handoffs/ | sort | tail`). Body assumes 306; rename if taken.

## Scope

The hearings calendar as one shared component serving both `/hearings` (its calendar view) and the `/dashboard-v2` HEARINGS tab (B4, height-pinned). The redesign must not grow either surface: the grid height stays constant and all detail lives in a floating card, so the height-pinned dashboard tab and the free-height page both hold. Presentation plus one computed field (live status). The data is what the live page already reads; no new pipeline. `/`'s feed untouched.

This is the calendar from the "fill the day better" brief. The fill mechanism is richer entries (kind label, 2-line title, badges), not stretched rows; a quiet day still keeps a small honest gap, smaller now because each row carries more.

## First, establish two premises before building

1. Grep the existing hearings calendar. Determine whether `/hearings` and the dashboard HEARINGS tab already render through one component or two. If one, redesign it. If two, this redesign produces the shared one (or applies identically to both) so they can't drift. Report which.
2. Confirm the data the calendar reads carries committee, chamber, bill list (`meeting_bills`), stream URL, and livestream availability. The spec assumes all are present from the Congress.gov feed the live page reads. Any field actually absent drops from the card per the degrade rule, it doesn't block.

## Layout (top to bottom)

Filter bar, then week header (with delta stat), then week grid (5 columns Mon–Fri, multi-week stacks). One floating-card pattern carries all detail; the grid never reflows.

### Filter bar (one bordered row above the week header)

Two groups, no view toggle (calendar is the only view):
- TYPE: All · Hearings · Markups · Business
- CHAMBER: All · House · Senate

Selected option renders amber in brackets (`[Hearings]`); unselected muted. Brackets are CSS so only a class toggles. TYPE drives the week stat (count, noun, and delta all recompute). CHAMBER narrows the count without changing the noun.

### Week header

Left: "WEEK OF JUN 15". Right: the stat `{count} {TYPE-noun} {delta}`. ALL → "49 MEETINGS", HEARINGS → "17 HEARINGS ▼25". Delta is week-over-week, ▼ red down / ▲ green up, directional only.

Hover the stat → a floating tooltip (same card treatment, portaled, see the hover-card rules): amber label, then "This week N · last week (YYYY-MM-DD) M · ▼/▲delta". Reuse the B5 dashboard-strip WoW computation (this-week count, prior-week count + its week-start date), already built. Don't recompute it.

### Day columns

Header: DOW (dim) + DOM (secondary) + right-aligned per-day count. Empty days read "No meetings".

Today highlight: the current day's column header gets an amber-bright bottom underline (inset shadow, no height change) + DOW amber + DOM amber-bright + a small borderless "Today" tag, plus a faint amber wash (~4.5% alpha) down the whole column. Key off **ET** (the schedule's zone), not the MT sync stamp and not browser-local. Show it even when today has no meetings.

### Collapsed entry

Row = time + "HEARING" kind label + right-aligned badges. Title clamps to 2 lines. Badges: "+N bills" amber when bills attach; "● LIVE" red pip when status is Live. Entries with related bills get a 2px amber left border. No expand triangle, there's no inline open state.

## Hover detail card (floats as overlay, never affects layout)

~340px fixed width, not column-bound. Opens to the right of the entry, flips left near the right screen edge. Portal it to body at `position:fixed` with a high z-index, the same fix the B2 tape hover boxes needed (HOs 292–294): a card nested in the grid gets painted over by later siblings and can distort layout, so it must escape the grid's stacking context entirely. Anchor it with a few px of overlap to the entry so the pointer can cross from entry into card without dismissing, and inner links stay clickable.

Content mirrors the live hearings row, each field dropping (not an empty row) when it has no data:
- Chamber tag (SENATE / HOUSE)
- Full untruncated title
- WATCH: stream link + status text (scheduled livestream / live now / concluded · recording / no livestream)
- COMMITTEE: amber link with → arrow
- DETAILS: Type, Status, Where, When (ET) as label/value rows
- RELATED BILLS · N: only when bills exist, each row an amber ID chip + title, both linking to the bill

## Live state (computed, not stored)

Compute status at render from the hearing's start/end against current ET: Scheduled before, Live during the window, Concluded after. Live is the only status with a collapsed marker (the red ● LIVE pip); in the card it shows Status "Live" in red and a red "live now" stream. Live red is #ef4444.

## Touch (required, tap-to-open the card)

No hover on touch. On the dashboard tab and the mobile Hearings view, tap an entry to open the same detail card, routed through the existing touch-tooltip primitive (HO 147); tap-elsewhere closes; inner links stay tappable. Calling tap-to-open-the-card over tap-through-to-a-hearing-page because the card is self-contained and there's no per-hearing route to depend on (flip this if a hearing page exists and you want tap-through).

## Open-question calls (flagged, override any)

- **Live red clash (resolved):** #ef4444 is fine here. The calendar surface has no party coloring, so the live pip can't collide with the republican-red token on this surface. Use #ef4444.
- **Multi-week delta (current-week-only):** the current week's header shows the full `{count} {noun} {delta}`; other stacked weeks show `{count} {noun}` with no delta. Reuses the B5 this-week/prior-week computation with zero data work. Per-week deltas across all stacked weeks would need the WoW count generalized to any week pair; banked as a later enhancement, not this pass.
- **Touch (tap-to-open):** see above.

## Constraints

- Static, no transitions (instant show/hide). Grid height constant regardless of interaction. Card width fixed, independent of column width.
- The shared component must hold on both surfaces without growing: the dashboard tab is height-pinned to the RACES footprint (282/304), the page is free-height. The floating card is what keeps the grid from reflowing on either.
- Mono house style; the entry title can use the card's existing sans-for-titles treatment if the current row already does, otherwise mono. Tokens only, no new CSS vars (amber, the reds, text tiers, the ~4.5% amber wash via alpha all exist).
- No witness field (the live row doesn't carry one).
- Named `git add` per commit, eyeball the diff. Stale `.next`: verify the stylesheet loads (no 404 on `layout.css`); `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

State whether /hearings and the dashboard tab were already one component or got unified. On both surfaces confirm: the filter bar toggles (TYPE recomputes the noun + count + delta, CHAMBER narrows the count); the week stat + hover breakdown read correctly and the delta direction matches B5; today's column highlights off ET even with no meetings; collapsed entries show time + kind + 2-line title + the +N bills / ● LIVE badges, with the amber left border on bill-attached entries; the hover card floats (portaled, flips at the right edge, pointer crosses without dismissing, inner links click) and drops empty fields; live status computes off ET (a hearing mid-window shows the pip + red "live now"). Confirm the dashboard HEARINGS tab holds its pinned height and the grid doesn't reflow on hover. Touch: tapping an entry opens the card on mobile. Build clean, verify:deploy SHA matches, `/` untouched.
