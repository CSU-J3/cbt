# 75 — News sync wiring

## What this is

Handoff 64 shipped the news RSS pipeline. The `news_mentions` table exists with the right schema. But the table has zero rows because the sync is never triggered — `vercel.json` only crons `/api/sync` (the bills route), and there's no news entry in the codebase's cron config.

This handoff: find what news sync code exists, run it manually once to validate, then wire it to cron so it runs daily.

Until this ships, the "Most Talked About" report cut is blocked. Theme 4 is half-shipped, not 100%.

## Discovery (do this first, don't skip)

Inventory what handoff 64 left behind:

```powershell
# What news-related code exists in the repo?
git grep -l "news_mentions" -- "*.ts"
git grep -l "RSS" -- "*.ts"
git grep -l "rss" -- "*.ts"

# Is there a news sync route?
ls app/api/ | grep -i news
ls app/api/ | grep -i sync

# Is there a news sync script?
ls scripts/ | grep -i news

# Any npm scripts?
findstr /i news package.json
findstr /i rss package.json
```

Report what you find before changing anything. Three likely outcomes, each with a different fix path:

- **A. Unwired route exists** (`app/api/sync-news/route.ts` or similar). Easy: add a second cron entry in `vercel.json`. Vercel Hobby allows 2 crons (one-per-day frequency each).

- **B. Library code exists but no route** (`lib/news-sync.ts` with no API wrapper). Wrap it: create `app/api/sync-news/route.ts` that calls the lib functions, gate it with the same `Bearer ${CRON_SECRET}` auth pattern as `/api/sync`, then add the cron entry.

- **C. Standalone script only** (`scripts/sync-news.ts` callable via `npm run sync:news`). Promote to a Next.js API route following the existing `/api/sync` shape, then cron it.

Pick the fix path based on what's actually in the repo. Don't write new RSS-parsing or matching logic — that work was the point of handoff 64. We're wiring, not building.

## Manual trigger first

Before touching cron config, get one successful run. If a script exists, run it locally:

```powershell
npm run sync:news
```

If only a route exists, hit it with the local dev server running:

```powershell
$secret = $env:CRON_SECRET
curl -H "Authorization: Bearer $secret" http://localhost:3000/api/sync-news
```

Then verify in Turso:

```sql
SELECT
  COUNT(*) AS total,
  COUNT(DISTINCT bill_id) AS unique_bills,
  MIN(published_at) AS earliest,
  MAX(published_at) AS latest
FROM news_mentions;

-- Spot-check the matches
SELECT bill_id, source, article_title, matched_via, match_confidence, published_at
FROM news_mentions
ORDER BY published_at DESC
LIMIT 10;
```

Expected after one run: dozens to a few hundred mentions, depending on how many RSS feeds are configured and how far back they return. Match confidence distribution should stratify by `matched_via` method.

**If the manual run produces zero rows or errors out, stop and report.** The pipeline itself is broken (not just the wiring) and the fix is a separate handoff. Don't try to debug RSS-parsing or matching logic in this one.

**If matches look implausible** (titles don't map to bill IDs, confidences are all 0.1, the same bill_id appears against unrelated articles), also stop and report. Matcher quality is the wiring's downstream dependency; shipping cron on a bad matcher just fills the table with garbage faster.

## Wire to cron (assuming manual run succeeded)

Update `vercel.json` to add a second cron entry for news:

```json
{
  "functions": {
    "app/api/sync/route.ts": {
      "maxDuration": 60
    },
    "app/api/sync-news/route.ts": {
      "maxDuration": 60
    }
  },
  "crons": [
    {
      "path": "/api/sync",
      "schedule": "0 9 * * *"
    },
    {
      "path": "/api/sync-news",
      "schedule": "30 9 * * *"
    }
  ]
}
```

Stagger by 30 minutes so the two crons don't compete for the same cold-start function pool. News at 09:30 UTC, bills at 09:00 UTC. Match the route name to whatever's actually in the repo (`/api/sync-news` is a guess).

Both routes should have the same auth check:

```typescript
const auth = request.headers.get('Authorization');
if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
  return new Response('Unauthorized', { status: 401 });
}
```

## Revalidate the cache

After news sync writes new rows, any cached view that depends on `news_mentions` should be invalidated. There aren't any yet — the data hasn't been surfaced anywhere — but to set the pattern for when "Most Talked About" wires in next:

In the news sync route, after the upserts complete, call:

```typescript
import { revalidateTag } from 'next/cache';
revalidateTag('news-mentions');
```

Just lay the rail. No tag consumers yet.

## Verification

1. Discovery commands ran and the path forward (A, B, or C) is clear in the chat.
2. Manual trigger produced rows: `SELECT COUNT(*) FROM news_mentions` returns a meaningful number (≥50 is a reasonable floor depending on RSS source count).
3. Spot-check of 10 most recent matches: bill_id assignments are plausible for the article titles. `matched_via` stratification looks reasonable (a mix of methods, not all one path).
4. `vercel.json` has two cron entries and two function declarations.
5. Push to main, wait for the next 09:30 UTC tick, then re-check the table the following day to confirm cron-triggered sync also produces rows.

## Out of scope

- "Most Talked About" report wiring — separate handoff, depends on this one
- Improving the matcher (more sources, fuzzy match tuning, NER) — separate work
- Backfilling historical mentions — RSS feeds don't return deep history, so backfill isn't practically possible. Accept that data starts accumulating from now forward.
- A `/news` route or media-attention column on the feed — those surface the data, this handoff just produces it
- Schema changes to `news_mentions` — column shape is already right

## Don't

- Don't add RSS-parsing or matching logic. If handoff 64 didn't fully build it, that's a separate handoff (and you should report what's missing instead of patching it in here).
- Don't lower the matcher's confidence threshold to inflate row counts. A small high-quality table beats a large noisy one.
- Don't change `/api/sync`'s schedule. It's currently sized to the cold-start + summarize-50 budget; don't disturb that.
- Don't merge news sync into `/api/sync` unless the combined work fits well inside 60 seconds. The 50-bill-per-tick slicing exists because the existing sync already runs near the ceiling.
