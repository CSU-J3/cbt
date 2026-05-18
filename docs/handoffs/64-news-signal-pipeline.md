# 64 — News signal pipeline (RSS + bill ID matching)

## What this is

First handoff in the news signal arc (theme 4 from the roadmap). Builds the data pipeline only — pulls RSS feeds from Politico, The Hill, and Roll Call, extracts bill ID references via regex, writes matches to a new `news_mentions` table. No UI. UI surfaces (breaking-news view, media-attention column on bill rows) come in handoffs 66 and 67. Formal match-accuracy validation against a labeled sample is handoff 65.

The framing payoff: bills currently exist in isolation on the dashboard. After this arc, you'll know which bills are getting press coverage right now — the closest the dashboard gets to a Bloomberg-style headline feed and the data that unblocks reports' "most talked about" stub.

This handoff is data-only. After it ships, you can `SELECT COUNT(*) FROM news_mentions GROUP BY bill_id ORDER BY 1 DESC LIMIT 10` to see the most-mentioned bills, but no page consumes the data yet.

No new LLM calls in v1. Three RSS fetches per cron tick, ~10 KB each, fast.

## In scope

- Migration: `news_mentions` table
- `lib/news-sources.ts` — RSS feed config (URLs, source slug, display name)
- `lib/bill-id-extract.ts` — regex-based bill ID extraction from article titles + summaries
- `lib/rss-parse.ts` — minimal RSS/Atom parser (or use a small library, see notes)
- `lib/news-ingest.ts` — pulls each feed, parses, runs the matcher, upserts into `news_mentions`
- `scripts/sync-news.ts` — standalone CLI for local testing, `npm run sync:news`
- `app/api/sync/route.ts` — append news ingestion after summarize, before revalidate calls
- SKILL.md updates

## Out of scope

- UI surfaces. No bill-row column, no `/news` page, no breaking-news banner. Deferred to handoffs 66 and 67.
- Fuzzy title matching. Regex-only in v1; if validation in handoff 65 shows poor coverage, add fuzzy in 65 or 66.
- LLM disambiguation. Defer until regex+fuzzy proves insufficient.
- More than three RSS sources. Punchbowl skipped (paid content + limited free RSS). NYT/WaPo congressional feeds skipped (broader politics, not congressional-focused — lower signal). GDELT and NewsAPI explicitly out (noisy or paywalled).
- Twitter/X, Bluesky, or other social signal. Different domain, different rate-limit problems.
- Historical backfill of articles older than the RSS window (~30 days typically). Starts from cron's first run.
- Reading article body content. Headline + RSS summary is enough for v1 matching.

## Schema

Add to `scripts/migrate.ts`:

```sql
CREATE TABLE IF NOT EXISTS news_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id TEXT NOT NULL REFERENCES bills(id),
  source TEXT NOT NULL,                  -- 'politico' | 'the_hill' | 'roll_call'
  article_url TEXT NOT NULL,
  article_title TEXT NOT NULL,
  article_summary TEXT,                  -- RSS <description> if present
  published_at TEXT NOT NULL,            -- ISO datetime from RSS
  matched_via TEXT NOT NULL,             -- 'bill_id_regex' (only option in v1)
  match_confidence REAL,                 -- null for regex (deterministic); 0-1 reserved for fuzzy later
  ingested_at TEXT NOT NULL,
  UNIQUE(bill_id, article_url)
);

CREATE INDEX IF NOT EXISTS idx_news_mentions_bill ON news_mentions(bill_id);
CREATE INDEX IF NOT EXISTS idx_news_mentions_published ON news_mentions(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_mentions_source ON news_mentions(source);
```

Notes:

- `UNIQUE(bill_id, article_url)` prevents the same article matching the same bill twice on re-runs (idempotent ingestion).
- A single article can match multiple bills (one article cites HR 1234 and HR 5678) — that's fine, one row per (bill, article) pair.
- No FK on `source` since the source slug is governed by `lib/news-sources.ts`, not a separate table. If sources grow, consider promoting to a table; for three rows that's overkill.

## RSS source config (`lib/news-sources.ts`)

