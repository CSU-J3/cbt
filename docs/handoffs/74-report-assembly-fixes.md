# 74 — Weekly report assembly fixes

## What this is

First Monday cron tick fired this morning. Report scaffolding works but three sections render wrong content and the headline numbers contradict the body. Fix these before next Monday's tick so the surface earns its weekly slot instead of burning trust week after week.

This is a `lib/report-generation.ts` handoff (with a possible touch to `lib/sync.ts` depending on what bug 1's diagnostics show). No schema changes, no new sections, no UI changes. Three bugs and one cosmetic touch-up.

## The bugs

### 1. Stage Movements returns 0 when it shouldn't

This week's report claims zero stage transitions, but S 723 became law during the same week. An enactment is by definition a stage transition (`other_chamber` or `floor` → `enacted`). Something is broken.

**Investigate before fixing.** Run these against Turso:

```sql
-- A. Is stage_changed_at populated for S 723?
SELECT id, stage, previous_stage, stage_changed_at, summary_updated_at
FROM bills
WHERE id = '119-s-723';

-- B. What stage transitions registered in the week May 4–10, 2026?
SELECT id, previous_stage, stage, stage_changed_at
FROM bills
WHERE stage_changed_at BETWEEN '2026-05-04T00:00:00Z' AND '2026-05-10T23:59:59Z'
ORDER BY stage_changed_at;
```

Two likely outcomes:

- **A returns null `stage_changed_at`.** The sync path that promoted S 723 didn't write the transition fields. Per SKILL.md the LLM-resummarization path is the only place that writes `stage_changed_at`, and it only writes when the prior `stage` was non-null *and* differed from the new one. If S 723's prior stage was null or the same value (already classified as `enacted` on a previous run), no transition gets recorded. Fix in `lib/sync.ts`: when a bill arrives at the `enacted` stage for the first time, treat it as a transition and write `stage_changed_at` regardless of prior-stage state. Same logic for any first-time-seen non-`introduced` stage if you want to be thorough, but the immediate failure case is enactment.

- **A has the timestamp but B returns no rows for the report window.** Week-range bounds in `lib/report-generation.ts` are off. Confirm `weekStart` and `weekEnd` derivation matches what the "Week of May 4" label implies (Sunday-start, Saturday-end, in UTC). The cron fires Monday so the report describes the prior calendar week.

Pick the fix based on what the diagnostics show. Don't guess.

### 2. Dead in Committee shows the cumulative backlog, not weekly deaths

Current behavior groups every currently-silent bill (action 30+ days ago) by topic and shows top counts. Result: `Government operations (4205)` is the entire stalled backlog of the 119th Congress, not what newly died this week. This section will read nearly identically every week for months as-is.

New behavior: bills whose staleness threshold was crossed *during* this week. Semantically:

- At week start: the bill was still in the "recent action" window (less than threshold days stale).
- At week end: the bill has crossed the threshold (threshold-or-more days stale).

That's a one-week sliding window on `latest_action_date`, shifted backwards by the threshold:

```
latest_action_date > (weekStart - threshold_days)
  AND latest_action_date <= (weekEnd - threshold_days)
```

**Threshold:** use **60 days**, not 30. The `/stale` page already uses 60 (per SKILL.md), and 30 is too short — lots of bills are legitimately idle 30+ days mid-process. Align with `/stale`. Update the section's intro sentence to reflect the threshold.

**Stage filter:** restrict to `stage IN ('introduced', 'committee')`. Exclude `floor` and `other_chamber` — stalls on those are a different phenomenon (whip count problems, not committee neglect) and conflating them muddies the section's thesis.

**Ceremonial:** continue excluding ceremonial bills (`is_ceremonial = 0`).

**Output format:** group by topic via `json_each(topics)`, show top 5–10 topics by count of newly-stale bills, list 3 representative bill IDs per topic. Drop the giant (NNNN) parenthesized count — with the temporal cut, counts will be in the dozens or smaller and that's honest.

```
DEAD IN COMMITTEE
Bills that crossed 60 days without action this week, grouped by topic.

· Healthcare (8): HR 138, HR 73, HR 44
· Government operations (6): HRES 5, HR 51, HR 160
...
```

### 3. Topic Breakdown contradicts the intro line

Report says "100 bills introduced" then says "No topic activity this week." The aggregation is reading the wrong source — likely looking at stage transitions (which returned 0 per bug 1) or some other empty set, not at the week's introductions.

Fix: aggregate `topics` JSON for bills where `introduced_date` falls in the week range, count per topic, show top 5–7 by count. Drop the "no specific topic dominated" framing entirely — that copy isn't useful even when populated.

```
TOPIC BREAKDOWN
What got introduced this week, by topic.

· Healthcare (18)
· Taxes (14)
· Government operations (12)
· Defense (9)
· Education (7)
```

Keep ceremonial-excluded for consistency with the rest of the report. If a week somehow has zero introductions (won't happen during session), a real empty-state line is fine.

### 4. Notable Introductions truncate mid-word

Current output: `HR 8700 — To protect U.S. food security, provide the Committee on Foreign Investment in t…`

Truncation cuts at character N regardless of word boundary. Fix: truncate at the last whitespace before character ~80, then append `…`. Fall back to hard character truncation if no whitespace exists in the first 80 characters (defensive against pathological titles).

Don't change the title source. These are official Congress.gov titles and the report should reflect them. Just fix the slicing.

## Out of scope

- News mentions wiring for "Most Talked About" — separate handoff next
- Schema changes
- New report sections
- Report format / typography changes beyond the four bugs above
- Backfilling `stage_changed_at` for historical transitions (only matters going forward)
- Deduping multi-topic bills across Dead in Committee categories (HR 51 in two cells is legitimate)

## Verification

1. Re-run report assembly for the May 4 week via the CLI and inspect output.
2. Stage Movements section shows S 723's enactment plus any other transitions uncovered by the diagnostic queries.
3. Dead in Committee shows bills that newly crossed 60d staleness during May 4–10, not the cumulative backlog. Counts per topic are small (single or double digits), not in the thousands.
4. Topic Breakdown shows top 5–7 topics from this week's 100 introductions, with counts.
5. Notable Introductions truncations end at word boundaries.
6. Run for a different week (`--week 2026-04-27` or whichever past week has data) and confirm Dead in Committee and Topic Breakdown counts differ. If they're identical across weeks, the temporal cut isn't working.

## Don't

- Don't add new sections in this handoff. The wiring problems with the existing sections are enough scope.
- Don't try to fix "Most Talked About" — separate handoff, depends on confirming `news_mentions` has good matches first.
- Don't backfill `stage_changed_at` for historical transitions.
- Don't change the 09:00 UTC cron schedule or report storage location.
- Don't change the threshold to 30 days "to catch more bills" — 60 matches `/stale` and that consistency matters more than count optics.
