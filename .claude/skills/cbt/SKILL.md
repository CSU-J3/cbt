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
- `/bill/{congress}/{billType}/{billNumber}/committees` — committees referred + activities; bill→committees direction (HO 143; the committee→bills direction can't filter by Congress, so this is the right way to feed `committee_bills`)
- `/committee/{congress}` — paginated list of all committees + subcommittees in a Congress (HO 143)
- `/committee/{chamber}/{systemCode}` — committee detail. **The path uses `{chamber}` not `{congress}`** — `/committee/119/<systemCode>` returns "Unknown resource".

### External data sources

Not every signal in CBT comes from Congress.gov. The non-Congress.gov sources currently in use:

- **Stooq** (`https://stooq.com/q/l/`) — markets ticker (HO 142): SPX, WTI, DXY. Public CSV endpoint, no auth, 15-20 min delayed.
- **FRED** (`https://fred.stlouisfed.org/graph/fredgraph.csv`) — 10Y Treasury yield (HO 142, series `DGS10`). End-of-day only, no auth.
- **unitedstates/congress-legislators** (`https://raw.githubusercontent.com/unitedstates/congress-legislators/main/`) — `committee-membership-current.yaml` for committee rosters (HO 143; Congress.gov has no roster endpoint), and historically the canonical free source for member data. Public GitHub raw, no auth.
- **Ballotpedia** scraping — primaries (HO 91-96, 120) and race ratings (HO 71).
- **House Clerk + Senate eFD** (planned) — STOCK Act PTR disclosures (HO 70 placeholder; backlog).
- **CBOE/Yahoo** (not currently in use) — would supply VIX once a stable free source emerges (backlog).
- **RSS** (HO 64/75/86/102/103/104/111) — news ingestion from configured feeds; matchers in `lib/news-ingest.ts`.

THOMAS-style committee codes (used in the unitedstates YAML) map to Congress.gov `systemCode` by lowercasing and padding 4-char codes with `00`: `SSAF` → `ssaf00`, `SSAF13` → `ssaf13`. Verified against Congress.gov detail responses during HO 143 pre-flight.

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
  stage_changed_at TEXT,            -- ISO timestamp of the most recent stage change
  is_ceremonial INTEGER,            -- tri-state: NULL unclassified, 0 substantive, 1 ceremonial
  cluster_id TEXT,                  -- regex-matched template slug; NULL = no template fit
  cosponsor_count INTEGER,          -- bill.cosponsors.count from API; NULL = not yet populated, 0 = no cosponsors
  text_length INTEGER,              -- pre-truncation length of fetched bill text; NULL = no text or fetch failed, 0 = checked, empty
  summarize_failed_at TEXT,         -- HO 115: ISO timestamp of last summarize failure; NULL = no failure on record. Selector in lib/summarize-runner.ts skips bills with this <24h old.
  summarize_attempts INTEGER NOT NULL DEFAULT 0  -- HO 115: cumulative failures. Resets to 0 on success or on a re-sync that changes update_date. Bills crossing 3 surface to cron_runs.error_message.
);

CREATE INDEX idx_bills_update_date ON bills(update_date DESC);
CREATE INDEX idx_bills_latest_action ON bills(latest_action_date DESC);
CREATE INDEX idx_bills_stage_changed_at ON bills(stage_changed_at DESC);
CREATE INDEX idx_bills_is_ceremonial ON bills(is_ceremonial);
CREATE INDEX idx_bills_cluster_id ON bills(cluster_id);

CREATE TABLE watchlist (
  bill_id TEXT PRIMARY KEY REFERENCES bills(id),
  added_at TEXT NOT NULL,
  notes TEXT
);

-- Key-value store for cron-generated dashboard content. Flexible so future
-- dashboard state needs no further migration. Currently holds the one row
-- key = 'weekly_lead' (the LLM-generated dashboard lead).
CREATE TABLE dashboard_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Weekly cron-generated reports. One row per calendar week (Mon-Sun),
-- keyed by the ISO week-start date (slug). content_md is the rendered
-- Markdown body. created_at is JS-side ISO.
CREATE TABLE reports (
  slug TEXT PRIMARY KEY,         -- ISO week-start date, e.g. "2026-05-11"
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  title TEXT NOT NULL,           -- "Week of May 11, 2026"
  content_md TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_reports_week_start ON reports(week_start DESC);

-- Member bios. One row per Congress.gov member, refreshed from the 119th
-- roster by `npm run sync:members`. Backs /members/[bioguideId].
CREATE TABLE members (
  bioguide_id TEXT PRIMARY KEY,        -- e.g. "S000033"
  name TEXT NOT NULL,                  -- directOrderName from API
  first_name TEXT,
  last_name TEXT,
  party TEXT,                          -- normalized 'R' | 'D' | 'I'
  state TEXT,                          -- two-letter (matches bills.sponsor_state)
  state_name TEXT,                     -- "California"
  district INTEGER,                    -- House only, NULL for Senate
  chamber TEXT,                        -- 'house' | 'senate'
  birth_year INTEGER,
  depiction_url TEXT,                  -- official photo URL
  current_term_end_year INTEGER,       -- derived: startYear + 2 (House) or +6 (Senate)
  next_election_year INTEGER,          -- derived: current_term_end_year - 1
  terms_json TEXT,                     -- raw terms array, for future use
  raw_json TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1, -- 1 = currently serving; 0 = died/resigned/left, row kept (HO 94)
  fetched_at TEXT NOT NULL
);

CREATE INDEX idx_members_state ON members(state);
CREATE INDEX idx_members_next_election ON members(next_election_year);

-- Hand-curated caucus / advocacy affiliations (handoff 61). One row per
-- (bioguide_id, org). FK to members.bioguide_id. category is 'caucus' in
-- v1; reserved for 'union' / 'advocacy' in later theme-6 sub-handoffs.
CREATE TABLE affiliations (
  bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
  org TEXT NOT NULL,                -- stable slug; display labels live in lib/caucus-config.ts
  category TEXT NOT NULL,           -- 'caucus' only in v1
  source_url TEXT,
  last_verified TEXT NOT NULL,      -- ISO date
  PRIMARY KEY (bioguide_id, org)
);

CREATE INDEX idx_affiliations_org ON affiliations(org);
CREATE INDEX idx_affiliations_bioguide ON affiliations(bioguide_id);

-- Race surface (handoff 62). One row per (state, district, cycle) for the
-- House and per (state, cycle) for the Senate. Stubs are auto-derived from
-- members via `npm run backfill:races`; rating + roster are hand-curated
-- via `npm run seed:races`. id format = raceIdFromMember (lib/race-id.ts):
-- "CO-08-2026" (House, zero-padded) | "S-CO-2026" (Senate).
CREATE TABLE races (
  id TEXT PRIMARY KEY,
  cycle INTEGER NOT NULL,
  chamber TEXT NOT NULL,
  state TEXT NOT NULL,
  district INTEGER,                          -- null for Senate
  rating TEXT,                               -- safe_r | likely_r | lean_r | tossup | lean_d | likely_d | safe_d
  rating_source TEXT,
  rating_updated_at TEXT,                    -- ISO date
  incumbent_bioguide_id TEXT REFERENCES members(bioguide_id),
  source_url TEXT,
  last_verified TEXT NOT NULL
);

CREATE INDEX idx_races_cycle ON races(cycle);
CREATE INDEX idx_races_state ON races(state);
CREATE INDEX idx_races_chamber ON races(chamber);
CREATE INDEX idx_races_incumbent ON races(incumbent_bioguide_id);
CREATE INDEX idx_races_rating ON races(rating);

CREATE TABLE race_candidates (
  race_id TEXT NOT NULL REFERENCES races(id),
  name TEXT NOT NULL,
  party TEXT,                                -- 'R' | 'D' | 'I' | nullable
  bioguide_id TEXT REFERENCES members(bioguide_id),
  status TEXT,                               -- 'declared' | 'running' | 'won_primary' | 'withdrew'
  source_url TEXT,
  PRIMARY KEY (race_id, name)
);

CREATE INDEX idx_race_candidates_race ON race_candidates(race_id);
CREATE INDEX idx_race_candidates_bioguide ON race_candidates(bioguide_id);

-- Race ratings (handoff 71). Third-party forecaster ratings layered onto
-- the race surface — Cook in v1; Sabato and Inside Elections layer in
-- later as additional rows under the same schema. Composite id =
-- `race_id-source` makes re-seeding upsert in place. race_id is a loose
-- link to races.id (no FK constraint) so ratings can sit ahead of race
-- rows existing. rating_score is a -3..+3 numeric proxy for competitive-
-- ness sorting without parsing strings; |rating_score| <= 1 is the
-- "competitive" filter. Seeded by `npm run seed:ratings` from
-- data/race-ratings-cook-2026.json; refresh quarterly.
CREATE TABLE race_ratings (
  id TEXT PRIMARY KEY,                       -- race_id + '-' + source
  race_id TEXT NOT NULL,
  source TEXT NOT NULL,                      -- 'cook' | 'sabato' | 'inside_elections'
  rating TEXT NOT NULL,                      -- 'Solid D' .. 'Solid R'
  rating_score INTEGER NOT NULL,             -- -3 .. +3 (D negative, R positive)
  rating_date TEXT,                          -- ISO date from the forecaster
  source_url TEXT,
  cycle INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_ratings_race ON race_ratings(race_id);
CREATE INDEX idx_ratings_score ON race_ratings(rating_score);

-- News signal (handoff 64). One row per (bill_id, article_url) — UNIQUE
-- makes re-ingestion idempotent. A single article citing multiple bills
-- generates one row per pair. v1 uses regex-only matching
-- (matched_via='bill_id_regex', match_confidence NULL); fuzzy / LLM
-- layers in handoff 65+ will populate confidence 0-1.
CREATE TABLE news_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id TEXT NOT NULL REFERENCES bills(id),
  source TEXT NOT NULL,                    -- 'politico' | 'the_hill' | 'roll_call'
  article_url TEXT NOT NULL,
  article_title TEXT NOT NULL,
  article_summary TEXT,
  published_at TEXT NOT NULL,              -- ISO datetime from RSS
  matched_via TEXT NOT NULL,               -- 'bill_id_regex' in v1
  match_confidence REAL,                   -- NULL for regex (deterministic)
  ingested_at TEXT NOT NULL,
  UNIQUE(bill_id, article_url)
);

CREATE INDEX idx_news_mentions_bill ON news_mentions(bill_id);
CREATE INDEX idx_news_mentions_published ON news_mentions(published_at DESC);
CREATE INDEX idx_news_mentions_source ON news_mentions(source);

-- Stock trade disclosures (handoff 70). Source: Financial Modeling Prep
-- (FMP) free tier. Composite `id` because FMP doesn't return a stable
-- filing id (bioguide-disclosure_date-ticker-transaction_date-amount).
-- `bioguide_id` nullable so unmatched FMP names still land — the matcher
-- is best-effort; audit unmatched rows with
-- `SELECT * FROM stock_trades WHERE bioguide_id IS NULL`. Amounts kept as
-- raw filing strings (`"$1,001 - $15,000"`) — no min/max parse in v1.
CREATE TABLE stock_trades (
  id TEXT PRIMARY KEY,
  bioguide_id TEXT REFERENCES members(bioguide_id),
  member_name_raw TEXT NOT NULL,
  chamber TEXT NOT NULL,                   -- 'senate' | 'house'
  ticker TEXT,
  asset_description TEXT,
  transaction_type TEXT,                   -- 'Purchase' | 'Sale (Partial)' | etc, raw
  transaction_date TEXT,                   -- ISO date, may be approximate
  disclosure_date TEXT,                    -- ISO date
  amount TEXT,                             -- raw filing bucket string
  owner TEXT,                              -- 'SELF' | 'SPOUSE' | 'JOINT' | etc, raw
  raw_json TEXT NOT NULL,
  ingested_at TEXT NOT NULL
);

CREATE INDEX idx_trades_bioguide ON stock_trades(bioguide_id);
CREATE INDEX idx_trades_disclosure_date ON stock_trades(disclosure_date DESC);

-- Roll-call votes (handoffs 77 + 80). One row per (chamber, congress,
-- session, roll_call). `id` shape is 'house-119-2-1234' / 'senate-119-1-132'
-- — chamber lowercase, no zero-padding on the roll-call segment. `bill_id`
-- FK is NULLed in the sync if the referenced bill hasn't been synced into
-- `bills` yet (vote rows always land regardless); the LEFT JOIN at read
-- time surfaces orphans via raw_json if needed. `amendment_designation`
-- holds the raw legislation reference for non-bill votes ('HAMDT5', 'PN123',
-- treaty 'TD2', etc.) — anything whose type doesn't map to the 8 bill
-- types. yea/nay/present/not_voting counts are summed at ingest so reads
-- don't re-aggregate.
CREATE TABLE votes (
  id TEXT PRIMARY KEY,                       -- e.g. "house-119-2-1234" / "senate-119-1-132"
  chamber TEXT NOT NULL,                     -- 'house' | 'senate' (lowercase, matches bills.bill_type convention)
  congress INTEGER NOT NULL,
  session INTEGER NOT NULL,
  roll_call INTEGER NOT NULL,
  vote_date TEXT NOT NULL,                   -- ISO timestamp
  question TEXT,                             -- e.g. "On Passage" / "On Cloture on the Motion to Proceed"
  description TEXT,                          -- vote_type (house) or vote_title (senate)
  result TEXT,                               -- "Passed" / "Cloture Motion Agreed to" / etc.
  bill_id TEXT REFERENCES bills(id),         -- NULL for amendments, nominations, procedural votes
  amendment_designation TEXT,                -- raw 'HAMDT5' / 'PN123' / etc. when bill_id is NULL
  yea_count INTEGER NOT NULL,
  nay_count INTEGER NOT NULL,
  present_count INTEGER,
  not_voting_count INTEGER,
  raw_json TEXT NOT NULL,                    -- full API/XML payload for the vote
  update_date TEXT NOT NULL
);

CREATE INDEX idx_votes_chamber_date ON votes(chamber, vote_date DESC);
CREATE INDEX idx_votes_bill_id ON votes(bill_id) WHERE bill_id IS NOT NULL;

-- Per-member positions on a vote. bioguide_id is intentionally NOT a FK to
-- `members` — vote rolls include members who haven't been synced yet (or
-- who've since left), and a missing-member row must never block the
-- position insert. Join at query time. `position` is normalized to a
-- lowercase enum at ingest ('yea' | 'nay' | 'present' | 'not_voting');
-- "Aye", "Yes", "No", "Absent" are all folded in by the sync.
CREATE TABLE member_votes (
  vote_id TEXT NOT NULL REFERENCES votes(id),
  bioguide_id TEXT NOT NULL,
  position TEXT NOT NULL,                    -- 'yea' | 'nay' | 'present' | 'not_voting'
  PRIMARY KEY (vote_id, bioguide_id)
);

CREATE INDEX idx_member_votes_bioguide ON member_votes(bioguide_id);

-- Primary tracker (handoff 91; House regions added in 92/93/95/96, Louisiana
-- in 93.5; runoffs in 107). One row per primary OR runoff contest. `id` shape
-- is "senate-{ST}-2026-{party}" or "house-{ST}-{DD}-2026-{party}" — {DD} is
-- the zero-padded district, {party} is 'D' | 'R' | 'open'. The 'open' party
-- value is the single all-candidate ballot for top-two / top-four /
-- nonpartisan contests (CA, WA, AK, LA). `primary_type` is the 270toWin
-- calendar classification. `election_round` (HO 107) discriminates a runoff
-- contest from the round-1 primary — runoff rows take the same id with a
-- `-runoff` suffix; see "Runoff tracking" below.
CREATE TABLE primaries (
  id TEXT PRIMARY KEY,              -- e.g. "house-LA-01-2026-open"
  state TEXT NOT NULL,
  district TEXT,                    -- zero-padded ("07"); NULL for Senate
  chamber TEXT NOT NULL,            -- 'senate' | 'house'
  party TEXT NOT NULL,              -- 'D' | 'R' | 'open'
  primary_date TEXT,                -- ISO date; for a runoff row, the runoff's own date
  runoff_date TEXT,                 -- on a round-1 row, forward link to the runoff date
  primary_type TEXT,                -- 'closed' | 'open' | 'top_two' | 'top_four' | ...
  race_id TEXT REFERENCES races(id),-- loose link to races.id
  election_round TEXT NOT NULL DEFAULT 'primary', -- 'primary' | 'runoff' (HO 107)
  updated_at TEXT NOT NULL
);

-- Per-contest candidate rosters, scraped from Ballotpedia. No natural unique
-- key — the sync does a per-`primary_id` delete-then-insert, so `id` is a
-- throwaway AUTOINCREMENT. `bioguide_id` is a best-effort incumbent match
-- (nullable; most challengers never resolve). `party` is the candidate's own
-- party letter, meaningful even in an 'open' contest. `vote_pct` is populated
-- post-election.
CREATE TABLE primary_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_id TEXT NOT NULL REFERENCES primaries(id),
  name TEXT NOT NULL,
  party TEXT NOT NULL,              -- candidate's own party letter (D/R/L/G/I)
  incumbent INTEGER DEFAULT 0,      -- 0 | 1
  bioguide_id TEXT REFERENCES members(bioguide_id),
  status TEXT DEFAULT 'running',    -- 'running' | 'winner'
  vote_pct REAL,                    -- NULL until results are in
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_primaries_date ON primaries(primary_date);
CREATE INDEX idx_primary_candidates_primary ON primary_candidates(primary_id);

-- Durable cron-run log (handoff 105). One row per cron tick — startCronRun
-- inserts a 'running' row after the route's auth check, finishCronRun closes
-- it out. `elapsed_ms` is computed DB-side from `started_at`. `payload` is
-- the JSON response body. A row stuck at status='running' past ~120s is an
-- implicit timeout (the Vercel runtime killed the function before
-- finishCronRun fired). Exists because Vercel Hobby discards live logs
-- after 30 minutes. Written via lib/cron-log.ts.
CREATE TABLE cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route TEXT NOT NULL,                  -- '/api/cron/primaries' etc.
  started_at TEXT NOT NULL,             -- ISO timestamp
  ended_at TEXT,                        -- ISO, NULL while running
  elapsed_ms INTEGER,                   -- NULL while running
  status TEXT NOT NULL,                 -- 'running' | 'success' | 'error' | 'timeout'
  payload TEXT,                         -- JSON blob: full response body
  error_message TEXT                    -- captured exception string, NULL on success
);

CREATE INDEX idx_cron_runs_route_started ON cron_runs(route, started_at DESC);
CREATE INDEX idx_cron_runs_status ON cron_runs(status);

