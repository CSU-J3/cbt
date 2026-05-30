# 160 — SKILL.md reconciliation sweep

## What this is

SKILL.md has drifted behind the shipped code, and the drift has caused bad handoff premises three times this batch: the header model (was ~5 handoffs stale, sent HO 156 chasing a deleted secondary nav row), the `/president` page (deleted in HO 151/154.1, still documented as standalone, sent HO 158 verifying a page that doesn't exist), and the report-prose assumption (HO 159 assumed a tall block needing a clamp; it was already a 2-line ellipsis). Each got caught only because Code read real source. This sweep makes the doc match reality so the next handoff doesn't start from a false premise.

This is **documentation reconciliation, not code change.** The only edits are to SKILL.md. No component, query, or style changes. If the sweep surfaces an actual code bug (not just a doc mismatch), flag it for a separate handoff — don't fix it here.

## The method: section-by-section, doc-vs-source

For each SKILL.md section below, read the **real** files it describes and report the delta (doc says X, code does Y), then correct the doc to match code. Work in the order listed; post findings per batch and fix as you go (this doesn't need a HALT — it's doc-only and reversible, but report each batch's deltas so the corrections are on-record).

Known-stale sections, in priority order (these are confirmed or near-certain drift from the recent handoffs):

### Batch 1 — Pages + IA (the worst drift)

`### Pages` (currently ~line 169) and `## Information architecture` (~285). The doc lists six flat pages (`/`, `/bill`, `/watchlist`, `/stale`, `/president`, `/changes`, `/sponsors`) and describes `/` as "feed of the 50 most recent bills." Reality after HOs 89/134/144/151/154:

- Nav is **six group landings**: Dashboard · Feed · Members · Patterns · Reports · Watchlist (HO 134). The old secondary destinations (STALE·CHANGES·PRESIDENT) moved into GroupTabs strips on the landings.
- `/` is the **dashboard** (HomeHeader, breaking strip, two-column grid, report snapshot), not the bill feed. The feed is `/feed`.
- `/sponsors` → `/members` (HO 89).
- `/president` is a **redirect** to `/feed?stage=president` (HO 151/154.1); the standalone page and `getPresidentBills`/`getPresidentCount`/`buildPresidentWhere` are gone.
- Pages the doc doesn't mention at all: dashboard (`/`), `/committee(s)`, `/races`, `/primaries`, `/reports`, `/patterns` (or whatever Patterns resolves to). Read `app/` directory structure and enumerate the real route tree.

Rewrite Pages + IA against the real `app/` tree and the GroupTabs grouping. Read `app/page.tsx`, `app/feed/page.tsx`, the route directories, and the nav component (`NAV_ITEMS`) for the real grouping.

### Batch 2 — Server/client split + client islands

`### Server / client split` (~256) and the intro line at ~167 ("the only client islands are `WatchlistToggle` and `StageFilter`"). That's many handoffs stale. Real client islands now include at least: `MobileNavDrawer` (HO 156), the tooltip primitive (HO 147), `MarketsTape` staleness (HO 149/154.2), `SearchBox`, `StageFilter`, `WatchlistToggle`, the feed's `BillRowList` expand state (HO 148/155), the members scatter, the bubble drawer (HO 132.1). Grep for `"use client"` across `components/` and `app/` and enumerate the real set with a one-line role each.

### Batch 3 — Inline expand (server-vs-client)

`### Inline expand on the feed` (~252) says `?expanded=` URL-driven for the feed. HO 148/155 made the **feed client-state-only**; the `?expanded=` URL idiom is the **members** page (server-rendered). HO 155 documented this exact split — confirm that documentation landed and is correct here. The section should describe both idioms: feed = client `useState` via `BillRowList`, members = `?expanded=` server-rendered, the split is by rendering model, deliberate (cross-reference the HO 155 note if it's elsewhere in the doc).

### Batch 4 — Days-since / president (confirm HO 158 fix landed)

`### Days-since column` (~270) headed `/stale, /president`. HO 158's commit `ac1545c` was supposed to re-point this at `/feed?stage=president` and drop the deleted helpers. **Confirm that fix actually landed** — this snapshot may predate it. The threshold table (staleness + desk-time boundaries) is still accurate and load-bearing — keep it verbatim. Only the page reference (`/president` standalone → `/feed?stage=president` alias) and any mention of `getPresidentBills`/`getPresidentCount` need correcting. If `ac1545c` already fixed it, confirm and move on.

### Batch 5 — Layout grid + BillRow

`### Layout grid` (~240) describes a six-column `BillRow` (`24px 86px 1fr 150px 96px 150px`) and the old `.feed-row` grid. HO 125 redesigned `BillRow`; HO 130 added the media-attention column; HO 148 added the expand mechanism; the mobile section (~246) predates the HO 156/157 breakpoint work. Read the real `BillRow.tsx` + the `.feed-row`/grid CSS in `globals.css` and the real `@media` blocks (there are several: 700/1023/1279/1919 per HO 156 Phase 1). Correct the grid spec, the column list, and the breakpoint documentation. Add the mobile cuts that shipped this batch: hamburger dropped + markets tape hidden <700 (commit 4c15a64), the header collapse + font bands (HO 157).

### Batch 6 — Dashboard layout (likely missing or thin)

The dashboard is the most-revised surface (HOs 126/131/133/134/140/150/153/159) and the doc's design-system section barely covers it. Confirm there's an accurate dashboard-layout entry: chrome stack (HomeHeader → tape → nav), full-width BREAKING, **report snapshot under breaking** (HO 159 — confirm this landed in the doc), two-column grid (STAGE/TOPIC left, ACTIVITY/TOP STALLS right). The report snapshot is a **2-line ellipsis block, not tall prose** (the HO 159 finding) — make sure that's recorded so the clamp-assumption mistake doesn't recur.

### Batch 7 — Everything else, lighter pass

The remaining sections (Stack, Build order, Congress.gov API, Database schema, Sync logic, Query helpers, Summarization prompt, Color palette, Stage indicators, Topic colors, Typography, Date formatting, basePath, Environment, Things to watch for, What not to do). Skim each against its source file. These are likelier accurate (slower-changing), so this is a confirmation pass — flag any drift but don't assume it. The Query helpers section (~109) is worth real attention since `getPresidentBills` etc. were deleted and `getFeedBills` absorbed the president-alias path.

## Acceptance

1. Each batch's doc-vs-code deltas reported on-record before/as the correction is made.
2. Pages + IA rewritten against the real `app/` route tree and the six group-landing nav.
3. Client-islands list reflects the real `"use client"` set with one-line roles.
4. Inline-expand section describes both idioms (feed client, members URL) per HO 155.
5. Days-since section confirmed re-pointed to `/feed?stage=president`; threshold table kept verbatim.
6. Layout grid + BillRow + mobile breakpoints corrected to the shipped state (HO 125/130/148/156/157 + commit 4c15a64).
7. Dashboard layout entry accurate including report-under-breaking and the 2-line-ellipsis fact.
8. Remaining sections skimmed; any drift flagged and fixed, accurate ones confirmed.
9. Any **code** bug surfaced during the sweep is flagged for a separate handoff, NOT fixed here.
10. Single commit: `docs: reconcile SKILL.md with shipped code (HO 160 sweep)`.

## Out of scope

- Any code change. Doc only. A surfaced code bug → separate handoff.
- Rewriting accurate sections for style. Correct what's wrong, leave what's right.
- The handoff docs in `docs/handoffs/` — those are historical record, not living doc; don't touch them.

## Notes

- **Why section-by-section, not a full rewrite.** A blind rewrite would lose the accurate institutional knowledge the doc already holds (the API gotchas, the sync logic, the topic-color groupings — those are hard-won and probably still right). The sweep corrects drift surgically and confirms the rest, rather than regenerating from scratch and risking new errors.
- **The doc is the ground truth for handoffs — that's why this matters.** Every handoff starts by reading SKILL.md for component names, paths, and current behavior. When the doc lags code, the handoff inherits the lag. Three bad premises this batch all trace here. This sweep is maintenance on the thing the whole workflow leans on.
- **Confirm `ac1545c` and HO 159's doc edits actually landed.** This snapshot still shows the old `/president` days-since heading and may predate both. Part of the sweep is verifying the recent doc-fixes are present, not just fixing fresh drift — if a prior "doc updated" claim didn't land, that's itself a finding.
- **Don't trust this handoff's line numbers.** They're from a snapshot that may be stale. Grep for the section headers, work from real positions.
