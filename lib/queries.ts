import { unstable_cache } from "next/cache";
import { CAUCUS_CONFIG, type CaucusOrg } from "./caucus-config";
import type { CronRunStatus } from "./cron-log";
import { CLUSTER_IDS, CLUSTER_PATTERNS } from "./cluster-patterns";
import { getDb } from "./db";
import {
  type EnactedBill,
  queryEnactedPriorWeekCount,
  queryEnactedThisWeek,
} from "./enacted-this-week";
import {
  MARKET_SYMBOLS,
  type MarketCadence,
  type MarketFormat,
  type MarketGroup,
} from "./markets";
import {
  ALLOWED_STAGES_SET,
  ALLOWED_TOPICS_SET,
  type Stage,
  type Topic,
} from "./enums";
import { NEWS_CONFIDENCE_FLOOR } from "./report-generation";
import type { ChamberControl, KalshiOdds } from "./kalshi";
import type { PolymarketOdds } from "./polymarket";

// HO 130: media-attention column. JOIN-at-read pattern reused across every
// feed-shaped query (getFeedBills, getStaleBills, getStageChanges,
// getPresidentBills, getWatchlistBills). One subquery materialized per
// statement; trivial at current news_mentions volume (~100 rows). Constants
// live here so a window/floor change is a one-file edit.
const MENTION_WINDOW_DAYS = 7;
const MENTION_SUBQUERY = `LEFT JOIN (
  SELECT bill_id, COUNT(*) AS n
  FROM news_mentions
  WHERE published_at >= datetime('now', '-${MENTION_WINDOW_DAYS} days')
    AND match_confidence >= ${NEWS_CONFIDENCE_FLOOR}
  GROUP BY bill_id
) nm ON nm.bill_id = bills.id`;
const MENTION_SELECT = "COALESCE(nm.n, 0) AS mention_count_7d";

// HO 300: sponsor member-data enrichment for the v2 feed sponsor card — the same
// LEFT JOIN + columns getFeedBills carries (HO 188/192/194), added to the v2 feed
// queries (getStageChanges / getStaleBills / getNewBillsThisWeek) so the MOVERS /
// TOP STALLS / NEW rows get the sponsor's photo, natural name, district, and
// cosponsor count (rowToFeedBill reads these when present). The members PK join is
// 1:1 so it never multiplies rows; it does NOT disturb the bills INDEXED BY hint.
// The other consumers of these queries (/changes, /stale, ActivityTicker) just
// gain the same enrichment, harmlessly.
const SPONSOR_ENRICH_SELECT = `bills.sponsor_bioguide_id, bills.cosponsor_count,
      msp.depiction_url AS sponsor_depiction_url,
      msp.first_name AS sponsor_first_name,
      msp.last_name AS sponsor_last_name,
      msp.district AS sponsor_district`;
const SPONSOR_ENRICH_JOIN =
  "LEFT JOIN members msp ON msp.bioguide_id = bills.sponsor_bioguide_id";

export const STALE_DAYS = 60;
export const STALE_ELIGIBLE_STAGES = [
  "introduced",
  "committee",
  "floor",
  "other_chamber",
  "other",
] as const;
export const STALE_FILTER_STAGES = [
  "introduced",
  "committee",
  "floor",
  "other_chamber",
] as const;
const STALE_FILTER_STAGES_SET = new Set<string>(STALE_FILTER_STAGES);

export type FeedBill = {
  id: string;
  congress: number;
  bill_type: string;
  bill_number: number;
  title: string;
  sponsor_name: string | null;
  sponsor_party: string | null;
  sponsor_state: string | null;
  introduced_date: string | null;
  latest_action_date: string | null;
  latest_action_text: string | null;
  update_date: string;
  summary: string | null;
  topics: string | null;
  stage: string | null;
  previous_stage?: string | null;
  stage_changed_at?: string | null;
  // HO 130: news-mentions count in the trailing 7d window, gated by
  // NEWS_CONFIDENCE_FLOOR. 0 when the bill has no high-confidence press;
  // every feed-shape query joins news_mentions to populate it.
  mentionCount7d?: number;
  // HO 188: expanded-panel enrichment columns. Optional + undefined-safe in
  // rowToFeedBill, so feed-shape queries that don't SELECT them (/stale,
  // /changes, /watchlist today) degrade to null — the sponsor link / cosponsor
  // count simply don't render there. getFeedBills (/bills) selects both.
  sponsor_bioguide_id?: string | null;
  cosponsor_count?: number | null;
  // HO 192: sponsor photo for the expanded-panel hover card. LEFT JOIN'd from
  // members.depiction_url in getFeedBills only; undefined-safe in rowToFeedBill
  // so other feed-shape queries degrade to null (no card off /bills).
  sponsor_depiction_url?: string | null;
  // HO 194: clean member fields for the refined card's text (natural-order
  // name + district). Same getFeedBills-only JOIN; sponsor_name's "Last, First
  // [bracket]" is too noisy to parse (suffixes/nicknames), so thread the real
  // columns. district is NULL for Senate and House at-large (chamber resolves
  // the two via bill_type).
  sponsor_first_name?: string | null;
  sponsor_last_name?: string | null;
  sponsor_district?: number | null;
};

export type BillDetail = FeedBill & {
  raw_json: string;
  summary_model: string | null;
  summary_updated_at: string | null;
};

export const SORT_KEYS = ["action", "introduced"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
const SORT_KEYS_SET = new Set<string>(SORT_KEYS);

export const CHAMBERS = ["house", "senate"] as const;
export type Chamber = (typeof CHAMBERS)[number];
const CHAMBERS_SET = new Set<string>(CHAMBERS);

const HOUSE_BILL_TYPES = "'hr','hjres','hconres','hres'";
const SENATE_BILL_TYPES = "'s','sjres','sconres','sres'";

export type FeedFilters = {
  topics?: string[];
  stage?: string;
  q?: string;
  sponsor?: string;
  sort?: SortKey;
  chamber?: Chamber;
  includeCeremonial?: boolean;
  cluster?: string;
  // HO 151: set to "asc" when /bills?stage=president is the sole stage and
  // no explicit ?sort is provided — preserves the legacy /president
  // oldest-at-desk-first ordering. Internal-only; never written by URL
  // params and not surfaced in SortDropdown.
  direction?: "asc";
};

export type PartyKey = "R" | "D" | "I";

// HO 335: types `Sponsor` and `SponsorFilters`, plus buildSponsorWhere and the
// getSponsors / getSponsorCount / getSponsorsRanked / getSponsorPassRates helpers
// (further down), deleted as dead code — orphaned by the HO 328 members/committees
// merge. The live sponsor surface is getSponsorStats / getSponsorTopTopics /
// getSponsorRecentBills (the /members?expanded card) and getSponsorStates.

export function normalizePartyVariant(party: string | null): PartyKey | null {
  if (!party) return null;
  const upper = party.trim().toUpperCase();
  if (upper === "R") return "R";
  if (upper === "D") return "D";
  return "I";
}

function normalizeBillIdQuery(q: string): string {
  return q.toLowerCase().replace(/[\s-]/g, "");
}

// HO 338: `opts.prefix` qualifies every bill-column reference (e.g. "bills.") so
// the same clauses can ride the FTS join in getFeedBills, where `summary` /
// `title` / `sponsor_name` are otherwise ambiguous against bills_fts's shadow
// columns. `opts.skipQ` omits the title/summary LIKE: the q path matches via
// bills_fts MATCH instead (see getFeedBills). Both default off, so every other
// caller (getStaleBills, getStageChanges, the count helpers) is byte-unchanged.
function buildFeedWhere(
  filters: FeedFilters,
  opts: { prefix?: string; skipQ?: boolean } = {},
): {
  clauses: string[];
  args: (string | number)[];
} {
  const p = opts.prefix ?? "";
  // Intentional: feed hides un-summarized rows (they read as broken to users).
  // Header counts derive from this same WHERE, so the displayed total always
  // matches what the feed renders. Don't drop without picking a placeholder UX.
  const clauses: string[] = [`${p}summary IS NOT NULL`];
  const args: (string | number)[] = [];

  if (filters.stage) {
    clauses.push(`${p}stage = ?`);
    args.push(filters.stage);
  }

  if (filters.sponsor) {
    clauses.push(`(${p}sponsor_bioguide_id = ? OR ${p}sponsor_name = ?)`);
    args.push(filters.sponsor, filters.sponsor);
  }

  if (filters.topics && filters.topics.length > 0) {
    const topicClauses = filters.topics.map(() => `${p}topics LIKE ?`);
    clauses.push(`(${topicClauses.join(" OR ")})`);
    for (const t of filters.topics) {
      args.push(`%"${t}"%`);
    }
  }

  const q = filters.q?.trim();
  if (q && !opts.skipQ) {
    const like = `%${q.toLowerCase()}%`;
    const idLike = `%${normalizeBillIdQuery(q)}%`;
    clauses.push(
      `(LOWER(${p}id) LIKE ? OR LOWER(${p}title) LIKE ? OR LOWER(${p}sponsor_name) LIKE ? OR LOWER(${p}summary) LIKE ? OR REPLACE(LOWER(${p}id), '-', '') LIKE ?)`,
    );
    args.push(like, like, like, like, idLike);
  }

  if (filters.chamber === "house") {
    clauses.push(`${p}bill_type IN (${HOUSE_BILL_TYPES})`);
  } else if (filters.chamber === "senate") {
    clauses.push(`${p}bill_type IN (${SENATE_BILL_TYPES})`);
  }

  // Cluster filter bypasses the ceremonial gate: most clusters are mostly
  // ceremonial, and opting into a cluster means asking to see all of it.
  if (filters.cluster) {
    clauses.push(`${p}cluster_id = ?`);
    args.push(filters.cluster);
  } else if (!filters.includeCeremonial) {
    // Hide ceremonial bills by default. NULL (unclassified) treated as visible
    // so the dashboard doesn't go dark during backfill.
    clauses.push(`(${p}is_ceremonial = 0 OR ${p}is_ceremonial IS NULL)`);
  }

  return { clauses, args };
}

export function sanitizeTopics(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((t) => t.trim())
    .filter((t) => ALLOWED_TOPICS_SET.has(t));
}

export function sanitizeStage(input: string | undefined): Stage | undefined {
  if (!input) return undefined;
  return ALLOWED_STAGES_SET.has(input) ? (input as Stage) : undefined;
}

// Single-topic validation for the dashboard's ?topics= param. The feed uses
// sanitizeTopics (plural, comma-split); the dashboard takes one topic for v1.
export function sanitizeTopic(input: string | undefined): Topic | undefined {
  if (!input) return undefined;
  return ALLOWED_TOPICS_SET.has(input) ? (input as Topic) : undefined;
}

export function sanitizeStaleStage(
  input: string | undefined,
): string | undefined {
  if (!input) return undefined;
  return STALE_FILTER_STAGES_SET.has(input) ? input : undefined;
}

export function sanitizeSort(raw: string | null | undefined): SortKey {
  if (raw && SORT_KEYS_SET.has(raw)) return raw as SortKey;
  return "action";
}

export function sanitizeChamber(
  raw: string | null | undefined,
): Chamber | undefined {
  if (raw && CHAMBERS_SET.has(raw)) return raw as Chamber;
  return undefined;
}

export function sanitizeIncludeCeremonial(
  raw: string | null | undefined,
): boolean {
  return raw === "1";
}

// HO 130: validates `?bill=` for the /news filter. Format is
// `<congress>-<billtype>-<number>`, e.g. `119-hr-1234`. Lowercase normalized.
// Invalid → undefined so the page falls back to the unfiltered view.
const BILL_ID_RE = /^[0-9]{1,4}-[a-z]+-[0-9]+$/;
export function sanitizeBillId(
  raw: string | null | undefined,
): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const normalized = raw.trim().toLowerCase();
  return BILL_ID_RE.test(normalized) ? normalized : undefined;
}

export function sanitizeClusterId(
  raw: string | null | undefined,
): string | undefined {
  if (!raw) return undefined;
  return CLUSTER_IDS.has(raw) ? raw : undefined;
}

function buildStaleWhere(filters: FeedFilters): {
  clauses: string[];
  args: (string | number)[];
} {
  const { clauses, args } = buildFeedWhere(filters);
  clauses.push("latest_action_date IS NOT NULL");
  clauses.push(`latest_action_date < date('now', '-${STALE_DAYS} days')`);
  const placeholders = STALE_ELIGIBLE_STAGES.map(() => "?").join(", ");
  clauses.push(`stage IN (${placeholders})`);
  for (const s of STALE_ELIGIBLE_STAGES) args.push(s);
  return { clauses, args };
}

export type FeedStats = {
  total: number;
  lastUpdated: string | null;
};

// Global "X bills · updated Y" counter shown in HeaderBar on every page.
// Cached for 1h because (a) the sync cron writes once daily, and (b) the
// sync route calls revalidateTag("bills") on success so post-sync hits
// see fresh numbers immediately. Step 0 measured this query at 1.5-3s; the
// HeaderBar runs on every page render, so caching it removes the dominant
// per-request cost across the entire dashboard.
export const getFeedStats = unstable_cache(
  async (
    includeCeremonial: boolean = false,
    cluster?: string,
  ): Promise<FeedStats> => {
    const db = getDb();
    const { clauses, args } = buildFeedWhere({ includeCeremonial, cluster });
    // HO 277: force the partial covering index idx_bills_summary_feed
    // (is_ceremonial, update_date) WHERE summary IS NOT NULL. This count runs in
    // HeaderBar on every inner page; the statless Turso planner otherwise drives
    // off idx_bills_is_ceremonial (MULTI-INDEX OR over the fat bills table) —
    // measured 12.1s cold against prod, the residual /members 500 (digest
    // 4101894172). `summary IS NOT NULL` is buildFeedWhere's always-present base
    // clause, so the partial index is always usable. EXCEPTION: a ?cluster=
    // filter bypasses the ceremonial gate and is far more selective on
    // idx_bills_cluster_id, so skip the hint there (don't force a partial-index
    // scan + row-fetch when a selective index exists).
    const fromHint = cluster ? "" : " INDEXED BY idx_bills_summary_feed";
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS total, MAX(update_date) AS last
            FROM bills${fromHint} WHERE ${clauses.join(" AND ")}`,
      args,
    });
    const row = r.rows[0];
    return {
      total: Number(row?.total ?? 0),
      lastUpdated: (row?.last as string | null) ?? null,
    };
  },
  ["getFeedStats"],
  { revalidate: 3600, tags: ["bills"] },
);

// Pipeline order, top-to-bottom, for the dashboard stage funnel.
const FUNNEL_STAGES: Stage[] = [
  "introduced",
  "committee",
  "floor",
  "other_chamber",
  "president",
  "enacted",
];

// Click-to-filter state for the dashboard panes (handoff 56). Single value
// each; the dashboard accepts a strict subset of feed-shaped params.
export type DashboardFilters = {
  stage?: Stage;
  topic?: Topic;
};

export type StageDistribution = {
  stage: Stage;
  count: number;
  percentage: number; // 0-100, of total substantive on-path bills
};

// Feeds the dashboard's stage funnel. Counts substantive (non-ceremonial)
// bills per on-path stage; `offPath` is the substantive bills with stage
// 'other' or NULL. Tagged "bills" so the sync cron's revalidateTag flushes it.
//
// `filters.topic` re-shapes the funnel to the stage distribution *within*
// that topic. `filters.stage` is NOT applied here — a single-bar funnel is
// useless; it only drives the component's selection state. unstable_cache
// keys on the args, so each filter variant gets its own cache slot.
export const getStageDistribution = unstable_cache(
  async (
    filters?: DashboardFilters,
    // HO 253: gate on `summary IS NOT NULL` for the v2 read path so the v2
    // masthead's four stage segments and the v2 body's stage chart sum to the
    // same summary-gated corpus total as getCorpusStats(true). `/` calls this
    // ungated, unchanged. No new args in the SQL — the clause is a literal — so
    // the existing placeholder/arg ordering is untouched.
    summaryGated = false,
  ): Promise<{
    bars: StageDistribution[];
    offPath: number;
    total: number;
  }> => {
    const db = getDb();
    const topic = filters?.topic;
    const topicClause = topic
      ? " AND EXISTS (SELECT 1 FROM json_each(bills.topics) WHERE value = ?)"
      : "";
    const topicArgs = topic ? [topic] : [];
    const summaryClause = summaryGated ? " AND summary IS NOT NULL" : "";
    // HO 278: force the partial covering index idx_bills_summary_stage
    // (stage, is_ceremonial) WHERE summary IS NOT NULL on the v2 gated path. The
    // statless planner otherwise picks idx_bills_dash_stage (no `summary` column →
    // MULTI-INDEX OR + TEMP-B-TREE GROUP BY, row-fetch for summary). The
    // stage-leading partial index makes the GROUP BY index-only AND pre-ordered
    // (no temp b-tree); 860ms → 32ms. Gated-only — the ungated `/` call lacks the
    // `summary IS NOT NULL` clause the partial index requires.
    const fromHint = summaryGated ? " INDEXED BY idx_bills_summary_stage" : "";

    const placeholders = FUNNEL_STAGES.map(() => "?").join(", ");
    const rs = await db.execute({
      sql: `SELECT stage, COUNT(*) AS count
            FROM bills${fromHint}
            WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
              AND stage IN (${placeholders})${summaryClause}${topicClause}
            GROUP BY stage`,
      args: [...FUNNEL_STAGES, ...topicArgs],
    });
    const counts = new Map<string, number>();
    for (const r of rs.rows) {
      counts.set(r.stage as string, Number(r.count ?? 0));
    }
    const total = FUNNEL_STAGES.reduce(
      (sum, s) => sum + (counts.get(s) ?? 0),
      0,
    );
    const bars: StageDistribution[] = FUNNEL_STAGES.map((stage) => {
      const count = counts.get(stage) ?? 0;
      return {
        stage,
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      };
    });

    const offRs = await db.execute({
      // HO 278: same idx_bills_summary_stage hint (leading stage covers the
      // 'other'/NULL range index-only on the gated path).
      sql: `SELECT COUNT(*) AS n FROM bills${fromHint}
            WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
              AND (stage = 'other' OR stage IS NULL)${summaryClause}${topicClause}`,
      args: [...topicArgs],
    });
    return {
      bars,
      offPath: Number(offRs.rows[0]?.n ?? 0),
      total,
    };
  },
  ["getStageDistribution"],
  { revalidate: 3600, tags: ["bills"] },
);

export type CorpusStats = {
  total: number; // total non-ceremonial bills
  lastSync: string | null; // ISO timestamp of most recent update_date
};

// Feeds the dashboard HeaderBar's "N bills tracked · last sync HH:MM MT" line.
//
// HO 253: `summaryGated` is the v2 corpus-count predicate. `/`'s HomeHeader calls
// this with no arg (non-ceremonial, summary-or-not — the pre-existing dashboard
// number); Dashboard v2 calls getCorpusStats(true) to add `summary IS NOT NULL`,
// matching buildFeedWhere so the v2 readout agrees with the inner pages it links
// to. unstable_cache keys on the arg, so the two variants get separate slots and
// the live `/` number is untouched.
export const getCorpusStats = unstable_cache(
  async (summaryGated = false): Promise<CorpusStats> => {
    const db = getDb();
    const summaryClause = summaryGated ? " AND summary IS NOT NULL" : "";
    // HO 278: the v2 gated path (getCorpusStats(true)) is the same summary-gated
    // COUNT+MAX as getFeedStats — the statless planner otherwise drives off
    // idx_bills_is_ceremonial (MULTI-INDEX OR over the fat table, ~6.9s cold, the
    // v2→`/` swap blocker — v2 is now `/`). Force the 277 partial index idx_bills_summary_feed
    // (is_ceremonial, update_date) WHERE summary IS NOT NULL → index-only COUNT+MAX
    // (6.9s → 34ms; EXPLAIN: SCAN USING INDEX). ONLY on the gated path — the
    // ungated `/` call has no `summary IS NOT NULL` clause, so the partial index
    // is unusable there (would be "no query solution").
    const fromHint = summaryGated ? " INDEXED BY idx_bills_summary_feed" : "";
    const rs = await db.execute(
      `SELECT COUNT(*) AS total, MAX(update_date) AS last_sync
       FROM bills${fromHint}
       WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)${summaryClause}`,
    );
    const r = rs.rows[0];
    return {
      total: Number(r?.total ?? 0),
      lastSync: (r?.last_sync as string | null) ?? null,
    };
  },
  ["getCorpusStats"],
  { revalidate: 3600, tags: ["bills"] },
);

// HO 244: non-ceremonial bills introduced in the trailing 7 days — the NEW
// BILLS metric on the dashboard weekly band. Same non-ceremonial convention as
// the other dashboard aggregates; deliberately NOT summary-gated (a brand-new
// introduction is usually unsummarized, and the band counts arrivals, not
// summarized arrivals). Cached, tag "bills".
export const getNewBillsThisWeekCount = unstable_cache(
  async (): Promise<number> => {
    const db = getDb();
    // HO 246: forced INDEXED BY idx_bills_introduced_date (introduced_date,
    // is_ceremonial). Turso is statless (no ANALYZE), so without the hint the
    // planner drives off idx_bills_is_ceremonial — the (=0 OR IS NULL) OR
    // matches ~every row, so it post-filters introduced_date over ~16k rows
    // (~6.8s warm, tipping the 10s DB_REQUEST_TIMEOUT cold: the HO 245
    // cold-start 500). The hint range-scans the selective last-7-days slice and
    // reads is_ceremonial from the same index (covering). Safe only because the
    // query always constrains introduced_date — keep that clause if editing.
    const rs = await db.execute(
      `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_introduced_date
       WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
         AND introduced_date IS NOT NULL
         AND introduced_date > date('now', '-7 days')`,
    );
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["getNewBillsThisWeekCount"],
  { revalidate: 3600, tags: ["bills"] },
);

export const getNewBillsThisWeek = unstable_cache(
  async (limit = 5): Promise<FeedBill[]> => {
    const db = getDb();
    // HO 249: row list for the NEW THIS WEEK feed tab. EXACT same predicate as
    // getNewBillsThisWeekCount above — non-ceremonial, introduced in the last 7
    // days — so the tab-label count and this list can't drift. Forced INDEXED
    // BY idx_bills_introduced_date for the same reason the count is (HO 246):
    // Turso is statless, so the planner else drives off idx_bills_is_ceremonial
    // and scans the corpus. Safe only because the WHERE always constrains
    // introduced_date — keep that clause if editing. ORDER BY introduced_date
    // DESC rides the same index (reverse range walk), no temp sort.
    const sql = `SELECT id, congress, bill_type, bill_number, title,
      sponsor_name, sponsor_party, sponsor_state, introduced_date,
      latest_action_date, latest_action_text, update_date,
      summary, topics, stage, stage_changed_at,
      ${SPONSOR_ENRICH_SELECT},
      ${MENTION_SELECT}
      FROM bills INDEXED BY idx_bills_introduced_date
      ${MENTION_SUBQUERY}
      ${SPONSOR_ENRICH_JOIN}
      WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
        AND introduced_date IS NOT NULL
        AND introduced_date > date('now', '-7 days')
      ORDER BY introduced_date DESC
      LIMIT ?`;

    const rs = await db.execute({ sql, args: [limit] });
    return rs.rows.map(rowToFeedBill);
  },
  ["getNewBillsThisWeek"],
  { revalidate: 3600, tags: ["bills", "news-breaking"] },
);

export type TopicCount = {
  topic: Topic;
  count: number;
};

// Corpus-wide topic distribution for the dashboard's right pane. `json_each`
// is the standard pattern for aggregating across the `topics` JSON column —
// it UNNESTs the array so each tag becomes its own row before GROUP BY. Any
// future JSON columns should aggregate the same way. Non-ceremonial only;
// NULL ceremonial counts as visible, same convention as buildFeedWhere.
//
// `filters.stage` narrows the counts to bills at that stage. `filters.topic`
// is NOT applied here — it only drives the component's selection state.
export const getTopicDistribution = unstable_cache(
  async (
    filters?: DashboardFilters,
    // HO 253: v2 reads this summary-gated too, so the body's TOPIC panel draws
    // from the same corpus as the gated headline total. `/` calls it ungated.
    summaryGated = false,
  ): Promise<TopicCount[]> => {
    const db = getDb();
    const stage = filters?.stage;
    const stageClause = stage ? " AND bills.stage = ?" : "";
    const stageArgs = stage ? [stage] : [];
    const summaryClause = summaryGated ? " AND bills.summary IS NOT NULL" : "";
    // HO 278: force the partial covering index idx_bills_summary_topics
    // (is_ceremonial, topics) WHERE summary IS NOT NULL on the v2 gated path, so
    // the bills scan feeding json_each is index-only (reads topics + is_ceremonial
    // from the index, no fat-table fetch) instead of the planner's MULTI-INDEX OR
    // on idx_bills_is_ceremonial; 175ms → 38ms. The json_each GROUP/ORDER temp
    // b-trees remain (24 groups, unavoidable + cheap). Gated-only — the ungated
    // `/` call lacks the `summary IS NOT NULL` clause the partial index requires.
    const fromHint = summaryGated ? " INDEXED BY idx_bills_summary_topics" : "";
    const rs = await db.execute({
      sql: `SELECT je.value AS topic, COUNT(*) AS count
       FROM bills${fromHint}, json_each(bills.topics) je
       WHERE bills.topics IS NOT NULL
         AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)${summaryClause}${stageClause}
       GROUP BY je.value
       ORDER BY count DESC`,
      args: [...stageArgs],
    });
    const result: TopicCount[] = [];
    for (const r of rs.rows) {
      const topic = r.topic as string;
      if (!ALLOWED_TOPICS_SET.has(topic)) {
        console.warn(
          `[getTopicDistribution] skipping unknown topic: ${topic}`,
        );
        continue;
      }
      result.push({ topic: topic as Topic, count: Number(r.count ?? 0) });
    }
    return result;
  },
  ["getTopicDistribution"],
  { revalidate: 3600, tags: ["bills"] },
);

export type TopicChamberCount = {
  topic: Topic;
  houseCount: number;
  senateCount: number;
};

// Chamber-faceted topic distribution (handoff 76). Mirrors getTopic-
// Distribution's conventions: json_each fanout so multi-topic bills count
// once per tag; non-ceremonial only (NULL counts as visible during back-
// fill); corpus-wide (no current-Congress filter). Chamber comes from
// bill_type prefix — every bill has exactly one chamber, so the two
// CASE-WHEN sums don't double-count. Sorted by combined count DESC so the
// two columns share an axis and disagreement reads visually.
export const getTopicMixByChamber = unstable_cache(
  async (): Promise<TopicChamberCount[]> => {
    const db = getDb();
    const rs = await db.execute(`
      SELECT je.value AS topic,
        SUM(CASE WHEN bills.bill_type IN ('hr','hjres','hconres','hres')
              THEN 1 ELSE 0 END) AS house_count,
        SUM(CASE WHEN bills.bill_type IN ('s','sjres','sconres','sres')
              THEN 1 ELSE 0 END) AS senate_count
      -- HO 335: force idx_bills_chamber_topics (is_ceremonial, topics, bill_type)
      -- so the json_each driver is index-only incl. bill_type (else the statless
      -- planner MULTI-INDEX ORs idx_bills_is_ceremonial + row-fetches ~14k rows).
      FROM bills INDEXED BY idx_bills_chamber_topics, json_each(bills.topics) je
      WHERE bills.topics IS NOT NULL
        AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)
      GROUP BY je.value
      ORDER BY (house_count + senate_count) DESC
    `);
    const result: TopicChamberCount[] = [];
    for (const r of rs.rows) {
      const topic = r.topic as string;
      if (!ALLOWED_TOPICS_SET.has(topic)) {
        console.warn(
          `[getTopicMixByChamber] skipping unknown topic: ${topic}`,
        );
        continue;
      }
      result.push({
        topic: topic as Topic,
        houseCount: Number(r.house_count ?? 0),
        senateCount: Number(r.senate_count ?? 0),
      });
    }
    return result;
  },
  ["getTopicMixByChamber"],
  { revalidate: 3600, tags: ["bills"] },
);

// HO 328: getSponsorProductivity + SponsorProductivityRow deleted here — the
// /members productivity scatter (MemberProductivityScatter) was their only
// consumer and the HO 328 two-pane merge dropped it. The covering index
// idx_bills_sponsor_agg they relied on stays (billsAggCte still uses it).

export type BillsByMonthRow = {
  month: string; // 'YYYY-MM'
  topic: string; // single topic slug; bills counted under their first topic
  count: number;
};

// Feeds the dashboard's bills-per-month time-series chart (handoff 66).
// Bills counted once each, under their first topic (`topics[0]`) — avoids
// double-counting and sidesteps json_each. Scoped to the current Congress
// via `MAX(congress)` rather than a hardcoded number so this keeps working
// across rollovers. Ceremonial excluded by default, matching the rest of
// the dashboard. Tag `bills` — the unified invalidation tag the sync cron
// already calls.
export const getBillsByMonth = unstable_cache(
  async (): Promise<BillsByMonthRow[]> => {
    const db = getDb();
    const rs = await db.execute(`
      SELECT
        substr(introduced_date, 1, 7) AS month,
        COALESCE(json_extract(topics, '$[0]'), 'other') AS topic,
        COUNT(*) AS count
      -- HO 335: force the partial idx_bills_trends_month (congress, is_ceremonial,
      -- introduced_date, topics) WHERE topics IS NOT NULL → index-only congress
      -- scan carrying topics for the topics[0] split (else idx_bills_is_ceremonial
      -- MULTI-INDEX OR + ~14k row-fetch). Shared with getIntroductionsByMonth.
      FROM bills INDEXED BY idx_bills_trends_month
      WHERE introduced_date IS NOT NULL
        AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
        AND topics IS NOT NULL
        AND congress = (SELECT MAX(congress) FROM bills)
      GROUP BY month, topic
      ORDER BY month, topic
    `);
    return rs.rows.map((r) => ({
      month: r.month as string,
      topic: r.topic as string,
      count: Number(r.count ?? 0),
    }));
  },
  ["getBillsByMonth"],
  { revalidate: 86400, tags: ["bills"] },
);

export type IntroductionsByMonthRow = {
  month: string; // 'YYYY-MM'
  count: number;
};

// HO 243 — total introductions per month for the calendar-axis TIMELINE on
// /trends. SAME universe as getBillsByMonth (current Congress, non-ceremonial,
// topics NOT NULL) minus the per-topic split, so the single line equals the
// envelope of the BillsTimeSeries stacked chart it sits beside. Do NOT derive
// this by summing getBillsByMonth — that's safe here because both share the
// `topics IS NOT NULL` gate, but a dedicated COUNT keeps the contract explicit
// and survives any later divergence of the per-topic query's filters.
export const getIntroductionsByMonth = unstable_cache(
  async (): Promise<IntroductionsByMonthRow[]> => {
    const db = getDb();
    const rs = await db.execute(`
      SELECT
        substr(introduced_date, 1, 7) AS month,
        COUNT(*) AS n
      -- HO 335: same partial idx_bills_trends_month as getBillsByMonth — covers
      -- this histogram index-only (congress lookup, is_ceremonial + introduced_date
      -- from the index; topics column unused here but the partial filter applies).
      FROM bills INDEXED BY idx_bills_trends_month
      WHERE introduced_date IS NOT NULL
        AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
        AND topics IS NOT NULL
        AND congress = (SELECT MAX(congress) FROM bills)
      GROUP BY month
      ORDER BY month
    `);
    return rs.rows.map((r) => ({
      month: r.month as string,
      count: Number(r.n ?? 0),
    }));
  },
  ["getIntroductionsByMonth"],
  { revalidate: 86400, tags: ["bills"] },
);

export type LawsByWeekRow = {
  congress: 118 | 119;
  weekOfSession: number; // 0 = first week after the Jan 3 start
  cumulativeLaws: number; // running total at end of that week
};

// Congress start dates (Jan 3 of the odd year). Used to bucket an enacted
// date into a week-of-session.
const CONGRESS_START: Record<number, string> = {
  118: "2023-01-03",
  119: "2025-01-03",
};
const WEEK_MS = 7 * 86_400_000;

// Cumulative enacted-law count by week of session, 118th vs 119th (HO 101) —
// backs the LawsEnactedComparison chart on /reports. The 118th comes from
// `historical_laws` (static backfill); the 119th from `bills` where
// stage='enacted' (kept fresh by the daily cron). One row per session week
// from 0 to the last week with data, carrying the running total forward
// across quiet weeks, so a chart can plot a continuous cumulative line. The
// week math is done in TypeScript rather than SQL — the row counts are tiny
// (~274 + ~95) and a libSQL window-function CTE buys nothing here. Tagged
// "bills" so the sync cron's revalidateTag refreshes the 119th line.
export const getLawsEnactedBySessionWeek = unstable_cache(
  async (): Promise<LawsByWeekRow[]> => {
    const db = getDb();
    const h118 = await db.execute(
      "SELECT enacted_date AS d FROM historical_laws WHERE congress = 118",
    );
    // HO 335: force the partial idx_bills_enacted (congress, latest_action_date)
    // WHERE stage='enacted'. Unhinted this was a full SCAN of 16k for ~95 rows
    // (the audit's worst plan); the partial makes it a covering congress lookup.
    const h119 = await db.execute(
      `SELECT latest_action_date AS d FROM bills INDEXED BY idx_bills_enacted
         WHERE congress = 119 AND stage = 'enacted'
           AND latest_action_date IS NOT NULL`,
    );

    const series = (
      rows: Array<Record<string, unknown>>,
      congress: 118 | 119,
    ): LawsByWeekRow[] => {
      const start = Date.parse(`${CONGRESS_START[congress]}T00:00:00Z`);
      const perWeek = new Map<number, number>();
      let maxWeek = -1;
      for (const r of rows) {
        const d = r.d as string | null;
        if (!d) continue;
        const t = Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
        if (Number.isNaN(t)) continue;
        const w = Math.max(0, Math.floor((t - start) / WEEK_MS));
        perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
        if (w > maxWeek) maxWeek = w;
      }
      const out: LawsByWeekRow[] = [];
      let cum = 0;
      for (let w = 0; w <= maxWeek; w++) {
        cum += perWeek.get(w) ?? 0;
        out.push({ congress, weekOfSession: w, cumulativeLaws: cum });
      }
      return out;
    };

    return [
      ...series(h118.rows as Array<Record<string, unknown>>, 118),
      ...series(h119.rows as Array<Record<string, unknown>>, 119),
    ];
  },
  ["getLawsEnactedBySessionWeek"],
  { revalidate: 86400, tags: ["bills"] },
);

// The cron-generated 3-sentence dashboard lead, stored in dashboard_state
// under key 'weekly_lead'. Returns null if the cron hasn't generated one yet
// (fresh DB). Tagged "bills" so the cron's revalidateTag flushes it after a
// fresh generation writes the new lead.
export const getDashboardLead = unstable_cache(
  async (): Promise<{ text: string; updatedAt: string } | null> => {
    const db = getDb();
    const rs = await db.execute(
      `SELECT value, updated_at FROM dashboard_state WHERE key = 'weekly_lead'`,
    );
    const r = rs.rows[0];
    if (!r) return null;
    return {
      text: r.value as string,
      updatedAt: r.updated_at as string,
    };
  },
  ["getDashboardLead"],
  { revalidate: 3600, tags: ["bills"] },
);

export type ReportListItem = {
  slug: string;
  title: string;
  weekStart: string;
  weekEnd: string;
};

export type Report = ReportListItem & {
  contentMd: string;
  createdAt: string;
};

// Weekly cron-generated reports (handoff 58). Tagged "reports" — a separate
// tag from "bills" because the cron's report step revalidates independently
// of the sync/summarize steps. The list helpers that surface a derived
// lead live further down (getReportsWithLead, getDashboardReportSnapshot,
// HO 153); both supersede the pre-HO-153 lightweight getReports and
// getReportsList helpers, which were removed in HO 154.1 as dead code.
export const getReportCount = unstable_cache(
  async (): Promise<number> => {
    const db = getDb();
    const rs = await db.execute("SELECT COUNT(*) AS n FROM reports");
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["getReportCount"],
  { revalidate: 3600, tags: ["reports"] },
);

// HO 153: list helper that carries a derived 1-2-line lead per row.
// Separate from getReports so existing callers keep their lighter
// ReportListItem shape; the lead is extracted at read time from
// content_md (lib/report-lead.ts) so the generation pipeline stays
// untouched per the handoff's "don't add a field for a display concern"
// discipline. Selecting content_md per row is cheap at the table's
// scale (weekly cadence, <60 rows in practice; the page caps at 20).
// HO 242: the per-week counts ride the index row for the LAWS·INTRO·MOVES
// strip. Each is `number | null` — NULL on rows not yet backfilled
// (scripts/backfill-report-counts.ts); the row hides the strip on any NULL.
export type ReportListItemWithLead = ReportListItem & {
  lead: string;
  lawsCount: number | null;
  introCount: number | null;
  movesCount: number | null;
};

export const getReportsWithLead = unstable_cache(
  async (
    limit: number,
    offset: number,
  ): Promise<ReportListItemWithLead[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT slug, title, week_start, week_end, content_md,
                   laws_count, intro_count, moves_count
            FROM reports
            ORDER BY week_start DESC
            LIMIT ? OFFSET ?`,
      args: [limit, offset],
    });
    const { extractReportLead } = await import("./report-lead");
    const num = (v: unknown): number | null =>
      v === null || v === undefined ? null : Number(v);
    return rs.rows.map((r) => ({
      slug: r.slug as string,
      title: r.title as string,
      weekStart: r.week_start as string,
      weekEnd: r.week_end as string,
      lead: extractReportLead(r.content_md as string),
      lawsCount: num(r.laws_count),
      introCount: num(r.intro_count),
      movesCount: num(r.moves_count),
    }));
  },
  ["getReportsWithLead"],
  { revalidate: 3600, tags: ["reports"] },
);

