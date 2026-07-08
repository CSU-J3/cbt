// LDA lobbying data-layer sync (handoff 435). Ingests LD-2 quarterly
// activity reports from the Senate LDA API (now canonical at lda.gov) into
// three additive tables: lda_filings, lda_activities, lda_activity_bills.
// Surface-agnostic on purpose (HO 435) — stores what both planned HO-436
// surfaces need (bill-keyed lobbying + issue-code "what's being lobbied")
// so the surface HO can go either direction with no re-ingest.
//
// Source facts locked by the HO 434 probe:
//  - Base https://lda.gov/api/v1/. Auth header `Authorization: Token <key>`.
//  - `lobbying_activities` is embedded in each filings-list item, so the
//    bill-number join needs no per-filing fetch.
//  - DRF paging {count,next,previous,results}; page_size capped at 25 server
//    side. `ordering=dt_posted` sorts ascending; `filing_dt_posted_after=
//    YYYY-MM-DD` filters server-side.
//  - Bill-number join to `bills` was ~97% where a number is present; the
//    extractor (lib/bill-id-extract.ts) produces the matching id format.
//
// RESUMABILITY (HO 435 rev, after a 2h partial backfill was killed mid-2025-Q4):
// the resume point is DERIVED FROM THE DB, not a separate cursor blob. For each
// (filing_year, filing_type) the floor = MAX(dt_posted) already ingested for
// that combo. Because pages are fetched ascending by dt_posted and each flush is
// a transactional batch, the ingested set is always a CONTIGUOUS ascending
// prefix — so MAX(dt_posted) is the frontier and re-fetching `> floor` resumes
// mid-quarter with no interior gap and no redo of what's already in. Every write
// is a delete-and-rebuild under three PKs, so a re-touched filing resets cleanly
// (idempotent, never additive). The full ~108k-filing job at ~1.7s/page is
// inherently ~2h; if it stalls, the next run picks up from the DB frontier.
import { extractBillIds } from "./bill-id-extract";
import { getCurrentCongress } from "./congress";
import { getDb } from "./db";

const BASE = "https://lda.gov/api/v1";
const EPOCH_MS = 0;
const DAY_MS = 86_400_000;
// Current Congress only (HO 435 scope bound): 119th → filing years 2025, 2026.
// Filing types carrying lobbying_activities: the Q1..Q4 quarterly reports plus
// their amendments 1A..4A (each amendment is its own filing_uuid with the
// corrected activities — the "amendment tail" the weekly cadence exists for).
// The "No Activity" (*Y) and termination (*T / *@) variants are excluded: the
// first carry no activities, the latter are edge cases banked for later.
const FILING_TYPES = ["Q1", "Q2", "Q3", "Q4", "1A", "2A", "3A", "4A"];

type Db = ReturnType<typeof getDb>;

interface LdaActivity {
  general_issue_code: string | null;
  general_issue_code_display: string | null;
  description: string | null;
}
interface LdaFiling {
  filing_uuid: string;
  filing_type: string;
  filing_year: number;
  filing_period: string | null;
  dt_posted: string;
  income: string | null;
  expenses: string | null;
  registrant: { id: number | null; name: string | null } | null;
  client: { id: number | null; name: string | null } | null;
  lobbying_activities: LdaActivity[] | null;
}

