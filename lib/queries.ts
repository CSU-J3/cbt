import { getDb } from "./db";
import { ALLOWED_STAGES_SET, ALLOWED_TOPICS_SET } from "./enums";

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
};

export type BillDetail = FeedBill & {
  raw_json: string;
  summary_model: string | null;
  summary_updated_at: string | null;
};

export const SORT_KEYS = ["action", "introduced"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
const SORT_KEYS_SET = new Set<string>(SORT_KEYS);

export type FeedFilters = {
  topics?: string[];
  stage?: string;
  q?: string;
  sponsor?: string;
  sort?: SortKey;
};

export type PartyKey = "R" | "D" | "I";

export type Sponsor = {
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
  const clauses: string[] = ["summary IS NOT NULL"];
  const args: (string | number)[] = [];

  if (filters.stage) {
    clauses.push("stage = ?");
    args.push(filters.stage);
  }

  if (filters.sponsor) {
    clauses.push("sponsor_name = ?");
    args.push(filters.sponsor);
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

  return { clauses, args };
}

export function sanitizeTopics(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((t) => t.trim())
    .filter((t) => ALLOWED_TOPICS_SET.has(t));
}

export function sanitizeStage(input: string | undefined): string | undefined {
  if (!input) return undefined;
  return ALLOWED_STAGES_SET.has(input) ? input : undefined;
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

export async function getFeedStats(): Promise<FeedStats> {
  const db = getDb();
  const r = await db.execute(
    "SELECT COUNT(*) AS total, MAX(update_date) AS last FROM bills",
  );
  const row = r.rows[0];
  return {
    total: Number(row?.total ?? 0),
    lastUpdated: (row?.last as string | null) ?? null,
  };
}

export async function getFeedBills(
  filters: FeedFilters,
  limit = 50,
): Promise<FeedBill[]> {
  const db = getDb();
  const { clauses, args } = buildFeedWhere(filters);
  args.push(limit);

  const sortColumn =
    filters.sort === "introduced" ? "introduced_date" : "latest_action_date";

  const sql = `SELECT id, congress, bill_type, bill_number, title,
    sponsor_name, sponsor_party, sponsor_state, introduced_date,
    latest_action_date, latest_action_text, update_date,
    summary, topics, stage
    FROM bills
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${sortColumn} DESC NULLS LAST, id DESC
    LIMIT ?`;

  const rs = await db.execute({ sql, args });
  return rs.rows.map(rowToFeedBill);
}

export type FeedCount = {
  total: number;
  filtered: number;
};

export async function getFeedCount(filters: FeedFilters): Promise<FeedCount> {
  const db = getDb();
  const { clauses, args } = buildFeedWhere(filters);
  const totalRs = await db.execute("SELECT COUNT(*) AS n FROM bills");
  const filteredRs = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM bills WHERE ${clauses.join(" AND ")}`,
    args,
  });
  return {
    total: Number(totalRs.rows[0]?.n ?? 0),
    filtered: Number(filteredRs.rows[0]?.n ?? 0),
  };
}

export async function getStaleBills(
  filters: FeedFilters,
  limit = 50,
): Promise<FeedBill[]> {
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
}

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

export async function getPresidentBills(
  filters: FeedFilters,
  limit = 50,
): Promise<FeedBill[]> {
  const db = getDb();
  const { clauses, args } = buildPresidentWhere(filters);
  args.push(limit);

  const sql = `SELECT id, congress, bill_type, bill_number, title,
    sponsor_name, sponsor_party, sponsor_state, introduced_date,
    latest_action_date, latest_action_text, update_date,
    summary, topics, stage
    FROM bills
    WHERE ${clauses.join(" AND ")}
    ORDER BY latest_action_date DESC
    LIMIT ?`;

  const rs = await db.execute({ sql, args });
  return rs.rows.map(rowToFeedBill);
}

export async function getPresidentCount(
  filters: FeedFilters,
): Promise<FeedCount> {
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
}

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

  return { clauses, args };
}

export async function getSponsors(
  filters: SponsorFilters,
  limit = 600,
): Promise<Sponsor[]> {
  const db = getDb();
  const { clauses, args } = buildSponsorWhere(filters);
  args.push(limit);

  const sql = `SELECT sponsor_name, sponsor_party, sponsor_state,
      COUNT(*) AS bill_count,
      MAX(latest_action_date) AS latest_action_date
    FROM bills
    WHERE ${clauses.join(" AND ")}
    GROUP BY sponsor_name, sponsor_party, sponsor_state
    ORDER BY bill_count DESC, sponsor_name ASC
    LIMIT ?`;

  const rs = await db.execute({ sql, args });
  return rs.rows.map((r) => ({
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
    GROUP BY sponsor_name, sponsor_party, sponsor_state
  )`;
  const filteredSql = `SELECT COUNT(*) AS n FROM (
    SELECT 1 FROM bills WHERE ${filteredClauses.join(" AND ")}
    GROUP BY sponsor_name, sponsor_party, sponsor_state
  )`;

  const totalRs = await db.execute({ sql: totalSql, args: totalArgs });
  const filteredRs = await db.execute({ sql: filteredSql, args: filteredArgs });
  return {
    total: Number(totalRs.rows[0]?.n ?? 0),
    filtered: Number(filteredRs.rows[0]?.n ?? 0),
  };
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

export async function getSponsorRecentBills(
  sponsorName: string,
  limit = 5,
): Promise<FeedBill[]> {
  const db = getDb();
  const sql = `SELECT id, congress, bill_type, bill_number, title,
    sponsor_name, sponsor_party, sponsor_state, introduced_date,
    latest_action_date, latest_action_text, update_date,
    summary, topics, stage
    FROM bills
    WHERE summary IS NOT NULL AND sponsor_name = ?
    ORDER BY latest_action_date DESC
    LIMIT ?`;
  const rs = await db.execute({ sql, args: [sponsorName, limit] });
  return rs.rows.map(rowToFeedBill);
}

export async function getStaleCount(filters: FeedFilters): Promise<FeedCount> {
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
}

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

export async function getWatchlistBills(
  sort: SortKey = "action",
): Promise<FeedBill[]> {
  const db = getDb();
  const sortColumn =
    sort === "introduced" ? "b.introduced_date" : "b.latest_action_date";
  const sql = `SELECT b.id, b.congress, b.bill_type, b.bill_number, b.title,
    b.sponsor_name, b.sponsor_party, b.sponsor_state, b.introduced_date,
    b.latest_action_date, b.latest_action_text, b.update_date,
    b.summary, b.topics, b.stage
    FROM bills b
    INNER JOIN watchlist w ON w.bill_id = b.id
    ORDER BY ${sortColumn} DESC NULLS LAST, b.id DESC`;
  const rs = await db.execute(sql);
  return rs.rows.map(rowToFeedBill);
}
