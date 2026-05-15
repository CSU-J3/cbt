# 58 — Reports v1

## What this is

Weekly cron-generated reports. Each Monday, the cron generates a report for the prior calendar week (Mon-Sun) and writes it to a new `reports` table. Users read at `/reports/[slug]` and can download as Markdown. Index lives at `/reports`.

Roadmap theme 3, v1. Path B from the scoping conversation: title-heuristic-only + summary-length proxy for notable introductions; cosponsor sync and `text_length` enrichment come later as standalone work.

This is the chunkiest handoff in the dashboard arc. Punt subsections to follow-ups if it feels too big to ship in one cycle, but the natural unit is everything together.

## In scope

- New `reports` table + migration
- New `lib/report-generation.ts` module
- New `scripts/generate-report.ts` standalone CLI + `npm run report`
- Weekly cron step in `app/api/sync/route.ts` (gated by Monday check)
- New `/reports` index page (server-rendered, lists all reports newest first)
- New `/reports/[slug]` detail page (renders the Markdown content)
- New `/reports/[slug]/download` route (returns the raw Markdown as a downloadable attachment)
- Markdown rendering via `react-markdown` (new dependency)
- `▸ REPORTS` link added to `SubViewLinkStrip` on the dashboard
- New `getReportsList()` and `getReport(slug)` query helpers
- Single Gemini call per report, structured-output prompt (mirrors the summarize prompt's section-marker pattern)
- Failure mode: cron logs a warning, no row written, no crash. Manual CLI recovery available.
- SKILL.md updates

## Out of scope

- Backfill of past weeks. Reports start from the next Monday after this ships. The `/reports` index will be empty until then.
- Cosponsor sync (separate handoff later)
- `text_length` column (separate handoff later)
- News-mentions ("Most talked about") section ships as a stub: "News mentions coming when theme 4 ships." Don't build news infrastructure here.
- PDF export. Markdown download covers the share-elsewhere use case for v1.
- Edit/regenerate UI. If a report needs fixing, hand-edit the DB row or re-run the CLI.

## Schema

Add to `scripts/migrate.ts`:

```sql
CREATE TABLE IF NOT EXISTS reports (
  slug TEXT PRIMARY KEY,         -- e.g. "2026-05-11" (week start, ISO date)
  week_start TEXT NOT NULL,      -- ISO date
  week_end TEXT NOT NULL,        -- ISO date
  title TEXT NOT NULL,           -- "Week of May 11, 2026"
  content_md TEXT NOT NULL,      -- Markdown body
  created_at TEXT NOT NULL       -- ISO timestamp, JS-side (matches codebase convention)
);

CREATE INDEX IF NOT EXISTS idx_reports_week_start ON reports(week_start DESC);
```

## Sections of a v1 report (Markdown structure)

```markdown
# Week of May 11, 2026

[LLM-generated lead, 2-3 sentences, week-specific tone]

## Stage movements (47)

[LLM-generated commentary, 2-3 sentences]

- HR 2702 — ▸ INTRO → ▸▸ COMMITTEE (Smith, R-OH)
- S 1453 — ▸▸ FLOOR → ▸▸▸ OTHER CHAMBER (Jones, D-CA)
- ... (up to 10 rows)

## Enactments (12)

[LLM-generated commentary, 1-2 sentences. If zero enactments, the whole section is replaced with "_No bills became law this week._"]

- HR X — [title, truncated to 80 chars]
- S Y — [title]
- ... (all enactments, no limit)

## Dead in committee

Bills with no action in 30+ days as of week end, grouped by topic.

- **Healthcare** (45): HR ..., HR ..., HR ...
- **Taxes** (32): HR ..., S ...
- ... (top 10 topics, top 3 bills per topic shown inline)

## Notable introductions

Top 5 substantive bills introduced this week.

- HR ... — [title] — [sponsor]
- ... (5 rows; if fewer than 5 substantive intros, show all)

## Topic breakdown

[LLM-generated commentary, 1-2 sentences]

| Topic | Movement |
|---|---|
| Healthcare | 18 |
| Taxes | 12 |
| ... | ... |

## Most talked about

_News mentions coming when theme 4 ships._
```

## Generation module (`lib/report-generation.ts`)

```ts
export type WeekRange = {
  start: string;  // ISO date, Monday
  end: string;    // ISO date, Sunday
};

export async function generateWeeklyReport(week: WeekRange): Promise<{
  slug: string;
  title: string;
  content_md: string;
}>;

export async function writeReport(report: {
  slug: string;
  weekStart: string;
  weekEnd: string;
  title: string;
  contentMd: string;
}): Promise<void>;

export function getPriorWeek(date: Date = new Date()): WeekRange;  // returns Mon-Sun for the calendar week before `date`
```

`generateWeeklyReport` gathers data, builds the LLM prompt, calls Gemini, assembles the Markdown body, returns it.

### Data gathered (queries, all date-bounded to the week)

1. Stage transitions count + top 10 (ordered by `stage_changed_at DESC`)
2. Enactments count + full list (filtered to `stage='enacted'` with `latest_action_date BETWEEN week_start AND week_end`)
3. New introductions count
4. Dead in committee, grouped by topic (uses `json_each` for topic UNNEST, same pattern as `getTopicDistribution`)
5. Notable introductions: top 5 substantive intros (see filter below)
6. Topic breakdown: count of stage transitions per topic for the week

### Notable introductions filter

```sql
SELECT id, title, sponsor_name, sponsor_party, sponsor_state, LENGTH(summary) AS summary_len
FROM bills
WHERE introduced_date BETWEEN ? AND ?
  AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
  AND (cluster_id IS NULL OR cluster_id = 'cra-disapproval')
  AND summary IS NOT NULL
ORDER BY summary_len DESC
LIMIT 5;
```

CRA-disapproval is included as substantive; the other clusters (awareness-designation, honoring-resolution, facility-naming, sense-of-congress) are filtered out. Summary length is the secondary ranker, acknowledged as a weak proxy until `text_length` lands in a future handoff.

### LLM prompt (single call, structured output)

```
You are writing the weekly Congress report for [WEEK_START] to [WEEK_END].

Generate prose for the following sections based on the data below. Each
section's prose must reference specific bill IDs (e.g. "HR 2702") and
use exact numbers from the data. Avoid generic openers ("This week,
Congress..."), avoid marketing titles for bills, avoid editorial framing.
Plain numbers, plain language, terminal voice.

WEEK DATA:
- Total stage transitions: {transitions_count}
- Top 5 transitions:
  - {bill_id_1}: {title_1} ({prev_stage} → {new_stage})
  - ...
- Enactments: {enactments_count} bills, including {top_3_enactment_ids}
- New introductions: {introductions_count}
- Top topic by activity: {top_topic} ({top_topic_count} transitions)

Output in this exact format:

LEAD:
<2-3 sentences, max 60 words>

STAGE_COMMENTARY:
<2-3 sentences about the stage movements>

ENACTMENTS_COMMENTARY:
<1-2 sentences about the enactments; output exactly "_No bills became law this week._" if enactments count is zero>

TOPIC_COMMENTARY:
<1-2 sentences about topic breakdown>
```

Parse the response by splitting on the four section markers, same pattern as `lib/summarize.ts`. If parsing fails, log the error and abort (don't write a half-baked report). The cron's outer try/catch handles the failure silently.

### Markdown assembly

Programmatically interpolate the LLM commentary into the Markdown template (the structure above). Bill ID rendering: just plain text (`HR 2702`), no special markup. Stage arrows: plain text with the existing `▸` glyphs.

## Cron integration

In `app/api/sync/route.ts`, after the existing sync + summarize + dashboard-lead steps:

```ts
const now = new Date();
if (now.getUTCDay() === 1) {  // Monday in UTC
  try {
    const week = getPriorWeek(now);
    const report = await generateWeeklyReport(week);
    await writeReport({
      slug: week.start,
      weekStart: week.start,
      weekEnd: week.end,
      title: `Week of ${formatWeekTitle(week.start)}`,
      contentMd: report.content_md,
    });
    revalidateTag('reports');
  } catch (err) {
    console.warn('[cron] report generation failed; skipping', err);
  }
}
```

The Monday check uses UTC because the cron runs at 09:00 UTC. Failure is silent: no row written, no crash, the cron's other steps still complete. Manual recovery: run `npm run report` later in the week.

## Standalone CLI (`scripts/generate-report.ts`)

For testing the prompt and recovering from cron failures:

```ts
import { generateWeeklyReport, writeReport, getPriorWeek } from '../lib/report-generation';

async function main() {
  const weekArg = process.argv[2]; // optional: ISO date for a specific week start
  const week = weekArg
    ? { start: weekArg, end: addDays(weekArg, 6) }
    : getPriorWeek();

  console.log(`Generating report for week of ${week.start}...`);
  const report = await generateWeeklyReport(week);

  console.log('\n--- GENERATED REPORT ---\n');
  console.log(report.content_md);

  console.log('\nWriting to DB...');
  await writeReport({ ... });
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
```

Add `"report": "tsx scripts/generate-report.ts"` to package.json. Usage: `npm run report` (prior week) or `npm run report 2026-05-04` (specific week).

## Query helpers (`lib/queries.ts`)

```ts
export async function getReportsList(): Promise<Array<{
  slug: string;
  title: string;
  weekStart: string;
  weekEnd: string;
}>>;

export async function getReport(slug: string): Promise<{
  slug: string;
  title: string;
  weekStart: string;
  weekEnd: string;
  contentMd: string;
  createdAt: string;
} | null>;
```

`getReportsList` returns all reports ordered by `week_start DESC`. Cache with `unstable_cache(..., ['reports-list'], { tags: ['reports'], revalidate: 3600 })`.

`getReport(slug)` returns one report or `null`. Cache with `unstable_cache(..., ['report', slug], { tags: ['reports'], revalidate: 3600 })`.

Both invalidated by the cron's `revalidateTag('reports')` call.

## Routes

### `/reports` (`app/reports/page.tsx`)

Server component. Reads from `getReportsList()`. Lists reports newest first.

Layout:

```
HeaderBar (variant feed)
─────────────────────────────────────────────────────────
WEEK OF MAY 11, 2026                                      [VIEW →]
WEEK OF MAY 4, 2026                                       [VIEW →]
WEEK OF APR 27, 2026                                      [VIEW →]
...
```

Empty state (until first Monday after ship): centered muted text, `Reports begin Monday [next monday's date].`

Style: rows similar to `/sponsors` row pattern, hover state `--bg-row-hover`, click anywhere on row navigates to `/reports/[slug]`.

### `/reports/[slug]` (`app/reports/[slug]/page.tsx`)

Server component. Reads `getReport(slug)`. Renders Markdown.

Layout:

```
HeaderBar (variant feed)
─────────────────────────────────────────────────────────
← BACK TO REPORTS                                [DOWNLOAD .md ↓]

# Week of May 11, 2026

[rendered Markdown body...]
```

Use `react-markdown` for rendering. Add as a dependency: `pnpm add react-markdown`. Default GFM tables, fenced code blocks, lists. Custom component overrides to match terminal aesthetic:

- `<h1>` — 16px uppercase, `--text-primary`, letter-spacing 0.5px, bottom border `--border-soft`, mb-4
- `<h2>` — 14px uppercase, `--text-secondary`, letter-spacing 0.5px, mt-6 mb-3
- `<p>` — 14px, `--text-primary`, line-height 1.6, mb-3
- `<ul>` — 14px, `--text-primary`, mb-3, no bullet markers (use `·` prefix in source or `list-none` + `before:` pseudo)
- `<li>` — mb-1
- `<code>` (inline) — bill IDs and other inline mono, `--accent-amber`, no background
- `<table>` — full width, monospace, border-collapse, td/th padding 8px, border-bottom `--border-soft`
- `<em>` — `--text-muted`, italic

Max-width container ~800px, left-aligned, full-width on mobile.

If `getReport(slug)` returns null: render a 404-style empty state with a `← BACK TO REPORTS` link. Don't use Next.js `notFound()` — the empty state is friendlier.

### `/reports/[slug]/download` (`app/reports/[slug]/download/route.ts`)

```ts
import { NextRequest } from 'next/server';
import { getReport } from '@/lib/queries';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const report = await getReport(slug);
  if (!report) return new Response('Not found', { status: 404 });

  return new Response(report.contentMd, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="cbt-${slug}.md"`,
    },
  });
}
```

## SubViewLinkStrip update

Add a new row to the dashboard's `SubViewLinkStrip`:

```
▸ REPORTS
```

Position: after `▸ WATCHLIST` (last in the list, since reports are a less-frequently-used surface than the rest). Same 12px label, hover `--accent-amber`, links to `/reports`.

## SKILL.md updates

Edit the `Database schema` section: add the `reports` table block.

Edit the `Pages` section: add two new entries.

- `/reports` — index of weekly reports, newest first. Empty until the first Monday after this ships.
- `/reports/[slug]` — individual report. Markdown rendered with `react-markdown` and terminal-aesthetic component overrides. `[Download .md ↓]` link in the header pulls from `/reports/[slug]/download`.

Edit the `Query helpers` section: add `getReportsList()` and `getReport(slug)`, both cached with tag `reports`.

Add a new top-level section `Report generation`:

- Generated weekly on Monday 09:00 UTC by `lib/report-generation.ts::generateWeeklyReport`. Cron step is gated by `now.getUTCDay() === 1`.
- One Gemini call per report. Structured output with four section markers (`LEAD`, `STAGE_COMMENTARY`, `ENACTMENTS_COMMENTARY`, `TOPIC_COMMENTARY`). Parsed by splitting on markers, same as the summarize prompt.
- Failure mode: cron logs a warning, no row written. Manual recovery: `npm run report` (prior week) or `npm run report YYYY-MM-DD` (specific week start).
- Notable introductions section uses summary length as a weak substantiveness proxy. Will be upgraded to `text_length` + `cosponsor_count` in future enrichment handoffs.

## Verification

1. `npm run migrate` — `reports` table exists.
2. `npm run report 2026-05-04` (or any Monday in the recent past, picking one where there's known data). The CLI prints the generated Markdown, then writes the row. Inspect the output: lead is 2-3 sentences with real bill IDs, sections are populated, dead-in-committee groups by topic, notable section shows 5 substantive intros.
3. Hit `/reports`. The generated report appears in the list.
4. Click into `/reports/2026-05-04`. The Markdown renders with terminal-aesthetic styling. Tables render. Bill IDs in inline mono.
5. Click `[Download .md ↓]`. File downloads with name `cbt-2026-05-04.md`. Content matches what's stored in the DB.
6. Hit `/reports/garbage-slug`. Renders the empty state with the back link, no 500.
7. Manually `DELETE FROM reports` to test the empty index state. `/reports` renders `Reports begin Monday [date]`.
8. Re-run `npm run report 2026-05-04`. Confirm it upserts (no duplicate-key error).
9. Dashboard sanity: `▸ REPORTS` appears at the bottom of `SubViewLinkStrip`, links to `/reports`.
10. `pnpm build` — no warnings. `/reports` and `/reports/[slug]` are dynamic (they read the DB).

## Acceptance

Reports v1 ships. The cron picks up Monday generation. The CLI handles manual recovery and prompt iteration. `/reports` and `/reports/[slug]` render with terminal aesthetic. Download works. The notable section is functional with the documented weak proxy until cosponsor + text_length land.

After this: dashboard polish is done, reports v1 is done. Next move is either cosponsor sync (enrichment for notable + sponsor analytics), news signal (theme 4 — heavier lift but unlocks "most talked about"), or CCBT parity (the sister project's gap keeps widening). User picks.
