# 43 — Stage-change feed

A `/changes` route showing bills that moved stage in the last 7 days. Three time-axis views exist already (recent on `/`, stuck on `/stale`, at desk on `/president`); this adds the movement view, likely the newsiest surface on the dashboard.

Approach: snapshot diff at sync time. Two new columns on `bills` populated whenever the LLM reclassifies a bill's stage. No new tables, no extra LLM cost, no parsing of `latest_action_text`.

## Verify-first gate

Run this against prod before writing anything:

```sql
SELECT stage, COUNT(*) FROM bills GROUP BY stage ORDER BY 2 DESC;
```

If the distribution looks wrong (everything in `introduced`, or the validator's added categories like `government_operations` are absent, or any non-trivial chunk has NULL stage), flag back. The feed will be lopsided regardless of UI quality if the upstream classification is broken.

## Schema migration

Add to the migration script:

```sql
ALTER TABLE bills ADD COLUMN previous_stage TEXT;
ALTER TABLE bills ADD COLUMN stage_changed_at TEXT;
CREATE INDEX idx_bills_stage_changed_at ON bills(stage_changed_at DESC);
```

No backfill. Existing rows get NULL for both. The feed will be empty until the next sync observes a real transition. That is correct.

## Sync / summarize logic

In `lib/summarize.ts` (or wherever the parsed `stage` gets written back), before the upsert:

- Read the existing row's `stage` (call it `oldStage`).
- After parsing the LLM response, get `newStage`.
- If `oldStage` is non-null AND `oldStage !== newStage`: set `previous_stage = oldStage`, set `stage_changed_at = new Date().toISOString()`.
- If `oldStage` is null (first classification of this bill), leave the new columns alone. We didn't observe a transition.

This logic should run for both the standalone `npm run summarize` script and the cron route.

## Query

Add to `lib/queries.ts`:

```ts
export async function getStageChanges(days = 7)
```

Returns bills where `stage_changed_at > now() - days`, ordered by `stage_changed_at DESC`. Include `previous_stage` and `stage_changed_at` on the returned row shape so the page can render the transition.

## Page

`app/changes/page.tsx`, mirroring the structure of `/stale` and `/president`:

- Server component. Fetches `getStageChanges(7)`.
- `SearchBox` and `TopicFilter` thread through with `basePath="/changes"`.
- No stage filter dropdown. The page is about transitions, not destination stages. (If the page feels worse without it after looking at real data, flag back and we'll revisit.)
- Header chrome: count mode label `STAGE CHANGES`. Subtitle: `last 7 days, most recent first`.
- Empty state: single muted line. Suggested copy: `No stage changes in the last 7 days.`

## Row rendering

The stage column needs to show the transition, not just the destination. Add a `showStageTransition?: boolean` prop on `BillRow`. When true:

- Stage cell renders both stages with an arrow between them: `▸ INTRO → ▸▸ COMMITTEE`. Compose two `StageIndicator` instances, the first dimmed (use `var(--text-dim)` or pass a `muted` prop, whichever is cleanest).
- Action-date column shows `stage_changed_at` as a relative timestamp (`3d ago`), not `latest_action_date`. Branch on the same prop.

The grid template needs the stage column widened from `90px` to roughly `170px` for this page only. Pass the wider template via a class or prop on the parent feed wrapper rather than mutating the default `BillRow` grid.

## HeaderBar

Add `⇄ Changes` to the nav. Order: `/` `/stale` `/changes` `/president` `/watchlist`. The "in motion" view sits between "stuck" and "at desk."

Add the `STAGE CHANGES` count mode to whatever existing pattern handles count chrome (`countMode` prop, similar to `president`).

## SKILL.md

Update `.claude/skills/cbt/SKILL.md`:
- Add `/changes` to the Pages section with a one-line description.
- Add `previous_stage TEXT` and `stage_changed_at TEXT` to the bills table schema block.
- Add a one-liner under sync logic describing when these columns get populated.

## Out of scope

- No backfill of `previous_stage`. There's no history to work from.
- No multi-step transition tracking. Only the most recent change per bill is retained; that's the v1 design.
- No "moved from X" filter dropdown. Future iteration.
- No parsing of `latest_action_text` to derive transitions. Trust the LLM `stage`, same rule as everywhere else.
- Don't touch the existing `latest_action_date` rendering on other pages.