// HO 153: backs the dashboard snapshot strip — latest report's date +
// derived lead. HO 159 dropped the prior-date list (the "PREVIOUS · …"
// archive row left the dashboard for /reports, which already lists past
// weeks). Returns null when zero reports exist so the slot can stay empty
// rather than render a placeholder.
export type DashboardReportSnapshot = {
  latest: ReportListItemWithLead;
};

export const getDashboardReportSnapshot = unstable_cache(
  async (): Promise<DashboardReportSnapshot | null> => {
    const db = getDb();
    const rs = await db.execute(
      `SELECT slug, title, week_start, week_end, content_md,
              laws_count, intro_count, moves_count
       FROM reports
       ORDER BY week_start DESC
       LIMIT 1`,
    );
    if (rs.rows.length === 0) return null;
    const { extractReportLead } = await import("./report-lead");
    const num = (v: unknown): number | null =>
      v === null || v === undefined ? null : Number(v);
    const [head] = rs.rows;
    return {
      latest: {
        slug: head!.slug as string,
        title: head!.title as string,
        weekStart: head!.week_start as string,
        weekEnd: head!.week_end as string,
        lead: extractReportLead(head!.content_md as string),
        lawsCount: num(head!.laws_count),
        introCount: num(head!.intro_count),
        movesCount: num(head!.moves_count),
      },
    };
  },
  ["getDashboardReportSnapshot"],
  { revalidate: 3600, tags: ["reports"] },
);

// ---- Members (handoff 60) ------------------------------------------------

export type Member = {
  bioguideId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  party: PartyKey | null;
  state: string | null;
  stateName: string | null;
  district: number | null;
  chamber: "house" | "senate" | null;
  birthYear: number | null;
  depictionUrl: string | null;
  currentTermEndYear: number | null;
  nextElectionYear: number | null;
};

export type MemberStats = {
  billsSponsored: number;
  billsEnacted: number;
  enactedRate: number; // 0-1, 0 when billsSponsored is 0
  avgCosponsorCount: number | null;
};

function rowToMember(r: Record<string, unknown>): Member {
  const party = r.party as string | null;
  return {
    bioguideId: r.bioguide_id as string,
    name: r.name as string,
    firstName: (r.first_name as string | null) ?? null,
    lastName: (r.last_name as string | null) ?? null,
    party:
      party === "R" || party === "D" || party === "I"
        ? (party as PartyKey)
        : null,
    state: (r.state as string | null) ?? null,
    stateName: (r.state_name as string | null) ?? null,
    district:
      r.district === null || r.district === undefined
        ? null
        : Number(r.district),
    chamber:
      r.chamber === "house" || r.chamber === "senate"
        ? (r.chamber as "house" | "senate")
        : null,
    birthYear:
      r.birth_year === null || r.birth_year === undefined
        ? null
        : Number(r.birth_year),
    depictionUrl: (r.depiction_url as string | null) ?? null,
    currentTermEndYear:
      r.current_term_end_year === null || r.current_term_end_year === undefined
        ? null
        : Number(r.current_term_end_year),
    nextElectionYear:
      r.next_election_year === null || r.next_election_year === undefined
        ? null
        : Number(r.next_election_year),
  };
}

export const getMember = unstable_cache(
  async (bioguideId: string): Promise<Member | null> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT bioguide_id, name, first_name, last_name, party, state, state_name,
              district, chamber, birth_year, depiction_url,
              current_term_end_year, next_election_year
            FROM members WHERE bioguide_id = ? LIMIT 1`,
      args: [bioguideId],
    });
    const r = rs.rows[0];
    return r ? rowToMember(r) : null;
  },
  ["getMember"],
  { revalidate: 86400, tags: ["members"] },
);

// Excludes ceremonial bills from the enacted rate so the number reflects
// substantive work (a renaming counts toward "bills sponsored" elsewhere,
// but enacted-rate is a quality signal, not a volume signal).
export const getMemberStats = unstable_cache(
  async (bioguideId: string): Promise<MemberStats> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT
              COUNT(*) AS bills_sponsored,
              SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS bills_enacted,
              AVG(cosponsor_count) AS avg_cosponsor_count
            FROM bills
            WHERE sponsor_bioguide_id = ?
              AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`,
      args: [bioguideId],
    });
    const r = rs.rows[0];
    const billsSponsored = Number(r?.bills_sponsored ?? 0);
    const billsEnacted = Number(r?.bills_enacted ?? 0);
    const avgRaw = r?.avg_cosponsor_count;
    return {
      billsSponsored,
      billsEnacted,
      enactedRate: billsSponsored > 0 ? billsEnacted / billsSponsored : 0,
      avgCosponsorCount:
        avgRaw === null || avgRaw === undefined ? null : Number(avgRaw),
    };
  },
  ["getMemberStats"],
  { revalidate: 86400, tags: ["members"] },
);

export type MemberAffiliation = {
  org: CaucusOrg;
  category: string;
  source_url: string | null;
  last_verified: string;
};

// Hand-curated caucus affiliations for a member (handoff 61). Sorted by
// CAUCUS_CONFIG.priority asc so the highest-signal badge renders first
// everywhere (header truncation, full affiliations row). Unknown orgs are
// filtered out — protects against renames in CAUCUS_CONFIG leaving orphan
// rows in the affiliations table. Tagged "members" so the member-bio sync
// invalidation flushes it; affiliations themselves change via the seed
// script, which the user re-runs manually after editing the JSON.
export const getMemberAffiliations = unstable_cache(
  async (bioguideId: string): Promise<MemberAffiliation[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT org, category, source_url, last_verified
            FROM affiliations
            WHERE bioguide_id = ?`,
      args: [bioguideId],
    });
    const rows: MemberAffiliation[] = [];
    for (const r of rs.rows) {
      const org = r.org as string;
      if (!(org in CAUCUS_CONFIG)) continue;
      rows.push({
        org: org as CaucusOrg,
        category: r.category as string,
        source_url: (r.source_url as string | null) ?? null,
        last_verified: r.last_verified as string,
      });
    }
    rows.sort(
      (a, b) => CAUCUS_CONFIG[a.org].priority - CAUCUS_CONFIG[b.org].priority,
    );
    return rows;
  },
  ["getMemberAffiliations"],
  { revalidate: 86400, tags: ["members"] },
);

// Ceremonial bills included — the member hub is about a person's full output,
// not a substantive-only feed. The UI can dim ceremonial rows via the
// existing is_ceremonial signal threaded through FeedBill.
export const getMemberBills = unstable_cache(
  async (bioguideId: string, limit: number = 10): Promise<FeedBill[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT id, congress, bill_type, bill_number, title,
              sponsor_name, sponsor_party, sponsor_state, introduced_date,
              latest_action_date, latest_action_text, update_date,
              summary, topics, stage, stage_changed_at
            FROM bills
            WHERE sponsor_bioguide_id = ?
            ORDER BY latest_action_date DESC NULLS LAST, id DESC
            LIMIT ?`,
      args: [bioguideId, limit],
    });
    return rs.rows.map(rowToFeedBill);
  },
  ["getMemberBills"],
  { revalidate: 86400, tags: ["members", "bills"] },
);

export type PalestineScorecard = {
  grade: string;
  rank: number | null;
  sponsor_score: string | null;
  voting_score: string | null;
  total_score: string | null;
  votes: Record<string, string>;
};

// USCPR Senate Palestine voting scorecard for a member (handoff 90). Returns
// null for anyone not on the scorecard — Republicans, House members, and any
// senator absent from the source sheet — so the member hub renders the
// section only when this is non-null. Synced manually via
// `npm run sync:palestine`; tagged "members" to ride the member-bio cache
// invalidation surface.
export const getPalestineScorecard = unstable_cache(
  async (bioguideId: string): Promise<PalestineScorecard | null> => {
    const db = getDb();
    const result = await db.execute({
      sql: `SELECT grade, rank, sponsor_score, voting_score, total_score, votes_json
            FROM palestine_scorecard WHERE bioguide_id = ?`,
      args: [bioguideId],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      grade: row.grade as string,
      rank:
        row.rank === null || row.rank === undefined ? null : Number(row.rank),
      sponsor_score: (row.sponsor_score as string | null) ?? null,
      voting_score: (row.voting_score as string | null) ?? null,
      total_score: (row.total_score as string | null) ?? null,
      votes: JSON.parse(row.votes_json as string) as Record<string, string>,
    };
  },
  ["getPalestineScorecard"],
  { revalidate: 86400, tags: ["members"] },
);

// ---- Primaries (handoff 91) ---------------------------------------------

export type PrimaryCandidate = {
  id: number;
  name: string;
  party: string;
  incumbent: boolean;
  bioguide_id: string | null;
  status: string;
  vote_pct: number | null;
};

export type PrimaryWithCandidates = {
  id: string;
  state: string;
  district: string | null;
  chamber: string;
  party: string;
  primary_date: string | null;
  runoff_date: string | null;
  primary_type: string | null;
  race_id: string | null;
  candidates: PrimaryCandidate[];
  // HO 203: bioguide of the member who CURRENTLY holds this seat (house seat
  // matched by state+district against `members`, is_current). Used to mark the
  // actual seat incumbent with ★ — distinct from the per-candidate `incumbent`
  // flag, which is "is a sitting member of Congress" (true for >1 candidate in
  // top-two / redraw contests like CA-40 Calvert+Kim or TX-18 Menefee+Green).
  // NULL for at-large (members.district is NULL), senate, and open seats — the
  // render falls back to the `incumbent` flag there (≤1 in those, no bug).
  seat_incumbent_bioguide: string | null;
};

// Candidate rows are folded into one string per primary by GROUP_CONCAT:
// fields joined by '|', rows by '~~'. The row separator is '~~' rather than
// the default comma so a candidate name containing a comma can't corrupt the
// split (rosters land in the handoff 91 Step 3 follow-up).
const PRIMARY_CANDIDATE_FIELDS =
  "pc.id || '|' || pc.name || '|' || pc.party || '|' || " +
  "pc.incumbent || '|' || COALESCE(pc.bioguide_id,'') || '|' || " +
  "pc.status || '|' || COALESCE(pc.vote_pct,'')";

function parseCandidatesRaw(raw: string | null): PrimaryCandidate[] {
  if (!raw) return [];
  return raw.split("~~").map((c) => {
    const [id, name, party, incumbent, bioguideId, status, votePct] =
      c.split("|");
    return {
      id: Number(id ?? 0),
      name: name ?? "",
      party: party ?? "",
      incumbent: incumbent === "1",
      bioguide_id: bioguideId || null,
      status: status ?? "running",
      vote_pct: votePct ? Number(votePct) : null,
    };
  });
}

function rowToPrimary(r: Record<string, unknown>): PrimaryWithCandidates {
  return {
    id: r.id as string,
    state: r.state as string,
    district: (r.district as string | null) ?? null,
    chamber: r.chamber as string,
    party: r.party as string,
    primary_date: (r.primary_date as string | null) ?? null,
    runoff_date: (r.runoff_date as string | null) ?? null,
    primary_type: (r.primary_type as string | null) ?? null,
    race_id: (r.race_id as string | null) ?? null,
    candidates: parseCandidatesRaw(
      (r.candidates_raw as string | null) ?? null,
    ),
    seat_incumbent_bioguide:
      (r.seat_incumbent_bioguide as string | null) ?? null,
  };
}

const PRIMARY_SELECT =
  `SELECT p.id, p.state, p.district, p.chamber, p.party,
     p.primary_date, p.runoff_date, p.primary_type, p.race_id,
     GROUP_CONCAT(${PRIMARY_CANDIDATE_FIELDS}, '~~') AS candidates_raw,
     (SELECT m.bioguide_id FROM members m
        WHERE m.is_current = 1 AND m.chamber = 'house'
          AND m.state = p.state
          AND m.district = CAST(p.district AS INTEGER)
        LIMIT 1) AS seat_incumbent_bioguide
   FROM primaries p
   LEFT JOIN primary_candidates pc ON pc.primary_id = p.id`;

// Primaries on or after today, soonest first — backs the /primaries index.
// `election_round = 'primary'` keeps runoff rows (HO 107) out of /primaries
// and /races; runoffs surface only via getRunoffsForRace on the race page.
export async function getUpcomingPrimaries(
  limit = 50,
): Promise<PrimaryWithCandidates[]> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const rs = await db.execute({
    sql: `${PRIMARY_SELECT}
          WHERE p.primary_date >= ? AND p.election_round = 'primary'
          GROUP BY p.id
          ORDER BY p.primary_date ASC, p.state ASC, p.party ASC
          LIMIT ?`,
    args: [today, limit],
  });
  return rs.rows.map((r) => rowToPrimary(r));
}

// Primaries before today, most recent first — the /primaries "Past" section.
export async function getPastPrimaries(
  limit = 200,
): Promise<PrimaryWithCandidates[]> {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const rs = await db.execute({
    sql: `${PRIMARY_SELECT}
          WHERE p.primary_date < ? AND p.election_round = 'primary'
          GROUP BY p.id
          ORDER BY p.primary_date DESC, p.state ASC, p.party ASC
          LIMIT ?`,
    args: [today, limit],
  });
  return rs.rows.map((r) => rowToPrimary(r));
}

// Single primary lookup for a state + party. A non-null `district` selects
// the House id shape; null resolves to the state-level (senate-prefixed) row
// every member of that state shares. Returns null when no such row exists.
export async function getPrimaryForRace(
  state: string,
  district: string | null,
  party: string,
): Promise<PrimaryWithCandidates | null> {
  const db = getDb();
  const id = district
    ? `house-${state}-${district}-2026-${party}`
    : `senate-${state}-2026-${party}`;
  const rs = await db.execute({
    sql: `${PRIMARY_SELECT}
          WHERE p.id = ?
          GROUP BY p.id`,
    args: [id],
  });
  const row = rs.rows[0];
  return row ? rowToPrimary(row) : null;
}

// Runoff contests for a race (handoff 107). A race can have more than one —
// Louisiana's closed-primary system runs a separate runoff per party, so
// `S-LA-2026` returns both the Republican and Democratic runoffs. Ordered by
// party for stable rendering. Returns [] when the race had no runoff.
// Reuses PRIMARY_SELECT / rowToPrimary — a runoff row is a `primaries` row
// with `election_round = 'runoff'`.
export async function getRunoffsForRace(
  raceId: string,
): Promise<PrimaryWithCandidates[]> {
  const db = getDb();
  const rs = await db.execute({
    sql: `${PRIMARY_SELECT}
          WHERE p.race_id = ? AND p.election_round = 'runoff'
          GROUP BY p.id
          ORDER BY p.party ASC`,
    args: [raceId],
  });
  return rs.rows.map((r) => rowToPrimary(r));
}

// ---- Full-cycle primary calendar (HO 333) -------------------------------

export type PrimaryCalendarDate = {
  date: string; // ISO primary date
  states: string[]; // postal codes voting that date (distinct, sorted)
  contestCount: number; // SUM of contests that date (Sen + House COMBINED)
};

