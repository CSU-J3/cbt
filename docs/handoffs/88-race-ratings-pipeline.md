# Handoff 88 — Automated race ratings pipeline

## What this is

Replaces the manual Wikipedia JSON seed for race ratings with an automated scraper that pulls directly from Sabato's Crystal Ball. Runs weekly via cron. Covers both House and Senate 2026 ratings.

## Step 1 — Probe the pages

Before writing any scrape logic, fetch both pages and check whether ratings are in the static HTML:

```ts
// Run this as a quick probe script, not a permanent file
const urls = [
  'https://centerforpolitics.org/crystalball/2026-house/',
  'https://centerforpolitics.org/crystalball/2026-senate/',
  'https://centerforpolitics.org/crystalball/2026-rating-changes/',
]
for (const url of urls) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research bot)' }
  })
  const html = await res.text()
  // Look for rating keywords
  const hasRatings = ['Toss-up', 'Leans', 'Likely', 'Safe'].some(kw => html.includes(kw))
  console.log(url, res.status, hasRatings ? 'RATINGS IN HTML' : 'NO RATINGS (JS-rendered?)')
  // Print first 2000 chars to inspect structure
  console.log(html.slice(0, 2000))
}
```

**If ratings ARE in the HTML**: proceed with Step 2 (HTML scraper).
**If ratings are NOT in the HTML** (JS-rendered): skip to Step 6 (Ballotpedia fallback).

Report the probe output before proceeding.

## Step 2 — Parse Sabato HTML (if static)

Sabato's rating pages likely have a table or list structure. Common patterns on Crystal Ball:

```html
<div class="district">
  <span class="state-district">CA-22</span>
  <span class="rating leans-r">Leans Republican</span>
  <span class="incumbent">David Valadao (R)</span>
</div>
```

Or a table with columns for district, incumbent, rating. Inspect the actual HTML structure and write a parser accordingly.

Create `lib/sabato-scrape.ts`:

```ts
import * as cheerio from 'cheerio'

export type SabatoRating = {
  raceId: string        // e.g. "CA-22-2026"
  state: string
  district: string      // zero-padded e.g. "22", "AL" for at-large
  chamber: 'house' | 'senate'
  rating: string        // normalized (see Step 3)
  rawRating: string     // exactly as scraped
  incumbent: string | null
}

const URLS = {
  house: 'https://centerforpolitics.org/crystalball/2026-house/',
  senate: 'https://centerforpolitics.org/crystalball/2026-senate/',
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CBT research bot)',
      'Accept': 'text/html',
    },
  })
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`)
  return res.text()
}

export async function scrapeSabatoRatings(): Promise<SabatoRating[]> {
  const results: SabatoRating[] = []

  for (const [chamber, url] of Object.entries(URLS) as ['house' | 'senate', string][]) {
    const html = await fetchPage(url)
    const $ = cheerio.load(html)

    // IMPORTANT: inspect actual HTML structure in Step 1 before finalizing this selector
    // The following is a template — update selectors to match real markup
    $('[data-district], .district-row, tr[data-state]').each((_, el) => {
      const districtText = $(el).find('.district, .state-district, td:nth-child(1)').text().trim()
      const ratingText = $(el).find('.rating, .crystal-ball-rating, td:nth-child(2)').text().trim()
      const incumbentText = $(el).find('.incumbent, td:nth-child(3)').text().trim() || null

      if (!districtText || !ratingText) return

      // Parse state and district from e.g. "CA-22" or "CA Senate"
      const match = districtText.match(/^([A-Z]{2})-?(\d{1,2}|AL|Senate)?/)
      if (!match) return

      const state = match[1]
      const district = match[2] ?? 'AL'
      const raceId = `${state}-${district.padStart(2, '0')}-2026`

      results.push({
        raceId,
        state,
        district,
        chamber,
        rating: normalizeSabatoRating(ratingText),
        rawRating: ratingText,
        incumbent: incumbentText || null,
      })
    })
  }

  return results
}
```

**Note**: the selectors above are placeholders. Update them to match the actual HTML structure observed in Step 1.

Install cheerio if not already present:
```
npm list cheerio
npm install cheerio  # if missing
```

## Step 3 — Rating normalization

Sabato uses different vocabulary than Cook/Inside Elections. Normalize to a consistent set on ingest:

```ts
const SABATO_RATING_MAP: Record<string, string> = {
  'Safe Republican': 'Safe R',
  'Likely Republican': 'Likely R',
  'Leans Republican': 'Lean R',
  'Toss-up': 'Toss Up',
  'Leans Democratic': 'Lean D',
  'Likely Democratic': 'Likely D',
  'Safe Democratic': 'Safe D',
  // Handle abbreviations if they appear
  'Safe R': 'Safe R',
  'Likely R': 'Likely R',
  'Lean R': 'Lean R',
  'Lean D': 'Lean D',
  'Likely D': 'Likely D',
  'Safe D': 'Safe D',
}

