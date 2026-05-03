---
name: cbt
description: Use this skill when working on CBT (Congress Bill Tracker), the personal Congress bill tracking dashboard. Triggers on any work touching the Congress.gov API sync pipeline, LLM bill summarization, the Next.js dashboard frontend, the Turso database schema, or Vercel Cron jobs for this project. Covers the stack (Next.js 15 App Router + TypeScript + Tailwind + Turso + Google GenAI SDK), the build order (sync script first, UI second), Congress.gov API quirks, and the summarization prompt conventions.
---

# CBT — Congress Bill Tracker

## What this is

A personal dashboard that pulls bills from the Congress.gov API, runs them through an LLM for plain-English summaries, and shows a filtered feed plus a watchlist. Built for one user (no auth, no accounts). Not a public-facing product yet.

## Stack

- Next.js 15 with App Router, TypeScript
- Tailwind for styling
- Turso (libSQL) for the database, accessed via `@libsql/client`
- Google GenAI SDK (`@google/genai`) for summarization on Gemini's free tier (`gemini-2.5-flash`)
- Vercel for hosting, Vercel Cron for the sync schedule

Do not introduce additional frameworks, ORMs, or state management libraries without checking in. The whole point is to keep this small.

## Build order

Work in this order. Don't skip ahead to the UI before the data pipeline is solid.

1. Standalone Node/TypeScript sync script (no Next.js). Fetches bills from Congress.gov and writes to Turso.
2. Add LLM summarization to the script. Iterate on the prompt until summaries are tight and neutral.
3. Next.js app pointing at the same Turso database. Feed page first.
4. Move the sync into a Next.js API route, hook up Vercel Cron.
5. Filters, bill detail pages, watchlist.

Each step should be runnable and testable before moving to the next.

## Congress.gov API

Base URL: `https://api.congress.gov/v3`. Auth: `?api_key=...` query parameter. Free tier is 5,000 requests per hour, more than enough.

Key endpoints used here:

- `/bill?fromDateTime=...&toDateTime=...&sort=updateDate+desc` — list bills updated in a window
- `/bill/{congress}/{billType}/{billNumber}` — full bill detail
- `/bill/{congress}/{billType}/{billNumber}/actions` — action history
- `/bill/{congress}/{billType}/{billNumber}/text` — list of text versions, each with formats
- `/bill/{congress}/{billType}/{billNumber}/summaries` — CRS summaries when available

### Gotchas

- `updateDate` and `updateDateIncludingText` are different fields. Use `updateDateIncludingText` for sync detection so text changes trigger re-summarization.
- `billType` values are lowercase: `hr`, `s`, `hjres`, `sjres`, `hconres`, `sconres`, `hres`, `sres`. The API rejects uppercase.
- The current Congress is the 119th (started Jan 2025). Default to `congress=119` unless the user asks otherwise.
- CRS summaries are written for staff and are usually too dense for the dashboard. Use them as input to the LLM, not as the displayed summary.
- Bill text comes back as a list of versions (Introduced, Engrossed, Enrolled, etc). Use the most recent version's `formattedText` URL, fetched separately.
- List endpoints return at most 250 items per page. Paginate with `offset` and `limit`.

## Database schema

SQLite/libSQL. Keep it flat and simple. Don't over-normalize.

```sql
CREATE TABLE bills (
  id TEXT PRIMARY KEY,              -- e.g. "119-hr-1234"
  congress INTEGER NOT NULL,
  bill_type TEXT NOT NULL,
  bill_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  introduced_date TEXT,             -- ISO date
  latest_action_date TEXT,
  latest_action_text TEXT,
  sponsor_name TEXT,
  sponsor_party TEXT,
  sponsor_state TEXT,
  update_date TEXT NOT NULL,        -- updateDateIncludingText from API
  raw_json TEXT NOT NULL,           -- full API response, for debugging
  summary TEXT,                     -- LLM output
  summary_model TEXT,               -- which model produced it
  summary_updated_at TEXT,          -- when summary was generated
  topics TEXT,                      -- JSON array of topic tags from LLM
  stage TEXT                        -- introduced | committee | floor | other_chamber | president | enacted
);

CREATE INDEX idx_bills_update_date ON bills(update_date DESC);
CREATE INDEX idx_bills_latest_action ON bills(latest_action_date DESC);

CREATE TABLE watchlist (
  bill_id TEXT PRIMARY KEY REFERENCES bills(id),
  added_at TEXT NOT NULL,
  notes TEXT
);
```

