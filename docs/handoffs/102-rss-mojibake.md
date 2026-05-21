# 102 — Fix RSS title mojibake

## What this is

Curly apostrophes and other smart-punctuation characters in news feed titles render as `â€™`, `â€œ`, `â€`, etc. Classic mojibake: UTF-8 bytes being decoded as Windows-1252 / Latin-1 somewhere in the RSS ingestion pipeline. Cosmetic bug, but visible on the news feed and on whatever surfaces consume news titles.

One-handoff close-out. Likely a one-line fix at whichever stage of the pipeline is losing the encoding.

## Pre-flight (mandatory — diagnose before patching)

Don't guess the layer. Verify where the encoding gets corrupted:

1. **DB check.** Run a query against whatever table stores news article titles:
   ```sql
   SELECT id, title FROM news_articles WHERE title LIKE '%â€%' LIMIT 5
   ```
   Or substitute the actual table name. Are the corrupt bytes already stored in the DB, or only appearing at render time? This tells you whether the bug is in ingestion or rendering.

2. **Source check.** Pick one of the corrupt-title rows, find the source RSS feed URL, and fetch the raw XML:
   ```powershell
   curl.exe -s "$rssUrl" | findstr "the-article-headline-fragment"
   ```
   Does the feed itself encode the apostrophe as UTF-8 (`â€™` is the wrong rendering of UTF-8 `'`, hex `e2 80 99`) or as an XML entity (`&#8217;` or `&rsquo;`)? Either is valid; the bug is in how we're handling it.

3. **Pipeline trace.** Look at the RSS ingestion code path. Likely candidates:
   - The fetch step doesn't honor the feed's `Content-Type: text/xml; charset=utf-8` header
   - The XML parser is forcing Latin-1
   - The HTTP client is buffering bytes and then string-converting with the wrong default

Document the diagnosis in the commit message. If the corrupt bytes are in the DB, the fix is at ingestion + a one-time backfill of existing rows. If they're only at render time, the fix is in the renderer.

## In scope

Based on the diagnosis, one of:

### Case A: ingestion bug (corrupt bytes in DB)

- Patch the ingestion code so future fetches decode UTF-8 correctly. Likely fixes:
  - Set explicit encoding on the HTTP fetch
  - Replace any `Buffer.toString('latin1')` with `Buffer.toString('utf-8')` or use `TextDecoder('utf-8')`
  - If using a parser, pass the encoding explicitly
- One-time backfill script (or inline in the same script) to repair existing rows:
  ```ts
  // Decode the doubly-encoded title: re-read the corrupt string's bytes as Latin-1,
  // then decode those bytes as UTF-8
  function fixMojibake(s: string): string {
    return Buffer.from(s, 'latin1').toString('utf-8');
  }
  ```
  Sanity-check the function against 5 known-corrupt titles before running it on the whole table. Wrap in a transaction.

### Case B: render bug (DB clean, mojibake at display)

Fix the render layer. Likely in a React component that's outputting the title — check for any explicit encoding conversion or `charset` mismatch in the response. Less common in modern Next.js but possible if there's a custom RSS-feed-mirror route.

## Out of scope

- Other encoding bugs (em-dash, ellipsis, etc.) — fix the apostrophe pipeline correctly and the rest fall out, since they're the same UTF-8-as-Latin-1 issue
- Cleaning up smart quotes to ASCII straight quotes — the goal is correctness, not transliteration. `'` should stay `'`, not become `'`.
- Anything outside the news ingestion path

## Validation

1. Pre-flight diagnosis documented in commit message
2. Fetch a recent article known to have a curly apostrophe in its title, ingest it through the patched pipeline, confirm the DB row has the correct UTF-8 character (not `â€™`)
3. If backfill was needed: `SELECT COUNT(*) FROM news_articles WHERE title LIKE '%â€%'` returns 0 after running it
4. Spot-check 5 random news titles on the news feed UI; no `â€` sequences visible

## Acceptance

- Pre-flight diagnosis recorded
- Ingestion patched (or render patched, depending on Case A vs B)
- Existing rows repaired if applicable
- News feed titles render clean smart punctuation
- Single commit: `fix: RSS title mojibake from UTF-8/Latin-1 confusion (HO 102)`

## Notes

- **Common pattern.** `â€™` is a curly right single quotation mark (U+2019, UTF-8 bytes `e2 80 99`) being interpreted as three Latin-1 characters. The same byte triple displayed correctly is `'`. Other common doubled-encodings: `â€œ` = `"`, `â€` = `"`, `â€"` = `—`, `â€¦` = `…`.
- **Don't over-engineer the backfill.** If the corrupt-row count is small (under a few hundred), a single-pass update with the `fixMojibake` function is fine. If it's thousands, batch by `LIMIT` to keep the libSQL transaction sane.
- **What this closes.** The mojibake open thread that's been carried since the news ingestion work. Once shipped, the news feed reads cleanly without the visual jankiness.