// The WHOLE cycle window, past AND future — one row per primary date. Backs the
// Electoral surface's primary-calendar timeline (the cyan VOTED / amber UPCOMING
// bars). NOT forward-filtered: passed dates are required for the VOTED half.
// VOTED-vs-UPCOMING is a render-time `date <= today` comparison in the timeline,
// so this returns raw dates and lets the component color them.
//
// UNCACHED plain db.execute — the primaries surfaces are deliberately untagged
// (no revalidate tag exists, verified live; CLAUDE.md: the primaries helpers use
// plain db.execute so the cron does no revalidateTag), so this matches
// getDashboardPrimaries / getUpcomingPrimaries rather than inventing a tag.
// `election_round = 'primary'` keeps runoff rows out, same as the index helpers.
export async function getPrimaryCalendar(
  cycle = 2026,
): Promise<PrimaryCalendarDate[]> {
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT primary_date AS date,
                 COUNT(*) AS contest_count,
                 GROUP_CONCAT(DISTINCT state) AS states
          FROM primaries
          WHERE election_round = 'primary'
            AND primary_date IS NOT NULL
            AND primary_date >= ? AND primary_date < ?
          GROUP BY primary_date
          ORDER BY primary_date ASC`,
    args: [`${cycle}-01-01`, `${cycle + 1}-01-01`],
  });
  return rs.rows.map((r) => ({
    date: r.date as string,
    contestCount: Number(r.contest_count),
    states: ((r.states as string | null) ?? "")
      .split(",")
      .filter(Boolean)
      .sort(),
  }));
}

// ---- Dashboard primaries rollup (HO 233) --------------------------------

export type PrimaryStripPoint = { date: string; count: number; soon: boolean };
export type DashboardPrimaryCardSeat = { label: string; rated: boolean };
export type DashboardPrimaryCard = {
  date: string;
  states: string[];
  count: number;
  seats: DashboardPrimaryCardSeat[];
  moreSeats: number;
};
export type DashboardPrimariesData = {
  windowStart: string;
  windowEnd: string;
  strip: PrimaryStripPoint[];
  cards: DashboardPrimaryCard[];
};

const DASH_PRIMARY_WINDOW_MONTHS = 6;
const DASH_PRIMARY_CARDS = 4;
const DASH_PRIMARY_SEATS_PER_CARD = 3;

// Derived seat id (state+district), matching the races.id / race_ratings.race_id
// shape — NOT primaries.race_id, which is a dead link (3/907). Used to mark a
// contest as "rated" (its seat carries a race_ratings row) for marquee ranking.
function dashPrimarySeatId(p: PrimaryWithCandidates): string {
  return p.chamber === "senate"
    ? `S-${p.state}-2026`
    : `${p.state}-${p.district ?? "00"}-2026`;
}
function dashPrimarySeatLabel(p: PrimaryWithCandidates): string {
  const base =
    p.chamber === "senate" ? `${p.state} SEN` : `${p.state}-${p.district ?? "00"}`;
  return p.party === "open" ? base : `${base} ${p.party}`;
}

// HO 233: one rollup, two shapes, for the dashboard races panel's PRIMARIES tab.
// Uncached plain db.execute — the primaries surfaces are deliberately uncached
// (no revalidate tag exists to hang this on, verified live), so this matches
// getUpcomingPrimaries et al. rather than inventing a tag. election_round =
// 'primary' keeps runoffs out, same as the index helpers.
export async function getDashboardPrimaries(): Promise<DashboardPrimariesData> {
  const db = getDb();
  const today = new Date();
  const windowStart = today.toISOString().slice(0, 10);
  const endDate = new Date(today);
  endDate.setMonth(endDate.getMonth() + DASH_PRIMARY_WINDOW_MONTHS);
  const windowEnd = endDate.toISOString().slice(0, 10);

  // Windowed upcoming contests — same select shape the HO 226 card uses.
  const rs = await db.execute({
    sql: `${PRIMARY_SELECT}
          WHERE p.primary_date >= ? AND p.primary_date <= ?
            AND p.election_round = 'primary'
          GROUP BY p.id
          ORDER BY p.primary_date ASC, p.state ASC, p.party ASC`,
    args: [windowStart, windowEnd],
  });
  const contests = rs.rows.map((r) => rowToPrimary(r));

  // Rated-seat set for the 2026 cycle (marquee ranking signal).
  const ratedRs = await db.execute(
    "SELECT DISTINCT race_id FROM race_ratings WHERE cycle = 2026",
  );
  const ratedSet = new Set(ratedRs.rows.map((r) => r.race_id as string));

  // Group contests by date (one tick / one card per date).
  const byDate = new Map<string, PrimaryWithCandidates[]>();
  for (const c of contests) {
    if (!c.primary_date) continue;
    const arr = byDate.get(c.primary_date) ?? [];
    arr.push(c);
    byDate.set(c.primary_date, arr);
  }
  const dates = [...byDate.keys()].sort();
  const soonDates = new Set(dates.slice(0, DASH_PRIMARY_CARDS));

  // (a) strip: contest count per date; the soonest DASH_PRIMARY_CARDS dates
  // (= the card dates) are flagged `soon` so the strip's amber ticks line up
  // with the cards below.
  const strip: PrimaryStripPoint[] = dates.map((date) => ({
    date,
    count: byDate.get(date)!.length,
    soon: soonDates.has(date),
  }));

  // (b) cards: the soonest dates, marquee seats rated-first then by field size.
  const cards: DashboardPrimaryCard[] = dates
    .slice(0, DASH_PRIMARY_CARDS)
    .map((date) => {
      const onDate = byDate.get(date)!;
      const states = [...new Set(onDate.map((c) => c.state))].sort();
      const ranked = [...onDate].sort(
        (a, b) =>
          Number(ratedSet.has(dashPrimarySeatId(b))) -
            Number(ratedSet.has(dashPrimarySeatId(a))) ||
          b.candidates.length - a.candidates.length ||
          dashPrimarySeatLabel(a).localeCompare(dashPrimarySeatLabel(b)),
      );
      const seats = ranked
        .slice(0, DASH_PRIMARY_SEATS_PER_CARD)
        .map((c) => ({
          label: dashPrimarySeatLabel(c),
          rated: ratedSet.has(dashPrimarySeatId(c)),
        }));
      return {
        date,
        states,
        count: onDate.length,
        seats,
        moreSeats: onDate.length - seats.length,
      };
    });

  return { windowStart, windowEnd, strip, cards };
}

// ---- Races (handoff 62) -------------------------------------------------

export type Race = {
  id: string;
  cycle: number;
  chamber: "house" | "senate";
  state: string;
  district: number | null;
  rating: string | null;
  rating_source: string | null;
  rating_updated_at: string | null;
  incumbent_bioguide_id: string | null;
  source_url: string | null;
  last_verified: string;
};

export type RaceCandidate = {
  race_id: string;
  name: string;
  party: PartyKey | null;
  bioguide_id: string | null;
  status: string | null;
  source_url: string | null;
};

// Tagged "races" — separate from "bills" because the seed script
// refreshes independently from the daily sync. The /api/revalidate route
// accepts ?tag=races so future cron or webhook integrations can flush.
export const getRace = unstable_cache(
  async (id: string): Promise<Race | null> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT id, cycle, chamber, state, district, rating, rating_source,
              rating_updated_at, incumbent_bioguide_id, source_url, last_verified
            FROM races WHERE id = ? LIMIT 1`,
      args: [id],
    });
    const r = rs.rows[0];
    if (!r) return null;
    const chamber = r.chamber as string;
    if (chamber !== "house" && chamber !== "senate") return null;
    return {
      id: r.id as string,
      cycle: Number(r.cycle),
      chamber,
      state: r.state as string,
      district:
        r.district === null || r.district === undefined
          ? null
          : Number(r.district),
      rating: (r.rating as string | null) ?? null,
      rating_source: (r.rating_source as string | null) ?? null,
      rating_updated_at: (r.rating_updated_at as string | null) ?? null,
      incumbent_bioguide_id:
        (r.incumbent_bioguide_id as string | null) ?? null,
      source_url: (r.source_url as string | null) ?? null,
      last_verified: r.last_verified as string,
    };
  },
  ["getRace"],
  { revalidate: 86400, tags: ["races"] },
);

export const getRaceCandidates = unstable_cache(
  async (raceId: string): Promise<RaceCandidate[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT race_id, name, party, bioguide_id, status, source_url
            FROM race_candidates
            WHERE race_id = ?
            ORDER BY
              CASE
                WHEN status = 'won_primary' THEN 0
                WHEN status = 'running' THEN 1
                WHEN status = 'declared' THEN 2
                WHEN status = 'withdrew' THEN 3
                ELSE 4
              END,
              name ASC`,
      args: [raceId],
    });
    return rs.rows.map((r) => ({
      race_id: r.race_id as string,
      name: r.name as string,
      party: normalizePartyVariant(r.party as string | null),
      bioguide_id: (r.bioguide_id as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      source_url: (r.source_url as string | null) ?? null,
    }));
  },
  ["getRaceCandidates"],
  { revalidate: 86400, tags: ["races"] },
);

// HO 210 Pass 2: all candidates for a cycle in one query so the pinned map card
// can show challenger rosters without an N+1 of getRaceCandidates. Returns a
// FLAT array (not a Map) because unstable_cache JSON-serializes its result and a
// Map would round-trip to {} — the builder groups by race_id. Today only ~4 of
// the 137 rated races carry rows (the hand-seeded strip races); the rest fall
// back to a null-safe placeholder in the card. Same precedence + party
// normalization as getRaceCandidates.
export const getRaceCandidatesForCycle = unstable_cache(
  async (cycle: number): Promise<RaceCandidate[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT rc.race_id, rc.name, rc.party, rc.bioguide_id, rc.status,
                   rc.source_url
            FROM race_candidates rc
            JOIN races r ON r.id = rc.race_id
            WHERE r.cycle = ?
            ORDER BY
              CASE
                WHEN rc.status = 'won_primary' THEN 0
                WHEN rc.status = 'running' THEN 1
                WHEN rc.status = 'declared' THEN 2
                WHEN rc.status = 'withdrew' THEN 3
                ELSE 4
              END,
              rc.name ASC`,
      args: [cycle],
    });
    return rs.rows.map((r) => ({
      race_id: r.race_id as string,
      name: r.name as string,
      party: normalizePartyVariant(r.party as string | null),
      bioguide_id: (r.bioguide_id as string | null) ?? null,
      status: (r.status as string | null) ?? null,
      source_url: (r.source_url as string | null) ?? null,
    }));
  },
  ["getRaceCandidatesForCycle"],
  { revalidate: 86400, tags: ["races"] },
);

// ---- Race ratings (handoff 71) ------------------------------------------

export const RATING_SOURCES = ["cook", "sabato", "inside_elections"] as const;
export type RatingSource = (typeof RATING_SOURCES)[number];
const RATING_SOURCES_SET = new Set<string>(RATING_SOURCES);

export type RaceRating = {
  id: string;
  raceId: string;
  source: RatingSource;
  rating: string;
  ratingScore: number;
  ratingDate: string | null;
  sourceUrl: string | null;
  cycle: number;
  updatedAt: string;
};

function rowToRaceRating(r: Record<string, unknown>): RaceRating | null {
  const source = r.source as string;
  if (!RATING_SOURCES_SET.has(source)) return null;
  return {
    id: r.id as string,
    raceId: r.race_id as string,
    source: source as RatingSource,
    rating: r.rating as string,
    ratingScore: Number(r.rating_score),
    ratingDate: (r.rating_date as string | null) ?? null,
    sourceUrl: (r.source_url as string | null) ?? null,
    cycle: Number(r.cycle),
    updatedAt: r.updated_at as string,
  };
}

// Tagged "race-ratings" — separate from "races" because the rating seed
// refreshes on a different cadence (quarterly, manual) than the race
// surface (per-cycle backfill). Re-seed via /api/revalidate?tag=race-ratings.
export const getRaceRatings = unstable_cache(
  async (raceId: string): Promise<RaceRating[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT id, race_id, source, rating, rating_score, rating_date,
              source_url, cycle, updated_at
            FROM race_ratings
            WHERE race_id = ?
            ORDER BY updated_at DESC`,
      args: [raceId],
    });
    return rs.rows
      .map((row) => rowToRaceRating(row as Record<string, unknown>))
      .filter((x): x is RaceRating => x !== null);
  },
  ["getRaceRatings"],
  { revalidate: 86400, tags: ["race-ratings"] },
);

export type CompetitiveRace = {
  raceId: string;
  ratings: RaceRating[];
  // The most competitive rating across sources for this race. Negative is
  // bluer; 0 is toss-up; positive is redder. ABS is the competitiveness sort
  // key — toss-ups first, then leans, then likely / safe.
  competitivenessScore: number;
  // Joined from races + members. Null when no race row exists yet (rating
  // can land ahead of the race surface) or when the seat is open. The
  // dashboard renders the name column empty in that case rather than crash.
  chamber: "house" | "senate" | null;
  incumbentName: string | null;
  incumbentParty: PartyKey | null;
  incumbentBioguideId: string | null;
};

// Ranks races by the minimum |rating_score| across all sources (so a single
// "Toss Up" rating from any forecaster floats the race to the top). Ties
// break on the most recently updated rating per race so freshly-moved
// races surface ahead of stale ones at the same lean.
// HO 272: latest real rating-MOVE date per race, for the v2 RACES-tab MOVES
// badge. rating_history (HO 220) appends a row only when a (race_id, source)'s
// rating actually changes, BUT the first run logs a baseline row per pair — so a
// "move" is any row whose observed_at is later than that pair's earliest
// observed_at. Returns { raceId: latestMoveDate } only for races that have moved
// at least once (races with no real move are absent → no badge). The client
// compares each against the per-browser "last opened RACES" timestamp
// (localStorage) to count moves-since-last-view. Tagged `races` so a ratings
// refresh flushes it alongside the rest of the races surface.
export const getRecentRaceMoves = unstable_cache(
  async (raceIds: string[]): Promise<Record<string, string>> => {
    if (raceIds.length === 0) return {};
    const db = getDb();
    const placeholders = raceIds.map(() => "?").join(",");
    const rs = await db.execute({
      sql: `SELECT rh.race_id, MAX(rh.observed_at) AS last_move
            FROM rating_history rh
            WHERE rh.race_id IN (${placeholders})
              AND rh.observed_at > (
                SELECT MIN(r2.observed_at) FROM rating_history r2
                WHERE r2.race_id = rh.race_id AND r2.source = rh.source
              )
            GROUP BY rh.race_id`,
      args: raceIds,
    });
    const out: Record<string, string> = {};
    for (const r of rs.rows) {
      out[r.race_id as string] = r.last_move as string;
    }
    return out;
  },
  ["getRecentRaceMoves"],
  { revalidate: 3600, tags: ["races"] },
);

export const getMostCompetitiveRaces = unstable_cache(
  async (cycle: number, limit: number): Promise<CompetitiveRace[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `WITH race_summary AS (
              SELECT race_id,
                     MIN(ABS(rating_score)) AS competitiveness,
                     MAX(updated_at) AS latest_updated_at
              FROM race_ratings
              WHERE cycle = ?
              GROUP BY race_id
            )
            SELECT race_id FROM race_summary
            ORDER BY competitiveness ASC, latest_updated_at DESC
            LIMIT ?`,
      args: [cycle, limit],
    });

    const out: CompetitiveRace[] = [];
    for (const row of rs.rows) {
      const raceId = row.race_id as string;
      // Detail fetch: ratings + incumbent join in two queries. LEFT JOIN
      // because the rating may exist before the race row (race_ratings has
      // no FK), and the race row may exist without an incumbent (open seat).
      const [detail, raceRow] = await Promise.all([
        db.execute({
          sql: `SELECT id, race_id, source, rating, rating_score, rating_date,
                  source_url, cycle, updated_at
                FROM race_ratings
                WHERE race_id = ?
                ORDER BY updated_at DESC`,
          args: [raceId],
        }),
        db.execute({
          sql: `SELECT r.chamber, m.name AS incumbent_name,
                  m.party AS incumbent_party,
                  m.bioguide_id AS incumbent_bioguide_id
                FROM races r
                LEFT JOIN members m
                  ON m.bioguide_id = r.incumbent_bioguide_id
                WHERE r.id = ?
                LIMIT 1`,
          args: [raceId],
        }),
      ]);
      const ratings = detail.rows
        .map((r) => rowToRaceRating(r as Record<string, unknown>))
        .filter((x): x is RaceRating => x !== null);
      const first = ratings[0];
      if (!first) continue;
      const competitivenessScore = ratings.reduce(
        (best, r) =>
          Math.abs(r.ratingScore) < Math.abs(best) ? r.ratingScore : best,
        first.ratingScore,
      );
      const meta = raceRow.rows[0];
      const chamberRaw = (meta?.chamber as string | undefined) ?? null;
      const chamber =
        chamberRaw === "house" || chamberRaw === "senate" ? chamberRaw : null;
      out.push({
        raceId,
        ratings,
        competitivenessScore,
        chamber,
        incumbentName: (meta?.incumbent_name as string | null) ?? null,
        incumbentParty: normalizePartyVariant(
          (meta?.incumbent_party as string | null) ?? null,
        ),
        incumbentBioguideId:
          (meta?.incumbent_bioguide_id as string | null) ?? null,
      });
    }
    return out;
  },
  ["getMostCompetitiveRaces"],
  { revalidate: 86400, tags: ["race-ratings"] },
);

// ---- Races index (handoff 84) -------------------------------------------

export type RaceIndexRow = {
  raceId: string;
  chamber: "house" | "senate";
  state: string;
  district: number | null;
  cycle: number;
  incumbentName: string | null;
  incumbentParty: PartyKey | null;
  incumbentBioguideId: string | null;
  // HO 225: earliest term startYear from members.terms_json (min across terms).
  // Drives the district-modal card's tenure / FIRST ELECTED. null when the
  // incumbent is unmapped or terms_json is missing/unparseable.
  incumbentFirstElected: number | null;
  // HO 221: retirement flag. 0 = incumbent not running (OPEN seat → amber OPEN
  // tag + ○ glyph + cash suppressed); NULL/1 = render as a normal defended
  // incumbent. NULL is NOT open (the honest uncurated default). Hand-seeded
  // from Ballotpedia via races-seed.json; distinct from incumbent_bioguide_id
  // IS NULL (vacancy/unmapped, which can't express a retirement).
  incumbentRunning: number | null;
  // HO 210 Pass 2: incumbent photo for the pinned map card (member-photo
  // pattern; onError → initials). 137/137 rated incumbents have one.
  incumbentDepictionUrl: string | null;
  // HO 212: incumbent cash-on-hand in CENTS, from member_fundraising (FEC,
  // HO 83), joined 1:1 on (bioguide_id, cycle). null when the incumbent has
  // no filing on record (9/137 today); a real filed-but-empty account is 0.
  // Challenger cash is structurally unavailable (table is bioguide-keyed).
  incumbentCashOnHand: number | null;
  // HO 214: 2024 House general margin, SIGNED pct points (R-won positive,
  // D-won negative). House-only — null for Senate (no 2024 general), RCV
  // states (ME/AK), and unresolved pages. Lives on races.margin_2024.
  margin2024: number | null;
  // HO 218: per-seat Kalshi market odds for the card line, LEFT JOIN'd 1:1 from
  // kalshi_odds. null when Kalshi runs no general market for the seat (e.g.
  // S-KY, which has only primary markets) — render nothing, same null-safe
  // absence as cash/margin.
  kalshiOdds: KalshiOdds | null;
  // HO 260: per-seat Polymarket market odds (Senate seats — HO 256 writes 34/35),
  // LEFT JOIN'd 1:1 from polymarket_odds. null when Polymarket runs no live seat
  // market (every House seat — Polymarket only covers Senate — and the one
  // uncovered Senate seat). Drives the v2 rich card's Polymarket diamond + cell.
  polymarketOdds: PolymarketOdds | null;
  // Per-source ratings; null when that rater rated it Solid/Safe (and
  // therefore wasn't seeded) or hasn't rated the seat at all.
  cookRating: string | null;
  sabatoRating: string | null;
  ieRating: string | null;
  // Most competitive rating across sources, with its signed score. Negative
  // is bluer; 0 is toss-up; positive is redder. Drives the sort.
  consensusRating: string | null;
  consensusScore: number | null;
};

// HO 225: earliest term startYear across a member's terms_json (the raw terms
// array stored by sync:members). Returns null on missing/unparseable JSON or no
// numeric startYear — the card degrades (no FIRST ELECTED) rather than fakes.
function firstElectedFromTerms(termsJson: string | null): number | null {
  if (!termsJson) return null;
  try {
    const terms = JSON.parse(termsJson) as Array<{ startYear?: number | string }>;
    if (!Array.isArray(terms)) return null;
    let min: number | null = null;
    for (const t of terms) {
      const y = typeof t.startYear === "string" ? Number(t.startYear) : t.startYear;
      if (typeof y === "number" && Number.isFinite(y) && (min === null || y < min)) {
        min = y;
      }
    }
    return min;
  } catch {
    return null;
  }
}

// Index of every race with at least one rating row. INNER JOIN excludes
// the 432 House stubs from backfill:races that have no ratings yet —
// surfacing them all would be 90% noise on the page. Pivot the three
// sources into columns via MAX(CASE WHEN ...) so each race renders one row.
// Sort: chamber DESC (Senate before House — Senate is the smaller pane and
// reads as the lead), then |consensus_score| ASC so toss-ups float to the
// top of each section, then state/district as tiebreak.
export const getRacesIndex = unstable_cache(
  async (cycle: number): Promise<RaceIndexRow[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT r.id, r.chamber, r.state, r.district, r.cycle,
                   r.incumbent_bioguide_id, r.margin_2024, r.incumbent_running,
                   m.name AS incumbent_name,
                   m.party AS incumbent_party,
                   m.depiction_url AS incumbent_depiction_url,
                   m.terms_json AS incumbent_terms_json,
                   mf.cash_on_hand AS incumbent_cash_on_hand,
                   ko.event_ticker AS ko_event_ticker,
                   ko.implied_pct AS ko_implied_pct,
                   ko.favorite_label AS ko_favorite_label,
                   ko.favorite_is_party AS ko_favorite_is_party,
                   ko.favorite_party AS ko_favorite_party,
                   ko.open_interest AS ko_open_interest,
                   ko.close_time AS ko_close_time,
                   pm.implied_pct AS pm_implied_pct,
                   pm.slug AS pm_slug,
                   pm.favorite_label AS pm_favorite_label,
                   pm.favorite_is_party AS pm_favorite_is_party,
                   pm.favorite_party AS pm_favorite_party,
                   pm.volume AS pm_volume,
                   pm.liquidity AS pm_liquidity,
                   pm.end_date AS pm_end_date,
                   MAX(CASE WHEN rr.source = 'cook' THEN rr.rating END) AS cook_rating,
                   MAX(CASE WHEN rr.source = 'cook' THEN rr.rating_score END) AS cook_score,
                   MAX(CASE WHEN rr.source = 'sabato' THEN rr.rating END) AS sabato_rating,
                   MAX(CASE WHEN rr.source = 'sabato' THEN rr.rating_score END) AS sabato_score,
                   MAX(CASE WHEN rr.source = 'inside_elections' THEN rr.rating END) AS ie_rating,
                   MAX(CASE WHEN rr.source = 'inside_elections' THEN rr.rating_score END) AS ie_score
            FROM races r
            INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
            LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
            LEFT JOIN member_fundraising mf
                   ON mf.bioguide_id = r.incumbent_bioguide_id AND mf.cycle = r.cycle
            LEFT JOIN kalshi_odds ko ON ko.race_id = r.id
            LEFT JOIN polymarket_odds pm ON pm.race_id = r.id
            WHERE r.cycle = ?
            GROUP BY r.id`,
      args: [cycle],
    });

    const out: RaceIndexRow[] = [];
    for (const row of rs.rows) {
      const chamberRaw = row.chamber as string;
      const chamber =
        chamberRaw === "senate" ? "senate" : ("house" as const);

      const cookRating = (row.cook_rating as string | null) ?? null;
      const sabatoRating = (row.sabato_rating as string | null) ?? null;
      const ieRating = (row.ie_rating as string | null) ?? null;
      const cookScore = row.cook_score as number | null;
      const sabatoScore = row.sabato_score as number | null;
      const ieScore = row.ie_score as number | null;

      // Pick the most competitive (smallest |score|) rating across sources
      // as the "consensus" for sort + display. Tie-break: prefer Cook
      // (most established forecaster) when |score| matches.
      const candidates: Array<{ rating: string; score: number }> = [];
      if (cookRating !== null && cookScore !== null)
        candidates.push({ rating: cookRating, score: cookScore });
      if (sabatoRating !== null && sabatoScore !== null)
        candidates.push({ rating: sabatoRating, score: sabatoScore });
      if (ieRating !== null && ieScore !== null)
        candidates.push({ rating: ieRating, score: ieScore });
      let consensusRating: string | null = null;
      let consensusScore: number | null = null;
      if (candidates.length > 0) {
        const winner = candidates.reduce((best, c) =>
          Math.abs(c.score) < Math.abs(best.score) ? c : best,
        );
        consensusRating = winner.rating;
        consensusScore = winner.score;
      }

      out.push({
        raceId: row.id as string,
        chamber,
        state: row.state as string,
        district: (row.district as number | null) ?? null,
        cycle: Number(row.cycle),
        incumbentName: (row.incumbent_name as string | null) ?? null,
        incumbentParty: normalizePartyVariant(
          (row.incumbent_party as string | null) ?? null,
        ),
        incumbentBioguideId:
          (row.incumbent_bioguide_id as string | null) ?? null,
        incumbentFirstElected: firstElectedFromTerms(
          row.incumbent_terms_json as string | null,
        ),
        incumbentRunning:
          row.incumbent_running == null ? null : Number(row.incumbent_running),
        incumbentDepictionUrl:
          (row.incumbent_depiction_url as string | null) ?? null,
        incumbentCashOnHand:
          row.incumbent_cash_on_hand == null
            ? null
            : Number(row.incumbent_cash_on_hand),
        margin2024:
          row.margin_2024 == null ? null : Number(row.margin_2024),
        kalshiOdds:
          row.ko_implied_pct == null
            ? null
            : {
                raceId: row.id as string,
                eventTicker: (row.ko_event_ticker as string | null) ?? "",
                impliedPct: Number(row.ko_implied_pct),
                favoriteLabel: (row.ko_favorite_label as string | null) ?? "",
                favoriteIsParty: Number(row.ko_favorite_is_party) === 1,
                favoriteParty:
                  (row.ko_favorite_party as "D" | "R" | "I" | null) ?? null,
                openInterest:
                  row.ko_open_interest == null
                    ? null
                    : Number(row.ko_open_interest),
                closeTime: (row.ko_close_time as string | null) ?? null,
              },
        polymarketOdds:
          row.pm_implied_pct == null
            ? null
            : {
                raceId: row.id as string,
                slug: (row.pm_slug as string | null) ?? "",
                impliedPct: Number(row.pm_implied_pct),
                favoriteLabel: (row.pm_favorite_label as string | null) ?? "",
                favoriteIsParty: Number(row.pm_favorite_is_party) === 1,
                favoriteParty:
                  (row.pm_favorite_party as "D" | "R" | "I" | null) ?? null,
                volume: row.pm_volume == null ? null : Number(row.pm_volume),
                liquidity:
                  row.pm_liquidity == null ? null : Number(row.pm_liquidity),
                endDate: (row.pm_end_date as string | null) ?? null,
              },
        cookRating,
        sabatoRating,
        ieRating,
        consensusRating,
        consensusScore,
      });
    }

    // In-JS sort because rating-score columns come from a CASE inside the
    // same GROUP BY and the engine treats them as nullable. Sorting in JS
    // is also where the chamber-first ordering lives.
    out.sort((a, b) => {
      if (a.chamber !== b.chamber) {
        return a.chamber === "senate" ? -1 : 1;
      }
      const aAbs = a.consensusScore === null ? 99 : Math.abs(a.consensusScore);
      const bAbs = b.consensusScore === null ? 99 : Math.abs(b.consensusScore);
      if (aAbs !== bAbs) return aAbs - bAbs;
      if (a.state !== b.state) return a.state.localeCompare(b.state);
      const ad = a.district ?? 0;
      const bd = b.district ?? 0;
      return ad - bd;
    });

    return out;
  },
  ["getRacesIndex"],
  { revalidate: 3600, tags: ["race-ratings", "races"] },
);