Skip cosponsors, committees, and full action history for now. Add tables for those only when the UI needs them.

## Sync logic

The sync runs incrementally. Don't re-fetch bills that haven't changed.

1. Read `MAX(update_date)` from the `bills` table. If empty, default to 7 days ago.
2. Call `/bill?fromDateTime={maxUpdate}&sort=updateDate+desc` and paginate.
3. For each bill, compare `updateDateIncludingText` against what's stored. If new or changed, fetch full detail.
4. Upsert into `bills`. If `updateDateIncludingText` changed, clear `summary` so it gets re-summarized.
5. Find rows where `summary IS NULL`. For each, fetch latest text version, call the LLM, write summary.

Run via `pnpm tsx scripts/sync.ts` locally. In production, wired to a Vercel Cron route at `/api/sync` running once daily at 09:00 UTC (Vercel Hobby tier caps cron frequency to once-per-day; the summarize step is sliced to 50 bills per run).

## Summarization prompt

Keep summaries 2-3 sentences. Plain English. Neutral. Focus on what the bill *does*, not what it's titled. The CRS summary is a useful input but should not be copied.

Prompt template:

```
You are summarizing a US Congress bill for a personal tracking dashboard. Write a 2-3 sentence summary in plain English that explains what the bill would actually change if enacted. Avoid legalese, avoid the bill's marketing title, avoid editorial language. State who is affected and how.

Then output a JSON block with:
- topics: array of 1-3 topic tags from this list: [healthcare, immigration, taxes, defense, energy, environment, education, labor, technology, civil_rights, criminal_justice, agriculture, trade, housing, transportation, foreign_policy, veterans, elections, budget, financial_services, government_operations, consumer_protection, social_security, other]
- stage: one of [introduced, committee, floor, other_chamber, president, enacted]

Bill title: {title}
Latest action: {latest_action_text}
CRS summary (if any): {crs_summary}
Bill text (truncated): {bill_text_first_8000_chars}

Respond in this exact format:

SUMMARY:
<2-3 sentences>

JSON:
{"topics": [...], "stage": "..."}
```

Parse the response by splitting on `JSON:` and parsing the second half. If parsing fails, log the bill ID and skip it; don't crash the sync.

The prompt will need iteration. Expect to revise it 5-10 times. Common failure modes: LLM repeats the bill's marketing title, LLM editorializes, LLM picks `other` for the topic when a better tag exists. Test against a sample of 20 known bills and read the outputs side by side.

## Frontend design system

Bloomberg Terminal aesthetic. Dark monospace, dense rows, color-coded stages and topics. No light mode. Tailwind v4 only (no shadcn / no other libraries). Server components by default; the only client islands are `WatchlistToggle` and `StageFilter`.

### Pages

- `/` — feed of the 50 most recent bills, filterable by topic + stage
- `/bill/[id]` — detail page (card panel layout)
- `/watchlist` — bills flagged via `★ Watch`

All three share the same `HeaderBar` (count + last-updated MT) and `FooterLegend` (party + stage legend).

### Color palette (CSS vars on `:root` in `app/globals.css`)

```css
--bg-base: #0a0e14;            --bg-panel: #050709;
--bg-row-hover: #0f1620;       --border-strong: #1f2937;
--border-soft: #111820;
--text-primary: #e5e7eb;       --text-secondary: #cbd5e1;
--text-muted: #94a3b8;         --text-dim: #6b7280;
--accent-amber: #d97706;       --accent-amber-bright: #fbbf24;
--party-republican: #ef4444;   --party-democrat: #3b82f6;
--party-independent: #a78bfa;
--stage-introduced: #94a3b8;   --stage-committee: #06b6d4;
--stage-floor: #fbbf24;        --stage-other-chamber: #f59e0b;
--stage-president: #fb923c;    --stage-enacted: #10b981;
```

### Stage indicators (arrow glyph + colored uppercase label)

