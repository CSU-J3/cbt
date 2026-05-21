# 104 — News matcher prompt tuning + confidence emission

## What this is

Direct follow-up to HO 103's audit. Three concrete changes to the LLM news matcher:

1. **Anchor on the article title** — title is the primary signal, summary is context only. Audit found 24% of matches were over-matching because the LLM was binding to bills mentioned in RSS summary teasers instead of the article's actual subject (e.g., immigration headline → ballroom bills because the teaser mentioned a ballroom).
2. **Sharpen the tangential-exclusion rule** — explicit instruction that topical adjacency isn't enough; the bill must be what the article is *about*, not what it's *near*.
3. **Emit confidence per match** — populate the existing `match_confidence` column on `news_mentions`. Currently NULL on all 21 rows; the schema is there but the matcher never wrote it.

You located the matcher and its prompt during HO 103. This handoff trusts that orientation — no need to re-derive.

## Pre-flight

1. View the current prompt. Note the existing structure (single-call vs. per-bill scoring, output format).
2. Confirm the `match_confidence` column type — TEXT vs. REAL vs. INTEGER. The output format below should match.
3. Confirm where in the matcher code the upsert into `news_mentions` happens — the confidence value gets threaded through whatever path stores `bill_id`.

## In scope

### Prompt changes

Specific language to weave in (adapt to the prompt's existing voice):

> The article title is the primary signal for matching. Treat the article summary as context only — do not match a bill if the connection to that bill exists solely in the summary teaser and is not reflected in the title's actual subject.
>
> Reject matches based on topical adjacency. A bill must be what the article is *about*, not what it is *near*. If the headline is about topic X and a bill addresses topic Y, do not match it even if the summary briefly mentions Y.
>
> For each matched bill, emit a confidence label: `high` (article title directly references the bill's subject), `medium` (title implies the subject but isn't explicit; summary corroborates), or `low` (uncertain but defensible match — prefer omitting over including).

The "prefer omitting over including" instruction shifts the precision/recall balance toward precision, which is what the audit pointed at. Recall was already sound per Code's audit notes.

### Output format

Restructure the LLM response to emit confidence per match. Suggested shape:

```json
{
  "matches": [
    { "bill_id": "119-hr-1234", "confidence": "high" },
    { "bill_id": "119-s-567", "confidence": "medium" }
  ]
}
```

If the current prompt uses a different output format (line-delimited, comma-separated bill IDs, etc.), restructure to JSON or extend the existing format with a confidence suffix. JSON is cleaner but if the current parser is hand-rolled and stable, an extension like `119-hr-1234:high` is fine.

### Code changes

- Parse the confidence label out of the LLM response
- Pass it through to the `news_mentions` upsert
- Store as TEXT ('high' / 'medium' / 'low') unless the column type dictates otherwise

### Validation against the audit's labels

HO 103's audit eyeball-labeled all 21 existing matches (48% correct + 29% defensible + 24% wrong). Re-run the tuned matcher against those same 21 articles and compare:

- Does it now reject the 5 wrong matches?
- Does it preserve the 10 correct matches?
- For the 6 defensible matches, does it emit `medium` or `low` confidence?

This is a small A/B test that gives concrete evidence the prompt change is actually better, not just different. Document the results in the commit message.

**Important caveat**: the bill DB has grown since the original matches were created (primaries cron, new bills). Re-running the matcher might surface bills that didn't exist as candidates the first time. That's not a regression — it's the matcher seeing a richer candidate set. Note any newly-introduced matches separately from the original 21 in the A/B comparison.

## Out of scope

- Pre-filter tuning (HO 86 word-overlap threshold — separate open thread)
- Switching the model (the recommendation was tune, not replace)
- UI to display confidence on the news surface (separate follow-up; getting the data first)
- Backfilling confidence on the existing 21 rows — leave as NULL, the A/B comparison results inform whether to retroactively overwrite or not. If the tuned matcher agrees with the eyeball labels, backfill confidence on the 21 rows in a follow-up commit; otherwise leave them and only new matches get confidence.

## Validation

1. Prompt updated; structure documented in commit message
2. Output format change (JSON or extension) parseable
3. `match_confidence` column populated on at least 5 fresh matches after the change (run a sync, check the column)
4. A/B comparison against HO 103's 21 labels recorded in commit message
5. The "ballroom-from-immigration-teaser" miss (specific example from HO 103) verifiably rejected by the new prompt

## Acceptance

- Single commit: `feat: news matcher tunes prompt for title-anchoring and confidence (HO 104)`
- A/B numbers from the validation step in the commit message
- `match_confidence` column populating on new matches
- News-signal theme can move from 70% → ~90% if the A/B shows real improvement (Code's read decides)

## Notes

- **The audit gave us free ground truth.** The 21 labeled matches are a rare gift — most prompt iterations don't have evals attached. Use them as the success criterion for this change. If the tuned prompt agrees with the labels on 18+/21, ship. If it agrees on <15, tune further before merging.
- **Confidence semantics.** `high`/`medium`/`low` is intentionally coarse. Numeric confidence (0-100) from an LLM is noisy and rarely well-calibrated. Three buckets gives downstream code a clean threshold (e.g., "only show `high` on the breaking-news banner; include `medium` in the full news feed").
- **What this closes (if it works).** News signal theme moves to ~90% — the matcher is the centerpiece, and a tuned version with confidence support is the substantive piece of the theme. Remaining 10% is polish: surface confidence in the UI, maybe a per-source weight, maybe re-running the audit on a larger sample. None of that blocks shipping.
- **What's still parked.** HO 86 pre-filter tuning stays its own thread. The pre-filter decides which articles get LLM'd at all; this handoff tunes what the LLM does once called. Different lever.
