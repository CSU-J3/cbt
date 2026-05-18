import { unstable_cache } from "next/cache";
import { CAUCUS_CONFIG, type CaucusOrg } from "./caucus-config";
import { CLUSTER_IDS, CLUSTER_PATTERNS } from "./cluster-patterns";
import { getDb } from "./db";
import {
  ALLOWED_STAGES_SET,
  ALLOWED_TOPICS_SET,
  type Stage,
  type Topic,
} from "./enums";

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
  billCount: number;
  advancedCount: number;
  passRate: number; // 0-1
};

// Feeds the /sponsors productivity scatter (handoff 67). Pass rate denominator
// excludes `stage IS NULL` (unsummarized) and `stage = 'other'` (off-path)
// so the chart only reflects bills with a real classifier verdict. Numerator
// counts anything past introduction. Sponsors with <3 bills are dropped —
// one-shot rates compress to 0 or 100 and add no signal.
//
// Scoped to current Congress via MAX(congress) so this rolls over without
// touching code. Tag `bills` for unified cache invalidation.
export const getSponsorProductivity = unstable_cache(
  async (): Promise<SponsorProductivityRow[]> => {
    const db = getDb();
    const rs = await db.execute(`
      SELECT
        sponsor_bioguide_id AS bioguide_id,
        sponsor_name AS name,
        sponsor_party AS party_raw,
        sponsor_state AS state,
        COUNT(*) AS bill_count,
        SUM(CASE
          WHEN stage IN ('committee','floor','other_chamber','president','enacted')
          THEN 1 ELSE 0
        END) AS advanced_count
      FROM bills
      WHERE congress = (SELECT MAX(congress) FROM bills)
        AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
        AND stage IS NOT NULL
        AND stage != 'other'
        AND sponsor_name IS NOT NULL
      GROUP BY sponsor_bioguide_id, sponsor_name, sponsor_party, sponsor_state
      HAVING COUNT(*) >= 3
      ORDER BY bill_count DESC
    `);
    return rs.rows.map((r) => {
      const billCount = Number(r.bill_count ?? 0);
      const advancedCount = Number(r.advanced_count ?? 0);
      return {
        bioguideId: (r.bioguide_id as string | null) ?? null,
        name: r.name as string,
        party: normalizePartyVariant(r.party_raw as string | null),
        state: (r.state as string | null) ?? null,
        billCount,
        advancedCount,
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
// of the sync/summarize steps.
export const getReportsList = unstable_cache(
  async (): Promise<ReportListItem[]> => {
    const db = getDb();
    const rs = await db.execute(
      `SELECT slug, title, week_start, week_end
       FROM reports
       ORDER BY week_start DESC`,
    );
    return rs.rows.map((r) => ({
      slug: r.slug as string,
      title: r.title as string,
      weekStart: r.week_start as string,
      weekEnd: r.week_end as string,
    }));
  },
  ["reports-list"],
  { revalidate: 3600, tags: ["reports"] },
);

// Paginated variant for the /reports index (handoff 75). Same tag/revalidate
// as getReportsList — the cron's `reports` invalidation flushes both.
export const getReports = unstable_cache(
  async (limit: number, offset: number): Promise<ReportListItem[]> => {
    const db = getDb();
    const rs = await db.execute({
      sql: `SELECT slug, title, week_start, week_end
            FROM reports
            ORDER BY week_start DESC
            LIMIT ? OFFSET ?`,
      args: [limit, offset],
    });
    return rs.rows.map((r) => ({
      slug: r.slug as string,
      title: r.title as string,
      weekStart: r.week_start as string,
      weekEnd: r.week_end as string,
    }));
  },
  ["getReports"],
  { revalidate: 3600, tags: ["reports"] },
);

export const getReportCount = unstable_cache(
  async (): Promise<number> => {
    const db = getDb();
    const rs = await db.execute("SELECT COUNT(*) AS n FROM reports");
    return Number(rs.rows[0]?.n ?? 0);
  },
  ["getReportCount"],
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
              summary, topics, stage
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
    }));
  },
  ["getBreakingNews"],
  { revalidate: 600, tags: ["news-breaking"] },
);

export const FEED_PAGE_SIZE = 100;

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

    const sql = `SELECT id, congress, bill_type, bill_number, title,
      sponsor_name, sponsor_party, sponsor_state, introduced_date,
      latest_action_date, latest_action_text, update_date,
      summary, topics, stage
      FROM bills
      WHERE ${where}
      ORDER BY ${sortColumn} DESC NULLS LAST, id DESC
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
  { revalidate: 3600, tags: ["bills"] },
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
      summary, topics, stage
      FROM bills
      WHERE ${clauses.join(" AND ")}
      ORDER BY latest_action_date ASC
      LIMIT ?`;

    const rs = await db.execute({ sql, args });
    return rs.rows.map(rowToFeedBill);
  },
  ["getStaleBills"],
  { revalidate: 3600, tags: ["bills"] },
);

