# 59 — Cosponsor + text_length enrichment

## What this is

Two columns added to `bills` (`cosponsor_count`, `text_length`), captured going forward on every sync and summarize, backfilled where the data already exists. Reports' notable-introductions filter swaps `LENGTH(summary)` for the new fields, retiring the substantiveness proxy flagged in handoff 58.

Roadmap: the "cosponsor sync + `text_length` enrichment" follow-up that handoff 58 explicitly punted. Single-handoff scope. No new LLM calls.

## In scope

- Migration: add `cosponsor_count INTEGER` and `text_length INTEGER` to `bills`
- Sync edit: extract `bill.cosponsors.count` from the Congress.gov detail response, write to `cosponsor_count` on upsert
- Summarize edit: capture original text length before the 8000-char truncation, write to `text_length` alongside the summary
- `scripts/backfill-cosponsors.ts` standalone CLI — extracts from existing `raw_json` via `json_extract`, single UPDATE
- `scripts/backfill-text-length.ts` standalone CLI — fetches text URLs for summarized bills with NULL `text_length`, writes length, designed to run in background and be interruptible
- `lib/report-generation.ts` notable-introductions query updated to the new filter
- SKILL.md updates (schema block, sync logic, notable-introductions reference, new backfill scripts)

## Out of scope

- Cosponsor re-fetch backfill for bills whose `raw_json` doesn't carry the count. Verify the population rate after the raw_json backfill; if it covers <90% of summarized bills, that's a follow-up handoff.
- Plain-text extraction from text URLs. `text_length` is the raw fetched content length, same source the summarize step already reads. Noisy but consistent.
- Cosponsor *list* (who cosponsored what). Only the count this round. Member-level cosponsor relationships come later when sponsor analytics need them.
- Reindex / new index on either field. The notable filter operates on a date-bounded, ceremonial-filtered subset of ~50-200 rows per week; no index needed.
- UI exposure on the bill detail page or `/sponsors`. Data is captured but not displayed yet. Display ships when there's a surface that needs it.

## Schema

Add to `scripts/migrate.ts`:

```sql
ALTER TABLE bills ADD COLUMN cosponsor_count INTEGER;
ALTER TABLE bills ADD COLUMN text_length INTEGER;
```

Both nullable. NULL means "not yet populated," distinguishable from `0` (a bill with zero cosponsors, which is a real value).

## Sync changes (`lib/sync.ts`)

In the bill upsert path, extract the cosponsor count from the API detail response:

```ts
const cosponsorCount = bill.cosponsors?.count ?? null;
```

