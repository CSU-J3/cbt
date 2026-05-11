# 45 — Backfill 119th and finish 44's cleanup

Continuation of handoff 44. The prompt fix from 44 worked, but Phase 1 (the sync backfill) was skipped, so the dashboard still has only 8 of Congress.gov's ~88 public laws. This handoff runs Phase 1, fixes the NULL-comparison bug in 44's cleanup SQL, and confirms the sres/hres false positives get cleared.

## What 44 left in place

- Prompt fix in `lib/summarize.ts` — keep, it's correct.
- 6 previously-NULL public-law rows now correctly tagged `enacted` — keep.
- One-shot summarize wrapper that bypasses `previous_stage` writes — keep the pattern, will need it again.

## What 44 left undone

- ~70 enacted public laws missing from the DB because sync's watermark started 2026-02-04.
- 10 sres/hres rows still sitting at `stage = 'enacted'`. (Per recap, "weren't in 44's cleanup set," but 44's Query B explicitly targeted them. Either it wasn't run, or the bill_type literals don't match. Step 0 below resolves which.)
- 44's Query A had a NULL-comparison bug: `WHERE stage != 'enacted'` excludes `stage IS NULL` rows. Fixed below.

## Sequence

### 0. Confirm bill_type literals (10 seconds)

Before anything else, run:

```sql
SELECT bill_type, COUNT(*) AS n
FROM bills
GROUP BY bill_type
ORDER BY n DESC;
```

Confirm the values match SKILL.md's documented lowercase literals: `hr`, `s`, `hjres`, `sjres`, `hconres`, `sconres`, `hres`, `sres`. If they're capitalized differently or use other strings, adjust every `bill_type IN (...)` clause below to match.

### 1. Backfill

Same as 44 Phase 1. Create `scripts/backfill-119.ts`. It paginates `/bill/119` from `2025-01-03T00:00:00Z` instead of `MAX(update_date)`. Reuse `lib/sync.ts` upsert logic; only the start date differs. Run it. Delete the script after.

Roughly 70-80 new rows expected, mostly bills enacted before the dashboard started syncing.

### 2. Verify the backfill landed

```sql
SELECT COUNT(*) AS n
FROM bills
WHERE latest_action_text LIKE '%Became Public Law%'
   OR latest_action_text LIKE '%Signed by President%';
```

Should now return ~85 (was 8). If it's still in single digits, the action-text patterns don't match the data; pull one PL bill from Congress.gov and update the LIKE clauses before continuing.

### 3. Clean up — both directions, NULL handled

```sql
-- A. Missing enacted (NULL-safe, only bill types that can become law)
UPDATE bills
SET summary = NULL,
    summary_model = NULL,
    summary_updated_at = NULL
WHERE (latest_action_text LIKE '%Became Public Law%'
       OR latest_action_text LIKE '%Signed by President%')
  AND (stage IS NULL OR stage != 'enacted')
  AND bill_type IN ('hr', 's', 'hjres', 'sjres');

-- B. False positives: sres/hres/conres at stage='enacted'
UPDATE bills
SET summary = NULL,
    summary_model = NULL,
    summary_updated_at = NULL
WHERE bill_type IN ('sres', 'hres', 'sconres', 'hconres')
  AND stage = 'enacted';
```

A should now match the new backfilled rows plus the original missing-enacted set. B should clear the 10 sres/hres false positives if Step 0 confirmed the literals match. Combined target: roughly 80-90 rows.

### 4. Re-summarize

`npm run summarize`. Use the same one-shot wrapper from 44 that bypasses `previous_stage` writes (the corrected rows aren't real transitions; logging them in `/changes` would be misleading).

## Acceptance

```sql
SELECT stage, COUNT(*) AS n FROM bills GROUP BY stage ORDER BY n DESC;
```

`stage = 'enacted'` should land within 2-3 of 85 (Congress.gov's current count, which moves slowly).

```sql
SELECT bill_type, COUNT(*) AS n
FROM bills
WHERE stage = 'enacted'
GROUP BY bill_type;
```

Only `hr`, `s`, `hjres`, `sjres`. No `sres`, `hres`, `sconres`, `hconres`.

```sql
SELECT COUNT(*) AS n FROM bills WHERE stage IS NULL;
```

Should not have grown materially from 569.

If all three pass, deploy to Vercel. If enacted lands meaningfully under 70, something in the backfill missed; debug before deploying.

## Don't

- Don't permanently change `sync.ts` watermark logic. The backfill stays a one-shot.
- Don't backfill `previous_stage` / `stage_changed_at`.
- Don't keep `scripts/backfill-119.ts` after the run.
- Don't deploy if enacted lands under 70. Below that, the backfill or prompt has another bug to track down first.
