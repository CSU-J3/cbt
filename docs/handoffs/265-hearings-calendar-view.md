# 265 — Hearings page, calendar view + toggle (Piece 2 of 5)

Adds a LIST|CALENDAR toggle and a two-week Mon–Fri grid to `/hearings`. List stays the default. Parallel with Pieces 3 and 4 once Piece 1 (264) lands.

## Source of truth

The approved spec block below plus the live HO 263 helpers are the source of truth. `hearings-full-page.html` is visual reference only — read the rendering, not its data or code; mock values are fabricated. Reuse Piece 1's row/meta vocabulary and the same `getUpcomingMeetings` / `getRecentMeetings` data. Established chrome, tokens, IA; no new tokens.

## Depends on

Piece 1 (264) — the toggle and calendar live on the same surface and reuse its data wiring and watch-state rule.

## Phase 1 diagnostic — run against the live helpers, report before building

1. **Per-cell block cap.** Confirm the max meetings on a single weekday across the this+next-week window. From prod, `getUpcomingMeetings` returned 30 across ~10 weekdays — lumpy, the HO 261 probe saw days with 8. Report the per-weekday distribution and the max so the per-cell cap before `+N more` is set to real data, not a guess.
2. **Filters in calendar view — decide and confirm.** Lock whether TYPE/CHAMBER filters apply while CALENDAR is active or are hidden. Recommendation: keep them applied (consistent with list, and the density makes filtering useful), re-rendering the grid in place. Confirm the call before building.

## Approved design spec (source of truth)

```
## Approved design — /hearings (calendar view + LIST|CALENDAR toggle)

Layout: Adds a view toggle and a two-week Mon–Fri calendar grid to /hearings.
List stays default.

Blocks:
- View toggle (left of filters, bracket-active): [LIST] CALENDAR. LIST default.
- Calendar: two week sections (WEEK OF <Mon date>), each a 5-col Mon–Fri grid
  (weekends dropped — Congress doesn't sit them), scoped to this + next week.
  Day cell: header (DOW + DOM + count; today amber + amber top edge), then
  compact meeting blocks. Empty day shows a faint dash (reads "quiet," not broken).
- Calendar block: left tick (markup --accent-amber, else --border-strong),
  top line `[● live][▶ rec] time · TYPE · +N bills`, title 2-line clamp.

Interactions: toggle swaps list↔calendar (?view=list|cal). No per-block expand
(drill via list).

Constraints: desktop-first; static; existing tokens; grid minmax(0,1fr).

Open questions: do TYPE/CHAMBER filters apply in calendar view or hide;
per-cell block cap before `+N more`.

Depends on: Piece 1.
```

## Acceptance

1. Phase 1 diagnostic findings posted in chat (per-weekday max, the filter-behavior decision). Build only after.
2. `[LIST] CALENDAR` toggle renders left of the filters, LIST default, state in the URL (`?view=list|cal`).
3. Calendar shows two `WEEK OF <Mon>` sections, 5-col Mon–Fri, today highlighted; day cells show header + count + compact blocks; empty days show the faint dash.
4. Block top line and 2-line title clamp per the spec; markup tick tinted, watch glyphs reuse Piece 1's rule. No per-block expand — drill via list.
5. Filters behave per the locked decision; calendar re-renders in place.
6. Existing tokens, no new tokens.
7. Ship per HO 252: push, then `npm run verify:deploy` until the deployed SHA matches HEAD.
8. Single commit: `feat: hearings calendar view (HO 265)`.
