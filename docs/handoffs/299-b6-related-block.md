# HO 299 — B6 expanded left: summary + RELATED

Third B6 slice. The expanded row's left column: switch the summary to sans and rebuild the RELATED block per the mock (NEWS always, HEARINGS when present, ODDS omitted). Spec is the `.left` column in b6-mover-expand.html / b6-tabs-span.html.

## Summary

The expanded summary moves to the sans face (the --sans token from 297). 13.5px, line-height ~1.5, --text-secondary.

## RELATED block

Three sub-blocks, each with a small dim header (9px, letter-spacing .1em):

- RELATED NEWS — always rendered. Items from getNewsForBill: each a sans 12.5px link, "Headline" then "· Source · age" with the source/age in mono 10px dim, hover → amber-bright. When the bill has no news, render the empty state "NO RELATED NEWS" (11px --text-dim) under the header rather than dropping the block. News is sparse on the live slices, so most rows show the empty state; that's expected and per the mock.
- HEARINGS — omit-when-empty. Only render if the bill has meetings via getMeetingsForBill (the meeting_bills reverse lookup). Each: a link with the date in amber (h-when), the committee name, and "hearing →". The panel fetch (/api/bill/[id]/panel) lazy-loads committee + news today; add meetings to it.
- ODDS — not rendered. The probe confirmed no bill↔market data, so there's nothing to show. Leave the block out (it's the aspirational slot; revisit if a bill→market source ever lands).

## Notes

- Order in the mock: NEWS, then ODDS, then HEARINGS. With ODDS out, it's NEWS then HEARINGS.
- Don't touch the meta column (sponsor, cosponsors, committee, buttons); that's the next slice.

## Ship

Commit (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify on /dashboard-v2: expand a bill with a hearing (HEARINGS block shows, date in amber) and one without (no HEARINGS block, NEWS shows "NO RELATED NEWS"), summary in the sans face.
