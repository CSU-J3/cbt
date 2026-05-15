# 57 — Dashboard lead (LLM-generated)

## What this is

Dashboard polish, part 2. Adds a 3-sentence cron-generated summary at the top of `/` that answers "wtf is going on" in literal prose before the user parses any chart. One Gemini call per cron tick, persisted to a new key-value table, read on every dashboard render.

Cost: ~$0.0001 per call, negligible at daily cadence. Failure mode is graceful (prior lead stays in DB if generation fails).

Roadmap theme 2 polish, step 2. After this ships, dashboard polish is done; next move is a different theme (reports, news, member depth, etc.).

## In scope

- New `dashboard_state` table (key-value store for cron-generated dashboard content)
- New `lib/dashboard-lead.ts` module with `generateDashboardLead()` and `writeDashboardLead()`
- New `scripts/generate-lead.ts` standalone CLI entry point + `npm run lead`
- New `DashboardLead` server component rendered at the top of `/`, above `ActiveFilterStrip`
- New `getDashboardLead()` query helper
- Cron route addition: after sync + summarize, generate and write the lead. Failure is logged but non-fatal.
- Migration: add `dashboard_state` to `scripts/migrate.ts`
- SKILL.md updates

## Out of scope

- Filter-aware leads (the lead is always corpus-wide; doesn't change when `?stage=committee` is set)
- Streaming generation
- User-tunable prompt
- Multiple lead variants (e.g. weekly vs monthly)
- Highlighting bill IDs or topics in the prose with color (would require post-processing the LLM output; skip for v1)
- Generation on-demand from the browser (the lead is only ever generated server-side during cron or via the CLI script)

## Schema

Add to `scripts/migrate.ts`:

```sql
CREATE TABLE IF NOT EXISTS dashboard_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Why a key-value table instead of a single-purpose `weekly_lead` table: flexible for future dashboard state (other cron-generated text, cached aggregates, etc.) without further migrations. The lead lives under `key = 'weekly_lead'`.

## Generation (`lib/dashboard-lead.ts`)

```ts
export async function generateDashboardLead(): Promise<string>;
export async function writeDashboardLead(text: string): Promise<void>;
```

`generateDashboardLead` gathers data, builds the prompt, calls Gemini, returns the text.

Data inputs (use existing queries where possible, or add small focused helpers):

- Total non-ceremonial bills in the corpus
- Stage transitions in the last 7 days (count, and the top 5 most recent with bill ID + truncated title + transition arrow)
- Enactments in the last 7 days (count + top 3 bill IDs)
- New introductions in the last 7 days (count)
- Top topic by transition count in the last 7 days (topic name + count)

Pass these as structured input to Gemini:

```
You are writing the daily lead for a Congress tracking dashboard.
Write exactly 3 sentences, max 60 words total, describing what's
happening in Congress right now based on the data below. Reference
at least 2 specific bill IDs (e.g. "HR 2702"). Use exact numbers
from the data. Avoid generic openers ("This week, Congress..."),
avoid editorial framing, avoid marketing titles for bills. Plain
numbers, plain language, terminal voice.

DATA:
- Corpus size: {total} non-ceremonial bills tracked
- Stage transitions (last 7d): {transitions_count} total
- Top 5 recent transitions:
  - {bill_id_1}: {title_1} ({transition_1})
  - {bill_id_2}: {title_2} ({transition_2})
  - ...
- Enactments (last 7d): {enactments_count} bills, including {top_enactments}
- New introductions (last 7d): {introductions_count} bills
- Topic with most activity: {top_topic} ({top_topic_count} transitions)

Write the lead:
```

Use the existing Gemini setup from `lib/summarize.ts` (same model, same client). Model: `gemini-2.5-flash`. Single completion, no streaming.

Expect to iterate on this prompt. Common failure modes will probably be: marketing-title creep ("The Fentanyl Eradication Act..."), generic openers, vague numbers ("several bills" instead of "22 bills"), and editorial framing ("In a significant move..."). Same patterns as the summarize prompt's early iterations.

`writeDashboardLead` upserts into `dashboard_state`:

```sql
INSERT INTO dashboard_state (key, value, updated_at)
VALUES ('weekly_lead', ?, datetime('now'))
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;
```

## Query helper (`lib/queries.ts`)

```ts
async function getDashboardLead(): Promise<{
  text: string;
  updatedAt: string;
} | null>;
```

```sql
SELECT value, updated_at FROM dashboard_state WHERE key = 'weekly_lead';
```

Returns `null` if no row exists (fresh DB, cron hasn't run yet).

Cache with `unstable_cache(..., ['dashboard-lead'], { tags: ['bills'], revalidate: 3600 })`. Uses the unified `bills` tag; the cron's existing `revalidateTag('bills')` call invalidates it after a fresh generation writes the new lead.

## Component (`components/DashboardLead.tsx`)

Server component. Reads from `getDashboardLead()`. Returns `null` if no lead exists yet (hides itself, no placeholder).

Layout:

```
LEAD · LAST UPDATED 02:48 MT
─────────────────────────────────────────────────────────────────
Twenty-two bills became law in the last week, the highest weekly
count since March. HR 2702 moved from committee to floor; S 1453
cleared floor and is at the president's desk. Healthcare-tagged
bills led activity with 18 stage changes.
```

Styling:

- Outer container: `--bg-panel` background, `--border-soft` border, 16px padding, full pane width
- Header label `LEAD · LAST UPDATED HH:MM MT`: 12px uppercase, letter-spacing 0.5px, `--text-secondary` for `LEAD`, `--text-dim` for `· LAST UPDATED HH:MM MT`
- Prose: 14px, `--text-primary`, line-height 1.5, max-width ~800px, left-aligned
- Mobile: prose stays full-width on narrow screens, no max-width

Use the existing `formatLastUpdated` helper from `lib/format.ts` for the timestamp.

## Cron integration

In the existing sync cron route (`app/api/sync/route.ts`), after the sync + summarize steps:

```ts
try {
  const text = await generateDashboardLead();
  await writeDashboardLead(text);
} catch (err) {
  console.warn('[cron] lead generation failed; keeping prior lead', err);
}
```

The `revalidateTag('bills')` call already happens after sync writes; it covers the new `dashboard-lead` cache key too.

Failure is non-fatal: if Gemini rate-limits or errors, the prior lead stays in the DB and the dashboard keeps rendering it. The cron tick still succeeds.

## Standalone CLI (`scripts/generate-lead.ts`)

For local iteration on the prompt without waiting for cron:

```ts
import { generateDashboardLead, writeDashboardLead } from '../lib/dashboard-lead';

async function main() {
  const text = await generateDashboardLead();
  console.log('Generated lead:\n');
  console.log(text);
  console.log('\nWriting to DB...');
  await writeDashboardLead(text);
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
```

Add to `package.json`: `"lead": "tsx scripts/generate-lead.ts"`.

## Page wiring (`app/page.tsx`)

Render `<DashboardLead />` above `<ActiveFilterStrip />`:

```tsx
<>
  <HeaderBar variant="dashboard" />
  <DashboardLead />
  <ActiveFilterStrip filters={filters} />
  <DashboardGrid>...</DashboardGrid>
</>
```

The lead is corpus-wide, so it does not depend on `filters`. Passing them in would be misleading.

## SKILL.md updates

Edit the Database schema section: add the `dashboard_state` table block with a note that it's a key-value store for cron-generated dashboard content, currently holding `weekly_lead`.

Edit the `Pages` `/` entry: add a `DashboardLead` block at the top, above the active filter strip. 3-sentence prose summary, generated daily by the cron, corpus-wide (does not change with active filters).

Edit the Query helpers section: add `getDashboardLead()` — reads the current weekly lead from `dashboard_state`. Returns `null` if not yet generated. Cached with tag `bills`.

Add a new top-level section `Dashboard lead generation`:

- The lead is generated once per cron tick by `lib/dashboard-lead.ts::generateDashboardLead`.
- Inputs: recent stage transitions, enactments, introductions, top topic by activity.
- Prompt is in source under `lib/dashboard-lead.ts`. Expect prompt iteration over the first 5-10 generations.
- Failure mode: cron logs a warning, prior lead stays in the DB, dashboard keeps rendering it.
- Manual run: `npm run lead`.

## Verification

1. `npm run migrate` — `dashboard_state` table exists.
2. `npm run lead` — generates a lead, prints it, writes to DB. Inspect the text. Should be 3 sentences, reference at least 2 bill IDs, use exact numbers, no marketing titles, no "This week, Congress..." prefix. If the output is generic, iterate the prompt before moving on.
3. `pnpm dev`, hit `/`. The lead block appears above the active filter strip. Header shows `LEAD · LAST UPDATED HH:MM MT` with the timestamp from generation.
4. Apply filters (`/?stage=committee`). The lead does NOT change. The active filter strip appears below it.
5. Delete the row (`DELETE FROM dashboard_state WHERE key='weekly_lead'`) and refresh. The lead block disappears entirely (returns `null`). The rest of the dashboard renders normally.
6. Hit the cron route (with auth). Confirm a new lead is generated, `updated_at` is now, dashboard reflects the new text within the cache TTL (or immediately after `revalidateTag('bills')`).
7. Simulate Gemini failure (temporarily set `GEMINI_API_KEY` to garbage in `.env`, restart, hit cron). Cron logs the warning, prior lead stays in DB, dashboard renders the prior lead unchanged.
8. `pnpm build` — no warnings.

## Acceptance

The dashboard opens with a 3-sentence lead that references real bill IDs and real numbers. The framing question gets answered in prose before the user looks at any chart. Cron picks up generation daily. Failure is graceful. Dashboard polish is done.
