# HO 191 — Expanded bill-row panel redesign (stage pipeline + two columns)

## Why

Approved design from the CBT Design chat. The expanded bill panel (`BillExpandedPanel`, click-to-expand in the `/bills` feed, shared with the dashboard ACTIVITY expand) is currently a long vertical stack (summary → label-list → timeline strip → news → buttons). Redesign it into: **row header → full-width stage pipeline → two columns (summary+news left, metadata+buttons right)**. The HO 188 enrichment content stays; this rearranges it and replaces the thin timeline strip with a proper stage pipeline.

## Structure (top to bottom)

**1. ROW HEADER** — unchanged collapsed content, `--bg-row-hover` bg: ▾ caret · bill ID (`--accent-amber`) · title (`--text-primary`) · topic chips · watch star.

**2. STAGE PIPELINE** — full-width band, `--bg-panel`, the centerpiece. **Replaces the old thin timeline strip entirely.**
- Six stages left→right: INTRO · COMMITTEE · FLOOR · OTHER CHAMBER · PRESIDENT · ENACTED, using the existing `--stage-*` tokens.
- **Reached** stages: filled dot in the stage color. **Current** stage: larger bright filled marker + bold label. **Unreached**: dim hollow dot (`--text-dim`/`--border-strong`).
- Connector line between stages: colored up to current, `--border-strong` after.
- Date under each reached stage (INTRO date; COMMITTEE date · referred-age). Unreached stages show the label only.

**3. TWO COLUMNS** (below the pipeline):
- **LEFT** (~1.6 flex), border-right `--border-strong`:
  - SUMMARY — the LLM plain-language summary, `--text-secondary` 12px, leads the column.
  - RELATED NEWS — labeled sub-section (UPPERCASE `--text-dim` label), up to 5 matched articles: `[SOURCE]` in `--text-dim` brackets + headline link. Hidden if none.
- **RIGHT** (~1.0 flex), slightly darker panel:
  - Label-value rows: SPONSOR (name linked, party-colored bracket) · COSPONSORS (count) · COMMITTEE (linked) · INTRODUCED (date) · LAST ACTION (date · full text — stacked label-above-value since it's long).
  - Action buttons: FULL BILL PAGE → (amber border) · CONGRESS.GOV ↗ (soft border), side by side.

## Redundancy resolution (confirmed)
- The old horizontal timeline strip is **REMOVED**. Pipeline owns "bill position"; the last-action line is now solely the LAST ACTION label row. No duplication.
- The STAGE label row is **removed** from the metadata list — the pipeline shows the current stage, so no text row needed.

## Shared component (confirmed — one prop, do not fork)
- `/bills` feed: the full layout above.
- Dashboard ACTIVITY expand: `variant="compact"` — **stage pipeline + summary only**. Drops the right metadata column AND the related-news block (it's a glance surface). Same component, one prop.

## Phase 1 — Diagnostic (HALT after — two real data-semantics questions)

1. **Current-stage index from data.** The pipeline needs a clean "which of the six stages is this bill at" to fill correctly. Report: what field(s) give the current stage (the `stage` column? `previous_stage`/`stage_changed_at`?), and how the stored stage values map to the six pipeline positions (INTRO/COMMITTEE/FLOOR/OTHER CHAMBER/PRESIDENT/ENACTED). Confirm a bill that's only reached committee fills INTRO+COMMITTEE and leaves the rest unreached. Are there stage values that DON'T map to one of the six (e.g. a "failed"/"vetoed" status that isn't a pipeline position)? Report the full set of stored stage values.

2. **Dead/failed bills (the real call).** Most bills die in committee — they have a last-reached stage but no forward motion. Report: does the schema actually KNOW a bill is dead/failed (a status field), or only that its last action was long ago (a stale date)? Then recommend the treatment:
   - (a) Show last-reached stage as "current" (simple — a stalled bill just shows COMMITTEE as current; the pipeline doesn't claim death, just position). 
   - (b) A distinct treatment (dimmed/struck pipeline) for bills known-dead — only viable if the schema actually flags death.
   - My lean is (a) UNLESS the schema has a real dead/failed/vetoed signal, in which case (b) for those specific cases is a nice touch. Report what the data supports and recommend — don't over-engineer a death state the data can't back.
   - Also: enacted bills should fill the whole pipeline to ENACTED (the success terminal); vetoed/failed-at-president (if represented) is the edge to handle.

3. **Dates per stage.** The pipeline wants a date under each reached stage (INTRO date, COMMITTEE date). Report which per-stage dates are actually available. HO 188 found only `introduced_date`, `stage_changed_at` (one transition), and `latest_action_date` are stored — NOT a full per-stage history. So the pipeline likely can only date INTRO (introduced_date) and the current stage (stage_changed_at); intermediate reached stages may have no date. Confirm, and recommend how to handle dateless reached stages (show the dot/label without a date — fine).

4. **The compact variant.** Confirm `variant="compact"` cleanly renders pipeline + summary only (no right column, no news) for the dashboard ACTIVITY expand, and that the same component serves both without forking. Report how the prop threads through (BillRowList on the dashboard passes compact; `/bills` passes full).

**HALT. Report: the stage-value set + current-stage mapping, the dead-bill data reality + your treatment recommendation, the per-stage date availability, and the compact-variant threading. The dead-bill call especially — I'll decide based on what the data actually supports. Wait for sign-off.**

## Phase 2 — Implementation (after sign-off)
- Rebuild `BillExpandedPanel`: row header (unchanged) → full-width stage pipeline → two-column body.
- Stage pipeline: six stages, reached/current/unreached treatment, colored connectors, dates where available.
- Left column: summary + related news (news hidden if none). Right column: the metadata rows (no STAGE row) + action buttons.
- Remove the old timeline strip.
- `variant="compact"` for the dashboard (pipeline + summary only), full for `/bills` — one component, one prop.
- Preserve: the HO 188 sponsor link, cosponsor count, committee links, news fetch (still 2 queries on first open), the watch star, the action chips' cmd/middle-click behavior.

## Verification
- Expand a bill on `/bills`: row header → stage pipeline (filled to current stage, dates where available) → two columns (summary+news left, metadata+buttons right). No old timeline strip; no STAGE label row.
- A committee-stalled bill fills INTRO+COMMITTEE, rest dim. An enacted bill fills the whole pipeline.
- Dead-bill treatment renders per the signed-off decision.
- Related news hidden when none; shown (≤5) when present.
- Dashboard ACTIVITY expand: compact variant (pipeline + summary only, no right column/news).
- Sponsor links to the right member; committee links; cosponsor count; buttons work (cmd-click new-tab).
- Still 2 queries per expanded row.
- Type check passes.
- Code starts the dev server; Corey eyeballs an expanded row on `/bills` AND the dashboard ACTIVITY expand.

## Out of scope
- No new data fetches (work with stored fields; the pipeline dates are limited per HO 188 — that's fine).
- No new stage history syncing (if intermediate stage dates aren't stored, reached stages without dates show label-only).
- The collapsed row state (unchanged).
- Mobile <700 (deferred — the two columns will need a stack rule there; note it, don't spec it).
- SKILL.md — flag for the next sweep.
