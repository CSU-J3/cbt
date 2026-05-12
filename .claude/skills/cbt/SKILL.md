---
name: cbt
description: Use this skill when working on CBT (Congress Bill Terminal), the personal Congress bill tracking dashboard. Triggers on any work touching the Congress.gov API sync pipeline, LLM bill summarization, the Next.js dashboard frontend, the Turso database schema, or Vercel Cron jobs for this project. Covers the stack (Next.js 15 App Router + TypeScript + Tailwind + Turso + Google GenAI SDK), the build order (sync script first, UI second), Congress.gov API quirks, and the summarization prompt conventions.
---

# CBT — Congress Bill Terminal

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

- `/bill/{currentCongress}?fromDateTime=...&sort=updateDate+desc` — list bills updated in a window for the current Congress
- `/bill/{congress}/{billType}/{billNumber}` — full bill detail
- `/bill/{congress}/{billType}/{billNumber}/actions` — action history
- `/bill/{congress}/{billType}/{billNumber}/text` — list of text versions, each with formats
- `/bill/{congress}/{billType}/{billNumber}/summaries` — CRS summaries when available

### Gotchas

- `updateDate` and `updateDateIncludingText` are different fields. Use `updateDateIncludingText` for sync detection so text changes trigger re-summarization.
- `billType` values are lowercase: `hr`, `s`, `hjres`, `sjres`, `hconres`, `sconres`, `hres`, `sres`. The API rejects uppercase.
- The current Congress is derived from `lib/congress.ts` — `getCurrentCongress(date = new Date())` returns the right number. The list-endpoint URL in `lib/sync.ts` uses it (`/bill/${getCurrentCongress()}`); don't reintroduce a hardcoded `119`. Modern Congresses run two years starting Jan 3 of odd years (119th: 2025–2027, 120th: 2027–2029, etc.); the cron tick at 09:00 UTC means rollover happens within ~24h of Jan 3.
- CRS summaries are written for staff and are usually too dense for the dashboard. Use them as input to the LLM, not as the displayed summary.
- Bill text comes back as a list of versions (Introduced, Engrossed, Enrolled, etc). Use the most recent version's `formattedText` URL, fetched separately.
- List endpoints return at most 250 items per page. Paginate with `offset` and `limit`.
- Congress rollover tradeoff: the list endpoint is scoped to the current Congress, so when `getCurrentCongress()` flips on Jan 3 of an odd year, late updates on previous-Congress bills (delayed enactment signatures, lame-duck votes, etc.) stop being picked up. Bills already in the DB stay; they just freeze. Acceptable for a personal dashboard — not worth running parallel historical syncs.

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
  stage TEXT,                       -- introduced | committee | floor | other_chamber | president | enacted
  previous_stage TEXT,              -- prior stage value, written when stage transitions
  stage_changed_at TEXT             -- ISO timestamp of the most recent stage change
);

CREATE INDEX idx_bills_update_date ON bills(update_date DESC);
CREATE INDEX idx_bills_latest_action ON bills(latest_action_date DESC);
CREATE INDEX idx_bills_stage_changed_at ON bills(stage_changed_at DESC);

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
5. Find rows where `summary IS NULL`. For each, fetch latest text version, call the LLM, write summary. If the prior `stage` was non-null and differs from the new LLM-classified stage, also write `previous_stage` (= prior stage) and `stage_changed_at` (= now). The sync upsert preserves `stage` across re-classifications so this comparison stays meaningful; only `summary`, `topics`, etc. get nulled when `update_date` changes.

Run via `pnpm tsx scripts/sync.ts` locally. In production, wired to a Vercel Cron route at `/api/sync` running once daily at 09:00 UTC (Vercel Hobby tier caps cron frequency to once-per-day; the summarize step is sliced to 50 bills per run).

### Query helpers (`lib/queries.ts`)