// ---- Battlefield axis (HO 254) ------------------------------------------

export type BattlefieldSeat = {
  raceId: string;
  chamber: "house" | "senate";
  // Compact seat label for the axis marker / band popover: "PA-SEN" / "NC-13".
  label: string;
  // Rater-consensus lean on the [-3, +3] fine scale (D negative, R positive),
  // averaged across the sources present. Drives the marker's x position.
  consensus: number;
  // Marker fill. From races.incumbent_bioguide_id → members.party (the per-seat
  // incumbent), so on an OPEN seat this is the party that held it going in —
  // exactly the handoff's "party that held the seat going in"; null = neutral.
  incumbentParty: PartyKey | null;
  // HO 221 retirement flag surfaced for the marker's open treatment.
  isOpen: boolean;
};

// Bucket string → signed fine-scale numeric (D negative / R positive). Read
// from the LIVE rating string, NOT race_ratings.rating_score: the stored score
// flattens IE's Tilt to ±1, but the battlefield wants Tilt at ±0.5 (it sits
// between Toss-up and Lean). Mapping (verified against the live vocab, HO 254):
//   Toss Up → 0 · Tilt D/R → ∓0.5 · Lean D/R → ∓1 · Likely D/R → ∓2 ·
//   Solid D/R (Cook, IE) / Safe D/R (Sabato) → ∓3.
function battlefieldScale(rating: string): number | null {
  if (rating === "Toss Up") return 0;
  const dir = rating.endsWith(" D") ? -1 : rating.endsWith(" R") ? 1 : null;
  if (dir === null) return null;
  if (rating.startsWith("Tilt")) return dir * 0.5;
  if (rating.startsWith("Lean")) return dir * 1;
  if (rating.startsWith("Likely")) return dir * 2;
  if (rating.startsWith("Solid") || rating.startsWith("Safe")) return dir * 3;
  return null;
}

// Compact axis label from a deterministic race id: S-PA-2026 → "PA-SEN",
// PA-13-2026 → "PA-13". Falls back to the raw id for any other shape.
function battlefieldLabel(raceId: string): string {
  if (raceId.startsWith("S-")) {
    const state = raceId.split("-")[1];
    return state ? `${state}-SEN` : raceId;
  }
  const m = raceId.match(/^([A-Z]{2})-(\d{2})-\d{4}$/);
  if (m) return `${m[1]}-${m[2]}`;
  return raceId;
}

// HO 254: every seat with ≥1 rating, mapped to a consensus lean for the D↔R
// battlefield axis. Additive — does NOT touch getMostCompetitiveRaces or
// getRacesIndex. Same INNER JOIN universe as getRacesIndex (rated seats only,
// 137-ish), but returns the AVERAGED fine-scale consensus rather than the
// pick-most-competitive score. Seats whose ratings don't map (none today) drop.
export const getBattlefieldSeats = unstable_cache(
  async (cycle: number): Promise<BattlefieldSeat[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT r.id, r.chamber, r.incumbent_running,
                   m.party AS incumbent_party,
                   MAX(CASE WHEN rr.source = 'cook' THEN rr.rating END) AS cook_rating,
                   MAX(CASE WHEN rr.source = 'sabato' THEN rr.rating END) AS sabato_rating,
                   MAX(CASE WHEN rr.source = 'inside_elections' THEN rr.rating END) AS ie_rating
            FROM races r
            INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
            LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
            WHERE r.cycle = ?
            GROUP BY r.id`,
      args: [cycle],
    });

    const out: BattlefieldSeat[] = [];
    for (const row of rs.rows) {
      const mapped = [row.cook_rating, row.sabato_rating, row.ie_rating]
        .filter((x): x is string => typeof x === "string")
        .map(battlefieldScale)
        .filter((x): x is number => x !== null);
      if (mapped.length === 0) continue; // unmappable ratings → drop the seat
      const consensus = mapped.reduce((a, b) => a + b, 0) / mapped.length;
      const chamberRaw = row.chamber as string;
      const raceId = row.id as string;
      out.push({
        raceId,
        chamber: chamberRaw === "senate" ? "senate" : "house",
        label: battlefieldLabel(raceId),
        consensus,
        incumbentParty: normalizePartyVariant(
          (row.incumbent_party as string | null) ?? null,
        ),
        // HO 221 rule: NULL is NOT open (the honest uncurated default) — only an
        // explicit 0 lights it. Number(null) === 0 would wrongly flag every
        // uncurated seat, so guard the null first.
        isOpen: row.incumbent_running != null && Number(row.incumbent_running) === 0,
      });
    }
    return out;
  },
  ["getBattlefieldSeats"],
  { revalidate: 3600, tags: ["race-ratings", "races"] },
);

// HO 219: Kalshi chamber-control (House/Senate balance of power) for the /races
// hero band. Reads the single dashboard_state JSON blob the Kalshi cron writes;
// null (or a null chamber) when no blob exists yet → the band cell degrades.
// Tag "races" so the cron's revalidateTag("races") flushes it.
export const getChamberControl = unstable_cache(
  async (): Promise<ChamberControl | null> => {
    const db = getDb();
    const rs = await db.execute({
      sql: "SELECT value FROM dashboard_state WHERE key = 'kalshi_chamber_control' LIMIT 1",
      args: [],
    });
    const raw = rs.rows[0]?.value as string | undefined;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ChamberControl;
    } catch {
      return null;
    }
  },
  ["getChamberControl"],
  { revalidate: 3600, tags: ["races"] },
);

export const getReport = unstable_cache(
  async (slug: string): Promise<Report | null> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT slug, title, week_start, week_end, content_md, created_at
            FROM reports WHERE slug = ? LIMIT 1`,
      args: [slug],
    });
    const r = rs.rows[0];
    if (!r) return null;
    return {
      slug: r.slug as string,
      title: r.title as string,
      weekStart: r.week_start as string,
      weekEnd: r.week_end as string,
      contentMd: r.content_md as string,
      createdAt: r.created_at as string,
    };
  },
  ["report"],
  { revalidate: 3600, tags: ["reports"] },
);

// ---- Stock trades (handoff 70) ------------------------------------------

export type StockTrade = {
  id: string;
  bioguideId: string | null;
  memberNameRaw: string;
  chamber: "senate" | "house";
  ticker: string | null;
  assetDescription: string | null;
  transactionType: string | null;
  transactionDate: string | null;
  disclosureDate: string;
  amount: string | null;
  owner: string | null;
};

function rowToStockTrade(r: Record<string, unknown>): StockTrade {
  const chamber = r.chamber as string;
  return {
    id: r.id as string,
    bioguideId: (r.bioguide_id as string | null) ?? null,
    memberNameRaw: r.member_name_raw as string,
    chamber: chamber === "senate" || chamber === "house" ? chamber : "house",
    ticker: (r.ticker as string | null) ?? null,
    assetDescription: (r.asset_description as string | null) ?? null,
    transactionType: (r.transaction_type as string | null) ?? null,
    transactionDate: (r.transaction_date as string | null) ?? null,
    disclosureDate: (r.disclosure_date as string | null) ?? "",
    amount: (r.amount as string | null) ?? null,
    owner: (r.owner as string | null) ?? null,
  };
}

// Tagged `member-trades` separately from `bills` and `members` — trade data
// refreshes on its own cron step and we want a tight invalidation surface
// so unrelated bills writes don't bust the trade cache. 1-hour backstop
// since FMP data shifts daily at most.
export const getMemberTrades = unstable_cache(
  async (bioguideId: string, limit = 20): Promise<StockTrade[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT id, bioguide_id, member_name_raw, chamber, ticker,
              asset_description, transaction_type, transaction_date,
              disclosure_date, amount, owner
            FROM stock_trades
            WHERE bioguide_id = ?
            ORDER BY disclosure_date DESC, transaction_date DESC, id DESC
            LIMIT ?`,
      args: [bioguideId, limit],
    });
    return rs.rows.map(rowToStockTrade);
  },
  ["getMemberTrades"],
  { revalidate: 3600, tags: ["member-trades"] },
);

export const getMemberTradeCount = unstable_cache(
  async (bioguideId: string): Promise<number> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM stock_trades WHERE bioguide_id = ?`,
      args: [bioguideId],
    });
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["getMemberTradeCount"],
  { revalidate: 3600, tags: ["member-trades"] },
);

// ---- FEC fundraising (handoff 83) ---------------------------------------

export type MemberFundraising = {
  cycle: number;
  totalRaised: number | null; // cents
  totalSpent: number | null;
  cashOnHand: number | null;
  debts: number | null;
  coverageEndDate: string | null;
  sourceUrl: string | null;
  ingestedAt: string;
};

// Single most-recent cycle's fundraising row for a member. Returns null
// when the member has never resolved to an FEC candidate or didn't file
// for the cycle — the hub treats absent rows as "no fundraising shown,"
// not as an error. Tag is its own scope so the (manual) `sync:fec` cron
// flushes the member-hub line without churning `members`.
export const getMemberFundraising = unstable_cache(
  async (bioguideId: string): Promise<MemberFundraising | null> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT cycle, total_raised, total_spent, cash_on_hand, debts,
                   coverage_end_date, source_url, ingested_at
            FROM member_fundraising
            WHERE bioguide_id = ?
            ORDER BY cycle DESC
            LIMIT 1`,
      args: [bioguideId],
    });
    const row = rs.rows[0];
    if (!row) return null;
    return {
      cycle: Number(row.cycle),
      totalRaised: (row.total_raised as number | null) ?? null,
      totalSpent: (row.total_spent as number | null) ?? null,
      cashOnHand: (row.cash_on_hand as number | null) ?? null,
      debts: (row.debts as number | null) ?? null,
      coverageEndDate: (row.coverage_end_date as string | null) ?? null,
      sourceUrl: (row.source_url as string | null) ?? null,
      ingestedAt: row.ingested_at as string,
    };
  },
  ["getMemberFundraising"],
  { revalidate: 86400, tags: ["member-fundraising"] },
);

// ---- Breaking news (handoff 69) -----------------------------------------

export type NewsMention = {
  id: number;
  billId: string;
  billTitle: string;
  billSponsorName: string | null;
  billSponsorParty: string | null;
  source: string;
  title: string;
  url: string;
  publishedAt: string;
  // Companion bill IDs matched to the same article (HO 118). Populated by
  // getBreakingNewsForHome where rows are deduped by article so a single
  // headline matched to multiple bills shows once with a [+N] pill. Empty
  // for getNewsForBill / searchNews, which keep the one-row-per-mention shape.
  otherBills: string[];
  // HO 241: true when the row meets the "breaking" predicate (confidence
  // >= NEWS_FEED_MIN_CONFIDENCE AND within BREAKING_WINDOW_HOURS). Only
  // getNewsFeed populates it; other NewsMention producers leave it
  // undefined, so the NEWS SIGNAL rail+pill render only on the NEWS feed.
  isBreaking?: boolean;
};

// HO 335: getBreakingNews deleted as dead code — no callers (the live home block
// is getBreakingNewsForHome; the /news route is getNewsFeed). Same call HO 331
// made on the dead `OR sponsor_name` branch: remove, don't optimize.

// HO 130 /news?bill=<id> filter. Returns all mentions for a single bill,
// ignoring the trailing-hours window since the user has explicitly opted
// into a specific bill via the media-attention chip on a feed row. Same
// ceremonial gate as getBreakingNews so we don't surface mentions for a
// bill that's hidden everywhere else.
export const getNewsForBill = unstable_cache(
  async (billId: string, limit = 50): Promise<NewsMention[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT m.id, m.bill_id, m.source, m.article_title, m.article_url,
              m.published_at,
              b.title AS bill_title,
              b.sponsor_name AS bill_sponsor_name,
              b.sponsor_party AS bill_sponsor_party
            FROM news_mentions m
            INNER JOIN bills b ON b.id = m.bill_id
            WHERE m.bill_id = ?
              AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
            ORDER BY m.published_at DESC, m.id DESC
            LIMIT ?`,
      args: [billId, limit],
    });
    return rs.rows.map((r) => ({
      id: Number(r.id),
      billId: r.bill_id as string,
      billTitle: r.bill_title as string,
      billSponsorName: (r.bill_sponsor_name as string | null) ?? null,
      billSponsorParty: (r.bill_sponsor_party as string | null) ?? null,
      source: r.source as string,
      title: r.article_title as string,
      url: r.article_url as string,
      publishedAt: r.published_at as string,
      otherBills: [],
    }));
  },
  ["getNewsForBill"],
  { revalidate: 600, tags: ["news-breaking"] },
);

// Backs the home-page BreakingNewsBlock (handoff 114, flipped HO 118).
// Distinct from getBreakingNews on four axes:
//   - wider window (72h default — 24h is structurally too sparse on this
//     corpus, see HO 114 Phase 1 diagnostic)
//   - a confidence floor (the home block is the premium surface, so only
//     high-confidence LLM matches earn a slot; 0.7 also drops NULL-confidence
//     rows via SQL three-valued logic, and matches the weekly report's bar)
//   - dedup by article, not by bill_id: one article matched to N bills
//     surfaces once with the highest-confidence bill as primary and the
//     others returned in `otherBills` for a [+N] pill (HO 118). Tie-break
//     is alphabetical bill_id — arbitrary but stable; companion-resolution
//     articles like the Wicker/Iran example land on the alphabetically
//     first id (HCONRES 95 over HJRES 176 over SJRES 184)
//   - INNER JOIN on bills lets the row render bill id + title + sponsor
//     without a second query, with ceremonial bills excluded
//
// Shares the `news-breaking` cache tag with getBreakingNews so the existing
// revalidateTag("news-breaking") in /api/cron/news flushes both.
//
// article_key prefers article_url and falls back to a (title|source|
// published_at) composite for the rare row where url is NULL; HO 118
// pre-flight showed url at 100% on the live 72h window, so the fallback
// is defensive rather than load-bearing.
export const getBreakingNewsForHome = unstable_cache(
  async ({
    limit = 3,
    hours = 72,
    minConfidence = 0.7,
    filters,
  }: {
    limit?: number;
    hours?: number;
    minConfidence?: number;
    /** Dashboard click-to-filter state. Stage matches `bills.stage = ?`;
     * topic narrows via `json_each` EXISTS. Each filter combination gets
     * its own cache slot (args are part of unstable_cache's key). */
    filters?: DashboardFilters;
  } = {}): Promise<NewsMention[]> => {
    const db = getDb();
    const stage = filters?.stage;
    const topic = filters?.topic;
    const stageClause = stage ? " AND b.stage = ?" : "";
    const topicClause = topic
      ? " AND EXISTS (SELECT 1 FROM json_each(b.topics) WHERE value = ?)"
      : "";
    const filterArgs: (string | number)[] = [];
    if (stage) filterArgs.push(stage);
    if (topic) filterArgs.push(topic);
    const rs = await db.execute({
      sql: `WITH ranked AS (
              SELECT
                m.id,
                m.bill_id,
                m.source,
                m.published_at,
                m.article_url,
                m.article_title,
                m.match_confidence,
                b.title         AS bill_title,
                b.sponsor_name  AS bill_sponsor_name,
                b.sponsor_party AS bill_sponsor_party,
                COALESCE(
                  m.article_url,
                  m.article_title || '|' || m.source || '|' || m.published_at
                ) AS article_key,
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(
                    m.article_url,
                    m.article_title || '|' || m.source || '|' || m.published_at
                  )
                  ORDER BY m.match_confidence DESC, m.bill_id ASC
                ) AS rn
              FROM news_mentions m INDEXED BY idx_news_mentions_published
              -- HO 241: forced — drive from the ~200-row news table (always constrained on published_at), not a ~16k bills scan (Turso blocks ANALYZE).
              INNER JOIN bills b ON b.id = m.bill_id
              WHERE m.published_at >= datetime('now', '-' || ? || ' hours')
                AND m.match_confidence >= ?
                AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)${stageClause}${topicClause}
            ),
            others AS (
              SELECT
                article_key,
                json_group_array(bill_id) AS other_bill_ids
              FROM ranked
              WHERE rn > 1
              GROUP BY article_key
            )
            SELECT
              pm.id,
              pm.bill_id,
              pm.bill_title,
              pm.bill_sponsor_name,
              pm.bill_sponsor_party,
              pm.source,
              pm.article_title,
              pm.article_url,
              pm.published_at,
              COALESCE(o.other_bill_ids, '[]') AS other_bill_ids
            FROM ranked pm
            LEFT JOIN others o ON o.article_key = pm.article_key
            WHERE pm.rn = 1
            ORDER BY pm.published_at DESC, pm.id DESC
            LIMIT ?`,
      args: [hours, minConfidence, ...filterArgs, limit],
    });
    return rs.rows.map((r) => {
      const otherBillsRaw = r.other_bill_ids as string;
      let otherBills: string[] = [];
      try {
        const parsed = JSON.parse(otherBillsRaw);
        if (Array.isArray(parsed)) {
          otherBills = parsed.filter((x): x is string => typeof x === "string");
        }
      } catch {
        otherBills = [];
      }
      return {
        id: Number(r.id),
        billId: r.bill_id as string,
        billTitle: r.bill_title as string,
        billSponsorName: (r.bill_sponsor_name as string | null) ?? null,
        billSponsorParty: (r.bill_sponsor_party as string | null) ?? null,
        source: r.source as string,
        title: r.article_title as string,
        url: r.article_url as string,
        publishedAt: r.published_at as string,
        otherBills,
      };
    });
  },
  ["getBreakingNewsForHome"],
  { revalidate: 600, tags: ["news-breaking"] },
);

// HO 133: deduped count of breaking-news articles inside the home-block
// window + confidence floor. Drives the `[ + N MORE → ]` expander chrome
// under the BREAKING tab (N = total - cap). Mirrors getBreakingNewsForHome's
// dedup-by-article-key so the count matches the same article universe the
// rows visualize.
export const getBreakingNewsForHomeCount = unstable_cache(
  async ({
    hours = 72,
    minConfidence = 0.7,
    filters,
  }: {
    hours?: number;
    minConfidence?: number;
    /** Dashboard click-to-filter state. Must match getBreakingNewsForHome's
     * filter shape exactly so the count and the rows refer to the same
     * article universe. */
    filters?: DashboardFilters;
  } = {}): Promise<number> => {
    const db = getDb();
    const stage = filters?.stage;
    const topic = filters?.topic;
    const stageClause = stage ? " AND b.stage = ?" : "";
    const topicClause = topic
      ? " AND EXISTS (SELECT 1 FROM json_each(b.topics) WHERE value = ?)"
      : "";
    const filterArgs: (string | number)[] = [];
    if (stage) filterArgs.push(stage);
    if (topic) filterArgs.push(topic);
    const rs = await db.execute({
      sql: `SELECT COUNT(DISTINCT COALESCE(
              m.article_url,
              m.article_title || '|' || m.source || '|' || m.published_at
            )) AS n
            FROM news_mentions m INDEXED BY idx_news_mentions_published
            -- HO 241: forced — drive from the ~200-row news table (always constrained on published_at), not a ~16k bills scan (Turso blocks ANALYZE).
            INNER JOIN bills b ON b.id = m.bill_id
            WHERE m.published_at >= datetime('now', '-' || ? || ' hours')
              AND m.match_confidence >= ?
              AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)${stageClause}${topicClause}`,
      args: [hours, minConfidence, ...filterArgs],
    });
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["getBreakingNewsForHomeCount"],
  { revalidate: 600, tags: ["news-breaking"] },
);

// ---- HO 151 NEWS-mode feed -------------------------------------------- //
// The /bills?mode=news view's data layer. Modeled on getBreakingNewsForHome
// (same dedup-by-article-key + confidence floor + ceremonial gate), with
// SOURCE / WINDOW / per-bill filters plus pagination so the same article
// universe the dashboard BREAKING block shows can be browsed in full.

export const NEWS_WINDOW_HOURS = [24, 72, 168, 720] as const;
export type NewsWindowHours = (typeof NEWS_WINDOW_HOURS)[number];
const NEWS_WINDOW_HOURS_SET = new Set<number>(NEWS_WINDOW_HOURS);
export const NEWS_DEFAULT_WINDOW: NewsWindowHours = 72;
export const NEWS_FEED_PAGE_SIZE = 50;
const NEWS_FEED_MIN_CONFIDENCE = 0.7;

// HO 241 — the NEWS SIGNAL (ALL · BREAKING) filter. "Breaking" is a FIXED
// 72h ceiling, deliberately equal to NEWS_DEFAULT_WINDOW so the word means
// the same thing here as in the dashboard BREAKING block (BreakingNewsBlock,
// getBreakingNews*). It is NOT the spec's 48h and NOT driven by the WINDOW
// chip — the WINDOW chip still ANDs in, so the effective breaking window is
// min(WINDOW, 72h) with confidence >= NEWS_FEED_MIN_CONFIDENCE always.
const BREAKING_WINDOW_HOURS = NEWS_DEFAULT_WINDOW;
// One predicate, reused three ways: the per-row is_breaking flag (so ALL
// view marks qualifying rows), the signal=breaking filter, and the BREAKING
// chip count. Both operands are trusted numeric module constants, so string
// interpolation here is injection-safe and literally reuses the constants
// (no fresh 0.7 / 72 literals, no extra bound params to order).
const BREAKING_PREDICATE_SQL = `m.match_confidence >= ${NEWS_FEED_MIN_CONFIDENCE} AND m.published_at >= datetime('now', '-${BREAKING_WINDOW_HOURS} hours')`;

export type NewsSignal = "breaking";

export function sanitizeNewsSignal(
  raw: string | null | undefined,
): NewsSignal | undefined {
  return raw === "breaking" ? "breaking" : undefined;
}

const NEWS_SOURCE_SLUGS: ReadonlySet<string> = new Set([
  "politico",
  "the_hill",
  "roll_call",
]);

export function sanitizeNewsSource(
  raw: string | null | undefined,
): string | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const lower = raw.trim().toLowerCase();
  return NEWS_SOURCE_SLUGS.has(lower) ? lower : undefined;
}

export function sanitizeWindowHours(
  raw: string | null | undefined,
): NewsWindowHours | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return undefined;
  return NEWS_WINDOW_HOURS_SET.has(n) ? (n as NewsWindowHours) : undefined;
}

export type NewsFeedFilters = {
  source?: string;
  topic?: string;
  windowHours?: NewsWindowHours;
  billId?: string;
  signal?: NewsSignal;
};

function buildNewsFeedWhere(filters: NewsFeedFilters): {
  whereExtra: string;
  args: (string | number)[];
} {
  const parts: string[] = [];
  const args: (string | number)[] = [];
  if (filters.source) {
    parts.push("AND m.source = ?");
    args.push(filters.source);
  }
  if (filters.topic) {
    parts.push(
      "AND EXISTS (SELECT 1 FROM json_each(b.topics) WHERE value = ?)",
    );
    args.push(filters.topic);
  }
  if (filters.billId) {
    // Bill-scoped NEWS view bypasses the global confidence floor and the
    // window so a per-bill chip click still shows every mention the bill
    // ever got — same intent as HO 130's /news?bill=<id> shortcut.
    parts.push("AND m.bill_id = ?");
    args.push(filters.billId);
  }
  return { whereExtra: parts.join(" "), args };
}

