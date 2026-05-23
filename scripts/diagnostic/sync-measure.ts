// HO 116 Phase 1 — measure runSync cost shape without writing to the DB.
// Mirrors runSync's loop (list pagination → per-bill stored-update diff →
// detail fetch only on diff hit) but times each stage and tracks counts.
// Read-only: never upserts; uses a fixed sample of detail-fetches.
import "dotenv/config";
import { getDb } from "../../lib/db";
import { getCurrentCongress } from "../../lib/congress";

const API_BASE = "https://api.congress.gov/v3";
const PAGE_SIZE = 250;
const DETAIL_SAMPLE_CAP = Number(process.argv[2] ?? 20);
// Override the watermark with `now - N hours` to simulate a cron gap.
// Useful right after a successful run when the live watermark is fresh.
// Pass as `npx tsx ... 20 24` for a 24-hour-gap simulation.
const GAP_HOURS = process.argv[3] !== undefined ? Number(process.argv[3]) : null;

type ListBill = {
  congress: number;
  type: string;
  number: string;
  title: string;
  updateDate?: string;
  updateDateIncludingText?: string;
};

type ListResponse = {
  bills?: ListBill[];
  pagination?: { count?: number; next?: string };
};

function effectiveUpdate(b: ListBill): string | undefined {
  return b.updateDateIncludingText ?? b.updateDate;
}

function billId(b: ListBill): string {
  return `${b.congress}-${String(b.type).toLowerCase()}-${b.number}`;
}

function normalizeDateTime(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  return s.replace(/\.\d+Z$/, "Z");
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function timedFetch<T>(
  url: string,
  acceptJson = true,
): Promise<{ data: T; ms: number; bytes: number }> {
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: { Accept: acceptJson ? "application/json" : "text/html,*/*" },
  });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const text = await res.text();
  const data = (acceptJson ? JSON.parse(text) : text) as T;
  return { data, ms: Date.now() - t0, bytes: text.length };
}