export interface LdaSyncResult {
  mode: "backfill" | "incremental";
  filingsUpserted: number;
  activitiesUpserted: number;
  billLinksUpserted: number;
  pagesFetched: number;
  fetchErrors: number;
  throttled429: number;
  deadlineHit: boolean;
  combos: string[]; // per-combo one-line summaries, for the run log
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// getDb()'s boundedFetch (lib/db.ts) caps every Turso request at 10s and retries
// ONCE on a stall. A single transient double-timeout throws — over a ~2h backfill
// (a paged 16.6k-row bills read + thousands of flushes) that's likely and would
// abort the run. This adds a second, backed-off retry layer around each db call.
// Every op here is idempotent (upsert / delete-rebuild / read), so re-running is
// safe. (The prior run's tail "hang" was this double-timeout class under prod-
// cron write contention; resumability makes a stall a non-event.)
//
// maxAttempts default 8 (HO 435, tuned from 5 after the backfill kept dying mid-
// 2026-Q1): the shared prod DB has recurring ~3-min windows where EVERY Turso
// request (read AND write) times out — load-induced (the /api/cron/summarize tick
// runs every 10min with a 5-worker write pool; other sessions/crons pile on), not
// a fetch bug (the DB pings clean at rest). A 5-attempt layer (~10s of 1+2+3+4
// backoff) couldn't ride one out; 8 (1+..+7 = 28s backoff + each attempt's
// boundedFetch double-timeout ≈ 20s → ~3min span) rides out a normal window.
// LOAD_IDS_MAX_ATTEMPTS below overrides this higher for the one at-startup read
// that is the run's single point of failure (see loadValidBillIds).
async function dbRetry<T>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 8,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= maxAttempts) throw e;
      console.warn(`[lda] ${label} attempt ${attempt} failed (${(e as Error).name}), retrying`);
      await sleep(1000 * attempt);
    }
  }
}
// The at-startup bill-ids read is the run's SPOF: it runs ONCE before any work, so
// a timeout window landing at t=0 aborts the whole run with zero progress (this
// killed two resumes). Give it a much larger budget than the per-page/flush loop
// (which can afford to die and resume) so it outlasts even a long window.
const LOAD_IDS_MAX_ATTEMPTS = 20;

function authHeaders(): Record<string, string> {
  const key = process.env.LDA_API_KEY;
  const h: Record<string, string> = { Accept: "application/json" };
  if (key) h.Authorization = `Token ${key}`;
  return h;
}

function toNum(s: string | null): number | null {
  if (s == null || s === "") return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// dt_posted carries a TZ offset ("2025-04-06T03:26:59-04:00"); normalize to
// epoch ms so comparisons can't misrank across offsets.
function ms(dt: string | null): number {
  if (!dt) return EPOCH_MS;
  const t = Date.parse(dt);
  return Number.isNaN(t) ? EPOCH_MS : t;
}

interface FetchOpts {
  maxRetries?: number;
  onError?: () => void;
  onThrottle?: () => void;
}
interface Page {
  results: LdaFiling[];
  next: string | null;
  count: number;
}
async function fetchPage(url: string, opts: FetchOpts = {}): Promise<Page> {
  const maxRetries = opts.maxRetries ?? 6;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let r: Response;
    try {
      r = await fetch(url, { headers: authHeaders() });
    } catch (e) {
      opts.onError?.();
      if (attempt === maxRetries) throw e;
      await sleep(Math.min(2000 * (attempt + 1), 60_000)); // ECONNRESET backoff
      continue;
    }
    if (r.status === 429) {
      const raw = r.headers.get("retry-after");
      const parsed = Number(raw ?? "30");
      // Cap the per-429 backoff at 60s (HO 435 rev) so a pathological retry-after
      // can't stall the run; log it so throttling is never silent again.
      const wait = Math.min(Number.isFinite(parsed) ? parsed : 30, 60);
      opts.onThrottle?.();
      console.warn(`[lda] 429 throttled — waiting ${wait}s (retry-after=${raw ?? "-"})`);
      await sleep(wait * 1000 + 500);
      continue;
    }
    if (!r.ok) {
      opts.onError?.();
      throw new Error(`LDA ${r.status} on ${url}`);
    }
    return (await r.json()) as Page;
  }
  throw new Error(`LDA exhausted retries on ${url}`);
}

