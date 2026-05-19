# Handoff 86 — LLM bill matcher for news mentions

## What this is

The news sync pipeline fetches RSS articles but matches zero bills because RSS subheads don't contain bill IDs — they use topical names ("immigration enforcement bill," "Anti-Weaponization Fund"). This handoff adds an LLM disambiguation pass that identifies which bills (if any) a news article is about, using article title + subhead + a candidate bill set.

Cost: ~$30-40/year at current sync cadence (55 articles/day × 365 days, Gemini Flash pricing). Acceptable.

## Step 1 — Audit current news sync

Read `lib/news-sync.ts` (or wherever RSS fetching lives) and `lib/bill-id-extract.ts` in full before touching anything. Answer:

1. Where in the pipeline does `extractBillIds()` get called?
2. What does the sync do when `extractBillIds()` returns `[]`? Does it skip the article entirely or still write a row with no `bill_id`?
3. What columns does `news_mentions` have? Run `PRAGMA table_info(news_mentions);`
4. How many articles did the last sync fetch? What's stored in `news_mentions` right now?

Report findings before proceeding.

## Step 2 — Candidate bill set strategy

The LLM needs candidate bills to match against — we can't pass all 15,000 bills. Two filters narrow the set:

1. **Recency**: bills updated or actioned in the last 30 days. These are the bills in active play.
2. **Topic pre-filter** (optional, cheap): extract nouns from the article title and filter candidates to bills whose title contains any of them. "immigration enforcement" → filter to bills with `immigration` or `enforcement` in their title. This shrinks the candidate set from ~500 recent bills to ~20-50 per article without LLM cost.

Build a helper `getCandidateBills(daysBack = 30)` in `lib/queries.ts`:

```ts
export async function getCandidateBills(daysBack = 30): Promise<{
  id: string
  title: string
  summary: string | null
  topics: string | null
}[]> {
  const db = getDb()
  const result = await db.execute({
    sql: `SELECT id, title, summary, topics
          FROM bills
          WHERE latest_action_date >= date('now', ?)
            AND summary IS NOT NULL
            AND is_ceremonial = 0
          ORDER BY latest_action_date DESC
          LIMIT 300`,
    args: [`-${daysBack} days`],
  })
  return result.rows as any[]
}
```

Cap at 300. Ceremonial bills excluded (they'll never be in the news).

## Step 3 — LLM matcher

Create `lib/news-matcher.ts`:

```ts
import { GoogleGenerativeAI } from '@google/genai'

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' })

type CandidateBill = { id: string; title: string; summary: string | null }

export async function matchBillsToArticle(
  articleTitle: string,
  articleDescription: string,
  candidates: CandidateBill[]
): Promise<string[]> {
  if (candidates.length === 0) return []

  // Pre-filter: only candidates whose title shares a meaningful word with the article
  const articleWords = new Set(
    (articleTitle + ' ' + articleDescription)
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 4)  // skip short stop-like words
  )

  const filtered = candidates.filter(c => {
    const titleWords = c.title.toLowerCase().split(/\W+/)
    return titleWords.some(w => w.length > 4 && articleWords.has(w))
  })

  // If pre-filter returns nothing, skip LLM call — no candidates to match
  if (filtered.length === 0) return []

  // Cap at 30 candidates per LLM call
  const top = filtered.slice(0, 30)

  const candidateList = top.map(c =>
    `- ${c.id}: ${c.title}${c.summary ? ` | ${c.summary.slice(0, 100)}` : ''}`
  ).join('\n')

  const prompt = `You are matching a news article to US Congress bills it might be about.

Article title: "${articleTitle}"
Article summary: "${articleDescription}"

Candidate bills:
${candidateList}

Which of these bills (if any) is this article directly about? Return ONLY a JSON array of bill IDs.
Return [] if none clearly match. Do not include bills that are only tangentially related.
Examples of valid output: ["119-hr-1234"] or ["119-hr-1234", "119-s-567"] or []`

  try {
    const result = await model.generateContent(prompt)
    const text = result.response.text().trim()
    // Strip markdown fences if present
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    if (!Array.isArray(parsed)) return []
    // Validate each ID exists in our candidate set
    const validIds = new Set(top.map(c => c.id))
    return parsed.filter((id: unknown) => typeof id === 'string' && validIds.has(id))
  } catch (e) {
    console.error('LLM match failed:', e)
    return []
  }
}
```

## Step 4 — Wire into news sync

In the news sync pipeline (wherever articles are processed after RSS fetch), replace the `extractBillIds()` call with the LLM matcher:

```ts
import { matchBillsToArticle } from './news-matcher'
import { getCandidateBills } from './queries'

// Fetch candidates once per sync run, not per article
const candidates = await getCandidateBills(30)

// For each article:
const matchedIds = await matchBillsToArticle(
  article.title,
  article.description ?? '',
  candidates
)

// Write a news_mentions row for each matched bill
for (const billId of matchedIds) {
  // insert into news_mentions with bill_id = billId
}

// If no matches, still write the article row with bill_id = NULL
// (preserves the article for future re-matching if the schema supports it)
```

Rate: add a 200ms delay between LLM calls to stay within Gemini free-tier limits. With 55 articles/day, pre-filtering should reduce LLM calls to 15-25/day (many articles won't pass the word-overlap pre-filter).

## Step 5 — Test run

```powershell
npm run sync:news
```

Check output for:
- How many articles passed the pre-filter
- How many LLM calls fired
- How many matches were returned

Then:
```sql
SELECT COUNT(*) FROM news_mentions WHERE bill_id IS NOT NULL;
SELECT bill_id, COUNT(*) as mentions FROM news_mentions 
WHERE bill_id IS NOT NULL 
GROUP BY bill_id 
ORDER BY mentions DESC 
LIMIT 10;
```

Cross-check: do the top-mentioned bills correspond to bills that were actually in the news that week? Load the bill IDs and verify the titles make sense against the article headlines.

## Step 6 — Verify weekly report

Generate a fresh report for the current week:

```powershell
npm run report 2026-05-19
```

Open `/reports/2026-05-19` and confirm "Most talked about" renders real bill names instead of the clean fallback.

## Acceptance criteria

1. `npm run sync:news` produces at least some `news_mentions` rows with non-null `bill_id`
2. Match precision check: manually verify 5 matched pairs — does the article plausibly cover the bill it was matched to?
3. Weekly report "Most talked about" section renders real data for at least one week
4. No crashes on articles where pre-filter returns zero candidates (clean skip)
5. Gemini call count per sync run is reasonable (< 40)

## Cost note

Each LLM call is one Gemini Flash request with ~500 tokens input + ~50 tokens output. At current Gemini pricing, 25 calls/day × 365 = ~9,000 calls/year. At Flash rates this is well under $10/year — acceptable.

## Out of scope

- Full article body fetching (option 1 from the audit) — adds latency and HTML parsing complexity, not worth it when LLM matching on subheads works
- Retroactively re-matching existing null-bill_id rows — do a one-time backfill run separately if needed
- Encoding fix for curly apostrophe mojibake in RSS XML — cosmetic, separate cleanup
