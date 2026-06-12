# HO 232 — MOVERS tab + ENACTED THIS WEEK banner (design items 5 + 6)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 232.

## What this is

Two of the four remaining dashboard design-pass items, plus a write-only data plant. HO 229 classified these; the scope decision is locked from that verdict — don't re-litigate it:

- **MOVERS ships from→to NOW** from the existing single-slot transition record. The design's hop-count ranking is **deferred** until the transition log (planted here) accrues data.
- **ENACTED is pure UI** — the enacted-this-week query already exists in the dashboard lead.

Three commits: MOVERS tab, transition-log plant, ENACTED banner. Read each live file before editing it. If the design-doc appendix survives at the bottom of `docs/handoffs/229-dashboard-design-classify.md`, its item 5/6 text wins over my paraphrase below; if the appendix isn't there, this handoff's spec stands.

## Resolved premises (don't re-derive)

- **The from→to source is `bills.previous_stage` + `bills.stage_changed_at`** — a single-slot last-transition record written in the summarize step when the LLM-classified stage differs from the prior stage. `/changes` runs on exactly this: stage moved in last 7 days, `stage_changed_at DESC`, transition rendered via `BillRow`'s `showStageTransition` with the prior stage dimmed (`muted` on `StageIndicator`).
- **Why hop-rank can't ship yet:** the slot is overwritten on each transition. No append-only history exists, so "moved N stages this week" isn't derivable. The log planted in commit 2 fixes that going forward; no backfill is possible.
- **Enacted-this-week** is computed in `lib/dashboard-lead.ts` (~lines 66–73 per HO 229's grep — verify drift live). Reuse or extract that predicate; don't duplicate it.
- **Middle-column tab strip** is currently ACTIVITY · TOP STALLS, and both rebase against the dashboard's `?stage=` / `?topics=` filters (HO 134). MOVERS follows the same pattern.
- **No new color tokens.** ENACTED green = the existing enacted/stage-green token from the stage system. (The only new token in the 10-item set is `--ticker-closed`, which is HO 234.)

## Commit 1 — MOVERS tab

**Where:** the dashboard middle-column tab strip. Target order: **ACTIVITY · MOVERS · TOP STALLS**.

**One gate before building:** read ACTIVITY's predicate. If ACTIVITY already lists *stage transitions in the last 7 days sorted by recency* (rather than recent actions generally), MOVERS would duplicate it — HALT and report instead of shipping a twin tab. The design drew them as distinct; confirm the live code agrees.

**Content:** bills with `stage_changed_at` in the last 7 days — the `/changes` predicate, scoped through whatever query-helper convention the other two tabs use (`lib/queries.ts` or the dashboard's own data file; match siblings). Render rows with the from→to transition idiom (`showStageTransition`, dimmed prior stage). Tab label carries the count like its siblings.

**Sort (interim):** `stage_changed_at DESC`. Leave a one-line comment at the sort marking the future swap to hop-count rank once `stage_transitions` accrues — that's the whole deferred-+N footprint in this commit.

**Filters:** rebase with `?stage=` / `?topics=` exactly the way ACTIVITY and TOP STALLS do. Read how they consume the params and mirror it — don't invent a parallel mechanism.

**Verify:** third tab renders with count; rows show from→to; clicking a stage in the funnel rebases the tab; ACTIVITY and TOP STALLS unaffected.

**Commit:** `feat: MOVERS tab on dashboard middle column (HO 232, design item 5)`

## Commit 2 — transition log, write-only plant

**Table:** `stage_transitions` — bill key (match the shape `rating_history` used for its parent key in HO 220; follow that migration convention, `CREATE TABLE IF NOT EXISTS`), `from_stage`, `to_stage`, `changed_at`. Index on the bill key and on `changed_at`.

**Write point:** the exact branch in the sync/summarize path that currently writes `previous_stage` + `stage_changed_at` — append one row there, same condition (only on actual stage change). Nothing else: **no reads anywhere, no backfill, no UI.** The table exists so the +N handoff has data when it comes.

**Verify:** migration applied (table present in Turso), write wired at the correct branch by code-read. First real rows land at the next daily sync — Vercel Hobby gives no live trigger, so per the project's cron-validation pattern, confirm rows via the table after the next 09:00 UTC tick rather than forcing one. Say so in the ship report.

**Commit:** `feat: plant stage_transitions log, write-only (HO 232)`

## Commit 3 — ENACTED THIS WEEK banner

**Where:** thin full-width banner directly under the weekly-report snapshot band (HO 159 placement), above the two-column grid.

**Content:** `ENACTED THIS WEEK (N)` plus inline linked bill IDs when N ≥ 1, in the existing enacted green. **Empty state is visible by design** — at N = 0 the banner still renders, muted, something like `ENACTED THIS WEEK · NONE`. Don't hide it. If N runs long (unlikely; ~91 enacted across the whole congress), truncate after ~5 IDs with a `+N more` into `/bills?stage=enacted` or the nearest existing filtered surface — don't build a new one.

**Data:** the `dashboard-lead.ts` predicate. If it's embedded inline in the lead-sentence generator, extract it to a shared helper both call; one predicate, two consumers.

**Verify:** eyeball both states. The empty state is probably the live truth this week — that's a valid eyeball, it's the state the design explicitly wants visible. If the query returns ≥ 1, confirm the IDs link.

**Commit:** `feat: ENACTED THIS WEEK banner under weekly report (HO 232, design item 6)`

## Constraints

- Named `git add` per commit, never `-A`. Each commit verified before stacking the next.
- Scope fence: dashboard middle column, the report band, the one sync write point, the one migration. Don't touch `/changes`, don't restyle siblings, no new tokens, no hop-rank UI, no reads from `stage_transitions`.
- `npm run build` clean before the final push. If the dev server shows unstyled output, it's the stale `.next` hash again — `rm -rf .next` and restart before debugging anything else.