function buildPresidentWhere(filters: FeedFilters): {
  clauses: string[];
  args: (string | number)[];
} {
  const { stage: _ignored, ...rest } = filters;
  const { clauses, args } = buildFeedWhere(rest);
  clauses.push("stage = ?");
  args.push("president");
  clauses.push("latest_action_date IS NOT NULL");
  return { clauses, args };
}

export const getPresidentBills = unstable_cache(
  async (filters: FeedFilters, limit = 50): Promise<FeedBill[]> => {
    const db = getDb();
    const { clauses, args } = buildPresidentWhere(filters);
    args.push(limit);

    const sql = `SELECT id, congress, bill_type, bill_number, title,
      sponsor_name, sponsor_party, sponsor_state, introduced_date,
      latest_action_date, latest_action_text, update_date,
      summary, topics, stage
      FROM bills
      WHERE ${clauses.join(" AND ")}
      ORDER BY latest_action_date ASC
      LIMIT ?`;

    const rs = await db.execute({ sql, args });
    return rs.rows.map(rowToFeedBill);
  },
  ["getPresidentBills"],
  { revalidate: 3600, tags: ["bills"] },
);

export const getPresidentCount = unstable_cache(
  async (filters: FeedFilters): Promise<FeedCount> => {
    const db = getDb();
    const { clauses: filteredClauses, args: filteredArgs } =
      buildPresidentWhere(filters);
    const { clauses: totalClauses, args: totalArgs } = buildPresidentWhere({});

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
  ["getPresidentCount"],
  { revalidate: 3600, tags: ["bills"] },
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
      summary, topics, stage
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
      summary, topics, stage, previous_stage, stage_changed_at
      FROM bills
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
  { revalidate: 3600, tags: ["bills"] },
);

export const getStageChangesCount = unstable_cache(
  async (filters: FeedFilters, days = 7): Promise<FeedCount> => {
    const db = getDb();
    const { clauses: filteredClauses, args: filteredArgs } = buildChangesWhere(
      filters,
      days,
    );
    const { clauses: totalClauses, args: totalArgs } = buildChangesWhere(
      {},
      days,
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
};

// Returns one row per pattern (zero-counts included), sorted by count DESC.
// Uses a single GROUP BY scan plus per-id lookups for example titles. Cheap.
export const getClusterStats = unstable_cache(
  async (): Promise<ClusterStat[]> => {
    const db = getDb();
    const countsRs = await db.execute(
      `SELECT cluster_id, COUNT(*) AS n
       FROM bills WHERE cluster_id IS NOT NULL GROUP BY cluster_id`,
    );
    const countsByPattern = new Map<string, number>();
    for (const r of countsRs.rows) {
      countsByPattern.set(
        r.cluster_id as string,
        Number(r.n ?? 0),
      );
    }

    const result: ClusterStat[] = [];
    for (const p of CLUSTER_PATTERNS) {
      const count = countsByPattern.get(p.id) ?? 0;
      let exampleTitle: string | null = null;
      if (count > 0) {
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
        count,
        exampleTitle,
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
      b.summary, b.topics, b.stage
      FROM bills b
      INNER JOIN watchlist w ON w.bill_id = b.id
      WHERE 1=1${chamberClause}
      ORDER BY ${sortColumn} DESC NULLS LAST, b.id DESC`;
    const rs = await db.execute(sql);
    return rs.rows.map(rowToFeedBill);
  },
  ["getWatchlistBills"],
  { revalidate: 3600, tags: ["watchlist", "bills"] },
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
