# 114 — Breaking news on home + rename /templates to /patterns

## What this is

Two independent tracks in one handoff:

1. **Phases 1 + 2**: Surface breaking news on the home page. `/news` already exists as a route but is currently empty in the live "last 24h" window. Before building the home-page block, diagnose whether `/news` is empty because of cron silence, too-tight confidence filter, or genuinely sparse data. Then build the home block with the right time window and threshold per findings.

2. **Phase 3**: Rename `/templates` to `/patterns`. The current name is technically accurate but framing is opaque. "Patterns" is neutral, single-word, matches the page's existing copy ("pattern-matched cluster identities"). Independent of phases 1 and 2; can ship in parallel.

## Phase 1 — News diagnostic (HALT for sign-off)

Pre-flight on news before any building. Don't skip this. Output goes back in chat; the next move is decided from there.

### Queries to run

```sql
-- Confidence distribution across news_mentions
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

```sql
-- Daily ingestion volume, last 14 days
SELECT
  date(ingested_at) AS day,
  COUNT(*) AS rows_ingested
FROM news_mentions
WHERE ingested_at >= datetime('now', '-14 days')
GROUP BY day
ORDER BY day DESC;
```

```sql
-- Most recent ingestion + publication timestamps
SELECT MAX(ingested_at) AS latest_ingest,
       MAX(published_at) AS latest_published,
       COUNT(*) AS total_rows
FROM news_mentions;
```

```sql
-- What's actually in the last 24h, regardless of confidence
SELECT bill_id, source, published_at, match_confidence, matched_via, article_title
FROM news_mentions
WHERE published_at >= datetime('now', '-24 hours')
ORDER BY published_at DESC;
```

```sql
-- What's in the last 72h, by confidence bucket
SELECT
  CASE
    WHEN match_confidence IS NULL THEN 'null'
    WHEN match_confidence < 0.7 THEN '<0.7'
    ELSE '>=0.7'
  END AS bucket,
  COUNT(*) AS n
