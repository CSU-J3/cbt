import "dotenv/config";
import { getDb } from "../lib/db";

type Db = ReturnType<typeof getDb>;

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
  `CREATE TABLE IF NOT EXISTS watchlist (
    bill_id TEXT PRIMARY KEY REFERENCES bills(id),
    added_at TEXT NOT NULL,
    notes TEXT
  )`,
  // Key-value store for cron-generated dashboard content. Flexible so future
  // dashboard state (other generated text, cached aggregates) needs no further
  // migration. Currently holds key = 'weekly_lead'.
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
  `CREATE TABLE IF NOT EXISTS stage_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id TEXT NOT NULL,
    from_stage TEXT,
    to_stage TEXT NOT NULL,
    changed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stage_transitions_bill ON stage_transitions(bill_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stage_transitions_changed_at ON stage_transitions(changed_at DESC)`,

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

async function main() {
  const db = getDb();
  for (const sql of statements) {
    await db.execute(sql);
    console.log("ok:", sql.split("\n")[0]);
  }
  await ensureColumn(db, "bills", "sponsor_bioguide_id", "TEXT");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_sponsor_bioguide ON bills(sponsor_bioguide_id)",
  );
  console.log("ok: idx_bills_sponsor_bioguide");
  await ensureColumn(db, "bills", "previous_stage", "TEXT");
  await ensureColumn(db, "bills", "stage_changed_at", "TEXT");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_stage_changed_at ON bills(stage_changed_at DESC)",
  );
  console.log("ok: idx_bills_stage_changed_at");
  await ensureColumn(db, "bills", "is_ceremonial", "INTEGER");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_is_ceremonial ON bills(is_ceremonial)",
  );
  console.log("ok: idx_bills_is_ceremonial");
  await ensureColumn(db, "bills", "cluster_id", "TEXT");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_cluster_id ON bills(cluster_id)",
  );
  console.log("ok: idx_bills_cluster_id");
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
  // getBillsByMonth + getIntroductionsByMonth (/trends) — both group the current-
  // Congress, non-ceremonial, topic-bearing corpus by introduced-month. Partial
  // WHERE topics IS NOT NULL keyed (congress, is_ceremonial, introduced_date,
  // topics): congress lookup → index-only scan carrying is_ceremonial +
  // introduced_date + topics (topics[0] feeds getBillsByMonth's per-topic split),
  // so the full-corpus aggregate carries no random row I/O. One index, two queries.
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
  console.log("migration complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
