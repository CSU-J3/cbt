import { getDb } from "./db";
import { ALLOWED_STAGES_SET, ALLOWED_TOPICS_SET } from "./enums";

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

export type FeedFilters = {
  topics?: string[];
  stage?: string;
};

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
  const where: string[] = ["summary IS NOT NULL"];
  const args: (string | number)[] = [];

  if (filters.stage) {
    where.push("stage = ?");
    args.push(filters.stage);
  }

  if (filters.topics && filters.topics.length > 0) {
    const topicClauses = filters.topics.map(() => "topics LIKE ?");
    where.push(`(${topicClauses.join(" OR ")})`);
    for (const t of filters.topics) {
      args.push(`%"${t}"%`);
    }
  }

  args.push(limit);

  const sql = `SELECT id, congress, bill_type, bill_number, title,
    sponsor_name, sponsor_party, sponsor_state, introduced_date,
    latest_action_date, latest_action_text, update_date,
    summary, topics, stage
    FROM bills
    WHERE ${where.join(" AND ")}
    ORDER BY update_date DESC
    LIMIT ?`;

  const rs = await db.execute({ sql, args });
  return rs.rows.map(rowToFeedBill);
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

export async function getWatchlistBills(): Promise<FeedBill[]> {
  const db = getDb();
  const sql = `SELECT b.id, b.congress, b.bill_type, b.bill_number, b.title,
    b.sponsor_name, b.sponsor_party, b.sponsor_state, b.introduced_date,
    b.latest_action_date, b.latest_action_text, b.update_date,
    b.summary, b.topics, b.stage
    FROM bills b
    INNER JOIN watchlist w ON w.bill_id = b.id
    ORDER BY w.added_at DESC`;
  const rs = await db.execute(sql);
  return rs.rows.map(rowToFeedBill);
}
