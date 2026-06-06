import { unstable_cache } from "next/cache";
import { CAUCUS_CONFIG, type CaucusOrg } from "./caucus-config";
import type { CronRunStatus } from "./cron-log";
import { CLUSTER_IDS, CLUSTER_PATTERNS } from "./cluster-patterns";
import { getDb } from "./db";
import {
  MARKET_SYMBOLS,
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

export type Sponsor = {
  sponsor_bioguide_id: string | null;
  sponsor_name: string;
  sponsor_party: string | null;
  sponsor_state: string | null;
  bill_count: number;
  latest_action_date: string | null;
};

export type SponsorFilters = {
  party?: PartyKey;
  state?: string;
  q?: string;
  chamber?: Chamber;
  includeCeremonial?: boolean;
};

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

function buildFeedWhere(filters: FeedFilters): {
  clauses: string[];
  args: (string | number)[];
} {
  // Intentional: feed hides un-summarized rows (they read as broken to users).
  // Header counts derive from this same WHERE, so the displayed total always
  // matches what the feed renders. Don't drop without picking a placeholder UX.
  const clauses: string[] = ["summary IS NOT NULL"];
  const args: (string | number)[] = [];

  if (filters.stage) {
    clauses.push("stage = ?");
    args.push(filters.stage);
  }

  if (filters.sponsor) {
    clauses.push("(sponsor_bioguide_id = ? OR sponsor_name = ?)");
    args.push(filters.sponsor, filters.sponsor);
  }

  if (filters.topics && filters.topics.length > 0) {
    const topicClauses = filters.topics.map(() => "topics LIKE ?");
    clauses.push(`(${topicClauses.join(" OR ")})`);
    for (const t of filters.topics) {
      args.push(`%"${t}"%`);
    }
  }

  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    const idLike = `%${normalizeBillIdQuery(q)}%`;
    clauses.push(
      `(LOWER(id) LIKE ? OR LOWER(title) LIKE ? OR LOWER(sponsor_name) LIKE ? OR LOWER(summary) LIKE ? OR REPLACE(LOWER(id), '-', '') LIKE ?)`,
    );
    args.push(like, like, like, like, idLike);
  }

  if (filters.chamber === "house") {
    clauses.push(`bill_type IN (${HOUSE_BILL_TYPES})`);
  } else if (filters.chamber === "senate") {
    clauses.push(`bill_type IN (${SENATE_BILL_TYPES})`);
  }

  // Cluster filter bypasses the ceremonial gate: most clusters are mostly
  // ceremonial, and opting into a cluster means asking to see all of it.
  if (filters.cluster) {
    clauses.push("cluster_id = ?");
    args.push(filters.cluster);
  } else if (!filters.includeCeremonial) {
    // Hide ceremonial bills by default. NULL (unclassified) treated as visible
    // so the dashboard doesn't go dark during backfill.
    clauses.push("(is_ceremonial = 0 OR is_ceremonial IS NULL)");
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
    const r = await db.execute({
      sql: `SELECT COUNT(*) AS total, MAX(update_date) AS last
            FROM bills WHERE ${clauses.join(" AND ")}`,
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

    const placeholders = FUNNEL_STAGES.map(() => "?").join(", ");
    const rs = await db.execute({
      sql: `SELECT stage, COUNT(*) AS count
            FROM bills
            WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
              AND stage IN (${placeholders})${topicClause}
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
      sql: `SELECT COUNT(*) AS n FROM bills
            WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
              AND (stage = 'other' OR stage IS NULL)${topicClause}`,
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
export const getCorpusStats = unstable_cache(
  async (): Promise<CorpusStats> => {
    const db = getDb();
    const rs = await db.execute(
      `SELECT COUNT(*) AS total, MAX(update_date) AS last_sync
       FROM bills
       WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)`,
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
  async (filters?: DashboardFilters): Promise<TopicCount[]> => {
    const db = getDb();
    const stage = filters?.stage;
    const stageClause = stage ? " AND bills.stage = ?" : "";
    const stageArgs = stage ? [stage] : [];
    const rs = await db.execute({
      sql: `SELECT je.value AS topic, COUNT(*) AS count
       FROM bills, json_each(bills.topics) je
       WHERE bills.topics IS NOT NULL
         AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)${stageClause}
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
      FROM bills, json_each(bills.topics) je
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

export type SponsorProductivityRow = {
  bioguideId: string | null;
  name: string;
  party: PartyKey | null;
  state: string | null;
  // HO 152: chamber comes from a LEFT JOIN on members so rows whose sponsor
  // doesn't resolve to a current member (rare unresolved bills) get null
  // and silently drop from both chamber scatters.
  chamber: Chamber | null;
  billCount: number;
  advancedCount: number;
  enactedCount: number;
  passRate: number; // 0-1
};

// Feeds the /members productivity scatter (handoff 67, split-by-chamber HO
// 152). Pass rate denominator excludes `stage IS NULL` (unsummarized) and
// `stage = 'other'` (off-path) so the chart only reflects bills with a real
// classifier verdict. Numerator counts anything past introduction.
// `enactedCount` lights up the per-dot tooltip's "K enacted" suffix.
// Sponsors with <3 bills are dropped — one-shot rates compress to 0 or 100
// and add no signal.
//
// Scoped to current Congress via MAX(congress) so this rolls over without
// touching code. Tag `bills` for unified cache invalidation.
export const getSponsorProductivity = unstable_cache(
  async (): Promise<SponsorProductivityRow[]> => {
    const db = getDb();
    // HO 199: group on the stable bioguide_id and source the display fields
    // (name/party/state/chamber) from the canonical `members` row, NOT the
    // denormalized bill columns. Grouping on `sponsor_name` split a member into
    // two rows when their bills carried two name spellings under one bioguide
    // (Begich: 27 "Nicholas J." + 7 "Nicholas"). `members.bioguide_id` is the
    // PK so m.* is single-valued per group; m.party is already the normalized
    // R/D/I. No null-bioguide bills exist, so grouping by bioguide drops
    // nothing (the WHERE now gates on bioguide instead of sponsor_name).
    const rs = await db.execute(`
      SELECT
        b.sponsor_bioguide_id AS bioguide_id,
        m.name AS name,
        m.party AS party_raw,
        m.state AS state,
        m.chamber AS chamber,
        COUNT(*) AS bill_count,
        SUM(CASE
          WHEN b.stage IN ('committee','floor','other_chamber','president','enacted')
          THEN 1 ELSE 0
        END) AS advanced_count,
        SUM(CASE WHEN b.stage = 'enacted' THEN 1 ELSE 0 END) AS enacted_count
      FROM bills b
      LEFT JOIN members m ON m.bioguide_id = b.sponsor_bioguide_id
      WHERE b.congress = (SELECT MAX(congress) FROM bills)
        AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
        AND b.stage IS NOT NULL
        AND b.stage != 'other'
        AND b.sponsor_bioguide_id IS NOT NULL
      GROUP BY b.sponsor_bioguide_id
      HAVING COUNT(*) >= 3
      ORDER BY bill_count DESC
    `);
    return rs.rows.map((r) => {
      const billCount = Number(r.bill_count ?? 0);
      const advancedCount = Number(r.advanced_count ?? 0);
      const enactedCount = Number(r.enacted_count ?? 0);
      const chamberRaw = r.chamber as string | null;
      return {
        bioguideId: (r.bioguide_id as string | null) ?? null,
        name: r.name as string,
        party: normalizePartyVariant(r.party_raw as string | null),
        state: (r.state as string | null) ?? null,
        chamber:
          chamberRaw === "house" || chamberRaw === "senate"
            ? (chamberRaw as Chamber)
            : null,
        billCount,
        advancedCount,
        enactedCount,
        passRate: billCount > 0 ? advancedCount / billCount : 0,
      };
    });
  },
  ["getSponsorProductivity"],
  { revalidate: 86400, tags: ["bills"] },
);

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
      FROM bills
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
    const h119 = await db.execute(
      `SELECT latest_action_date AS d FROM bills
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
export type ReportListItemWithLead = ReportListItem & { lead: string };

export const getReportsWithLead = unstable_cache(
  async (
    limit: number,
    offset: number,
  ): Promise<ReportListItemWithLead[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT slug, title, week_start, week_end, content_md
            FROM reports
            ORDER BY week_start DESC
            LIMIT ? OFFSET ?`,
      args: [limit, offset],
    });
    const { extractReportLead } = await import("./report-lead");
    return rs.rows.map((r) => ({
      slug: r.slug as string,
      title: r.title as string,
      weekStart: r.week_start as string,
      weekEnd: r.week_end as string,
      lead: extractReportLead(r.content_md as string),
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
      `SELECT slug, title, week_start, week_end, content_md
       FROM reports
       ORDER BY week_start DESC
       LIMIT 1`,
    );
    if (rs.rows.length === 0) return null;
    const { extractReportLead } = await import("./report-lead");
    const [head] = rs.rows;
    return {
      latest: {
        slug: head!.slug as string,
        title: head!.title as string,
        weekStart: head!.week_start as string,
        weekEnd: head!.week_end as string,
        lead: extractReportLead(head!.content_md as string),
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
  // HO 210 Pass 2: incumbent photo for the pinned map card (member-photo
  // pattern; onError → initials). 137/137 rated incumbents have one.
  incumbentDepictionUrl: string | null;
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
                   r.incumbent_bioguide_id,
                   m.name AS incumbent_name,
                   m.party AS incumbent_party,
                   m.depiction_url AS incumbent_depiction_url,
                   MAX(CASE WHEN rr.source = 'cook' THEN rr.rating END) AS cook_rating,
                   MAX(CASE WHEN rr.source = 'cook' THEN rr.rating_score END) AS cook_score,
                   MAX(CASE WHEN rr.source = 'sabato' THEN rr.rating END) AS sabato_rating,
                   MAX(CASE WHEN rr.source = 'sabato' THEN rr.rating_score END) AS sabato_score,
                   MAX(CASE WHEN rr.source = 'inside_elections' THEN rr.rating END) AS ie_rating,
                   MAX(CASE WHEN rr.source = 'inside_elections' THEN rr.rating_score END) AS ie_score
            FROM races r
            INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
            LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
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
        incumbentDepictionUrl:
          (row.incumbent_depiction_url as string | null) ?? null,
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
  // for getBreakingNews where the /news feed keeps the one-row-per-pair
  // shape.
  otherBills: string[];
};

// Backs the home-page banner and /news route. Cached with the `news-breaking`
// tag separately from `bills` because news ingest runs at the tail of the
// cron and we want a tight invalidation surface — `bills` flushes ten times
// per sync, `news-breaking` only when new mentions actually land. The
// 600s revalidate is a backstop; the explicit revalidateTag from /api/sync
// is what keeps this fresh in practice.
//
// INNER JOIN on bills lets the row render bill id + title + sponsor without
// a second query. Ceremonial bills excluded (NULL counts as visible during
// backfill, same convention as buildFeedWhere).
export const getBreakingNews = unstable_cache(
  async (
    windowHours: number,
    limit: number,
  ): Promise<NewsMention[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT m.id, m.bill_id, m.source, m.article_title, m.article_url,
              m.published_at,
              b.title AS bill_title,
              b.sponsor_name AS bill_sponsor_name,
              b.sponsor_party AS bill_sponsor_party
            FROM news_mentions m
            INNER JOIN bills b ON b.id = m.bill_id
            WHERE m.published_at >= datetime('now', '-' || ? || ' hours')
              AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
            ORDER BY m.published_at DESC, m.id DESC
            LIMIT ?`,
      args: [windowHours, limit],
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
  ["getBreakingNews"],
  { revalidate: 600, tags: ["news-breaking"] },
);

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
              FROM news_mentions m
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
            FROM news_mentions m
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

    // Count uses the same dedup-by-article-key shape so the page-count
    // matches the visible rows when an article gets matched to several
    // bills (HO 133's distinct-article counting convention).
    const countSql = `SELECT COUNT(DISTINCT COALESCE(
        m.article_url,
        m.article_title || '|' || m.source || '|' || m.published_at
      )) AS n
      FROM news_mentions m
      INNER JOIN bills b ON b.id = m.bill_id
      WHERE ${baseWhere} ${whereExtra}`;
    const countRs = await db.execute({
      sql: countSql,
      args: [...baseArgs, ...filterArgs],
    });
    const total = Number(countRs.rows[0]?.n ?? 0);
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
        FROM news_mentions m
        INNER JOIN bills b ON b.id = m.bill_id
        WHERE ${baseWhere} ${whereExtra}
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
      };
    });

    return {
      mentions,
      total,
      page: clampedPage,
      pageSize,
      totalPages,
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
    const { clauses, args } = buildFeedWhere(filters);
    const where = clauses.join(" AND ");

    const countRs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM bills WHERE ${where}`,
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
      FROM bills
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
  { revalidate: 3600, tags: ["bills", "news-breaking"] },
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
      ${MENTION_SELECT}
      FROM bills
      ${MENTION_SUBQUERY}
      WHERE ${clauses.join(" AND ")}
      ORDER BY latest_action_date ASC
      LIMIT ?`;

    const rs = await db.execute({ sql, args });
    return rs.rows.map(rowToFeedBill);
  },
  ["getStaleBills"],
  { revalidate: 3600, tags: ["bills", "news-breaking"] },
);

function buildSponsorWhere(filters: SponsorFilters): {
  clauses: string[];
  args: (string | number)[];
} {
  const clauses: string[] = [
    "summary IS NOT NULL",
    "sponsor_name IS NOT NULL",
  ];
  const args: (string | number)[] = [];

  if (filters.party === "R" || filters.party === "D") {
    clauses.push("UPPER(sponsor_party) = ?");
    args.push(filters.party);
  } else if (filters.party === "I") {
    clauses.push("UPPER(sponsor_party) NOT IN ('R', 'D')");
    clauses.push("sponsor_party IS NOT NULL");
  }

  if (filters.state) {
    clauses.push("sponsor_state = ?");
    args.push(filters.state.toUpperCase());
  }

  const q = filters.q?.trim();
  if (q) {
    clauses.push("LOWER(sponsor_name) LIKE ?");
    args.push(`%${q.toLowerCase()}%`);
  }

  if (filters.chamber === "house") {
    clauses.push(`bill_type IN (${HOUSE_BILL_TYPES})`);
  } else if (filters.chamber === "senate") {
    clauses.push(`bill_type IN (${SENATE_BILL_TYPES})`);
  }

  // Sponsor rankings should reflect substantive work by default. Unclassified
  // rows (NULL) stay visible so the page doesn't go dark during backfill.
  if (!filters.includeCeremonial) {
    clauses.push("(is_ceremonial = 0 OR is_ceremonial IS NULL)");
  }

  return { clauses, args };
}

export async function getSponsors(
  filters: SponsorFilters,
  limit = 600,
): Promise<Sponsor[]> {
  const db = getDb();
  const { clauses, args } = buildSponsorWhere(filters);
  args.push(limit);

  const sql = `SELECT
      COALESCE(sponsor_bioguide_id, sponsor_name) AS group_key,
      MAX(sponsor_bioguide_id) AS sponsor_bioguide_id,
      MAX(sponsor_name) AS sponsor_name,
      MAX(sponsor_party) AS sponsor_party,
      MAX(sponsor_state) AS sponsor_state,
      COUNT(*) AS bill_count,
      MAX(latest_action_date) AS latest_action_date
    FROM bills
    WHERE ${clauses.join(" AND ")}
    GROUP BY group_key
    ORDER BY bill_count DESC, sponsor_name ASC
    LIMIT ?`;

  const rs = await db.execute({ sql, args });
  return rs.rows.map((r) => ({
    sponsor_bioguide_id: (r.sponsor_bioguide_id as string | null) ?? null,
    sponsor_name: r.sponsor_name as string,
    sponsor_party: (r.sponsor_party as string | null) ?? null,
    sponsor_state: (r.sponsor_state as string | null) ?? null,
    bill_count: Number(r.bill_count ?? 0),
    latest_action_date: (r.latest_action_date as string | null) ?? null,
  }));
}

export async function getSponsorCount(
  filters: SponsorFilters,
): Promise<FeedCount> {
  const db = getDb();
  const { clauses: filteredClauses, args: filteredArgs } =
    buildSponsorWhere(filters);
  const { clauses: totalClauses, args: totalArgs } = buildSponsorWhere({});

  const totalSql = `SELECT COUNT(*) AS n FROM (
    SELECT 1 FROM bills WHERE ${totalClauses.join(" AND ")}
    GROUP BY COALESCE(sponsor_bioguide_id, sponsor_name)
  )`;
  const filteredSql = `SELECT COUNT(*) AS n FROM (
    SELECT 1 FROM bills WHERE ${filteredClauses.join(" AND ")}
    GROUP BY COALESCE(sponsor_bioguide_id, sponsor_name)
  )`;

  const totalRs = await db.execute({ sql: totalSql, args: totalArgs });
  const filteredRs = await db.execute({ sql: filteredSql, args: filteredArgs });
  return {
    total: Number(totalRs.rows[0]?.n ?? 0),
    filtered: Number(filteredRs.rows[0]?.n ?? 0),
  };
}

export const SPONSOR_SORTS = ["volume", "passrate"] as const;
export type SponsorSort = (typeof SPONSOR_SORTS)[number];
const SPONSOR_SORTS_SET = new Set<string>(SPONSOR_SORTS);

export function sanitizeSponsorSort(
  raw: string | null | undefined,
): SponsorSort {
  if (raw && SPONSOR_SORTS_SET.has(raw)) return raw as SponsorSort;
  return "volume";
}

export type SponsorRanking = {
  sponsor_bioguide_id: string | null;
  sponsor_name: string;
  sponsor_party: string | null;
  sponsor_state: string | null;
  total: number;
  enacted: number;
  passrate: number;
};

// HO 124: page-shape replacement for the sponsor-only roster. Driven from
// members LEFT JOIN bills_agg, so all 536 current members surface — including
// the handful (Pelosi, Hoyer, special-election arrivals like Armstrong /
// Mejia) who haven't sponsored anything yet. `passrate` is intentionally
// NULL when total=0 so the UI can render an em-dash instead of "0%", which
// reads as a real 0-of-N pass rate; existing SponsorRanking keeps the
// number-only shape because its rows have at least one bill by construction.
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
    FROM bills
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
  { revalidate: 3600, tags: ["members", "bills"] },
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
  { revalidate: 3600, tags: ["members", "bills"] },
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

export const getSponsorsRanked = unstable_cache(
  async (
    filters: SponsorFilters,
    sort: SponsorSort = "volume",
    limit = 100,
  ): Promise<SponsorRanking[]> => {
    const db = getDb();
    const { clauses, args } = buildSponsorWhere(filters);
    const sql = `SELECT
        COALESCE(sponsor_bioguide_id, sponsor_name) AS group_key,
        MAX(sponsor_bioguide_id) AS sponsor_bioguide_id,
        MAX(sponsor_name) AS sponsor_name,
        MAX(sponsor_party) AS sponsor_party,
        MAX(sponsor_state) AS sponsor_state,
        COUNT(*) AS total,
        SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
        CAST(SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS REAL)
          / COUNT(*) AS passrate
      FROM bills
      WHERE ${clauses.join(" AND ")}
      GROUP BY group_key
      ORDER BY
        CASE WHEN ? = 'passrate' THEN passrate END DESC,
        CASE WHEN ? = 'passrate' THEN total END DESC,
        CASE WHEN ? = 'volume' THEN total END DESC,
        sponsor_name ASC
      LIMIT ?`;
    const rs = await db.execute({
      sql,
      args: [...args, sort, sort, sort, limit],
    });
    return rs.rows.map((r) => ({
      sponsor_bioguide_id: (r.sponsor_bioguide_id as string | null) ?? null,
      sponsor_name: r.sponsor_name as string,
      sponsor_party: (r.sponsor_party as string | null) ?? null,
      sponsor_state: (r.sponsor_state as string | null) ?? null,
      total: Number(r.total ?? 0),
      enacted: Number(r.enacted ?? 0),
      passrate: Number(r.passrate ?? 0),
    }));
  },
  ["getSponsorsRanked"],
  { revalidate: 3600, tags: ["bills"] },
);

export type SponsorPassRate = {
  sponsor_bioguide_id: string | null;
  sponsor_name: string;
  sponsor_party: string | null;
  sponsor_state: string | null;
  total: number;
  enacted: number;
};

export async function getSponsorPassRates(
  filters: SponsorFilters,
  minTotal = 5,
  limit = 100,
): Promise<SponsorPassRate[]> {
  const db = getDb();
  const { clauses, args } = buildSponsorWhere(filters);
  const sql = `SELECT
      COALESCE(sponsor_bioguide_id, sponsor_name) AS group_key,
      MAX(sponsor_bioguide_id) AS sponsor_bioguide_id,
      MAX(sponsor_name) AS sponsor_name,
      MAX(sponsor_party) AS sponsor_party,
      MAX(sponsor_state) AS sponsor_state,
      COUNT(*) AS total,
      SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted
    FROM bills
    WHERE ${clauses.join(" AND ")}
    GROUP BY group_key
    HAVING total >= ?
    ORDER BY (CAST(enacted AS REAL) / total) DESC, total DESC
    LIMIT ?`;
  const rs = await db.execute({ sql, args: [...args, minTotal, limit] });
  return rs.rows.map((r) => ({
    sponsor_bioguide_id: (r.sponsor_bioguide_id as string | null) ?? null,
    sponsor_name: r.sponsor_name as string,
    sponsor_party: (r.sponsor_party as string | null) ?? null,
    sponsor_state: (r.sponsor_state as string | null) ?? null,
    total: Number(r.total ?? 0),
    enacted: Number(r.enacted ?? 0),
  }));
}

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
    const sql = `SELECT id, congress, bill_type, bill_number, title,
      sponsor_name, sponsor_party, sponsor_state, introduced_date,
      latest_action_date, latest_action_text, update_date,
      summary, topics, stage, stage_changed_at
      FROM bills
      WHERE summary IS NOT NULL
        AND (sponsor_bioguide_id = ? OR sponsor_name = ?)${ceremonialClause}
      ORDER BY latest_action_date DESC NULLS LAST`;
    const rs = await db.execute({ sql, args: [sponsorKey, sponsorKey] });
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
        FROM bills
        WHERE (sponsor_bioguide_id = ? OR sponsor_name = ?)${ceremonialClause}`,
      args: [sponsorKey, sponsorKey],
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
      sql: `SELECT topics FROM bills
            WHERE topics IS NOT NULL
              AND (sponsor_bioguide_id = ? OR sponsor_name = ?)${ceremonialClause}`,
      args: [sponsorKey, sponsorKey],
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
      ${MENTION_SELECT}
      FROM bills
      ${MENTION_SUBQUERY}
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
    const totalRs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM bills WHERE ${totalClauses.join(" AND ")}`,
      args: totalArgs,
    });
    const filteredRs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM bills WHERE ${filteredClauses.join(" AND ")}`,
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

export const getStaleCount = unstable_cache(
  async (filters: FeedFilters): Promise<FeedCount> => {
    const db = getDb();
    const { clauses: filteredClauses, args: filteredArgs } =
      buildStaleWhere(filters);
    const { clauses: totalClauses, args: totalArgs } = buildStaleWhere({});

    const totalRs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM bills WHERE ${totalClauses.join(" AND ")}`,
      args: totalArgs,
    });
    const filteredRs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM bills WHERE ${filteredClauses.join(" AND ")}`,
      args: filteredArgs,
    });
    return {
      total: Number(totalRs.rows[0]?.n ?? 0),
      filtered: Number(filteredRs.rows[0]?.n ?? 0),
    };
  },
  ["getStaleCount"],
  { revalidate: 3600, tags: ["bills"] },
);

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
    const aggRs = await db.execute(
      `SELECT cluster_id,
              COUNT(*) AS total,
              SUM(CASE WHEN stage IS NOT NULL AND stage <> 'introduced' AND stage <> 'committee' THEN 1 ELSE 0 END) AS past_committee,
              SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
              SUM(CASE WHEN is_ceremonial = 1 THEN 1 ELSE 0 END) AS ceremonial
       FROM bills WHERE cluster_id IS NOT NULL GROUP BY cluster_id`,
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
    const rs = await db.execute(
      `SELECT COUNT(*) AS n FROM bills
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

// Bills: same OR shape as buildFeedWhere's q clause, but intentionally
// IGNORES topic/stage/cluster/chamber filters — global search is global.
// Ceremonial bills stay hidden by default (matches the rest of the app's
// default). Summary-null bills stay hidden (matches buildFeedWhere).
function billsSearchSqlFragment(): { clause: string; argsCount: 5 } {
  return {
    clause: `summary IS NOT NULL
        AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
        AND (LOWER(id) LIKE ?
          OR LOWER(title) LIKE ?
          OR LOWER(sponsor_name) LIKE ?
          OR LOWER(summary) LIKE ?
          OR REPLACE(LOWER(id), '-', '') LIKE ?)`,
    argsCount: 5,
  };
}

function billsSearchArgs(q: string): string[] {
  const like = `%${q.toLowerCase()}%`;
  const idLike = `%${normalizeBillIdQuery(q)}%`;
  return [like, like, like, like, idLike];
}

export const searchBillsCount = unstable_cache(
  async (q: string): Promise<number> => {
    if (!q) return 0;
    const db = getDb();
    const { clause } = billsSearchSqlFragment();
    const rs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM bills WHERE ${clause}`,
      args: billsSearchArgs(q),
    });
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["searchBillsCount"],
  { revalidate: 600, tags: ["bills"] },
);

export const searchBills = unstable_cache(
  async (q: string): Promise<FeedBill[]> => {
    if (!q) return [];
    const db = getDb();
    const { clause } = billsSearchSqlFragment();
    const rs = await db.execute({
      sql: `SELECT id, congress, bill_type, bill_number, title,
                   sponsor_name, sponsor_party, sponsor_state, introduced_date,
                   latest_action_date, latest_action_text, update_date,
                   summary, topics, stage, stage_changed_at
            FROM bills
            WHERE ${clause}
            ORDER BY latest_action_date DESC NULLS LAST, id DESC
            LIMIT ?`,
      args: [...billsSearchArgs(q), SEARCH_LIMIT],
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
      sql: `SELECT COUNT(*) AS n FROM news_mentions m
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
            FROM news_mentions m
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
