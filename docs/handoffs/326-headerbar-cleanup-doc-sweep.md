# HO 326 — Settle the chrome arc: delete dead inner-chrome code + reconcile the HeaderBar SKILL narrative

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 326.

Two commits: remove the code HO 323 left dead, then rewrite the SKILL HeaderBar section the 321→325 arc left stale. Doc reflects the cleaned code, not a half-state.

## Commit 1 — code cleanup (`HeaderBar` + call sites + CSS)

Grep-confirm each item is truly unreferenced before deleting. `tsc` must pass at the end — that's what proves every call site was updated.

Remove:
- The dead page-count computation in `HeaderBar` (the `· N BILLS` / `· N MEETINGS` / `· N REPORTS` inline cluster value, unrendered since 323).
- The now-unused count props on the `HeaderBar` interface (`pageCount` / `pageTitle` / whatever the grep shows) and every call site that still passes them. Named `git add` each touched page.
- Orphaned CSS: `.header-titlebar-sync` and `.header-titlebar-nav` (the pre-323 inline sync-stamp + inline-nav classes).

GUARD — do not touch the live HO 325 mechanism:
- the `getCorpusStats(true)` fetch, `.header-sync-sub`, and the `CyclingTimestamp` mount (the LAST SYNC subhead);
- `.header-nav-row` (the HO 323 nav row), `BreadcrumbMasthead`, the path-end caret.

The two dead classes shadow the live ones by name. Delete the `-titlebar-` pair only: `.header-titlebar-sync` ≠ `.header-sync-sub`, `.header-titlebar-nav` ≠ `.header-nav-row`. Same for props — only the count path goes; the sync fetch stays.

Commit: `chore: remove dead inner-chrome count path + orphaned CSS (HO 326)`.

## Commit 2 — SKILL reconciliation

The HeaderBar / inner-chrome section is substantially pre-323. It still describes the HO 189/202/234 tape+inline-sync model and carries a ⚠ correction note instead of real prose. Rewrite it to the post-325 truth and drop the note.

Stale → current:
- The markets tape is gone from inner pages. HO 323 removed it (dashboard-only); the HO 202/234 "tape app-wide / single `<MarketsTape />` in HeaderBar" line is superseded.
- The title bar is the breadcrumb path only. HO 323 stripped the inline sync + count cluster.
- Nav moved to its own full-width row (`.header-nav-row`, HO 323), no longer inline beside the path.
- LAST SYNC is a cycling subhead (`.header-sync-sub`, HO 325) reading `getCorpusStats(true).lastSync` through `CyclingTimestamp`, sitting between the title and the nav. It's the third cycling stamp — already noted at ~lines 1084/1209/1210; keep the rewrite consistent with those, don't re-edit them.
- Inner stack is now: title row (breadcrumb) → LAST SYNC subhead → nav row → control strip → topics band → legend/pagination. Update the band description.

Preserve voice and structure; factual only. If the grep surfaces other stale chrome prose from 321/322 (feed-row sections), flag it for a separate pass — don't fold it in here.

Other docs:
- `backlog.md`: close both items — the orphaned-code cleanup (now done) and the HeaderBar-narrative reconciliation (now done). Tombstone per the usual cadence.
- `oddities.md` / `roadmap.md`: confirm no change needed (the dead-class shadowing resolves on deletion; no theme % moved). Report if a reference turns up.

Commit: `docs: reconcile SKILL HeaderBar narrative + close chrome-arc backlog items (HO 326)`.

## Ship

- `git push`; `npm run verify:deploy` until served SHA === HEAD.
- Build clean; `tsc` passes. Fresh `.next` + the stylesheet loads — the cleanup removes CSS, so confirm no 404 on `layout.css` and no missing-class regression on the header.
- Live-verify the inner header is unregressed: Bills and a plain page show breadcrumb → LAST SYNC subhead (still cycling) → nav row, no tape, no count. Dashboard unchanged (tape + its own subhead).