- `getFeedBills(filters, {page, pageSize})` — main feed; returns `{ bills, total, page, pageSize, totalPages }`. `total` is the filtered count. The page passes `total` into `HeaderBar` via `feedFilteredCount` so the header doesn't need a second COUNT query. The unfiltered count for the "X of Y" header line comes from `getFeedStats().total`.
- `getStaleBills(filters, limit)` / `getStaleCount(filters)` — `/stale` page. Compose `buildStaleWhere` on top of the shared `buildFeedWhere`; the stale criteria (`latest_action_date IS NOT NULL`, `< date('now', '-60 days')`, `stage IN (introduced, committee, floor, other_chamber, other)`) are added to whatever the user filtered by. `total` is the count of all stale bills; `filtered` adds stage/topics/q. Sorted by `latest_action_date ASC`.
- `getPresidentBills(filters, limit)` / `getPresidentCount(filters)` — `/president` page. Compose `buildPresidentWhere` on top of `buildFeedWhere`, but strip `filters.stage` first (stage is fixed by the helper). Adds `stage = 'president'` and `latest_action_date IS NOT NULL`. Sorted by `latest_action_date ASC` (oldest at desk first — closest to the 10-day veto deadline). Same `{total, filtered}` contract as the others.
- `getSponsors(filters, limit)` / `getSponsorCount(filters)` — `/sponsors` page. `SponsorFilters` is `{ party?: 'R'|'D'|'I', state?, q? }`; `q` matches `sponsor_name LIKE`, not bill text. Aggregates `bills` by `(sponsor_name, sponsor_party, sponsor_state)` with `COUNT(*)` and `MAX(latest_action_date)`. Inherits `summary IS NOT NULL` from the same convention `buildFeedWhere` uses, so unsummarized bills don't pad sponsor counts. `party='I'` matches any non-R, non-D variant (`UPPER(sponsor_party) NOT IN ('R','D')`) — Bernie Sanders' `ID`, hypothetical `IND`, etc. `getSponsorCount` wraps the GROUP BY in a subquery to count distinct sponsor groups.
- `getSponsorStates()` — distinct non-null `sponsor_state` values (alphabetical) for the State dropdown.
- `getSponsorRecentBills(name, limit=5)` — newest bills for a sponsor, used by the inline expand panel.
- `normalizePartyVariant(party)` — collapses any sponsor party string to `'R' | 'D' | 'I' | null`. Use this both for filtering and for badge rendering so `R`, `D`, and everything-else-non-null map to the three party colors.
- `sanitizeStaleStage(input)` — accepts only the four dropdown-eligible stages so a hand-typed `?stage=enacted` is silently ignored on `/stale`.
- `sanitizeSort(input)` — accepts `'action' | 'introduced'`, falls back to `'action'` on anything else.

### Feed sort (`?sort=action|introduced`)

Applies to `/` and `/watchlist` only. Two keys, default `action`:

- `action`: `ORDER BY latest_action_date DESC NULLS LAST, id DESC`
- `introduced`: `ORDER BY introduced_date DESC NULLS LAST, id DESC`

`SortDropdown` is a client component that mirrors `StageFilter`. It deletes `expanded` and (for the default) `sort` from the URL on change, preserves everything else. The visible Action column always shows `latest_action_date` regardless of sort key — the sort axis isn't what's displayed.

Do **not** add the dropdown to `/stale` (forced ASC by definition), `/president` (3 rows, sorted by desk arrival), or `/sponsors` (sorted by `bill_count`, different axis).

`FeedFilters` includes an optional `sponsor?: string`. When set, `buildFeedWhere` ANDs `sponsor_name = ?` so `/?sponsor=<encoded name>` filters the main feed. The HeaderBar count line shows `· sponsored by <name>` in `--accent-amber` when active. All other feed filters (stage, topics, q) compose with it via the same plumbing — and the `StageFilter`, `TopicFilter`, `BillRow` components all thread `sponsor` through their generated hrefs, same way they thread `q`.

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