export type NewsFeedPage = {
  mentions: NewsMention[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  // HO 241 — size of the breaking set within the current SOURCE/WINDOW/TOPIC
  // scope (independent of whether signal=breaking is active), for the
  // BREAKING chip count.
  breakingCount: number;
};

export const getNewsFeed = unstable_cache(
  async (
    filters: NewsFeedFilters,
    {
      page = 1,
      pageSize = NEWS_FEED_PAGE_SIZE,
    }: { page?: number; pageSize?: number } = {},
  ): Promise<NewsFeedPage> => {
    const db = getDb();
    const windowHours = filters.windowHours ?? NEWS_DEFAULT_WINDOW;
    const isBillScoped = !!filters.billId;
    const { whereExtra, args: filterArgs } = buildNewsFeedWhere(filters);

    // HO 241 — when signal=breaking, AND the fixed-72h breaking predicate
    // onto the feed. It stacks with WINDOW (→ min(WINDOW, 72h)) and with
    // SOURCE/TOPIC/bill. No bound params: BREAKING_PREDICATE_SQL inlines the
    // trusted numeric constants.
    const signalClause =
      filters.signal === "breaking" ? ` AND ${BREAKING_PREDICATE_SQL}` : "";

    // When the view is scoped to a single bill, drop the window + confidence
    // gates so a bill's full mention history is reachable (same as HO 130
    // /news?bill=). The base where clause keeps the ceremonial gate either
    // way — ceremonial bills are hidden everywhere else, no reason to
    // surface their news in NEWS mode.
    const baseWhere = isBillScoped
      ? "(b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)"
      : `m.published_at >= datetime('now', '-' || ? || ' hours')
         AND m.match_confidence >= ?
         AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)`;
    const baseArgs: (string | number)[] = isBillScoped
      ? []
      : [windowHours, NEWS_FEED_MIN_CONFIDENCE];

    // HO 335: drive from the 227-row news_mentions side, not the 16k bills side.
    // The windowed (non-bill-scoped) form filters on m.published_at, so force
    // idx_news_mentions_published — the same hint getBreakingNewsForHome carries;
    // without it the stateless planner drives from bills via idx_bills_is_ceremonial
    // (MULTI-INDEX OR over ~every non-ceremonial row, the HO 332 cold-abort class).
    // The bill-scoped form has m.bill_id = ? (selective) and keeps the natural
    // idx_news_mentions_bill point lookup, so it takes NO hint.
    const mHint = isBillScoped ? "" : " INDEXED BY idx_news_mentions_published";

    // Count uses the same dedup-by-article-key shape so the page-count
    // matches the visible rows when an article gets matched to several
    // bills (HO 133's distinct-article counting convention).
    const distinctArticleExpr = `COUNT(DISTINCT COALESCE(
        m.article_url,
        m.article_title || '|' || m.source || '|' || m.published_at
      ))`;
    const countSql = `SELECT ${distinctArticleExpr} AS n
      FROM news_mentions m${mHint}
      INNER JOIN bills b ON b.id = m.bill_id
      WHERE ${baseWhere} ${whereExtra}${signalClause}`;
    // BREAKING chip count: same SOURCE/WINDOW/TOPIC/bill scope, but the
    // breaking predicate is ALWAYS applied (and signalClause is NOT) so the
    // count is stable whether or not BREAKING is the active signal.
    const breakingCountSql = `SELECT ${distinctArticleExpr} AS n
      FROM news_mentions m${mHint}
      INNER JOIN bills b ON b.id = m.bill_id
      WHERE ${baseWhere} ${whereExtra} AND ${BREAKING_PREDICATE_SQL}`;
    const [countRs, breakingCountRs] = await Promise.all([
      db.execute({ sql: countSql, args: [...baseArgs, ...filterArgs] }),
      db.execute({ sql: breakingCountSql, args: [...baseArgs, ...filterArgs] }),
    ]);
    const total = Number(countRs.rows[0]?.n ?? 0);
    const breakingCount = Number(breakingCountRs.rows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const clampedPage = Math.min(Math.max(1, Math.trunc(page)), totalPages);
    const offset = (clampedPage - 1) * pageSize;

    const rowSql = `WITH ranked AS (
        SELECT
          m.id,
          m.bill_id,
          m.source,
          m.published_at,
          m.article_url,
          m.article_title,
          m.match_confidence,
          CASE WHEN ${BREAKING_PREDICATE_SQL} THEN 1 ELSE 0 END AS is_breaking,
          b.title         AS bill_title,
          b.sponsor_name  AS bill_sponsor_name,
          b.sponsor_party AS bill_sponsor_party,
          COALESCE(
            m.article_url,
            m.article_title || '|' || m.source || '|' || m.published_at
          ) AS article_key,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(
              m.article_url,
              m.article_title || '|' || m.source || '|' || m.published_at
            )
            ORDER BY m.match_confidence DESC, m.bill_id ASC
          ) AS rn
        FROM news_mentions m${mHint}
        INNER JOIN bills b ON b.id = m.bill_id
        WHERE ${baseWhere} ${whereExtra}${signalClause}
      ),
      others AS (
        SELECT
          article_key,
          json_group_array(bill_id) AS other_bill_ids
        FROM ranked
        WHERE rn > 1
        GROUP BY article_key
      )
      SELECT
        pm.id,
        pm.bill_id,
        pm.bill_title,
        pm.bill_sponsor_name,
        pm.bill_sponsor_party,
        pm.source,
        pm.article_title,
        pm.article_url,
        pm.published_at,
        pm.is_breaking,
        COALESCE(o.other_bill_ids, '[]') AS other_bill_ids
      FROM ranked pm
      LEFT JOIN others o ON o.article_key = pm.article_key
      WHERE pm.rn = 1
      ORDER BY pm.published_at DESC, pm.id DESC
      LIMIT ? OFFSET ?`;
    const rs = await db.execute({
      sql: rowSql,
      args: [...baseArgs, ...filterArgs, pageSize, offset],
    });

    const mentions: NewsMention[] = rs.rows.map((r) => {
      const otherBillsRaw = r.other_bill_ids as string;
      let otherBills: string[] = [];
      try {
        const parsed = JSON.parse(otherBillsRaw);
        if (Array.isArray(parsed)) {
          otherBills = parsed.filter((x): x is string => typeof x === "string");
        }
      } catch {
        otherBills = [];
      }
      return {
        id: Number(r.id),
        billId: r.bill_id as string,
        billTitle: r.bill_title as string,
        billSponsorName: (r.bill_sponsor_name as string | null) ?? null,
        billSponsorParty: (r.bill_sponsor_party as string | null) ?? null,
        source: r.source as string,
        title: r.article_title as string,
        url: r.article_url as string,
        publishedAt: r.published_at as string,
        otherBills,
        isBreaking: Number(r.is_breaking) === 1,
      };
    });

    return {
      mentions,
      total,
      page: clampedPage,
      pageSize,
      totalPages,
      breakingCount,
    };
  },
  ["getNewsFeed"],
  { revalidate: 600, tags: ["news-breaking"] },
);

// ---- News matcher candidate pool (handoff 86) ---------------------------

export type CandidateBill = {
  id: string;
  title: string;
  summary: string | null;
};

// Bills in active play, fed to the LLM matcher in `lib/news-matcher.ts`.
// Pre-filter is keyword overlap (article words ∩ bill-title words), so the
// pool can be larger than the per-article cap without paying LLM cost on
// every bill. Cap defends against a runaway query on weeks with huge
// floor activity. Not cached: the matcher runs once per cron tick, the
// query is cheap, and cycling daily-changing rows through unstable_cache
// would just churn the cache without benefit.
export async function getCandidateBills(
  daysBack = 30,
  limit = 500,
): Promise<CandidateBill[]> {
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT id, title, summary
          FROM bills
          WHERE latest_action_date >= date('now', ?)
            AND summary IS NOT NULL
            AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
          ORDER BY latest_action_date DESC
          LIMIT ?`,
    args: [`-${daysBack} days`, limit],
  });
  return rs.rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    summary: (r.summary as string | null) ?? null,
  }));
}

// HO 187: 100 → 25 (~4 pages of the substantive corpus) — endless-scroll-ish
// 100 was too long, 15 too choppy given the real starting point. Bills-scoped
// (BILLS mode only; NEWS uses NEWS_FEED_PAGE_SIZE).
export const FEED_PAGE_SIZE = 25;

export type FeedPage = {
  bills: FeedBill[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// Wrapped in unstable_cache because revalidate=300 does nothing for a route
// that awaits searchParams (Next.js 15 treats that as a dynamic API and
// disables the Full Route Cache). Caching at the query level instead means
// the dominant default feed view (unfiltered, page 1) serves from cache for
// every user. Sync cron calls revalidateTag("bills") on write.
//
// Cache key includes filters + page + pageSize via unstable_cache's
// argument-derived keying. Filter combinations that vary order (e.g. topics)
// produce distinct keys; that's a hit-rate cost we accept for simplicity.
export const getFeedBills = unstable_cache(
  async (
    filters: FeedFilters,
    {
      page = 1,
      pageSize = FEED_PAGE_SIZE,
    }: { page?: number; pageSize?: number } = {},
  ): Promise<FeedPage> => {
    const db = getDb();

    // HO 338: when q is present, drive from the bills_fts FTS5 MATCH (the narrow,
    // selective side) instead of the leading-`%` LIKE that full-scanned title/
    // summary and 500'd `/bills?q=` (~20s, the /search 500 class — HO 335/336).
    // Join bills by rowid, AND the other feed filters (qualified "bills." + skipQ
    // so buildFeedWhere drops the LIKE), date-sort + paginate the matched set, and
    // count off the match (no second scan). **No HO 335 sort-index hint on this
    // path** — a forced INDEXED BY makes the planner drive from the sort index,
    // which blocks the FTS join from driving and lands back on a scan. The
    // q-ABSENT path below is HO 335 verbatim and must stay byte-unchanged.
    const ftsQ = filters.q?.trim();
    if (ftsQ) {
      const match = buildBillsFtsMatch(ftsQ);
      // No usable (alphanumeric) tokens (e.g. q="!!!") → no matches, no DB hit.
      if (!match) {
        return { bills: [], total: 0, page: 1, pageSize, totalPages: 1 };
      }
      const { clauses: qClauses, args: qArgs } = buildFeedWhere(filters, {
        prefix: "bills.",
        skipQ: true,
      });
      const qWhere = qClauses.join(" AND ");
      const countRs = await db.execute({
        sql: `SELECT COUNT(*) AS n FROM bills_fts JOIN bills ON bills.rowid = bills_fts.rowid
              WHERE bills_fts MATCH ? AND ${qWhere}`,
        args: [match, ...qArgs],
      });
      const total = Number(countRs.rows[0]?.n ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const clampedPage = Math.min(Math.max(1, Math.trunc(page)), totalPages);
      const offset = (clampedPage - 1) * pageSize;
      const sortColumn =
        filters.sort === "introduced"
          ? "bills.introduced_date"
          : "bills.latest_action_date";
      const sortDir = filters.direction === "asc" ? "ASC" : "DESC";
      const sql = `SELECT bills.id, bills.congress, bills.bill_type, bills.bill_number, bills.title,
        bills.sponsor_name, bills.sponsor_party, bills.sponsor_state, bills.introduced_date,
        bills.latest_action_date, bills.latest_action_text, bills.update_date,
        bills.summary, bills.topics, bills.stage, bills.stage_changed_at,
        bills.sponsor_bioguide_id, bills.cosponsor_count,
        msp.depiction_url AS sponsor_depiction_url,
        msp.first_name AS sponsor_first_name,
        msp.last_name AS sponsor_last_name,
        msp.district AS sponsor_district,
        ${MENTION_SELECT}
        FROM bills_fts JOIN bills ON bills.rowid = bills_fts.rowid
        ${MENTION_SUBQUERY}
        LEFT JOIN members msp ON msp.bioguide_id = bills.sponsor_bioguide_id
        WHERE bills_fts MATCH ? AND ${qWhere}
        ORDER BY ${sortColumn} ${sortDir} NULLS LAST, bills.id DESC
        LIMIT ? OFFSET ?`;
      const rs = await db.execute({ sql, args: [match, ...qArgs, pageSize, offset] });
      return {
        bills: rs.rows.map(rowToFeedBill),
        total,
        page: clampedPage,
        pageSize,
        totalPages,
      };
    }

    const { clauses, args } = buildFeedWhere(filters);
    const where = clauses.join(" AND ");

    // HO 279: the BARE feed COUNT (no user filter) is the summary-gated mis-plan
    // the 278 scout flagged — buildFeedWhere always carries `summary IS NOT NULL`,
    // and with no narrower predicate the statless planner drives off
    // idx_bills_is_ceremonial (MULTI-INDEX OR over the fat bills table, 44s cold,
    // the every-/bills-load 500 risk). Force the 277 partial idx_bills_summary_feed
    // there → index-only COUNT (44s → 30ms). ONLY when bare: with a user filter the
    // planner already picks a better index (stage → the 278 idx_bills_summary_stage,
    // 152ms; cluster → idx_bills_cluster_id), and forcing summary_feed would make
    // it SCAN the whole partial set + row-fetch the filter column (measured 8.5s
    // cold for ?stage= — a regression). HO 335 closes the chamber case below via
    // idx_bills_chamber_feed; ?q has no usable index (LIKE) and stays a WATCH.
    // includeCeremonial only DROPS the ceremonial clause, so it stays bare-eligible.
    const bareGated =
      !filters.stage &&
      !filters.sponsor &&
      !filters.q &&
      !filters.chamber &&
      !filters.cluster &&
      (!filters.topics || filters.topics.length === 0);
    // HO 335: chamber as the SOLE filter — force the partial idx_bills_chamber_feed
    // (bill_type, is_ceremonial) WHERE summary IS NOT NULL for an index-only count
    // (else idx_bills_is_ceremonial MULTI-INDEX OR). Excludes the stage/cluster
    // combos so a more selective index (summary_stage / cluster_id) still wins.
    const chamberOnly =
      !!filters.chamber &&
      !filters.stage &&
      !filters.sponsor &&
      !filters.q &&
      !filters.cluster &&
      (!filters.topics || filters.topics.length === 0);
    const countHint = bareGated
      ? " INDEXED BY idx_bills_summary_feed"
      : chamberOnly
        ? " INDEXED BY idx_bills_chamber_feed"
        : "";
    const countRs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM bills${countHint} WHERE ${where}`,
      args: [...args],
    });
    const total = Number(countRs.rows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const clampedPage = Math.min(Math.max(1, Math.trunc(page)), totalPages);
    const offset = (clampedPage - 1) * pageSize;

    const sortColumn =
      filters.sort === "introduced" ? "introduced_date" : "latest_action_date";
    // HO 151: filters.direction === "asc" flips the order for the
    // /president alias case (oldest at desk first). NULLS LAST keeps
    // dateless rows out of the way regardless of direction.
    const sortDir = filters.direction === "asc" ? "ASC" : "DESC";

    // HO 335: the bare /bills SELECT (and the chamber-only SELECT) otherwise
    // MULTI-INDEX OR idx_bills_is_ceremonial + TEMP-B-TREE sort ~14k rows (HO 279
    // left the bare row-SELECT as WATCH; the count above was already hinted). Force
    // the index matching the active sort so the walk is pre-ordered (DESC) and the
    // LIMIT short-circuits — idx_bills_latest_action / idx_bills_introduced_date
    // both serve `<col> DESC NULLS LAST` via a reverse walk, row-filtering
    // summary/ceremonial(/bill_type) as they go. Only when bare or chamber-only: a
    // ?stage/?cluster filter already plans GOOD on its own selective index and
    // forcing this would regress it. These paths are always sortDir=DESC
    // (direction='asc' only rides the /president alias, which is ?stage= → neither).
    const selectHint =
      bareGated || chamberOnly
        ? filters.sort === "introduced"
          ? " INDEXED BY idx_bills_introduced_date"
          : " INDEXED BY idx_bills_latest_action"
        : "";

    const sql = `SELECT id, congress, bill_type, bill_number, title,
      sponsor_name, sponsor_party, sponsor_state, introduced_date,
      latest_action_date, latest_action_text, update_date,
      summary, topics, stage, stage_changed_at,
      sponsor_bioguide_id, cosponsor_count,
      msp.depiction_url AS sponsor_depiction_url,
      msp.first_name AS sponsor_first_name,
      msp.last_name AS sponsor_last_name,
      msp.district AS sponsor_district,
      ${MENTION_SELECT}
      FROM bills${selectHint}
      ${MENTION_SUBQUERY}
      LEFT JOIN members msp ON msp.bioguide_id = bills.sponsor_bioguide_id
      WHERE ${where}
      ORDER BY ${sortColumn} ${sortDir} NULLS LAST, id DESC
      LIMIT ? OFFSET ?`;

    const rs = await db.execute({ sql, args: [...args, pageSize, offset] });
    return {
      bills: rs.rows.map(rowToFeedBill),
      total,
      page: clampedPage,
      pageSize,
      totalPages,
    };
  },
  ["getFeedBills"],
  // HO 279: daily revalidate (was hourly), aligned to the refresh cadence. The
  // `bills` + `news-breaking` tags are the real freshness trigger (the daily sync
  // + news crons revalidateTag these), so the timer is just a backstop —
  // lengthening it keeps the cache the default rather than letting a per-hour
  // expiry land a cold COUNT+SELECT inside a user request. Mirrors /members
  // (getMembersRanked). The HO 279 index makes the cold COUNT sub-second anyway;
  // this keeps the slow path out of requests even if the feed regrows.
  { revalidate: 86400, tags: ["bills", "news-breaking"] },
);

export type FeedCount = {
  total: number;
  filtered: number;
};

export const getStaleBills = unstable_cache(
  async (filters: FeedFilters, limit = 50): Promise<FeedBill[]> => {
    const db = getDb();
    const { clauses, args } = buildStaleWhere(filters);
    args.push(limit);

    const sql = `SELECT id, congress, bill_type, bill_number, title,
      sponsor_name, sponsor_party, sponsor_state, introduced_date,
      latest_action_date, latest_action_text, update_date,
      summary, topics, stage, stage_changed_at,
      ${SPONSOR_ENRICH_SELECT},
      ${MENTION_SELECT}
      FROM bills INDEXED BY idx_bills_latest_action
      -- HO 241: forced — Turso blocks ANALYZE so the planner else picks idx_bills_is_ceremonial. buildStaleWhere always constrains latest_action_date.
      ${MENTION_SUBQUERY}
      ${SPONSOR_ENRICH_JOIN}
      WHERE ${clauses.join(" AND ")}
      ORDER BY latest_action_date ASC
      LIMIT ?`;

    const rs = await db.execute({ sql, args });
    return rs.rows.map(rowToFeedBill);
  },
  ["getStaleBills"],
  { revalidate: 3600, tags: ["bills", "news-breaking"] },
);

// HO 335: buildSponsorWhere, getSponsors, getSponsorCount deleted as dead code
// (see the Sponsor-types note above) — orphaned by the HO 328 merge.

export const SPONSOR_SORTS = ["volume", "passrate"] as const;
export type SponsorSort = (typeof SPONSOR_SORTS)[number];
const SPONSOR_SORTS_SET = new Set<string>(SPONSOR_SORTS);

export function sanitizeSponsorSort(
  raw: string | null | undefined,
): SponsorSort {
  if (raw && SPONSOR_SORTS_SET.has(raw)) return raw as SponsorSort;
  return "volume";
}

// HO 124: page-shape replacement for the sponsor-only roster. Driven from
// members LEFT JOIN bills_agg, so all 536 current members surface — including
// the handful (Pelosi, Hoyer, special-election arrivals like Armstrong /
// Mejia) who haven't sponsored anything yet. `passrate` is intentionally
// NULL when total=0 so the UI can render an em-dash instead of "0%", which
// reads as a real 0-of-N pass rate.
export type MemberRanking = {
  bioguide_id: string;
  name: string;
  party: string | null;
  state: string | null;
  chamber: Chamber;
  district: number | null;
  total: number;
  enacted: number;
  passrate: number | null;
  // HO 142: USCPR Palestine scorecard grade + rank, LEFT JOIN'd in
  // getMembersRanked so the row list can render the same chip the hub
  // header carries. Both null for the ~489 members not on the sheet
  // (House, Republican senators, independents).
  palestineGrade: string | null;
  palestineRank: number | null;
  // HO 200: USCPR total score (e.g. "57%") for the expanded-card scorecard
  // detail. Same LEFT JOIN, one extra column — no new query. Null off-sheet.
  palestineScore: string | null;
};

export type MemberParty = "D" | "R" | "I";
const MEMBER_PARTY_SET = new Set<string>(["D", "R", "I"]);
export function sanitizeMemberParty(input: unknown): MemberParty | undefined {
  if (typeof input !== "string") return undefined;
  return MEMBER_PARTY_SET.has(input) ? (input as MemberParty) : undefined;
}

export function sanitizeMemberState(
  input: unknown,
  allowed: Set<string>,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const up = input.toUpperCase();
  return allowed.has(up) ? up : undefined;
}

export type MemberFilters = {
  chamber?: Chamber;
  party?: MemberParty;
  state?: string;
  q?: string;
  includeCeremonial?: boolean;
};

// Builds the WHERE clauses + args shared by getMembersRanked and
// getMembersRankedCount. is_current=1 is always on — HO 124 covers the 119th
// Congress only; historical members (Frank, etc.) stay accessible via
// /members/[bioguideId] but don't pollute the roster page.
function buildMemberWhere(filters: MemberFilters): {
  clauses: string[];
  args: (string | number)[];
} {
  const clauses: string[] = ["m.is_current = 1"];
  const args: (string | number)[] = [];
  if (filters.chamber) {
    clauses.push("m.chamber = ?");
    args.push(filters.chamber);
  }
  if (filters.party) {
    clauses.push("m.party = ?");
    args.push(filters.party);
  }
  if (filters.state) {
    clauses.push("m.state = ?");
    args.push(filters.state);
  }
  if (filters.q) {
    clauses.push("LOWER(m.name) LIKE ?");
    args.push(`%${filters.q.toLowerCase()}%`);
  }
  return { clauses, args };
}

// Aggregation CTE used by both ranked + count queries — the count query
// doesn't strictly need it, but extracting keeps the ceremonial-filter
// semantics in one place.
function billsAggCte(includeCeremonial: boolean): string {
  const ceremonial = includeCeremonial
    ? ""
    : " AND (is_ceremonial = 0 OR is_ceremonial IS NULL)";
  return `bills_agg AS (
    SELECT
      sponsor_bioguide_id,
      COUNT(*) AS total,
      SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
      CAST(SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS REAL)
        / COUNT(*) AS passrate
    -- HO 277: forced INDEXED BY idx_bills_sponsor_agg
    -- (sponsor_bioguide_id, is_ceremonial, stage, congress). The statless Turso
    -- planner otherwise drives off idx_bills_is_ceremonial (MULTI-INDEX OR over
    -- ~every row + TEMP-B-TREE GROUP BY) — ~3.85s warm, tipping the 10s DB abort
    -- cold (the /members 500, digest 4101894172). The hint makes the GROUP BY
    -- index-only + already-ordered (EXPLAIN: SEARCH USING COVERING INDEX, 96ms).
    -- Safe only because the query always constrains sponsor_bioguide_id (IS NOT
    -- NULL) — keep that clause if editing.
    FROM bills INDEXED BY idx_bills_sponsor_agg
    WHERE sponsor_bioguide_id IS NOT NULL${ceremonial}
    GROUP BY sponsor_bioguide_id
  )`;
}

export const getMembersRanked = unstable_cache(
  async (
    filters: MemberFilters,
    sort: SponsorSort = "volume",
    page = 1,
    pageSize = 50,
  ): Promise<MemberRanking[]> => {
    const db = getDb();
    const { clauses, args } = buildMemberWhere(filters);
    // SQLite ORDER BY DESC sorts NULL last by default, so a NULL-passrate
    // (zero-bills) member lands at the bottom of the passrate-sort without
    // a NULLS-LAST clause. For volume sort, total=0 rows sort last by
    // numeric DESC. Either way: name ASC is the final tiebreak so the
    // 4 zero-sponsorship rows order deterministically (Armstrong, Hoyer,
    // Mejia, Pelosi).
    const sql = `
      WITH ${billsAggCte(filters.includeCeremonial ?? false)}
      SELECT
        m.bioguide_id, m.name, m.party, m.state, m.chamber, m.district,
        COALESCE(b.total,   0) AS total,
        COALESCE(b.enacted, 0) AS enacted,
        b.passrate             AS passrate,
        ps.grade               AS palestine_grade,
        ps.rank                AS palestine_rank,
        ps.total_score         AS palestine_score
      FROM members m
      LEFT JOIN bills_agg b ON b.sponsor_bioguide_id = m.bioguide_id
      LEFT JOIN palestine_scorecard ps ON ps.bioguide_id = m.bioguide_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY
        CASE WHEN ? = 'passrate' THEN passrate END DESC,
        CASE WHEN ? = 'passrate' THEN total    END DESC,
        CASE WHEN ? = 'volume'   THEN total    END DESC,
        m.name ASC
      LIMIT ? OFFSET ?
    `;
    const offset = Math.max(0, (page - 1) * pageSize);
    const rs = await db.execute({
      sql,
      args: [...args, sort, sort, sort, pageSize, offset],
    });
    return rs.rows.map((r) => ({
      bioguide_id: r.bioguide_id as string,
      name: r.name as string,
      party: (r.party as string | null) ?? null,
      state: (r.state as string | null) ?? null,
      chamber: r.chamber as Chamber,
      district: (r.district as number | null) ?? null,
      total: Number(r.total ?? 0),
      enacted: Number(r.enacted ?? 0),
      passrate: r.passrate === null || r.passrate === undefined
        ? null
        : Number(r.passrate),
      palestineGrade: (r.palestine_grade as string | null) ?? null,
      palestineRank:
        r.palestine_rank === null || r.palestine_rank === undefined
          ? null
          : Number(r.palestine_rank),
      palestineScore: (r.palestine_score as string | null) ?? null,
    }));
  },
  ["getMembersRanked"],
  // HO 277: revalidate aligned to the refresh cadence (daily) rather than hourly.
  // The `bills` + `members` tags are the real freshness trigger — the daily sync
  // cron revalidateTag("bills")s, flushing this — so the timer is just a backstop.
  // Lengthening it keeps the cache the default instead of letting a per-hour
  // expiry land a cold recompute inside a user request (the slow path that 500'd).
  { revalidate: 86400, tags: ["members", "bills"] },
);

