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
  console.log("migration complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