-- handoff 142: markets ticker. Append-only history of policy-effect
-- indicators refreshed every 30 min during market hours by a GitHub
-- Actions cron (Vercel Hobby caps cron at once daily). `symbol` is the
-- internal stable id; the upstream source + remote ticker live in
-- lib/markets.ts (Stooq for SPX/WTI/DXY, FRED for TNX). VIX is deferred —
-- see docs/backlog.md. ~16k rows/year at the v1 cadence (4 symbols × 13
-- ticks/day × 252 trading days); history retained as charting fuel.
CREATE TABLE market_ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  price REAL NOT NULL,
  change_pct REAL,                      -- NULL on first tick (no prior reference)
  ticked_at TEXT NOT NULL,              -- ISO fetch timestamp (UTC)
  market_date TEXT NOT NULL             -- YYYY-MM-DD of the trading day the price represents
);
CREATE INDEX idx_market_ticks_symbol_time ON market_ticks(symbol, ticked_at DESC);

-- handoff 143: committee surface, Phase 1 data layer. Three tables. The
-- list comes from Congress.gov `/committee/119`; the bills join is built
-- bill→committees direction (`/bill/{congress}/{type}/{number}/committees`)
-- because the committee→bills endpoint won't filter by Congress. Member
-- rosters do not exist on Congress.gov's API — sourced from
-- unitedstates/congress-legislators/committee-membership-current.yaml
-- instead. system_code rule (THOMAS → Congress.gov): lowercase, and
-- pad 4-char codes with '00' (so 'SSAF' → 'ssaf00', 'SSAF13' → 'ssaf13').
CREATE TABLE committees (
  system_code TEXT PRIMARY KEY,           -- 'hsju00' / 'sseg01' etc., lowercase
  name TEXT NOT NULL,
  chamber TEXT NOT NULL,                  -- 'house' | 'senate' | 'joint' (lowercased on insert)
  committee_type TEXT,                    -- 'Standing' | 'Select' | 'Joint' | 'Task Force' ...
  parent_system_code TEXT,                -- non-null for subcommittees
  url TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE committee_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id TEXT NOT NULL,                  -- references bills.id; not FK'd (sync ordering)
  committee_system_code TEXT NOT NULL,
  activity_type TEXT,                     -- 'Referred to' / 'Reported by' / 'Discharged' / ...
  activity_date TEXT,                     -- ISO of the activity
  updated_at TEXT NOT NULL,
  UNIQUE(bill_id, committee_system_code, activity_type, activity_date)
);
CREATE INDEX idx_committee_bills_bill ON committee_bills(bill_id);
CREATE INDEX idx_committee_bills_committee ON committee_bills(committee_system_code);
CREATE INDEX idx_committee_bills_activity ON committee_bills(activity_date DESC);

CREATE TABLE committee_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_system_code TEXT NOT NULL,
  bioguide_id TEXT NOT NULL,
  role TEXT,                              -- 'Chair' / 'Chairman' / 'Ranking Member' / NULL for rank-and-file
  party_side TEXT,                        -- 'majority' | 'minority' from the YAML
  rank INTEGER,                           -- intra-side rank from the YAML
  updated_at TEXT NOT NULL,
  UNIQUE(committee_system_code, bioguide_id)
);
CREATE INDEX idx_committee_members_committee ON committee_members(committee_system_code);
CREATE INDEX idx_committee_members_member ON committee_members(bioguide_id);
```

`bills.sponsor_bioguide_id` (added earlier, indexed `idx_bills_sponsor_bioguide`) joins to `members.bioguide_id`. The two `sponsor_*` text columns on `bills` are kept as a denormalized fallback for sponsors that don't (yet) have a member row.

Skip full action history for now. Add a table for it only when the UI needs it.

## Sync logic

The sync runs incrementally. Don't re-fetch bills that haven't changed.

1. Read `MAX(update_date)` from the `bills` table. If empty, default to 7 days ago.
2. Call `/bill?fromDateTime={maxUpdate}&sort=updateDate+desc` and paginate.
3. For each bill, compare `updateDateIncludingText` against what's stored. If new or changed, fetch full detail.
4. Upsert into `bills`. If `updateDateIncludingText` changed, clear `summary` so it gets re-summarized. `cosponsor_count` is also captured from `bill.cosponsors.count` on every upsert and is intentionally NOT nulled across re-syncs — counts are fresh from every detail fetch, so re-nulling would create unnecessary backfill churn. `sponsor_bioguide_id` is captured from `sponsors[0].bioguideId` and refreshed on every upsert (cost of re-writing identical values is zero; bioguide_id never actually changes for a bill).
5. Find rows where `summary IS NULL`. For each, fetch latest text version, call the LLM, write summary. The pre-truncation length of the fetched text is also captured into `text_length` on the same UPDATE — NULL when no text version is available or the fetch failed (so the text-length backfill can retry), distinguishable from 0 (checked, empty). If the prior `stage` was non-null and differs from the new LLM-classified stage, also write `previous_stage` (= prior stage) and `stage_changed_at` (= now). The sync upsert preserves `stage` across re-classifications so this comparison stays meaningful; only `summary`, `topics`, etc. get nulled when `update_date` changes.

Run via `pnpm tsx scripts/sync.ts` locally. In production, wired to a Vercel Cron route at `/api/sync` running once daily at 09:00 UTC (Vercel Hobby tier caps cron frequency to once-per-day; the summarize step is sliced to 50 bills per run).

**News ingestion (in cron).** After sync + summarize + lead generation, the cron route pulls RSS feeds from Politico, The Hill, and Roll Call. Bill IDs are extracted via regex from each article's title + summary, looked up against the `bills` table (unknown ids logged and skipped), and matches written to `news_mentions`. Idempotent on `(bill_id, article_url)`. Best-effort — RSS errors are logged but never fail the cron. Local test: `npm run sync:news`. UI surfaces (breaking-news view, media-attention column) land in handoffs 66 and 67.

**Roll-call vote sync (handoffs 77 + 80).** Two separate scripts because the two chambers have completely different sources:

- House: `lib/votes-sync.ts::runVotesSync` → `npm run sync:votes`. Congress.gov `/v3/house-vote/{congress}/{session}` (list, item, members sub-resources). Field names to watch: `startDate` not `voteDate`, `sessionNumber` not `session`, `voteQuestion` not `question`, flat `legislationType`/`legislationNumber` not nested. The /members sub-resource returns all ~435 reps in one call — no pagination. Watermark = `MAX(vote_date) WHERE chamber='house'`; per-vote skip via `existing` set keyed by vote id.
- Senate: `lib/senate-votes-sync.ts::runSenateVotesSync` → `npm run sync:senate-votes`. Scrapes XML from `senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_{S}.xml` (menu, newest-first; reversed to ascend) and `roll_call_votes/vote119{S}/vote_119_{S}_{NNNNN}.xml` (detail). Polls both sessions on each run. Watermark = `MAX(roll_call) WHERE chamber='senate' AND session=?` — per-session because vote numbers reset.

Senate XML keys members by `lis_member_id` (e.g. "S428"), but **Congress.gov does not expose LIS IDs** on either the list or per-member endpoints. The resolver in `lib/lis-map.ts::buildSenatorResolver` maps to `bioguide_id` via `(last_name, state)` lookup against the `members` table — NFD-fold to handle diacritic mismatches (senate.gov strips them: XML "Lujan" ↔ DB "Luján"). A small `SENATOR_BIOGUIDE_FALLBACK` constant covers senators absent from `members`. As of HO 94 `sync-members` pulls the full 119th roster (`/member/congress/119`), so freshly-seated and departed senators are covered once it has run — re-check whether the fallback table is still needed after the next `sync:members`.

Both vote upserts use the same `position` enum (lowercase `yea | nay | present | not_voting`) — the senate sync folds "Aye"/"Yes"/"No"/"Absent" into the canonical set. The `votes.bill_id` FK is NULLed if the referenced bill row isn't synced yet (Senate especially — most votes are nominations/PNs that never had a bill_id at all). Member upserts run as a single `DELETE WHERE vote_id=? + INSERT...` batch per vote so a partial failure can't leave a roll-call half-populated.

**Both vote syncs are on cron** (handoff 87): `/api/sync-votes` at 10:00 UTC daily calls `runVotesSync` + `runSenateVotesSync`. They were split out of `/api/sync` rather than folded in because a busy week's vote volume (House alone 400+ rows, each 2-3 API hops) risks the 60s ceiling; both syncs are watermark-incremental, so a tick that runs long simply resumes next day. They are still also runnable by hand via `npm run sync:votes` / `npm run sync:senate-votes`.

### Cron topology

Eight cron jobs on Vercel Hobby, all daily, staggered by hour (Hobby caps cron at once-per-day; each invocation is a 60s-max function). Plus one out-of-band route triggered by GitHub Actions (`/api/cron/markets`, HO 142) — Vercel still hosts the function, but the schedule lives outside Vercel so it can fire at higher frequency than once-per-day. See "GitHub Actions cron" below.

- `/api/sync` — 09:00 UTC — bills: sync (≤30s budget, HO 116) + dashboard lead + trades. Summarize was split out in HO 115; runSync got its own time budget + 15s per-detail `AbortController` + batched diff in HO 116; news ingestion was split into `/api/cron/news` in HO 117; weekly report was split into `/api/cron/weekly-report` in HO 139. Per-step wall-clock times are included in the `cron_runs.payload.payload.timings` object so the next "step X is overrunning" investigation has data ready.
- `/api/cron/weekly-report` — Monday 09:30 UTC (`30 9 * * 1`) — weekly report generation (handoff 139). Split out of `/api/sync` because the shared Monday 09:00 tick was running sync + lead + trades + report inside one 60s function and never reached the report step in production — `cron_runs` row 27 (2026-05-25 09:35 `/api/sync`) is the canonical orphan. Calls `getPriorWeek(now) → generateWeeklyReport(week) → writeReport(...) → revalidateTag("reports")`. The 88s end-to-end measurement during HO 139 verification — which initially looked like a structural perf problem — was a Gemini service outlier; HO 141's Phase 1 diagnostic re-measured the same path at 12-15s end-to-end across all four `thinkingBudget` candidates (1024/2048/4096/8192). Stayed on `thinkingBudget: 8192` (lower budgets don't reliably reduce latency in the data, and 1024 leaks banned phrases per HO 112.2). If a slow-Gemini day recurs the HO 139 wrapper catches it as `status='timeout'` cleanly.
- `/api/sync-votes` — 10:00 UTC — House (Congress.gov) + Senate (senate.gov XML) roll-call votes (handoff 87).
- `/api/sync-race-ratings` — 11:00 UTC **Wednesdays only** (`0 11 * * 3`) — Sabato race ratings from Ballotpedia (handoff 88).
- `/api/cron/committees` — 11:30 UTC — committee data sync (handoff 143). Three operations per tick: full refresh of the `committees` list from Congress.gov `/committee/119`; full refresh of `committee_members` from unitedstates/congress-legislators committee-membership-current.yaml (Congress.gov has no roster endpoint — verified HO 143 pre-flight); incremental refresh of `committee_bills` via the bill→committees direction, gated on a `committee_bills_sync_cursor` (`update_date` watermark) in `dashboard_state`. Stops *starting* new per-bill fetches at 45s. Initial backfill of ~16K bills lives in `scripts/backfill-committee-bills.ts` (runs locally without the 60s ceiling); the cron handles steady state of 50-500 newly-updated bills/day. `revalidateTag("committees")` flushes all four committee query helpers in `lib/queries.ts`.
- `/api/cron/primaries` — 12:00 UTC — primary candidates (handoff 97, time-budgeted HO 120). Stops *starting* new districts at 50s wall-clock; each outbound Ballotpedia fetch is capped by an 8s `AbortController`. **Cursor commits per-district**, so a tick killed mid-slice keeps the districts it finished — the pre-HO-120 slice-level cursor write left two orphaned `cron_runs` rows (id=9 / id=19, 2026-05-22 + 2026-05-23) where the slice never advanced, treated as the canonical example of that failure mode.
- `/api/cron/summarize` — 13:00 UTC — LLM summarization of bills with `summary IS NULL` (handoff 115). Time-budgeted: stops *starting* new bills at 45s wall-clock; each in-flight bill is capped by a 15s `AbortController` (so 45+15 = 60 worst case). Selector skips bills with `summarize_failed_at` set within the last 24h, so a stuck bill can't burn consecutive ticks. Bills hitting `summarize_attempts >= 3` are surfaced into the tick's `cron_runs.error_message` for manual review.
- `/api/cron/news` — 14:00 UTC — RSS ingestion + LLM bill-matching (handoff 117). Pulls 3 RSS feeds, regex-matches bill ids in titles, falls back to a Gemini Flash matcher for the ~95% of articles that don't cite bills verbatim. Time-budgeted: stops *starting* new articles at 45s; each LLM call is capped by an 8s `AbortController` (per-article p95 was 760ms in HO 117 Phase 1, so 8s is ~10× p95). `llmTimeouts` count surfaces into `cron_runs.error_message` for manual review. `revalidateTag("news-breaking")` flushes both `/news` (`getBreakingNews`) and the HO 114 home block (`getBreakingNewsForHome`) — both share that tag.
- `/api/cron/markets` — **not on Vercel cron**, fires every 30 min during US market hours via GitHub Actions (`.github/workflows/markets-tick.yml`, schedule `0,30 14-20 * * 1-5`). Fetches the v1 lineup (SPX/WTI/DXY from Stooq, TNX from FRED) in parallel, computes percent change vs the most recent prior `market_date` row of the same symbol, appends one row per symbol to `market_ticks`, and `revalidateTag("markets")`. Per-symbol failures are non-fatal — they land in the response payload and (if any) in `cron_runs.error_message` via the HO 139 chronicErr pattern. Typical wall-clock 2-5s (5 small HTTP fetches + 5 small upserts). VIX is deferred (no free reliable source).

The primaries cron does **not** scrape a region per tick. The corpus is ~470 scrape units (1 calendar pass + 34 Senate states + 435 House districts); at ~1.5-2s per unit — the Ballotpedia politeness sleep dominates — any whole region blows the 60s ceiling (West measured 153s warm-cache, ~200s cold; the full 34-state Senate pass measured 65s). Instead `runPrimariesCronTick` (`lib/primaries-sync.ts`) walks a persistent cursor stored in `dashboard_state` under key `primaries_cron_cursor`, processing one tick's worth per day: the calendar pass, or up to `CRON_SENATE_SLICE` (20) Senate states, or up to `CRON_HOUSE_SLICE` (12, lowered from 20 in HO 120 after the pre-flight measure projected a 20-slice to ~67s prod) House districts — then advances the cursor and wraps at the end. Full-corpus refresh takes ~40 days post-HO-120 (was ~26 pre-fix). The cursor is written **per unit** as each district/state finishes (HO 120), so a tick that runs out of budget keeps the units it did finish. `runPrimariesCronTick` takes a `routeStart: number` so the 50s `DEADLINE_MS` reflects the function's full lifetime; the route passes `t0`. Senate cursor slice stays at 20 because the per-unit commit makes a senate tick safe to span two days if it ever needs to. Lower `CRON_HOUSE_SLICE` if `cron_runs.payload.perUnitMs.p95` trends past ~4s.

Primary scrape logic lives in `lib/primaries-sync.ts` (handoff 97 moved it out of `scripts/` so the cron route and the CLI share it); `scripts/sync-primaries.ts` is now a thin CLI wrapper. The primaries query helpers in `lib/queries.ts` use plain `db.execute` (no `unstable_cache`), so the cron does no `revalidateTag` — add one if those queries are ever cached.

### Cron finalize pattern (HO 139)

All eight cron routes route through `wrapCronRoute(route, handler)` in `lib/cron-log.ts`. The wrapper does three things:

1. **Reaper sweep at the top.** Any `cron_runs` row stuck at `status='running'` with `started_at` older than 5 minutes is updated to `status='orphaned'` with `ended_at=now()`. Self-healing — no separate reaper route. The threshold is 5× the 60s function ceiling; anything older than that was killed by SIGKILL and the function that owned the row is long dead.
2. **Soft timeout race.** The handler runs inside `Promise.race(handler(), timeoutPromise)` with a 55s default timeout (5s buffer under the 60s Vercel SIGKILL). A timeout throws `CronTimeoutError`, which the wrapper catches and finalizes as `status='timeout'` with HTTP 504. Critical: a Vercel SIGKILL at 60s skips `finally` blocks, so the soft timeout is the only thing that guarantees the row finalizes cleanly. AbortController would not help — libsql/Gemini SDKs don't honor abort signals.
3. **Finalize and respond.** Success → `status='success'`, HTTP 200, payload as JSON. Error → `status='error'`, HTTP 500. Timeout → `status='timeout'`, HTTP 504. Routes pass `{ payload, chronicErr? }` from the handler; `chronicErr` is non-fatal info (chronic summarize failures, news LLM timeouts) that lands in `cron_runs.error_message` on success rows.

**Status vocabulary** (`CronRunStatus` in `lib/cron-log.ts`):

| Status      | Meaning                                                                        |
|-------------|--------------------------------------------------------------------------------|
| `running`   | In-flight. Should never persist past 5 minutes (reaper threshold).             |
| `success`   | Handler returned cleanly, row finalized inside the function.                   |
| `error`     | Handler threw; row finalized with the error message. HTTP 500.                 |
| `timeout`   | Soft timeout hit at 55s, row finalized cleanly before SIGKILL. HTTP 504.       |
| `orphaned`  | Reaper found a stale `running` row from a prior SIGKILL. HTTP irrelevant.      |

The read-side `rowToCronRun` in `lib/queries.ts` keeps a display-only fallback: any row still marked `running` past 5 minutes renders as `orphaned`. Backstops the gap between SIGKILL and the next tick's reaper sweep.

The four 2026-05-22 through 2026-05-25 orphan rows that motivated HO 139 are backfilled with `payload='{"backfilled":true,"reason":"pre-HO-139"}'` so they don't pollute future audits.

### GitHub Actions cron (the high-frequency escape hatch, HO 142)

Vercel Hobby caps cron at once-per-day, so any sync that needs to fire more often (every 30 min, hourly, etc.) lives as a GitHub Actions workflow that just POSTs the Vercel-hosted route. Vercel doesn't care the request came from a non-Vercel cron; the function executes normally and writes to the same `cron_runs` table via `wrapCronRoute`.

Pattern:

1. Build the route under `app/api/cron/<name>/route.ts` exactly like a Vercel-cron route — `wrapCronRoute`, Bearer `CRON_SECRET` auth, `maxDuration: 60` in `vercel.json` (so the function runs at function-tier limits even though no Vercel cron schedule references it).
2. Add `.github/workflows/<name>-tick.yml` with the desired schedule and a `curl -fsS -X POST -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" https://<deploy-url>/api/cron/<name>` step.
3. Add `CRON_SECRET` as a GitHub repository secret (same value as the Vercel env var so one secret rotates for both).
4. First scheduled run may be up to ~15 min delayed — GitHub Actions cron isn't punctual. Fine for refresh-style work; not fine for time-sensitive triggers.