Add `cosponsor_count` to the upsert column list and `VALUES` clause. The existing `ON CONFLICT` update should set `cosponsor_count = excluded.cosponsor_count` so subsequent syncs refresh it (cosponsors get added throughout a bill's life).

Do **not** clear `cosponsor_count` when `update_date` changes the way `summary` is cleared. The count is fresh from every detail fetch; nulling it would create unnecessary backfill churn.

## Summarize changes (`lib/summarize.ts`)

The summarize step already fetches text content for the prompt. Today it truncates to 8000 chars before sending. Capture the pre-truncation length:

```ts
const textContent = await fetchBillText(bill);  // existing call
const textLength = textContent?.length ?? null;
const truncatedText = textContent?.slice(0, 8000) ?? '';
// ... existing prompt assembly using truncatedText ...
```

When the row is updated with the new summary, also write `text_length`. Same write, same transaction.

If `textContent` is null/empty (no text version available — common for fresh introductions), write `text_length = null`, not `0`. NULL preserves the "data not available" signal; `0` would falsely sort short.

## Cosponsor backfill (`scripts/backfill-cosponsors.ts`)

```ts
import { db } from '../lib/db';

async function main() {
  const before = await db.execute(
    `SELECT COUNT(*) as n FROM bills WHERE cosponsor_count IS NULL`
  );
  console.log(`Bills with NULL cosponsor_count before: ${before.rows[0].n}`);

  const result = await db.execute(`
    UPDATE bills
    SET cosponsor_count = CAST(json_extract(raw_json, '$.bill.cosponsors.count') AS INTEGER)
    WHERE cosponsor_count IS NULL
      AND json_extract(raw_json, '$.bill.cosponsors.count') IS NOT NULL
  `);
  console.log(`Rows updated: ${result.rowsAffected}`);

  const after = await db.execute(
    `SELECT COUNT(*) as n FROM bills WHERE cosponsor_count IS NULL`
  );
  console.log(`Bills with NULL cosponsor_count after: ${after.rows[0].n}`);

  const total = await db.execute(`SELECT COUNT(*) as n FROM bills`);
  console.log(`Total bills: ${total.rows[0].n}`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

Add `"backfill:cosponsors": "tsx scripts/backfill-cosponsors.ts"` to `package.json`.

Run once: `pnpm backfill:cosponsors`. Expectation: covers >90% of bills. If it covers less, log the result and stop — re-fetching detail for the gaps is a separate handoff decision.

Verify the JSON path before running. The actual structure in `raw_json` may be `$.bill.cosponsors.count` or `$.cosponsors.count` depending on what we stored. Quick check: `SELECT json_extract(raw_json, '$.bill.cosponsors.count') FROM bills LIMIT 5` — if it returns nulls, try `$.cosponsors.count`. Adjust the path in the UPDATE accordingly.

## Text_length backfill (`scripts/backfill-text-length.ts`)

Re-fetches text URLs for summarized bills with NULL `text_length`. Designed to be safe to interrupt and resume. Runs slowly on purpose (rate-respecting).

```ts
import { db } from '../lib/db';
import { fetchBillText } from '../lib/summarize'; // export the helper if not already

const BATCH_SIZE = 100;
const DELAY_MS = 200;

async function main() {
  while (true) {
    const batch = await db.execute(`
      SELECT id, congress, bill_type, bill_number
      FROM bills
      WHERE summary IS NOT NULL
        AND text_length IS NULL
      LIMIT ${BATCH_SIZE}
    `);

    if (batch.rows.length === 0) {
      console.log('Done.');
      break;
    }

    for (const row of batch.rows) {
      try {
        const text = await fetchBillText({
          congress: row.congress as number,
          billType: row.bill_type as string,
          billNumber: row.bill_number as number,
        });
        const len = text?.length ?? 0;  // 0 (not null) for bills where the fetch worked but returned empty
        await db.execute({
          sql: `UPDATE bills SET text_length = ? WHERE id = ?`,
          args: [len, row.id as string],
        });
        console.log(`${row.id}: ${len}`);
      } catch (err) {
        console.warn(`${row.id}: fetch failed`, err);
        // Leave text_length NULL so the next run retries this bill
      }
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

Add `"backfill:text-length": "tsx scripts/backfill-text-length.ts"` to `package.json`.

Failure handling distinguishes two states:

- Fetch *succeeded* with empty content → write `text_length = 0`. Won't be retried.
- Fetch *failed* (network, 404, timeout) → leave `text_length = NULL`. Next run picks it up.

Run command: `pnpm backfill:text-length`. Pace: ~5 bills/sec, so ~50 min for 15k bills. Background-friendly; can be Ctrl-C'd and resumed.

If `fetchBillText` isn't exported from `lib/summarize.ts`, export it (the summarize module's text-fetching helper). If the current implementation is inline inside `summarizeBill`, extract it into a named function first.

## Reports notable filter (`lib/report-generation.ts`)

Replace the existing notable-introductions query with:

```sql
SELECT id, title, sponsor_name, sponsor_party, sponsor_state,
       cosponsor_count, text_length
FROM bills
WHERE introduced_date BETWEEN ? AND ?
  AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
  AND (cluster_id IS NULL OR cluster_id = 'cra-disapproval')
  AND summary IS NOT NULL
  AND (text_length IS NULL OR text_length > 5000)
ORDER BY cosponsor_count DESC NULLS LAST,
         COALESCE(text_length, 0) DESC,
         id DESC
LIMIT 5;
```

Why each clause:

- `text_length IS NULL OR text_length > 5000` — excludes short resolutions and one-pagers that slipped past the ceremonial+cluster filters. NULL bills (haven't been backfilled yet, or text genuinely unavailable) are kept so the filter doesn't go empty during backfill.
- `cosponsor_count DESC NULLS LAST` — primary signal. A bill with 50 cosponsors is more notable than one with 2. NULLs go last; once backfill runs, NULLs should be rare.
- `COALESCE(text_length, 0) DESC` — tiebreaker. Substantive long bills win ties.
- `id DESC` — final deterministic tiebreaker, matches the convention used elsewhere in `lib/queries.ts`.

Remove the `LENGTH(summary) AS summary_len` selection and the previous ORDER BY.

## SKILL.md updates

**Database schema** section: add `cosponsor_count INTEGER` and `text_length INTEGER` to the `bills` CREATE TABLE block. Note both are nullable and what NULL means for each.

**Sync logic** section: add a line under step 4 noting that `cosponsor_count` is captured from `bill.cosponsors.count` on every upsert (not nulled across re-syncs). Add a line under step 5 noting that `text_length` is captured during summarization (pre-truncation length).

**Query helpers** section: no new helpers, but mention that `lib/report-generation.ts`'s notable filter now uses `cosponsor_count` + `text_length` instead of `LENGTH(summary)`.

Add a brief **Backfill scripts** subsection under **Sync logic**:

- `pnpm backfill:cosponsors` — one-shot `json_extract` from `raw_json` into `cosponsor_count`. Free, instant.
- `pnpm backfill:text-length` — re-fetches text URLs for summarized bills with NULL `text_length`. Background-friendly, ~50 min for the full corpus, safe to interrupt.

**Things to watch for** section: add a note that the `cosponsors.count` JSON path in `raw_json` may vary (`$.bill.cosponsors.count` vs `$.cosponsors.count`) — verify before running the backfill.

## Verification

1. `npm run migrate` — `cosponsor_count` and `text_length` columns exist on `bills`.
2. `SELECT json_extract(raw_json, '$.bill.cosponsors.count') FROM bills LIMIT 5` — confirm the path returns integers (not nulls). Adjust the backfill UPDATE if needed.
3. `pnpm backfill:cosponsors` — reports >90% coverage. Spot-check a few rows: `SELECT id, sponsor_name, cosponsor_count FROM bills WHERE cosponsor_count > 30 LIMIT 5` — should return real high-cosponsor bills with plausible names.
4. Run a single sync tick. New/updated bills should land with `cosponsor_count` populated.
5. Force a re-summarize on one bill (clear its `summary` manually, run `npm run summarize`). After it completes, `text_length` should be non-null on that row.
6. `pnpm backfill:text-length` — kick it off, let it run for 5-10 minutes, Ctrl-C, run it again. Confirm it resumes where it left off (no re-processing of already-populated rows).
7. `npm run report 2026-05-04` (or a known-good past week). Inspect the Notable Introductions section. The bills surfaced should look more substantive than the prior summary-length-based picks — bills with real cosponsors and real content, not just bills with long summaries.
8. `pnpm build` — no warnings.

## Acceptance

Both columns captured forward, backfilled where possible, reports notable filter using them. Substantiveness proxy retired.

After this: text_length backfill runs in background until coverage is high. The unblocked work is news signal (theme 4 — the "Most talked about" stub in reports, plus breaking-news view), or CCBT parity (the sibling project gap), or member depth groundwork (which now has cosponsor counts as a useful signal). User picks.