- `/` — feed of the 50 most recent bills, filterable by topic + stage, searchable via `?q=`
- `/bill/[id]` — detail page (card panel layout)
- `/watchlist` — bills flagged via `★ Watch`
- `/stale` — bills with no action in 60+ days, sorted oldest-action-first. Same filter chrome as the feed. Stage filter is constrained to the four eligible stages (`introduced`, `committee`, `floor`, `other_chamber`) — `president` and `enacted` never appear (success states aren't stalls). Action column renders days-since (`247d`) instead of a date, color-coded by threshold.
- `/president` — bills with `stage='president'`, sorted oldest action first (closest to the 10-day veto deadline). Counterpart to `/stale`: what's queued for signature/veto, not what's been abandoned. No `StageFilter` (stage is fixed). Topic + search filters only. `?stage=*` is silently dropped. Action column renders days-on-desk with the desk-time threshold table. Header chrome: `BILLS AT DESK`. Empty state: single muted line, no chrome.
- `/changes` — bills whose stage moved in the last 7 days, sorted by `stage_changed_at DESC`. The "in motion" view between `/stale` and `/president`. No stage filter (the page is about transitions, not destinations). Topic + search + chamber filters only. The stage column renders the transition (`▸ INTRO → ▸▸ COMMITTEE`) with the prior stage dimmed via the `muted` prop on `StageIndicator`; the action-date column shows `Xd ago` from `stage_changed_at`. Wider stage column comes from the `.changes-feed` wrapper class, not a `BillRow` template change. `BillRow` opts in via `showStageTransition`. Empty state: `No stage changes in the last 7 days.`
- `/sponsors` — distinct sponsors aggregated from `bills`, sorted by `bill_count DESC, sponsor_name ASC`. Filters: party (R/D/I), state (only states present in the data), name search. Click a row to inline-expand: 5 most recent bills + a `[VIEW ALL N BILLS →]` link to `/?sponsor=<encoded name>`. Custom `SponsorRow` grid (`24px 1fr 40px 50px 80px 110px`) — does not reuse `BillRow`. Routing slug is the URL-encoded `sponsor_name` itself; we don't store `bioguide_id`, so two reps with identical names from the same state and party would collide (no detail page to break, just an expand collision). Add `sponsor_bioguide_id` only if a real collision shows up.

All three share the same `HeaderBar` (count + last-updated MT) and `FooterLegend` (party + stage legend). The feed page passes `feedFilters` to `HeaderBar`, which swaps in a `<SearchBox />` (centered) and a filtered count display (`47 OF 1,643 BILLS · "fentanyl"` with the numerator in `--accent-amber`).

### Search

URL state: `?q=<query>` on `/`. Combines with `?stage=` and `?topics=` via AND.

- `components/SearchBox.tsx` is the only client island for search. 250 ms debounce, then `router.push` updates the URL (preserving existing params, dropping `expanded`). Initial value comes from `useSearchParams().get("q")`. The `×` clear button calls `setValue("")` which triggers the same effect.
- `lib/queries.ts` accepts `q?: string` in `FeedFilters`. WHERE is built additively in `buildFeedWhere` and shared between `getFeedBills` and `getFeedCount`. Search clause OR's `LOWER(id|title|sponsor_name|summary) LIKE ?` plus a normalized bill-id match `REPLACE(LOWER(id), '-', '') LIKE ?`.
- Bill ID normalization: query and id are both lowercased and stripped of spaces/dashes before comparison, so `HR 2702`, `hr2702`, `hr-2702`, `2702`, and `119hr2702` all match `119-hr-2702`.
- Empty results render a centered `NO BILLS MATCH "<q>"` block plus a `[Clear search]` link that preserves stage+topics.
- `StageFilter`, `TopicFilter`, and `BillRow` thread `q` through their generated hrefs so search is preserved when users change filters or expand a row.

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
- Size tiers (post handoff 20 readability bump; previous values shown in parentheses):
  - **12px** (was 10px) — column headers, badges, stage indicators, topic tags, footer legend, dropdown labels, button text, filter chip labels.
  - **13px** (was 11px) — dates, search input, brand mark, dim secondary text, count line auxiliaries.
  - **14px** (was 12px) — body content: bill IDs/titles in rows, sponsor names, expanded summaries (`text-sm leading-relaxed`).
  - **15px** (was 13px) — bill detail page subtitle (`<h1>` text under the bill ID).
  - **16px** (was 14px) — bill detail page bill ID, the most prominent number on the page.
- Letter-spacing `0.5px` on uppercase labels. Sentence case for prose.
- When you bump a tier, also bump the `.feed-row`/`.sponsor-row` fixed column widths in `globals.css` to keep stage labels and dates from overflowing — the current widths are sized for the tiers above. Don't reuse the old values.

### Layout grid

Layout is **full-width fluid** — no `max-w-*` cap on the outer container. Pages, `HeaderBar`, and `FooterLegend` all stretch to the viewport with `w-full` and a small `px-4` gutter. The `1fr` title column inside `BillRow` and `SponsorRow` absorbs the extra width on wide displays. If a future page feels too sparse at 2400px+, the right fix is to add `max-w-[1200px]` to the offending column (e.g. the bill summary paragraph), not to re-cap the outer container.

Six-column row, `24px 86px 1fr 150px 96px 150px` for `[expand-arrow] [bill-id] [title-and-sponsor] [stage] [action-date] [topics]`. Defined as `.feed-row` in `globals.css`. Header row uses the same grid via `.feed-header-row`.

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
- `daysSince(iso)` → integer days from the date to today (UTC). Used by the `/stale` page's days-since column.
- No date-fns or dayjs.

### Days-since column (`/stale`, `/president`)

`BillRow` accepts `daysSinceMode?: 'staleness' | 'desk-time'`. Undefined keeps the default `MM-DD-YY` action-date rendering. Either mode swaps the cell to a right-aligned `247d` figure in `tabular-nums`, with a mode-specific color threshold table:

| Mode | Used by | Thresholds |
|---|---|---|
| `staleness` | `/stale` | `<180d` → `--text-secondary`, `180–364d` → `--accent-amber`, `≥365d` → `--party-republican` |
| `desk-time` | `/president` | `<5d` → `--text-secondary`, `5–9d` → `--accent-amber`, `≥10d` → `--party-republican` (overdue or misclassified) |

Same color vocabulary across both, different boundaries (60-day stalls vs. the 10-day constitutional clock). No named tier labels in text — color carries the signal.

### `basePath` threading

`StageFilter`, `TopicFilter`, `BillRow`, and `SearchBox` all accept an optional `basePath?: string` prop (default `/`) so they can be reused on `/stale` (or any future feed-shaped route). The home page passes `/` (or omits), `/stale` passes `/stale`. `StageFilter` also accepts `availableStages?: readonly Stage[]` so `/stale` can hide `president` and `enacted` from the dropdown.

## Environment variables

```
CONGRESS_API_KEY=         # api.data.gov key
GEMINI_API_KEY=           # Google AI Studio key (free tier covers personal use)
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
CRON_SECRET=              # used to authenticate Vercel Cron hits to /api/sync
```

The cron route should reject requests where `Authorization` header doesn't match `Bearer ${CRON_SECRET}`.

## Things to watch for

- **Route-level `revalidate` does nothing in Next.js 15 for any page using `await searchParams` or `await params`.** Those async dynamic APIs opt the route into fully dynamic rendering, which disables the Full Route Cache regardless of the `revalidate` export. Confirmed in production: every response sent `Cache-Control: private, no-cache, no-store` and `X-Vercel-Cache: MISS`. Cache at the query layer with `unstable_cache` + `revalidateTag` instead — that's how `getFeedStats` and `getFeedBills` actually stay cached across requests. The sync cron calls `revalidateTag("feed-stats")` and `revalidateTag("feed-bills")` after writes to invalidate on fresh data.

## What not to do

- Don't add user accounts or auth. This is single-user.
- Don't fetch bills live from the browser. Everything reads from Turso.
- Don't store the LLM prompt in the database. Keep it in source so it's versioned with the code.
- Don't summarize every bill in Congress. Summarize on demand: a bill gets a summary the first time it appears in the feed query window with a topic match.
