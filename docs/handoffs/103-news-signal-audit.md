# 103 — News signal matcher audit + viz-audit.md cleanup

## What this is

Two pieces in one commit:

1. **Primary:** Audit the LLM news matcher (HO 86) for accuracy. The matcher links RSS articles to specific bills in the DB and has been live but unaudited since it shipped. Theme news signal sits at 70% mostly because of this unknown — once we know how good the matcher actually is, the theme moves up or a tuning handoff gets scoped.
2. **Tail:** Patch one stale line in `docs/viz-audit.md` left over from HO 100's roadmap commit.

`revalidateTag('primaries')` stays parked — it's dependent on primaries queries getting `unstable_cache`'d first, which hasn't happened. Not actionable yet.

## Pre-flight (mandatory)

1. **Locate the matcher.** HO 86 added it; find the function (likely in `lib/news-matcher.ts`, `lib/news-sync.ts`, or similar). Document the matcher's prompt, model, and decision logic in the audit doc — `lib/` location, what it takes in, what it stores.
2. **Locate the matches.** HO 102 established the table is `news_mentions`. Confirm the schema: at minimum it should have `article_title`, `bill_id`, plus probably a confidence score or rationale field. Verify column names before writing the audit queries.
3. **Sample size.** `SELECT COUNT(*) FROM news_mentions` — if total matches is under 50, audit all of them. If 50-200, audit a random sample of 50. Above 200, audit 50 random + 25 most recent.

## Audit method

Two-pass heuristic check, no human labeling required for v1.

### Pass 1: cheap textual corroboration

For each sampled match, compute corroboration signals:

- Does the article title contain the matched bill's number (e.g., "HR 1234", "H.R. 1234", "1234")?
- Does the article title contain the sponsor's last name?
- Word overlap between article title and bill title — fraction of bill-title non-stopwords that appear in the article (lowercased, punctuation stripped).
- Article summary (if scraped) shows any of the above?

Classify each match as:

- **Strong corroboration:** bill number OR sponsor name appears
- **Weak corroboration:** ≥30% bill-title word overlap, no bill number / sponsor
- **No corroboration:** neither signal hits

### Pass 2: false-positive triage

For matches with no corroboration, manually eyeball 10 of them in the audit doc. Side-by-side: article title, matched bill title, why the matcher might have linked them (sponsor name in summary? topic overlap? hallucination?). This is the qualitative slice.

## Deliverable

`docs/news-signal-audit.md`. Sections:

1. **Method.** Sample size, what was checked, why.
2. **Headline numbers.** % strong-corroboration / weak / none. Total matches in DB.
3. **Failure modes.** 5-10 specific examples of no-corroboration matches with annotation.
4. **Recommendation.** One of:
   - Ship as-is — matcher meets the bar
   - Tune the prompt — specific failure modes that prompt changes could fix
   - Tighten the pre-filter (the HO 86 word-overlap threshold) — costs fewer LLM calls
   - Switch model or add a post-filter — bigger change, needs its own handoff

The recommendation drives whatever the next news-signal handoff scopes (or closes the theme as good-enough).

## Tail-end: viz-audit.md cleanup

After the audit doc lands, patch `docs/viz-audit.md`. The audit doc currently says something close to "no `docs/roadmap.md` (or any roadmap* file) exists" — HO 100 committed `docs/roadmap.md` so the line is stale. Either:

- Strike the line entirely (cleanest)
- Or replace with a dated note: "At audit time (May 2026), `docs/roadmap.md` did not exist; HO 100 subsequently committed it. The audit's roadmap citations now resolve correctly."

Your call which. The second preserves the historical context of why HO 99 fell back to an inline list.

## Out of scope

- Modifying the matcher prompt or pre-filter (that's a follow-up if the audit recommends it)
- Re-running the matcher against existing matches
- Adding human-labeled ground truth (v1 is heuristic-only; if the audit recommends a hand-label round, that's a separate handoff)
- Touching `news_mentions` rows (audit is read-only)
- `revalidateTag('primaries')` — still parked

## Validation

1. Audit doc exists at `docs/news-signal-audit.md` with all four sections
2. Sample size + method documented; numbers reproducible from the queries the doc cites
3. At least 5 qualitative failure-mode examples documented
4. Recommendation is one of the four options above, with rationale
5. `docs/viz-audit.md` no longer claims the roadmap file doesn't exist

## Acceptance

- Single commit: `docs: news signal audit + viz-audit cleanup (HO 103)`
- Two files changed (audit doc new, viz-audit.md edited)
- No code changes anywhere else

## Notes

- **What "good enough" looks like.** Personal-use bar, not academic. If strong-corroboration is >60% and the no-corroboration cases are mostly understandable (e.g., article references the bill by its marketing name, sponsor mentioned in body not title), shipping as-is is defensible. Below 40% strong-corroboration is a real problem.
- **Pre-filter context.** HO 86's pre-filter uses word overlap to decide whether to call the LLM at all. That's a separate dial from match accuracy — pre-filter trades cost for recall (more skipped articles = fewer LLM calls = lower cost, but more missed matches). The audit might surface a recommendation to adjust this threshold; that's the carried "HO 86 pre-filter tuning" open thread closing as a real action.
- **Theme % movement.** If the audit recommends "ship as-is," news signal can move from 70% to ~90% (the matcher is the centerpiece; everything else in the theme is polish). If it recommends tuning, the theme stays at 70% until the tuning lands.