FROM news_mentions
WHERE published_at >= datetime('now', '-72 hours')
GROUP BY bucket;
```

### Code paths to read

- The query that powers `/news`. Find it (likely `lib/queries.ts` or directly inside `app/news/page.tsx`). Capture the WHERE clause verbatim: confidence floor, time window, any other filter.
- The query that powers the weekly report's "most talked about" section in `gatherReportData` (or wherever HO 111 wired the confidence filter). Capture its WHERE clause too. Compare.
- `vercel.json` cron entries. Confirm news sync is wired and what schedule it runs on.
- Whatever route handles the news cron (`app/api/sync-news/route.ts` or similar). Look at the most recent invocation log if accessible, or just confirm the route exists and its shape.

### Report format

Post findings in chat with these sections:

1. Confidence distribution (table from query 1)
2. Daily ingestion volume last 14d (table from query 2). Flag any zero-row days.
3. Latest ingest + published timestamps (query 3)
4. What's actually in last 24h (query 4 results, or "0 rows" if empty)
5. What's in last 72h by confidence (query 5)
6. `/news` WHERE clause and report query WHERE clause, side by side
7. Cron config for news sync

End with a one-paragraph diagnosis of which case applies:

- **A. Cron is silent.** Recent days have 0 ingested rows. Fix the cron before anything else.
- **B. Cron is live, filter is too tight.** Rows exist in last 24h but `/news`'s confidence filter drops them all. Recommend a layered approach: high-confidence rows get the home block, medium-confidence rows get `/news` only.
- **C. Cron is live, data is genuinely sparse.** Rows exist but bill-matched ones are rare day-to-day. Recommend a longer window for the home view (72h or 7d).
- **D. Mix.** Some of the above. Describe specifically.

Then propose the home block's time window and confidence threshold for Phase 2 to use. Don't build yet.

### HALT

Phase 1 ends here. Wait for sign-off in chat before starting Phase 2.

## Phase 2 — Breaking news block on home page (after Phase 1 sign-off)

Once Phase 1's strategy is locked in chat, build:

### Query helper

If `/news` already has a query helper, extend it (or add a sibling) that takes the home-block's chosen parameters:

```ts
async function getBreakingNewsForHome({
  limit = 3,
  hours = 24,           // Phase 1 may bump this to 72 or 168
  minConfidence = 0.7,  // Phase 1 may adjust
}): Promise<BreakingNewsItem[]>
```

Each item: `bill_id`, `bill_title` (joined from bills, truncated for display), `source`, `published_at`, `article_url`, `article_title`. Dedup by bill_id; same bill mentioned in three articles surfaces once on the home block, with the most recent article picked.

If `/news` doesn't have a clean query helper to extend, refactor lightly: extract a shared helper that takes parameters, used by both `/news` and the home block.

### Component

`components/BreakingNewsBlock.tsx`, server component, terminal aesthetic. Per-row layout based on the mockup:

```
BREAKING · LAST 24H                                            [VIEW ALL →]
HR 1234   House committee advances tax relief...     WASHINGTON POST   2h
S 567     Senate moves to expand veterans mental...   POLITICO          9h
HJRES 14  Spectrum-auction renewal clears...          AXIOS             23h
```

Columns:
- Bill ID linked to `/bill/[id]`, monospace, `--accent-amber-bright`
- Headline (`article_title`) truncated to fit single line
- Source name uppercase, right-aligned, `--text-muted`
- Relative timestamp ("2h", "9h", "23h"), right-aligned, `--text-muted`

Empty state: "No breaking news in the last [window]." Match the empty-state pattern used elsewhere on the dashboard.

`[VIEW ALL →]` links to `/news`.

### Placement

Slot into `app/page.tsx`. Place above the stage funnel. Don't reorganize the rest of the page. If the Claude Design mockup's full layout becomes a real handoff later, that handoff can move the block.

### Cache + revalidation

Wrap the query helper in `unstable_cache` with tag `breaking-news-home`. Add `revalidateTag('breaking-news-home')` to the news sync route wherever it writes to `news_mentions`.

### Verification

1. Visit `/`. Block renders above the stage funnel.
2. Click a bill ID. Lands on the right `/bill/[id]` page.
3. Click `[VIEW ALL →]`. Lands on `/news`.
4. If Phase 1's diagnosis was C (sparse data, longer window), confirm the block window matches Phase 1's recommendation.
5. Force-clear the cache (or wait for next sync), confirm the block updates.

## Phase 3 — Rename /templates to /patterns

Independent of phases 1 and 2. Can run in parallel with Phase 2, or before Phase 1 entirely.

### Files to touch

- `app/templates/` directory: rename to `app/patterns/`
- `components/HeaderBar.tsx`: update the nav item label, route, and icon
- Internal references to the old route: search for `'/templates'`, `"/templates"`, and `` `/templates` `` across the codebase. Update all.
- Page header / title strings on the route itself: "BILL TEMPLATES" becomes "BILL PATTERNS"
- The nav icon. Current is `📋`. Recommended: `▦` for the terminal aesthetic. If it doesn't render cleanly in the existing font stack, fall back to plain text.
- Analytics labels, breadcrumb strings, anywhere else "templates" appears as user-facing copy

### Files NOT to touch

- Schema. The clustering logic and any `template_id` column stays as-is. This is a UI/route rename only.
- Bills table. No column renames.
- Internal variable names in clustering code can stay as `template*` if they want. The user-facing surface is what changes.

SKILL.md gets a one-liner update reflecting the new route path.

### Redirect

Skip the redirect. Live site is personal, no SEO concerns. Hard-cut. `/templates` 404s after the rename; that's fine.

### Verification

1. Navigate to `/patterns`. Page renders, content identical to old `/templates`.
2. Click the nav item. Routes to `/patterns`.
3. Page title shows "BILL PATTERNS".
4. `/templates` 404s.
5. `git grep -i 'templates'` returns only legitimate clustering-system references, not the renamed route or its nav item.

## Out of scope

- Full home-page redesign per the Claude Design mockup. This handoff is breaking-news block only. The LEAD prose, activity ticker, top-stalls block, redesigned topic distribution, etc. are a separate scoping conversation.
- Changes to the news matcher, confidence logic, or ingestion pipeline. Phase 1 diagnoses, Phase 2 surfaces. Data layer stays untouched.
- Schema or column renames on the templates/patterns clustering.
- Adding a new icon font or symbol library.

## Acceptance

1. Phase 1 diagnostic posted in chat. A/B/C/D diagnosis stated. Home-block strategy proposed.
2. Phase 2 (after sign-off): `BreakingNewsBlock` renders on home page, links to `/news`, populated or empty per actual data.
3. Phase 3: `/patterns` is the new route, `/templates` no longer routes, nav reflects rename, no broken internal links.
4. Commit messages:
   - Phase 2: `feat: breaking news block on home (HO 114)`
   - Phase 3: `refactor: rename /templates to /patterns (HO 114)`
5. Working tree clean, push after each phase or all at once at the end. Your call.

## Notes

- Phase 3 is genuinely independent. Ship it first if any blocker hits Phase 1's data side.
- The `▦` glyph may not render in all fonts. If it looks off, drop to plain text or use a small inline SVG.
- A `docs/handoffs/87-news-pipeline-audit.md` file was produced earlier this session against a stale memory state. The numbering was wrong (87 was already taken) and the diagnostic scope is superseded by Phase 1 here. Delete the file if it landed in the repo.
