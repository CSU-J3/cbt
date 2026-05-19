# Handoff 87 — Votes cron + FEC residue + RSS mojibake

Three small cleanup items. Do them in order.

## Item 1 — FEC residue re-run

19 members hit `api_error` on the last sync:fec run due to rate-limit residue. They were not cached as `no_match` (tri-state fix), so a clean re-run will pick them up.

```
npm run sync:fec
```

Report the final summary line. Expect `resolved_new` ≈ 19, `no_match` ≈ 8 (same real no-matches as before), `api_errors` = 0.

## Item 2 — RSS mojibake fix

Curly apostrophes and similar UTF-8 characters are rendering as `â€™` in `article_title` and `article_summary` rows in `news_mentions`. This is a UTF-8/Latin-1 double-decode bug in the RSS fetch.

In `lib/news-ingest.ts` (or wherever the RSS XML is fetched and parsed), find the fetch call and add explicit UTF-8 handling:

```ts
const res = await fetch(url)
const buffer = await res.arrayBuffer()
const text = new TextDecoder('utf-8').decode(buffer)
// then parse `text` with the XML parser instead of res.text()
```

If the parser already uses `res.text()`, replace that with the above. The issue is that `res.text()` sometimes mis-detects encoding as Latin-1 when the RSS feed doesn't declare charset explicitly.

After the fix, run `npm run sync:news` and spot-check a few `article_title` values in `news_mentions` — apostrophes should render as `'` not `â€™`.

## Item 3 — Wire votes cron into vercel.json

First, check the 60-second ceiling. In `app/api/sync/route.ts`, find where the existing sync steps run and estimate how long the vote sync would add. The question is whether `runHouseVotesSync()` + `runSenateVotesSync()` can fit inside the remaining time budget after the bill sync and summarization steps.

Check `vercel.json` for the current cron config and the existing route's structure before touching anything.

### Option A — Fold into existing /api/sync route

If the existing route has headroom (bill sync + summarize typically takes 30-40s on a normal day), add vote sync at the end:

```ts
// After existing sync steps, before revalidation:
try {
  await runHouseVotesSync()
  await runSenateVotesSync()
} catch (e) {
  console.error('Vote sync failed:', e)
  // non-fatal — don't let vote sync failure break the bill sync response
}
```

Import `runHouseVotesSync` and `runSenateVotesSync` from their respective lib files.

### Option B — Separate cron entry

If the route is already close to the ceiling, add a second cron entry in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/sync",
      "schedule": "0 9 * * *"
    },
    {
      "path": "/api/sync-votes",
      "schedule": "0 10 * * *"
    }
  ]
}
```

Then create `app/api/sync-votes/route.ts` mirroring the auth pattern from `/api/sync` (Bearer CRON_SECRET check), calling only the vote syncs.

### Decision rule

Pick Option A if the existing route's average runtime (check Vercel function logs or estimate) leaves ≥15s of headroom. Pick Option B if it doesn't. Report which option was chosen and why.

## Verification

After all three items:

```sql
-- FEC: expect ~0 unresolved current members
SELECT COUNT(*) FROM members m
LEFT JOIN member_fundraising mf ON mf.bioguide_id = m.bioguide_id
WHERE mf.bioguide_id IS NULL;

-- RSS: spot-check titles
SELECT article_title FROM news_mentions ORDER BY fetched_at DESC LIMIT 5;

-- Votes cron: confirm vercel.json has the vote sync wired
```

Load Vercel dashboard and confirm the new cron entry appears (or the existing one is unchanged if folded in).

## Acceptance criteria

1. `sync:fec` final run shows 0 api_errors
2. `news_mentions.article_title` values contain clean apostrophes
3. Vote sync is wired to run on a daily cron (either folded or separate)
4. No regression on existing bill sync behavior
