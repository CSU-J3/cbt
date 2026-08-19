import "dotenv/config";
import { createClient } from "@libsql/client";
import { getDb } from "../lib/db";

type Db = ReturnType<typeof getDb>;

// A LONG-TIMEOUT client for index builds only. `getDb()` rides lib/db.ts's
// 10s DB_REQUEST_TIMEOUT_MS bound, which is correct for the request path and
// wrong for DDL: an index build over a fat table runs well past 10s, the client
// aborts, and migrate.ts exits non-zero even though the SERVER completed the
// build (HO 406 hit this on the bills partial index; HO 597 hit it again on
// idx_lda_filings_activity over 129,338 rows — the index landed, the script
// still threw). Use this for CREATE INDEX on any large table; everything else
// stays on the bounded client.
function getLongTimeoutDb(): Db {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    fetch: (i: RequestInfo | URL, init?: RequestInit) =>
      fetch(i, { ...init, signal: AbortSignal.timeout(300_000) }),
  });
}

const statements = [
  `CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    congress INTEGER NOT NULL,
    bill_type TEXT NOT NULL,
    bill_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    introduced_date TEXT,
    latest_action_date TEXT,
    latest_action_text TEXT,
    sponsor_name TEXT,
    sponsor_party TEXT,
    sponsor_state TEXT,
    update_date TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    summary TEXT,
    summary_model TEXT,
    summary_updated_at TEXT,
    topics TEXT,
    stage TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bills_update_date ON bills(update_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_bills_latest_action ON bills(latest_action_date DESC)`,
  // HO 406: bound the summarize queue read to the unsummarized set. HO 383
  // dropped the SQL LIMIT to fetch the full null set for app-side stage-priority
  // sorting; at 1,374 nulls that read became `SCAN bills USING INDEX
  // idx_bills_update_date` over all 16,623 rows (the summarize doom loop — cost
  // scales with the backlog). Partial `WHERE summary IS NULL` keyed
  // `update_date DESC` so the read is a ~null-count partial-index scan that ALSO
  // serves the existing `ORDER BY update_date DESC` with no sort step; the fat
  // columns (title, latest_action_text, …) row-look-up per null row. The
  // app-side computeStage priority sort is preserved (stored `stage` is stale by
  // design — that is HO 383's bug — so an SQL stage sort can't replace it).
  // runSummarize's queue read (lib/summarize-runner.ts) forces it via INDEXED BY
  // (statless Turso planner won't take a partial index unhinted). Predicate is
  // `summary IS NULL` only — the
  // summarize_failed_at defer + is_ceremonial exclusion are cheap residual
  // filters over the ~1,374 scanned rows.
  `CREATE INDEX IF NOT EXISTS idx_bills_summarize_queue ON bills(update_date DESC) WHERE summary IS NULL`,
  // HO 356 (A2): per-user watchlist. Composite PK (user_id, bill_id) — one row
  // per (user, bill), so two users can both watch the same bill. FK to users(id)
  // (HO 355). Existing single-user prod rows were rebuilt + seeded to the lone
  // users.id by scripts/migrate-watchlist-userid.ts; this canonical shape makes
  // fresh DBs born correct. The composite PK covers `WHERE user_id = ?`, so the
  // read drive order needs no extra index.
  `CREATE TABLE IF NOT EXISTS watchlist (
    user_id TEXT NOT NULL REFERENCES users(id),
    bill_id TEXT NOT NULL REFERENCES bills(id),
    added_at TEXT NOT NULL,
    notes TEXT,
    PRIMARY KEY (user_id, bill_id)
  )`,
  // Key-value store for cron-generated dashboard content. Flexible so future
  // dashboard state (other generated text, cached aggregates) needs no further
  // migration. RECORD (HO 667): the original tenant was key = 'weekly_lead'
  // (the dashboard lead), retired at HO 667 — the TABLE stays and carries the
  // kalshi, committees-cursor, primaries-cursor, cron-lock and LDA-rollup keys.
  `CREATE TABLE IF NOT EXISTS dashboard_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // Weekly cron-generated reports. One row per calendar week (Mon-Sun),
  // keyed by the ISO week-start date.
  `CREATE TABLE IF NOT EXISTS reports (
    slug TEXT PRIMARY KEY,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    title TEXT NOT NULL,
    content_md TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reports_week_start ON reports(week_start DESC)`,
  // handoff 60: members table. One row per Congress.gov member. Backs the
  // /sponsors/[bioguideId] member hub. Populated by `npm run sync:members`.
  `CREATE TABLE IF NOT EXISTS members (
    bioguide_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    party TEXT,
    state TEXT,
    state_name TEXT,
    district INTEGER,
    chamber TEXT,
    birth_year INTEGER,
    depiction_url TEXT,
    current_term_end_year INTEGER,
    next_election_year INTEGER,
    senate_class INTEGER,
    terms_json TEXT,
    raw_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_members_state ON members(state)`,
  `CREATE INDEX IF NOT EXISTS idx_members_next_election ON members(next_election_year)`,
  // handoff 61: hand-curated caucus / advocacy affiliations. One row per
  // (bioguide_id, org). FK to members; rows are seeded via
  // `npm run seed:affiliations`. `category` is 'caucus' in v1 and reserved
  // for 'union' / 'advocacy' in later theme-6 sub-handoffs.
  `CREATE TABLE IF NOT EXISTS affiliations (
    bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
    org TEXT NOT NULL,
    category TEXT NOT NULL,
    source_url TEXT,
    last_verified TEXT NOT NULL,
    PRIMARY KEY (bioguide_id, org)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_affiliations_org ON affiliations(org)`,
  `CREATE INDEX IF NOT EXISTS idx_affiliations_bioguide ON affiliations(bioguide_id)`,
  // handoff 62: race surface. One row per (state, district/senate, cycle).
  // Stubs auto-derived from `members` via `npm run backfill:races`; rating
  // and candidate roster hand-curated via `npm run seed:races`. Rating
  // string is one of the seven Sabato categories (nullable until seeded).
  `CREATE TABLE IF NOT EXISTS races (
    id TEXT PRIMARY KEY,
    cycle INTEGER NOT NULL,
    chamber TEXT NOT NULL,
    state TEXT NOT NULL,
    district INTEGER,
    rating TEXT,
    rating_source TEXT,
    rating_updated_at TEXT,
    incumbent_bioguide_id TEXT REFERENCES members(bioguide_id),
    source_url TEXT,
    last_verified TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_races_cycle ON races(cycle)`,
  `CREATE INDEX IF NOT EXISTS idx_races_state ON races(state)`,
  `CREATE INDEX IF NOT EXISTS idx_races_chamber ON races(chamber)`,
  `CREATE INDEX IF NOT EXISTS idx_races_incumbent ON races(incumbent_bioguide_id)`,
  `CREATE INDEX IF NOT EXISTS idx_races_rating ON races(rating)`,
  `CREATE TABLE IF NOT EXISTS race_candidates (
    race_id TEXT NOT NULL REFERENCES races(id),
    name TEXT NOT NULL,
    party TEXT,
    bioguide_id TEXT REFERENCES members(bioguide_id),
    status TEXT,
    source_url TEXT,
    PRIMARY KEY (race_id, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_race_candidates_race ON race_candidates(race_id)`,
  `CREATE INDEX IF NOT EXISTS idx_race_candidates_bioguide ON race_candidates(bioguide_id)`,
  // HO 393: pro-Israel-PAC independent-expenditure DIRECTION on competitive race
  // cards. One row per (committee, target, support/oppose, cycle) — ~8-12 rows,
  // UDP-only (C00799031) in v1. We ship DIRECTION (who's backed/opposed), a
  // per-row fact from raw FEC Schedule E that needs no dedup; the magnitude is
  // delivered by deep-linking each direction to the live FEC filings, so the app
  // never asserts a dollar total it can't stand behind (see docs/oddities.md —
  // Schedule E has no clean dollar source). `amount` is NULLABLE + unpopulated in
  // v1, reserved so an audited dollar backfill can layer in without a rebuild.
  // race_id resolved at sync time by table lookup (office/state/district →
  // races). earliest/latest_date = MIN/MAX(expenditure_date) over the group.
  `CREATE TABLE IF NOT EXISTS pac_ie_spending (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    committee_id TEXT NOT NULL,
    spender TEXT NOT NULL,
    race_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    candidate_name TEXT NOT NULL,
    support_oppose TEXT NOT NULL,
    amount REAL,
    earliest_date TEXT,
    latest_date TEXT,
    cycle INTEGER NOT NULL,
    as_of TEXT NOT NULL,
    UNIQUE(committee_id, candidate_id, support_oppose, cycle)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pac_ie_race ON pac_ie_spending(race_id, cycle)`,
  // handoff 64: news signal pipeline. One row per (bill_id, article_url)
  // — the UNIQUE constraint makes re-ingestion idempotent. A single article
  // can match multiple bills, generating one row per pair. `matched_via`
  // and `match_confidence` are forward-looking: v1 is regex-only
  // (deterministic, NULL confidence); fuzzy/LLM layers in 65+ will use 0-1.
  `CREATE TABLE IF NOT EXISTS news_mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id TEXT NOT NULL REFERENCES bills(id),
    source TEXT NOT NULL,
    article_url TEXT NOT NULL,
    article_title TEXT NOT NULL,
    article_summary TEXT,
    published_at TEXT NOT NULL,
    matched_via TEXT NOT NULL,
    match_confidence REAL,
    ingested_at TEXT NOT NULL,
    UNIQUE(bill_id, article_url)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_news_mentions_bill ON news_mentions(bill_id)`,
  `CREATE INDEX IF NOT EXISTS idx_news_mentions_published ON news_mentions(published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_news_mentions_source ON news_mentions(source)`,
  // handoff 70: stock trades from FMP disclosures. Composite id keys the
  // table because FMP doesn't return a stable filing id (bioguide-disclosure
  // date-ticker-transaction date-amount; re-ingestion is idempotent via
  // INSERT OR IGNORE). bioguide_id nullable so unmatched rows still land —
  // matcher is best-effort and audit-by-SELECT-WHERE-NULL is the workflow.
  `CREATE TABLE IF NOT EXISTS stock_trades (
    id TEXT PRIMARY KEY,
    bioguide_id TEXT REFERENCES members(bioguide_id),
    member_name_raw TEXT NOT NULL,
    chamber TEXT NOT NULL,
    ticker TEXT,
    asset_description TEXT,
    transaction_type TEXT,
    transaction_date TEXT,
    disclosure_date TEXT,
    amount TEXT,
    owner TEXT,
    raw_json TEXT NOT NULL,
    ingested_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trades_bioguide ON stock_trades(bioguide_id)`,
  `CREATE INDEX IF NOT EXISTS idx_trades_disclosure_date ON stock_trades(disclosure_date DESC)`,
  // handoff 65: donors pipeline. Three tables — top 10 donors per (member,
  // cycle), top 5 industries per (member, cycle), fundraising totals per
  // (member, cycle). All money columns are INTEGER cents to avoid float
  // precision drift on aggregation. Rank in the PK lets re-ingest cleanly
  // overwrite: DELETE WHERE bioguide_id=? AND cycle=? then INSERT rank 1..N.
  `CREATE TABLE IF NOT EXISTS member_donors (
    bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
    cycle INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    org_name TEXT NOT NULL,
    total INTEGER NOT NULL,
    pacs INTEGER,
    indivs INTEGER,
    source_url TEXT,
    ingested_at TEXT NOT NULL,
    PRIMARY KEY (bioguide_id, cycle, rank)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_member_donors_org ON member_donors(org_name)`,
  `CREATE TABLE IF NOT EXISTS member_industries (
    bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
    cycle INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    industry_name TEXT NOT NULL,
    total INTEGER NOT NULL,
    source_url TEXT,
    ingested_at TEXT NOT NULL,
    PRIMARY KEY (bioguide_id, cycle, rank)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_member_industries_name ON member_industries(industry_name)`,
  `CREATE TABLE IF NOT EXISTS member_fundraising (
    bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
    cycle INTEGER NOT NULL,
    total_raised INTEGER NOT NULL,
    total_spent INTEGER,
    cash_on_hand INTEGER,
    debts INTEGER,
    source_url TEXT,
    ingested_at TEXT NOT NULL,
    PRIMARY KEY (bioguide_id, cycle)
  )`,
  // Generic key/value table for sync checkpoint state. One row in v1:
  // key='donors_cursor', value=last-processed bioguide_id. Cleared when a
  // run finishes the full member list.
  `CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // HO 218: per-seat Kalshi prediction-market odds. One row per race_id (our
  // raceId form, e.g. "PA-07-2026" / "S-ME-2026"). Loose link to races.id (no
  // FK) — the fetcher writes every 2026 House/Senate general seat Kalshi runs,
  // including ones we don't rate; getRacesIndex's LEFT JOIN picks the 137.
  // Refreshed by the GitHub Actions cron (/api/cron/kalshi); odds move intraday.
  // favorite_is_party=1 when the outcome label is a bare party string (~65% of
  // markets) vs a candidate name; favorite_party is set only for party labels
  // (name labels resolve to a party at render via the card roster).
  `CREATE TABLE IF NOT EXISTS kalshi_odds (
    race_id TEXT PRIMARY KEY,
    cycle INTEGER NOT NULL,
    event_ticker TEXT NOT NULL,
    implied_pct INTEGER NOT NULL,
    favorite_label TEXT NOT NULL,
    favorite_is_party INTEGER NOT NULL,
    favorite_party TEXT,
    open_interest INTEGER,
    close_time TEXT,
    updated_at TEXT NOT NULL
  )`,
  // HO 256: per-seat Polymarket Senate odds, parallel to kalshi_odds. Source is
  // the Gamma read API (gamma-api.polymarket.com, public/no-auth, egress-
  // reachable — HO 255 probe). Per-seat Senate coverage is 34/35 seats (only AL
  // absent). `slug` is the Gamma event slug (~ kalshi's event_ticker). volume +
  // liquidity (event-level, USD) are stored as REAL so a downstream card can
  // flag thin markets; true ghosts are excluded at fetch. favorite_is_party=1
  // for a bare party-word outcome; favorite_party is set from a "(R)" suffix or
  // party word, null for a name-only label (resolved at render). Written by the
  // same per-seat odds cron as kalshi (/api/cron/kalshi). Loose race_id link.
  `CREATE TABLE IF NOT EXISTS polymarket_odds (
    race_id TEXT PRIMARY KEY,
    cycle INTEGER NOT NULL,
    slug TEXT NOT NULL,
    implied_pct INTEGER NOT NULL,
    favorite_label TEXT NOT NULL,
    favorite_is_party INTEGER NOT NULL,
    favorite_party TEXT,
    volume REAL,
    liquidity REAL,
    end_date TEXT,
    updated_at TEXT NOT NULL
  )`,
  // handoff 71: race ratings from third-party forecasters (Cook v1; Sabato
  // and Inside Elections layer in later as additional rows). Composite id
  // = race_id-source so re-seeding upserts in place. race_id is a loose
  // link to races.id (no FK constraint) — ratings can sit ahead of race
  // rows existing, useful when the seed runs before the next-election
  // year flips. rating_score is a -3..+3 numeric proxy for sorting by
  // competitiveness without parsing strings; |rating_score| <= 1 is the
  // "competitive" filter.
  `CREATE TABLE IF NOT EXISTS race_ratings (
    id TEXT PRIMARY KEY,
    race_id TEXT NOT NULL,
    source TEXT NOT NULL,
    rating TEXT NOT NULL,
    rating_score INTEGER NOT NULL,
    rating_date TEXT,
    source_url TEXT,
    cycle INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ratings_race ON race_ratings(race_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ratings_score ON race_ratings(rating_score)`,
  // HO 220: rating-history change-detect log. Append-only (the market_ticks
  // precedent), one row per (race_id, source) per actual rating MOVE — a daily
  // cron (/api/cron/rating-history) compares live race_ratings to the latest
  // logged value and appends ONLY on a score/label diff (rating_date is carried
  // but NOT part of the predicate — a same-rating re-publish must not log a
  // noise point). First run logs every current rating as the baseline; static
  // days log zero. `rating` mirrors race_ratings.rating (verbatim label);
  // `rating_date` is the rater's published date (better sparkline x-axis than
  // observation), `observed_at` is the day WE logged it (honest fallback).
  // UNIQUE(race_id, source, observed_at) makes a same-day re-run a no-op.
  // No sparkline yet — this just plants the tree (HO 220 is data capture only).
  `CREATE TABLE IF NOT EXISTS rating_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id TEXT NOT NULL,
    source TEXT NOT NULL,
    rating_score INTEGER NOT NULL,
    rating TEXT NOT NULL,
    rating_date TEXT,
    observed_at TEXT NOT NULL,
    UNIQUE(race_id, source, observed_at)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rating_history_race_source ON rating_history(race_id, source, observed_at)`,
  // handoff 77: House roll-call votes. `id` is 'house-{congress}-{session}-
  // {rollCall}'. `bill_id` references bills.id when the vote attaches to a
  // bill; NULL for amendment/procedural votes whose legislationType doesn't
  // map (those land in amendment_designation as raw 'HAMDT5' etc.). totals
  // are summed across votePartyTotal[] at ingest time so reads don't have
  // to re-aggregate. Senate ships in a separate handoff (XML scraping).
  `CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    chamber TEXT NOT NULL,
    congress INTEGER NOT NULL,
    session INTEGER NOT NULL,
    roll_call INTEGER NOT NULL,
    vote_date TEXT NOT NULL,
    question TEXT,
    description TEXT,
    result TEXT,
    bill_id TEXT REFERENCES bills(id),
    amendment_designation TEXT,
    yea_count INTEGER NOT NULL,
    nay_count INTEGER NOT NULL,
    present_count INTEGER,
    not_voting_count INTEGER,
    raw_json TEXT NOT NULL,
    update_date TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_votes_chamber_date ON votes(chamber, vote_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_votes_bill_id ON votes(bill_id) WHERE bill_id IS NOT NULL`,
  // bioguide_id intentionally NOT a FK to members — vote records include
  // members who haven't been synced yet (or have since left) and we never
  // want a missing-member row to block the position insert. Join at
  // query time.
  `CREATE TABLE IF NOT EXISTS member_votes (
    vote_id TEXT NOT NULL REFERENCES votes(id),
    bioguide_id TEXT NOT NULL,
    position TEXT NOT NULL,
    PRIMARY KEY (vote_id, bioguide_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_member_votes_bioguide ON member_votes(bioguide_id)`,
  // HO 595: the materialized participation aggregate — one row per bioguide_id
  // seen in member_votes (~554). This exists to get member_votes OFF the request
  // path entirely. HO 594 proved indexing cannot do that: a covering index still
  // has to read pages that aren't resident, and co-located the first touch after
  // a >60s gap costs 8.2-14.1s against the 10s DB_REQUEST_TIMEOUT_MS (worst
  // 20.005s, both retry attempts lost). Cron warming can't do it either — page
  // residency is under 60s, tighter than cron granularity. A ~554-row table is
  // permanently resident: measured co-located, a small-table read never spiked
  // cold across 90s-gapped runs (dashboard_state single key 15/26/15ms).
  //
  // COUNTS, NOT THE DERIVED RATE. `total` + `not_voting` are exact integers and
  // every consumer keeps deriving its own value from them the same way it does
  // today — the CTE wants a 0-1 fraction, getParticipationStrip wants 0-100.
  // Storing a pre-divided rate would silently pick one and re-unit the other.
  //
  // NO FLOOR APPLIED HERE. PARTICIPATION_FLOOR stays a query-time constant so the
  // shipped HAVING semantics are byte-identical; a member below the floor is
  // absent from the CTE (LEFT JOIN -> NULL) exactly as before.
  `CREATE TABLE IF NOT EXISTS member_participation (
    bioguide_id TEXT PRIMARY KEY,
    total INTEGER NOT NULL,
    not_voting INTEGER NOT NULL,
    refreshed_at TEXT NOT NULL
  )`,
  // handoff 90: USCPR Senate Palestine voting scorecard. One row per
  // (Senate Democrat) member, keyed by bioguide_id. Synced from a public
  // Google Sheet via `npm run sync:palestine` — the sheet is the
  // authoritative source, no LLM matching. `votes_json` is a JSON object
  // mapping each vote/sponsorship label to its raw outcome string.
  `CREATE TABLE IF NOT EXISTS palestine_scorecard (
    bioguide_id TEXT PRIMARY KEY REFERENCES members(bioguide_id),
    grade TEXT,
    rank INTEGER,
    sponsor_score TEXT,
    voting_score TEXT,
    total_score TEXT,
    votes_json TEXT NOT NULL,
    synced_at TEXT NOT NULL
  )`,
  // handoff 91: primary tracker. `primaries` is one row per (state, chamber,
  // party) primary contest — id shape "senate-PA-2026-D" / "house-PA-07-2026-R"
  // / "senate-CA-2026-open" for top-two/top-four states. `race_id` is a loose
  // link to races.id. `primary_candidates` holds the per-contest rosters,
  // synced from Ballotpedia; `bioguide_id` is nullable (best-effort match).
  `CREATE TABLE IF NOT EXISTS primaries (
    id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    district TEXT,
    chamber TEXT NOT NULL,
    party TEXT NOT NULL,
    primary_date TEXT,
    runoff_date TEXT,
    primary_type TEXT,
    race_id TEXT REFERENCES races(id),
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS primary_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    primary_id TEXT NOT NULL REFERENCES primaries(id),
    name TEXT NOT NULL,
    party TEXT NOT NULL,
    incumbent INTEGER DEFAULT 0,
    bioguide_id TEXT REFERENCES members(bioguide_id),
    status TEXT DEFAULT 'running',
    vote_pct REAL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_primaries_date ON primaries(primary_date)`,
  `CREATE INDEX IF NOT EXISTS idx_primary_candidates_primary ON primary_candidates(primary_id)`,
  // handoff 101: enacted laws of past Congresses, for the laws-enacted
  // comparison chart. Stores the 118th only — the 119th's enacted laws live
  // in `bills` (stage='enacted') and the chart query UNIONs the two. `law_number`
  // is the API's "{congress}-{n}" form (e.g. "118-2"); `source_bill_id` matches
  // bills.id ("118-hr-346") when the origin bill is known. Static history —
  // backfilled once via `npm run backfill:laws`, never on cron.
  `CREATE TABLE IF NOT EXISTS historical_laws (
    congress INTEGER NOT NULL,
    law_number TEXT NOT NULL,
    source_bill_id TEXT,
    enacted_date TEXT NOT NULL,
    title TEXT,
    PRIMARY KEY (congress, law_number)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_historical_laws_enacted ON historical_laws(congress, enacted_date)`,
  // handoff 105: durable cron-run log. Vercel Hobby caps live logs at 30
  // minutes, so a cron tick's only persistent record past that window is a
  // row here. `lib/cron-log.ts` writes one row per run (startCronRun at the
  // top of each cron route, finishCronRun at the end). `elapsed_ms` is
  // computed DB-side from `started_at` so callers never pass a start clock.
  // A row stuck at status='running' past ~120s is an implicit timeout — the
  // Vercel runtime killed the function before finishCronRun could fire.
  `CREATE TABLE IF NOT EXISTS cron_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    elapsed_ms INTEGER,
    status TEXT NOT NULL,
    payload TEXT,
    error_message TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cron_runs_route_started ON cron_runs(route, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON cron_runs(status)`,
  // handoff 142: markets ticker data layer. Append-only history of policy-
  // effect indicators (SPX/TNX/WTI/DXY in v1; VIX deferred — Stooq doesn't
  // carry it). Refreshed every 30 min during US market hours by a GitHub
  // Actions cron (Vercel Hobby caps cron at once daily). `symbol` is the
  // internal stable identifier; the upstream source/remote-symbol mapping
  // lives in `lib/markets.ts` and is decoupled from the DB. `change_pct` is
  // nullable: NULL on the first-ever tick for a symbol (no prior reference)
  // and on any tick whose source doesn't expose a prior close.
  `CREATE TABLE IF NOT EXISTS market_ticks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    change_pct REAL,
    ticked_at TEXT NOT NULL,
    market_date TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_ticks_symbol_time
    ON market_ticks(symbol, ticked_at DESC)`,
  // handoff 143: committee surface, Phase 1 data layer. Three tables — the
  // committee dimension, the bill↔committee join (with activity type +
  // date so referral / report / discharge are distinguishable), and the
  // member↔committee roster. system_code is Congress.gov's stable PK
  // (lowercase alphanumeric like 'hsju00', 'sseg01' for subs). Committee
  // membership has no Congress.gov endpoint — sourced from
  // unitedstates/congress-legislators/committee-membership-current.yaml
  // (`party_side` is 'majority'|'minority' from the YAML; the real party
  // letter joins from members.party at read time).
  `CREATE TABLE IF NOT EXISTS committees (
    system_code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    chamber TEXT NOT NULL,
    committee_type TEXT,
    parent_system_code TEXT,
    url TEXT,
    is_current INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS committee_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id TEXT NOT NULL,
    committee_system_code TEXT NOT NULL,
    activity_type TEXT,
    activity_date TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(bill_id, committee_system_code, activity_type, activity_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_committee_bills_bill ON committee_bills(bill_id)`,
  `CREATE INDEX IF NOT EXISTS idx_committee_bills_committee ON committee_bills(committee_system_code)`,
  `CREATE INDEX IF NOT EXISTS idx_committee_bills_activity ON committee_bills(activity_date DESC)`,
  `CREATE TABLE IF NOT EXISTS committee_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    committee_system_code TEXT NOT NULL,
    bioguide_id TEXT NOT NULL,
    role TEXT,
    party_side TEXT,
    rank INTEGER,
    updated_at TEXT NOT NULL,
    UNIQUE(committee_system_code, bioguide_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_committee_members_committee ON committee_members(committee_system_code)`,
  `CREATE INDEX IF NOT EXISTS idx_committee_members_member ON committee_members(bioguide_id)`,

  // HO 402: ID crosswalk from unitedstates/congress-legislators. Enrichment of
  // the existing bioguide-keyed roster; NEVER a source of new members (the sync
  // gates on known bioguides). Both tables FK to members(bioguide_id) — but
  // libSQL runs foreign_keys OFF, so REFERENCES is documentation, not enforced;
  // the "never a new member" guarantee is the sync gate, not the constraint.
  `CREATE TABLE IF NOT EXISTS member_ids (
    bioguide_id       TEXT PRIMARY KEY REFERENCES members(bioguide_id),
    icpsr             INTEGER,
    govtrack          INTEGER,
    lis               TEXT,
    thomas            TEXT,
    cspan             INTEGER,
    votesmart         INTEGER,
    wikidata          TEXT,
    wikipedia_title   TEXT,
    ballotpedia_title TEXT,
    google_entity_id  TEXT,
    opensecrets       TEXT,
    maplight          INTEGER,
    house_history     INTEGER,
    pictorial         INTEGER,
    raw_json          TEXT NOT NULL,
    fetched_at        TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_member_ids_icpsr ON member_ids(icpsr)`,

  // `fec` is an ARRAY of FEC *candidate* IDs upstream (one member -> several IDs,
  // one per office sought over a career). Flattened into a child table so
  // candidate_id -> member reverse lookup is indexed, same reason HO 394
  // flattened entities instead of json_extract-ing. Column is fec_candidate_id
  // to match the existing members.fec_candidate_id (single, fuzzy-resolved) it
  // upgrades.
  `CREATE TABLE IF NOT EXISTS member_fec_ids (
    bioguide_id      TEXT NOT NULL REFERENCES members(bioguide_id),
    fec_candidate_id TEXT NOT NULL,
    PRIMARY KEY (bioguide_id, fec_candidate_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_member_fec_ids_cand ON member_fec_ids(fec_candidate_id)`,

  // HO 419: member ideology — Voteview DW-NOMINATE, 119th. Additive, current-
  // scoped enrichment of the bioguide-keyed roster (the member_* family, same
  // shape judgment as the HO 402 crosswalk). The sync joins Voteview -> members on
  // bioguide_id DIRECTLY (the member file carries bioguide_id natively; the ICPSR
  // bridge is NOT this path) and GATES on known bioguides, so it's never a source
  // of new members. `icpsr` is kept for a future Voteview votes/rollcalls join.
  // nominate_dim1 (headline, economic left/right) is NULLABLE — a member with zero
  // votes has no estimate yet. No secondary index: ~535 rows, the PK covers the
  // join and a full scan is sub-millisecond (same call as the /dashboard-classic
  // reads). Manual/periodic, paired with sync:members -> sync:crosswalk; NOT on
  // the daily cron.
  `CREATE TABLE IF NOT EXISTS member_ideology (
    bioguide_id       TEXT PRIMARY KEY,
    icpsr             INTEGER NOT NULL,
    congress          INTEGER NOT NULL,
    chamber           TEXT    NOT NULL,
    nominate_dim1     REAL,
    nominate_dim2     REAL,
    nokken_poole_dim1 REAL,
    nokken_poole_dim2 REAL,
    number_of_votes   INTEGER,
    conditional       INTEGER,
    updated_at        TEXT    NOT NULL
  )`,

  // HO 525 (B2): per-member CAREER roll-call participation, accumulated from
  // Voteview's per-Congress votes files across every Congress a current member
  // served (earliest served → 119, both chambers). One row per current member,
  // keyed by bioguide (icpsr→bioguide via member_ideology at sync time). Distinct
  // from member_votes (119th only): this is the lifetime figure surfaced beside
  // the 119th one on the hub. cast_code rule (HO 524 probe correction): eligible =
  // codes 1–8 (7/8 = Present, folded into cast) + 9; missed = code 9 only; code 0
  // (not seated) excluded — usually absent as a row, so a guard not the main path.
  // No career_present column (folded into cast). Truncate-then-insert each run
  // (full recompute from an API-reproducible source); PK covers the point lookup.
  `CREATE TABLE IF NOT EXISTS member_career_votes (
    bioguide_id       TEXT PRIMARY KEY,
    icpsr             INTEGER,
    career_eligible   INTEGER,
    career_missed     INTEGER,
    career_missed_pct REAL,
    first_congress    INTEGER,
    congresses_served INTEGER,
    synced_at         TEXT
  )`,

  // HO 427: per-Congress, per-chamber D/R medians of DW-NOMINATE dim1 — the data
  // gate for ship 3, the polarization-over-time chart. Aggregated from Voteview's
  // full HSall_members.csv history (~50k member-rows) down to a few hundred median
  // rows (2 chambers x the covered Congresses); the raw file is read once and
  // discarded, never stored per-member. Party is by Voteview party_code (100=D /
  // 200=R = CAUCUS) end-to-end — the only option historically (departed members of
  // past Congresses aren't in `members`), which differs from getPolarizationBand's
  // members.party (REGISTRATION) filter; the two agree in the aggregate but not on
  // caucusing independents (Kiley/King/Sanders), see the coverage diagnostic. `gap`
  // is NOT stored — derived as |rep_median - dem_median| in the chart query, one
  // gap formula shared with the band. chamber normalized lowercase to match the
  // app convention. PK covers every read; no secondary index. Manual sync
  // (sync:polarization-history), NOT on the daily cron.
  `CREATE TABLE IF NOT EXISTS polarization_history (
    congress    INTEGER NOT NULL,
    chamber     TEXT    NOT NULL,
    dem_median  REAL,
    rep_median  REAL,
    PRIMARY KEY (congress, chamber)
  )`,

  // HO 232: append-only stage-transition log (the rating_history precedent —
  // HO 220). One row per ACTUAL stage move, written from the summarize step's
  // existing `transitioned` branch right beside previous_stage/stage_changed_at.
  // `bill_id` references bills.id (the '119-hr-1234' shape) but is NOT FK'd, same
  // as committee_bills — the summarize UPDATE always has the row, and a hard FK
  // would be redundant. `from_stage` is nullable: a bill first observed already
  // past introduced (oldStage NULL → e.g. enacted) logs a NULL-from transition,
  // matching what the bills slot records. This is a WRITE-ONLY plant — nothing
  // reads it yet. It exists so the deferred MOVERS hop-count rank (+ the from→to
  // arrow rendering) has an accruing series when that handoff comes; no backfill
  // is possible (the single-slot previous_stage has no history to recover).
  // HO 635: `changed_at` -> `observed_at`. It carries the SAME observation clock
  // as bills.stage_observed_at — both writers pass the identical value — so it is
  // named for what it records. A FRESH database gets the new name here directly;
  // an EXISTING one is migrated by the expand/contract further down.
  `CREATE TABLE IF NOT EXISTS stage_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id TEXT NOT NULL,
    from_stage TEXT,
    to_stage TEXT NOT NULL,
    observed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stage_transitions_bill ON stage_transitions(bill_id)`,

  // HO 263: committee meetings (hearings) data layer — Phase 1, no UI. Spine is
  // Congress.gov committee-meeting/{congress}/{chamber} (HO 261 probe). NO
  // raw_json blob (the bills-table raw_json bloat caused the HO 241 cold-scan
  // 500) — extracted columns only. `video_url` is the EXTRACTED watch link (the
  // videos[] entry whose host is NOT api.congress.gov: YouTube for House,
  // senate.gov/isvp for Senate), null when absent. `committee_system_code` is the
  // first/primary committee from committees[]. `update_date` is the sync cursor.
  `CREATE TABLE IF NOT EXISTS committee_meetings (
    event_id TEXT PRIMARY KEY,
    congress INTEGER NOT NULL,
    chamber TEXT NOT NULL,
    meeting_date TEXT,
    meeting_type TEXT,
    meeting_status TEXT,
    title TEXT,
    location_building TEXT,
    location_room TEXT,
    video_url TEXT,
    committee_system_code TEXT,
    update_date TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_committee_meetings_date ON committee_meetings(meeting_date)`,
  `CREATE INDEX IF NOT EXISTS idx_committee_meetings_committee ON committee_meetings(committee_system_code)`,
  `CREATE INDEX IF NOT EXISTS idx_committee_meetings_update ON committee_meetings(update_date)`,
  `CREATE INDEX IF NOT EXISTS idx_committee_meetings_chamber_date ON committee_meetings(chamber, meeting_date)`,

  // Meeting↔bill join, from relatedItems.bills[] only (the structured
  // {congress,type,number} → {congress}-{type.toLowerCase()}-{number} id; the
  // messier meetingDocuments PDF-name parse is deliberately NOT used in v1, HO
  // 261). bill_id loose-linked (not FK'd — a meeting can reference a bill not yet
  // synced). Sparse by nature (~20% House / ~12% Senate carry any bill).
  `CREATE TABLE IF NOT EXISTS meeting_bills (
    event_id TEXT NOT NULL,
    bill_id TEXT NOT NULL,
    UNIQUE(event_id, bill_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meeting_bills_bill ON meeting_bills(bill_id)`,

  // Per-chamber sync watermark (HO 116/143 cursor pattern). One row per chamber;
  // update_date = the newest event update_date fully synced. The list endpoint is
  // updateDate-DESC with no server-side date filter, so the sync collects events
  // newer than this watermark, processes them oldest-first, and advances per
  // completed event so a deadline-interrupted tick keeps its progress.
  `CREATE TABLE IF NOT EXISTS meeting_sync_state (
    chamber TEXT PRIMARY KEY,
    update_date TEXT NOT NULL
  )`,

  // HO 355: identity table for the multi-user arc (A1). NextAuth v5 / GitHub
  // OAuth with the JWT session strategy and NO Auth.js DB adapter — sessions
  // live in the signed cookie, this is our own minimal user record, upserted on
  // sign-in by the auth.ts jwt callback. `id` is a UUID we mint (A2's per-user
  // watchlist FKs to it). `github_id` is GitHub's numeric account id as TEXT
  // (profile.id — stable, unlike the login), the unique sign-in lookup key.
  // email is nullable (GitHub may not expose one).
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    github_id TEXT NOT NULL UNIQUE,
    email TEXT,
    name TEXT,
    image TEXT,
    created_at TEXT NOT NULL
  )`,
  // HO 394: news-as-observations pilot (ADDITIVE, reversible). The watchcore
  // Observation contract (lib/observation.ts) stored SQLite-style: scalar fields
  // as columns, `source`/`raw`/`entities`/`geo`/`tags` as JSON TEXT. Full
  // contract column set incl. reserved fields (geo/valid_from/valid_to/confidence
  // — unused for news) so a later surface needs no migration. `news_mentions`
  // stays the live UI source + the rollback path; nothing migrates. Rollback =
  // DROP both tables + remove the dual-write hook in lib/news-ingest.ts.
  `CREATE TABLE IF NOT EXISTS observations (
    obs_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    obs_type TEXT NOT NULL,
    title TEXT NOT NULL,
    reliability TEXT NOT NULL,
    credibility INTEGER NOT NULL,
    raw TEXT NOT NULL,
    summary TEXT,
    entities TEXT,
    geo TEXT,
    tags TEXT,
    valid_from TEXT,
    valid_to TEXT,
    confidence TEXT,
    content_hash TEXT,
    cluster_id TEXT,
    first_seen TEXT,
    last_seen TEXT,
    supersedes TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_observations_observed ON observations(observed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(obs_type)`,
  `CREATE INDEX IF NOT EXISTS idx_observations_cluster ON observations(cluster_id)`,
  `CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash)`,
  // Flattened, indexed entity index — the join layer (member→news, race→news).
  // json_extract joins over observations.entities would be the wrong tool. One
  // row per (observation, extracted entity); entity_value nullable (orgs with no
  // id, and unresolved/ambiguous person/committee mentions kept for audit).
  // Idempotent via delete-then-insert per obs_id (the primary_candidates idiom).
  `CREATE TABLE IF NOT EXISTS observation_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    obs_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_value TEXT,
    entity_name TEXT NOT NULL,
    role TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_obs_entities_type_value ON observation_entities(entity_type, entity_value)`,
  `CREATE INDEX IF NOT EXISTS idx_obs_entities_obs ON observation_entities(obs_id)`,
  // HO 435: LDA lobbying data layer. Three additive tables, surface-agnostic —
  // they hold what both planned HO-436 surfaces need (bill-keyed lobbying +
  // issue-code "what's being lobbied") so the surface HO needs no re-ingest.
  // Ingested by lib/lda-sync.ts from the lda.gov LD-2 quarterly reports.
  //
  // Filing: one LD-2 quarterly activity report (types Q1..Q4 + amendments
  // 1A..4A; each amendment is its own filing_uuid). income/expenses are mutually
  // exclusive (firm reports income, in-house reports expenses); stored as
  // parsed REAL dollars for SUM-able spend surfaces. dt_posted is the sync's
  // resume frontier — the sync derives MAX(dt_posted) per (year,type) from the
  // DB rather than a stored cursor (see lib/lda-sync.ts).
  `CREATE TABLE IF NOT EXISTS lda_filings (
    filing_uuid TEXT PRIMARY KEY,
    filing_type TEXT NOT NULL,
    filing_year INTEGER NOT NULL,
    filing_period TEXT,
    registrant_name TEXT,
    registrant_id INTEGER,
    client_name TEXT,
    client_id INTEGER,
    income REAL,
    expenses REAL,
    dt_posted TEXT NOT NULL,
    ingested_at TEXT NOT NULL
  )`,
  // NOTE: `activity_count` (HO 597) is added by ensureColumn in main(), not here —
  // see the block at the bottom of main() for what it is and why it exists.
  `CREATE INDEX IF NOT EXISTS idx_lda_filings_dt_posted ON lda_filings(dt_posted DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_lda_filings_year ON lda_filings(filing_year)`,
  // HO 435 rev: the sync derives its resume frontier per (filing_year,
  // filing_type) as MAX(dt_posted) + COUNT(*). This composite makes that an
  // index seek instead of a ~20k-row scan per combo (32 combos/run).
  `CREATE INDEX IF NOT EXISTS idx_lda_filings_year_type_dt ON lda_filings(filing_year, filing_type, dt_posted DESC)`,
  // Activity: the LD-2 lobbying_activities array is unkeyed, so activity_ordinal
  // is assigned on ingest (0-based, rebuilt on re-ingest). description is the
  // FULL specific-issues free text — the raw signal, and what phase-2 short-
  // title matching (HO note) will need. bill_ids is the extractBillIds() JSON
  // (stored always); the subset that resolves to a real bills row is denormalized
  // into lda_activity_bills.
  `CREATE TABLE IF NOT EXISTS lda_activities (
    filing_uuid TEXT NOT NULL REFERENCES lda_filings(filing_uuid),
    activity_ordinal INTEGER NOT NULL,
    general_issue_code TEXT,
    general_issue_code_display TEXT,
    description TEXT,
    bill_ids TEXT,
    PRIMARY KEY (filing_uuid, activity_ordinal)
  )`,
  // Issue-code index serves the "what's being lobbied" surface (bucket counts)
  // even where no bill parses.
  `CREATE INDEX IF NOT EXISTS idx_lda_activities_issue ON lda_activities(general_issue_code)`,
  // Bill link at activity granularity so a link carries its issue code +
  // description. One row per (activity, joinable bill). idx on bill_id serves
  // the "who lobbied bill X" surface.
  `CREATE TABLE IF NOT EXISTS lda_activity_bills (
    filing_uuid TEXT NOT NULL,
    activity_ordinal INTEGER NOT NULL,
    bill_id TEXT NOT NULL REFERENCES bills(id),
    PRIMARY KEY (filing_uuid, activity_ordinal, bill_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_lda_activity_bills_bill ON lda_activity_bills(bill_id)`,
  // HO 598: the /lobbying search lookup table. The `?q=` search was a leading-%
  // LIKE over lda_filings, and HO 598 STEP 0 measured co-located that the LIKE is
  // NOT the cost — the WALK is: a name read with no predicate at all was 86.3s, a
  // zero-match search page 91.3s. The lever is bytes dragged, so search moves off
  // the 129,401-row x 22.9 MB table onto ~28k short rows here, then seeks back by
  // id.
  //
  // ONE ROW PER DISTINCT (kind, entity_id, name) — NOT one per id. The mapping is
  // many-to-many, measured: 70 registrant ids and 91 client ids carry MORE THAN ONE
  // name spelling, and 3,418 client names span more than one id. Keying on id alone
  // would silently drop the alternate spellings and change search results.
  //
  // Correctness contract for the reader (both halves are load-bearing):
  //   COMPLETE — every filing whose name matches the LIKE has that exact (id, name)
  //     pair here, so its id is always in the candidate set.
  //   SOUND    — the candidate set is by ID, so it can over-match (id X spelled two
  //     ways, only one spelling matching), which is why the rewrite MUST re-apply
  //     the name LIKE to the seeked rows. That re-check is what makes this exactly
  //     equivalent to the old predicate, not merely close.
  // Rows are INSERT OR IGNORE'd and never deleted: a stale name only widens the
  // candidate set, and the re-check removes it. No delete path to get wrong.
  `CREATE TABLE IF NOT EXISTS lda_names (
    kind TEXT NOT NULL,                 -- 'r' registrant | 'c' client
    entity_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (kind, entity_id, name)
  )`,
  // The scan target, COVERING: `SELECT entity_id WHERE kind = ? AND name LIKE ?`
  // reads this index only and never touches the table.
  //
  // HO 598 round 2 — `filing_count` is carried in the index so the SAME scan that
  // resolves a term to ids also returns how many filings those ids cover. That
  // number is the routing input (see the derived threshold in lib/queries.ts), and
  // folding it in here is what avoids paying a SECOND query just to choose a path.
  //
  // IT IS ADVISORY, NEVER A CORRECTNESS INPUT, and that is what makes it safe to
  // maintain lazily: it only decides WHICH of two provably-equivalent query shapes
  // runs. A stale count picks a slower path, never a wrong answer. So it is NOT
  // maintained by the per-filing sync — an incrementing counter there would
  // double-count on re-ingest, since the filing upsert legitimately re-runs for the
  // same filing — it is recomputed wholesale by the backfill / rollup path.
  // idx_lda_names_kind_name is built in main() — it carries filing_count, which
  // ensureColumn adds there, so it cannot be created from this array.
  // HO 447: amendments data layer. One row per congressional amendment along the
  // bill spine. Landed by lib/amendments-sync.ts from Congress.gov /amendment
  // (list → detail; amendedBill/sponsors/purpose are detail-only, HO 446 probe).
  //
  // `id` = `${congress}-${amendment_type.toLowerCase()}-${amendment_number}`
  // (mirrors billId → "119-samdt-14"); amendment_type/amendment_number match the
  // bills-table house style (bill_type/bill_number), the column stays UPPERCASE
  // (SAMDT/HAMDT/SUAMDT) for display/filter.
  //
  // Join reality (HO 446 probe, n=40): amendedBill present 100%, resolving 100%
  // to tracked bills — so `amended_bill_id` is stored REGARDLESS of resolution
  // (a rare untracked ref still lands the row, resolvable later), never gated on
  // a bills lookup. Sub-amendments (~2.5%) carry BOTH amendedBill AND
  // amendedAmendment (the API resolves the ultimate bill transitively), so
  // `amends_amendment_id` is a nullable self-FK for lineage, NOT a many-to-many.
  // SUAMDT is empty in the 119th but kept in the type domain (reserved).
  //
  // sponsor_bioguide_id + sponsor_name (label fallback for committee/manager
  // amendments with no bioguide); party/state join from members at read (no
  // denormalization — avoids the bills-table drift). Nullable rates from the
  // probe: latest_action_text ~35% (top-level only; absent = submitted/pending —
  // the actions sub-resource walk is deferred to the status model), description
  // ~30%, purpose ~5%. update_date is the DB-derived resume frontier (no stored
  // cursor). raw_json is the detail payload (NOT the actions sub-resource).
  //
  // LOOSE LINKS, NOT enforced FKs (amended_bill_id / amends_amendment_id /
  // sponsor_bioguide_id): this DB runs with `PRAGMA foreign_keys = ON` (the HO 402
  // note claiming it's OFF is wrong for this write path — an FK REFERENCES here
  // rejects the insert). All three carry legitimately-absent non-null refs the
  // insert must still land: (1) amended_bill_id is stored REGARDLESS of resolution
  // (HO 447 — a rare untracked bill ref stays resolvable later); (2) a
  // sub-amendment's amends_amendment_id can forward-reference a parent not yet
  // ingested (the ascending-update_date sweep gives no parent-first guarantee),
  // and a self-FK would deadlock the insert; (3) a sponsor may have left Congress
  // and not be in members. Same "loose link (not FK'd)" idiom as votes.bill_id /
  // committee_bills / meeting_bills. Resolution is measured at read (LEFT JOIN),
  // see the HO 447 coverage diagnostic.
  `CREATE TABLE IF NOT EXISTS amendments (
    id TEXT PRIMARY KEY,
    congress INTEGER NOT NULL,
    amendment_type TEXT NOT NULL,
    amendment_number INTEGER NOT NULL,
    chamber TEXT,
    amended_bill_id TEXT,
    amends_amendment_id TEXT,
    sponsor_bioguide_id TEXT,
    sponsor_name TEXT,
    purpose TEXT,
    description TEXT,
    latest_action_text TEXT,
    latest_action_date TEXT,
    submitted_date TEXT NOT NULL,
    update_date TEXT NOT NULL,
    raw_json TEXT,
    ingested_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amendments_bill    ON amendments(amended_bill_id)`,
  `CREATE INDEX IF NOT EXISTS idx_amendments_sponsor ON amendments(sponsor_bioguide_id)`,
  `CREATE INDEX IF NOT EXISTS idx_amendments_update  ON amendments(update_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_amendments_type    ON amendments(amendment_type)`,
  // HO 461: partial COVERING index for the /amendments disposition breakdown — the
  // one unbounded summary cut not already index-covered. `disposition` is
  // display-only-derived (HO 452 killed the persisted column), so the corpus
  // breakdown scans latest_action_text; without this it's a full table SCAN that
  // hydrates raw_json per page (measured 4065ms cold on 6,788 rows). The partial
  // index over exactly the ~586 acted rows makes it index-only (SEARCH USING
  // COVERING INDEX, 40ms) — a pure performance index (the HO 277/340 covering-
  // aggregate fix), NOT a status model (does not reopen HO 452). In the statements
  // array (not main()) because latest_action_text is an original column.
  `CREATE INDEX IF NOT EXISTS idx_amendments_acted   ON amendments(latest_action_text) WHERE latest_action_text IS NOT NULL`,

  // HO 532: House amendment → roll-call-vote linkage. The House has no cheap key
  // (its vote questions are generic "On Agreeing to the Amendment", no number —
  // unlike the Senate, whose number is in votes.question, HO 530), so the link is
  // recovered from each HAMDT's /actions.recordedVotes.rollNumber and persisted
  // here. LOOSE links (no FK) — the vote_id may reference a not-yet-synced roll
  // call (self-heals; the read LEFT-JOINs votes). Composite PK handles the list
  // case (a HAMDT's table-then-substantive pair). Populated by sync:amendment-votes
  // (the --walk backfill + the amendments cron's bounded walk step); read by
  // getBillAmendmentVotes' House branch. The sentinel column + HAMDT queue index
  // are added below (main()/statements).
  `CREATE TABLE IF NOT EXISTS amendment_votes (
    amendment_id TEXT NOT NULL,
    vote_id      TEXT NOT NULL,
    PRIMARY KEY (amendment_id, vote_id)
  )`,
  // Walk-queue index: the HAMDT subset by update_date, so the queue predicate
  // (amendment_type='HAMDT' AND unwalked-or-changed, ORDER BY update_date) seeks
  // rather than scanning. The ~228-HAMDT residual is trivial regardless.
  `CREATE INDEX IF NOT EXISTS idx_amendments_hamdt ON amendments(update_date) WHERE amendment_type = 'HAMDT'`,

  // HO 455: nominations data layer (on the HO 454 GO — 1,884 PNs, 833 civilian
  // with 100% disposition coverage, clean 24-value organization facet). LIST-ONLY
  // v1: every column here is a list-level field + the computed `disposition`; the
  // two detail-only columns (`committee_system_code`, `nominee_count`) are in the
  // schema NULLABLE now so the deferred detail-hydration HO needs no migration.
  // Loose links, no enforced FKs (the amendments cecff19 lesson). Composite key is
  // (pn_number, part_number) — citations are PN{number}-{partNumber} and the base
  // detail endpoint returns a DIFFERENT record; `id` encodes both. Military list
  // PNs are stored as single collapsed rows (never explode the ~25k officers).
  `CREATE TABLE IF NOT EXISTS nominations (
    id TEXT PRIMARY KEY,
    congress INTEGER NOT NULL,
    pn_number INTEGER NOT NULL,
    part_number TEXT NOT NULL,
    citation TEXT NOT NULL,
    is_military INTEGER NOT NULL,
    organization TEXT,
    description TEXT,
    disposition TEXT NOT NULL,
    latest_action_text TEXT,
    latest_action_date TEXT,
    received_date TEXT,
    committee_system_code TEXT,
    nominee_count INTEGER,
    update_date TEXT NOT NULL,
    raw_json TEXT,
    ingested_at TEXT,
    committee_hydrated_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_nominations_pn   ON nominations(congress, pn_number, part_number)`,
  `CREATE INDEX IF NOT EXISTS idx_nominations_org         ON nominations(organization)`,
  `CREATE INDEX IF NOT EXISTS idx_nominations_disposition ON nominations(disposition)`,
  `CREATE INDEX IF NOT EXISTS idx_nominations_military    ON nominations(is_military)`,
  `CREATE INDEX IF NOT EXISTS idx_nominations_update      ON nominations(update_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_nominations_committee   ON nominations(committee_system_code)`,

  // ── HO 674: the two per-bill rosters. Both hang off the SAME Congress.gov
  // sub-endpoint shape (`/bill/{c}/{t}/{n}/cosponsors` and `/relatedbills`),
  // which is why they are one data domain and not two. The bill DETAIL endpoint
  // returns only `{count, url}` for each, so neither roster can be recovered
  // from `bills.raw_json` -- these tables are the only place the identities live.
  //
  // FK to bills is LOOSE (no REFERENCES clause), per HO 447: FK enforcement is ON
  // in this database, and a strict FK would reject a roster row whose bill has
  // not been ingested yet, turning an ordering accident into data loss.
  `CREATE TABLE IF NOT EXISTS bill_cosponsors (
    bill_id TEXT NOT NULL,
    bioguide_id TEXT NOT NULL,
    sponsorship_date TEXT,
    -- NULL for an active cosponsor; a date for a withdrawn one. HO 674 measured
    -- that the API RETURNS withdrawn cosponsors in the list (119-hr-452: the
    -- list yields 300 entries, one carrying sponsorshipWithdrawnDate), so a
    -- roster CAN mark them rather than silently dropping them.
    --
    -- THE TRAP, and it is load-bearing for the integrity check: pagination.count
    -- EXCLUDES withdrawn cosponsors (299) while the list INCLUDES them (300).
    -- bills.cosponsor_count is sourced from the detail endpoints
    -- $.cosponsors.count, i.e. the ACTIVE count. So any check comparing this
    -- table against that column MUST filter to sponsorship_withdrawn_date IS
    -- NULL. A naive COUNT(*) disagrees on exactly the bills that have a
    -- withdrawal -- measured at 2 of 30 high-cosponsor bills.
    sponsorship_withdrawn_date TEXT,
    is_original INTEGER NOT NULL DEFAULT 0,
    ingested_at TEXT,
    PRIMARY KEY (bill_id, bioguide_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bill_cosponsors_bill     ON bill_cosponsors(bill_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bill_cosponsors_bioguide ON bill_cosponsors(bioguide_id)`,

  // The composite PK carries the relationship type deliberately. HO 674 measured
  // that ONE related bill can arrive with MORE THAN ONE relationshipDetails
  // entry (e.g. both "Related bill" and "Procedurally related", identified by
  // different sources), so (bill_id, related_bill_id) alone would collide on
  // real data -- a unique-constraint failure partway through a backfill rather
  // than at its start.
  //
  // This is also why `$.relatedBills.count` is NOT a row count for this table:
  // it counts RELATIONSHIP ENTRIES, not related bills. Measured across 40 bills:
  // summed pagination.count 1,078 == summed relationshipDetails 1,078, against
  // 1,004 distinct listed bills.
  //
  // Observed `relationship_type` value set (40-bill sample): "Related bill" 848,
  // "Identical bill" 143, "Procedurally related" 46, "Public law contains the
  // text" 41. There is NO "Companion" value -- see docs/backlog.md, the open
  // question about what HO 673 ruling 3 should promote.
  `CREATE TABLE IF NOT EXISTS bill_related_bills (
    bill_id TEXT NOT NULL,
    related_bill_id TEXT NOT NULL,
    relationship_type TEXT NOT NULL,
    -- LOSSY, DELIBERATELY. identified_by records ONE of possibly several
    -- sources. Where CRS and the House both identify the SAME relationship,
    -- the two API entries share this table's primary key and the second
    -- write replaces the first -- measured at 1 in 167 (0.6%) on the HO 674
    -- STEP 2 slice: 119-s-1318 -> 119-hr-1919 'Related bill', identified by
    -- both. Ruled at HO 674: the relationship is the same fact whichever
    -- body asserted it, and adding the source to the key would push a dedupe
    -- into every consumer to preserve a distinction no ruling asks for.
    -- Do NOT read this column as a complete list of who identified a
    -- relationship.
    identified_by TEXT,
    ingested_at TEXT,
    PRIMARY KEY (bill_id, related_bill_id, relationship_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bill_related_bill    ON bill_related_bills(bill_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bill_related_related ON bill_related_bills(related_bill_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bill_related_type    ON bill_related_bills(relationship_type)`,
];

async function ensureColumn(
  db: Db,
  table: string,
  column: string,
  ddl: string,
): Promise<void> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  const exists = r.rows.some((row) => (row.name as string) === column);
  if (exists) {
    console.log(`column ${table}.${column} already exists`);
    return;
  }
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(`added column ${table}.${column}`);
}

// HO 635 — the CONTRACT half of an expand/contract, and it is a FALSIFICATION LEG
// rather than cleanup. While the old column and its index still exist, a missed
// reference is SILENT: the query keeps working against a column nobody writes any
// more and goes stale invisibly. Dropping them is what makes a missed reference
// fail loudly, so a clean run here IS the proof that the cutover was complete.
// Idempotent (PRAGMA-checked) so re-running migrate is safe. The index must go
// first — SQLite refuses to drop a column that an index references.
async function dropColumnIfExists(
  db: Db,
  table: string,
  column: string,
): Promise<void> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  if (!r.rows.some((row) => (row.name as string) === column)) {
    console.log(`column ${table}.${column} already dropped`);
    return;
  }
  await db.execute(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  console.log(`DROPPED column ${table}.${column}`);
}

async function main() {
  const db = getDb();
  for (const sql of statements) {
    await db.execute(sql);
    console.log("ok:", sql.split("\n")[0]);
  }
  // HO 532: walk sentinel on amendments (the HO 459 committee_hydrated_at pattern).
  // Walk-only — lib/amendments-sync.ts's ON CONFLICT SET names every column and does
  // NOT include this, so a re-sync INSERTs it NULL on a genuinely new amendment
  // (correctly un-walked) and PRESERVES the walk's stamp on CONFLICT. Do not add it
  // to the sync's SET.
  await ensureColumn(db, "amendments", "amendment_vote_walked_at", "TEXT");
  await ensureColumn(db, "bills", "sponsor_bioguide_id", "TEXT");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_sponsor_bioguide ON bills(sponsor_bioguide_id)",
  );
  console.log("ok: idx_bills_sponsor_bioguide");
  await ensureColumn(db, "bills", "previous_stage", "TEXT");

  // ── HO 635 — `stage_changed_at` -> `stage_observed_at` ────────────────────
  // The column records WHEN THE SYNC OBSERVED an advance, not when the stage
  // changed: both write sites stamp the wall clock of the run. The name says
  // occurrence and 15 readers read it as occurrence, so it is being renamed.
  //
  // THIS IS THE ADDITIVE HALF OF AN EXPAND/CONTRACT, RUN BEFORE THE CODE CUTOVER.
  // A bare ALTER TABLE RENAME COLUMN would open a window in which deployed code
  // queries a column that no longer exists — every dashboard surface and any cron
  // that fires. Adding first means nothing breaks: the old column is still present
  // and still written, and the new index exists BEFORE any `INDEXED BY` hint names
  // it (a missing named index is a hard SQL error, not a silent fallback).
  //
  // The backfill is idempotent and stays until the contract step, because it also
  // serves as the top-up for rows advanced between this run and the cutover deploy.
  await ensureColumn(db, "bills", "stage_observed_at", "TEXT");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_stage_observed_at ON bills(stage_observed_at DESC)",
  );
  console.log("ok: idx_bills_stage_observed_at");
  // CONTRACT. Index first — SQLite refuses to drop an indexed column.
  await db.execute("DROP INDEX IF EXISTS idx_bills_stage_changed_at");
  await dropColumnIfExists(db, "bills", "stage_changed_at");

  // `stage_transitions.changed_at` carries the SAME observation clock — both
  // writers pass it the identical value. It is folded into this rename.
  // VERIFIED, not inherited from the backlog: it has ZERO production readers (the
  // only production references are the two INSERTs). But reader-lessness does NOT
  // make a bare rename safe — `sync.ts:269` and `summarize-runner.ts:342` name the
  // column explicitly in an UNGUARDED `await db.execute`, so renaming it under
  // running code fails the sync and summarize paths outright. Hence the same
  // expand/contract shape here rather than the bare RENAME a reader-only analysis
  // would have licensed.
  await ensureColumn(db, "stage_transitions", "observed_at", "TEXT");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_stage_transitions_observed_at ON stage_transitions(observed_at DESC)",
  );
  console.log("ok: idx_stage_transitions_observed_at");
  await db.execute("DROP INDEX IF EXISTS idx_stage_transitions_changed_at");
  await dropColumnIfExists(db, "stage_transitions", "changed_at");
  await ensureColumn(db, "bills", "is_ceremonial", "INTEGER");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_is_ceremonial ON bills(is_ceremonial)",
  );
  console.log("ok: idx_bills_is_ceremonial");
  await ensureColumn(db, "bills", "cluster_id", "TEXT");
  // HO 340: idx_bills_cluster_agg (cluster_id, is_ceremonial, stage) supersedes
  // the old single-column idx_bills_cluster_id. Leading cluster_id serves every
  // `cluster_id = ?` / `IS NULL` / `IS NOT NULL` lookup the old one did, AND
  // covers is_ceremonial + stage so getUnmatchedClusterCount's ~15k-row
  // `cluster_id IS NULL` COUNT and the getClusterStats GROUP BY go index-only
  // (no row-fetch) — the /patterns 20s→fast fix. Both force it via INDEXED BY.
  // The old index is dropped below (every consumer seeks the covering one).
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_cluster_agg ON bills(cluster_id, is_ceremonial, stage)",
  );
  console.log("ok: idx_bills_cluster_agg");
  await db.execute("DROP INDEX IF EXISTS idx_bills_cluster_id");
  console.log("ok: dropped idx_bills_cluster_id (superseded by idx_bills_cluster_agg)");
  // HO 246: cover getNewBillsThisWeekCount's introduced_date filter. Before
  // this, the only bills dashboard aggregate NOT on a covering index — the
  // planner drove off idx_bills_is_ceremonial (the (=0 OR IS NULL) OR matches
  // ~every row) and post-filtered introduced_date, ~6.8s warm and tipping the
  // 10s DB_REQUEST_TIMEOUT cold (the HO 245 cold-start 500). Composite
  // (introduced_date, is_ceremonial) so the COUNT is index-only (covering):
  // range-scan the selective last-7-days slice, read is_ceremonial from the
  // index. The query carries an INDEXED BY hint (lib/queries.ts) because Turso
  // is statless (no ANALYZE) and otherwise still picks idx_bills_is_ceremonial.
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_introduced_date ON bills(introduced_date, is_ceremonial)",
  );
  console.log("ok: idx_bills_introduced_date");
  // HO 277: cover the per-sponsor aggregate behind /members (the live 500 —
  // digest 4101894172, a 10s DB-abort timeout). billsAggCte (getMembersRanked)
  // and getSponsorProductivity both GROUP BY sponsor_bioguide_id and read stage +
  // is_ceremonial (+ congress for productivity) per bill; the planner drove off
  // idx_bills_is_ceremonial with a MULTI-INDEX OR over the fat bills table (the
  // (=0 OR IS NULL) OR matches ~every row), materialized + TEMP-B-TREE GROUP BY,
  // ~3.85s warm and tipping the 10s abort cold. Composite leading on the GROUP
  // key so the scan is index-only (covering: stage + is_ceremonial + congress)
  // AND already ordered by sponsor_bioguide_id (no temp-b-tree GROUP BY). Both
  // queries carry an INDEXED BY hint (lib/queries.ts) — Turso is statless (no
  // ANALYZE) and otherwise still picks idx_bills_is_ceremonial (verified: the
  // unhinted plan kept the MULTI-INDEX OR even with this index present).
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_sponsor_agg ON bills(sponsor_bioguide_id, is_ceremonial, stage, congress)",
  );
  console.log("ok: idx_bills_sponsor_agg");
  // HO 594: cover the THREE participation aggregates over member_votes — the same
  // digest (4101894172) and the same route (/members) as HO 277 above, one table
  // over. getParticipationStrip, getChamberParticipationContext and
  // participationAggCte all GROUP BY bioguide_id and read `position` for the
  // not_voting SUM. The pre-existing idx_member_votes_bioguide(bioguide_id) leads
  // on the GROUP key but does NOT carry `position`, so every one of the 365,996
  // rows was fetched from the table to answer a 536-row question (a 683x
  // scanned:returned gap — HO 594 M1). Adding `position` makes the aggregate
  // index-only AND already ordered by the GROUP key (no temp b-tree): the measured
  // row-fetch cost this removes was ~19.75s of median.
  //
  // NOT a partial index: all three aggregates read every member_votes row (the
  // `is_current`/HAVING filters are on the members side, applied after the group).
  // Supersedes nothing — idx_member_votes_bioguide stays, because the bounded
  // per-member lookups (getMemberVoteStats etc.) are served fine by it and a
  // narrower index is cheaper for them.
  //
  // Write cost is real and was priced, because member_votes is DELETE-AND-REBUILD
  // per vote, not append-only (lib/votes-sync.ts:333, HO 566/567): the sync's
  // atomic unit re-writes a whole roll-call's rows, and that now maintains two
  // indexes. HO 594 measured the unit before and after (see the fix commit).
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_member_votes_participation ON member_votes(bioguide_id, position)",
  );
  console.log("ok: idx_member_votes_participation");
  // HO 277: cover getFeedStats — the HeaderBar count (COUNT(*) + MAX(update_date)
  // over `summary IS NOT NULL AND (is_ceremonial=0 OR IS NULL)`), which runs on
  // EVERY inner page incl. /members. Same summary-gated mis-plan as HO 276's
  // then-`/dashboard-v2` corpus_gated (v2 is now `/`): the covering indexes carry no `summary`, so the
  // planner falls to a MULTI-INDEX OR over the fat bills table — measured 12.1s
  // cold against prod, the residual /members 500. A PARTIAL index `WHERE summary
  // IS NOT NULL` (= the always-present base clause) keyed (is_ceremonial,
  // update_date) makes the default COUNT+MAX index-only over a small partial set
  // (~15k rows, 2 tiny cols) → 38ms. getFeedStats forces it via INDEXED BY
  // (statless planner won't take it unhinted) EXCEPT when ?cluster= is set, where
  // idx_bills_cluster_id is the better path (see lib/queries.ts).
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_summary_feed ON bills(is_ceremonial, update_date) WHERE summary IS NOT NULL",
  );
  console.log("ok: idx_bills_summary_feed");
  // HO 278: cover the dashboard's gated stage distribution (getStageDistribution
  // (undefined, true) — the v2→`/` swap blocker; v2 is now `/`). Same summary-gated class: the
  // planner picks idx_bills_dash_stage (no `summary` → MULTI-INDEX OR + TEMP-B-TREE
  // GROUP BY, row-fetch). Partial, leading `stage` so the GROUP BY is index-only +
  // pre-ordered (no temp b-tree) and the offPath ('other'/NULL) range is covered;
  // 860ms → 32ms. Forced via INDEXED BY on the gated path (lib/queries.ts).
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_summary_stage ON bills(stage, is_ceremonial) WHERE summary IS NOT NULL",
  );
  console.log("ok: idx_bills_summary_stage");
  // HO 278: cover the dashboard's gated topic distribution (getTopicDistribution
  // (undefined, true)). `topics` is in the index so the bills scan feeding
  // json_each is index-only (no fat-table fetch for topics/summary); the planner
  // refused it unhinted (kept MULTI-INDEX OR), so it's forced via INDEXED BY on the
  // gated path. 175ms → 38ms.
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_summary_topics ON bills(is_ceremonial, topics) WHERE summary IS NOT NULL",
  );
  console.log("ok: idx_bills_summary_topics");
  // HO 382: cover the dashboard's FILTERED distributions — the /?stage= topic
  // treemap (getTopicDistribution(filters,true)) and the /?topics= stage funnel
  // (getStageDistribution(filters,true)). idx_bills_summary_stage covers stage but
  // not topics, idx_bills_summary_topics covers topics but not stage — so a
  // STAGE-filtered topic-dist or a TOPIC-filtered stage-dist row-fetched the
  // missing fat column over the whole ~15k corpus (committee topic-dist 24s,
  // defense stage-dist 28s → the filtered-view 10s-abort 500s). This index carries
  // BOTH: stage leads (seek for the topic treemap; ordered GROUP BY for the funnel)
  // and topics trails so the json_each fanout is index-resident (committee 24s →
  // 0.6s, defense 28s → 0.6s; every other stage/topic tens of ms). Like the other
  // json_each(table.col) paths, EXPLAIN labels it `USING INDEX` not `COVERING`
  // (SQLite never marks a table-valued-function plan covering) — but it IS
  // index-resident: the 42× speedup over the no-topics index proves topics is read
  // from the index, there is no INTEGER PRIMARY KEY row-fetch, and the partial
  // `WHERE summary IS NOT NULL` handles the summary gate without any table access.
  // Forced via INDEXED BY on the gated path in both helpers.
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_summary_stage_topics ON bills(stage, is_ceremonial, topics) WHERE summary IS NOT NULL",
  );
  console.log("ok: idx_bills_summary_stage_topics");
  // HO 328: cover getMembersTopicMix — the per-member top-3-topics bar on the
  // merged /members two-pane browser needs each member's topic counts in ONE
  // json_each fanout grouped by (sponsor_bioguide_id, topic). Without the index
  // the statless Turso planner drives off idx_bills_is_ceremonial and the fanout
  // is ~5s cold (tipping the 10s DB abort); the covering index makes the bills
  // scan feeding json_each index-only. Forced via INDEXED BY in the helper. Safe
  // only because the query always constrains sponsor_bioguide_id IS NOT NULL +
  // topics IS NOT NULL — keep both clauses if editing.
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_sponsor_topics ON bills(sponsor_bioguide_id, is_ceremonial, topics) WHERE topics IS NOT NULL",
  );
  console.log("ok: idx_bills_sponsor_topics");
  // HO 335 (closes the HO 332 audit). Five covering/partial indexes for the
  // last cold-start misplanners. Each is forced via INDEXED BY in lib/queries.ts
  // (Turso is statless — no ANALYZE — so the planner won't take them unhinted)
  // and proven by an EXPLAIN flip off idx_bills_is_ceremonial / a fat SCAN.
  //
  // getLawsEnactedBySessionWeek (/reports) was a full SCAN of 16k for the ~95
  // enacted-119 rows — the worst plan in the audit. Partial WHERE stage='enacted'
  // keyed (congress, latest_action_date) → a covering ~95-row congress lookup.
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_enacted ON bills(congress, latest_action_date) WHERE stage = 'enacted'",
  );
  console.log("ok: idx_bills_enacted");
  // (HO 335 considered idx_bills_stale_count for getStaleCount, but that helper
  // was dead code — grep-confirmed zero callers since HO 323/326 — and was deleted
  // instead of indexed. No index here; nothing maintains write cost for it.)
  // getFeedBills ?chamber count (/bills?chamber=) — partial WHERE summary IS NOT
  // NULL keyed (bill_type, is_ceremonial) → index-only COUNT over the chamber's
  // bill_type IN-list (else MULTI-INDEX OR on idx_bills_is_ceremonial).
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_chamber_feed ON bills(bill_type, is_ceremonial) WHERE summary IS NOT NULL",
  );
  console.log("ok: idx_bills_chamber_feed");
  // getBillsByMonth (/trends) groups the current-Congress, non-ceremonial,
  // topic-bearing corpus by introduced-month. Partial WHERE topics IS NOT NULL
  // keyed (congress, is_ceremonial, introduced_date, topics): congress lookup →
  // index-only scan carrying is_ceremonial + introduced_date + topics (topics[0]
  // feeds the per-topic split), so the full-corpus aggregate carries no random
  // row I/O. (HO 349 removed getIntroductionsByMonth, the index's second reader.)
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_trends_month ON bills(congress, is_ceremonial, introduced_date, topics) WHERE topics IS NOT NULL",
  );
  console.log("ok: idx_bills_trends_month");
  // getTopicMixByChamber (/trends) — full non-ceremonial corpus, json_each over
  // topics, split house/senate by bill_type. NOT summary-gated (counts unsummarized
  // too), so non-partial. Keyed (is_ceremonial, topics, bill_type) so the scan
  // feeding json_each is index-only including bill_type (idx_bills_dash_topics
  // lacks bill_type → would row-fetch ~14k; the planner else MULTI-INDEX ORs
  // idx_bills_is_ceremonial).
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_chamber_topics ON bills(is_ceremonial, topics, bill_type)",
  );
  console.log("ok: idx_bills_chamber_topics");
  // HO 336: FTS5 full-text search over bills for /search's BILLS tab. A leading-%
  // LIKE over title/summary full-scanned all 16k rows and cold-aborted past the
  // 10s DB limit on common terms (e.g. "tax" → 1290 matches) — no index helps a
  // leading wildcard, so HO 335's hint collapsed the plan but the scan was the
  // wall. External-content FTS5 (content='bills' — indexes, does NOT copy the
  // corpus) over title/summary/sponsor_name; searchBills/searchBillsCount MATCH it
  // + rank by bm25. `id` is deliberately EXCLUDED — its tokens (119, hr, number)
  // are in ~every id, so a prefix term like `1*` expands to ~the whole index and
  // blows up (a "119-hr-1" search hit a 20s abort while id was indexed). Triggers
  // keep it consistent across BOTH bills write paths: the sync upsert (INSERT /
  // ON CONFLICT DO UPDATE, lib/sync.ts) and the summarize UPDATE
  // (lib/summarize-runner.ts). bills is rarely deleted, but the delete trigger is
  // there for correctness. content_rowid='rowid' works because bills is a normal
  // (rowid) table — its PK is TEXT, not WITHOUT ROWID.
  await db.execute(
    "CREATE VIRTUAL TABLE IF NOT EXISTS bills_fts USING fts5(title, summary, sponsor_name, content='bills', content_rowid='rowid')",
  );
  await db.execute(`CREATE TRIGGER IF NOT EXISTS bills_fts_ai AFTER INSERT ON bills BEGIN
    INSERT INTO bills_fts(rowid, title, summary, sponsor_name)
    VALUES (new.rowid, new.title, new.summary, new.sponsor_name);
  END`);
  await db.execute(`CREATE TRIGGER IF NOT EXISTS bills_fts_ad AFTER DELETE ON bills BEGIN
    INSERT INTO bills_fts(bills_fts, rowid, title, summary, sponsor_name)
    VALUES ('delete', old.rowid, old.title, old.summary, old.sponsor_name);
  END`);
  await db.execute(`CREATE TRIGGER IF NOT EXISTS bills_fts_au AFTER UPDATE ON bills BEGIN
    INSERT INTO bills_fts(bills_fts, rowid, title, summary, sponsor_name)
    VALUES ('delete', old.rowid, old.title, old.summary, old.sponsor_name);
    INSERT INTO bills_fts(rowid, title, summary, sponsor_name)
    VALUES (new.rowid, new.title, new.summary, new.sponsor_name);
  END`);
  // Populate once from the existing corpus, guarded on empty. NOT a single
  // `INSERT INTO bills_fts(bills_fts) VALUES('rebuild')`: that reindexes all 16k
  // docs in one statement and exceeds the 10s boundedFetch (lib/db.ts, HO 238) —
  // it aborts+retries+throws even though the server finishes (HO 336 found this
  // the hard way). Rowid chunks keep each statement well under the limit. The
  // empty-guard means a re-run is a no-op (and avoids double-indexing rows).
  // Cheap existence check, NOT COUNT(*): a bare `COUNT(*) FROM bills_fts`
  // iterates the whole index and can itself exceed the 10s bound (HO 336).
  const ftsHasRows =
    (await db.execute("SELECT 1 FROM bills_fts LIMIT 1")).rows.length > 0;
  if (!ftsHasRows) {
    const maxRowid = Number(
      (await db.execute("SELECT COALESCE(MAX(rowid), 0) AS m FROM bills")).rows[0]?.m ?? 0,
    );
    // 500, not 1000: indexing 1000 bills' title+summary measured up to ~10.7s on
    // prod (HO 336 recovery) — over the 10s boundedFetch. 500 keeps each atomic
    // chunk to ~5s with margin; an abort would just roll back + retry the chunk.
    const CHUNK = 500;
    for (let lo = 0; lo < maxRowid; lo += CHUNK) {
      await db.execute({
        sql: `INSERT INTO bills_fts(rowid, title, summary, sponsor_name)
              SELECT rowid, title, summary, sponsor_name FROM bills
              WHERE rowid > ? AND rowid <= ?`,
        args: [lo, lo + CHUNK],
      });
    }
    console.log(`ok: bills_fts populated (chunked to rowid ${maxRowid})`);
  } else {
    console.log("ok: bills_fts already populated");
  }
  console.log("ok: bills_fts + triggers");
  // handoff 59: enrichment fields. Both nullable; NULL = "not yet populated"
  // (distinguishable from 0, which is a real "no cosponsors" / "empty text").
  await ensureColumn(db, "bills", "cosponsor_count", "INTEGER");
  await ensureColumn(db, "bills", "text_length", "INTEGER");
  // handoff 83: FEC fundraising. Cache the resolved FEC candidate_id on
  // members so the next sync skips the search step. `fec_resolved_at` is
  // bumped on both successful and unsuccessful resolution attempts, so a
  // member with NULL `fec_candidate_id` AND a recent `fec_resolved_at`
  // means "no FEC match found, don't retry constantly" — distinguishable
  // from NULL/NULL ("never tried").
  await ensureColumn(db, "members", "fec_candidate_id", "TEXT");
  await ensureColumn(db, "members", "fec_resolved_at", "TEXT");
  // handoff 94: current-service flag. `sync:members` sets it from the
  // Congress.gov `currentMember=true` roster; members who served part of the
  // 119th but no longer do (deaths, resignations) are kept as rows with
  // is_current = 0 rather than deleted, so historical "who held this seat"
  // queries still resolve.
  await ensureColumn(db, "members", "is_current", "INTEGER NOT NULL DEFAULT 1");
  // handoff 107: election round on primaries. 'primary' (default — every
  // existing row) or 'runoff'. A runoff is a primary-shaped contest, so it
  // lives as additional `primaries` rows (id suffix `-runoff`) rather than a
  // separate table; this column is the discriminator. getUpcomingPrimaries /
  // getPastPrimaries filter to 'primary' so /primaries stays primary-only.
  await ensureColumn(
    db,
    "primaries",
    "election_round",
    "TEXT NOT NULL DEFAULT 'primary'",
  );
  // Date of FEC's most-recent filing for the row, e.g. "2026-03-31" — feeds
  // the "as of {date}" suffix on the member-hub fundraising line. Lives on
  // member_fundraising rather than its own table because every fundraising
  // total inherently has one coverage window.
  await ensureColumn(db, "member_fundraising", "coverage_end_date", "TEXT");
  // HO 390: small/large-dollar donor split from FEC Schedule A by_size. Both
  // INTEGER cents, nullable (NULL = by_size not yet fetched for this row,
  // distinct from a real 0). small_dollar = the <$200 unitemized bucket
  // (FEC size=0); large_dollar = the itemized $200+ buckets (200/500/1000/2000)
  // summed. The honest, free donor cut (HO 388) — industry rollup stays parked.
  await ensureColumn(db, "member_fundraising", "small_dollar", "INTEGER");
  await ensureColumn(db, "member_fundraising", "large_dollar", "INTEGER");
  // handoff 115: summarize failure tracking. Summarize moved to its own cron
  // (/api/cron/summarize). `summarize_failed_at` gates the runner's selector —
  // a bill that just failed is skipped for 24h so a stuck bill can't burn
  // consecutive ticks. `summarize_attempts` counts cumulative failures so the
  // route can surface chronically-failing bills (>= 3) to the cron_runs error
  // trail for manual inspection. Both reset to NULL/0 when a bill re-syncs
  // with a new update_date (see UPSERT_SQL in lib/sync.ts) and on a
  // successful summary.
  await ensureColumn(db, "bills", "summarize_failed_at", "TEXT");
  await ensureColumn(
    db,
    "bills",
    "summarize_attempts",
    "INTEGER NOT NULL DEFAULT 0",
  );
  // handoff 214: 2024 House general-election margin per seat, scraped from the
  // per-seat Ballotpedia 2024 election page (House-only). SIGNED percentage-
  // point margin = winner% − runner-up%, sign by winner party: positive =
  // Republican-won, negative = Democrat-won (matches the race_ratings.score
  // R-positive/D-negative convention). NULL = no 2024 general for the seat
  // (Senate — last ran 2020/2022), an RCV result with no standard votebox
  // (Maine/Alaska), or an unresolved/404 page. 1:1 with the race, so it lives
  // on `races`.
  await ensureColumn(db, "races", "margin_2024", "REAL");
  // HO 221: retirement / incumbent-running flag for the OPEN-seat tag.
  // NULL = uncurated (render as a normal defended incumbent — the honest
  // default), 0 = incumbent not running (retiring or seeking other office →
  // OPEN seat), 1 = reserved for "confirmed running". Hand-seeded from the
  // Ballotpedia not-running-for-re-election list via races-seed.json. NULL is
  // NOT open — only an explicit 0 lights the tag. `incumbent_bioguide_id IS
  // NULL` is a different concept (vacancy/unmapped), can't express retirement.
  await ensureColumn(db, "races", "incumbent_running", "INTEGER");
  // HO 239: two-tick downgrade confirmation for the stage-monotonicity guard.
  // A proposed BACKWARD stage move (other than the impossible *→introduced,
  // which is hard-rejected outright) records the proposal here instead of
  // moving the slot: `pending_stage` is the proposed lower stage, `pending_
  // stage_at` its timestamp. The slot only moves if the NEXT classification of
  // that bill proposes the SAME downgrade — genuine recommits reclassify
  // stably, classifier flicker (HO 239 diagnostic) does not. Both NULL = no
  // pending proposal, the state for every bill pre-239.
  await ensureColumn(db, "bills", "pending_stage", "TEXT");
  await ensureColumn(db, "bills", "pending_stage_at", "TEXT");
  // HO 242: per-week counts persisted on the report so the /reports index
  // strip (LAWS · INTRO · MOVES) is queryable without prose-parsing
  // content_md. All three are computed LLM-free at generation; existing rows
  // are NULL until `scripts/backfill-report-counts.ts` recomputes them from
  // each report's week range. NULL = not yet backfilled (the index hides the
  // strip on any NULL); distinct from a real 0.
  await ensureColumn(db, "reports", "laws_count", "INTEGER");
  await ensureColumn(db, "reports", "intro_count", "INTEGER");
  await ensureColumn(db, "reports", "moves_count", "INTEGER");
  // HO 411: Senate class (1|2|3) ingested from legislators-current.yaml by
  // sync:members. The year-pair (next_election_year / current_term_end_year)
  // now derives from this deterministically instead of the drift-prone
  // startYear+6 / term-selection math. House rows stay NULL (correct — House
  // has no class). See lib/derive-term.ts + data/senate-special-elections.json.
  await ensureColumn(db, "members", "senate_class", "INTEGER");
  // HO 459: committee cross-link hydration sentinel. `committee_hydrated_at` is a
  // per-row "detail walk done" stamp — NULL means the civilian row still needs its
  // per-part `committees` fetch, set (even for the ~2% with no committee) means it
  // never re-fetches. A PARTIAL index over exactly the un-hydrated civilian rows
  // (the HO 406 summarize-queue precedent) keeps the hydration queue scan tiny as
  // rows drain out; hydrateNominations forces it via INDEXED BY (Turso's statless
  // planner otherwise mis-plans the `IS NULL` scan — the HO 406/407/369 lesson).
  // In main() (not the statements array) so it builds AFTER ensureColumn adds the
  // column on the live DB. NOT added to buildNominationStatement's SET clause — a
  // bulk-refresh re-upsert must preserve the hydration stamp, not re-null it.
  await ensureColumn(db, "nominations", "committee_hydrated_at", "TEXT");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_nominations_hydrate ON nominations(pn_number) WHERE is_military = 0 AND committee_hydrated_at IS NULL",
  );
  console.log("ok: idx_nominations_hydrate");
  // HO 597: the /lobbying VOLUME sort's materialized driver. VOLUME orders by
  // per-filing activity count, which was computed at REQUEST TIME as
  // `SELECT filing_uuid, COUNT(*) FROM lda_activities GROUP BY filing_uuid` —
  // an unbounded aggregate reading all 278,095 lda_activities rows to return
  // 128,909 groups (2026-08-04), measured at 20.0s co-located on ALL THREE cold
  // runs, i.e. both lib/db.ts attempts lost (HO 597 M3). The
  // SKILL authoring rule says an index cannot save a request-time aggregate over
  // a large table; materialize it. This is that materialization.
  //
  // The count is a property OF the filing and the sync already upserts that row,
  // so it lands as a column rather than the HO 595 side-table shape — nothing
  // else consumes the value and there is no unit ambiguity to protect (it is one
  // integer). A dashboard_state blob was out from the start: VOLUME's
  // `ORDER BY ... LIMIT ? OFFSET ?` is UPSTREAM of pagination, so a blob forces
  // ordering and paging into JS over 129k rows (the fork HO 595 M1 settled).
  //
  // NULL means "not yet counted", NOT zero — distinct states, and the rewire
  // must not ship against a NULL column. `scripts/backfill-lda-activity-count.ts`
  // fills every row (0 for the genuinely activity-less), and lib/lda-sync.ts
  // writes it on every upsert thereafter.
  await ensureColumn(db, "lda_filings", "activity_count", "INTEGER");
  // HO 598 round 2 — the routing hint. See the lda_names block above for why it is
  // advisory-only and why it is not maintained per-filing. Added before the
  // covering index is (re)built so the index can carry it.
  await ensureColumn(db, "lda_names", "filing_count", "INTEGER");
  // Built here, AFTER the column exists. Dropped first because the definition
  // CHANGED (filing_count was appended) and `CREATE INDEX IF NOT EXISTS` would
  // silently keep the old three-column index — the read path would then fall off
  // the covering plan with no error, which is exactly the kind of silent
  // regression this arc keeps finding.
  await db.execute("DROP INDEX IF EXISTS idx_lda_names_kind_name");
  await getLongTimeoutDb().execute(
    "CREATE INDEX IF NOT EXISTS idx_lda_names_kind_name ON lda_names(kind, name, entity_id, filing_count)",
  );
  console.log("ok: idx_lda_names_kind_name (covering, incl. filing_count)");
  // The sort index, in main() (not the statements array) so it builds AFTER
  // ensureColumn adds the column on the live DB — the idx_nominations_hydrate
  // precedent above. Column order mirrors the ORDER BY exactly
  // (activity_count DESC, dt_posted DESC) so the walk is pre-ordered and the
  // LIMIT short-circuits; getRecentFilings forces it via INDEXED BY (the
  // statless planner will not pick it unhinted — HO 241/406/407).
  // Built on the LONG-TIMEOUT client: over 129,338 rows this runs past the 10s
  // bound and the bounded client aborts mid-build — the server finishes anyway,
  // so migrate.ts would exit non-zero on a migration that actually succeeded.
  await getLongTimeoutDb().execute(
    "CREATE INDEX IF NOT EXISTS idx_lda_filings_activity ON lda_filings(activity_count DESC, dt_posted DESC)",
  );
  console.log("ok: idx_lda_filings_activity");
  // HO 598: the seek half of the search rewrite. lda_filings.registrant_id and
  // client_id already EXISTED as columns and were simply unindexed, so this is two
  // indexes and no schema change — the lookup table above turns the term into a set
  // of ids, and these turn "filings for those ids" into equality seeks instead of
  // another walk. Building one half without the other just moves the walk.
  //
  // Long-timeout client for the same reason as idx_lda_filings_activity: an index
  // build over 129,401 rows runs past lib/db.ts's 10s bound, the client aborts, and
  // migrate.ts exits non-zero on a build the server actually completed (HO 406/597).
  //
  // WHERE THE `linked` RESIDUAL LANDS (HO 597, deliberately NOT built here): its fix
  // is a materialized bill_linked column on lda_filings plus a
  // (bill_linked, activity_count DESC, dt_posted DESC) index. Same table, same
  // writer, same shape — it belongs in this block, next to these lines, so the two
  // fixes cost one migration rather than repeating the HO 597 sequence twice.
  {
    const long = getLongTimeoutDb();
    await long.execute(
      "CREATE INDEX IF NOT EXISTS idx_lda_filings_registrant_id ON lda_filings(registrant_id)",
    );
    console.log("ok: idx_lda_filings_registrant_id");
    await long.execute(
      "CREATE INDEX IF NOT EXISTS idx_lda_filings_client_id ON lda_filings(client_id)",
    );
    console.log("ok: idx_lda_filings_client_id");
  }
  // HO 659: the reach stamp on `race_candidates`. The table recorded nothing
  // temporal, so a harvest's effect could only be BRACKETED behaviourally
  // (HO 642 compared newest-date-reached against newest-reachable; HO 656 had to
  // hand-capture a before-state) — a staleness check is now one query.
  //
  // Semantics, pinned: `updated_at` is LAST WRITE (reach), not last content
  // change — an idempotent rewrite stamps, because what the instrument measures
  // is what a run TOUCHED. One `runStamp` per script invocation is bound into
  // every write of that run, so "which run touched this row" is a GROUP BY, not
  // a range guess. **NULL = pre-instrumentation** and is never backfilled with a
  // fabricated time; the behavioural bracket stays the record for pre-column
  // history, and the curated HO 171/174/182 rows read NULL until something
  // rewrites them.
  //
  // ensureColumn, not the CREATE array — the `activity_count` (HO 597) rule at
  // the top of this file governs: the array only runs for a fresh DB.
  await ensureColumn(db, "race_candidates", "updated_at", "TEXT");
  console.log("migration complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
