# HO 323 — Standardize page chrome: tickers + lead-in dashboard-only; nav on its own row everywhere

Confirm the next free number before saving: `ls docs/handoffs/ | sort -V | tail`. Body assumes 323 — if it's taken, bump to the next free number, rename the file, and report the final name so the read instruction resolves.

Two-part header standardization, both landing in `HeaderBar` (the inner-page header):

1. Strip the markets tape and the inline title-bar metadata from inner pages — only `/` (dashboard) keeps ticker tapes and the stat-readout lead-in.
2. Move the inner-page nav off the title row onto its own full-width row, matching the dashboard, so nav placement is identical on every page.

End state, every inner page: `Congressional Terminal:\119TH\<Section>[\<Detail>]>_` on the title row, then the nav on its own row directly below, then page content.

## Load-bearing premise — confirm before editing

`/` (dashboard-v2, the HO 311 swap) renders its header via its own components (the B1 masthead + B3 nav row), NOT via `HeaderBar`. `HeaderBar` is the inner-page header only. Both changes edit `HeaderBar`, so they must hit inner pages exclusively; the dashboard is the styling reference, untouched.

Grep to confirm: the dashboard route does not import/mount `HeaderBar`; the single `<MarketsTape />` lives in `HeaderBar` (HO 234 app-wide mount); the dashboard's two-row tape band (B2 — MARKETS row + ODDS row) and its nav row are separate mounts. If the dashboard shares `HeaderBar`, STOP and report — the approach changes.

## Change A — strip tape + inline metadata (`HeaderBar`)

1. **Markets tape.** Remove the single `<MarketsTape />` mounted below the title bar (the combined `SPX NDQ TNX CPI UNEMP SHUTDOWN FEDCUT WTI …` strip on every inner page). The dashboard's two-row band is a separate mount and stays.
2. **Inline title-bar metadata.** Remove the cluster trailing the breadcrumb path: the page count + label (`· 15,120 BILLS`, `· 48 MEETINGS`, `· 9 REPORTS`, etc.) and the `· UPDATED <time> <tz>` sync stamp. The title row keeps the breadcrumb path only.

## Change B — nav on its own row (`HeaderBar`)

Pull the nav out of the title-bar flex. Render it as its own full-width row directly below the title row, mirroring the dashboard's nav row — the dashboard already places nav as the bottom band of its header chrome; inner pages now do the same (no tape between, so nav sits right under the title).

Match the dashboard nav row exactly:
- Same nav items component / item style: text-only `\` path prefix, bracketed amber active item (`[ \BILLS ]`), the three group dividers (`[ \DASHBOARD ] | \BILLS \HEARINGS \MEMBERS \RACES \PATTERNS | \REPORTS \WATCHLIST`), and **reserved bracket space on every item so switching the active page causes no horizontal jump**.
- Left-aligned, full width, same container border/padding/tokens as the dashboard nav row.
- Identify the nav component shared between dashboard and inner pages (or, if separate, make the inner row reuse the dashboard's nav-row styling). Reuse existing classes/tokens — no new CSS variables.

This also fixes the single-report page (the long `…\Reports\Week of June 15, 2026>_` breadcrumb that was wrapping the inline nav to a second row): nav is now below the title by design, consistent.

## Constraints

- **Dashboard untouched.** `/` keeps the stat readout (`n bills tracked · n in committee · …`), both ticker rows, and its existing nav row. Don't edit the dashboard components. `/dashboard-classic` (preserved, unlinked) is out of scope — its `HomeHeader` tape is a separate mount, unaffected.
- **Page content below the masthead stays.** These only touch shared masthead chrome. Leave page-level subtitles/subnavs alone: the Hearings secondary header (`Hearings:\>_ · 48 MEETINGS · HOUSE 25 / SENATE 23 · 119TH CONGRESS`), the Races `RACES PRIMARIES` subnav, the single-report `← BACK TO REPORTS / DOWNLOAD .MD` bar. Page content, not title-area chrome. (Hearings' meeting count survives in that secondary header.)
- **Caret.** The blink caret lands at the breadcrumb path end (`…>_`) on every inner page. Any page trailing the caret on the removed sync/metadata (Members anchors it to its sync string per HO 195) falls back to the path-end caret. One caret per page, at the `>` glyph.
- **Borders/spacing.** New inner stack is title row → nav row → page content (control strip on Bills, etc.). Verify clean borders — no doubled rule between title and nav, no orphaned divider where the tape used to sit, no awkward gap.
- Monospace throughout; reuse existing tokens; no new CSS variables.
- Render-removal is the scope for the metadata. Now-orphaned CSS classes or unused `HeaderBar` props (count/sync props at call sites) get flagged for `docs/backlog.md` cleanup, not swept into these commits.

## Backlog

This removal obsoletes the deferred "inner-page UPDATED … MT subhead not yet cycling" item — close it (the stamp is gone, not pending).

## Out of scope

No dashboard edits. No page-content edits below the masthead. No data-query changes (the dashboard tape fetch is independent and keeps running).

## Ship

- Named `git add` (the `HeaderBar` changes; call-site edits named individually — never `-A`). Changes A and B are one logical header pass; a single commit is fine, or split A/B — Code's call.
- `git push`, then `npm run verify:deploy`; served SHA === HEAD.
- A stale `.next` can serve a stale CSS hash (404 on the stylesheet → unstyled page). If the dev server's been up a while, `rm -rf .next` + restart before eyeballing. `tsc` + HTTP 200 don't prove a styled render — confirm the stylesheet loads.
- Live-verify across Bills, Hearings, Members, Races, Reports index, one single report, a bill-detail, and a member-detail:
  - title row shows the breadcrumb path only — no tape, no inline count/updated metadata;
  - nav sits on its own full-width row directly below the title, styled identically to the dashboard nav (bracketed active item, group dividers, no horizontal jump when comparing the active item across pages).
- Regression: `/` still shows both ticker rows + the stat readout + its nav row, unchanged.
