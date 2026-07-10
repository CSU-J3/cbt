// HO 439 — bill-keyed lobbying cost probe (read-only, no writes).
//
// Measures whether the per-bill lobbying query (the /bill/[id] fork of the LDA
// arc) can run LIVE on the request path or must be PRECOMPUTED like the
// /lobbying rollup. Times the REAL query shape the bill page would run — seek,
// filing-row fetch, hydrate, JS aggregate — cold-first on a fresh uncapped
// client, then warm. Reports the worst-case bill, the fan-out distribution, and
// a live-vs-precompute recommendation input. Times the true shape, not a
// synthetic COUNT(*).
//
//   npx tsx scripts/diagnostic/lda-bill-cost-439.ts
import "dotenv/config";
import { createClient, type Client } from "@libsql/client";
import { hydrateFilings, uncappedLdaClient } from "../../lib/lda-rollup";

const HYDRATE_CHUNK = 400; // mirror lib/lda-rollup.ts — under SQLite's ~999 param bound
const DRILL_TOP_N = 5;
const DRILL_RECENT_N = 8;
const GETDB_CAP_MS = 10_000; // lib/db.ts boundedFetch abort — the live-safe line

const str = (v: unknown): string => String(v ?? "");
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const ms = (n: number) => `${n.toFixed(0)}ms`;

async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ v: T; dt: number }> {
  const t0 = performance.now();
  const v = await fn();
  const dt = performance.now() - t0;
  console.log(`    ${label}: ${ms(dt)}`);
  return { v, dt };
}

// The REAL per-bill query the /bill/[id] surface would run, staged so each cost
// is attributable. Returns the aggregated drill + per-stage timings.
async function billQuery(db: Client, billId: string) {
  // (a) SEEK — bounded idx_lda_activity_bills_bill seek → distinct filing_uuids.
  const seek = await timed("(a) seek", async () => {
    const rs = await db.execute({
      sql: `SELECT filing_uuid, activity_ordinal FROM lda_activity_bills WHERE bill_id = ?`,
      args: [billId],
    });
    const uuids = new Set<string>();
    for (const r of rs.rows) uuids.add(str(r.filing_uuid));
    return { uuids: [...uuids], rawActivities: rs.rows.length };
  });
  const uuids = seek.v.uuids;

  // (b) FETCH filing rows — PK IN-lookup, chunked. The random row-fetch that bit
  // the per-code drill.
  const fetch = await timed("(b) filing fetch", async () => {
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < uuids.length; i += HYDRATE_CHUNK) {
      const chunk = uuids.slice(i, i + HYDRATE_CHUNK);
      const ph = chunk.map(() => "?").join(",");
      const rs = await db.execute({
        sql: `SELECT filing_uuid, registrant_name, client_name, income, expenses,
                     dt_posted, filing_type, filing_period
              FROM lda_filings WHERE filing_uuid IN (${ph})`,
        args: chunk,
      });
      for (const r of rs.rows) rows.push(r as unknown as Record<string, unknown>);
    }
    return rows;
  });
  const filingRows = fetch.v;

  // (c) HYDRATE codes/bills — reuse the shared rollup helper.
  const hydrate = await timed("(c) hydrateFilings", () => hydrateFilings(db, uuids));
  const { codes, bills } = hydrate.v;

  // (d) JS AGGREGATE — top firms/clients by DISTINCT filings (HO 435 rule),
  // recent N, per-bill issue-code breakdown. One filing row = one distinct
  // filing, so tallies are already distinct-filing counts.
  const agg = await timed("(d) js aggregate", async () => {
    const clientTally = new Map<string, number>();
    const firmTally = new Map<string, number>();
    const clientDistinct = new Set<string>();
    const codeTally = new Map<string, number>(); // distinct filings per issue code
    let billLinked = 0;
    const summaries = filingRows.map((r) => {
      const uuid = str(r.filing_uuid);
      const cn = strOrNull(r.client_name);
      const rn = strOrNull(r.registrant_name);
      if (cn) {
        clientTally.set(cn, (clientTally.get(cn) ?? 0) + 1);
        clientDistinct.add(cn);
      }
      if (rn) firmTally.set(rn, (firmTally.get(rn) ?? 0) + 1);
      const issueCodes = codes.get(uuid) ?? [];
      for (const c of new Set(issueCodes)) codeTally.set(c, (codeTally.get(c) ?? 0) + 1);
      if ((bills.get(uuid)?.length ?? 0) > 0) billLinked++;
      return {
        filingUuid: uuid,
        registrantName: rn,
        clientName: cn,
        dtPosted: str(r.dt_posted),
        filingType: str(r.filing_type),
        filingPeriod: strOrNull(r.filing_period),
        income: numOrNull(r.income),
        expenses: numOrNull(r.expenses),
        issueCodes,
        billIds: bills.get(uuid) ?? [],
      };
    });
    const topN = (m: Map<string, number>) =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, DRILL_TOP_N)
        .map(([name, filings]) => ({ name, filings }));
    const recent = [...summaries]
      .sort((a, b) =>
        a.dtPosted < b.dtPosted ? 1 : a.dtPosted > b.dtPosted ? -1 : a.filingUuid < b.filingUuid ? -1 : 1,
      )
      .slice(0, DRILL_RECENT_N);
    return {
      distinctFilings: filingRows.length,
      distinctClients: clientDistinct.size,
      billLinked,
      topClients: topN(clientTally),
      topFirms: topN(firmTally),
      byIssueCode: [...codeTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      recentCount: recent.length,
    };
  });

  return {
    rawActivities: seek.v.rawActivities,
    result: agg.v,
    stages: { seek: seek.dt, fetch: fetch.dt, hydrate: hydrate.dt, agg: agg.dt },
    total: seek.dt + fetch.dt + hydrate.dt + agg.dt,
  };
}

