# 111 — News signal confidence wiring

## What this is

Second fix handoff from the HO 109 audit. The HO 104 news matcher emits `match_confidence` into `news_mentions`, but `gatherReportData`'s "most talked about" query reads the rows without filtering or ranking by it. Result: 21 of 47 mentions are NULL-confidence regex matches weighted equally with high-confidence LLM matches.

HO 110 moved "Most talked about" from last to second in the report, right after the LEAD. The quality bar on that section just went up — a noisy regex match in position 2 destroys reader trust. Confidence filtering is no longer optional.

Scope: query layer + prompt context. No matcher changes. No UI changes.

## In scope

### 1. Filter the `mostTalkedAbout` query by confidence

In `gatherReportData` (or wherever the news aggregation query lives), add a confidence floor. Three open decisions:

- **Threshold value.** Look at the actual distribution of `match_confidence` across `news_mentions` before picking. If the LLM emits on a 0–1 scale, a defensible default is `>= 0.7`. If 0–100, scale accordingly. Don't guess — sample the data, pick a defensible cutoff, document the choice in the commit.
- **NULL handling.** Pre-HO-104 regex matches have NULL confidence. Two options: (a) include them as if they were 0.5 (the matcher's pre-tuning baseline accuracy was ~76%, per the HO 103 audit), or (b) hard-exclude. Recommend hard-exclude — 21 of 47 mentions being NULL means including them with any pretense of confidence floods the section with un-graded noise. Going forward, the matcher emits confidence on every match, so NULL is a backfill artifact, not an ongoing concern.
- **Minimum mention count per bill.** A bill cited in one article isn't "most talked about" — it's "appeared somewhere once." Suggest filtering bills with fewer than 2 mentions out of the section, but let Code propose if data shape suggests otherwise. If the next 6 weeks show typical totals of 5–15 mentions across all bills, a 2-mention floor leaves nothing. Look at the distribution first.

### 2. Rank by confidence

After filtering, `ORDER BY` should weight high-confidence matches first. Composite ranking is fine:

- Primary: count of mentions (more articles = more talked about)
- Secondary: average confidence of those mentions
- Tiebreaker: most recent mention date

Or whatever variant fits the data. The point is to stop alphabetical-by-bill-ID surface ordering (or whatever the current implicit sort is) and to surface the loudest-AND-most-confident at the top.

### 3. Pass confidence into the prompt context

`buildUserPrompt` currently passes news mentions as a flat list. After this handoff, the LLM should know which mentions are high-confidence vs. borderline so it can hedge wording appropriately ("widely covered" vs. "noted in").

Suggested shape: alongside each bill in the news section data, pass:

```ts
{
  bill_id: "119-hr-2702",
  mention_count: 7,
  avg_confidence: 0.91,
  top_outlets: ["Politico", "NYT", "Roll Call"],   // if already available
  sample_headlines: [...up to 3]
}
```

Don't surface raw 0.91 floats to the LLM — that invites it to recite them back ("with confidence 0.91"). Instead, bucket: `confidence_tier: 'high' | 'medium'`. The LLM uses tier as a soft signal for word choice, not as content to copy.

### 4. Audit the matcher distribution first

Before locking the threshold or the ranking weights, look at the actual data:

```sql
SELECT
  CASE
    WHEN match_confidence IS NULL THEN 'null'
    WHEN match_confidence < 0.3 THEN '<0.3'
    WHEN match_confidence < 0.5 THEN '0.3-0.5'
    WHEN match_confidence < 0.7 THEN '0.5-0.7'
    WHEN match_confidence < 0.9 THEN '0.7-0.9'
    ELSE '>=0.9'
  END AS bucket,
  COUNT(*) AS n
FROM news_mentions
GROUP BY bucket
ORDER BY bucket;
```

Adjust bucketing based on what the matcher actually emits. The threshold decision is data-driven, not vibes.

## Out of scope

- Re-running the matcher on the 21 NULL-confidence rows to backfill them (HO 104 territory)
- Changing the matcher prompt or scoring logic
- Adding confidence UI anywhere other than the reports prompt context
- Surfacing confidence in `/news` or `/bill/[id]` (separate handoff if wanted)
- Prose tuning around how the LLM uses the confidence tier (HO 112)
- Bill-ID linking in reports (HO 113)

## Verification

1. Generate a fresh report (or regenerate against a recent week with adequate news data — probably 05-11 or 05-18 since RSS data exists there). Spot-check the "Most talked about" section:
   - All cited bills had `>=` threshold confidence on their mentions
   - Ranking puts the loudest+highest-confidence bills first
   - No bill with a single mention surfaces (if the floor decision included one)
2. Run the bucketing query before and after to confirm the threshold lands where intended.
3. Read the regenerated section as a reader — does the prose hedge appropriately on medium-confidence mentions and assert on high-confidence ones?

## Acceptance

1. `gatherReportData` (or whichever module) filters `news_mentions` by `match_confidence >= ${threshold}` with the chosen threshold documented in a code comment.
2. NULL-confidence handling explicit in the query (recommended: hard-exclude).
3. Minimum mention-count floor present (or explicitly decided against, with reasoning in commit).
4. Ranking weights confidence in addition to mention count.
5. Prompt context passes `confidence_tier` not raw floats.
6. Bucket-distribution query results captured in the commit message or PR description so the threshold choice is defensible.
7. One regenerated report's "Most talked about" section spot-checked — output looks like signal, not noise.
8. SKILL.md gets a one-liner under news signal: threshold + NULL-handling convention.
9. Commit: `fix: confidence-filter news signal in weekly reports (HO 111)`.
10. Working tree clean, push.

## Notes

- HO 110 moving "Most talked about" to position 2 means this section is now the second thing a reader sees. Quality bar is high. If after this handoff the section still feels uncurated, that's a signal to go further (smaller floor count, higher threshold, manual override list) — not in this handoff but worth flagging in the report-back.
- The NULL-confidence backfill question is a separate decision. If you want those 21 mentions graded, that's a one-off matcher re-run handoff. For now they're effectively dropped from reports, which is the safer default.
- HO 112 (prose) comes next. The `confidence_tier` you surface here is the lever HO 112 uses for hedging wording. Decide the tier vocabulary now so HO 112 doesn't invent its own.