async function main() {
  const apiKey = process.env.CONGRESS_API_KEY!;
  const db = getDb();

  // ---- watermark ----
  let watermark: string;
  if (GAP_HOURS !== null) {
    const d = new Date(Date.now() - GAP_HOURS * 3600 * 1000);
    watermark = d.toISOString().replace(/\.\d+Z$/, "Z");
    console.log(`watermark (synthetic now - ${GAP_HOURS}h): ${watermark}`);
  } else {
    const wm = await db.execute("SELECT MAX(update_date) AS m FROM bills");
    const rawWatermark = wm.rows[0]?.m as string | null;
    watermark = rawWatermark ? normalizeDateTime(rawWatermark) : "(none)";
    console.log(`watermark (live MAX(update_date)): ${watermark}`);
  }

  // ---- list page(s) ----
  // Fetch page 0 only (most ticks complete in 1 page; if a 24h gap exceeds
  // 250 bills we'll see pagination=next). 250 is the largest page Congress.gov
  // supports.
  const congress = getCurrentCongress();
  const listParams = new URLSearchParams({
    fromDateTime: watermark,
    sort: "updateDate desc",
    limit: String(PAGE_SIZE),
    offset: "0",
    format: "json",
    api_key: apiKey,
  });
  const listUrl = `${API_BASE}/bill/${congress}?${listParams.toString()}`;
  const list1 = await timedFetch<ListResponse>(listUrl);
  const bills = list1.data.bills ?? [];
  console.log(
    `\nlist page 0: ${bills.length} bills, ${list1.ms}ms, ${(list1.bytes / 1024).toFixed(1)}KB`,
  );
  const reportedCount = list1.data.pagination?.count ?? bills.length;
  console.log(`  pagination.count (total updated since watermark): ${reportedCount}`);
  if (list1.data.pagination?.next) {
    console.log(`  pagination.next present — would need >1 page`);
  }

  // Sample first row's update fields so the diff math is grounded.
  const sample = bills[0];
  if (sample) {
    console.log(
      `\nsample list item field shape (bill ${billId(sample)}):` +
        `\n  updateDate=${sample.updateDate}` +
        `\n  updateDateIncludingText=${sample.updateDateIncludingText}`,
    );
  }

  if (bills.length === 0) {
    console.log("\nlist empty — nothing to measure.");
    return;
  }

  // ---- diff path A: per-bill SELECT (current runSync pattern) ----
  console.log(`\n=== diff path A: per-bill SELECT (current runSync) ===`);
  const tA = Date.now();
  const selectTimings: number[] = [];
  let needsFetchA = 0;
  let skipA = 0;
  const idsToFetch: ListBill[] = [];
  for (const lb of bills) {
    const id = billId(lb);
    const lu = effectiveUpdate(lb);
    if (!lu) continue;
    const s0 = Date.now();
    const r = await db.execute({
      sql: "SELECT update_date FROM bills WHERE id = ?",
      args: [id],
    });
    selectTimings.push(Date.now() - s0);
    const stored = (r.rows[0]?.update_date as string | null) ?? null;
    if (stored && stored >= lu) {
      skipA++;
    } else {
      needsFetchA++;
      idsToFetch.push(lb);
    }
  }
  const totalA = Date.now() - tA;
  const sortedA = [...selectTimings].sort((a, b) => a - b);
  console.log(
    `  ${bills.length} per-bill SELECTs in ${totalA}ms ` +
      `(p50=${pct(sortedA, 50)}ms, p95=${pct(sortedA, 95)}ms, max=${sortedA[sortedA.length - 1]}ms)`,
  );
  console.log(`  diff result: ${skipA} skip, ${needsFetchA} need detail-fetch`);

  // ---- diff path B: one batched IN (...) SELECT ----
  console.log(`\n=== diff path B: one batched IN (...) SELECT ===`);
  const ids = bills.map((b) => billId(b));
  const placeholders = ids.map(() => "?").join(",");
  const tB = Date.now();
  const r2 = await db.execute({
    sql: `SELECT id, update_date FROM bills WHERE id IN (${placeholders})`,
    args: ids,
  });
  const totalB = Date.now() - tB;
  const storedById = new Map<string, string>();
  for (const row of r2.rows) {
    storedById.set(row.id as string, (row.update_date as string) ?? "");
  }
  let needsFetchB = 0;
  let skipB = 0;
  for (const lb of bills) {
    const lu = effectiveUpdate(lb);
    if (!lu) continue;
    const stored = storedById.get(billId(lb));
    if (stored && stored >= lu) skipB++;
    else needsFetchB++;
  }
  console.log(
    `  1 batched SELECT (${ids.length} ids) in ${totalB}ms ` +
      `(${r2.rows.length} rows returned)`,
  );
  console.log(`  diff result: ${skipB} skip, ${needsFetchB} need detail-fetch`);
  console.log(
    `  speedup vs path A: ${totalA}ms → ${totalB}ms ` +
      `(${((totalA - totalB) / totalA * 100).toFixed(1)}% reduction)`,
  );

  // ---- detail-fetch sample ----
  console.log(
    `\n=== detail-fetch sample (first ${DETAIL_SAMPLE_CAP} of ${idsToFetch.length} that need fetching) ===`,
  );
  const sample2 = idsToFetch.slice(0, DETAIL_SAMPLE_CAP);
  const detailTimings: number[] = [];
  const detailBytes: number[] = [];
  for (let i = 0; i < sample2.length; i++) {
    const lb = sample2[i]!;
    const url =
      `${API_BASE}/bill/${lb.congress}/${String(lb.type).toLowerCase()}/${lb.number}?` +
      new URLSearchParams({ format: "json", api_key: apiKey }).toString();
    try {
      const r = await timedFetch<unknown>(url);
      detailTimings.push(r.ms);
      detailBytes.push(r.bytes);
      if (i < 3 || i === sample2.length - 1) {
        console.log(
          `  ${String(i + 1).padStart(2)}. ${billId(lb).padEnd(16)} ${r.ms}ms  ${(r.bytes / 1024).toFixed(1)}KB`,
        );
      } else if (i === 3) {
        console.log(`  ... (snipping; full breakdown below)`);
      }
    } catch (e) {
      console.log(`  ${String(i + 1).padStart(2)}. ${billId(lb)} ERROR ${(e as Error).message}`);
    }
  }
  const sortedD = [...detailTimings].sort((a, b) => a - b);
  const sumD = detailTimings.reduce((s, n) => s + n, 0);
  console.log(
    `  detail fetch: avg=${Math.round(sumD / detailTimings.length)}ms ` +
      `min=${sortedD[0]} p50=${pct(sortedD, 50)} p95=${pct(sortedD, 95)} max=${sortedD[sortedD.length - 1]}ms`,
  );

  // ---- projections ----
  console.log(`\n=== projection for current run shape (path A vs path B) ===`);
  const perDetail = sumD / Math.max(1, detailTimings.length);
  const projDetail = perDetail * needsFetchA;
  const totalShared = list1.ms;
  console.log(
    `  list page(s): ${totalShared}ms · ` +
      `path-A selects: ${totalA}ms · ` +
      `detail fetch (${needsFetchA} bills × ${Math.round(perDetail)}ms): ${Math.round(projDetail / 1000)}s`,
  );
  console.log(
    `  current runSync (path A): ~${Math.round((totalShared + totalA + projDetail) / 1000)}s local ` +
      `→ ~${Math.round(2 * (totalShared + totalA + projDetail) / 1000)}s prod (2× rule)`,
  );
  console.log(
    `  with path B batched diff:  ~${Math.round((totalShared + totalB + projDetail) / 1000)}s local ` +
      `→ ~${Math.round(2 * (totalShared + totalB + projDetail) / 1000)}s prod`,
  );
  console.log(
    `  (path B savings = ${Math.round((totalA - totalB) / 1000)}s local, ` +
      `~${Math.round(2 * (totalA - totalB) / 1000)}s prod)`,
  );

  // ---- backlog volume ----
  console.log(`\n=== volume context ===`);
  const vol = await db.execute(`
    SELECT
      CASE
        WHEN update_date >= datetime('now','-1 day') THEN 'a. <1d'
        WHEN update_date >= datetime('now','-7 days') THEN 'b. 1-7d'
        WHEN update_date >= datetime('now','-30 days') THEN 'c. 7-30d'
        ELSE 'd. >30d'
      END AS bucket,
      COUNT(*) AS n
    FROM bills
    GROUP BY bucket ORDER BY bucket`);
  for (const r of vol.rows) console.log(`  ${r.bucket}: ${r.n}`);

  const recent = await db.execute(`
    SELECT route, started_at, status, elapsed_ms FROM cron_runs
    WHERE route = '/api/sync' ORDER BY started_at DESC LIMIT 5`);
  console.log(`\n=== /api/sync cron_runs (last 5) ===`);
  for (const r of recent.rows) {
    console.log(
      `  ${r.started_at} | ${r.status} | ${r.elapsed_ms ?? "?"}ms`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