// Preload the current-Congress bill ids into a Set so the per-activity join is a
// cheap in-memory .has(). The full ~16.6k-row read is transfer-bound (~1ms/row →
// ~16s) and blows the 10s boundedFetch cap, so page it by keyset on the PK
// (id-ordered range scan, ~4s per 4k chunk). extractBillIds already stamps the
// current congress, so a current-Congress bills row is the only valid match.
async function loadValidBillIds(db: Db, congress: number): Promise<Set<string>> {
  const ids = new Set<string>();
  const PAGE = 4000;
  let after = "";
  for (;;) {
    const rs = await dbRetry(
      "loadValidBillIds",
      () =>
        db.execute({
          sql: "SELECT id FROM bills WHERE congress = ? AND id > ? ORDER BY id LIMIT ?",
          args: [congress, after, PAGE],
        }),
      LOAD_IDS_MAX_ATTEMPTS,
    );
    if (!rs.rows.length) break;
    for (const r of rs.rows) {
      const id = r.id as string;
      ids.add(id);
      after = id;
    }
    if (rs.rows.length < PAGE) break;
  }
  return ids;
}

// The DB-derived resume frontier for one (year, type): how many are ingested and
// the max dt_posted among them. Fast with idx_lda_filings_year_type_dt.
async function comboState(
  db: Db,
  year: number,
  type: string,
): Promise<{ count: number; maxDt: string | null }> {
  const rs = await dbRetry("comboState", () =>
    db.execute({
      sql: "SELECT COUNT(*) AS n, MAX(dt_posted) AS mx FROM lda_filings WHERE filing_year = ? AND filing_type = ?",
      args: [year, type],
    }),
  );
  const row = rs.rows[0];
  return { count: Number(row?.n ?? 0), maxDt: (row?.mx as string | null) ?? null };
}

type Stmt = { sql: string; args: (string | number | null)[] };

