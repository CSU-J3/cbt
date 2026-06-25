# HO 359 — Reports sub-nav: keep PRESIDENT and CHANGES inside the surface

> Claim the next free HO number; if 359 is taken in `docs/handoffs/`, use the next
> available and rename. Independent of the floor-votes color work (HO 360).

The reports surface has a sub-nav — CHANGES / PRESIDENT / REPORTS. REPORTS is a
real in-surface page (masthead + sub-nav). PRESIDENT links *out* to
`/bills?stage=president`, which lands on the bills surface where the reports sub-nav
doesn't exist, so there's no way back except the top nav. Two of the three tabs are
exits, not tabs.

## Confirm current behavior first

- **CHANGES:** `app/changes/page.tsx` is a real route (it has its own server reads),
  but confirm whether it renders *under reports chrome* (masthead breadcrumb +
  reports sub-nav) or stands bare like a bills view. If it already renders
  in-surface, only PRESIDENT needs the fix; if it exits/strands, it gets the same
  fix.
- **PRESIDENT:** confirm it's the `/bills?stage=president` link the draft describes,
  and whether a president's-desk page/component already exists to reuse (HO 15 / 41 /
  158) or whether it's purely the bills filter.
- **Chrome components:** grep the masthead + sub-nav components used by the REPORTS
  page (the HO 185 / 323 / 325 chrome). The fix carries those exact components onto
  the other routes — no new chrome.

## Target

Clicking PRESIDENT (and CHANGES, if it exits) keeps the user inside the reports
surface:

- Masthead breadcrumb reads `Congressional Terminal:\119TH\Reports\President` (and
  `…\Reports\Changes`), matching the app's `\`-separated style.
- The CHANGES / PRESIDENT / REPORTS sub-nav persists on all three routes, active tab
  marked.
- President's-desk content renders under reports chrome, not a bare `/bills` page.
  The underlying data can stay president-stage bills; only the surface that wraps it
  changes.

Same chrome-consistency pass as HO 323 / 325, applied to these routes. Build-side
routing plus carrying the existing masthead and sub-nav — no new design.

## Deferred — don't do here

Whether CHANGES and PRESIDENT belong as peers of REPORTS at all, or are bills-views
filed under reports, is a regroup, not a chrome fix. Leave the trio as-is; it reads
as "what moved / what's on the desk / weekly writeups."

## Constraints

- Existing tokens, existing masthead and sub-nav components. No new design.
- Static, no motion.

## Ship

- All three sub-tabs render inside the reports surface, sub-nav persistent, correct
  breadcrumb; none dump to a bare `/bills` page.
- One clean commit. Shared working tree is live (a co-agent commits here): named
  `git add <file>` only, explicit pathspec, re-check HEAD before push. `git push`,
  then `npm run verify:deploy` until the served SHA matches HEAD.
