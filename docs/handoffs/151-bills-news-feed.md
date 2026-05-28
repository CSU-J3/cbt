# 151 — BILLS | NEWS feed restructure (spec 5)

## What this is

Spec 5 (#7) from the design session: the Feed surface restructures around a `BILLS | NEWS` segmented toggle. Same page, same chrome, two modes with different filter bars and a different lead. BILLS mode is bill-led (the bill is the spine) and reuses the HO 148 click-to-expand row. NEWS mode is headline-led (news is the object) and reuses the existing news-row pattern — explicitly not a third one. Nav stays a single "Feed" item; the toggle lives inside the page.

This also absorbs President's desk into a BILLS filter (`?stage=president`), with `/president` kept as a thin alias so bookmarks survive — the call confirmed in planning.

The entanglement is NEWS mode. CBT already has news surfaces (the breaking block from HO 69/118, the per-bill news from HO 148, possibly a standalone news page, the search news tab from HO 129). NEWS mode must relate to those cleanly — absorb, reuse, or coexist — not duplicate. That's what Phase 1 maps before anything builds.

## Phase 1 — Diagnostic (HALT for sign-off)

Read real artifacts, post findings, stop.

### A. Current Feed structure

Read `app/feed/page.tsx` (or wherever the feed lives — confirm). Report: the current filter bar (which filters, their controls, URL params), the row component (post-HO-148 this should be `BillRowList` with expandable rows), pagination shape, and the full set of search params the feed reads today (`?stage`, `?topics`, `?sponsor`, `?sort`, `?page`, `?chamber`, `?ceremonial`, `?cluster`, `?q` per HO 148's audit — confirm).

### B. Existing news surfaces inventory (load-bearing)

Map every place news currently renders, so NEWS mode reuses rather than duplicates:

- **Standalone news page.** Does `/news` exist as a route? `MediaAttentionCell` (HO 130) links to `/news?bill=…`, which implies one. If it exists, report its filter bar, row component, query, and pagination. NEWS mode may *be* this page's content relocated into the Feed toggle — in which case `/news` becomes an alias (same pattern as `/president`).
- **Breaking block** (HO 69/118) on the dashboard — confirm the row component (`NewsRow`) and its query (`getBreakingNews` or similar).
- **Search news tab** (HO 129) — is there a `SearchResultsNews` rendering news? Confirm its row component.

The output: a recommendation on how NEWS-mode-in-Feed relates to each — absorb `/news` (alias it), reuse `NewsRow`, and leave search/breaking as-is consuming the shared row. If `/news` already does exactly what NEWS mode should, the honest move is "NEWS mode IS the /news content; /news aliases into Feed," not a parallel build.

### C. News data layer

NEWS mode needs a full paginated, filterable news feed: filters SOURCE / TOPIC / WINDOW, sort by recency. Report what querying exists. `getNewsForBill` (HO 148) is per-bill; the breaking block's query is likely capped + unfiltered. Is there a `getNews({ source?, topic?, window?, sort, page })` or does one need building/extending? If `/news` exists (from B), it presumably already has this — reuse it.

### D. BILLS-mode row markers

Spec 5's BILLS rows show a `⚡ N news` marker when a bill has coverage. HO 130 added `MediaAttentionCell` (the press-attention indicator) to bill rows. Confirm whether `⚡ N news` is the same thing as the existing `MediaAttentionCell` — if so, reuse it, don't add a second marker. Report the per-bill news-count source and whether it's already on the feed query or needs a join.

### E. President absorption

Read the current `/president` route. Confirm it's a stage-filtered bill list. Plan the alias: either a redirect to `/feed?stage=president`, or `/president` renders the feed with the filter pre-applied. Recommend whichever preserves the route cleanly without duplicating the feed page. The `STAGE` filter in BILLS mode must include `president` as an option.

### F. URL state for the toggle

NEWS and BILLS need a mode param (e.g. `?mode=bills` / `?mode=news`, default bills). Confirm it doesn't collide with the existing feed params, and that NEWS-mode filters (SOURCE / TOPIC / WINDOW / SORT) and BILLS-mode filters coexist or are scoped per mode (switching modes can reasonably reset the other mode's filters, or each mode reads only its own params — recommend which). Pagination is independent per mode.

### G. Segmented toggle component

Spec 5's `BILLS | NEWS` toggle and spec 7's `VOLUME | PASS RATE` + chamber toggles are the same idiom. Recommend building one reusable `components/SegmentedToggle.tsx` (mono, active = `--accent-amber-bright` on `--bg-row-hover`) here, so HO 152 (members) reuses it instead of hand-rolling. Confirm nothing similar already exists.

### Report format

1. Current feed structure + param set.
2. News surfaces inventory + the absorb/reuse/coexist recommendation per surface (the load-bearing output).
3. News data-layer state + what NEWS mode queries through.
4. `⚡ N news` vs `MediaAttentionCell` reconciliation.
5. President alias plan.
6. Toggle URL-state + per-mode filter scoping recommendation.
7. SegmentedToggle reuse recommendation.
8. Proposed Phase 2 scope: files, component shape, any new query helpers.

### HALT. Wait for sign-off.

## Phase 2 — Implementation (after sign-off)

Shape follows Phase 1. Target:

### Page chrome

`BILLS | NEWS` segmented toggle top-left (the `SegmentedToggle` component), mono, active `--accent-amber-bright` on `--bg-row-hover`. A count label beside it reflects the active mode's result count. Mode in the URL, default BILLS.

### BILLS mode

- Filter bar: STAGE (including `president`), TOPIC, CHAMBER, SPONSOR, SORT (activity / date). Mono chips.
- Rows: the HO 148 `BillRowList` expandable rows — bill ID chip + title + the existing media-attention marker (`⚡ N news` / `MediaAttentionCell`, whichever Phase 1 confirms) + mono meta line (stage transition · sponsor · topics).
- Paginates.

### NEWS mode

- Filter bar: SOURCE, TOPIC, WINDOW, SORT (recent). Mono chips.
- Rows: the existing `NewsRow` (HO 118) — headline (`--text-secondary`, flex) + bill chip (`--accent-amber`, `+N` for multi-bill) + source + relative date. No third row pattern.
- Paginates independently.
- Queries through the news helper from Phase 1.

### President alias

Per Phase 1's plan — `/president` resolves to the feed in BILLS mode with `stage=president` applied, no duplicate page.

## Out of scope

- Building a new news-row pattern. NEWS mode reuses `NewsRow`.
- Search tabs (HO 129) restructure. Reconciled in Phase 1, not rebuilt.
- The breaking block on the dashboard. Untouched (it shares `NewsRow`).
- Mobile layout. Deferred to the #15 mobile pass.
- LLM-synthesized answer at the top of search/feed (the HO 134 backlog v3 idea). Separate, later.
- Any change to the HO 148 expand behavior itself — BILLS mode consumes it as-is.
- New tokens or motion.

## Acceptance

1. Phase 1 report posted with all eight sections; the news-surface reconciliation and president alias signed off before Phase 2.
2. Feed renders the `BILLS | NEWS` toggle; switching modes swaps filter bar, rows, and the count label; mode persists in the URL.
3. BILLS mode: expandable HO 148 rows, full filter bar including `president` in STAGE, media-attention marker reused (not duplicated), independent pagination.
4. NEWS mode: `NewsRow` reused, SOURCE / TOPIC / WINDOW / SORT filters, independent pagination.
5. `/president` resolves into BILLS mode with the president stage filter, no duplicate page; existing links work.
6. `SegmentedToggle` is a reusable component (or Phase 1 found an existing one to reuse).
7. Per-mode filter params don't collide; switching modes behaves per the Phase 1 scoping decision.
8. `npm run typecheck` and `npm run build` clean.
9. `SKILL.md` updated: the feed mode toggle, the two modes' filters/rows, the president alias, and the SegmentedToggle primitive.
10. Single commit: `feat: BILLS|NEWS feed restructure (HO 151)`.

## Notes

- **The news inventory is the whole risk.** CBT has accumulated news rendering in several places. The failure mode is NEWS mode becoming a fourth news surface with its own row and query while `/news` already does the job. Phase 1's map prevents that — the likely clean answer is "NEWS mode is the /news content inside the Feed toggle, /news aliases in."
- **President follows the same logic as the news pages.** A filtered view of a canonical surface shouldn't be its own page. `/president` becomes an addressable alias, not a parallel implementation — same reasoning that collapses `/news` if it exists.
- **Build the toggle once.** Two specs need a segmented toggle this batch. Hand-rolling it twice is the kind of divergence the HO 154 cleanup audit would later flag; building one reusable component now avoids that debt.
- **BILLS-led vs NEWS-led is the design's point.** Same chrome, different spine — in BILLS the bill is the object and news is a marker on it; in NEWS the headline is the object and the bill is a chip. Don't blur them into one hybrid row.