```ts
export interface NewsSource {
  slug: string;                // stored in news_mentions.source
  display: string;             // human-readable name
  feedUrl: string;             // RSS/Atom URL
}

export const NEWS_SOURCES: NewsSource[] = [
  {
    slug: 'politico',
    display: 'Politico',
    feedUrl: 'https://rss.politico.com/congress.xml',
  },
  {
    slug: 'the_hill',
    display: 'The Hill',
    feedUrl: 'https://thehill.com/homenews/feed/',
  },
  {
    slug: 'roll_call',
    display: 'Roll Call',
    feedUrl: 'https://rollcall.com/feed/',
  },
];
```

**Important: verify the feed URLs before building the parser.** Sites change RSS endpoints. The first thing Code should do is `curl -I` each URL and check for HTTP 200 + a content type that looks like XML. If any returns 404 or HTML, find the current URL (each publisher has an RSS directory or footer link). Substitute the working URL and note the change in a code comment so future me knows what was swapped.

Backup options if a primary URL is dead:

- Politico fallback: `https://www.politico.com/rss/politicopicks.xml`
- The Hill fallback: `https://thehill.com/policy/congress/feed/`
- Roll Call fallback: their site's RSS directory at `/feeds/` or similar

## RSS parser (`lib/rss-parse.ts`)

Two options:

1. Use `fast-xml-parser` (small, no deps, well-maintained). Install: `npm i fast-xml-parser`. Roughly 30 lines of code to map RSS 2.0 + Atom to a common `{ title, url, summary, publishedAt }` shape.
2. Hand-roll with `DOMParser` from `linkedom` (already pulled in transitively by some Next.js features but not guaranteed; check first).

Recommendation: `fast-xml-parser`. It handles both RSS 2.0 and Atom out of the box, deals with namespaces, and is ~50 KB. Three publisher feeds means we'll hit at least two different shapes, so we want a real parser, not regex on XML.

Interface:

```ts
export interface RssItem {
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string;  // ISO datetime
}

export async function fetchAndParseRss(url: string): Promise<RssItem[]>;
```

Handle both `<item>` (RSS 2.0) and `<entry>` (Atom). Map fields:

- RSS 2.0: `<title>`, `<link>`, `<description>`, `<pubDate>`
- Atom: `<title>`, `<link href="...">`, `<summary>` or `<content>`, `<published>` or `<updated>`

Normalize dates to ISO 8601. RSS 2.0 dates are usually RFC 822 (`Tue, 16 May 2026 09:00:00 +0000`); `new Date(str).toISOString()` handles the conversion.

Strip HTML from `<description>` / `<summary>` for cleaner matching — regex `/<[^>]+>/g` replace with empty string is fine for v1, no need for a full HTML parser.

## Bill ID extraction (`lib/bill-id-extract.ts`)

The regex needs to catch all eight bill types with all common formatting variants. Core pattern:

```ts
import { getCurrentCongress } from './congress';

// Matches: HR 1234, H.R. 1234, H. R. 1234, H.Res. 1, H Res 1, HRes 1,
// H.J.Res. 1, HJRes 1, H J Res 1, H.Con.Res. 1, etc.
// Senate equivalents: S 1, S. 1, S.Res. 1, SRes 1, S.J.Res. 1, etc.
const BILL_ID_REGEX = /\b(H\s*\.?\s*R\s*\.?|H\s*\.?\s*Res\s*\.?|H\s*\.?\s*J\s*\.?\s*Res\s*\.?|H\s*\.?\s*Con\s*\.?\s*Res\s*\.?|S\s*\.?\s*Res\s*\.?|S\s*\.?\s*J\s*\.?\s*Res\s*\.?|S\s*\.?\s*Con\s*\.?\s*Res\s*\.?|S\s*\.?)\s*(\d{1,5})\b/gi;

function normalizeType(raw: string): string | null {
  const t = raw.toLowerCase().replace(/[\s.]/g, '');
  if (t === 'hr') return 'hr';
  if (t === 'hres') return 'hres';
  if (t === 'hjres') return 'hjres';
  if (t === 'hconres') return 'hconres';
  if (t === 's') return 's';
  if (t === 'sres') return 'sres';
  if (t === 'sjres') return 'sjres';
  if (t === 'sconres') return 'sconres';
  return null;
}

export function extractBillIds(text: string): string[] {
  const ids = new Set<string>();
  const congress = getCurrentCongress();
  for (const m of text.matchAll(BILL_ID_REGEX)) {
    const billType = normalizeType(m[1]);
    if (!billType) continue;
    const number = m[2];
    ids.add(`${congress}-${billType}-${number}`);
  }
  return Array.from(ids);
}
```