export const getMembersRankedCount = unstable_cache(
  async (filters: MemberFilters): Promise<number> => {
    const db = getDb();
    const { clauses, args } = buildMemberWhere(filters);
    const rs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM members m WHERE ${clauses.join(" AND ")}`,
      args,
    });
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["getMembersRankedCount"],
  // HO 277: daily revalidate, cron-tag-flush is the real refresh (see getMembersRanked).
  { revalidate: 86400, tags: ["members", "bills"] },
);

// Distinct state codes among currently-serving members, alphabetical, for
// the /members state dropdown. Cached separately from the ranked rows so
// the dropdown stays stable as the user filters/paginates without re-
// running the bigger query.
export const getMemberStates = unstable_cache(
  async (): Promise<string[]> => {
    const db = getDb();
    const rs = await db.execute(
      `SELECT DISTINCT state FROM members
       WHERE is_current = 1 AND state IS NOT NULL
       ORDER BY state ASC`,
    );
    return rs.rows.map((r) => r.state as string);
  },
  ["getMemberStates"],
  { revalidate: 86400, tags: ["members"] },
);

// HO 328: per-member topic counts for the merged /members two-pane browser's
// topic-mix bar. ONE json_each fanout grouped by (sponsor_bioguide_id, topic) —
// NOT an N+1 across ~536 members (the premise-1 gate). Returns a FLAT array
// (NOT a Map — unstable_cache JSON-serializes; a Map round-trips to {}). The
// page groups by bioguide and derives each member's top-3 + OTHR shares. Forces
// idx_bills_sponsor_topics (HO 277-279 pattern — statless Turso won't pick it);
// safe because the query always constrains sponsor_bioguide_id + topics.
export type MemberTopicCount = {
  bioguideId: string;
  topic: string;
  count: number;
};

export const getMembersTopicMix = unstable_cache(
  async (includeCeremonial = false): Promise<MemberTopicCount[]> => {
    const db = getDb();
    const ceremonial = includeCeremonial
      ? ""
      : " AND (is_ceremonial = 0 OR is_ceremonial IS NULL)";
    const rs = await db.execute(
      `SELECT sponsor_bioguide_id AS bid, je.value AS topic, COUNT(*) AS n
       FROM bills INDEXED BY idx_bills_sponsor_topics, json_each(bills.topics) je
       WHERE sponsor_bioguide_id IS NOT NULL
         AND topics IS NOT NULL${ceremonial}
       GROUP BY sponsor_bioguide_id, je.value`,
    );
    return rs.rows.map((r) => ({
      bioguideId: r.bid as string,
      topic: r.topic as string,
      count: Number(r.n ?? 0),
    }));
  },
  ["getMembersTopicMix"],
  // Daily revalidate, cron-tag-flush is the real refresh (mirrors getMembersRanked).
  { revalidate: 86400, tags: ["bills"] },
);

// HO 328: scoped committee roster for the merged browser's right pane. Joins
// committee_members → members → the same billsAggCte the /members ranked list
// uses, so a roster row carries volume/enacted/passrate AND the member's role
// (chair/ranking). Order: chair first, ranking second (role-detected), then the
// rest by the active metric (volume DESC default, passrate when sort=passrate).
// Cheap — ≤61 roster rows (premise-2 gate: 3,839 committee_members total).
export type CommitteeRosterMember = MemberRanking & {
  role: string | null;
  partySide: "majority" | "minority" | null;
};

export const getCommitteeRoster = unstable_cache(
  async (
    systemCode: string,
    sort: SponsorSort = "volume",
    includeCeremonial = false,
  ): Promise<CommitteeRosterMember[]> => {
    const db = getDb();
    // role_rank pins chair (0) then ranking (1) ahead of rank-and-file (2);
    // the metric ORDER BY only applies within the rank-and-file block because
    // role_rank is the primary sort key.
    const sql = `
      WITH ${billsAggCte(includeCeremonial)}
      SELECT
        m.bioguide_id, m.name, m.party, m.state, m.chamber, m.district,
        cm.role, cm.party_side,
        COALESCE(b.total,   0) AS total,
        COALESCE(b.enacted, 0) AS enacted,
        b.passrate             AS passrate,
        ps.grade               AS palestine_grade,
        ps.rank                AS palestine_rank,
        ps.total_score         AS palestine_score,
        CASE
          WHEN LOWER(COALESCE(cm.role, '')) LIKE '%chair%' THEN 0
          WHEN LOWER(COALESCE(cm.role, '')) LIKE '%ranking%' THEN 1
          ELSE 2
        END AS role_rank
      FROM committee_members cm
      JOIN members m ON m.bioguide_id = cm.bioguide_id
      LEFT JOIN bills_agg b ON b.sponsor_bioguide_id = m.bioguide_id
      LEFT JOIN palestine_scorecard ps ON ps.bioguide_id = m.bioguide_id
      WHERE cm.committee_system_code = ?
      ORDER BY
        role_rank ASC,
        CASE WHEN ? = 'passrate' THEN passrate END DESC,
        CASE WHEN ? = 'passrate' THEN total    END DESC,
        CASE WHEN ? = 'volume'   THEN total    END DESC,
        m.name ASC
    `;
    const rs = await db.execute({
      sql,
      args: [systemCode, sort, sort, sort],
    });
    return rs.rows.map((r) => ({
      bioguide_id: r.bioguide_id as string,
      name: r.name as string,
      party: (r.party as string | null) ?? null,
      state: (r.state as string | null) ?? null,
      chamber: r.chamber as Chamber,
      district: (r.district as number | null) ?? null,
      total: Number(r.total ?? 0),
      enacted: Number(r.enacted ?? 0),
      passrate:
        r.passrate === null || r.passrate === undefined
          ? null
          : Number(r.passrate),
      palestineGrade: (r.palestine_grade as string | null) ?? null,
      palestineRank:
        r.palestine_rank === null || r.palestine_rank === undefined
          ? null
          : Number(r.palestine_rank),
      palestineScore: (r.palestine_score as string | null) ?? null,
      role: (r.role as string | null) ?? null,
      partySide: (r.party_side as "majority" | "minority" | null) ?? null,
    }));
  },
  ["getCommitteeRoster"],
  { revalidate: 86400, tags: ["committees", "bills"] },
);

// HO 335: type SponsorPassRate + getSponsorsRanked + getSponsorPassRates deleted
// as dead code (see the Sponsor-types note above) — orphaned by the HO 328 merge.

export async function getSponsorStates(): Promise<string[]> {
  const db = getDb();
  const rs = await db.execute(
    `SELECT DISTINCT sponsor_state FROM bills
     WHERE summary IS NOT NULL AND sponsor_state IS NOT NULL AND sponsor_state != ''
     ORDER BY sponsor_state ASC`,
  );
  return rs.rows
    .map((r) => (r.sponsor_state as string | null) ?? null)
    .filter((s): s is string => !!s);
}

export const getSponsorRecentBills = unstable_cache(
  async (
    sponsorKey: string,
    includeCeremonial: boolean = false,
  ): Promise<FeedBill[]> => {
    const db = getDb();
    const ceremonialClause = includeCeremonial
      ? ""
      : " AND (is_ceremonial = 0 OR is_ceremonial IS NULL)";
    // HO 331: bioguide-only + forced index. The old `OR sponsor_name = ?` branch
    // was unindexed and dead (the sole caller passes a bioguide; a bioguide never
    // equals a sponsor_name), and it dropped the planner onto idx_bills_is_ceremonial
    // (MULTI-INDEX OR over ~every non-ceremonial row → cold-abort 500, HO 277/329
    // misplan class). INDEXED BY is mandatory — the statless planner won't pick it.
    const sql = `SELECT id, congress, bill_type, bill_number, title,
      sponsor_name, sponsor_party, sponsor_state, introduced_date,
      latest_action_date, latest_action_text, update_date,
      summary, topics, stage, stage_changed_at
      FROM bills INDEXED BY idx_bills_sponsor_agg
      WHERE sponsor_bioguide_id = ?
        AND summary IS NOT NULL${ceremonialClause}
      ORDER BY latest_action_date DESC NULLS LAST`;
    const rs = await db.execute({ sql, args: [sponsorKey] });
    return rs.rows.map(rowToFeedBill);
  },
  ["getSponsorRecentBills"],
  { revalidate: 3600, tags: ["bills"] },
);

export type SponsorStats = {
  total: number;
  enacted: number;
  introduced: number;
  committee: number;
  floor: number;
  other_chamber: number;
  president: number;
};

export const getSponsorStats = unstable_cache(
  async (
    sponsorKey: string,
    includeCeremonial: boolean = false,
  ): Promise<SponsorStats> => {
    const db = getDb();
    const ceremonialClause = includeCeremonial
      ? ""
      : " AND (is_ceremonial = 0 OR is_ceremonial IS NULL)";
    const rs = await db.execute({
      sql: `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
          SUM(CASE WHEN stage = 'introduced' THEN 1 ELSE 0 END) AS introduced,
          SUM(CASE WHEN stage = 'committee' THEN 1 ELSE 0 END) AS committee,
          SUM(CASE WHEN stage = 'floor' THEN 1 ELSE 0 END) AS floor_count,
          SUM(CASE WHEN stage = 'other_chamber' THEN 1 ELSE 0 END) AS other_chamber,
          SUM(CASE WHEN stage = 'president' THEN 1 ELSE 0 END) AS president
        FROM bills INDEXED BY idx_bills_sponsor_agg
        WHERE sponsor_bioguide_id = ?${ceremonialClause}`,
      args: [sponsorKey],
    });
    const r = rs.rows[0];
    return {
      total: Number(r?.total ?? 0),
      enacted: Number(r?.enacted ?? 0),
      introduced: Number(r?.introduced ?? 0),
      committee: Number(r?.committee ?? 0),
      floor: Number(r?.floor_count ?? 0),
      other_chamber: Number(r?.other_chamber ?? 0),
      president: Number(r?.president ?? 0),
    };
  },
  ["getSponsorStats"],
  { revalidate: 3600, tags: ["bills"] },
);

export type SponsorTopic = { topic: string; count: number };

export const getSponsorTopTopics = unstable_cache(
  async (
    sponsorKey: string,
    limit = 3,
    includeCeremonial: boolean = false,
  ): Promise<SponsorTopic[]> => {
    const db = getDb();
    const ceremonialClause = includeCeremonial
      ? ""
      : " AND (is_ceremonial = 0 OR is_ceremonial IS NULL)";
    const rs = await db.execute({
      sql: `SELECT topics FROM bills INDEXED BY idx_bills_sponsor_topics
            WHERE sponsor_bioguide_id = ?
              AND topics IS NOT NULL${ceremonialClause}`,
      args: [sponsorKey],
    });
    const counts = new Map<string, number>();
    for (const row of rs.rows) {
      const raw = row.topics as string | null;
      if (!raw) continue;
      try {
        const arr = JSON.parse(raw) as unknown;
        if (!Array.isArray(arr)) continue;
        for (const t of arr) {
          if (typeof t !== "string") continue;
          counts.set(t, (counts.get(t) ?? 0) + 1);
        }
      } catch {
        continue;
      }
    }
    return [...counts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
      .slice(0, limit);
  },
  ["getSponsorTopTopics"],
  { revalidate: 3600, tags: ["bills"] },
);

function buildChangesWhere(
  filters: FeedFilters,
  days: number,
  dashboard?: DashboardFilters,
): {
  clauses: string[];
  args: (string | number)[];
} {
  const { stage: _ignored, ...rest } = filters;
  const { clauses, args } = buildFeedWhere(rest);
  clauses.push("stage_changed_at IS NOT NULL");
  clauses.push(`stage_changed_at > datetime('now', '-${days} days')`);
  // Dashboard click-to-filter (handoff 56). Stage matches transitions
  // involving that stage in either direction; topic uses the json_each
  // EXISTS pattern shared with the other dashboard helpers.
  if (dashboard?.stage) {
    clauses.push("(stage = ? OR previous_stage = ?)");
    args.push(dashboard.stage, dashboard.stage);
  }
  if (dashboard?.topic) {
    clauses.push(
      "EXISTS (SELECT 1 FROM json_each(bills.topics) WHERE value = ?)",
    );
    args.push(dashboard.topic);
  }
  return { clauses, args };
}

export const getStageChanges = unstable_cache(
  async (
    filters: FeedFilters,
    days = 7,
    limit = 200,
    dashboard?: DashboardFilters,
  ): Promise<FeedBill[]> => {
    const db = getDb();
    const { clauses, args } = buildChangesWhere(filters, days, dashboard);
    args.push(limit);

    const sql = `SELECT id, congress, bill_type, bill_number, title,
      sponsor_name, sponsor_party, sponsor_state, introduced_date,
      latest_action_date, latest_action_text, update_date,
      summary, topics, stage, previous_stage, stage_changed_at,
      ${SPONSOR_ENRICH_SELECT},
      ${MENTION_SELECT}
      FROM bills INDEXED BY idx_bills_stage_changed_at
      -- HO 241: forced — Turso blocks ANALYZE so the planner else picks idx_bills_is_ceremonial and scans ~all rows (~20s). buildChangesWhere always constrains stage_changed_at.
      ${MENTION_SUBQUERY}
      ${SPONSOR_ENRICH_JOIN}
      WHERE ${clauses.join(" AND ")}
      ORDER BY stage_changed_at DESC
      LIMIT ?`;

    const rs = await db.execute({ sql, args });
    return rs.rows.map((r) => ({
      ...rowToFeedBill(r),
      previous_stage: (r.previous_stage as string | null) ?? null,
      stage_changed_at: (r.stage_changed_at as string | null) ?? null,
    }));
  },
  ["getStageChanges"],
  { revalidate: 3600, tags: ["bills", "news-breaking"] },
);

export const getStageChangesCount = unstable_cache(
  async (
    filters: FeedFilters,
    days = 7,
    dashboard?: DashboardFilters,
  ): Promise<FeedCount> => {
    const db = getDb();
    const { clauses: filteredClauses, args: filteredArgs } = buildChangesWhere(
      filters,
      days,
      dashboard,
    );
    // `total` here is "all changes inside the active filter context" — the
    // ACTIVITY tab badge consumes .total, so the dashboard-filter slice has
    // to ride into both the total and the filtered query for the badge to
    // rebase alongside the rows. /changes never passes `dashboard`, so its
    // behavior is unchanged.
    const { clauses: totalClauses, args: totalArgs } = buildChangesWhere(
      {},
      days,
      dashboard,
    );
    // HO 241: force idx_bills_stage_changed_at on both counts — Turso blocks
    // ANALYZE so the planner else scans via idx_bills_is_ceremonial (~20s).
    // buildChangesWhere always constrains stage_changed_at, so it always applies.
    const totalRs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_stage_changed_at WHERE ${totalClauses.join(" AND ")}`,
      args: totalArgs,
    });
    const filteredRs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_stage_changed_at WHERE ${filteredClauses.join(" AND ")}`,
      args: filteredArgs,
    });
    return {
      total: Number(totalRs.rows[0]?.n ?? 0),
      filtered: Number(filteredRs.rows[0]?.n ?? 0),
    };
  },
  ["getStageChangesCount"],
  { revalidate: 3600, tags: ["bills"] },
);

// HO 232: bills that reached `enacted` in the last 7 days, for the dashboard
// ENACTED THIS WEEK banner. Cached + tag "bills" (flushed by the sync cron's
// revalidateTag), unlike the cron's raw read in lib/dashboard-lead.ts — both
// share the queryEnactedThisWeek predicate.
export const getEnactedThisWeek = unstable_cache(
  async (): Promise<EnactedBill[]> => {
    const db = getDb();
    return queryEnactedThisWeek(db);
  },
  ["getEnactedThisWeek"],
  { revalidate: 3600, tags: ["bills"] },
);

// HO 283: prior-week (days 7–14 ago) counterparts to the weekly band's three
// this-week aggregates — ENACTED, NEW BILLS, TRANSITIONS — for the WoW deltas.
// Each mirrors its this-week predicate EXACTLY (so the delta is a true like-for-
// like change), shifted to the immediately preceding 7-day window:
//   - enacted: queryEnactedPriorWeekCount (shares the enacted-this-week predicate)
//   - new bills: same non-ceremonial introduced_date slice as getNewBillsThisWeekCount
//   - transitions: buildChangesWhere({}, 14) — the IDENTICAL predicate to
//     getStageChangesCount (summary + non-ceremonial + stage_changed_at) — capped
//     to (-14d, -7d] so it can't drift from the this-week count.
// One cached read (three COUNTs); tag "bills" so the sync cron flushes it.
export const getWeeklyBandPriorWeek = unstable_cache(
  async (): Promise<{
    enacted: number;
    newBills: number;
    transitions: number;
  }> => {
    const db = getDb();
    const { clauses: txClauses, args: txArgs } = buildChangesWhere({}, 14);
    txClauses.push("stage_changed_at <= datetime('now', '-7 days')");
    const [enacted, newBillsRs, txRs] = await Promise.all([
      queryEnactedPriorWeekCount(db),
      db.execute(
        `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_introduced_date
         WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
           AND introduced_date IS NOT NULL
           AND introduced_date > date('now', '-14 days')
           AND introduced_date <= date('now', '-7 days')`,
      ),
      db.execute({
        sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_stage_changed_at WHERE ${txClauses.join(" AND ")}`,
        args: txArgs,
      }),
    ]);
    return {
      enacted,
      newBills: Number(newBillsRs.rows[0]?.n ?? 0),
      transitions: Number(txRs.rows[0]?.n ?? 0),
    };
  },
  ["getWeeklyBandPriorWeek"],
  { revalidate: 3600, tags: ["bills"] },
);

// HO 286: this-week + prior-week committee-meeting counts for the weekly band's
// fourth metric (HEARINGS) and its WoW delta. Trailing-7-day windows matching
// the band's other metrics — this week is getRecentMeetings' [now-7d, now)
// bound (held meetings only, so upcoming calendar entries don't inflate it),
// prior is the immediately preceding [now-14d, now-7d). meeting_date is ISO-UTC,
// so bound with JS ISO strings exactly like getRecentMeetings — a like-for-like
// lexical compare (NOT datetime('now'), whose space-separated form mis-sorts
// against the stored 'T'/'Z' timestamps). Tag "meetings" (the committees cron
// flushes it), NOT "bills". Prior-week data is retained back to 2025-01, so the
// delta is real, never a fabricated ±0.
export const getWeeklyBandHearings = unstable_cache(
  async (): Promise<{ thisWeek: number; priorWeek: number }> => {
    const db = getDb();
    const now = new Date().toISOString();
    const d7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const d14 = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const countWindow = (lo: string, hi: string) =>
      db.execute({
        sql: `SELECT COUNT(*) AS n FROM committee_meetings
              WHERE meeting_date IS NOT NULL
                AND meeting_date < ? AND meeting_date >= ?`,
        args: [hi, lo],
      });
    const [thisRs, priorRs] = await Promise.all([
      countWindow(d7, now),
      countWindow(d14, d7),
    ]);
    return {
      thisWeek: Number(thisRs.rows[0]?.n ?? 0),
      priorWeek: Number(priorRs.rows[0]?.n ?? 0),
    };
  },
  ["getWeeklyBandHearings"],
  { revalidate: 3600, tags: ["meetings"] },
);

// HO 335: getStaleCount deleted as dead code — grep-confirmed zero callers (its
// /stale count-badge consumer was removed in HO 323 and the call deleted in HO
// 326; the function was left orphaned). HO 335 first proposed forcing a new
// idx_bills_stale_count here, but the Group-D rule wins: a dead query gets
// deleted, not indexed (and the index isn't created — nothing maintains write
// cost for an uncalled COUNT). This closes the HO 241 banked /stale-count loop by
// removal. getStaleBills (the live /stale row list) is unaffected — it keeps its
// own idx_bills_latest_action hint and shares buildStaleWhere below.

function rowToFeedBill(r: Record<string, unknown>): FeedBill {
  return {
    id: r.id as string,
    congress: r.congress as number,
    bill_type: r.bill_type as string,
    bill_number: r.bill_number as number,
    title: r.title as string,
    sponsor_name: (r.sponsor_name as string | null) ?? null,
    sponsor_party: (r.sponsor_party as string | null) ?? null,
    sponsor_state: (r.sponsor_state as string | null) ?? null,
    introduced_date: (r.introduced_date as string | null) ?? null,
    latest_action_date: (r.latest_action_date as string | null) ?? null,
    latest_action_text: (r.latest_action_text as string | null) ?? null,
    update_date: r.update_date as string,
    summary: (r.summary as string | null) ?? null,
    topics: (r.topics as string | null) ?? null,
    stage: (r.stage as string | null) ?? null,
    // HO 125: pulled into every feed-shape query so the StagePillStrip can
    // render the current pill's time-since. Undefined-safe so callers that
    // don't yet SELECT the column degrade to no-time on the current pill.
    stage_changed_at:
      r.stage_changed_at === undefined
        ? null
        : ((r.stage_changed_at as string | null) ?? null),
    // HO 130: same undefined-safe pattern — defaults to 0 if the caller
    // didn't SELECT mention_count_7d (a getBillById caller, for example).
    mentionCount7d:
      r.mention_count_7d === undefined
        ? 0
        : Number(r.mention_count_7d ?? 0),
    // HO 188: undefined-safe — feed queries that don't SELECT these degrade
    // to null (link/count omitted) rather than breaking.
    sponsor_bioguide_id:
      r.sponsor_bioguide_id === undefined
        ? null
        : ((r.sponsor_bioguide_id as string | null) ?? null),
    cosponsor_count:
      r.cosponsor_count === undefined
        ? null
        : r.cosponsor_count === null
          ? null
          : Number(r.cosponsor_count),
    // HO 192: undefined-safe — only getFeedBills SELECTs it.
    sponsor_depiction_url:
      r.sponsor_depiction_url === undefined
        ? null
        : ((r.sponsor_depiction_url as string | null) ?? null),
    // HO 194: undefined-safe — only getFeedBills SELECTs these.
    sponsor_first_name:
      r.sponsor_first_name === undefined
        ? null
        : ((r.sponsor_first_name as string | null) ?? null),
    sponsor_last_name:
      r.sponsor_last_name === undefined
        ? null
        : ((r.sponsor_last_name as string | null) ?? null),
    sponsor_district:
      r.sponsor_district === undefined || r.sponsor_district === null
        ? null
        : Number(r.sponsor_district),
  };
}

export async function getBillById(id: string): Promise<BillDetail | null> {
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT id, congress, bill_type, bill_number, title,
      sponsor_name, sponsor_party, sponsor_state,
      introduced_date, latest_action_date, latest_action_text, update_date,
      summary, summary_model, summary_updated_at, topics, stage, raw_json
      FROM bills WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const r = rs.rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    congress: r.congress as number,
    bill_type: r.bill_type as string,
    bill_number: r.bill_number as number,
    title: r.title as string,
    sponsor_name: (r.sponsor_name as string | null) ?? null,
    sponsor_party: (r.sponsor_party as string | null) ?? null,
    sponsor_state: (r.sponsor_state as string | null) ?? null,
    introduced_date: (r.introduced_date as string | null) ?? null,
    latest_action_date: (r.latest_action_date as string | null) ?? null,
    latest_action_text: (r.latest_action_text as string | null) ?? null,
    update_date: r.update_date as string,
    summary: (r.summary as string | null) ?? null,
    summary_model: (r.summary_model as string | null) ?? null,
    summary_updated_at: (r.summary_updated_at as string | null) ?? null,
    topics: (r.topics as string | null) ?? null,
    stage: (r.stage as string | null) ?? null,
    raw_json: r.raw_json as string,
  };
}

export async function isInWatchlist(billId: string): Promise<boolean> {
  const db = getDb();
  const rs = await db.execute({
    sql: "SELECT 1 FROM watchlist WHERE bill_id = ? LIMIT 1",
    args: [billId],
  });
  return rs.rows.length > 0;
}

// HO 127 — bulk read of every watched bill_id for the current "user" (the
// app is single-user, so the whole table is the answer). List pages call
// this once and pass the array through to BillRow → WatchStar so each row
// renders the correct ★/☆ glyph without an N-query fan-out. The watchlist
// table is personal-sized (<100 rows in practice); fetching the full list
// per render is cheap. Returns an array (not Set) because unstable_cache
// serializes its result and Set doesn't round-trip cleanly; callers Set-ify
// at the call site.
export const getWatchedBillIds = unstable_cache(
  async (): Promise<string[]> => {
    const db = getDb();
    const rs = await db.execute("SELECT bill_id FROM watchlist");
    return rs.rows.map((r) => r.bill_id as string);
  },
  ["getWatchedBillIds"],
  { revalidate: 3600, tags: ["watchlist"] },
);

export async function addToWatchlist(billId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "INSERT OR IGNORE INTO watchlist (bill_id, added_at) VALUES (?, ?)",
    args: [billId, new Date().toISOString()],
  });
}

export async function removeFromWatchlist(billId: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: "DELETE FROM watchlist WHERE bill_id = ?",
    args: [billId],
  });
}

export type ClusterStat = {
  id: string;
  name: string;
  description: string;
  count: number;
  exampleTitle: string | null;
  pastCommittee: number;
  enacted: number;
  ceremonial: number;
};

// Returns one row per pattern (zero-counts included), sorted by count DESC.
// Single GROUP BY scan aggregates count + stage-progression + ceremonial in
// one pass; per-id example title lookup runs only for non-empty clusters.
export const getClusterStats = unstable_cache(
  async (): Promise<ClusterStat[]> => {
    const db = getDb();
    // HO 340: force the covering idx_bills_cluster_agg (cluster_id, is_ceremonial,
    // stage). The SUMs read stage + is_ceremonial, both in the index, so the
    // GROUP BY over the clustered rows goes index-only + pre-ordered by cluster_id
    // (no row-fetch, no temp b-tree) — ~4.7s cold → tens of ms. Shares the index
    // with getUnmatchedClusterCount above; this agg is cached so it doesn't 500 on
    // its own, but it rides /patterns' Promise.all and the fix is free here.
    const aggRs = await db.execute(
      `SELECT cluster_id,
              COUNT(*) AS total,
              SUM(CASE WHEN stage IS NOT NULL AND stage <> 'introduced' AND stage <> 'committee' THEN 1 ELSE 0 END) AS past_committee,
              SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
              SUM(CASE WHEN is_ceremonial = 1 THEN 1 ELSE 0 END) AS ceremonial
       FROM bills INDEXED BY idx_bills_cluster_agg WHERE cluster_id IS NOT NULL GROUP BY cluster_id`,
    );
    type Agg = { total: number; pastCommittee: number; enacted: number; ceremonial: number };
    const aggByPattern = new Map<string, Agg>();
    for (const r of aggRs.rows) {
      aggByPattern.set(r.cluster_id as string, {
        total: Number(r.total ?? 0),
        pastCommittee: Number(r.past_committee ?? 0),
        enacted: Number(r.enacted ?? 0),
        ceremonial: Number(r.ceremonial ?? 0),
      });
    }

    const result: ClusterStat[] = [];
    for (const p of CLUSTER_PATTERNS) {
      const agg = aggByPattern.get(p.id) ?? {
        total: 0,
        pastCommittee: 0,
        enacted: 0,
        ceremonial: 0,
      };
      let exampleTitle: string | null = null;
      if (agg.total > 0) {
        const ex = await db.execute({
          sql: `SELECT title FROM bills
                WHERE cluster_id = ?
                ORDER BY latest_action_date DESC NULLS LAST, id DESC
                LIMIT 1`,
          args: [p.id],
        });
        exampleTitle = (ex.rows[0]?.title as string | null) ?? null;
      }
      result.push({
        id: p.id,
        name: p.name,
        description: p.description,
        count: agg.total,
        exampleTitle,
        pastCommittee: agg.pastCommittee,
        enacted: agg.enacted,
        ceremonial: agg.ceremonial,
      });
    }
    return result.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  },
  ["getClusterStats"],
  { revalidate: 3600, tags: ["bills"] },
);