function normalizeSabatoRating(raw: string): string {
  return SABATO_RATING_MAP[raw.trim()] ?? raw.trim()
}
```

Check existing `race_ratings` rows to confirm what vocabulary Cook and Inside Elections use — use the same normalization target so all three sources are comparable in the DB.

## Step 4 — Sync script

Create `scripts/sync-race-ratings.ts`:

```ts
import { getDb } from '../lib/db'
import { scrapeSabatoRatings } from '../lib/sabato-scrape'

async function main() {
  const db = getDb()
  const ratings = await scrapeSabatoRatings()
  console.log(`Scraped ${ratings.length} Sabato ratings`)

  let upserted = 0
  let skipped = 0
  let changed = 0
  const now = new Date().toISOString()

  for (const r of ratings) {
    // Check if this race exists in our races table
    const raceRow = await db.execute({
      sql: `SELECT id FROM races WHERE id = ?`,
      args: [r.raceId],
    })
    if (!raceRow.rows[0]) {
      // Race not in our DB — skip (don't auto-create races without incumbent data)
      skipped++
      continue
    }

    // Check existing rating for this source
    const existing = await db.execute({
      sql: `SELECT rating FROM race_ratings WHERE race_id = ? AND source = 'sabato'`,
      args: [r.raceId],
    })

    const existingRating = existing.rows[0]?.rating as string | undefined
    if (existingRating === r.rating) {
      skipped++
      continue
    }

    if (existingRating && existingRating !== r.rating) {
      console.log(`  CHANGED: ${r.raceId} ${existingRating} → ${r.rating}`)
      changed++
    }

    // Upsert — match the existing race_ratings schema exactly
    // Check PRAGMA table_info(race_ratings) before running to confirm column names
    await db.execute({
      sql: `INSERT INTO race_ratings (id, race_id, source, rating, cycle, updated_at)
            VALUES (?, ?, 'sabato', ?, 2026, ?)
            ON CONFLICT(id) DO UPDATE SET
              rating = excluded.rating,
              updated_at = excluded.updated_at`,
      args: [`${r.raceId}-sabato`, r.raceId, r.rating, now],
    })
    upserted++
  }

  console.log(`Done — upserted: ${upserted}, changed: ${changed}, skipped (no race row): ${skipped}`)
}

main().catch(console.error)
```

**Before running**: confirm `race_ratings` schema with `PRAGMA table_info(race_ratings)` — the INSERT columns must match exactly. The `id` field pattern (`${raceId}-sabato`) must match whatever convention HO 84 used for existing Sabato rows.

## Step 5 — Wire into cron

Add npm script:
```json
"sync:race-ratings": "tsx scripts/sync-race-ratings.ts"
```

Add to `vercel.json` crons (staggered from the existing two):
```json
{
  "path": "/api/sync-race-ratings",
  "schedule": "0 11 * * 3"
}
```

Wednesday 11:00 UTC — Sabato typically updates mid-week. Create `app/api/sync-race-ratings/route.ts` with the standard Bearer CRON_SECRET auth pattern.

## Step 6 — Ballotpedia fallback (if Sabato is JS-rendered)

If Step 1 shows Sabato ratings are not in the static HTML, use Ballotpedia instead:

```
https://ballotpedia.org/United_States_House_elections,_2026
https://ballotpedia.org/United_States_Senate_elections,_2026
```

Ballotpedia is MediaWiki-based — the wikitext API is more reliable than scraping HTML:

```
https://ballotpedia.org/api/public/article/United_States_House_elections,_2026?apikey=...
```

Or use the standard Wikipedia-compatible API:
```
https://ballotpedia.org/w/api.php?action=parse&page=United_States_House_elections,_2026&prop=wikitext&format=json
```

The wikitext will have a ratings table that's easier to parse than rendered HTML. Probe this in Step 1 if needed.

## Verification

After sync runs:

```sql
SELECT source, COUNT(*) FROM race_ratings GROUP BY source;
-- sabato should now have rows alongside cook and inside_elections

SELECT rr.race_id, rr.rating, rr.updated_at
FROM race_ratings rr
WHERE rr.source = 'sabato'
  AND rr.updated_at > date('now', '-1 day')
ORDER BY rr.updated_at DESC
LIMIT 10;
```

Load `/races` and confirm Sabato column is populated. Cross-check 5 races against the live Sabato page to verify ratings match.

## Acceptance criteria

1. `scripts/sync-race-ratings.ts` runs without crashing
2. Sabato ratings in `race_ratings` for ≥25 competitive races
3. Changed ratings logged to console (the "CHANGED:" lines are the audit trail)
4. Cron entry in `vercel.json` — Wednesday weekly
5. `/races` page shows updated Sabato column
6. No races rows created without explicit incumbent data — only update existing races

## Known limitations

- Sabato only: Cook and Inside Elections remain in the manual JSON files for now. Wire them in a follow-up once the scrape pattern is proven.
- No historical rating change tracking beyond the console log. A `race_rating_history` table is the right long-term solution; defer until needed.
- Redistricting edge cases (FL, VA, TN noted in search results as contested) — the scraper will capture whatever Sabato currently shows; manual review needed when maps change mid-cycle.