The regex is intentionally permissive on whitespace and dots. False positives are possible (e.g., "Section 1234 of HR" with HR appearing later) but acceptable for v1 — handoff 65 measures precision and we tighten if needed.

Edge cases acknowledged but not handled in v1:

- News articles citing previous-Congress bills. Assumed current-Congress; rare in active coverage. Handoff 65 may surface this if precision is bad.
- Lowercase `hr 1234` is matched (regex is `i` flag). Good — informal writing happens.
- "HR 1" might match noise like address numbers in a different context. Length floor of 1+ digits is loose; we could require `\d{2,}` but that misses real low-numbered bills (HR 1 is always the speaker's flagship bill of the Congress). Keep `\d{1,5}` and accept the noise.

Existence check: after extraction, before insert, query `SELECT 1 FROM bills WHERE id = ?` for each extracted id. Skip rows that don't match a known bill (article cites a bill we don't have synced yet, or false positive). Log the skip count but don't error.

## Ingestion (`lib/news-ingest.ts`)

```ts
import { getDb } from './db';
import { NEWS_SOURCES } from './news-sources';
import { fetchAndParseRss } from './rss-parse';
import { extractBillIds } from './bill-id-extract';

export interface IngestResult {
  source: string;
  itemsFetched: number;
  mentionsInserted: number;
  mentionsSkippedUnknownBill: number;
  errors: string[];
}

export async function ingestNews(): Promise<IngestResult[]> {
  const db = getDb();
  const results: IngestResult[] = [];

  for (const source of NEWS_SOURCES) {
    const result: IngestResult = {
      source: source.slug,
      itemsFetched: 0,
      mentionsInserted: 0,
      mentionsSkippedUnknownBill: 0,
      errors: [],
    };

    try {
      const items = await fetchAndParseRss(source.feedUrl);
      result.itemsFetched = items.length;

      for (const item of items) {
        const text = `${item.title}\n${item.summary ?? ''}`;
        const billIds = extractBillIds(text);
        if (billIds.length === 0) continue;

        for (const billId of billIds) {
          // Existence check
          const exists = await db.execute({
            sql: 'SELECT 1 FROM bills WHERE id = ?',
            args: [billId],
          });
          if (exists.rows.length === 0) {
            result.mentionsSkippedUnknownBill++;
            continue;
          }

          await db.execute({
            sql: `
              INSERT INTO news_mentions
                (bill_id, source, article_url, article_title, article_summary,
                 published_at, matched_via, match_confidence, ingested_at)
              VALUES (?, ?, ?, ?, ?, ?, 'bill_id_regex', NULL, ?)
              ON CONFLICT(bill_id, article_url) DO NOTHING
            `,
            args: [
              billId,
              source.slug,
              item.url,
              item.title,
              item.summary,
              item.publishedAt,
              new Date().toISOString(),
            ],
          });
          result.mentionsInserted++;
        }
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }

    results.push(result);
  }

  return results;
}
```

`mentionsInserted` overstates slightly when ON CONFLICT triggers — SQLite's `changes()` would be precise, but for v1 the rough count is fine. Tighten in 65 if validation needs it.

## CLI runner (`scripts/sync-news.ts`)

```ts
import 'dotenv/config';
import { ingestNews } from '../lib/news-ingest';

async function main() {
  const results = await ingestNews();
  for (const r of results) {
    console.log(`${r.source}: fetched=${r.itemsFetched} mentions=${r.mentionsInserted} skipped_unknown_bill=${r.mentionsSkippedUnknownBill}`);
    if (r.errors.length > 0) {
      for (const e of r.errors) console.error(`  ERR: ${e}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

Add to `package.json`:

```json
"sync:news": "tsx scripts/sync-news.ts"
```

## Cron integration (`app/api/sync/route.ts`)

After the existing sync + summarize block, before the revalidate calls:

