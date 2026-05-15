import { classifyCluster } from "./cluster-patterns";
import { getCurrentCongress } from "./congress";
import { getDb } from "./db";

const API_BASE = "https://api.congress.gov/v3";
const PAGE_SIZE = 250;

type LatestAction = { actionDate?: string; text?: string };
type Sponsor = {
  fullName?: string;
  party?: string;
  state?: string;
  bioguideId?: string;
};

type ListBill = {
  congress: number;
  type: string;
  number: string;
  url?: string;
  title: string;
  updateDate?: string;
  updateDateIncludingText?: string;
  latestAction?: LatestAction;
};

type DetailBill = {
  congress: number;
  type: string;
  number: string;
  title: string;
  introducedDate?: string;
  updateDate?: string;
  updateDateIncludingText?: string;
  latestAction?: LatestAction;
  sponsors?: Sponsor[];
};

type ListResponse = {
  bills?: ListBill[];
  pagination?: { count?: number; next?: string };
};

type DetailResponse = { bill?: DetailBill };

export type SyncStats = {
  seen: number;
  upserted: number;
  skipped: number;
  failed: number;
  fromDateTime: string;
};

function billId(congress: number, type: string, number: number | string): string {
  return `${congress}-${String(type).toLowerCase()}-${number}`;
}

function effectiveUpdate(b: { updateDateIncludingText?: string; updateDate?: string }): string | undefined {
  return b.updateDateIncludingText ?? b.updateDate;
}

async function fetchJson<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 429 && attempt < 3) {
    const wait = 2000 * (attempt + 1);
    console.warn(`rate limited, sleeping ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetch ${url} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

function listUrl(fromDateTime: string, offset: number, apiKey: string): string {
  const params = new URLSearchParams({
    fromDateTime,
    sort: "updateDate desc",
    limit: String(PAGE_SIZE),
    offset: String(offset),
    format: "json",
    api_key: apiKey,
  });
  return `${API_BASE}/bill/${getCurrentCongress()}?${params.toString()}`;
}

function detailUrl(congress: number, type: string, number: string | number, apiKey: string): string {
  const params = new URLSearchParams({ format: "json", api_key: apiKey });
  return `${API_BASE}/bill/${congress}/${String(type).toLowerCase()}/${number}?${params.toString()}`;
}

function defaultFromDateTime(): string {
  const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

function normalizeDateTime(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  return s.replace(/\.\d+Z$/, "Z");
}

async function getWatermark(db: ReturnType<typeof getDb>): Promise<string> {
  const r = await db.execute("SELECT MAX(update_date) AS m FROM bills");
  const m = r.rows[0]?.m as string | null | undefined;
  if (!m) return defaultFromDateTime();
  return normalizeDateTime(m);
}

async function getStoredUpdate(
  db: ReturnType<typeof getDb>,
  id: string,
): Promise<string | null> {
  const r = await db.execute({ sql: "SELECT update_date FROM bills WHERE id = ?", args: [id] });
  const row = r.rows[0];
  if (!row) return null;
  return (row.update_date as string | null) ?? null;
}

const UPSERT_SQL = `
INSERT INTO bills (
  id, congress, bill_type, bill_number, title,
  introduced_date, latest_action_date, latest_action_text,
  sponsor_name, sponsor_party, sponsor_state, sponsor_bioguide_id,
  update_date, raw_json, cluster_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  introduced_date = excluded.introduced_date,
  latest_action_date = excluded.latest_action_date,
  latest_action_text = excluded.latest_action_text,
  sponsor_name = excluded.sponsor_name,
  sponsor_party = excluded.sponsor_party,
  sponsor_state = excluded.sponsor_state,
  sponsor_bioguide_id = excluded.sponsor_bioguide_id,
  raw_json = excluded.raw_json,
  update_date = excluded.update_date,
  cluster_id = excluded.cluster_id,
  summary = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.summary END,
  summary_model = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.summary_model END,
  summary_updated_at = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.summary_updated_at END,
  topics = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.topics END,
  is_ceremonial = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.is_ceremonial END
`;

async function upsertBill(
  db: ReturnType<typeof getDb>,
  detail: DetailBill,
): Promise<void> {
  const id = billId(detail.congress, detail.type, detail.number);
  const update = effectiveUpdate(detail);
  if (!update) {
    console.warn(`skipping ${id}: no update date in detail`);
    return;
  }
  const sponsor = detail.sponsors?.[0];
  const billType = String(detail.type).toLowerCase();
  const clusterId = classifyCluster(detail.title, billType);
  await db.execute({
    sql: UPSERT_SQL,
    args: [
      id,
      detail.congress,
      billType,
      Number(detail.number),
      detail.title,
      detail.introducedDate ?? null,
      detail.latestAction?.actionDate ?? null,
      detail.latestAction?.text ?? null,
      sponsor?.fullName ?? null,
      sponsor?.party ?? null,
      sponsor?.state ?? null,
      sponsor?.bioguideId ?? null,
      update,
      JSON.stringify(detail),
      clusterId,
    ],
  });
}

export type RunSyncOptions = { fromDateTime?: string };

export async function runSync(opts: RunSyncOptions = {}): Promise<SyncStats> {
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const db = getDb();

  const fromDateTime = opts.fromDateTime ?? (await getWatermark(db));
  console.log(`syncing bills updated since ${fromDateTime}`);

  let offset = 0;
  const stats: SyncStats = {
    seen: 0,
    upserted: 0,
    skipped: 0,
    failed: 0,
    fromDateTime,
  };

  while (true) {
    const url = listUrl(fromDateTime, offset, apiKey);
    const page = await fetchJson<ListResponse>(url);
    const bills = page.bills ?? [];
    if (bills.length === 0) break;

    console.log(`page offset=${offset}: ${bills.length} bills`);

    for (const lb of bills) {
      stats.seen++;
      const id = billId(lb.congress, lb.type, lb.number);
      const listUpdate = effectiveUpdate(lb);
      if (!listUpdate) {
        console.warn(`skip ${id}: list entry has no update date`);
        stats.skipped++;
        continue;
      }
      const stored = await getStoredUpdate(db, id);
      if (stored && stored >= listUpdate) {
        stats.skipped++;
        continue;
      }

      try {
        const detailRes = await fetchJson<DetailResponse>(
          detailUrl(lb.congress, lb.type, lb.number, apiKey),
        );
        const detail = detailRes.bill;
        if (!detail) {
          console.warn(`skip ${id}: detail response missing bill`);
          stats.failed++;
          continue;
        }
        await upsertBill(db, detail);
        stats.upserted++;
      } catch (err) {
        console.error(`failed ${id}:`, (err as Error).message);
        stats.failed++;
      }
    }

    if (bills.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(
    `done: seen=${stats.seen} upserted=${stats.upserted} skipped=${stats.skipped} failed=${stats.failed}`,
  );
  return stats;
}
