# HO 325 — Restore LAST SYNC on every page (cycling subhead, matching the dashboard)

HO 323 stripped the inline title-bar metadata cluster from inner pages (page count + `UPDATED <time>` stamp). Bring back **only the sync time**, re-rendered as the dashboard's `· LAST SYNC <time>` subhead so it's identical on every page: same label, style, position, and zone-cycling. The count does not come back.

## Premise — confirm before editing

- The dashboard (`DashboardV2Header`) renders a `· LAST SYNC <time>` subhead directly under the masthead title, using the HO 183 zone-cycling timestamp (`CyclingTimestamp` / the zone-cycle hook). Confirm the exact component + where it reads the global sync timestamp.
- The inner-page sync HO 323 removed was the **same global sync instant** as the dashboard's (the pre-323 inner "UPDATED 8:06 PM MT" == the dashboard's "LAST SYNC 9:06 PM CT", one cycling zone over). The sync computation HO 323 left dead-but-present in `HeaderBar` should read that same source. Confirm; if the old inner computation read a different source, point the revived render at the dashboard's source so the two times can't drift.

No new data — revive the existing global sync time in subhead form.

## Change — `HeaderBar`

- Add a `· LAST SYNC <time>` subhead on its own line, directly under the breadcrumb title row and above the nav row (`.header-nav-row`). New inner stack: title row → LAST SYNC subhead → nav row → page content.
- **Reuse the dashboard's cycling component** (`CyclingTimestamp` / zone-cycle hook) so the time zone-cycles identically. This is what makes the inner sync finally cycle — the old "UPDATED MT" never did.
- **Label = `LAST SYNC`** (match the dashboard; drop the old `UPDATED` wording).
- **Style = the dashboard's LAST SYNC subhead**: 11px, dim/muted, leading `·`. Reuse existing tokens — no new CSS variables.
- **Left-align with the title + nav** — same `--space-lg` inner padding HO 323 set on `.header-nav-row`, so title / subhead / nav share a left edge.
- The revived render can re-use the sync computation HO 323 flagged as dead; the **page-count** computation + label stay dead/flagged (not revived). Only the sync time returns.

## Constraints

- **Dashboard untouched** — it already shows LAST SYNC. Don't edit `DashboardV2Header`.
- **Caret unchanged** — stays at the breadcrumb path end (`…>_`) on the title row; the subhead carries no caret (matches the dashboard, whose subhead has none).
- **Borders.** HO 323 moved the title row's border-bottom onto the nav row. The subhead sits between them — verify it reads as a thin dim line under the title with no doubled rule (title → subhead → bordered nav row). Eyeball Bills (control strip below) and a plain page.
- Monospace; existing tokens; reuse the single zone-cycle island — don't add a second polling/cycling mechanism.

## Backlog

Flip the item HO 323 closed: "inner-page UPDATED MT not cycling" is now **resolved by adopting the dashboard's cycling LAST SYNC** (resolved by adoption, not removal). Update the note. The orphaned **count/sync** cleanup item narrows to **count-only** — the sync computation is now live again.

## Ship

- Named `git add`; `git push`; `npm run verify:deploy` until served SHA === HEAD.
- Stale `.next` → 404 on the stylesheet → unstyled; `rm -rf .next` + restart if the dev server's been up a while. `tsc` + 200 don't prove styled render.
- Live-verify: Bills, Members, Hearings, Races, Reports index, one detail page — each shows `· LAST SYNC <time>` under the breadcrumb, above the nav row; the time **cycles zones** and **matches the dashboard's** LAST SYNC instant. No page count returns. Regression: dashboard header unchanged.