```ts
import { ingestNews } from '@/lib/news-ingest';

// ...existing sync + summarize...

const newsResults = await ingestNews();
const totalNewsMentions = newsResults.reduce((s, r) => s + r.mentionsInserted, 0);
const newsErrors = newsResults.flatMap(r => r.errors);
console.log(`News ingestion: ${totalNewsMentions} mentions inserted across ${newsResults.length} sources`);
if (newsErrors.length > 0) {
  console.warn(`News errors: ${newsErrors.length}`);
  for (const e of newsErrors) console.warn(`  ${e}`);
}

// Existing revalidateTag calls — leave as is for now; news UI lands in 66/67
```

News ingestion errors don't fail the cron — sync + summarize already ran successfully, news is best-effort. Errors get logged and the route returns 200.

Timing: RSS fetches are ~200ms each, three sources in parallel would be ~500ms total, matching is in-memory and fast. Existing 50-bill summarize slice is ~30-40s. Combined well under the 60s ceiling.

If a feed times out (rare but possible), wrap each `fetchAndParseRss` in a `Promise.race` with a 10-second timeout so one slow feed doesn't kill the budget.

## SKILL.md updates

**Database schema**: add the `news_mentions` table block.

**Sync logic**: update step 5 mention to note that the cron route now also runs news ingestion after summarize. Add a new subsection:

> **News ingestion (in cron).** After sync + summarize, the cron route pulls RSS feeds from Politico, The Hill, and Roll Call. Bill IDs are extracted via regex from article titles and summaries, looked up against the `bills` table, and matches written to `news_mentions`. Idempotent on `(bill_id, article_url)`. Best-effort — errors are logged but don't fail the cron. Local test: `npm run sync:news`.

**New section: "News signal sources"** (sibling to "Caucus affiliations" and "Race surface"):

> v1 covers three RSS feeds: Politico, The Hill, Roll Call. URLs in `lib/news-sources.ts`. Verify endpoints if articles stop appearing — publishers change RSS paths. Matching is regex-only on bill IDs (HR 1234, S.Res. 5, etc.); fuzzy title matching, LLM disambiguation, and accuracy validation come in subsequent handoffs (65). UI surfaces (breaking-news view, media-attention column) in 66 and 67.

**Things to watch for**: add —

> RSS feed URLs drift. If `news_mentions` stops growing, first check whether each feed in `NEWS_SOURCES` still returns valid XML. Publishers sometimes move feeds to `/policy/congress/feed/` or similar without redirects. The ingestion logs the per-source counts at cron time so a flatlined source is visible in Vercel logs.

**Backfill scripts**: add `npm run sync:news` to the list.

## Verification

1. `npm install fast-xml-parser` (or the chosen parser).
2. Verify the three feed URLs manually via `curl -I <url>` — confirm HTTP 200, XML content type. Patch `NEWS_SOURCES` if any have moved.
3. `npm run migrate` — `news_mentions` table exists with all indexes.
4. `npm run sync:news` — should output per-source counts. Expect roughly 30-100 fetched items per source, single-digit to low-double-digit mentions inserted on first run (most articles don't cite bill IDs). If `mentions=0` across all three sources, the regex isn't matching anything or the feeds are returning unrelated content; spot-check by running the regex against a known bill-citing article URL.
5. `SELECT bill_id, COUNT(*) FROM news_mentions GROUP BY bill_id ORDER BY 2 DESC LIMIT 10` — should return a small set of bills with multiple mentions. The top-mentioned bill is your sanity check: it should be something currently in the news cycle.
6. Re-run `npm run sync:news` immediately — `mentions_inserted` should drop near zero (UNIQUE constraint catches re-runs).
7. Deploy. Watch the first cron tick at 09:00 UTC tomorrow — Vercel logs should show news ingestion counts after the summarize step.
8. `npm run typecheck` — clean.
9. `npm run build` — clean.

## Acceptance

`news_mentions` table populating daily via cron. Bills cited in Politico / The Hill / Roll Call get rows tied to the article URL + published date. Foundation for the validation pass (65) and UI surfaces (66, 67).

After this: handoff 65 (matching accuracy validation — hand-label 100 articles, measure precision/recall, decide on fuzzy + LLM layers), then 66 (breaking-news view), then 67 (media-attention column on bill rows). Or skip to a different theme if your priorities shift. User picks.