Reuse this for any future high-frequency sync (news refresh, race-rating polling, primary-results scraping). The route is still observable through `cron_runs` because it uses the same wrapper.

### Cron latency notes

Reference numbers for the routes whose runtimes have been characterized, useful when a `cron_runs.elapsed_ms` value looks off and you want to know whether it's normal or worth investigating:

- `/api/sync` — typical ~40s end-to-end on a busy day (HO 139 verification: 40.4s = sync 5.9s + lead 25.3s + trades 9.0s). The dashboard-lead generation is the dominant step.
- `/api/cron/weekly-report` — typical **~15s end-to-end** (HO 141 Phase 1: gatherReportData ~5s + Gemini Flash 8-10s = 12-15s pipeline, route end-to-end 14.9s with a `reports` row written). At the current `thinkingBudget: 8192`, none of the lower-budget candidates (4096/2048/1024) reliably reduced Flash latency — Flash floor is ~7-10s regardless. 1024 leaks banned phrases per HO 112.2 so it's not safe to drop to anyway.

**Historical outlier — 2026-05-26.** During HO 139 verification, the same `/api/cron/weekly-report` path took **88s end-to-end** twice in a row, finalizing as `status='timeout'` each time. Initially treated as a structural perf problem (motivating HO 141). HO 141's Phase 1 swept `thinkingBudget` ∈ {1024, 2048, 4096, 8192} from the same dev laptop ~3 hours later and measured the same code path at 12-15s across every candidate. The 88s was a Gemini service slowdown, not the code. The pattern lesson: **two close-in-time samples aren't a verdict** — sweep the parameter space and re-measure across hours before concluding a structural problem.

**The wrapper is the durability floor.** Whenever Gemini or any downstream dependency has a slow day, the HO 139 `wrapCronRoute` finalizes the row as `status='timeout'` (HTTP 504) cleanly at 55s instead of stranding it as a `running` row past the SIGKILL. That gives the on-call signal a name without forcing an immediate code change — a recurrence is a row to read, not a mystery.