`▸ INTRO`, `▸ COMMITTEE`, `▸▸ FLOOR`, `▸▸▸ OTHER CHAMBER`, `▸▸▸▸ PRESIDENT`, `✓ ENACTED`. Mobile abbreviates: `INTRO / COMM / FLR / OCHM / PRES / ENCT`. See `components/StageIndicator.tsx`.

### Topic colors + abbreviations (`lib/topic-colors.ts`)

20 enum values map to **6 color groups** + a catchall:

| Group | Color | Topics |
|---|---|---|
| Financial / commerce | `#a78bfa` purple | financial_services, taxes, budget, trade, consumer_protection |
| Tech | `#22d3ee` cyan | technology |
| Defense / foreign | `#34d399` teal | defense, foreign_policy, veterans |
| Environment / energy / agriculture | `#65a30d` green | environment, energy, agriculture |
| Social / labor | `#f472b6` pink | healthcare, education, labor, housing, social_security |
| Justice / civil | `#fb7185` red-pink | civil_rights, criminal_justice, immigration, elections |
| Infrastructure / ops | `#f59e0b` amber | transportation, government_operations |
| Catchall | `#6b7280` dim | other |

Display as 3-5-letter abbreviations (`FIN`, `HLTH`, `DEF`, `ENV`, `CRIM`, `GOV`, …) joined by ` · ` between siblings. Multiple topics on the same bill share rendering: full list desktop, first + `+N` on mobile.

### Typography

- `var(--font-mono)` (`ui-monospace, JetBrains Mono, …`) on `body` — applies to the whole app.
- 10px for labels and badges; 11px for dim text and dates; 12px for body and bill titles in lists; 13–14px for the most prominent IDs and titles on the detail page.
- Letter-spacing `0.5px` on uppercase labels. Sentence case for prose.

### Layout grid

Six-column row, `24px 70px 1fr 130px 80px 130px` for `[expand-arrow] [bill-id] [title-and-sponsor] [stage] [action-date] [topics]`. Defined as `.feed-row` in `globals.css`. Header row uses the same grid via `.feed-header-row`.

Below 700px (`@media (max-width: 700px)`):
- Date column hidden (`.col-date`)
- Stage label switches to short form (`.show-mobile` / `.show-desktop`)
- Topics show first + `+N`
- Filter chips wrap

### Inline expand on the feed

URL-driven via `?expanded=<bill-id>`. Click anywhere on a row → toggle expansion (only one open at a time). Server renders the expanded `<ExpandedPanel>` as a sibling to the row, not nested inside the `<Link>`. Panel has a left border in `--accent-amber`, indented to align under the title column on desktop, and contains: introduced + last-action fields, full summary, then `[★ WATCH] [VIEW DETAIL ↗] [CONGRESS.GOV ↗]` buttons.

### Server / client split

- All pages are server components and query Turso via `lib/queries.ts`.
- Client islands: `components/WatchlistToggle.tsx` (POSTs to `/api/watchlist`, then `router.refresh()`) and `components/StageFilter.tsx` (calls `router.push` to update the URL with the chosen stage).
- The watchlist toggle is the only POST: `/api/watchlist` with `{billId, action: "add" | "remove"}`.

### Date formatting (`lib/format.ts`)

- `formatDateShort(iso)` → `MM-DD-YY` for the feed list.
- `formatDateLong(iso)` → `YYYY-MM-DD` for the detail page and the expanded panel.
- `formatLastUpdated(iso)` → `HH:MM MT` (America/Denver) for the header bar.
- No date-fns or dayjs.

## Environment variables

```
CONGRESS_API_KEY=         # api.data.gov key
GEMINI_API_KEY=           # Google AI Studio key (free tier covers personal use)
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
CRON_SECRET=              # used to authenticate Vercel Cron hits to /api/sync
```

The cron route should reject requests where `Authorization` header doesn't match `Bearer ${CRON_SECRET}`.

## What not to do

- Don't add user accounts or auth. This is single-user.
- Don't build a full-text search yet. The feed plus topic filters cover the use case.
- Don't fetch bills live from the browser. Everything reads from Turso.
- Don't store the LLM prompt in the database. Keep it in source so it's versioned with the code.
- Don't summarize every bill in Congress. Summarize on demand: a bill gets a summary the first time it appears in the feed query window with a topic match.