async function main() {
  console.log("=== HO 439 bill-keyed lobbying cost probe ===\n");

  // ---- Worst-case confirmation + fan-out distribution -----------------------
  // A full scan of the small (~174k-row) lda_activity_bills — sequential, the
  // shape this Turso is fine at. One client, warms nothing that matters for the
  // cold bill-query timing below (that uses a separate fresh client + random
  // lda_filings fetches).
  const scanDb = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("--- worst case (top 5 by raw activity links) ---");
  const topRaw = await scanDb.execute(
    `SELECT bill_id, COUNT(*) c FROM lda_activity_bills GROUP BY bill_id ORDER BY c DESC LIMIT 5`,
  );
  for (const r of topRaw.rows) console.log(`  ${str(r.bill_id)}: raw_activities=${r.c}`);

  console.log("\n--- fan-out distribution (distinct filings per bill) ---");
  const distRs = await scanDb.execute(
    `SELECT bill_id, COUNT(DISTINCT filing_uuid) dc FROM lda_activity_bills GROUP BY bill_id`,
  );
  const dcs = distRs.rows.map((r) => Number(r.dc)).sort((a, b) => a - b);
  const pct = (p: number) => dcs[Math.min(dcs.length - 1, Math.floor((p / 100) * dcs.length))];
  const topByDistinct = distRs.rows
    .map((r) => ({ bill: str(r.bill_id), dc: Number(r.dc) }))
    .sort((a, b) => b.dc - a.dc);
  console.log(`  bills with >=1 link: ${dcs.length}`);
  console.log(`  p50=${pct(50)}  p90=${pct(90)}  p99=${pct(99)}  max=${dcs[dcs.length - 1]}`);
  console.log(`  top 5 by DISTINCT filings:`);
  for (const b of topByDistinct.slice(0, 5)) console.log(`    ${b.bill}: distinct_filings=${b.dc}`);

  const target = topByDistinct[0]?.bill; // true worst case for the fetch stage
  if (!target) throw new Error("no bill-linked filings found");
  console.log(`\n  >> timing target (max distinct filings): ${target}`);
  await scanDb.close();

  // ---- COLD run: fresh uncapped client, bill query as the FIRST statement ----
  console.log(`\n--- COLD run (fresh client, first statement) : ${target} ---`);
  const coldDb = uncappedLdaClient();
  const cold = await billQuery(coldDb, target);
  console.log(`    => cold TOTAL: ${ms(cold.total)}`);

  // ---- WARM run: same client, second call ----
  console.log(`\n--- WARM run (same client, second call) : ${target} ---`);
  const warm = await billQuery(coldDb, target);
  console.log(`    => warm TOTAL: ${ms(warm.total)}`);
  await coldDb.close();

  // ---- Summary --------------------------------------------------------------
  const r = cold.result;
  console.log(`\n=== SUMMARY ===`);
  console.log(
    `worst-case bill: ${target}  raw_activities=${cold.rawActivities}  distinct_filings=${r.distinctFilings}`,
  );
  console.log(`  distinct_clients=${r.distinctClients}  bill_linked_filings=${r.billLinked}`);
  console.log(`  top firm: ${r.topFirms[0]?.name} (${r.topFirms[0]?.filings})`);
  console.log(`  top client: ${r.topClients[0]?.name} (${r.topClients[0]?.filings})`);
  console.log(
    `stages (cold): seek=${ms(cold.stages.seek)} fetch=${ms(cold.stages.fetch)} ` +
      `hydrate=${ms(cold.stages.hydrate)} agg=${ms(cold.stages.agg)}`,
  );
  console.log(`cold total=${ms(cold.total)}  warm total=${ms(warm.total)}`);
  const margin = GETDB_CAP_MS - cold.total;
  console.log(
    `getDb 10s cap: cold ${cold.total < GETDB_CAP_MS ? "FITS" : "EXCEEDS"} ` +
      `(margin ${ms(margin)}, ${((cold.total / GETDB_CAP_MS) * 100).toFixed(0)}% of cap)`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
