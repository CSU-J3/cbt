# 267 — Secondary cuts: committee detail + bill hub (Piece 4 of 5)

Two embeds that reuse Piece 1's collapsed/expandable meeting row: a meetings section on the committee detail page, and a "hearings covering this bill" section on the bill panel. Parallel with Pieces 2 and 3 once Piece 1 (264) lands.

## Source of truth

The approved spec block below plus the live HO 263 helpers are the source of truth. No own mock — these reuse Piece 1's expanded row, see `hearings-full-page.html` (visual reference only; mock values fabricated). Reuse Piece 1's row + expand exactly; introduce no new treatment. Established chrome, tokens, IA; no new tokens.

## Depends on

Piece 1 (264) — both cuts are the Piece 1 row in a scoped section.

## Phase 1 diagnostic — run against the live helpers, report before building

1. **Committee cut shape.** `getMeetingsByCommittee` returned 84 for `slin00` on prod — large enough that a flat dump is wrong. Report the per-committee meeting-count distribution and decide: grouped bands (UPCOMING / RECENT, recent capped) vs flat recent-first, and whether to cap/paginate. Recommendation: grouped, recent capped with a "see all on /hearings" out. Confirm.
2. **Bill cut cap.** `getMeetingsForBill` returned 5 for `119-hr-3872`. Report the meetings-per-bill distribution to set the cap before a "see all on /hearings" link. Most bills carry few; a low cap (show all up to ~8, else cap) is likely fine. Confirm.

## Approved design spec (source of truth)

```
## Approved design — hearings secondary cuts

Layout: Two embeds reusing the Piece 1 collapsed/expandable meeting row.

Blocks:
- Committee detail page: a COMMITTEE ACTIVITY / MEETINGS section
  (getMeetingsByCommittee), scoped to that committee — same row + expand.
- Bill panel: a HEARINGS COVERING THIS BILL section (getMeetingsForBill) —
  same row, drop the bill-chip column (it's the current bill).

Interactions: same row expand. Section omitted when the helper returns empty.

Constraints: sub-page cuts (IA rule); reuse Piece 1 row, no new treatment;
existing tokens; static.

Open questions: committee cut — grouped bands vs flat recent-first; bill cut —
how many before a "see all on /hearings".

Depends on: Piece 1.
```

## Acceptance

1. Phase 1 diagnostic findings posted (per-committee distribution + grouped/flat decision; per-bill distribution + cap). Build only after.
2. Committee detail page shows a COMMITTEE ACTIVITY / MEETINGS section from `getMeetingsByCommittee`, scoped to that committee, using the Piece 1 row + expand, per the locked grouped/flat decision.
3. Bill panel shows a HEARINGS COVERING THIS BILL section from `getMeetingsForBill`, same row with the bill-chip column dropped (it's the current bill); cap + "see all on /hearings" per the locked decision.
4. Each section is omitted when its helper returns empty.
5. No new row treatment, sub-page placement per the IA rule, existing tokens, no new tokens.
6. Ship per HO 252: push, then `npm run verify:deploy` until the deployed SHA matches HEAD.
7. Single commit: `feat: hearings secondary cuts (HO 267)`.
