# 44 — Backfill sync gap and fix enacted classifier

Replaces the earlier draft of this handoff. The original assumed a single classifier bug; the verify gate surfaced two layered problems and a corresponding two-direction cleanup.

## Goal

Make the dashboard's `stage = 'enacted'` count match Congress.gov's 119th Congress public-laws total of 85.

## What the verify gate surfaced

(Code: paste the actual numbers from the original verify queries here when running this handoff.)

Approximate state going in:

- Bills in DB with public-law action text: ~7 (Congress.gov has 85)
- Bills currently at `stage = 'enacted'`: 11
- Of those 11, roughly 10 are sres/hres rows that can't actually be enacted (simple resolutions don't have force of law)

So the real gap is two stacked bugs. Roughly 78 enacted public laws are missing from the DB entirely because sync's incremental watermark never pulled them. The 11 currently flagged as enacted are mostly false positives. Net real enacted bills in the DB: about one.

## Decisions

Backfill sync first. The classifier prompt fix is moot if the data isn't there. Fixing how the LLM reads action text won't help on bills that never got pulled.

Treat the backfill as a one-shot, not a permanent change to `sync.ts`. The incremental watermark logic is correct for normal operation; the gap exists only because the dashboard started syncing partway through the 119th Congress.

Update the prompt in both directions: read action text correctly for enactment, and prevent simple/concurrent resolutions from being marked enacted under any circumstances.

Clear summaries on the misclassified set in both directions: bills with public-law action text but `stage != 'enacted'`, and `sres`/`hres`/`*conres` rows currently sitting at `stage = 'enacted'`.

Don't backfill `previous_stage` / `stage_changed_at` for the corrected rows. They'd inject ~80 fake transitions into `/changes`.

## Files to touch

- `scripts/backfill-119.ts` — new throwaway script for the one-shot historical pull. Don't commit it; delete after the run.
- `lib/summarize.ts` — update prompt with stage rules and a bill-type guard.
- One throwaway script or direct SQL for the bidirectional cleanup, then `npm run summarize`.

## Sequence

### Phase 1 — Close the sync gap

1. Create `scripts/backfill-119.ts`. It calls Congress.gov's `/bill/119` endpoint paginated from `2025-01-03T00:00:00Z` (start of the 119th) instead of from `MAX(update_date)`. Reuse `lib/sync.ts` upsert logic; only the watermark/start date differs.

2. Run it. Most of the existing rows already match; the new pulls are bills that haven't seen text updates since before the dashboard's first sync.

3. Re-run the original verify Query A:

```sql
SELECT COUNT(*) AS n
FROM bills
WHERE latest_action_text LIKE '%Became Public Law%'
   OR latest_action_text LIKE '%Signed by President%';
```

Should now return roughly 85. If it's still in the single digits, the action-text patterns are wrong. Pull one signed-into-law bill from Congress.gov, look at how its `latest_action_text` is phrased in the dashboard, update the patterns, repeat. Don't proceed past this gate until the count is close to 85.

### Phase 2 — Apply the prompt fix

In `lib/summarize.ts`, find the prompt template. Add a stage cheat-sheet section before the JSON instruction. Two parts: action-text rules, and a bill-type guard.

```
Determine `stage` from the latest_action_text. Use these rules in order. The
action text is ground truth; do not infer stage from bill content.

- "Became Public Law" or "Signed by President" → enacted
- "Presented to President" or "to the President" → president
- "Passed Senate" AND "Passed House" both appear → other_chamber
- "Passed Senate" or "Passed House" (only one) → floor
- "Reported" or "Ordered Reported" or "Committee Consideration" → committee
- "Referred to" with no further action → committee
- otherwise → introduced

Bill-type guard: simple resolutions (sres, hres) and concurrent resolutions
(sconres, hconres) cannot be enacted. They have no force of law and don't
become public laws. For these bill types, never return stage = enacted.
If the action text would otherwise suggest enacted, return floor or
other_chamber based on where the resolution was passed.
```

Test the new prompt locally on three bills before any mass clearing:

- Two `hr` or `s` bills with "Became Public Law" in their action text. Expect `stage: enacted`.
- One `sres` or `hres` row currently misclassified as enacted. Expect `stage: floor` or `other_chamber`, never `enacted`.

If any of those don't classify correctly, iterate on the prompt before continuing.

### Phase 3 — Clear and re-summarize

Two cleanup statements. Run both, then `npm run summarize`.

```sql
-- A. Bills missing the enacted classification
UPDATE bills
SET summary = NULL,
    summary_model = NULL,
    summary_updated_at = NULL
WHERE (latest_action_text LIKE '%Became Public Law%'
       OR latest_action_text LIKE '%Signed by President%')
  AND stage != 'enacted';

-- B. False positives: simple/concurrent resolutions wrongly at enacted
UPDATE bills
SET summary = NULL,
    summary_model = NULL,
    summary_updated_at = NULL
WHERE bill_type IN ('sres', 'hres', 'sconres', 'hconres')
  AND stage = 'enacted';
```

Combined target is roughly 80 to 90 rows; takes a few minutes via `npm run summarize`.

## Acceptance

```sql
SELECT stage, COUNT(*) AS n FROM bills GROUP BY stage ORDER BY n DESC;
```

`stage = 'enacted'` should land within 2 to 3 of Congress.gov's 85.

```sql
SELECT bill_type, COUNT(*) AS n
FROM bills
WHERE stage = 'enacted'
GROUP BY bill_type
ORDER BY n DESC;
```

Should show only `hr`, `s`, `hjres`, `sjres`. No `sres`, `hres`, `sconres`, or `hconres`.

```sql
SELECT COUNT(*) AS n FROM bills WHERE stage IS NULL;
```

NULL count shouldn't have grown materially. If it did, the new prompt is breaking on bills it previously classified, which means the rules need loosening somewhere.

Spot-check three random new `enacted` bills: confirm `latest_action_text` actually contains "Became Public Law" and that the summary text describes the bill's substance, not just "this bill became law."

## Don't

- Don't permanently change `sync.ts` watermark logic. The incremental sync is correct for ongoing operation; the backfill is a one-shot.
- Don't backfill `previous_stage` / `stage_changed_at` for the corrected rows.
- Don't run a full re-summarization of all 1,933 bills. Only the misclassified set in both directions.
- Don't deploy to Vercel until local acceptance passes. A bad prompt going to cron will mass-corrupt overnight.
- Don't keep `scripts/backfill-119.ts` after the run completes.