**HO 135 watch.** `/api/sync` hit 53s on the 2026-05-27 scheduled tick (2s under the 55s floor). One datapoint, not a trend. Trigger for Phase 2 (HO 120-style per-unit cursor commit on `runSync`'s diff loop): next timeout or a clear pattern across 3 ticks. Re-run `scripts/diagnostic/cron-health-135.ts` to refresh the read.

### Backfill scripts

- `npm run backfill:cosponsors` — pure SQL `json_extract` from `raw_json` into `cosponsor_count`. No API calls, instant. Idempotent via `WHERE cosponsor_count IS NULL`. JSON path is `$.cosponsors.count` (the sync stores `detailRes.bill` directly as `raw_json`, not the outer wrapper).
- `npm run backfill:text-length` — re-fetches text URLs for summarized bills with NULL `text_length`. Throttled at ~5 bills/sec, ~50 min for the full corpus, safe to Ctrl-C and resume. Empty fetch → write 0; thrown fetch → leave NULL so the next run retries. Reuses `fetchBillText` exported from `lib/summarize.ts`.
- `npm run backfill:bioguide-ids` — pure SQL `json_extract` from `raw_json` into `sponsor_bioguide_id`. JSON path `$.sponsors[0].bioguideId`. Modern syncs already write this field directly so the script is a safety net for older rows; coverage is ~100% on the live corpus.
- `npm run sync:members` — refreshes `members` from the Congress.gov 119th-Congress roster (HO 94). Pages `/member/congress/119` (full roster, 551) and `/member/congress/119?currentMember=true` (currently serving, 536), then fetches `/member/{bioguideId}` detail for each and upserts. ~560 API calls, ~90 seconds. **Do NOT use `/member?congress=119`** — that query param does not filter by Congress and returns ~2,700 historical members back to Barney Frank. Roster members absent from the `currentMember=true` set (deaths, resignations, members who took another office) are kept as rows with `is_current = 0` — never deleted, so historical "who held this seat" lookups still resolve. Before HO 94 this seeded only from distinct `bills.sponsor_bioguide_id`, which structurally missed current members who hadn't sponsored a bill (special-election winners, senior members like Pelosi/Hoyer who rarely sponsor). Not in the cron — **re-run after any known special election or redraw; quarterly at minimum otherwise.** The script derives `chamber` from the latest term and computes `current_term_end_year` as `startYear + 2` (House) or `+ 6` (Senate) because the API omits `endYear` on active terms. `party` comes from `partyHistory` (most recent entry); the script accepts both abbreviation form (`R`, `D`, `I`) and full name (`Republican`, `Democratic`, `Independent`).
- `npm run sync:rematch` — re-runs the House incumbent matcher (`scripts/sync-primaries.ts --rematch`) over existing `primary_candidates` rows without re-scraping Ballotpedia. Run it after `sync:members` so refreshed roster data flows into the `primary_candidates.bioguide_id` linkage. Prints match-rate deltas and HO 94 spot-checks.
- `npm run seed:affiliations` — loads caucus rosters from `data/affiliations-seed.json` into the `affiliations` table. No API calls (pure JSON read + upsert). Idempotent via `INSERT ... ON CONFLICT(bioguide_id, org) DO UPDATE`. Rosters whose bioguide_id isn't in the `members` table yet get warn-and-skip, not abort. Re-running after editing the JSON is the refresh workflow — refresh quarterly by hand.
- `npm run backfill:races` — one-shot derivation of stub race rows from `members`. `INSERT OR IGNORE` so re-runs don't clobber hand-curated rating + candidate data. Expected ~435 House + ~33 Senate ≈ ~468 rows on first run; second run prints `Inserted: 0`. The SQL `id` expression is a translation of `raceIdFromMember` in `lib/race-id.ts` — keep them in sync.
- *(`backfill:committee-bills` was a one-time HO 143 fill — 15,652 bills, 22,765 `committee_bills` rows, 70 minutes wall-clock, 12 fetch errors at ~0.08%. Script deleted on 2026-05-27 after the run. `/api/cron/committees` handles steady state via `committee_bills_sync_cursor` in `dashboard_state`.)*
- `npm run seed:races` — applies the hand-curated rating + candidate roster layer from `data/races-seed.json` on top of the stubs. Idempotent: UPDATE on the race row + `INSERT ... ON CONFLICT(race_id, name) DO UPDATE` on candidates. Unknown race ids get warn-and-skip; invalid ratings (not in the Sabato seven) get warn-and-skip. Refresh quarterly by editing the JSON and re-running.
- `npm run seed:runoffs` — loads hand-curated runoff contests into `primaries` + `primary_candidates` (handoff 107) from `data/runoff-seeds/la-senate-2026.json`. Idempotent: the runoff `primaries` row upserts on its PK, `primary_candidates` is delete-then-insert per `primary_id`, and the round-1 `primaries` rows get their `runoff_date` set. See "Runoff tracking" below.
- `npm run seed:ratings` — loads third-party race ratings into `race_ratings` (handoffs 71 + 73). Globs every `data/race-ratings-*.json` and upserts each row on `(race_id, source)` via `INSERT ... ON CONFLICT(id) DO UPDATE`. v1 covers Cook, Sabato, and Inside Elections (Senate only); three sources is the cap — more is noise. Unknown rating strings warn-and-skip; after 73 that almost always means a new rater vocabulary needs adding to the `RATING_SCORES` map in the script plus the matching color maps in `components/RatingChip.tsx` and `components/MemberHeader.tsx`. Prints per-source summary lines plus an aggregate. race_id is a loose link — ratings can land before the race row exists. Refresh quarterly by re-pulling each rater's page.
- `npm run sync:news` — runs the news ingestion pipeline (handoff 64) locally. Same code path the cron route invokes via `ingestNews()`. Prints per-source `fetched/mentions/skipped_unknown_bill` counts; idempotent across reruns thanks to the `(bill_id, article_url)` UNIQUE constraint.
- `npm run sync:trades` — runs the stock-trades ingestion pipeline (handoff 70) locally via `ingestTrades`. Same code path as the cron, but capped at 20 pages per chamber (cron caps at 3). Reads `members` into memory, fetches FMP disclosure pages for senate + house, name-matches via `lib/matchMember.ts`, and `INSERT OR IGNORE`s into `stock_trades`. Stops early when an entire FMP page is all-seen. Prints `inserted / matched / total` per chamber plus a sample of unmatched names — the audit workflow for tightening the matcher.

### Query helpers (`lib/queries.ts`)

- `getFeedBills(filters, {page, pageSize})` — main feed; returns `{ bills, total, page, pageSize, totalPages }`. `total` is the filtered count. The page passes `total` into `HeaderBar` via `feedFilteredCount` so the header doesn't need a second COUNT query. The unfiltered count for the "X of Y" header line comes from `getFeedStats().total`.
- `getStaleBills(filters, limit)` / `getStaleCount(filters)` — `/stale` page. Compose `buildStaleWhere` on top of the shared `buildFeedWhere`; the stale criteria (`latest_action_date IS NOT NULL`, `< date('now', '-60 days')`, `stage IN (introduced, committee, floor, other_chamber, other)`) are added to whatever the user filtered by. `total` is the count of all stale bills; `filtered` adds stage/topics/q. Sorted by `latest_action_date ASC`.
- `getPresidentBills(filters, limit)` / `getPresidentCount(filters)` — `/president` page. Compose `buildPresidentWhere` on top of `buildFeedWhere`, but strip `filters.stage` first (stage is fixed by the helper). Adds `stage = 'president'` and `latest_action_date IS NOT NULL`. Sorted by `latest_action_date ASC` (oldest at desk first — closest to the 10-day veto deadline). Same `{total, filtered}` contract as the others.
- `getStageChanges(filters, days=7, limit=200, dashboard?)` / `getStageChangesCount(filters, days)` — `/changes` page and the dashboard's `ActivityTicker`. `buildChangesWhere` composes on `buildFeedWhere` (stripping `filters.stage`) and adds `stage_changed_at` within the last `days`, sorted `stage_changed_at DESC`. Excludes ceremonial by default like everything built on `buildFeedWhere`, so the ticker calls it with empty `filters` + `limit: 15`. The optional 4th `DashboardFilters` arg carries the dashboard's click-to-filter state: `stage` matches transitions where `stage = ? OR previous_stage = ?` (either direction), `topic` narrows via `json_each` EXISTS. `/changes` ignores the 4th arg.
- `getSponsors(filters, limit)` / `getSponsorCount(filters)` — `/members` page. `SponsorFilters` is `{ party?: 'R'|'D'|'I', state?, q? }`; `q` matches `sponsor_name LIKE`, not bill text. Aggregates `bills` by `(sponsor_name, sponsor_party, sponsor_state)` with `COUNT(*)` and `MAX(latest_action_date)`. Inherits `summary IS NOT NULL` from the same convention `buildFeedWhere` uses, so unsummarized bills don't pad sponsor counts. `party='I'` matches any non-R, non-D variant (`UPPER(sponsor_party) NOT IN ('R','D')`) — Bernie Sanders' `ID`, hypothetical `IND`, etc. `getSponsorCount` wraps the GROUP BY in a subquery to count distinct sponsor groups.
- `getSponsorStates()` — distinct non-null `sponsor_state` values (alphabetical) for the State dropdown.
- `getSponsorRecentBills(name, limit=5)` — newest bills for a sponsor, used by the inline expand panel.
- `normalizePartyVariant(party)` — collapses any sponsor party string to `'R' | 'D' | 'I' | null`. Use this both for filtering and for badge rendering so `R`, `D`, and everything-else-non-null map to the three party colors.
- `sanitizeStaleStage(input)` — accepts only the four dropdown-eligible stages so a hand-typed `?stage=enacted` is silently ignored on `/stale`.
- `sanitizeSort(input)` — accepts `'action' | 'introduced'`, falls back to `'action'` on anything else.
- `sanitizeIncludeCeremonial(input)` — `'1'` → `true`, anything else → `false`. Default behavior hides ceremonial bills.
- `sanitizeClusterId(input)` — returns the slug only if it matches a known `CLUSTER_PATTERNS` id (from `lib/cluster-patterns.ts`); anything else → `undefined`. URL input is untrusted everywhere.
- `getStageDistribution(filters?)` — dashboard stage funnel: per-stage counts of substantive (non-ceremonial) on-path bills, plus `offPath` (stage `other`/NULL) and `total`. Optional `DashboardFilters` arg: `topic` re-shapes the funnel to that topic's stage distribution (via `json_each` EXISTS); `stage` is *not* applied here — a single-bar funnel is useless, so `stage` only drives the component's selection state. Cached, tag `bills`, key includes the filter args.
- `getCorpusStats()` — total non-ceremonial bill count + most recent `update_date`. Feeds the dashboard `HeaderBar`. Cached, tag `bills`, invalidated by the sync cron.
- `getTopicDistribution(filters?)` — corpus-wide topic counts (non-ceremonial only), sorted by count desc. Uses `json_each` to UNNEST the `topics` JSON array — the standard pattern for aggregating across a JSON column; any future JSON columns aggregate the same way. Rows are validated against the `Topic` enum (unknown values logged and skipped). Optional `DashboardFilters` arg: `stage` narrows the counts to bills at that stage; `topic` is *not* applied here (visual selection only). Cached, tag `bills`, key includes the filter args.
- `getTopicMixByChamber()` — chamber-faceted variant of the same topic distribution (handoff 76). Two `CASE WHEN bills.bill_type IN (...)` sums (house: `hr/hjres/hconres/hres`; senate: `s/sjres/sconres/sres`) over the same `json_each` fanout. Non-ceremonial, corpus-wide, tag `bills`. Every bill maps to exactly one chamber so the two sums never double-count. Sorted by combined count DESC so House and Senate columns share an axis. Backs `TopicMixByChamber` on the home dashboard.
- `getDashboardLead()` — reads the current `weekly_lead` row from `dashboard_state` (`{ text, updatedAt }`), or `null` if the cron hasn't generated one yet. Cached, tag `bills`, invalidated by the cron after a fresh lead is written.
- `getReportsList()` / `getReports(limit, offset)` / `getReportCount()` / `getReport(slug)` — weekly reports for `/reports` and `/reports/[slug]`. All cached with tag `reports` (separate from `bills` because the cron's report step revalidates independently). The cron's Monday step calls `revalidateTag('reports')` after writing. `getReportsList()` is the unpaginated variant kept for compatibility with internal callers (cron, dashboard widgets); the `/reports` page uses the paginated pair (handoff 75).
- `getMember(bioguideId)` / `getMemberStats(bioguideId)` / `getMemberBills(bioguideId, limit)` — back the `/members/[bioguideId]` member hub. Cached with tag `members` (24h revalidate); `getMemberBills` additionally tagged `bills` since the underlying bill rows change with the daily cron. `getMemberStats` excludes ceremonial bills from the enacted-rate denominator so the number reflects substantive work. `getSponsors` (`/members`) returns `sponsor_bioguide_id` via `MAX(...)` so the row's expanded panel can render `[View detail →]` when present.
- `getMemberAffiliations(bioguideId)` — caucus affiliations for a member, sorted by `CAUCUS_CONFIG.priority` asc. Rows whose `org` is not in `CAUCUS_CONFIG` are filtered out (defensive against config renames leaving orphan rows). Cached tag `members`, shares the existing sync invalidation — affiliations themselves are seeded manually, so no separate invalidation surface.
- `getRace(id)` / `getRaceCandidates(raceId)` — back the `/race/[id]` hub. Both cached, tag `races` (separate from `bills` and `members` because seeds refresh independently). `getRaceCandidates` orders by status precedence — `won_primary` first, then `running`, `declared`, `withdrew`, others — then name. The `/api/revalidate?tag=races` route is the manual-flush hook; the seed scripts do not POST to it (no live cron to invalidate against). Hit it manually if a cache flush is needed after a seed run.
- `getRaceRatings(raceId)` / `getMostCompetitiveRaces(cycle, limit)` — back the rating chips on `/race/[id]` and the member-hub seat-up indicator (handoff 71). Both cached, tag `race-ratings` (separate from `races` because the rating seed refreshes quarterly on a different cadence). `getRaceRatings` returns rows sorted by `updated_at DESC`, so consumers can take `[0]` for the freshest read across sources. `getMostCompetitiveRaces` orders by `MIN(ABS(rating_score))` per race (so a single Toss Up rating from any source floats the race up), tiebreak `MAX(updated_at)`; it's wired up but not yet rendered — feeds the future "most competitive races" dashboard cut. The `/api/revalidate?tag=race-ratings` route is the manual flush hook after a re-seed.
- `getRecentVotes(chamber, limit)` — last N votes for one chamber, used by the (planned) dashboard ticker / chamber-level views. **Takes chamber, not bioguideId** — sponsor-page vote lists use `getMemberVotes` instead. Cached, tag `votes`.
- `getVotesByBill(billId)` — every vote tied to a specific bill (newest first). Backs the bill detail page's vote section. Cached, tag `votes`.
- `getMemberVote(voteId, bioguideId)` — single position lookup; returns `{ position } | null`. Used inside the vote detail breakdown where one member's stance is highlighted. Cached, tag `votes`.
- `getMemberVotes(bioguideId, { page, pageSize })` — paginated vote history for the member hub. **No chamber filter** — joins `member_votes → votes` purely on bioguide_id, so House and Senate votes flow through the same list. Natural separation happens because a House member has no senate `member_votes` rows and vice versa. Cached, tag `votes`.
- `getMemberVoteStats(bioguideId)` — yea/nay/present/not_voting totals for a member. Powers the `MemberVoteStats` line on the sponsor hub. Cached, tag `votes`.
- `getCommitteeActivityByPeriod(systemCode)` / `getCommitteeTopicMix(systemCode)` — HO 146 chart helpers for `/committee/[systemCode]`. `getCommitteeActivityByPeriod` returns `{ month, bucket, count }[]` with `month = substr(activity_date, 1, 7)` and `bucket` one of `Referred | Markup | Reported | Other`, scoped to the current Congress via `congress = (SELECT MAX(congress) FROM bills)`. **Activity-type case-duplicate:** `committee_bills.activity_type` carries both `"Discharged From"` and `"Discharged from"` (case-different rows from the Congress.gov feed); the bucket-collapse expression uses `LOWER(activity_type)` so they normalize together — any future raw-type matchers must use the lowercased form. `getCommitteeTopicMix` returns `{ topic, count }[]` via `json_each(bills.topics)` fanout with `COUNT(DISTINCT cb.bill_id)` (a referred-then-reported bill counts once), excludes ceremonial bills, no congress filter (matches `getTopicMixByChamber` corpus convention). Both `unstable_cache` tag `committees`.
- `getCommittees(filters?)` / `getCommitteeBills(systemCode, limit?, sinceDays?)` / `getCommitteeMembers(systemCode)` / `getCommitteeActivity(days?)` — HO 143 data-layer helpers. All cached tag `committees`; `/api/cron/committees` calls `revalidateTag("committees")` to flush. `getCommitteeBills` returns `CommitteeBillRow[]` (`{ bill: FeedBill; activityType; activityDate }`) so a consumer can render per-committee activity context alongside the bill — extended in HO 144 with an optional `sinceDays` argument that adds `AND activity_date >= datetime('now', '-<n> days')` to the inner CTE so `/committee/[systemCode]` can ask for "last 30 days" without filtering JS-side. The matching `activity_type` for the row's `MAX(activity_date)` is pulled via a correlated subquery so a bill referred and later reported still surfaces once with the freshest verb.
- `getMemberCommittees(bioguideId)` / `getBillCommittees(billId)` — HO 145 cross-link helpers feeding the member-hub "Committees" section and the bill-detail "Committees" section. Both cached, tag `committees`. `getMemberCommittees` joins `committee_members` → `committees` → (parent committee for the `↳ Parent` caption), filtered to `c.is_current = 1` and ordered parents-first by committee-type priority (Standing → Select → Joint → Task Force → Other) then by name, with subcommittees in a second block ordered by parent name then own name. `getBillCommittees` joins `committee_bills` → `committees` → parent and sorts by `activity_date DESC NULLS LAST, c.name ASC`. Rows are NOT deduped — a `Referred to → Reported by` sequence on the same committee carries two informationally distinct rows. Rows with NULL `activity_date` or `activity_type` are dropped at read time so the return type can declare both as non-null strings (the schema allows NULLs).
- `getCommitteesIndex(filters?)` / `getCommitteeBySystemCode(systemCode)` / `getCommitteeSubcommittees(parentSystemCode)` — HO 144 helpers for the `/committees` index and `/committee/[systemCode]` detail pages. `getCommitteesIndex` does the per-committee `member_count` + `recent_count` aggregates in a single SQL via two LEFT JOIN subqueries so the index renders 235 rows without N+1. Sort is computed in SQL (`activity` → `recent_count DESC, c.name ASC`; `name` → `c.name ASC`; `members` → `member_count DESC, c.name ASC`); chamber filter is one optional `AND c.chamber = ?`. `is_current = 1` is hardcoded — there is no toggle for retired committees on the index. `getCommitteeBySystemCode` is a single-row lookup (returns `Committee | null`); `getCommitteeSubcommittees` lists current rows where `parent_system_code = ?`. All cached, tag `committees`. Companion sanitizers: `sanitizeCommitteeChamber` (validates against `house|senate|joint`), `sanitizeCommitteeSort` (validates against `activity|name|members`, falls back to `activity`).

### Ceremonial filter (`?ceremonial=1`)

`FeedFilters.includeCeremonial?: boolean` and `SponsorFilters.includeCeremonial?: boolean` flow through `buildFeedWhere` / `buildSponsorWhere`. Both helpers append `(is_ceremonial = 0 OR is_ceremonial IS NULL)` unless the flag is true. NULL counts as visible during backfill so the dashboard doesn't go dark while the classifier is running. The flag becomes part of the `unstable_cache` argument-derived key, so the on/off variants live in separate cache slots.

Don't apply on `/watchlist` or `/bill/[id]` — watched ceremonial bills must surface, and detail pages always render. The toggle is a list-view concept. `getFeedStats(includeCeremonial, cluster?)`, `getSponsorRecentBills(key, includeCeremonial)`, `getSponsorStats(key, includeCeremonial)`, and `getSponsorTopTopics(key, limit, includeCeremonial)` all take the flag explicitly so the expanded sponsor panel matches the active toggle.

### Cluster filter (`?cluster=<slug>`)

Regex-based template clustering. Patterns + `classifyCluster(title, billType)` live in `lib/cluster-patterns.ts` (single source of truth — pattern revision is cheap because there's no separate metadata store). The sync upsert calls `classifyCluster` unconditionally on every bill (pure regex, zero cost) and writes `cluster_id` in the same `INSERT ... ON CONFLICT` statement.

`FeedFilters.cluster?: string` propagates through `buildFeedWhere`, which adds `cluster_id = ?`. **Cluster bypasses the ceremonial gate** — when `cluster` is set, `buildFeedWhere` skips the `(is_ceremonial = 0 OR is_ceremonial IS NULL)` clause entirely. Reasoning: most clusters are mostly ceremonial; opting into "awareness designations" means asking to see the noise. The toggle is suppressed in `HeaderBar` whenever `feedFilters.cluster` is set so the dead control isn't rendered.

Sponsor queries do not take the cluster filter (sponsor page is about people, not bill shapes). `getClusterStats()` returns `[{id, name, description, count, exampleTitle}]` sorted by count desc; `getUnmatchedClusterCount(includeCeremonial)` returns `COUNT(*) WHERE cluster_id IS NULL` honoring the active ceremonial filter. Both cached `tags: ["bills"]`.

Backfill: `npm run backfill-clusters` → `scripts/backfill-clusters.ts`. Pure regex, no API calls; runs in under a minute against the full corpus. Idempotent via `WHERE cluster_id IS NULL` so re-running after adding a sixth pattern only touches previously-unmatched rows. Logs per-cluster counts at the end. POSTs to `REVALIDATE_URL` (with `Authorization: Bearer ${CRON_SECRET}`) on completion to invalidate the `bills` tag, same as the ceremonial backfill.

### Feed sort (`?sort=action|introduced`)

Applies to `/` and `/watchlist` only. Two keys, default `action`:

- `action`: `ORDER BY latest_action_date DESC NULLS LAST, id DESC`
- `introduced`: `ORDER BY introduced_date DESC NULLS LAST, id DESC`

`SortDropdown` is a client component that mirrors `StageFilter`. It deletes `expanded` and (for the default) `sort` from the URL on change, preserves everything else. The visible Action column always shows `latest_action_date` regardless of sort key — the sort axis isn't what's displayed.

Do **not** add the dropdown to `/stale` (forced ASC by definition), `/president` (3 rows, sorted by desk arrival), or `/members` (sorted by `bill_count`, different axis).

`FeedFilters` includes an optional `sponsor?: string`. When set, `buildFeedWhere` ANDs `sponsor_name = ?` so `/?sponsor=<encoded name>` filters the main feed. The HeaderBar count line shows `· sponsored by <name>` in `--accent-amber` when active. All other feed filters (stage, topics, q) compose with it via the same plumbing — and the `StageFilter`, `TopicFilter`, `BillRow` components all thread `sponsor` through their generated hrefs, same way they thread `q`.

## Summarization prompt

Keep summaries 2-3 sentences. Plain English. Neutral. Focus on what the bill *does*, not what it's titled. The CRS summary is a useful input but should not be copied.

Prompt template:

```
You are summarizing a US Congress bill for a personal tracking dashboard. Write a 2-3 sentence summary in plain English that explains what the bill would actually change if enacted. Avoid legalese, avoid the bill's marketing title, avoid editorial language. State who is affected and how.

Then output a JSON block with:
- topics: array of 1-3 topic tags from this list: [healthcare, immigration, taxes, defense, energy, environment, education, labor, technology, civil_rights, criminal_justice, agriculture, trade, housing, transportation, foreign_policy, veterans, elections, budget, financial_services, government_operations, consumer_protection, social_security, other]
- stage: one of [introduced, committee, floor, other_chamber, president, enacted]
- is_ceremonial: true if symbolic (awareness days, building renamings, recognitions, sense-of-Congress); false if it changes law, appropriates funds, or directs an agency

Bill title: {title}
Latest action: {latest_action_text}
CRS summary (if any): {crs_summary}
Bill text (truncated): {bill_text_first_8000_chars}

Respond in this exact format:

SUMMARY:
<2-3 sentences>

JSON:
{"topics": [...], "stage": "...", "is_ceremonial": true|false}
```

Parse the response by splitting on `JSON:` and parsing the second half. If parsing fails, log the bill ID and skip it; don't crash the sync. The `is_ceremonial` field is defensive: if the model omits it or returns a non-boolean, the parser writes NULL so the standalone backfill (`npm run classify-ceremonial`) can pick it up later. Title-only re-classification lives in `lib/classify-ceremonial.ts`; the sync `UPSERT_SQL` clears `is_ceremonial` along with `summary` whenever `update_date` changes so re-classification rides through the inline summarize path with no extra Gemini call.

The prompt will need iteration. Expect to revise it 5-10 times. Common failure modes: LLM repeats the bill's marketing title, LLM editorializes, LLM picks `other` for the topic when a better tag exists. Test against a sample of 20 known bills and read the outputs side by side.

## Dashboard lead generation

The dashboard's top-of-page `DashboardLead` is a 3-sentence prose summary, generated once per cron tick by `lib/dashboard-lead.ts::generateDashboardLead`.

- **Inputs:** corpus size, last-7-day stage transitions (count + top 5 with bill ID, truncated title, transition arrow), last-7-day enactments (count + top 3 IDs), last-7-day new introductions (count), and the topic with the most transitions in the last 7 days. All gathered by focused queries in `lib/dashboard-lead.ts` — not cached UI helpers.
- **Model:** `gemini-2.5-flash`, single completion, reuses the `SUMMARY_MODEL` constant and client pattern from `lib/summarize.ts`.
- **Prompt** lives in source under `lib/dashboard-lead.ts`. Expect prompt iteration over the first 5-10 generations — same failure modes as the summarize prompt (marketing-title creep, generic openers like "This week, Congress...", vague numbers, editorial framing).
- **Storage:** upserted into `dashboard_state` under `key = 'weekly_lead'` with a JS-side ISO `updated_at`. Read back by `getDashboardLead()`.
- **Cron integration:** `app/api/sync/route.ts` calls `generateDashboardLead` + `writeDashboardLead` after sync + summarize, then `revalidateTag("bills")`. Failure is non-fatal — the cron logs a warning, the prior lead stays in the DB, and the dashboard keeps rendering it.
- **Manual run:** `npm run lead` → `scripts/generate-lead.ts` generates, prints, and writes a lead. Use it to iterate on the prompt without waiting for cron.

## Report generation

Weekly reports — one Markdown blob per calendar week, rendered at `/reports/[slug]`.

- Generated weekly on Monday 09:30 UTC by `app/api/cron/weekly-report/route.ts`, which calls `lib/report-generation.ts::generateWeeklyReport`. HO 139 split this out of `/api/sync` after the shared Monday 09:00 tick repeatedly never reached the report step inside its 60s budget; the route now has the full ceiling to itself and the cron is Monday-only via the `30 9 * * 1` schedule.
- **Incomplete-week guard (HO 110):** `generateWeeklyReport` throws if `week.end` is in the future, so a report is never generated for a week that hasn't closed (the cron treats the throw as non-fatal and retries next tick). The 2026-05-18 backfilled row predates the guard and is left as a historical artifact.
- One Gemini call per report. Structured output with four section markers (`LEAD`, `STAGE_COMMENTARY`, `ENACTMENTS_COMMENTARY`, `MOST_TALKED_COMMENTARY`). Parsed by splitting on markers, same pattern as the summarize prompt. The `ENACTMENTS_COMMENTARY` and `STAGE_COMMENTARY` slots also carry the LLM's zero-count placeholder, though assembly owns the copy when a count is zero and ignores the LLM output there.
- The Markdown body is assembled programmatically: section headers + counts come from the data, prose comes from the LLM. Bill IDs render as plain text (`HR 2702`); stage transitions use the canonical `▸ INTRO → ▸▸ COMMITTEE` glyphs.
- Storage: upserted into `reports` keyed by `slug` (the ISO week-start date). Re-running for the same week overwrites the prior row.
- Failure mode: cron logs a warning and writes no row; the sync's other steps still complete. Manual recovery: `npm run report` (prior week) or `npm run report YYYY-MM-DD` (specific week start). `scripts/generate-report.ts` prints the assembled Markdown before writing — useful for iterating on the prompt.
- Notable introductions ranks by `cosponsor_count DESC NULLS LAST`, tiebroken by `COALESCE(text_length, 0) DESC` then `id DESC`. The pre-filter `(text_length IS NULL OR text_length > 5000)` excludes short resolutions and one-pagers that slip past the ceremonial+cluster gates while keeping NULL rows visible during backfill. CRA-disapproval is included as substantive; other clusters are filtered out. (The handoff-58 `LENGTH(summary)` proxy was retired in handoff 59.)
- Markdown rendered on `/reports/[slug]` via `react-markdown` + `remark-gfm` (needed for the topic-breakdown table) with terminal-aesthetic component overrides in `components/ReportMarkdown.tsx`.
- Bill IDs in a rendered report auto-link to `/bill/[id]` (HO 113): `ReportMarkdown` pre-substitutes bare IDs (`HR 2702`, `HJRES 140`, …) into markdown links before rendering, normalizing to the `{getCurrentCongress()}-{type}-{number}` `bills.id` form. A `[`-lookbehind prevents double-wrapping an already-linked ID; `(?!\d)` leaves a trailing `'s`/`s` outside the link.
- "Most talked about" is confidence-gated (HO 111): the `mostTalkedAbout` query keeps only `news_mentions` rows with `match_confidence >= 0.7` (which also excludes NULL-confidence rows — SQL three-valued logic), and only bills with `>= 2` such mentions. Ranked by mention count → avg confidence → recency. The prompt context gets a bucketed `confidence_tier` (`high` >= 0.9, else `medium`) plus outlets and sample headlines — never the raw float.
- The prose prompt (`SYSTEM_PROMPT` in `lib/report-generation.ts`, tuned HO 112) enforces a synthesis-not-recite LEAD, an anti-restate rule (prose states a section's significance, not the list's contents), confidence-tier verb guidance, no LLM-invented counts, and a banned-phrase list. `buildUserPrompt` feeds week-over-week introduction deltas and per-transition direction (forward/backward) as synthesis raw material. Gemini 2.5 Flash obeys imperfectly — banned-word inflections still leak occasionally; further LEAD tuning is HO 112.1 territory.

## Frontend design system

Bloomberg Terminal aesthetic. Dark monospace, dense rows, color-coded stages and topics. No light mode. Tailwind v4 only (no shadcn / no other libraries). Server components by default; client islands are `WatchlistToggle`, `StageFilter`, `SortDropdown`, `SearchBox`, and `CeremonialToggle`.

### Pages

- `/` — dashboard (HO 131 foundation, evolved through HO 133/134/132/149/**150**). HO 150 reflowed the layout per spec 1. **`HomeHeader`** chrome-stacks: (1) **masthead row** — `Congress Terminal:\>` prompt (mono 18px, `--text-primary` with `:\>` in `--accent-amber`) baseline-aligned with the LEAD prose (mono 15px `--text-muted`, 3-line clamp) ending in a blinking `_` caret (`--accent-amber-bright`, 1.1s `step-end` opacity — the dashboard's "sole motion exception" alongside the HO 149 tape marquee); the LEAD reads as terminal *output* of the prompt; (2) `· LAST SYNC HH:MM MT · N BILLS TRACKED` meta line (11px `--text-muted`); (3) **HO 149 markets tape** between the masthead block and the nav; (4) **full-width nav** — six `NAV_ITEMS` (Dashboard · Feed · Members · Patterns · Reports · Watchlist); active state amber-bright + 2px amber underline. Reports is a top-level entry as of HO 150; `pathToNavKey("/reports")` is special-cased to return `"reports"` so it lights up its own tab instead of the `feed` group. HO 154.5 extended `pathToNavKey` with prefix matchers so every dynamic-segment detail route highlights the right top-nav tab: `/bill/*` → Feed, `/members/*` / `/committee/*` / `/race/*` → Members, `/reports/*` → Reports. Each detail page now passes its actual URL as `basePath` to HeaderBar (e.g. `<HeaderBar basePath={/bill/${bill.id}} />`). The first entry `⌂ DASHBOARD` (HO 140) is amber-highlighted on this page; (5) **`ColorKeyStrip`** boxed top-right (172px wide as of HO 150, down from 240px) — STAGES + TOPICS inline only; PARTIES / BILL TYPES / ACCENT moved to the HO 147 `?` badge popover (deleting the BILL TYPES inline row also removed its wrap-clip glitch by construction). Below the chrome stack: a **full-width BREAKING strip** (lifted out of the old Col 3) renders `BreakingNewsBlock` with `showFullHeadline` so the headline never truncates; border caps flush to the row list because the quadrant wrapper is gone. Below that, a **two-equal-column `.home-grid`** (1fr 1fr) — left column stacks STAGE DISTRIBUTION funnel (220px flex-basis) + TOPIC DISTRIBUTION bubbles (flex-1) at full half-width; right column is `ActivityTabs` (ACTIVITY default + TOP STALLS) inside a quadrant. The HO 131/133/134 no-scroll `height: calc(100vh - var(--home-header-height) - 24px)` is gone — the dashboard scrolls if content exceeds viewport (a conscious reversal so the bubbles can read at full half-width per spec 1; answer-above-fold is preserved by masthead+tape+BREAKING). Below the grid sits a slim full-width `<ReportSnapshot />` (HO 153) — `WEEKLY REPORT <date> · <derived lead, 1-2 lines> · read full →` plus a `PREVIOUS · <date> · <date> · <date> · all →` row beneath. It's a pointer, not a re-synthesis — the masthead prompt already carries the synthesized week-lead; the snapshot points at the written report and surfaces its lead via `extractReportLead`. Returns `null` (slot stays empty) when zero reports exist. Backed by `getDashboardReportSnapshot()` in `lib/queries.ts`. Bubbles still drive `?stage=` / `?topics=` click-to-filter (HO 132 in-place rebase): ACTIVITY and BREAKING both rebase to the filtered slice; bubble sizes rebase when STAGE is selected; the funnel rebases when TOPIC is selected. `ActiveFilterStrip` shows the active filter with `× CLEAR` and `VIEW IN /FEED →` links. `await searchParams` opts the route into dynamic rendering. **DashboardBubbleChart** internals (HO 132/132.1): `"use client"` island using `d3-hierarchy::pack`, `value = Math.max(count, 1)` for sqrt-faithful area encoding, soft-nav via `router.push(href, { scroll: false })` on primary click; `<a href>` wrapper around each `<g>` preserves cmd/middle-click new-tab. Zero-count bubbles render at min radius 12px, `fill-opacity 0.35`, no click. Selected bubble gets `.dashboard-bubble.selected` with `--accent-amber-bright` stroke 2.5 + full opacity. HO 132.1's slide-out drawer was dropped — the dashboard rebases in place. `--home-header-height` is now dead code (the no-scroll calc that used it is gone).
- `/feed` — unified BILLS|NEWS feed (HO 151 restructured). A single `SegmentedToggle` (`?mode=bills`|`?mode=news`, default bills) swaps the filter bar, row component, and count chrome; page resets on every filter or mode change. Per-mode params don't collide; the other mode's params persist in the URL across switches (no aggressive clear). `BILLS` (`?mode=bills`): 50/page, `BillRowList` accordions (HO 148), filter chips `StageFilter` (includes `president`) + `ChamberToggle` + `SortDropdown` + multi-select `TopicFilter` (comma-list `?topics=…`), `SearchBox` + `CeremonialToggle` in `HeaderBar`. BILLS-only params: `stage`, `sponsor`, `chamber`, `ceremonial`, `cluster`, `q`, plus shared `topics`/`sort`/`page`. `NEWS` (`?mode=news`): 50/page, `NewsRow` list inside the same `news-header-row` chrome the standalone `/news` used, `NewsFilters` chips for `SOURCE` (politico/the_hill/roll_call) + `WINDOW` (24/72/168/720h, default 72h) + single-select `TOPIC` (`?topic=…` singular, distinct from BILLS' plural) + a clearable `?bill=<id>` pill that scopes to one bill (drops window + confidence gate while scoped — same as HO 130's per-bill semantics). NEWS-only params: `source`, `topic`, `window`, `bill`. SORT is a static "most recent" label — no dropdown shell. `HeaderBar` runs in `pageTitle="News mentions"` + `pageCount=mentions` mode for NEWS, dropping the search box. Backed by `getNewsFeed({source?, topic?, windowHours?, billId?, page?, pageSize?})` which reuses `getBreakingNewsForHome`'s dedup-by-article-key + confidence floor (0.7) when not bill-scoped, paginates via OFFSET, tag `news-breaking`. Companion sanitizers: `sanitizeNewsSource`, `sanitizeWindowHours`. **President alias absorbed:** `/president` redirects to `/feed?stage=president`; when `stage=president` is the sole active stage AND no explicit `?sort` override, the feed page re-applies the legacy `daysSinceMode="desk-time"` desk-time column AND switches the SQL `ORDER BY` to ASC (oldest-at-desk first) — the column and the order ship together so the visible signal stays coherent. `FeedFilters.direction?: "asc"` carries this through `getFeedBills`; it's internal-only, never written by URL params and never surfaced in `SortDropdown`. `getPresidentBills` / `getPresidentCount` were deleted in HO 154.1 as orphans of this redirect. **News alias absorbed:** `/news` redirects to `/feed?mode=news` (and `/news?bill=<id>` to `/feed?mode=news&bill=<id>`); `MediaAttentionCell` points directly at the new target.
- `/bill/[id]` — detail page (card panel layout). HO 145 added a **Committees** block between the field grid (Sponsor/Introduced/Last action/Stage/Topics) and the Summary, fed by `getBillCommittees(billId)`. Section is **skipped entirely** when the bill has no committee_bills rows (a normal state for fresh introductions / many resolutions — a "no referrals" line would be noise). Each row links to `/committee/[systemCode]`, carries the chamber label, an `↳ ParentName` caption for subcommittees, and an `Activity · Xmo ago` suffix via `formatRelativeAgeLong`. No dedupe — a referred-then-reported sequence shows two rows.
- `/watchlist` — bills flagged via `★ Watch`
- `/stale` — bills with no action in 60+ days, sorted oldest-action-first. Same filter chrome as the feed. Stage filter is constrained to the four eligible stages (`introduced`, `committee`, `floor`, `other_chamber`) — `president` and `enacted` never appear (success states aren't stalls). Action column renders days-since (`247d`) instead of a date, color-coded by threshold.
- `/president` — server redirect to `/feed?stage=president` (HO 151). The standalone page is gone; the feed re-applies `daysSinceMode="desk-time"` + oldest-at-desk-first SQL ordering when `stage=president` is the sole active stage with no explicit `?sort`. Existing bookmarks resolve to the same desk-time view they did before.
- `/changes` — bills whose stage moved in the last 7 days, sorted by `stage_changed_at DESC`. The "in motion" view between `/stale` and `/president`. No stage filter (the page is about transitions, not destinations). Topic + search + chamber filters only. The stage column renders the transition (`▸ INTRO → ▸▸ COMMITTEE`) with the prior stage dimmed via the `muted` prop on `StageIndicator`; the action-date column shows `Xd ago` from `stage_changed_at`. Wider stage column comes from the `.changes-feed` wrapper class, not a `BillRow` template change. `BillRow` opts in via `showStageTransition`. Empty state: `No stage changes in the last 7 days.`
- `/members` — distinct sponsors aggregated from `bills`, evolved through HOs 67/89 and reorganized for spec 7 in HO 152. Filter bar (single row): page title + count, then ALL/HOUSE/SENATE `SegmentedToggle` + `PartyFilter` (R/D/I) + `StateFilter` + VOLUME/PASS RATE `SegmentedToggle` (drives list ranking via `?sort=volume|passrate` per `getMembersRanked`'s ORDER BY swap). The metric toggle replaced the HO 67 `SponsorSortToggle` (which is gone); the chamber control on this page is a local `SegmentedToggle` instance so the same component drives both the row list and the two scatters. `ChamberToggle` remains in place for its other consumers — HO 154 normalizes those. **Two side-by-side scatters** (`MemberProductivityScatter chamber="house"` / `chamber="senate"`, HO 152) sit above the list and read directly off the chamber URL state (only the active half renders when a chamber is selected). Each chart is hand-rolled SVG (HO 67's lineage) with three readability fixes: **log x-axis** (`xLog(v) = log10(v + 1)`, ticks 1/10/100/500, integer labels), **y zoomed to 0–30%** (`Y_ZOOM_MAX = 0.30`), and an **out-of-range `▲` marker** above any clamped dot, in the party color. Tooltips stay native `<title>` (HO 147 isn't directly compatible inside SVG without `foreignObject`; the rich-content benefits don't load-bear on hover dots) carrying `name · N bills · M% pass rate · K enacted`. Dot opacity `0.7`; outliers (top-5-by-volume + top-5-by-pass-rate per chamber, deduped) get short-name labels. Dots link to the member hub via the existing bioguideId wrap. **Pass rate on the scatter = enacted/total** (HO 152 calibration so dots actually fall inside the 0–30% zoom band), distinct from HO 67's advanced/total which clusters dominantly above 30% — the list view's "pass rate" column already used enacted/total, so the chart now matches. Backed by `getSponsorProductivity()` extended to LEFT JOIN `members` for the new `chamber` field and to compute `enactedCount` alongside `advancedCount`; sponsors whose `bioguide_id` doesn't resolve to a current member silently drop from both scatters. Click any row to inline-expand a `SponsorExpandedPanel`: photo + state flag + stats (total, enacted/%, stage glyphs) + top topics + scrollable bills list, plus **COMMITTEES** (HO 152, `getMemberCommittees`, with CHAIR/RANKING badges and `↳ Parent` subcommittee captions, skip-on-empty) and **CAUCUSES** (HO 152, `getMemberAffiliations` + `CaucusBadge`, skip-on-empty). URL-driven single-open via `?expanded=<bioguide_id>` (same pattern as the original HO 67 page; the `/feed` BillRowList's client-state model is the alternate idiom — reconciling the two expand mechanisms is HO 154 normalization, not here). Data-quality "N issues" badge from spec 7 deferred — no existing schema signal; ships clean.
- `/patterns` — bill pattern visualization (HO 128, supersedes the HO 114 table render). Two-column layout: left column holds a `PatternBubbleSVG` (hand-rolled SVG, one circle per regex pattern from `lib/cluster-patterns.ts`) sized via `d3-hierarchy::pack` with sqrt-area scaling, colored by `% past committee` on a `--text-dim` → `--stage-enacted` gradient (stalled→moving; the noise-vs-signal lens). `PatternLegend` below renders the gradient strip. Selection is URL-driven via `?selected=<slug>` (validated by `sanitizeClusterId`); clicking a bubble pushes the param with `scroll: false`, re-clicking clears it. When selected, `PatternDrilldownPanel` slides in below the legend with a headline line (`PATTERN: name · N bills · X% past committee · K enacted · Y% ceremonial`), top-5 sponsor mini-bar-chart (party-colored, name-truncated), and a `[View all N bills in feed →]` link to `/feed?cluster=<slug>` (HO 51 drill-out convention). Right column is contextual: when nothing is selected, the legacy `cluster-row` table renders as a fallback (links push `?selected=` rather than navigating away); when selected, it shows the top-10 most-recent bills via reused `BillRow compact` with pre-resolved `getWatchedBillIds` membership. Backed by `getClusterStats()` (extended with `pastCommittee/enacted/ceremonial`) and `getClusterDrilldown(clusterId)` (top sponsors + recent bills + headline), both `unstable_cache` tagged `bills`. Mobile (`< 700px`): columns stack, SVG shrinks to 360px. Internal column (`bills.cluster_id`) and helper names keep `cluster*` naming per HO 114.
- `/reports` — index of weekly reports, newest first (handoff 75, redesigned HO 153). `HeaderBar` runs in `pageTitle="Weekly Reports"` + `pageCount` mode (nav + count chrome). Below the `GroupTabs` sits a `Reports:\>` sub-masthead via the `TerminalPrompt` component (extracted from HomeHeader's inline prompt so dashboard + every list page share one mono-prompt source). HO 154.4 rolled this pattern app-wide: every list page (`/feed`, `/watchlist`, `/changes`, `/stale`, `/members`, `/committees`, `/patterns`, `/trends`, `/races`, `/primaries`) now renders `<TerminalPrompt name="…" />` inside a `.page-masthead` block right below GroupTabs (or right below HeaderBar on /watchlist). Detail pages stay out — the entity name in the title is the page identity, a category prompt would be redundant. `.report-row` grid is `110px 1fr 70px`: amber-mono week-start date, a two-line body (`Weekly Report` title + 1-line derived lead excerpt indented under it), then a muted `read →` chip that lights amber-bright on hover. Lead text is the report's first prose paragraph between the H1 and the first `##` section, markdown-noise stripped and clamped to ~180 chars via `extractReportLead(content_md)` in `lib/report-lead.ts` — derived at read time, never stored, per spec 6 / HO 153 ("don't add a field to the generation pipeline for a display concern"). Click navigates to `/reports/[slug]`. Pagination via `?page=N` at `PAGE_SIZE = 20`. Empty state: `Reports begin Monday <next Monday>.` Backed by `getReportsWithLead(limit, offset)`; count via `getReportCount`. The pre-HO-153 lightweight `getReports` / `getReportsList` helpers were removed in HO 154.1. Cached tag `reports`, 1h revalidate; the report cron's `revalidateTag('reports')` flushes all three. Global nav includes `⎘ Reports` as its own top-level item (HO 150). The `Productivity vs. the 118th` `LawsEnactedComparison` chart stays above the list — untouched by HO 153.
- `/reports/[slug]` — individual weekly report. Markdown body rendered by `components/ReportMarkdown.tsx` (react-markdown + remark-gfm) with terminal-aesthetic component overrides for h1/h2/p/ul/li/code/table/em/strong. `[Download .md ↓]` link in the header pulls from `/reports/[slug]/download`, which serves `report.content_md` with `Content-Disposition: attachment; filename="cbt-${slug}.md"`. Unknown slug renders a friendly empty state with a back link, not Next's `notFound()`.
- `/members/[bioguideId]` — member hub (handoff 60, +61, +62, +77, +80). Photo (depiction_url, plain `<img>` with initials fallback), name, party + state + district chip, born year, next-election chip (links to `/race/<id>` when the member has a non-null `next_election_year` — handoff 62), and the top-2 caucus badges by priority appended to the meta line (handoff 61), and — for Senate Democrats only — the USCPR Palestine scorecard letter grade as a `PalestineBadge` chip at the end of the meta line (handoff 138, extended to the `/members` row list in handoff 142). Grade-to-color is three tiers: A/B render in `--text-secondary` (covered, not flagged), C in `--accent-amber`, D/F in `--vote-nay` (alarm; rose rather than `--party-republican` to avoid cross-wiring with the party dot on a Dem header). Source attribution lives in the tooltip (`USCPR Palestine scorecard: F (rank #3 of 47)`), never on the visible chip. **Surfaces:** hub header (`/members/[bioguideId]`) + `/members` row list, inline after the name in the row's name cell. HO 138's original "hub-only" scope was reversed by HO 142 after Corey saw the hub badge live and wanted the same chip on the roster — the visual-asymmetry concern (47 of 535 members get badged) was acceptable in practice. Still kept off `BillRow` sponsor expansion; separate scope if it comes up. Absence of badge is the correct signal (no "—"/"N/A" placeholder). The `/members` query (`getMembersRanked`) extends with a `LEFT JOIN palestine_scorecard` projecting `grade` + `rank`. The full PALESTINE SCORECARD section from HO 90 stays put further down the hub page; the chip just elevates the grade to glance level. Stat block (bills sponsored, enacted with %, avg cosponsor count). Affiliations row below stats renders every caucus badge by priority; absent entirely for unaffiliated members (no "Coming soon"). Top 10 sponsored bills via reused `BillRow` (no expand, no daysSinceMode). `[View all N bills →]` links to `/feed?sponsor=<bioguide_id>`. **Voting record section** (handoffs 77 + 80): a `MemberVoteStats` summary line (`House votes · N total · yea% · nay% · missed%` — chamber label flips for Senate members) plus the most-recent votes rendered by `MemberVoteRow`. `getMemberVotes` has no chamber filter; a senator's page shows their Senate votes and a House rep's page shows House votes purely because they have no `member_votes` rows in the other chamber. Empty state: `No {chamber} votes recorded for this member yet.` Stock-trades block sits below the voting section. Unknown bioguide_id renders a friendly empty state, not Next's `notFound()`. Reads from `members` + `affiliations` + `votes`/`member_votes` + `stock_trades`; refresh via `npm run sync:members`, `npm run seed:affiliations`, `npm run sync:votes`, `npm run sync:senate-votes`. HO 145 added a **Committees** section between Sponsored Bills and Voting Record, fed by `getMemberCommittees(bioguideId)`. Each row links to `/committee/[systemCode]`, shows chamber + committee type, prefixes subcommittees with `↳` and an inline `· Parent` caption, and renders a `CHAIR` (amber) or `RANKING` (muted) badge when `cm.role` matches — Vice/Co/Acting all collapse into the CHAIR badge; the raw role string lives in the row title attribute. Empty state: single muted `No committee assignments on file.` line (the assumption is every current member has at least one — empty = freshman whose YAML hasn't been published yet, or Speaker who doesn't sit on committees by tradition; both worth surfacing).
- `/committees` — committee index (HO 144). Flat list of every `is_current = 1` committee + subcommittee, joined to per-committee `members_count` + `recent_count` (distinct bills with any `committee_bills.activity_date` in the trailing 30 days) via two LEFT JOIN subqueries in `getCommitteesIndex`. URL state: `?chamber=house|senate|joint` (single value, validated by `sanitizeCommitteeChamber`; missing = all) and `?sort=activity|name|members` (default `activity`, validated by `sanitizeCommitteeSort`). Sort is computed in SQL — `ORDER BY recent_count DESC, c.name ASC` for activity (the framing question is "which committee is most active right now," not all-time volume; House Energy and Commerce / Judiciary lead in steady state); `c.name ASC` for name; `member_count DESC, c.name ASC` for members. Subcommittees included in counts by default — no "top-level only" toggle in v1. Six-column grid (name · chamber · type · 30d · members · `↳ sub` tag) inlined as a single Tailwind utility class on the page; no globals.css addition needed because this is the only consumer. Chamber and Sort segmented filters mirror `ChamberToggle`'s visual idiom but are inlined server-rendered links because the existing `ChamberToggle` is hardcoded to House/Senate and `SortDropdown` is typed to the feed `SortKey`. `HeaderBar` runs in `pageTitle="COMMITTEES" + pageCount` mode. Cached under tag `committees`; `/api/cron/committees` already calls `revalidateTag("committees")` per HO 143.
- `/committee/[systemCode]` — committee detail (HO 144 + HO 146). Header card: name, chamber, type, parent-committee link if `parent_system_code IS NOT NULL`, subcommittees roster (flat — no nesting in v1), retired badge if `is_current = 0`. HO 146 added a two-chart strip between the header card and the members/recent-bills grid: **`CommitteeActivityChart`** (left, ~60%) — stacked monthly bars over the current Congress, bars segmented by 4-bucket `activity_type` collapse (Referred/Markup/Reported/Other), throughput-funnel color mapping (`--stage-committee` → `--stage-floor` → `--stage-enacted` → `--text-dim`); legend chips only render for buckets present in the data; renders muted `Not enough activity to chart.` when the committee has fewer than 5 activity rows; SVG idiom forked from `BillsTimeSeries` (`CHART_HEIGHT=240`, `VB_WIDTH=1000`, same `PAD`, same `SvgGridY` + `SvgLegend`). **`CommitteeTopicDistribution`** (right, ~40%) — single-column horizontal bars, topic colors from `lib/topic-colors`, top-8 + Other rollup, reuses the `.topic-chamber-row` grid styling from `TopicMixByChamber`; renders muted `Topic data sparse for this committee.` when total non-ceremonial topic-tagged bills < 5. Both feed off the HO 146 helpers (`getCommitteeActivityByPeriod`, `getCommitteeTopicMix`) — see the helpers entry for the `LOWER()` normalization that handles the `committee_bills.activity_type` case-duplicate. Hearings/meetings, subcommittee rollup grouping, and hover tooltips are explicitly out of scope (deferred). Two body sections side-by-side on desktop (`md:grid-cols-[2fr_3fr]`), stacked on mobile: **Members** (left, ~40%) and **Recent activity** (right, ~60%). Members are reordered in TS to majority → minority → unside; within each block the row order already comes off `getCommitteeMembers` as `party_side ASC, rank ASC NULLS LAST` so chair/ranking float to the top. Chair/ranking rows render in `--accent-amber`; everyone else in `--text-primary`. Recent bills come from `getCommitteeBills(systemCode, 25, 30)` — the helper now takes an optional `sinceDays` arg and returns `CommitteeBillRow[]` (`{ bill: FeedBill; activityType; activityDate }`) so the page can show the per-committee activity caption (`Referred to · 3d ago`, computed via `daysSince`) immediately above each `BillRow` rather than the global `latest_action_*` line the row already carries. Each bill is rendered as **two sibling `<li>` elements** under the section's `<ul>`: an `ActivityCaption` muted-uppercase line first, then a compact `BillRow`. Two-li-per-row is HTML-valid (the `ul` content model is "zero or more li"). `BillRow` is used `compact` with the page-resolved `watchedSet` so the star renders correctly without a per-row fetch. Empty states for both sections are single muted lines, not full empty chrome (a quiet committee like `hspw12` Highways and Transit shows "No bills with committee activity in the last 30 days."). Unknown `systemCode` renders a friendly empty state with a back link, not `notFound()`. Cached at the query layer under tag `committees`.
- `/race/[id]` — race hub (handoff 62). Race name + cycle + days-to-election countdown. Rating block (Sabato seven, party-colored chip) when hand-curated. Incumbent card linking to `/members/<bioguide_id>` (or "OPEN SEAT" placeholder when `incumbent_bioguide_id` is null). Candidate roster from `race_candidates`, ordered won_primary → running → declared → withdrew → name; withdrawn rows render dimmed. Stub state (no rating, no candidates) shows a single muted "Incumbent running for re-election. No competitive rating yet." line. Source URL + `last_verified` date at the bottom. Unknown id renders a friendly empty state, not Next's `notFound()`. Reads from `races` + `race_candidates` + (incumbent) `members`. ID format: `<STATE>-<DD>-<YYYY>` for House (zero-padded district), `S-<STATE>-<YYYY>` for Senate — produced by `lib/race-id.ts::raceIdFromMember`.
- `/news` — server redirect to `/feed?mode=news` (HO 151). `?bill=<id>` is carried through to `/feed?mode=news&bill=<id>` so the HO 130 `MediaAttentionCell` per-bill semantics still resolve. NEWS mode in `/feed` is the canonical news rendering surface; this route only redirects.
- `/search` — global tabbed entity search (HO 129). URL: `?q=<query>&tab=<bills|members|news|reports>`. Receives `SearchBox` submissions from every page except `/feed` and `/members` (which keep their inline `?q=` filters). Page-level inline `SearchBox` lets the query stay editable. Counts for all four tabs run in parallel; only the active tab's result fetch runs. Active tab gets `aria-current="page"` + amber bottom border. Empty active tab with siblings shows `NO MATCHES IN <TAB> · TRY <BEST> (N MATCHES) →` linked to the highest-count non-empty tab; all-tabs-empty shows the dead-end variant. Empty `?q=` shows the centered hint and zero counts (no 404). Bills tab reuses `BillRow compact` with pre-resolved watchlist membership; News tab reuses `NewsRow` with `linkBillToDetail`; Members shows name + party + state + chamber + bill count linked to `/members/[bioguide_id]`; Reports shows week + title + ~140-char snippet centered on the first match. All eight `search<Entity>` / `search<Entity>Count` helpers live in `lib/queries.ts`, `unstable_cache` with `revalidate: 600` and tag matching the entity (`bills`, `members`, `news-breaking`, `reports`). See `### Search` for full semantics.

Feed-shaped routes (`/feed`, `/stale`, `/changes`, `/president`, `/watchlist`) share the same `HeaderBar` (count + last-updated MT) and render a `StageLegend` (party + stage legend) inline at the top of the list — there is no footer legend component. The feed page passes `feedFilters` to `HeaderBar`, which swaps in a `<SearchBox />` (centered) and a filtered count display (`47 OF 1,643 BILLS · "fentanyl"` with the numerator in `--accent-amber`).

### Search

Two surfaces (HO 129): inline page filters on `/feed` and `/members` (where the page natively renders the result list for `?q=`), and the global tabbed `/search?q=<query>&tab=<bills|members|news|reports>` route everywhere else.

- `components/SearchBox.tsx` is the only client search island. Reads `usePathname()` to decide where to route: paths starting with `/feed` or `/members` stay inline (preserves filter state via `searchParams.toString()`), everything else `router.push(/search?q=…)`. When already on `/search`, the active `tab` carries across keystrokes so a user mid-tab doesn't get bounced back to bills. 250ms debounce; `×` clear button triggers the same effect via `setValue("")`. The `basePath` prop now only matters for the inline-stay destination.
- `/search` (HO 129) — global tabbed search at `app/search/page.tsx`. Reads `?q` (sanitized via `sanitizeQ` — trim + 200-char cap) and `?tab` (sanitized via `sanitizeSearchTab` against `SEARCH_TABS = ["bills","members","news","reports"]`; invalid falls back to `bills`). Runs all four `search<Entity>Count(q)` queries in parallel via `Promise.all`; only the active tab's `search<Entity>(q)` result fetch runs. Header shows `SEARCH · <total> results`. Below header: inline `SearchBox`, count line (`145 RESULTS IN BILLS · "education"`, numerator in `--accent-amber`), `SearchTabs` strip (active tab gets `aria-current="page"` and amber bottom border, zero-count tabs get `data-empty="true"` for 50% opacity), then the active tab's results. Empty active tab with non-empty siblings renders `NO MATCHES IN MEMBERS · TRY BILLS (1,200 MATCHES) →` linked to the highest-count non-empty tab. Empty `?q=` shows the centered hint and zero counts. Backed by 8 cached helpers in `lib/queries.ts` (`searchBills`/`searchBillsCount`/`searchMembers`/…), each tagged with the matching invalidation tag (`bills`, `members`, `news-breaking`, `reports`).
- Bills search semantics: same OR clause as `buildFeedWhere`'s `q` clause (`LOWER(id|title|sponsor_name|summary) LIKE ?` + normalized bill-id `REPLACE(LOWER(id),'-','')`). **Global**: ignores stage/topic/cluster/chamber filters by design. Ceremonial filter and `summary IS NOT NULL` stay on.
- Bill ID normalization: query and id are both lowercased and stripped of spaces/dashes before comparison, so `HR 2702`, `hr2702`, `hr-2702`, `2702`, and `119hr2702` all match `119-hr-2702`.
- Members search: `members.name OR members.state_name` LIKE-matched, `is_current=1` gate. Returns name + party + state + chamber + sponsored bill count. Reuses `bills_agg` CTE for the count. Rows link to `/members/[bioguide_id]`.
- News search: `news_mentions.article_title OR article_summary OR source`, INNER JOIN on bills with ceremonial gate. Reuses `NewsMention` shape so `SearchResultsNews` renders through the existing `NewsRow` (with `linkBillToDetail` so the bill rail jumps to `/bill/[id]` rather than `/feed`'s expand panel — search intent is "find this thing").
- Reports search: `reports.title OR content_md`. `reports` table is ~5 rows × ~2KB markdown body, so the LIKE-scan is trivial. Result row includes a ~140-char snippet centered on the first match (markdown noise `#*_` collapsed to spaces).
- Inline `/feed?q=` semantics unchanged: WHERE built additively in `buildFeedWhere` and shared between `getFeedBills` and `getFeedCount`; combines with `?stage=` and `?topics=` via AND. `StageFilter`, `TopicFilter`, and `BillRow` thread `q` through their generated hrefs so search is preserved when users change filters or expand a row. Empty results render a centered `NO BILLS MATCH "<q>"` block plus a `[Clear search]` link that preserves stage+topics.
- Inline `/members?q=` semantics unchanged: name-only LIKE filter in `buildMemberWhere`.

### Ceremonial toggle (`?ceremonial=1`)

`components/CeremonialToggle.tsx` is a client island mounted in `HeaderBar`'s right cluster. It pushes `?ceremonial=1` on check, removes the param on uncheck, and preserves every other URL param including `expanded` (so flipping the filter doesn't collapse the open row). Label: `include ceremonial` unchecked, `including ceremonial` checked. Suppressed on `/watchlist` and `/bill/[id]` (HeaderBar gates on `feedFilters` being present).

URL plumbing mirrors `q` and `sponsor`: `StageFilter`, `TopicFilter`, `BillRow` accept a `ceremonial?: boolean` prop and append `ceremonial=1` to their generated hrefs. `SortDropdown`, `SearchBox`, `ChamberToggle`, and `Pagination` all read or carry the existing URLSearchParams, so the toggle survives sort/search/chamber/pagination interactions automatically. Each list page (`/`, `/stale`, `/changes`, `/president`, `/members`) reads `params.ceremonial` via `sanitizeIncludeCeremonial`, threads it into `feedFilters`/`carry`, and passes it through to `BillRow`/`SponsorExpandedPanel`.

The standalone backfill is `npm run classify-ceremonial` → `scripts/classify-ceremonial.ts`. Concurrency 10, idempotent via `WHERE is_ceremonial IS NULL`, ~30 min for the full corpus, well under $1. After completion it POSTs to `REVALIDATE_URL` (with `Authorization: Bearer ${CRON_SECRET}`) to invalidate the `bills` tag — a small `app/api/revalidate/route.ts` exists for that purpose. Without those env vars the script logs a hint instead of failing.

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
--vote-yea: #10b981;           --vote-nay: #f87171;
--vote-present: #fbbf24;       --vote-not-voting: #6b7280;
```

Vote tokens (handoff 79) are deliberately decoupled from party colors: `--vote-nay` is the softer `#f87171`, not `--party-republican`'s `#ef4444`, so a Democrat's nay vote doesn't read as a party-coded R chip. `--vote-yea` happens to share `#10b981` with `--stage-enacted` — different semantics (a position vs. a stage), same green.

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

Layout is **full-width fluid** — no `max-w-*` cap on the outer container. Pages, `HeaderBar`, and `StageLegend` all stretch to the viewport with `w-full` and a small `px-4` gutter. The `1fr` title column inside `BillRow` and `SponsorRow` absorbs the extra width on wide displays. If a future page feels too sparse at 2400px+, the right fix is to add `max-w-[1200px]` to the offending column (e.g. the bill summary paragraph), not to re-cap the outer container.

**Spacing tokens (HO 131).** Five CSS custom properties in `:root` drive block-level rhythm; defined once in `globals.css`. Use these instead of ad-hoc px values for block gaps, padding, and margins.

- `--space-xs: 4px` — tightest separation; chip gaps, dot offsets
- `--space-sm: 8px` — small block padding (e.g. compact label margins, narrow row gaps)
- `--space-md: 12px` — default block gap (grid gap, pane padding, header internal spacing)
- `--space-lg: 16px` — generous block padding (lead prose padding, main horizontal gutter on home)
- `--space-xl: 24px` — outer page gutter / large section breaks (home main padding)

Inner-row paddings (`.feed-row`, `.topic-dist-row`, `.funnel-row`, `.top-stalls-row`, etc.) keep their custom hardcoded px values — those drive per-row visual density, not block rhythm. The token scale is intentionally scoped to layout/structure.

`--home-header-height: 240px` is the single fixed offset used by `.home-grid`'s `calc(100vh - var(--home-header-height) - …)` no-scroll math. HO 133 bumped this from 180px to 240px when Stage Distribution + Color Key moved from grid quadrants into the header band — the tallest sibling column (typically Color Key with 5 sections, or Stage Distribution with 6 funnel bars) drives the band height. At narrower viewports the LEAD clamps tighter but stage + color don't shrink, so the band stays ≈240px until the <1280px reflow drops it to two stacked rows. Bump only if the header gains a new row (additional meta line, more color-key sections, nav wraps to two rows at desktop widths).

`.feed-row` grid is post-HO-125 redesigned, with HO 148 swapping the navigation Link for an expand-on-click div role=button on full rows:

- Default: `1fr 40px 36px` — interactive row · media-attention cell (HO 130) · watch star
- `has-days-since` (used by `/stale` and by `/feed?stage=president` when no explicit `?sort` — the HO 151 president alias path): `1fr 90px 40px 36px` — adds days-since column
- Compact (used by `ActivityTicker`, `SearchResultsBills`, `/patterns` drilldown, `/committee/[systemCode]` recent activity): `1fr 40px 28px` — slimmer rail, smaller star, still link-only (no expand)
- Below 700px: media-attention and days-since are hidden via `display: none`; the row collapses to `1fr 32px` (or `1fr 28px` compact). Filter chips wrap; date column hidden via `.col-date`; stage label switches to short form (`.show-mobile` / `.show-desktop`); topics show first + `+N`.

The interactive row wrapper is itself a two-column grid (`56px 1fr`) holding `BillIdRail` and `row-content` (title + StagePillStrip + row-meta). HO 148 removed the inline summary excerpt (`.row-summary`) and the `View detail →` text (`.row-view-detail`) from the row meta — both moved into the expanded panel. The media-attention chip (HO 130) and watch star sit *outside* the interactive wrapper as separate grid cells so their own anchors/buttons don't nest inside it.

### Click-to-expand accordion (HO 148)

Full rows (non-compact) are click-to-expand accordions. **This reverses HO 125's inline-summary-as-primary decision** — the inline summary excerpt is gone, the collapsed row is just title + meta line + chevron, the full summary lives in the expanded panel. The reversal is deliberate (design language matured into spec 4 expand-as-primary).

- `components/BillRowList.tsx` (client) wraps every full-row consumer. Owns the single-open `expandedId` state and a per-bill `Map<billId, PanelData>` cache so re-expanding a row never refetches. Consumers: `/feed`, `/watchlist`, `/changes`, `/stale`, `/president`, `/members/[bioguideId]` Sponsored block.
- `components/BillRow.tsx` is now a `"use client"` component. When `onToggle` is provided (full rows via `BillRowList`), the outer `<Link>` is replaced with `<div role="button" tabIndex={0} aria-expanded>` that toggles on click and on Enter/Space. The expanded panel renders below the row inside the same `<li>` via `grid-column: 1 / -1`. When `onToggle` is omitted (compact path or any direct caller), the original HO 125 `<Link>` navigation is preserved — compact rows on `ActivityTicker`/`SearchResultsBills`/`/patterns`/`/committee/[systemCode]` stay link-only.
- `components/BillExpandedPanel.tsx` (client). Renders summary + meta grid (SPONSOR, STAGE, INTRODUCED, LAST ACTION) instantly from the already-loaded `FeedBill`. On first open, fetches committees + news from `GET /api/bill/[id]/panel` and reports the result up to BillRowList for caching. COMMITTEE row renders the deduped roster (newest-activity-per-systemCode), each linking to `/committee/[systemCode]`. Related-news section shows up to 5 mentions; omitted entirely when zero. STAGE cell uses the HO 147 Tooltip (term variant) reading `STAGE_LABELS` from `lib/enums.ts` — the one current Tooltip wiring inside the panel. Bottom row carries two HO 147-styled action chips: `full bill page →` (real `<a href={/bill/[id]}>` so cmd/middle-click new-tab works) and `congress.gov ↗`.
- `app/api/bill/[id]/panel/route.ts` is the lazy-load endpoint. GET → `{ committees, news }` from the existing cached helpers (`getBillCommittees` tag `committees`, `getNewsForBill` tag `news-breaking`). Single-open caps in-flight to one extra fetch at any moment — far cheaper than the alternative of pre-rendering 50 hidden panels at page load.
- Chevron `▸` lives at the end of the row meta line. Rotates 90° instantly (no transition) and switches to `--accent-amber` when open. Open row also gets `--bg-row-hover` background.
- `MediaAttentionCell` and `WatchStar` both call `e.stopPropagation()` on click so the press chip and star don't toggle the row when clicked. Action chips and committee/news links inside the panel also stopPropagation so they navigate cleanly.
- Cosponsor party split deliberately not surfaced — `bills.cosponsor_count` is the only cosponsor data the sync stores today (HO 148 Phase 1 finding). Cosponsor-list ingestion is a future handoff.
- URL state (`?open=<billId>`) deliberately deferred. Expand is pure client state; zero server traffic per toggle. If deep-linking demand shows up later, the param slots in alongside `?topics= ?stage= ?q= ?sponsor= ?sort= ?page= ?chamber= ?ceremonial= ?cluster=` without collisions.

**Expand-state, two idioms by rendering model (HO 155).** The single-open accordion is carried two ways, on purpose:

- **Client surfaces** (`/feed`, `/stale`, `/watchlist`, `/changes`, `/president`, member-detail Sponsored block) all render through `BillRowList`, which holds open state in `useState` and lazy-fetches panel data client-side via `/api/bill/[id]/panel`. It is already one shared component — no duplication to unify.
- **Members list** (`app/members/page.tsx`) is a server component. Open state is `?expanded=<bioguideId>` read from `searchParams`; the open panel's data (stats/topics/recent bills/committees/affiliations) is fetched server-side and rendered into the initial HTML. Navigation is `<Link replace scroll={false}>`, so row toggles don't pile up history.

This is **not** drift to be unified behind a shared hook. Members is URL-driven precisely because a deep-linked open member panel is shareable content that must server-render into HTML — a client `useExpandState`-style hook would paint the row closed, then hydrate and fetch, degrading exactly that property. The feed is client-driven because nobody deep-links an open feed row and URL-syncing it just litters history. Different jobs, correctly different idioms — the split is by *rendering model* (server-component URL state vs client-component `useState`), not by a swappable backing store. HO 155 evaluated extracting a `useExpandState({ persist })` hook and rejected it: the client surface is already one component, and the members server-render can't call a client hook without a rewrite (+ a new `/api/member/[id]/panel`) that would undo its deep-link benefit.

### Markets tape (HO 149)

Thin full-width ticker tape on the dashboard, rendered by `HomeHeader` directly between `.home-header-top` (masthead + ColorKeyStrip) and `.home-header-nav`. **HO 154.2 promoted the tape to global chrome**: every non-dashboard page now also mounts `<MarketsTape />` at the very top of `HeaderBar`, above the title row. Both mount points share the `cbt-tape-paused` localStorage key — pausing on any page persists everywhere — and consume the same `MarketsTapeClient`, so live/stale/no-data states behave identically. Feeds off `getLatestMarketTicks()` (HO 142) — the four MarketTicks (SPX/TNX/WTI/DXY).

- `components/MarketsTape.tsx` — server, fetches the ticks (catches throw, falls through to the no-data branch).
- `components/MarketsTapeClient.tsx` — client, owns the marquee + states. Staleness is computed client-side against real `Date.now()` (server-side staleness would bake into the page-cache TTL and lie at the 26h boundary). A 60s setInterval re-checks so a long-lived tab eventually flips to stale on its own.
- **Motion exception:** the marquee is the one deliberate exception to the dashboard's cursor-blink-only motion rule. Double-track `translateX 0 → -50%` 22s linear infinite for a seamless wrap with only four symbols. Gated by a persisted pause toggle (`localStorage` key `cbt-tape-paused`) and CSS `@media (prefers-reduced-motion: reduce) { animation-play-state: paused }`; the toggle button overrides reduced-motion if the user explicitly wants play.
- **Three render states:**
  - *Live* — double-track scrolls, each tick renders `SYMBOL VALUE ▲/▼ ±N.NN%` (arrow + change% in `--market-up` / `--market-down`; flat = `•` in `--text-secondary`). `AS OF HH:MM UTC` right-pinned; pause/play toggle ⏸/▶ outside the track so it never scrolls off.
  - *Stale* (latest `tickedAt` older than 26h) — animation stopped, single static track, values in `--text-dim`, arrows dropped, pause button hidden, `AS OF HH:MM UTC · STALE` with the flag in `--accent-amber`. Weekend STALE is expected and correct (no trading-calendar logic in v1; honest AS OF stamp carries the age).
  - *No-data* (fetch threw or empty) — strip holds full height, em-dash placeholders per symbol, `MARKET DATA UNAVAILABLE` right-aligned in `--text-dim`, no scroll, no pause button.
- **Tokens:** the two allowed new vars `--market-up: #10b981` and `--market-down: #ef4444` live in `:root`. The exact hexes match `--stage-enacted` / `--party-republican` but are kept distinct so market direction never cross-wires with bill stage or party color.

### Server / client split

- All pages are server components and query Turso via `lib/queries.ts`.
- The dashboard at `/` is server-rendered apart from a small set of client islands: `DashboardBubbleChart` (URL-driven bubble navigation), `ActivityTabs` (local tab state), `MarketsTapeClient` (HO 149 marquee + pause), and `BillRowList` wrapper (HO 148 accordion, used on the feed-shaped pages but not the dashboard body itself). Charts (`StageFunnel`, `TopicMixByChamber`, `BillsTimeSeries`, etc.) remain static server components.
- Client islands: `components/WatchlistToggle.tsx` (POSTs to `/api/watchlist`, then `router.refresh()`) and `components/StageFilter.tsx` (calls `router.push` to update the URL with the chosen stage).
- The watchlist toggle is the only POST: `/api/watchlist` with `{billId, action: "add" | "remove"}`.

### Tooltip primitive (HO 147)

Rich-content tooltip component for marked affordances. Coexists with HO 123's native `title` attributes during the cleanup window — HO 154 owns the systematic migration off `title` to the primitive. Component (`components/Tooltip.tsx`) is a client island; positioning logic lives in `lib/tooltip-position.ts` (hand-rolled; no Floating UI / Popper dependency — flip/clamp/caret math is ~30 lines and a single component doesn't justify a runtime dep).

Two trigger affordances, one panel:

- **Dotted-underline term** (`variant="term"`). Wraps inline text; gains a 1px dotted `--text-dim` `border-bottom` (not `text-decoration`, so the inner colored text — stage/topic codes — keeps its own color). `cursor: help`, focusable, `aria-describedby` wired.
- **`?` badge** (`variant="badge"`). 16px bordered mono box for panel/section-level help. First applied in `ColorKeyStrip` next to the new `LEGEND` header row; pops the PARTIES / BILL TYPES / ACCENT body in one panel so the badge is forward-compatible with any future trim of those inline rows.

Panel renders via `createPortal` to `document.body` so it escapes overflow-hidden ancestors. `--bg-panel` bg, 1px `--border-strong`, 5px radius, ~9-11px padding, max-width 260px, 6px rotated-square caret tracking the trigger after horizontal clamping. **Static principle, no fade:** ~400ms hover-in delay (anti-flicker on dense layouts), instant out, instant appear — matches the dashboard's cursor-blink-only motion rule. Hover AND focus both open; Escape closes.

Content has two modes: `kind: "text"` (label + body) and `kind: "data"` (label + count + optional share% + click hint) — the data mode exists so chart-element handoffs (bubble drawer, scatter dots) import it instead of each chart inventing its own hover panel.

App-wide cut after HO 154.6: **coded terms use the Tooltip primitive; status/descriptive labels stay on native `title`.** Concretely the primitive wraps `StageIndicator` (every stage chip — `▸ COMMITTEE` etc. — surfaces `STAGE_LABELS`), `TopicTags` (every topic acronym — HLTH/IMM/FIN — surfaces `topicFullLabel`), and `BillIdRail`'s default chamber-label path (`HR` / `HJRES` / etc. surface `BILL_TYPE_LABELS`). Status surfaces stay on native `title`: `StagePillStrip`'s `3w in Committee`, `WatchStar`'s `Watching`, `MediaAttentionCell`'s `N news mentions, last 7 days`, `BillIdRail`'s caller-override `tooltip` prop (which carries the bill's full title — prose, not a code). When `BillIdRail` wraps inside `.bill-rail` the dotted-underline marker is suppressed (`.bill-rail .tooltip-term { border-bottom: none }`) because the underline doesn't read on a vertical block; hover/focus still pop the panel.

Initial HO 147 wiring: `ColorKeyStrip`'s `?` badge in the `.color-key-header` row pops the legend body; `StageLegend`'s `▸ COMMITTEE` chip was the original dotted-underline example (now joined by every other StageIndicator across the app via HO 154.6).

Coded-term content reads from the existing label maps (`BILL_TYPE_LABELS` / `STAGE_LABELS` / `RACE_RATING_SOURCES` in `lib/enums.ts`, `TOPIC_LABELS` / `TOPIC_FULL_LABELS` in `lib/topic-colors.ts`) — there is no separate `lib/labels.ts` despite some handoff text claiming so; the HO 123 sweep left the maps in their original homes.

### Chart idiom

Five charts ship today, split by what the chart needs:

- **divs + CSS** for 1-D bar rankings — `StageFunnel`, `TopicDistribution`, `TopicMixByChamber`. No coordinate system needed; values map directly to bar widths via CSS variables. Inherits the terminal aesthetic from `app/globals.css` with zero extra scaffolding.
- **Hand-rolled SVG** for charts that need a coordinate space — `BillsTimeSeries` (time on x, count on y), `MemberProductivityScatter` (bills on x · log scale, enacted rate on y · zoomed 0–30%, two side-by-side per chamber), `CommitteeActivityChart`. Each currently re-declares its own `viewBox`, axis-tick, and legend scaffolding; when a fourth SVG chart lands, extract the shared primitives.

No chart library. Recharts, D3, and Observable Plot are all available via npm, but the terminal aesthetic argues for control over convenience. Full per-chart inventory (data source, render location, state) lives in `docs/viz-audit.md`.

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

`StageFilter`, `TopicFilter`, `BillRow`, and `SearchBox` all accept an optional `basePath?: string` prop (default `/feed`) so they can be reused on `/stale` (or any future feed-shaped route). Each feed-shaped route either passes its own path (`/stale`, `/changes`, `/president`, etc.) or omits the prop and gets `/feed`. The dashboard at `/` does not render any of these components. `StageFilter` also accepts `availableStages?: readonly Stage[]` so `/stale` can hide `president` and `enacted` from the dropdown.

## Information architecture

Three depth levels for any entity in the dashboard (bills, members, races):

1. **Snapshot.** The row dropdown on a list page. Few fields, fast read. Answers "is this interesting enough to look deeper."
2. **Hub.** The entity detail page (`/bill/[id]`, `/members/[bioguideId]`, `/race/[id]`). Holds the thesis for that entity. Links out to focused sub-pages rather than embedding everything.
3. **Sub-page.** One topic about the entity, treated deeply. News mentions scoped to a bill, race detail for a member, similar-bills cluster, vote breakdown.

The hub holds the thesis. Sub-pages hold focused deep cuts. Curiosity drives navigation, not scrolling.

### Working theses

- **Bill hub** (`/bill/[id]`): "What does this bill do and how is it moving?" Summary, status, sponsor link, watchlist toggle. Sub-page links for similar bills, news mentions, votes, full text (out to congress.gov).
- **Member hub** (`/members/[bioguideId]`): "What does this person work on in Congress?" Voting record, sponsored bills, committee assignments, badges. Header indicators link to the race surface when applicable; donor and stock data live on sub-pages.
- **Race hub** (`/race/[id]`, planned): "Who's contesting this seat and where does it stand?" Sabato rating, third-party Cook ratings (handoff 71), seat-up year, candidate roster, incumbent link back to their member hub.

### The rule

For any new feature involving an entity page, decide whether it adds a snapshot field, a hub element, or a sub-page link. Don't invent a fourth bucket. If the answer is "it deserves its own section on the hub," that section probably wants to be a sub-page link instead.

Decide the hub's thesis before the second sub-page link ships, or the hub turns into the sub-page it's supposed to link to.

## News signal sources

v1 covers three RSS feeds: Politico, The Hill, Roll Call. URLs in `lib/news-sources.ts`. Cron tick fetches all three after sync + summarize + lead generation, regex-matches bill ids in `title + summary`, looks up against the `bills` table, and writes (bill_id, article_url) rows to `news_mentions`. Ingestion is best-effort — RSS errors are logged in the cron output and never fail the run. Local test: `npm run sync:news`.

The matching layer is `lib/bill-id-extract.ts` — a permissive regex covering all 8 bill types with whitespace and dot variants (`HR 1234`, `H.R. 1234`, `H. R. 1234`, `S.Res. 5`, `HJRes 12`, etc.). Bare-`S` matches require a context word (`bill`, `senate`, `legislation`, `act`, `amendment`, `measure`) or at least one dot to cut the obvious noise; everything else gets through and the false-positive rate gets measured formally in handoff 65 (matching accuracy validation against a hand-labeled sample). Fuzzy title matching, LLM disambiguation, and UI surfaces are explicitly deferred.

## Race surface

v1 covers the upcoming cycle for every sitting member's seat. Stubs come from `npm run backfill:races` (one-shot derivation from `members`). Ratings + candidate rosters are hand-curated in `data/races-seed.json` from Sabato's Crystal Ball (paywalled Cook and Inside Elections are skipped for v1), applied via `npm run seed:races`. Refresh quarterly. Polling, FEC fundraising, and district demographics are deferred sub-pages.

Race IDs are deterministic from member data (`raceIdFromMember` in `lib/race-id.ts`): House is `<STATE>-<DD>-<YYYY>` with a zero-padded district; Senate is `S-<STATE>-<YYYY>`. The backfill SQL is a translation of that function — if the format changes, update both. Members with `chamber='house'` and `district IS NULL` are excluded from the backfill so the id can never be malformed.

The hub thesis: "Who's contesting this seat and where does it stand?" The next-election chip on `/members/[bioguideId]` is the bridge from member hubs — the chip becomes a link to `/race/<id>` when the member has a non-null `next_election_year`. "Former member" remains text-only.

## Race ratings

Source-attributed forecaster ratings layered on top of the race surface (handoffs 71 + 73). v1 ships **Cook**, **Sabato**, and **Inside Elections** as separate rows under the same `race_ratings` schema. Three sources is the cap; the disagreement between them is the analytical signal (e.g. Cook moved OH to Toss Up on 2026-04-13 while Sabato and IE still had it Lean R). Ratings are hand-seeded from JSON files in `data/race-ratings-*.json` rather than scraped — the raters' public pages aren't stable enough to script for a quarterly cadence. Refresh quarterly by re-pulling each rater's page, editing the JSON, and running `npm run seed:ratings` (which globs the entire `data/race-ratings-*.json` set).

**Per-source vocabulary** — chips preserve the source's own labels verbatim:

| Rating string | Source(s)    | Score | Color           |
|---------------|--------------|-------|-----------------|
| Solid D / R   | Cook, IE     | ±3    | partisan        |
| Safe D / R    | Sabato       | ±3    | partisan        |
| Likely D / R  | all three    | ±2    | partisan        |
| Lean D / R    | all three    | ±1    | partisan        |
| Tilt D / R    | IE only      | ±1    | partisan        |
| Toss Up       | all three    |  0    | amber           |

`rating_score` is an integer. Tilt collapses to Lean for sort purposes — the `ABS(rating_score) <= 1` competitive filter still catches it, and ties within a score break on `updated_at DESC`. Don't introduce a decimal score type for Tilt's "between" semantic. Sabato's `Safe` is preserved on ingest; do not rewrite it to `Solid` because the source attribution is part of why the chip carries a rater name.

Rendering: `/race/[id]` shows the full source-attributed chip(s) (`[COOK · TOSS UP] · [SABATO · LEAN R] · [IE · LEAN R]`) inline in the header, separated by `·` when multiple sources exist. The member-hub seat-up chip extends to `Next election 2026 · TOSS UP` when a rating is present, but does not render the source name — at the member-hub level the chip is a glance signal, not a source citation; clicking through to `/race/[id]` is where source attribution lives. If no rating exists, both surfaces render without the chip (no "Not yet rated" placeholder — absence is the signal). The home-dashboard `CompetitiveRacesBlock` (handoff 72) uses the same `RatingChip` mapping, so multi-source rendering is free there too.

`getMostCompetitiveRaces` ranks by `MIN(ABS(rating_score))` across sources — a single Toss Up rating from any rater floats a race up. Tie-break on `MAX(updated_at) DESC` so freshly-moved races surface ahead of stale ones at the same lean. The competitive cut is `ABS(rating_score) <= 1`. Solid-rated House districts are intentionally **not** in any seed — 370+ rows of "Solid D"/"Solid R" with zero analytical value would pad the table.

**Adding a new rater label** is a three-file change: extend `RATING_SCORES` in `scripts/seed-race-ratings.ts` (the integer score), extend `colorFor` + `borderColorFor` in `components/RatingChip.tsx`, and extend `ratingColor` in `components/MemberHeader.tsx`. If any of the three is missed, the chip falls through to a muted gray.

## Caucus affiliations

v1 covers four caucuses: House Freedom Caucus, Republican Study Committee, Congressional Progressive Caucus, New Democrat Coalition. Rosters are hand-curated in `data/affiliations-seed.json` (one entry per caucus, `members` is an array of bioguide_id strings) and loaded via `npm run seed:affiliations`. Refresh quarterly: edit the JSON, bump `last_verified`, re-run the script — `INSERT ... ON CONFLICT` upserts in place. There is no auto-sync, no scraping; Freedom Caucus has no official public roster so Ballotpedia is the tracked-list proxy.

Display labels, party colors, and priority order live in `lib/caucus-config.ts` (single source of truth). The `affiliations` table accepts any `org` string — the config governs which orgs actually render. Sorting is by `priority` ASC: Freedom (1) > RSC (2) > Progressive (3) > New Dem (4). That order drives header truncation (top-2 badges only on `MemberHeader`'s meta line) and the full affiliations row below the stats block.

Identity caucuses (CBC, CHC, CAPAC), Problem Solvers, and the Squad are deferred to v1.5. Union endorsements and advocacy alignments are separate theme-6 sub-handoffs and reuse the same `affiliations` table with different `category` values.

## Runoff tracking

Runoffs (handoff 107) are modeled as **`primaries` rows**, not a separate table — a runoff is a primary-shaped per-(state, chamber, party) contest, so it reuses `primary_candidates`, `PRIMARY_SELECT`, `parseCandidatesRaw`, and `rowToPrimary` wholesale. The `primaries.election_round` column (`'primary'` | `'runoff'`, default `'primary'`) is the discriminator; runoff rows take the round-1 id with a `-runoff` suffix (e.g. `senate-LA-2026-R-runoff`). On a runoff row `primary_date` is the runoff's own election date and `runoff_date` is NULL; on the round-1 row `runoff_date` is the forward link to the runoff. Results reuse `primary_candidates.status` (`'running'` = pending, then `'winner'` / `'loser'` — `'loser'` is a new value, no migration) and `vote_pct`.

Louisiana's closed-primary system runs a **separate runoff per party**, so one race can have two runoff rows (`senate-LA-2026-D-runoff` + `senate-LA-2026-R-runoff`). v1 covers only the LA Senate 2026 race (Cassidy's seat — he was eliminated in the May 16 primary; R runoff Letlow vs Fleming, D runoff Davis vs Crockett, both June 27).

Query helpers: `getUpcomingPrimaries` / `getPastPrimaries` filter `election_round = 'primary'` so `/primaries` and `/races` stay primary-only; `getRunoffsForRace(raceId)` returns the runoff rows for a race (the `/race/[id]` page consumer). `getPrimaryForRace` is unaffected — it does an exact-id lookup and runoff ids are distinct. The primaries query helpers are uncached plain `db.execute`, so there is no cache tag to extend.

**Seed → scraper transition.** v1 ingestion is a **hand-curated seed** — `data/runoff-seeds/la-senate-2026.json`, loaded by `npm run seed:runoffs`. This is deliberate: the June 27 runoff has no results yet, and Ballotpedia had not built the Democratic runoff page at seed time (the Republican runoff votebox/sub-page exist; the Democratic one 404s). When a real Ballotpedia runoff scraper lands — a post-June-27 handoff, once results exist and both pages are built — it should **overwrite or retire the seed JSON**, not run alongside it. The Ballotpedia runoff votebox carries `race_header {party}` + an h5 reading `"… primary runoff …"`; note `parseCandidatesPage` currently *drops* `/runoff/`-headed voteboxes, so a runoff scraper needs that gate bypassed for runoff mode.

## Environment variables

```
CONGRESS_API_KEY=         # api.data.gov key
GEMINI_API_KEY=           # Google AI Studio key (free tier covers personal use)
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
CRON_SECRET=              # used to authenticate Vercel Cron hits to /api/sync
FMP_API_KEY=              # Financial Modeling Prep, free tier 250 calls/day
```

The cron route should reject requests where `Authorization` header doesn't match `Bearer ${CRON_SECRET}`.

## Pre-flight verification

Before writing acceptance criteria, parser branches, runtime estimates, or any code that depends on an assumption about the world, verify the assumption against the actual artifact. This is broader than API liveness — three handoffs in one session shipped wrong premises that a few minutes of pre-flight caught:

- **HO 96 (House West):** the handoff assumed CA top-two and AK top-four needed separate parser branches. Spot-checking CA-01 / WA-03 / AK-AL on Ballotpedia showed all three render the same nonpartisan votebox the existing `parseCandidatesPage` already handled via the `open` contest — zero parser work needed.
- **HO 97 (primaries cron):** the handoff proposed day-of-week dispatch, one region per weekday. Measuring West warm-cache at 152.9s showed every region exceeds the 60s Vercel ceiling on the per-district `sleep(1000)` alone — day-of-week was structurally non-viable, replaced with a cursor.
- **HO 93.5 (Louisiana):** the handoff said LA moved to closed partisan primaries for 2026 (legally true). The LA House Ballotpedia pages still render as nonpartisan voteboxes — so that is what the scraper sees and stores.

Pre-flight covers API endpoint liveness, third-party page structure, runtime cost on the actual platform, and schema column names — view `scripts/migrate.ts` for the real columns rather than recalling them from memory. (This handoff exists partly because HO 93.5's acceptance criteria referenced `primary_candidates.state` and `dashboard_state.total_targets`, neither of which exists.)

When sources disagree — legal reality vs. data source, vendor docs vs. third-party articles, training memory vs. the filesystem — the source of truth for the code being written wins. If the scraper reads Ballotpedia, Ballotpedia wins (see the data-source note under "Things to watch for").

## Things to watch for

- **Route-level `revalidate` does nothing in Next.js 15 for any page using `await searchParams` or `await params`.** Those async dynamic APIs opt the route into fully dynamic rendering, which disables the Full Route Cache regardless of the `revalidate` export. Confirmed in production: every response sent `Cache-Control: private, no-cache, no-store` and `X-Vercel-Cache: MISS`. Cache at the query layer with `unstable_cache` + `revalidateTag` instead — that's how `getFeedStats` and `getFeedBills` actually stay cached across requests. Every cached query helper is tagged with a single unified `"bills"` tag (commit `0693843`); the sync cron calls `revalidateTag("bills")` after writes to invalidate them all on fresh data.
- **The dashboard `/` is dynamically rendered, not statically prerendered.** Once `await searchParams` was added to `app/page.tsx` for click-to-filter (handoff 56), `/` lost its static prerender — same mechanism as the note above. Query-layer caching via `unstable_cache` + the `bills` tag still applies, so this is a small latency regression, not a correctness one.
- **Vercel serverless functions can't write to `process.cwd()`** — the filesystem is read-only outside `/tmp`. HO 97 caught this pre-deploy: the scraper's `writeCachedHtml` wrote the HTML cache under `process.cwd()`, fine locally but an `EROFS` crash on every cron tick in production. The fix swallows the write error (the cache is a perf optimization, not correctness). Any code that writes to disk from an API route must target `/tmp` or wrap the write in try/catch.
- **Vercel function timing runs ~2× local pre-flight measurements** — a cold-network tax. HO 97's primaries cron measured 5.5s for the calendar tick locally; the first production tick came in at 10.3s. Plan headroom from that ratio: a ~30s local measurement projects to ~60s in prod, the Hobby ceiling. `CRON_HOUSE_SLICE = 12` in `lib/primaries-sync.ts` sits comfortably under it (post-HO-120; the prior 20 was a ~67s prod projection that produced the orphan rows the fix closes) — treat ~30s of local tick time as the practical upper bound when tuning the slice size.
- **Vercel Hobby 60s cap + multi-step daily syncs = silent step-level failures unless each step is its own cron or has its own per-step timeout budget.** Five hits (HO 87 votes split, HO 115 summarize split, HO 116 runSync bound, HO 117 news split, HO 120 primaries time budget); treat as a load-bearing project principle, not a finding. HO 115 split summarize off `/api/sync` after it crept past its share around 2026-05-18 and quietly killed news/trades/report behind it — news went dark for four days with the only fingerprint being a `cron_runs` row stuck at `running`. HO 116 then bounded `runSync` with a 30s deadline + 15s per-detail `AbortController` because runSync alone projected to ~60s in prod on a normal day; without the bound, news would have starved again as runSync's tail grew. HO 117 split news into `/api/cron/news` after its per-step timing (added in HO 116) showed 48.7s of the 60s budget consumed by ~52 sequential LLM matcher calls — exactly the same shape as the summarize hang, caught by the instrumentation HO 116 added. HO 120 applied the pattern to `/api/cron/primaries` after HO 119 surfaced two implicit timeouts on the route: same `deadlineMs` + per-fetch `AbortController` plus one new wrinkle — **per-unit cursor commit**, because a single-cursor route advances the cursor at slice-end and a timeout discards the slice's partial progress entirely (the primaries cursor was stuck at 55 for two days through this exact pathology). The corollary rule (per-step timeout, plus per-unit progress commit on routes that carry a persistent cursor) is implemented identically across all four splits: `deadlineMs` checked at the top of each per-unit iteration, `AbortController` with a 8–15s timer threaded through every external call so a hung request can't blow the budget, and any persistent-pointer state (`bills.summarize_failed_at`, primaries cursor) committed per-unit so partial progress survives kill. When adding new work to a multi-step cron route: it gets its own deadline, or it goes on its own cron. Multi-step routes also stash per-step wall-clock in `cron_runs.payload.timings` (or `perUnitMs` for cursor-walking routes) so the next overrun is visible without instrumentation work first.
- **Vercel Hobby tier caps live logs at 30 minutes.** Past that window, the only record of a cron tick is the `cron_runs` table. Every cron route writes to it via `lib/cron-log.ts` (`startCronRun` / `finishCronRun`); read with `getRecentCronRuns` or `getLatestCronRun` from `lib/queries.ts`. Rows stuck at `status='running'` for over 120s are implicit timeouts — the Vercel runtime killed the function before `finishCronRun` could fire. The DB row stays `'running'` (it literally means "we don't know"); the query helpers reconcile it to `'timeout'` at read time without mutating the row.
- **`raw_json` stores the unwrapped `detailRes.bill` object, not the outer `{ bill: ... }` wrapper.** So `json_extract(raw_json, '$.cosponsors.count')` works; `'$.bill.cosponsors.count'` always returns NULL. Verify the path with a quick `SELECT json_extract(raw_json, '$...') FROM bills LIMIT 5` before writing any new backfill that pulls from `raw_json`.
- **Member endpoint quirks** — three things the `/member/{bioguideId}` response does that contradict some Congress.gov docs and template snippets:
  - `member.terms` is the term array directly. **Not** `member.terms.item`. Iterating `member.terms?.item ?? []` silently returns nothing.
  - Party comes from `member.partyHistory` (sorted by `startYear` desc). `member.partyName` does not exist on the response. Pull `partyAbbreviation` (one-letter `R`/`D`/`I`); a substring match on `partyName` against the abbreviation falls through to `I` for everyone.
  - `endYear` is **omitted on the active term** (the one for the current Congress). Derive it from chamber + `startYear`: senate → `startYear + 6`, house → `startYear + 2`. `next_election_year = current_term_end_year - 1` (terms end Jan 3 of an odd year, election the prior November). Members appointed mid-term may still have non-standard spans; spot-check after sync.
- **Adding a new caucus** is a two-file change: extend `CaucusOrg` + `CAUCUS_CONFIG` in `lib/caucus-config.ts`, then add an entry to `data/affiliations-seed.json` and re-run `npm run seed:affiliations`. The `affiliations` table accepts any `org` string — the config is the gate that decides what renders. Rows for orgs missing from `CAUCUS_CONFIG` are filtered out by `getMemberAffiliations` (won't appear in the UI; won't break it either). Removing a caucus is the same but in reverse — and `WHERE org = ?` DELETE from `affiliations` to drop stale rows.
- **Race IDs are deterministic from member data via `raceIdFromMember`** (`lib/race-id.ts`). The backfill SQL is a translation of that function; if the format ever changes (mid-decade redistricting, new chamber, etc.), update both. Members with `chamber='house'` and `district IS NULL` are filtered out of the backfill so the id can't be malformed.
- **The House incumbent matcher tolerates mid-decade redraws** (HO 94). `primary_candidates` rows are keyed to the *election* map the scrape source (Ballotpedia) uses; `members` is keyed to the *current Congress* map from Congress.gov. After a mid-decade redraw (TX 2025) those disagree — Al Green sits at TX-9 in `members` but runs in TX-18 on the 2026 map. `matchHouseCandidate` in `scripts/sync-primaries.ts` matches on `(state, district)` first, then falls back to `(state, last_name)` against the state's current House delegation — gated on the candidate's incumbent flag so a same-surname challenger is never misattributed. Both incumbent indexes are filtered to `is_current = 1`, which also resolves a member-replacement collision (Turner and Menefee both keyed TX-18 after the special election). Do **not** "fix" the `members` district numbers to match the election map — the two maps are allowed to disagree, and the matcher is what bridges them. Re-run the matcher with `npm run sync:rematch` after a members refresh.
- **Senate term derivation is non-trivial** — the Congress.gov `/member/{bioguideId}` endpoint returns one entry per 2-year Congress, not one per 6-year senate term. Use `lib/derive-term.ts` (`senateTermStart` walks the contiguous run ending at the latest Congress and computes the offset within the 3-Congress cycle), not raw `startYear + 6` math. Naive math collapses every continuously-serving senator to `next_election_year = 2030` (the handoff-60 bug fixed by handoff 63). Verification: `SELECT COUNT(*) FROM races WHERE chamber='senate'` should be ~90-100 across three cycles (2026, 2028, 2030).
- **RSS feed URLs drift.** If `news_mentions` stops growing, first thing to check is whether each feed in `NEWS_SOURCES` (`lib/news-sources.ts`) still returns valid XML. Publishers sometimes move feeds (e.g., `/policy/congress/feed/` instead of `/homenews/feed/`) without redirects. The cron logs per-source `fetched=N mentions=N skipped_unknown_bill=N` counts, so a flatlined source is visible in Vercel logs. Backup URLs: Politico → `https://www.politico.com/rss/politicopicks.xml`; The Hill → `https://thehill.com/policy/congress/feed/`; Roll Call → their RSS directory.
- **Special-election winners and mid-term appointees are misclassified by `senateTermStart`** — their first senate Congress is a partial-term fill, not a regular term start, so the 3-Congress modular math anchors to the wrong cycle. Known affected senators as of 2026-05-16: Markey (MA), Warnock (GA), Kelly (AZ), Husted (OH), Moody (FL), and Cornyn (TX — sworn in Dec 2002 during Congress 107 when Phil Gramm resigned early). Symptom: two senators from the same state land in the same `next_election_year` (`SELECT state, next_election_year, COUNT(*) FROM members WHERE chamber='senate' GROUP BY state, next_election_year HAVING COUNT(*) > 1`). Fix path when a real collision matters: hand-correct the rows with `UPDATE members SET next_election_year = ?, current_term_end_year = ? WHERE bioguide_id = ?` and re-run `npm run backfill:races`. Auto-correction would need an external class mapping; out of scope for v1.
- **FMP daily quota.** Free tier is 250 calls/day. The cron uses 1-3 calls per chamber per tick (3-page cap); initial backfill via `npm run sync:trades` caps at 20 pages per chamber so a first run can't burn the cap. FMP endpoint paths have been renamed historically — current paths are `/stable/senate-latest` and `/stable/house-latest` (the `/api/v4/senate-trading` + `/api/v4/senate-disclosure` paths were retired). If `npm run sync:trades` returns zero rows or a 404, the docs are the first thing to check (`https://site.financialmodelingprep.com/developer/docs`).
- **FMP free-tier pagination cap.** On `/stable/` endpoints, `?page=N` for any `N > 0` returns `402 "The values for 'page' can only be 0 based on your current subscription."` Only the paid tier paginates. Each `-latest` endpoint returns the 100 most-recent disclosures on page 0 and that's it. Daily incremental sync works fine — page 0 keeps refreshing top-of-feed — but historical backfill via this script is **effectively capped at 100 rows per chamber per run** regardless of the 20-page CLI cap. To seed historical depth, upgrade the FMP tier or switch source. The 402 line shows up in `sync-trades` output after page 0's data is already inserted; it's cosmetic, not data loss.
- **Name-to-bioguide matching is best-effort.** `stock_trades.bioguide_id` is nullable; unmatched FMP names get inserted with NULL and don't appear on member hubs (`getMemberTrades` filters by `bioguide_id = ?`). Audit periodically with `SELECT COUNT(*) FROM stock_trades WHERE bioguide_id IS NULL` and `SELECT DISTINCT member_name_raw FROM stock_trades WHERE bioguide_id IS NULL`. Tighten `lib/matchMember.ts` (state-hint fallback, nicknames) before assuming the data is incomplete.
- **Race ratings are hand-seeded.** The three `data/race-ratings-*.json` files (Cook, Sabato, Inside Elections — handoffs 71 + 73) are the source of truth. Refresh quarterly by re-checking each rater's page and updating the JSON, then running `npm run seed:ratings` (it globs all three). The raters update ratings infrequently between cycles, so quarterly is more than enough. The seed files' `race_id` keys are aligned to the existing `S-<STATE>-<YYYY>` / `<STATE>-<DD>-<YYYY>` format — Wikipedia-pulled ids originally used `<STATE>-SEN-<YYYY>` / `<STATE>-SEN-SP-<YYYY>`, find-replaced in place when the seed was first applied. Senate specials collapse onto the regular-cycle id because the races table keys senate seats by `next_election_year` alone. **Source recall is not a substitute for sourced data here** — if a rater moves a race, update the JSON from the rater's page, don't hand-write a rating from memory.
- **Vote sync is on its own cron** (`/api/sync-votes`, 10:00 UTC daily — handoff 87), separate from `/api/sync` because a busy week's 400+ vote rows × 2-3 API hops each can approach the 60s ceiling. Both syncs are incremental (watermark per session for Senate, MAX(vote_date) for House) so a long tick resumes next day; still runnable by hand via `npm run sync:votes` / `npm run sync:senate-votes`. See the "Cron topology" subsection under Sync logic for the full five-cron picture.
- **Ballotpedia nonpartisan House primaries (HO 96, +93.5).** Four states run a single all-candidate House primary instead of split D/R primaries: CA + WA (top-two), AK (top-four), and LA (nonpartisan all-candidate — HO 93.5; the handoff expected closed partisan D/R but every 2026 LA House page renders one nonpartisan votebox). `parseCandidatesPage` (`lib/primary-candidates-scrape.ts`) routes these to the `"open"` contest. Two markup variants: CA/WA/AK voteboxes carry `<div class="race_header nonpartisan">` and tag each candidate's party on the `image-candidate-thumbnail-wrapper` class; LA voteboxes carry a **bare `<div class="race_header">`** (contest type only in the `<h5>` — the parser falls back to the header text) and put party in a **`(R)`/`(D)` suffix** after the candidate link (`openContestParty` tries the wrapper, then the suffix). There is no separate top-two/top-four/jungle parser and none is needed. `syncHouseDistricts` (`lib/primaries-sync.ts`) picks the contest set per district from `NONPARTISAN_HOUSE_STATES` — `["open"]` for CA/WA/AK/LA, `["D","R"]` elsewhere — storing rosters under a `house-{ST}-{DD}-2026-open` primary id with `party='open'`. If a state's pages ever switch shape (e.g. LA actually adopting D/R voteboxes), the structural guard in `syncHouseDistricts` logs it and the state should leave `NONPARTISAN_HOUSE_STATES`.
- **The data source's current representation wins over external reality.** Louisiana is legally on closed partisan primaries for 2026 federal races, but Ballotpedia still renders LA House races as nonpartisan voteboxes — so the scraper stores them as nonpartisan. When web research contradicts what the scrape target actually publishes, the scrape target is the source of truth for the code.
- **Special-election pages are page-type-aware in `parseCandidatesPage` (HO 106).** FL and OH have 2026 Senate specials; `scrapeSenateCandidates` falls back to `senateSpecialPageUrl` when the regular page 404s. On a dedicated special-election page *every* votebox `<h5>` reads "Special …", so the parser's "drop anything special" gate is inverted via `onSpecialPage` (self-detected from the page `<title>` by `isSpecialElectionPage`): on a special page the "Special D/R primary" boxes are the rosters to keep and an embedded *regular* box would be dropped; on a regular page the gate is unchanged, so an embedded special-primary box is still dropped. The House scraper never feeds `parseCandidatesPage` a special page (it returns `status:"special"` first). Note `parseCandidatesPage` still models only D/R/open contests — OH's "Special Libertarian primary" votebox is skipped, matching the `primaries` schema's `party` domain.
- **Senate has no Congress.gov vote coverage.** Vote data comes from XML on senate.gov (LIS feed). The XML keys members by `lis_member_id` (e.g. "S428"), but the Congress.gov member API **does not expose LIS IDs** — neither the list endpoint nor the per-member detail. `lib/lis-map.ts` works around this by matching `(last_name, state)` against the `members` table, with an NFD diacritic fold (senate.gov strips accents: "Lujan" ↔ "Luján"). A small `SENATOR_BIOGUIDE_FALLBACK` table covers senators absent from `members` — current entries: Rubio (FL → resigned Jan 2025), Vance (OH → resigned to become VP), Armstrong (OK → seated Jan 2026, no sponsorships yet). Audit when a new vote-XML warning appears in sync output (`no bioguide match: <name> (<state>) lis=<id>`) — usually means a new appointee/special-election winner needs adding, or `sync:members` is overdue.
- **`votes.chamber` is lowercase**, matching the `bills.bill_type` convention (`hr` / `s` / `house` / `senate`). The handoff drafts for the vote pipeline initially used `'House'`/`'Senate'`; ingest writes lowercase and every query/UI consumer expects lowercase. If a query suddenly returns no rows for what looks like a correct chamber, check casing first.
- **`member_votes.position` is normalized lowercase** (`yea | nay | present | not_voting`). Source data varies ("Aye", "Yes", "No", "Absent"); the sync folds it. New consumers must lowercase before comparing — `WHERE position = 'Yea'` matches nothing.
- **Weekly report LEAD generation uses Gemini 2.5 Flash with thinkingBudget=8192** (`lib/report-generation.ts`). Raised from 0 in HO 112.1 — the prior config disabled thinking entirely, which masked HO 112's prompt improvements (LEADs count-led despite the synthesize-the-throughline rule). Banned-phrase morphological variant leakage ("significantly" when "significant" is banned) still occurs at ~1-in-3 frequency under this config; HO 112.2 layers a regenerate-on-violation regex check as the deterministic fix.
- **Weekly report generation uses two-layer banned-phrase compliance** (`lib/report-generation.ts`):
  1. SYSTEM_PROMPT interpolates `BANNED_STEMS` with a stem-and-inflection framing ("never write any word built on these stems, in any inflection or register"). This was the primary fix added in HO 112.2; across 13 verification generations on the previously-failing 2026-05-11 week, zero banned-phrase leaks occurred.
  2. `generateReportWithRetry` wraps the Flash call with a `scanBanned` regex check; on any stem-variant match, one retry with a corrective prompt naming the violating phrase is issued before shipping. This is the deterministic backstop, verified end-to-end via forced violation during HO 112.2 development; idle in normal operation.

## What not to do

- Don't add user accounts or auth. This is single-user.
- Don't fetch bills live from the browser. Everything reads from Turso.
- Don't store the LLM prompt in the database. Keep it in source so it's versioned with the code.
- Don't summarize every bill in Congress. Summarize on demand: a bill gets a summary the first time it appears in the feed query window with a topic match.
