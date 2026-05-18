# 76 — News matcher diagnosis

## What this is

Pure diagnostic handoff. No code changes that ship to production — just instrumentation to figure out which layer of the news pipeline is producing zero output, so the fix handoff can be scoped intelligently.

Handoff 75 confirmed: 55 articles fetched from Politico, The Hill, and Roll Call. Zero mentions inserted. Zero skipped-for-unknown-bill. The zero-skip detail is the diagnostic: if `extractBillIds()` returned a bill ID that didn't exist in the `bills` table, we'd see skips. Zero skips means extraction returned empty for every article. Question: is that because the articles arrive with empty title/summary fields (parser problem), or because the articles have content but the matcher misses real bill references (matcher problem)?

This handoff produces evidence. The fix is a separate scoping conversation once we know which layer broke.

## What to do

1. In `lib/news-sync.ts` (or wherever `ingestNews` lives), add a temporary debug log block. For the first 3 articles parsed from each RSS feed, log a structured block to console:

```
[news-sync:debug] Politico article 1/3
  title (124 chars): "GENIUS Act stalls as Schumer signals..."
  summary (87 chars): "Senate Democrats are weighing..."
  extractBillIds(title) → []
  extractBillIds(summary) → []
  extractBillIds(title + ' ' + summary) → []
```

Fields per article: source name, article title (full string, no truncation), article summary (first 200 chars + length), title length, summary length, and the result of `extractBillIds()` against title alone, summary alone, and concatenated. If `extractBillIds` is already called on a combined string, log just that one — match the actual production call shape so the diagnostic reflects what production sees.

2. Run `npm run sync:news` once locally and capture the console output.

3. Paste the first 9 article log blocks back into chat (3 from each of the 3 feeds). That's the deliverable.

## Out of scope

- Fixing the matcher
- Loosening the regex or relaxing the senate-S guard
- Adding new feeds (Congress.gov press, Punchbowl, GovTrack feeds)
- LLM-based matching as a fallback
- Removing or modifying any existing logic

All of those become possible once we have evidence. Pick the right one based on what the logs show, not before.

## What we expect to learn

Three possible shapes for the result:

- **Parser broken.** Titles/summaries arrive as empty strings or `undefined`. RSS feed format mismatch — the code expects fields the feeds aren't providing. Cheapest case to fix.
- **Content arrives but contains no bill IDs.** Titles read like "Senate weighs GENIUS Act compromise" with no `S 1234` or `HR 567` strings anywhere. The matcher is technically working — there's nothing for it to match. Architectural rethink: change feeds (use legislation-specific sources), change matcher (LLM/NER), or change scope (drop news theme for now).
- **Content arrives WITH bill IDs that aren't getting extracted.** Title contains `HR 2702` and `extractBillIds` returns `[]`. Regex bug, quick patch.

My bet is the middle one. Homepage RSS feeds from political journalism outlets don't use canonical bill IDs the way Congress.gov press releases do. But don't pre-commit to that — let the logs speak.

## Verification

1. `npm run sync:news` ran without crashing (debug logs don't break the pipeline).
2. Console output shows 9 article blocks (3 per feed × 3 feeds), each with all six fields.
3. Logs are pasted back to chat.
4. No changes committed yet — this is local instrumentation only. Final commit comes after the fix handoff lands and the debug logs come back out.

## Don't

- Don't commit the debug logs. They're for this one run; remove or comment out before pushing.
- Don't fix anything you see in the logs in this handoff, even if the bug is obvious. Just report. Fixing requires a scoping conversation about the right approach.
- Don't expand the log to all 55 articles. Three per feed is plenty for diagnosis.
- Don't add new logging anywhere outside the parse/match path. We're isolating one question.