export const getUnmatchedClusterCount = unstable_cache(
  async (includeCeremonial: boolean = false): Promise<number> => {
    const db = getDb();
    // Honors the active ceremonial filter so the displayed unmatched figure
    // matches what's actually visible elsewhere in the app.
    const ceremonialClause = includeCeremonial
      ? ""
      : " AND (is_ceremonial = 0 OR is_ceremonial IS NULL)";
    // HO 340: force the covering idx_bills_cluster_agg (cluster_id, is_ceremonial,
    // stage). `cluster_id IS NULL` matches ~15.1k of 16.5k rows (most bills are
    // unclustered); the old plan seeked idx_bills_cluster_id then ROW-FETCHED
    // is_ceremonial for all 15k (it's not in that index) → ~20s, tripping the 10s
    // abort, and since the populate never finishes the unstable_cache never fills →
    // a permanent /patterns 500. With is_ceremonial in the index the COUNT is
    // index-only (EXPLAIN: SCAN USING COVERING INDEX). The plain-index plan read
    // GOOD to the HO 332 EXPLAIN audit — the row-fetch cost only shows in timing.
    const rs = await db.execute(
      `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_cluster_agg
       WHERE cluster_id IS NULL${ceremonialClause}`,
    );
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["getUnmatchedClusterCount"],
  { revalidate: 3600, tags: ["bills"] },
);

export type PatternTopSponsor = {
  name: string;
  party: string | null;
  count: number;
};

export type PatternDrilldown = {
  topSponsors: PatternTopSponsor[];
  recentBills: FeedBill[];
  headline: {
    total: number;
    pastCommittee: number;
    enacted: number;
    ceremonial: number;
  };
};

// Powers the /patterns drill-in panel. Caller is expected to pass a
// CLUSTER_IDS-validated slug (use sanitizeClusterId). Tag matches the rest
// of the bills graph so a sync invalidates this alongside everything else.
export const getClusterDrilldown = unstable_cache(
  async (clusterId: string): Promise<PatternDrilldown> => {
    const db = getDb();

    const [headlineRs, sponsorsRs, recentRs] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) AS total,
                     SUM(CASE WHEN stage IS NOT NULL AND stage <> 'introduced' AND stage <> 'committee' THEN 1 ELSE 0 END) AS past_committee,
                     SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
                     SUM(CASE WHEN is_ceremonial = 1 THEN 1 ELSE 0 END) AS ceremonial
              FROM bills WHERE cluster_id = ?`,
        args: [clusterId],
      }),
      db.execute({
        // HO 199: dedupe by the stable bioguide (was GROUP BY sponsor_name,
        // sponsor_party — which split a member whose bills carry two name
        // spellings under one bioguide, same bug as the scatter). MAX(...)
        // keeps the "Last, First [bracket]" shape this panel's shortSponsor()
        // expects (members.name is directOrder and wouldn't shorten) while
        // collapsing to one row per bioguide. No null-bioguide bills exist, so
        // gating on bioguide drops nothing.
        sql: `SELECT MAX(sponsor_name) AS name, MAX(sponsor_party) AS party,
                     COUNT(*) AS n
              FROM bills
              WHERE cluster_id = ? AND sponsor_bioguide_id IS NOT NULL
              GROUP BY sponsor_bioguide_id
              ORDER BY n DESC
              LIMIT 5`,
        args: [clusterId],
      }),
      db.execute({
        sql: `SELECT id, congress, bill_type, bill_number, title,
                     sponsor_name, sponsor_party, sponsor_state, introduced_date,
                     latest_action_date, latest_action_text, update_date,
                     summary, topics, stage, stage_changed_at
              FROM bills
              WHERE cluster_id = ?
              ORDER BY latest_action_date DESC NULLS LAST, id DESC
              LIMIT 10`,
        args: [clusterId],
      }),
    ]);

    const headlineRow = headlineRs.rows[0];
    return {
      topSponsors: sponsorsRs.rows.map((r) => ({
        name: r.name as string,
        party: (r.party as string | null) ?? null,
        count: Number(r.n ?? 0),
      })),
      recentBills: recentRs.rows.map(rowToFeedBill),
      headline: {
        total: Number(headlineRow?.total ?? 0),
        pastCommittee: Number(headlineRow?.past_committee ?? 0),
        enacted: Number(headlineRow?.enacted ?? 0),
        ceremonial: Number(headlineRow?.ceremonial ?? 0),
      },
    };
  },
  ["getClusterDrilldown"],
  { revalidate: 3600, tags: ["bills"] },
);

// ---- /search global search (HO 129) -----------------------------------

export const SEARCH_TABS = ["bills", "members", "news", "reports"] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];
const SEARCH_TABS_SET = new Set<string>(SEARCH_TABS);

const SEARCH_Q_MAX = 200;

export function sanitizeQ(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  return raw.trim().slice(0, SEARCH_Q_MAX);
}

export function sanitizeSearchTab(
  raw: string | null | undefined,
): SearchTab {
  if (raw && SEARCH_TABS_SET.has(raw)) return raw as SearchTab;
  return "bills";
}

const SEARCH_LIMIT = 50;

// HO 336: bills search runs through the FTS5 index `bills_fts` (external content
// over title/summary/sponsor_name — see scripts/migrate.ts), NOT a LIKE. A
// leading-`%` LIKE over title/summary full-scanned the 16k corpus and cold-aborted
// past the 10s DB limit on common terms (the HO 335 /search 500); FTS turns the
// match into an index lookup. Global search ignores topic/stage/cluster/chamber
// filters; ceremonial + summary-null bills stay hidden (matches buildFeedWhere).
//
// NOTE: `id` is deliberately NOT in the FTS. Bill-id tokens (119, hr, the number)
// appear in ~every id, so prefix terms like `1*` / `119*` expand to ~the whole
// index and blow up (a "119-hr-1" search hit a 20s abort while id was indexed).
// id-substring search in global /search was already non-functional (it rode the
// same LIKE 500), so it's dropped here rather than special-cased.
//
// Build a safe FTS5 MATCH string from untrusted input: extract alphanumeric
// tokens (drops FTS operators / quotes / punctuation → injection-safe). Prefix-
// match tokens of length >= 3 (`tax*` matches taxation); 1-2 char tokens match
// exactly (a short prefix like `a*` / `1*` expands to a huge posting list).
// Implicit AND across terms, OR across the indexed columns; bm25 ranks. Returns
// null when the query has no usable tokens (caller returns empty).
function buildBillsFtsMatch(q: string): string | null {
  const tokens = q.toLowerCase().match(/[a-z0-9]+/g);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((t) => (t.length >= 3 ? `${t}*` : t)).join(" ");
}

// Shared FROM/WHERE: join the FTS match set back to bills by rowid, then apply
// the same visibility gate the LIKE path used (summary present, non-ceremonial).
const BILLS_FTS_FROM = `FROM bills_fts JOIN bills ON bills.rowid = bills_fts.rowid
      WHERE bills_fts MATCH ?
        AND bills.summary IS NOT NULL
        AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)`;

export const searchBillsCount = unstable_cache(
  async (q: string): Promise<number> => {
    if (!q) return 0;
    const match = buildBillsFtsMatch(q);
    if (!match) return 0;
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT COUNT(*) AS n ${BILLS_FTS_FROM}`,
      args: [match],
    });
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["searchBillsCount"],
  { revalidate: 600, tags: ["bills"] },
);

export const searchBills = unstable_cache(
  async (q: string): Promise<FeedBill[]> => {
    if (!q) return [];
    const match = buildBillsFtsMatch(q);
    if (!match) return [];
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT bills.id, bills.congress, bills.bill_type, bills.bill_number, bills.title,
                   bills.sponsor_name, bills.sponsor_party, bills.sponsor_state, bills.introduced_date,
                   bills.latest_action_date, bills.latest_action_text, bills.update_date,
                   bills.summary, bills.topics, bills.stage, bills.stage_changed_at
            ${BILLS_FTS_FROM}
            ORDER BY bm25(bills_fts)
            LIMIT ?`,
      args: [match, SEARCH_LIMIT],
    });
    return rs.rows.map(rowToFeedBill);
  },
  ["searchBills"],
  { revalidate: 600, tags: ["bills"] },
);

export type MemberSearchResult = {
  bioguide_id: string;
  name: string;
  party: string | null;
  state: string | null;
  chamber: Chamber | null;
  district: number | null;
  total: number;
};

// Matches against members.name OR state_name so "Texas" surfaces TX members.
// is_current=1 so historical members don't pollute the result list. Joined
// with the bills_agg CTE to surface the bill_count column.
export const searchMembersCount = unstable_cache(
  async (q: string): Promise<number> => {
    if (!q) return 0;
    const db = getDb();
    const like = `%${q.toLowerCase()}%`;
    const rs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM members
            WHERE is_current = 1
              AND (LOWER(name) LIKE ? OR LOWER(state_name) LIKE ?)`,
      args: [like, like],
    });
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["searchMembersCount"],
  { revalidate: 600, tags: ["members"] },
);

export const searchMembers = unstable_cache(
  async (q: string): Promise<MemberSearchResult[]> => {
    if (!q) return [];
    const db = getDb();
    const like = `%${q.toLowerCase()}%`;
    const sql = `
      WITH bills_agg AS (
        SELECT sponsor_bioguide_id, COUNT(*) AS total
        FROM bills
        WHERE sponsor_bioguide_id IS NOT NULL
          AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
        GROUP BY sponsor_bioguide_id
      )
      SELECT m.bioguide_id, m.name, m.party, m.state, m.chamber, m.district,
             COALESCE(b.total, 0) AS total
      FROM members m
      LEFT JOIN bills_agg b ON b.sponsor_bioguide_id = m.bioguide_id
      WHERE m.is_current = 1
        AND (LOWER(m.name) LIKE ? OR LOWER(m.state_name) LIKE ?)
      ORDER BY total DESC, m.name ASC
      LIMIT ?
    `;
    const rs = await db.execute({ sql, args: [like, like, SEARCH_LIMIT] });
    return rs.rows.map((r) => ({
      bioguide_id: r.bioguide_id as string,
      name: r.name as string,
      party: (r.party as string | null) ?? null,
      state: (r.state as string | null) ?? null,
      chamber: (r.chamber as Chamber | null) ?? null,
      district: (r.district as number | null) ?? null,
      total: Number(r.total ?? 0),
    }));
  },
  ["searchMembers"],
  { revalidate: 600, tags: ["members", "bills"] },
);

// News mentions reuse NewsMention so SearchResultsNews can render through
// the existing NewsRow component. INNER JOIN on bills (same shape as
// getBreakingNews) gives us bill_title + sponsor metadata for the row.
export const searchNewsCount = unstable_cache(
  async (q: string): Promise<number> => {
    if (!q) return 0;
    const db = getDb();
    const like = `%${q.toLowerCase()}%`;
    const rs = await db.execute({
      // HO 335: drive from the 227-row news side. Without the hint the stateless
      // planner drives from bills via idx_bills_is_ceremonial (MULTI-INDEX OR over
      // ~16k rows). The LIKE has no usable index either way, but forcing m as the
      // driver collapses the fat-table OR to a 227-row scan + bills PK join.
      sql: `SELECT COUNT(*) AS n FROM news_mentions m INDEXED BY idx_news_mentions_published
            INNER JOIN bills b ON b.id = m.bill_id
            WHERE (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
              AND (LOWER(m.article_title) LIKE ?
                OR LOWER(m.article_summary) LIKE ?
                OR LOWER(m.source) LIKE ?)`,
      args: [like, like, like],
    });
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["searchNewsCount"],
  { revalidate: 600, tags: ["news-breaking", "bills"] },
);

export const searchNews = unstable_cache(
  async (q: string): Promise<NewsMention[]> => {
    if (!q) return [];
    const db = getDb();
    const like = `%${q.toLowerCase()}%`;
    const rs = await db.execute({
      sql: `SELECT m.id, m.bill_id, m.source, m.article_title, m.article_url,
                   m.published_at,
                   b.title AS bill_title,
                   b.sponsor_name AS bill_sponsor_name,
                   b.sponsor_party AS bill_sponsor_party
            FROM news_mentions m INDEXED BY idx_news_mentions_published
            INNER JOIN bills b ON b.id = m.bill_id
            WHERE (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
              AND (LOWER(m.article_title) LIKE ?
                OR LOWER(m.article_summary) LIKE ?
                OR LOWER(m.source) LIKE ?)
            ORDER BY m.published_at DESC, m.id DESC
            LIMIT ?`,
      args: [like, like, like, SEARCH_LIMIT],
    });
    return rs.rows.map((r) => ({
      id: Number(r.id),
      billId: r.bill_id as string,
      billTitle: r.bill_title as string,
      billSponsorName: (r.bill_sponsor_name as string | null) ?? null,
      billSponsorParty: (r.bill_sponsor_party as string | null) ?? null,
      source: r.source as string,
      title: r.article_title as string,
      url: r.article_url as string,
      publishedAt: r.published_at as string,
      otherBills: [],
    }));
  },
  ["searchNews"],
  { revalidate: 600, tags: ["news-breaking", "bills"] },
);

export type ReportSearchResult = {
  slug: string;
  title: string;
  week_start: string;
  snippet: string;
};

// Builds a ~140-char snippet centered on the first match of `q` in
// content_md, with surrounding markdown noise (#/*/_) collapsed to spaces.
// If the match is in title rather than body, returns the first 140 chars
// of the body anyway as fallback context.
function reportSnippet(contentMd: string, q: string): string {
  const lower = contentMd.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);
  const start = idx >= 0 ? Math.max(0, idx - 60) : 0;
  const slice = contentMd.slice(start, start + 200);
  const cleaned = slice
    .replace(/[#*_`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 140 ? cleaned.slice(0, 140) + "…" : cleaned;
}

export const searchReportsCount = unstable_cache(
  async (q: string): Promise<number> => {
    if (!q) return 0;
    const db = getDb();
    const like = `%${q.toLowerCase()}%`;
    const rs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM reports
            WHERE LOWER(title) LIKE ? OR LOWER(content_md) LIKE ?`,
      args: [like, like],
    });
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["searchReportsCount"],
  { revalidate: 600, tags: ["reports"] },
);

export const searchReports = unstable_cache(
  async (q: string): Promise<ReportSearchResult[]> => {
    if (!q) return [];
    const db = getDb();
    const like = `%${q.toLowerCase()}%`;
    const rs = await db.execute({
      sql: `SELECT slug, title, week_start, content_md FROM reports
            WHERE LOWER(title) LIKE ? OR LOWER(content_md) LIKE ?
            ORDER BY week_start DESC
            LIMIT ?`,
      args: [like, like, SEARCH_LIMIT],
    });
    return rs.rows.map((r) => ({
      slug: r.slug as string,
      title: r.title as string,
      week_start: r.week_start as string,
      snippet: reportSnippet(r.content_md as string, q),
    }));
  },
  ["searchReports"],
  { revalidate: 600, tags: ["reports"] },
);

// Tagged with both "watchlist" (membership changes from toggle) and "bills"
// (underlying row data changes from sync), so either trigger invalidates.
export const getWatchlistBills = unstable_cache(
  async (sort: SortKey = "action", chamber?: Chamber): Promise<FeedBill[]> => {
    const db = getDb();
    const sortColumn =
      sort === "introduced" ? "b.introduced_date" : "b.latest_action_date";
    const chamberClause =
      chamber === "house"
        ? ` AND b.bill_type IN (${HOUSE_BILL_TYPES})`
        : chamber === "senate"
          ? ` AND b.bill_type IN (${SENATE_BILL_TYPES})`
          : "";
    const sql = `SELECT b.id, b.congress, b.bill_type, b.bill_number, b.title,
      b.sponsor_name, b.sponsor_party, b.sponsor_state, b.introduced_date,
      b.latest_action_date, b.latest_action_text, b.update_date,
      b.summary, b.topics, b.stage, b.stage_changed_at,
      COALESCE(nm.n, 0) AS mention_count_7d
      FROM bills b
      INNER JOIN watchlist w ON w.bill_id = b.id
      LEFT JOIN (
        SELECT bill_id, COUNT(*) AS n
        FROM news_mentions
        WHERE published_at >= datetime('now', '-${MENTION_WINDOW_DAYS} days')
          AND match_confidence >= ${NEWS_CONFIDENCE_FLOOR}
        GROUP BY bill_id
      ) nm ON nm.bill_id = b.id
      WHERE 1=1${chamberClause}
      ORDER BY ${sortColumn} DESC NULLS LAST, b.id DESC`;
    const rs = await db.execute(sql);
    return rs.rows.map(rowToFeedBill);
  },
  ["getWatchlistBills"],
  { revalidate: 3600, tags: ["watchlist", "bills", "news-breaking"] },
);

// ---- Votes (handoff 77) -------------------------------------------------

export type VotePosition = "yea" | "nay" | "present" | "not_voting";

export type Vote = {
  id: string;
  chamber: "house" | "senate";
  congress: number;
  session: number;
  rollCall: number;
  voteDate: string;
  question: string | null;
  description: string | null;
  result: string | null;
  billId: string | null;
  billTitle: string | null;
  amendmentDesignation: string | null;
  yeaCount: number;
  nayCount: number;
  presentCount: number | null;
  notVotingCount: number | null;
};

export type MemberVoteRecord = {
  voteId: string;
  bioguideId: string;
  position: VotePosition;
};

export type VoteWithMemberPosition = Vote & { position: VotePosition };

export type MemberVoteStats = {
  total: number;
  yea: number;
  nay: number;
  present: number;
  notVoting: number;
};

// Selects vote row + bill_title via LEFT JOIN so amendment / procedural votes
// (bill_id NULL) still render. Bill title arrives null in those rows; UI
// falls back to question + amendment_designation for the label.
const VOTE_SELECT = `
  SELECT v.id, v.chamber, v.congress, v.session, v.roll_call,
         v.vote_date, v.question, v.description, v.result,
         v.bill_id, v.amendment_designation,
         v.yea_count, v.nay_count, v.present_count, v.not_voting_count,
         b.title AS bill_title
  FROM votes v
  LEFT JOIN bills b ON b.id = v.bill_id
`;

function rowToVote(r: Record<string, unknown>): Vote {
  const chamber = r.chamber as string;
  return {
    id: r.id as string,
    chamber: chamber === "senate" ? "senate" : "house",
    congress: Number(r.congress),
    session: Number(r.session),
    rollCall: Number(r.roll_call),
    voteDate: r.vote_date as string,
    question: (r.question as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    result: (r.result as string | null) ?? null,
    billId: (r.bill_id as string | null) ?? null,
    billTitle: (r.bill_title as string | null) ?? null,
    amendmentDesignation:
      (r.amendment_designation as string | null) ?? null,
    yeaCount: Number(r.yea_count ?? 0),
    nayCount: Number(r.nay_count ?? 0),
    presentCount:
      r.present_count === null || r.present_count === undefined
        ? null
        : Number(r.present_count),
    notVotingCount:
      r.not_voting_count === null || r.not_voting_count === undefined
        ? null
        : Number(r.not_voting_count),
  };
}

function asPosition(value: unknown): VotePosition | null {
  if (value === "yea" || value === "nay" || value === "present" || value === "not_voting") {
    return value;
  }
  return null;
}

export const getRecentVotes = unstable_cache(
  async (chamber: "house" | "senate", limit: number): Promise<Vote[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `${VOTE_SELECT}
            WHERE v.chamber = ?
            ORDER BY v.vote_date DESC, v.id DESC
            LIMIT ?`,
      args: [chamber, limit],
    });
    return rs.rows.map(rowToVote);
  },
  ["getRecentVotes"],
  { revalidate: 3600, tags: ["votes"] },
);

export const getVotesByBill = unstable_cache(
  async (billId: string): Promise<Vote[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `${VOTE_SELECT}
            WHERE v.bill_id = ?
            ORDER BY v.vote_date DESC, v.id DESC`,
      args: [billId],
    });
    return rs.rows.map(rowToVote);
  },
  ["getVotesByBill"],
  { revalidate: 3600, tags: ["votes"] },
);

export const getMemberVote = unstable_cache(
  async (
    voteId: string,
    bioguideId: string,
  ): Promise<MemberVoteRecord | null> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT vote_id, bioguide_id, position
            FROM member_votes
            WHERE vote_id = ? AND bioguide_id = ?
            LIMIT 1`,
      args: [voteId, bioguideId],
    });
    const r = rs.rows[0];
    if (!r) return null;
    const pos = asPosition(r.position);
    if (!pos) return null;
    return {
      voteId: r.vote_id as string,
      bioguideId: r.bioguide_id as string,
      position: pos,
    };
  },
  ["getMemberVote"],
  { revalidate: 3600, tags: ["votes"] },
);

export const getMemberVotes = unstable_cache(
  async (
    bioguideId: string,
    opts: { page: number; pageSize: number },
  ): Promise<{ votes: VoteWithMemberPosition[]; total: number }> => {
    const db = getDb();
    const offset = (opts.page - 1) * opts.pageSize;
    const [rows, total] = await Promise.all([
      db.execute({
        sql: `SELECT v.id, v.chamber, v.congress, v.session, v.roll_call,
                v.vote_date, v.question, v.description, v.result,
                v.bill_id, v.amendment_designation,
                v.yea_count, v.nay_count, v.present_count, v.not_voting_count,
                b.title AS bill_title,
                mv.position
              FROM votes v
              LEFT JOIN bills b ON b.id = v.bill_id
              INNER JOIN member_votes mv ON mv.vote_id = v.id
              WHERE mv.bioguide_id = ?
              ORDER BY v.vote_date DESC, v.id DESC
              LIMIT ? OFFSET ?`,
        args: [bioguideId, opts.pageSize, offset],
      }),
      db.execute({
        sql: "SELECT COUNT(*) AS n FROM member_votes WHERE bioguide_id = ?",
        args: [bioguideId],
      }),
    ]);
    const votes: VoteWithMemberPosition[] = [];
    for (const r of rows.rows) {
      const pos = asPosition(r.position);
      if (!pos) continue;
      votes.push({ ...rowToVote(r), position: pos });
    }
    return { votes, total: Number(total.rows[0]?.n ?? 0) };
  },
  ["getMemberVotes"],
  { revalidate: 3600, tags: ["votes"] },
);

export const getMemberVoteStats = unstable_cache(
  async (bioguideId: string): Promise<MemberVoteStats> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN position = 'yea' THEN 1 ELSE 0 END) AS yea,
              SUM(CASE WHEN position = 'nay' THEN 1 ELSE 0 END) AS nay,
              SUM(CASE WHEN position = 'present' THEN 1 ELSE 0 END) AS present_,
              SUM(CASE WHEN position = 'not_voting' THEN 1 ELSE 0 END) AS not_voting
            FROM member_votes
            WHERE bioguide_id = ?`,
      args: [bioguideId],
    });
    const r = rs.rows[0];
    return {
      total: Number(r?.total ?? 0),
      yea: Number(r?.yea ?? 0),
      nay: Number(r?.nay ?? 0),
      present: Number(r?.present_ ?? 0),
      notVoting: Number(r?.not_voting ?? 0),
    };
  },
  ["getMemberVoteStats"],
  { revalidate: 3600, tags: ["votes"] },
);

// ---------------------------------------------------------------------------
// Cron runs (handoff 105)
//
// Durable record of every cron tick — see lib/cron-log.ts. Intentionally NOT
// unstable_cache-wrapped: the whole point is reading fresh run state, and a
// cached layer would defeat that. Reads are infrequent (manual inspection /
// a future admin surface), so the un-cached cost is irrelevant.
// ---------------------------------------------------------------------------

export interface CronRun {
  id: number;
  route: string;
  started_at: string;
  ended_at: string | null;
  elapsed_ms: number | null;
  status: CronRunStatus;
  payload: unknown;
  error_message: string | null;
}

// A row stuck at 'running' past this window is treated as a timeout — the
// Vercel runtime killed the function before finishCronRun could fire. HO 139
// added an inline reaper at the top of every wrapped route that writes
// 'orphaned' to the DB at the same 5-minute threshold; this display-only
// fallback remains as a backstop for the gap between a SIGKILL and the next
// tick's reaper sweep. Matches REAPER_THRESHOLD_MS in lib/cron-log.ts.
const CRON_TIMEOUT_MS = 5 * 60_000;

function rowToCronRun(row: Record<string, unknown>): CronRun {
  let payload: unknown = null;
  const rawPayload = row.payload;
  if (typeof rawPayload === "string") {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      payload = rawPayload; // keep the raw string if it isn't valid JSON
    }
  }

  let status = row.status as CronRunStatus;
  if (status === "running") {
    const startedMs = Date.parse(row.started_at as string);
    if (Number.isFinite(startedMs) && Date.now() - startedMs > CRON_TIMEOUT_MS) {
      status = "orphaned";
    }
  }

  return {
    id: Number(row.id),
    route: row.route as string,
    started_at: row.started_at as string,
    ended_at: (row.ended_at as string | null) ?? null,
    elapsed_ms: row.elapsed_ms == null ? null : Number(row.elapsed_ms),
    status,
    payload,
    error_message: (row.error_message as string | null) ?? null,
  };
}

/** Most recent cron runs across all routes, newest first. */
export async function getRecentCronRuns(limit = 50): Promise<CronRun[]> {
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT id, route, started_at, ended_at, elapsed_ms, status,
            payload, error_message
          FROM cron_runs
          ORDER BY started_at DESC, id DESC
          LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((r) => rowToCronRun(r as Record<string, unknown>));
}

// HO 143: committee surface (data layer). Four helpers — full list,
// per-committee bills, per-committee members, and the "most active recently"
// activity cut. All cache under tag `committees` so the sync route's
// revalidateTag('committees') flushes them together. Cardinality is small
// (~237 committees, ~5K members, ~16K-50K committee_bills rows when fully
// backfilled), so no pagination on the helpers — UI handles slicing.
export type Committee = {
  systemCode: string;
  name: string;
  chamber: "house" | "senate" | "joint";
  committeeType: string | null;
  parentSystemCode: string | null;
  url: string | null;
  isCurrent: boolean;
};

export type CommitteeMember = {
  bioguideId: string;
  role: string | null;
  partySide: "majority" | "minority" | null;
  rank: number | null;
  // Joined from members at read time so consumers don't have to roundtrip.
  // Null when the member YAML carries a bioguide we don't have a row for yet.
  name: string | null;
  party: PartyKey | null;
  state: string | null;
};

export type CommitteeActivity = {
  systemCode: string;
  name: string;
  chamber: "house" | "senate" | "joint";
  recentBillCount: number;
};

export const getCommittees = unstable_cache(
  async (filters?: { chamber?: string }): Promise<Committee[]> => {
    const db = getDb();
    const chamber = filters?.chamber;
    const rs = chamber
      ? await db.execute({
          sql: `SELECT system_code, name, chamber, committee_type,
                  parent_system_code, url, is_current
                FROM committees
                WHERE chamber = ? AND is_current = 1
                ORDER BY parent_system_code IS NULL DESC, name`,
          args: [chamber],
        })
      : await db.execute(`
          SELECT system_code, name, chamber, committee_type,
            parent_system_code, url, is_current
          FROM committees
          WHERE is_current = 1
          ORDER BY chamber, parent_system_code IS NULL DESC, name`);
    return rs.rows.map((r) => ({
      systemCode: r.system_code as string,
      name: r.name as string,
      chamber: r.chamber as "house" | "senate" | "joint",
      committeeType: (r.committee_type as string | null) ?? null,
      parentSystemCode: (r.parent_system_code as string | null) ?? null,
      url: (r.url as string | null) ?? null,
      isCurrent: Number(r.is_current) === 1,
    }));
  },
  ["committees-list"],
  { tags: ["committees"], revalidate: 3600 },
);

// HO 144: each row carries the per-committee activity context (the latest
// `committee_bills` row for that pair) so the detail page can render
// "Referred to · 3d ago" alongside the BillRow, distinct from the global
// `latest_action_*` fields the row already shows for the bill as a whole.
export type CommitteeBillRow = {
  bill: FeedBill;
  activityType: string | null;
  activityDate: string | null;
};

export const getCommitteeBills = unstable_cache(
  async (
    systemCode: string,
    limit = 50,
    sinceDays?: number,
  ): Promise<CommitteeBillRow[]> => {
    const db = getDb();
    // Most recent activity per (bill, committee) — DISTINCT bill_id keyed by
    // MAX(activity_date) so a bill referred and later reported shows once.
    // The outer JOIN back to committee_bills picks the matching activity_type
    // for that latest row so the caller gets the verb alongside the date.
    const sinceClause = sinceDays
      ? `AND activity_date >= datetime('now', '-${sinceDays} days')`
      : "";
    const rs = await db.execute({
      sql: `WITH cb AS (
              SELECT bill_id, MAX(activity_date) AS latest_activity
              FROM committee_bills
              WHERE committee_system_code = ?
                ${sinceClause}
              GROUP BY bill_id
            )
            SELECT bills.id, bills.congress, bills.bill_type, bills.bill_number,
                   bills.title, bills.sponsor_name, bills.sponsor_party,
                   bills.sponsor_state, bills.introduced_date,
                   bills.latest_action_date, bills.latest_action_text,
                   bills.update_date, bills.summary, bills.topics, bills.stage,
                   bills.previous_stage, bills.stage_changed_at,
                   cb.latest_activity AS activity_date,
                   (SELECT activity_type FROM committee_bills cb2
                    WHERE cb2.committee_system_code = ?
                      AND cb2.bill_id = cb.bill_id
                      AND cb2.activity_date = cb.latest_activity
                    LIMIT 1) AS activity_type,
                   ${MENTION_SELECT}
            FROM cb
            JOIN bills ON bills.id = cb.bill_id
            ${MENTION_SUBQUERY}
            ORDER BY cb.latest_activity DESC NULLS LAST, bills.update_date DESC
            LIMIT ?`,
      args: [systemCode, systemCode, limit],
    });
    return rs.rows.map((r) => ({
      bill: {
        id: r.id as string,
        congress: r.congress as number,
        bill_type: r.bill_type as string,
        bill_number: r.bill_number as number,
        title: r.title as string,
        sponsor_name: (r.sponsor_name as string | null) ?? null,
        sponsor_party: (r.sponsor_party as string | null) ?? null,
        sponsor_state: (r.sponsor_state as string | null) ?? null,
        introduced_date: (r.introduced_date as string | null) ?? null,
        latest_action_date: (r.latest_action_date as string | null) ?? null,
        latest_action_text: (r.latest_action_text as string | null) ?? null,
        update_date: r.update_date as string,
        summary: (r.summary as string | null) ?? null,
        topics: (r.topics as string | null) ?? null,
        stage: (r.stage as string | null) ?? null,
        previous_stage: (r.previous_stage as string | null) ?? null,
        stage_changed_at: (r.stage_changed_at as string | null) ?? null,
        mentionCount7d: Number(r.mention_count_7d ?? 0),
      },
      activityType: (r.activity_type as string | null) ?? null,
      activityDate: (r.activity_date as string | null) ?? null,
    }));
  },
  ["committee-bills"],
  { tags: ["committees"], revalidate: 3600 },
);

// HO 263: committee meetings (hearings) read layer. Each meeting carries its
// associated bills (from meeting_bills → bills) for chips. Cached, tag `meetings`
// (the 12th tag; /api/cron/committees revalidates it after the meetings step).
export type CommitteeMeeting = {
  eventId: string;
  chamber: "house" | "senate";
  meetingDate: string;
  meetingType: string;
  meetingStatus: string;
  title: string;
  building: string | null;
  room: string | null;
  videoUrl: string | null;
  committeeSystemCode: string | null;
  bills: FeedBill[]; // from meeting_bills join; may be empty (sparse by nature)
};

const MEETING_COL_LIST = [
  "event_id",
  "chamber",
  "meeting_date",
  "meeting_type",
  "meeting_status",
  "title",
  "location_building",
  "location_room",
  "video_url",
  "committee_system_code",
];
const MEETING_COLS = MEETING_COL_LIST.join(", ");
const MEETING_COLS_M = MEETING_COL_LIST.map((c) => `m.${c}`).join(", ");

function rowToMeetingBase(
  r: Record<string, unknown>,
): Omit<CommitteeMeeting, "bills"> {
  return {
    eventId: r.event_id as string,
    chamber: (r.chamber as string) === "senate" ? "senate" : "house",
    meetingDate: (r.meeting_date as string | null) ?? "",
    meetingType: (r.meeting_type as string | null) ?? "",
    meetingStatus: (r.meeting_status as string | null) ?? "",
    title: (r.title as string | null) ?? "",
    building: (r.location_building as string | null) ?? null,
    room: (r.location_room as string | null) ?? null,
    videoUrl: (r.video_url as string | null) ?? null,
    committeeSystemCode: (r.committee_system_code as string | null) ?? null,
  };
}

// Attach each meeting's associated bills with ONE extra query (the join is in
// SQL; only the group-into-arrays step is JS — not an N+1 per meeting). A
// meeting_bills row pointing at a not-yet-synced bill drops out of the INNER
// JOIN (no chip), which is the honest degrade.
async function attachMeetingBills(
  bases: Omit<CommitteeMeeting, "bills">[],
): Promise<CommitteeMeeting[]> {
  if (bases.length === 0) return [];
  const db = getDb();
  const ids = bases.map((b) => b.eventId);
  const placeholders = ids.map(() => "?").join(",");
  const rs = await db.execute({
    sql: `SELECT mb.event_id,
                 bills.id, bills.congress, bills.bill_type, bills.bill_number,
                 bills.title, bills.sponsor_name, bills.sponsor_party,
                 bills.sponsor_state, bills.introduced_date,
                 bills.latest_action_date, bills.latest_action_text,
                 bills.update_date, bills.summary, bills.topics, bills.stage,
                 bills.previous_stage, bills.stage_changed_at,
                 ${MENTION_SELECT}
          FROM meeting_bills mb
          JOIN bills ON bills.id = mb.bill_id
          ${MENTION_SUBQUERY}
          WHERE mb.event_id IN (${placeholders})
          ORDER BY bills.latest_action_date DESC`,
    args: ids,
  });
  const byEvent = new Map<string, FeedBill[]>();
  for (const r of rs.rows) {
    const ev = r.event_id as string;
    const arr = byEvent.get(ev) ?? [];
    arr.push(rowToFeedBill(r as Record<string, unknown>));
    byEvent.set(ev, arr);
  }
  return bases.map((b) => ({ ...b, bills: byEvent.get(b.eventId) ?? [] }));
}

// Calendar spine: meetings dated from now forward (this/next week — the source
// only runs ~2 weeks ahead, HO 261), nearest first.
export const getUpcomingMeetings = unstable_cache(
  async (opts?: {
    days?: number;
    chamber?: string;
    type?: string;
  }): Promise<CommitteeMeeting[]> => {
    const db = getDb();
    const where = ["meeting_date IS NOT NULL", "meeting_date >= ?"];
    const args: (string | number)[] = [new Date().toISOString()];
    if (opts?.days) {
      where.push("meeting_date <= ?");
      args.push(new Date(Date.now() + opts.days * 86_400_000).toISOString());
    }
    if (opts?.chamber) {
      where.push("chamber = ?");
      args.push(opts.chamber);
    }
    if (opts?.type) {
      where.push("meeting_type = ?");
      args.push(opts.type);
    }
    const rs = await db.execute({
      sql: `SELECT ${MEETING_COLS} FROM committee_meetings
            WHERE ${where.join(" AND ")}
            ORDER BY meeting_date ASC`,
      args,
    });
    return attachMeetingBills(rs.rows.map(rowToMeetingBase));
  },
  ["getUpcomingMeetings"],
  { tags: ["meetings"], revalidate: 3600 },
);

// Record of recently-held meetings: meeting_date in [now - days, now), newest first.
export const getRecentMeetings = unstable_cache(
  async (days = 7): Promise<CommitteeMeeting[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT ${MEETING_COLS} FROM committee_meetings
            WHERE meeting_date IS NOT NULL
              AND meeting_date < ?
              AND meeting_date >= ?
            ORDER BY meeting_date DESC`,
      args: [
        new Date().toISOString(),
        new Date(Date.now() - days * 86_400_000).toISOString(),
      ],
    });
    return attachMeetingBills(rs.rows.map(rowToMeetingBase));
  },
  ["getRecentMeetings"],
  { tags: ["meetings"], revalidate: 3600 },
);