// Pure: builds the ordered statements for one filing — INSERT filing (upsert),
// then DELETE its activities + bill-links and rebuild them. The three PKs
// (filing_uuid; filing_uuid+ordinal; filing_uuid+ordinal+bill_id) plus the
// delete-rebuild make re-ingesting a filing fully idempotent: a filing re-touched
// on resume resets to exactly one row per activity/link, never doubles.
function buildFilingStatements(
  f: LdaFiling,
  validBillIds: Set<string>,
  ingestedAt: string,
): { stmts: Stmt[]; activities: number; billLinks: number } {
  const stmts: Stmt[] = [];
  stmts.push({
    sql: `INSERT INTO lda_filings
      (filing_uuid, filing_type, filing_year, filing_period, registrant_name,
       registrant_id, client_name, client_id, income, expenses, dt_posted, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(filing_uuid) DO UPDATE SET
        filing_type = excluded.filing_type, filing_year = excluded.filing_year,
        filing_period = excluded.filing_period, registrant_name = excluded.registrant_name,
        registrant_id = excluded.registrant_id, client_name = excluded.client_name,
        client_id = excluded.client_id, income = excluded.income,
        expenses = excluded.expenses, dt_posted = excluded.dt_posted,
        ingested_at = excluded.ingested_at`,
    args: [
      f.filing_uuid,
      f.filing_type,
      f.filing_year,
      f.filing_period,
      f.registrant?.name ?? null,
      f.registrant?.id ?? null,
      f.client?.name ?? null,
      f.client?.id ?? null,
      toNum(f.income),
      toNum(f.expenses),
      f.dt_posted,
      ingestedAt,
    ],
  });
  stmts.push({
    sql: "DELETE FROM lda_activity_bills WHERE filing_uuid = ?",
    args: [f.filing_uuid],
  });
  stmts.push({
    sql: "DELETE FROM lda_activities WHERE filing_uuid = ?",
    args: [f.filing_uuid],
  });

  let activities = 0;
  let billLinks = 0;
  const acts = f.lobbying_activities ?? [];
  for (const [i, a] of acts.entries()) {
    const ids = extractBillIds(a.description ?? "");
    stmts.push({
      sql: `INSERT INTO lda_activities
        (filing_uuid, activity_ordinal, general_issue_code, general_issue_code_display, description, bill_ids)
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        f.filing_uuid,
        i,
        a.general_issue_code ?? null,
        a.general_issue_code_display ?? null,
        a.description ?? null,
        JSON.stringify(ids),
      ],
    });
    activities++;
    for (const id of ids) {
      if (!validBillIds.has(id)) continue; // bill link only when it resolves
      stmts.push({
        sql: `INSERT OR IGNORE INTO lda_activity_bills (filing_uuid, activity_ordinal, bill_id)
              VALUES (?, ?, ?)`,
        args: [f.filing_uuid, i, id],
      });
      billLinks++;
    }
  }
  return { stmts, activities, billLinks };
}

export interface SyncLdaOptions {
  // Kept for logging/labelling; resume behavior is identical either way (both
  // derive the frontier from the DB). `backfill` just means "no deadline".
  backfill?: boolean;
  // Cron safety backstop. When reached, stop cleanly; the next run resumes from
  // the DB frontier with no gap. Manual backfill runs uncapped.
  deadlineMs?: number;
  // Pace between page fetches. Authed LDA tolerates ~40 rapid requests with no
  // 429 (HO 435 probe); the default was raised 100→400 (HO 435) to spread the DB
  // write load out — the throttle windows are load-rate-induced, not LDA-side.
  pageDelayMs?: number;
  // Backfill gentleness (HO 435). Every `cooldownEveryFilings` ingested, flush and
  // then pause `cooldownMs` so the sustained write load arrives in BURSTS with
  // recovery gaps — the ~3-min all-timeout windows are load-induced (the DB pings
  // clean at rest), so an intermittent load dodges what a continuous grind trips.
  // Applied ONLY in backfill mode (no deadline): the cron's small deltas rarely
  // reach the threshold and its 55s budget can't absorb a 45s pause.
  cooldownEveryFilings?: number;
  cooldownMs?: number;
  // Emit a line per combo start + every N pages (default 40).
  progressEveryPages?: number;
}

export async function syncLda(opts: SyncLdaOptions = {}): Promise<LdaSyncResult> {
  const {
    backfill = false,
    deadlineMs,
    pageDelayMs = 400,
    cooldownEveryFilings = 500,
    cooldownMs = 45_000,
    progressEveryPages = 40,
  } = opts;
  // Cooldowns only in an uncapped (backfill) run — see SyncLdaOptions.
  const cooldownsOn = !deadlineMs && cooldownMs > 0 && cooldownEveryFilings > 0;
  const db = getDb();
  const congress = getCurrentCongress();
  // 119th → [2025, 2026]. Derives from congress so it advances with the cycle.
  const firstYear = 2025 + (congress - 119) * 2;
  const years = [firstYear, firstYear + 1];

  const validBillIds = await loadValidBillIds(db, congress);
  const ingestedAt = new Date().toISOString();

  let filingsUpserted = 0;
  let activitiesUpserted = 0;
  let billLinksUpserted = 0;
  let pagesFetched = 0;
  let fetchErrors = 0;
  let throttled429 = 0;
  let deadlineHit = false;
  let nextCooldownAt = cooldownEveryFilings; // next filings-count that triggers a rest
  const combos: string[] = [];
  const fetchOpts: FetchOpts = {
    onError: () => fetchErrors++,
    onThrottle: () => throttled429++,
  };

  // Buffer statements across filings and flush in chunks — one Turso round-trip
  // per filing would make the ~108k-filing backfill take hours. Flushes only at
  // filing boundaries (never mid-filing). Each flush retries with backoff via
  // dbRetry (idempotent writes).
  // FLUSH_AT=100 (HO 435, tuned down from 300): a 300-stmt write transaction
  // reliably blew the 10s boundedFetch cap when it landed inside a summarize-cron
  // write burst; a ~100-stmt batch is a shorter transaction that clears in the
  // gaps between the cron's individual writes, so a flush is far less likely to
  // collide fatally. Slightly finer crash-safety granularity, negligible write
  // amplification. Pairs with the widened dbRetry above.
  const FLUSH_AT = 100;
  const pending: Stmt[] = [];
  const flush = async () => {
    if (!pending.length) return;
    const chunk = pending.splice(0);
    await dbRetry("flush", () => db.batch(chunk, "write"));
  };

  outer: for (const year of years) {
    for (const type of FILING_TYPES) {
      // Resume frontier for this combo, derived from the DB.
      const { count: dbCount, maxDt } = await comboState(db, year, type);
      const skipMs = ms(maxDt); // ingest only filings strictly newer than this
      // Server-side date filter set one day BEFORE the frontier so the boundary
      // day is re-returned (dt_posted is second-granular but the filter is
      // date-granular); client-side `dtMs <= skipMs` then dedups it. Omitted when
      // nothing is ingested yet (full scan).
      const afterDate =
        maxDt != null
          ? new Date(skipMs - DAY_MS).toISOString().slice(0, 10)
          : null;

      const params = new URLSearchParams({
        filing_year: String(year),
        filing_type: type,
        ordering: "dt_posted",
        page_size: "25",
      });
      if (afterDate) params.set("filing_dt_posted_after", afterDate);
      let url: string | null = `${BASE}/filings/?${params.toString()}`;

      // First page tells us the API total for this combo (validation: presence
      // isn't completeness — compare db vs api).
      let apiTotal = -1;
      let comboFilings = 0;
      let pagesInCombo = 0;

      while (url) {
        if (deadlineMs && Date.now() >= deadlineMs) {
          deadlineHit = true;
          await flush();
          break outer;
        }
        const page = await fetchPage(url, fetchOpts);
        pagesFetched++;
        pagesInCombo++;
        if (apiTotal < 0) apiTotal = page.count;
        for (const f of page.results) {
          if (ms(f.dt_posted) <= skipMs) continue; // already ingested (dedup)
          const { stmts, activities, billLinks } = buildFilingStatements(
            f,
            validBillIds,
            ingestedAt,
          );
          pending.push(...stmts);
          filingsUpserted++;
          comboFilings++;
          activitiesUpserted += activities;
          billLinksUpserted += billLinks;
        }
        if (pending.length >= FLUSH_AT) await flush();
        if (pagesInCombo % progressEveryPages === 0) {
          console.log(
            `[lda]   ${year} ${type}: ${pagesInCombo} pages, +${comboFilings} new (db-start=${dbCount}/${apiTotal})`,
          );
        }
        // Burst-and-rest (backfill only): after every cooldownEveryFilings
        // ingested, flush to a durable point and pause so the DB gets a recovery
        // gap between write bursts (the load-induced timeout-window mitigation).
        if (cooldownsOn && filingsUpserted >= nextCooldownAt) {
          await flush();
          console.log(
            `[lda]   cooldown ${(cooldownMs / 1000).toFixed(0)}s @ ${filingsUpserted} filings (DB recovery gap)`,
          );
          await sleep(cooldownMs);
          nextCooldownAt = filingsUpserted + cooldownEveryFilings;
        }
        url = page.next;
        if (url) await sleep(pageDelayMs);
      }
      await flush(); // durable at combo boundary

      const shortBy = apiTotal >= 0 ? apiTotal - dbCount : 0;
      const state =
        dbCount === 0
          ? "fresh"
          : shortBy > 0
            ? `resume (db ${dbCount} < api ${apiTotal}, short ${shortBy})`
            : `complete (db ${dbCount} >= api ${apiTotal})`;
      const line = `${year} ${type}: ${state}; from=${afterDate ?? "start"}; +${comboFilings} ingested`;
      combos.push(line);
      console.log(`[lda] ${line}`);
    }
  }
  await flush();

  return {
    mode: backfill ? "backfill" : "incremental",
    filingsUpserted,
    activitiesUpserted,
    billLinksUpserted,
    pagesFetched,
    fetchErrors,
    throttled429,
    deadlineHit,
    combos,
  };
}
