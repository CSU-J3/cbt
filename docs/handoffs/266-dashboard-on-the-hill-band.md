# 266 — Dashboard "On the Hill" band (Piece 3 of 5)

A full-width this-week (Mon–Fri) committee calendar band on the dashboard, below the weekly band, leading the two-column body. Compact, independent component that reuses Piece 1's treatments. Parallel with Pieces 2 and 4 once Piece 1 (264) lands.

## Source of truth

The approved spec block below plus the live HO 263 helpers are the source of truth. `dashboard-hill-fit.html` is visual reference only — read the rendering, not its data or code; the dim boxes around the band are existing dashboard regions, untouched, and all mock data is fabricated. Established chrome, tokens, IA; no new tokens.

## HARD GATE — confirm the slot before placing the band

The dashboard has in-flight header/strip consolidation. Before placing anything: grep the live dashboard and confirm the recommended slot (full-width, below the weekly band, leading the two-column body) exists and is **not** being restructured by that consolidation or the dashboard-v2 work (253–260). If the slot is contested or the consolidation is mid-flight, **HALT and report** — do not place the band into a layout that's about to move. Confirm the slot is free and stable first.

## Depends on

Piece 1 (264) for the watch-state rule (the LIVE NOW callout reuses it) and the row vocabulary. The band itself is a standalone compact component, not a Piece 1 import.

## Phase 1 diagnostic — run against the live helpers, report before building

1. **Per-day cap = 5.** Confirm the max meetings on a single weekday this week so the cap-5 + `+N more` collapse is set to real data. (Heavy days collapse; the HO 261 probe saw days with 8.)
2. **LIVE NOW callout.** Reuses Piece 1's settled watch-state rule to pick the live meeting for the header callout (`● LIVE NOW · time · short title · committee`). Confirm Piece 1's rule is in place; if a meeting is live, the header shows it, else the callout is omitted.

## Approved design spec (source of truth)

```
## Approved design — dashboard ON THE HILL band

Layout: Full-width band on the dashboard, below the weekly band, leading the
two-column body. Compact this-week (Mon–Fri) committee calendar.

Blocks:
- Header (bg --bg-panel): `ON THE HILL · THIS WEEK` (amber); green
  `● LIVE NOW · time · short title · committee` callout when a meeting is live;
  right-aligned `N MEETINGS · → HEARINGS` (links to page).
- 5-col Mon–Fri grid (minmax(0,1fr)): day header (DOW + DOM + count; today
  amber + amber top edge), then meeting one-liners.
- One-liner: left tick (markup amber, else border-strong) · `[● live] time
  (right-aligned 46px) · title (ellipsis) · +N bills`. Cap 5/day + `+N more`.

Interactions: header link and `+N more` → /hearings (latter focused on the day).
Static; no expand on the band.

Constraints: full-width band (5 cols need the width); desktop-first; static;
existing tokens. Placement below weekly band → reading order races (electoral)
→ weekly delta → on the hill → body (legislative).

Open questions: per-day cap = 5 (heavy days collapse to `+N more`); CONFIRM the
slot doesn't collide with the in-flight header/strip consolidation.

Reuses: Piece 1 treatments (independent compact component).
```

## Acceptance

1. Slot gate cleared: confirmation in chat that the recommended slot is free and stable, not mid-consolidation. (If not, HALT report instead.)
2. Phase 1 diagnostic findings posted (per-day max, LIVE NOW wiring). Build only after.
3. Full-width ON THE HILL band renders in the slot — header with amber label, right-aligned `N MEETINGS · → HEARINGS` linking to the page, 5-col Mon–Fri grid, today highlighted.
4. One-liners per the spec (tick, time, title ellipsis, `+N bills`), cap 5/day + `+N more` focusing `/hearings` on that day; LIVE NOW callout shown when a meeting is live, omitted otherwise.
5. Static, existing tokens, no new tokens; reading order preserved (races → weekly → on the hill → body).
6. Ship per HO 252: push, then `npm run verify:deploy` until the deployed SHA matches HEAD.
7. Single commit: `feat: dashboard on-the-hill band (HO 266)`.