// Committee-detail "what's this committee doing" cut (HO 143 precedent). upcomingOnly
// → only future meetings, nearest first; otherwise all of the committee's
// meetings, newest first.
export const getMeetingsByCommittee = unstable_cache(
  async (
    systemCode: string,
    opts?: { upcomingOnly?: boolean },
  ): Promise<CommitteeMeeting[]> => {
    const db = getDb();
    const where = ["committee_system_code = ?", "meeting_date IS NOT NULL"];
    const args: string[] = [systemCode];
    if (opts?.upcomingOnly) {
      where.push("meeting_date >= ?");
      args.push(new Date().toISOString());
    }
    const order = opts?.upcomingOnly ? "ASC" : "DESC";
    const rs = await db.execute({
      sql: `SELECT ${MEETING_COLS} FROM committee_meetings
            WHERE ${where.join(" AND ")}
            ORDER BY meeting_date ${order}`,
      args,
    });
    return attachMeetingBills(rs.rows.map(rowToMeetingBase));
  },
  ["getMeetingsByCommittee"],
  { tags: ["meetings"], revalidate: 3600 },
);

// Reverse lookup for the bill hub: which meetings cover this bill (newest first).
export const getMeetingsForBill = unstable_cache(
  async (billId: string): Promise<CommitteeMeeting[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT ${MEETING_COLS_M}
            FROM committee_meetings m
            JOIN meeting_bills mb ON mb.event_id = m.event_id
            WHERE mb.bill_id = ?
            ORDER BY m.meeting_date DESC NULLS LAST`,
      args: [billId],
    });
    return attachMeetingBills(rs.rows.map(rowToMeetingBase));
  },
  ["getMeetingsForBill"],
  { tags: ["meetings"], revalidate: 3600 },
);

// HO 146: chart helpers for /committee/[systemCode]. Both aggregate in SQL
// against the same indices `getCommitteeBills` rides on; no per-row fan-out.
export type CommitteeActivityBucket =
  | "Referred"
  | "Markup"
  | "Reported"
  | "Other";

export type CommitteeActivityPeriodRow = {
  month: string; // 'YYYY-MM'
  bucket: CommitteeActivityBucket;
  count: number;
};

// Raw `committee_bills.activity_type` collapse for chart stacking. Phase 1
// (HO 146) found 10 distinct raw values, dominated by "Referred To" (~86%).
// Mapping (after LOWER() normalization to fix the "Discharged From" vs
// "Discharged from" case-dup found in Phase 1):
//   referred to                              → Referred
//   markup by                                → Markup
//   reported by, reported original measure   → Reported
//   discharged from, hearings by (full ...), → Other
//   unknown, bills of interest - …, null
const ACTIVITY_TYPE_BUCKET_SQL = `
  CASE LOWER(activity_type)
    WHEN 'referred to' THEN 'Referred'
    WHEN 'markup by' THEN 'Markup'
    WHEN 'reported by' THEN 'Reported'
    WHEN 'reported original measure' THEN 'Reported'
    ELSE 'Other'
  END`;

// Monthly-bucketed activity counts for the committee, stacked by collapsed
// activity_type. Scoped to the 119th Congress to match BillsTimeSeries'
// "current Congress" convention; rolls over with the corpus.
export const getCommitteeActivityByPeriod = unstable_cache(
  async (systemCode: string): Promise<CommitteeActivityPeriodRow[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT substr(cb.activity_date, 1, 7) AS month,
                   ${ACTIVITY_TYPE_BUCKET_SQL} AS bucket,
                   COUNT(*) AS n
            FROM committee_bills cb
            JOIN bills b ON b.id = cb.bill_id
            WHERE cb.committee_system_code = ?
              AND cb.activity_date IS NOT NULL
              AND b.congress = (SELECT MAX(congress) FROM bills)
            GROUP BY month, bucket
            ORDER BY month, bucket`,
      args: [systemCode],
    });
    return rs.rows.map((r) => ({
      month: r.month as string,
      bucket: r.bucket as CommitteeActivityBucket,
      count: Number(r.n ?? 0),
    }));
  },
  ["committee-activity-by-period"],
  { tags: ["committees"], revalidate: 3600 },
);

export type CommitteeTopicMixRow = { topic: Topic; count: number };

// Topic distribution for one committee. JOIN committee_bills → bills, exclude
// ceremonial, json_each fanout on bills.topics, COUNT(DISTINCT bill_id) so a
// referred-then-reported bill counts once. Corpus-wide (no congress filter),
// matching getTopicMixByChamber's convention — the committee's whole topic
// footprint, not just this session.
export const getCommitteeTopicMix = unstable_cache(
  async (systemCode: string): Promise<CommitteeTopicMixRow[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT je.value AS topic,
                   COUNT(DISTINCT cb.bill_id) AS n
            FROM committee_bills cb
            JOIN bills b ON b.id = cb.bill_id, json_each(b.topics) je
            WHERE cb.committee_system_code = ?
              AND b.topics IS NOT NULL
              AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
            GROUP BY je.value
            ORDER BY n DESC`,
      args: [systemCode],
    });
    const result: CommitteeTopicMixRow[] = [];
    for (const r of rs.rows) {
      const topic = r.topic as string;
      if (!ALLOWED_TOPICS_SET.has(topic)) {
        console.warn(
          `[getCommitteeTopicMix] skipping unknown topic: ${topic}`,
        );
        continue;
      }
      result.push({ topic: topic as Topic, count: Number(r.n ?? 0) });
    }
    return result;
  },
  ["committee-topic-mix"],
  { tags: ["committees"], revalidate: 3600 },
);

export const getCommitteeMembers = unstable_cache(
  async (systemCode: string): Promise<CommitteeMember[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT cm.bioguide_id, cm.role, cm.party_side, cm.rank,
                   m.name, m.party, m.state
            FROM committee_members cm
            LEFT JOIN members m ON m.bioguide_id = cm.bioguide_id
            WHERE cm.committee_system_code = ?
            ORDER BY cm.party_side, cm.rank ASC NULLS LAST`,
      args: [systemCode],
    });
    return rs.rows.map((r) => ({
      bioguideId: r.bioguide_id as string,
      role: (r.role as string | null) ?? null,
      partySide: (r.party_side as "majority" | "minority" | null) ?? null,
      rank: (r.rank as number | null) ?? null,
      name: (r.name as string | null) ?? null,
      party: (r.party as PartyKey | null) ?? null,
      state: (r.state as string | null) ?? null,
    }));
  },
  ["committee-members"],
  { tags: ["committees"], revalidate: 3600 },
);

// "Most active recently" — committees ranked by distinct bills with at least
// one committee_bills.activity_date in the last N days. Subcommittees roll
// up to their parent; the dashboard's framing question is committee-level.
export const getCommitteeActivity = unstable_cache(
  async (days = 30): Promise<CommitteeActivity[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT
              COALESCE(c.parent_system_code, c.system_code) AS roll_up_code,
              MAX(parent.name) AS roll_up_name,
              MAX(parent.chamber) AS roll_up_chamber,
              COUNT(DISTINCT cb.bill_id) AS n
            FROM committee_bills cb
            JOIN committees c ON c.system_code = cb.committee_system_code
            LEFT JOIN committees parent
              ON parent.system_code = COALESCE(c.parent_system_code, c.system_code)
            WHERE cb.activity_date >= datetime('now', ?)
            GROUP BY roll_up_code
            HAVING n > 0
            ORDER BY n DESC, roll_up_name`,
      args: [`-${days} days`],
    });
    return rs.rows.map((r) => ({
      systemCode: r.roll_up_code as string,
      name: r.roll_up_name as string,
      chamber: r.roll_up_chamber as "house" | "senate" | "joint",
      recentBillCount: Number(r.n),
    }));
  },
  ["committee-activity"],
  { tags: ["committees"], revalidate: 3600 },
);

// HO 144: committee index helpers. The index page wants per-committee
// aggregates (member count + recent-30d bill count) so it can sort by
// activity/name/members without N+1 queries. Subcommittees show as their
// own rows alongside top-level committees — the index is intentionally a
// flat list (see HO 144 "Subcommittees in the index" note).
export type CommitteeIndexRow = {
  systemCode: string;
  name: string;
  chamber: "house" | "senate" | "joint";
  committeeType: string | null;
  parentSystemCode: string | null;
  url: string | null;
  memberCount: number;
  recentBillCount: number; // distinct bills with activity in the last 30 days
};

export const COMMITTEE_INDEX_SORTS = ["activity", "name", "members"] as const;
export type CommitteeIndexSort = (typeof COMMITTEE_INDEX_SORTS)[number];
const COMMITTEE_INDEX_SORTS_SET = new Set<string>(COMMITTEE_INDEX_SORTS);

export const COMMITTEE_CHAMBERS = ["house", "senate", "joint"] as const;
export type CommitteeChamber = (typeof COMMITTEE_CHAMBERS)[number];
const COMMITTEE_CHAMBERS_SET = new Set<string>(COMMITTEE_CHAMBERS);

export function sanitizeCommitteeSort(
  raw: string | null | undefined,
): CommitteeIndexSort {
  if (raw && COMMITTEE_INDEX_SORTS_SET.has(raw))
    return raw as CommitteeIndexSort;
  return "activity";
}

export function sanitizeCommitteeChamber(
  raw: string | null | undefined,
): CommitteeChamber | undefined {
  if (raw && COMMITTEE_CHAMBERS_SET.has(raw)) return raw as CommitteeChamber;
  return undefined;
}

export const getCommitteesIndex = unstable_cache(
  async (filters?: {
    chamber?: CommitteeChamber;
    sort?: CommitteeIndexSort;
  }): Promise<CommitteeIndexRow[]> => {
    const db = getDb();
    const sort = filters?.sort ?? "activity";
    const orderBy =
      sort === "name"
        ? "c.name ASC"
        : sort === "members"
          ? "member_count DESC, c.name ASC"
          : "recent_count DESC, c.name ASC";
    const chamberClause = filters?.chamber ? "AND c.chamber = ?" : "";
    const args: (string | number)[] = filters?.chamber
      ? [filters.chamber]
      : [];
    const rs = await db.execute({
      sql: `SELECT
              c.system_code, c.name, c.chamber, c.committee_type,
              c.parent_system_code, c.url,
              COALESCE(cm.member_count, 0) AS member_count,
              COALESCE(cb.recent_count, 0) AS recent_count
            FROM committees c
            LEFT JOIN (
              SELECT committee_system_code, COUNT(*) AS member_count
              FROM committee_members
              GROUP BY committee_system_code
            ) cm ON cm.committee_system_code = c.system_code
            LEFT JOIN (
              SELECT committee_system_code,
                     COUNT(DISTINCT bill_id) AS recent_count
              FROM committee_bills
              WHERE activity_date >= datetime('now', '-30 days')
              GROUP BY committee_system_code
            ) cb ON cb.committee_system_code = c.system_code
            WHERE c.is_current = 1 ${chamberClause}
            ORDER BY ${orderBy}`,
      args,
    });
    return rs.rows.map((r) => ({
      systemCode: r.system_code as string,
      name: r.name as string,
      chamber: r.chamber as "house" | "senate" | "joint",
      committeeType: (r.committee_type as string | null) ?? null,
      parentSystemCode: (r.parent_system_code as string | null) ?? null,
      url: (r.url as string | null) ?? null,
      memberCount: Number(r.member_count ?? 0),
      recentBillCount: Number(r.recent_count ?? 0),
    }));
  },
  ["committees-index"],
  { tags: ["committees"], revalidate: 3600 },
);

export const getCommitteeBySystemCode = unstable_cache(
  async (systemCode: string): Promise<Committee | null> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT system_code, name, chamber, committee_type,
              parent_system_code, url, is_current
            FROM committees WHERE system_code = ? LIMIT 1`,
      args: [systemCode],
    });
    const r = rs.rows[0];
    if (!r) return null;
    return {
      systemCode: r.system_code as string,
      name: r.name as string,
      chamber: r.chamber as "house" | "senate" | "joint",
      committeeType: (r.committee_type as string | null) ?? null,
      parentSystemCode: (r.parent_system_code as string | null) ?? null,
      url: (r.url as string | null) ?? null,
      isCurrent: Number(r.is_current) === 1,
    };
  },
  ["committee-by-system-code"],
  { tags: ["committees"], revalidate: 3600 },
);

// HO 145: cross-link helpers. Both feed detail-page surfaces (member hub
// and bill detail). Cardinality is small — a member sits on at most a
// dozen committees, a bill ends up with a handful of referrals — so these
// are direct joins without aggregation.
export type MemberCommitteeRow = {
  systemCode: string;
  name: string;
  chamber: "house" | "senate" | "joint";
  committeeType: string | null;
  parentSystemCode: string | null;
  parentName: string | null;
  role: string | null;
  partySide: "majority" | "minority" | null;
  rank: number | null;
};

export const getMemberCommittees = unstable_cache(
  async (bioguideId: string): Promise<MemberCommitteeRow[]> => {
    const db = getDb();
    // Parents first (Standing → Select → Joint → Task Force → Other by name),
    // then subcommittees grouped by parent name then their own name. The
    // "↳ parent" caption on each subcommittee row carries the hierarchy at
    // render time, so a single sub block under a single sub-header reads
    // unambiguously.
    const rs = await db.execute({
      sql: `SELECT cm.role, cm.party_side, cm.rank,
                   c.system_code, c.name, c.chamber, c.committee_type,
                   c.parent_system_code,
                   p.name AS parent_name
            FROM committee_members cm
            JOIN committees c ON c.system_code = cm.committee_system_code
            LEFT JOIN committees p ON p.system_code = c.parent_system_code
            WHERE cm.bioguide_id = ? AND c.is_current = 1
            ORDER BY
              c.parent_system_code IS NOT NULL ASC,
              CASE c.committee_type
                WHEN 'Standing' THEN 1
                WHEN 'Select' THEN 2
                WHEN 'Joint' THEN 3
                WHEN 'Task Force' THEN 4
                ELSE 5
              END,
              COALESCE(p.name, '') ASC,
              c.name ASC`,
      args: [bioguideId],
    });
    return rs.rows.map((r) => ({
      systemCode: r.system_code as string,
      name: r.name as string,
      chamber: r.chamber as "house" | "senate" | "joint",
      committeeType: (r.committee_type as string | null) ?? null,
      parentSystemCode: (r.parent_system_code as string | null) ?? null,
      parentName: (r.parent_name as string | null) ?? null,
      role: (r.role as string | null) ?? null,
      partySide: (r.party_side as "majority" | "minority" | null) ?? null,
      rank: (r.rank as number | null) ?? null,
    }));
  },
  ["member-committees"],
  { tags: ["committees"], revalidate: 3600 },
);

export type BillCommitteeRow = {
  systemCode: string;
  name: string;
  chamber: "house" | "senate" | "joint";
  parentSystemCode: string | null;
  parentName: string | null;
  activityType: string;
  activityDate: string;
};

export const getBillCommittees = unstable_cache(
  async (billId: string): Promise<BillCommitteeRow[]> => {
    const db = getDb();
    // Don't dedupe — a "Referred to → Reported by" sequence on the same
    // committee carries two distinct informational rows; the activity verb
    // is what makes each one worth showing. NULL activity_date sorted last
    // so dateless rows don't masquerade as freshest.
    const rs = await db.execute({
      sql: `SELECT cb.activity_type, cb.activity_date,
                   c.system_code, c.name, c.chamber,
                   c.parent_system_code,
                   p.name AS parent_name
            FROM committee_bills cb
            JOIN committees c ON c.system_code = cb.committee_system_code
            LEFT JOIN committees p ON p.system_code = c.parent_system_code
            WHERE cb.bill_id = ?
            ORDER BY cb.activity_date DESC NULLS LAST, c.name ASC`,
      args: [billId],
    });
    return rs.rows
      .map((r) => {
        const activityDate = r.activity_date as string | null;
        const activityType = r.activity_type as string | null;
        if (!activityDate || !activityType) return null;
        return {
          systemCode: r.system_code as string,
          name: r.name as string,
          chamber: r.chamber as "house" | "senate" | "joint",
          parentSystemCode: (r.parent_system_code as string | null) ?? null,
          parentName: (r.parent_name as string | null) ?? null,
          activityType,
          activityDate,
        };
      })
      .filter((x): x is BillCommitteeRow => x !== null);
  },
  ["bill-committees"],
  { tags: ["committees"], revalidate: 3600 },
);

export const getCommitteeSubcommittees = unstable_cache(
  async (parentSystemCode: string): Promise<Committee[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT system_code, name, chamber, committee_type,
              parent_system_code, url, is_current
            FROM committees
            WHERE parent_system_code = ? AND is_current = 1
            ORDER BY name`,
      args: [parentSystemCode],
    });
    return rs.rows.map((r) => ({
      systemCode: r.system_code as string,
      name: r.name as string,
      chamber: r.chamber as "house" | "senate" | "joint",
      committeeType: (r.committee_type as string | null) ?? null,
      parentSystemCode: (r.parent_system_code as string | null) ?? null,
      url: (r.url as string | null) ?? null,
      isCurrent: Number(r.is_current) === 1,
    }));
  },
  ["committee-subcommittees"],
  { tags: ["committees"], revalidate: 3600 },
);

// HO 142: markets ticker. One MarketTick per internal symbol — most recent
// row, joined with the in-code label/format. Decoupling label/format from
// the DB keeps the upstream-source rewiring (Stooq → FRED for TNX etc.) a
// pure code change with no schema implication.
export type MarketTick = {
  symbol: string;
  label: string;
  fullName: string;
  price: number;
  changePct: number | null;
  tickedAt: string;
  marketDate: string;
  format: MarketFormat;
  group: MarketGroup;
  // HO 251: release cadence — drives the tape's per-symbol freshness model and
  // the hover wording (daily="as of", monthly="as of {Mon}", kalshi="resolves").
  cadence: MarketCadence;
  // HO 227: true for FRED-sourced EOD symbols (10Y/WTI). The tape labels these so
  // a stale close is never shown as a fresh intraday print. FMP indices = false.
  // HO 251: monthly FRED (CPI/UNEMP) and kalshi are NOT "EOD" — cadence carries
  // their framing instead, so eod is daily-FRED only.
  eod: boolean;
};

export const getLatestMarketTicks = unstable_cache(
  async (): Promise<MarketTick[]> => {
    const db = getDb();
    const rs = await db.execute(`
      SELECT m.symbol, m.price, m.change_pct, m.ticked_at, m.market_date
      FROM market_ticks m
      INNER JOIN (
        SELECT symbol, MAX(ticked_at) AS max_t
        FROM market_ticks
        GROUP BY symbol
      ) latest ON m.symbol = latest.symbol AND m.ticked_at = latest.max_t
      ORDER BY m.symbol`);
    const symbolMap = new Map(MARKET_SYMBOLS.map((s) => [s.internal, s]));
    const out: MarketTick[] = [];
    for (const row of rs.rows) {
      const internal = row.symbol as string;
      const meta = symbolMap.get(internal);
      if (!meta) continue; // unknown internal symbol — skip rather than crash
      out.push({
        symbol: internal,
        label: meta.label,
        fullName: meta.fullName,
        price: row.price as number,
        changePct: (row.change_pct as number | null) ?? null,
        tickedAt: row.ticked_at as string,
        marketDate: row.market_date as string,
        format: meta.format,
        group: meta.group,
        cadence: meta.cadence,
        eod: meta.source === "fred" && meta.cadence === "daily",
      });
    }
    // Preserve the in-code MARKET_SYMBOLS order so each tape renders in tape
    // order (HO 178: equities SPX,NDQ,DOW,ITA,XLK,XLV,XLF,XLE,XLI then
    // commodities WTI,GOLD,SILVER,NATGAS,DXY,TNX,VIX,BTC) regardless of DB row
    // order. MarketsTape partitions this list by `group` into the two tapes.
    const order = new Map(MARKET_SYMBOLS.map((s, i) => [s.internal, i]));
    out.sort((a, b) => (order.get(a.symbol) ?? 0) - (order.get(b.symbol) ?? 0));
    return out;
  },
  ["market-ticks-latest"],
  { tags: ["markets"], revalidate: 60 },
);

/** The latest run for a single route, or null if that route has never run. */
export async function getLatestCronRun(route: string): Promise<CronRun | null> {
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT id, route, started_at, ended_at, elapsed_ms, status,
            payload, error_message
          FROM cron_runs
          WHERE route = ?
          ORDER BY started_at DESC, id DESC
          LIMIT 1`,
    args: [route],
  });
  const r = rs.rows[0];
  return r ? rowToCronRun(r as Record<string, unknown>) : null;
}
