// HO 485 — LDA filing-expand cost + shape probe (read-only, no writes).
//
// The /lobbying redesign expands each FilingRow inline (the /members ?expanded=
// idiom — a live per-click server read, one filing at a time) to surface the
// per-activity LD-2 detail: lda_activities.description free text, issue codes,
// and resolved bills. This probe gates that live-expand design on two fronts:
//
//   1. COST — is the single-filing activities read fast COLD, even for the
//      worst (omnibus-LD-2) filing? lda_activities PK is (filing_uuid,
//      activity_ordinal), so WHERE filing_uuid = ? is a PK-prefix seek — the
//      inverse of the HO 439 per-bill drill (random thousands-of-rows fetch,
//      44.5s). Expected sub-100ms, but a clean EXPLAIN says nothing about cold
//      latency — so instrument it. Q2 runs FIRST after connect, request-shaped.
//   2. SHAPE — max activities/filing, description-length distribution, resolved
//      bills/filing. Sizes the expand panel (cap? scroll? bill-chip count?).
//      This is the real output regardless of the GO/NO-GO.
//
//   npx tsx scripts/diagnostic/lda-filing-expand-cost-485.ts
import "dotenv/config";
import { createClient, type Client } from "@libsql/client";
import { uncappedLdaClient } from "../../lib/lda-rollup";

const BOUNDED_FETCH_CAP_MS = 10_000; // lib/db.ts boundedFetch abort — the live-safe line

const str = (v: unknown): string => String(v ?? "");
const ms = (n: number) => `${n.toFixed(0)}ms`;

// p50/p90/p99/max over a number[] (sorted ascending, nearest-rank).
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function pctBlock(label: string, values: number[]): void {
  const s = [...values].sort((a, b) => a - b);
  console.log(
    `  ${label}: p50=${pct(s, 50)}  p90=${pct(s, 90)}  p99=${pct(s, 99)}  max=${s[s.length - 1] ?? 0}  (n=${s.length})`,
  );
}

// The REAL expand read the panel would run — PK-prefix seek + ordinal sort.
const EXPAND_SQL = `SELECT general_issue_code, general_issue_code_display, description, bill_ids
FROM lda_activities WHERE filing_uuid = ? ORDER BY activity_ordinal`;

async function timedRead(db: Client, uuid: string): Promise<{ dt: number; rows: number }> {
  const t0 = performance.now();
  const rs = await db.execute({ sql: EXPAND_SQL, args: [uuid] });
  const dt = performance.now() - t0;
  return { dt, rows: rs.rows.length };
}

async function main() {
  console.log("=== HO 485 LDA filing-expand cost + shape probe ===\n");

  // ---- scanDb: aggregates + target selection (separate client; warms nothing
  //      that matters for the cold coldDb timing below). ----------------------
  const scanDb = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // Q0 — plan check: confirm PK-prefix seek, no scan.
  console.log("--- Q0: EXPLAIN QUERY PLAN (expect PRIMARY KEY seek, any SCAN is a red flag) ---");
  const plan = await scanDb.execute({
    sql: `EXPLAIN QUERY PLAN ${EXPAND_SQL}`,
    args: ["__plan_probe__"],
  });
  for (const r of plan.rows) console.log(`  ${str(r.detail)}`);

  // Q1 — activities-per-filing distribution + heaviest filings.
  console.log("\n--- Q1: activities-per-filing distribution ---");
  const q1 = await scanDb.execute(
    `SELECT filing_uuid, COUNT(*) c FROM lda_activities GROUP BY filing_uuid ORDER BY c DESC`,
  );
  const q1counts = q1.rows.map((r) => Number(r.c));
  pctBlock("activities/filing", q1counts);
  const q1top = q1.rows
    .map((r) => ({ uuid: str(r.filing_uuid), c: Number(r.c) }))
    .sort((a, b) => b.c - a.c);
  console.log("  top-5 heaviest (filing_uuid, activity_count):");
  for (const t of q1top.slice(0, 5)) console.log(`    ${t.uuid}  ${t.c}`);
  const heaviest = q1top[0]?.uuid;
  if (!heaviest) throw new Error("no lda_activities rows found");

  // Q3 — recent-filing UUIDs (what users actually expand).
  const q3recent = await scanDb.execute(
    `SELECT filing_uuid FROM lda_filings ORDER BY dt_posted DESC LIMIT 3`,
  );
  const recentUuids = q3recent.rows.map((r) => str(r.filing_uuid));

  // Q4 — description-length distribution + empty rate.
  console.log("\n--- Q4: description-length distribution ---");
  const q4 = await scanDb.execute(
    `SELECT description FROM lda_activities`,
  );
  const lengths: number[] = [];
  let emptyCount = 0;
  for (const r of q4.rows) {
    const d = r.description;
    if (d == null || String(d) === "") emptyCount++;
    else lengths.push(String(d).length);
  }
  pctBlock("description length (chars, non-empty)", lengths);
  const totalActs = q4.rows.length;
  console.log(
    `  empty (NULL or ''): ${emptyCount}/${totalActs} (${((emptyCount / totalActs) * 100).toFixed(1)}%)`,
  );

  // Q5 — resolved-bills-per-filing (bounds the panel's bill chips).
  console.log("\n--- Q5: resolved-bills-per-filing distribution ---");
  const q5 = await scanDb.execute(
    `SELECT filing_uuid, COUNT(*) c FROM lda_activity_bills GROUP BY filing_uuid ORDER BY c DESC`,
  );
  const q5counts = q5.rows.map((r) => Number(r.c));
  pctBlock("resolved bills/filing (filings with >=1 link)", q5counts);
  const q5top = q5.rows
    .map((r) => ({ uuid: str(r.filing_uuid), c: Number(r.c) }))
    .sort((a, b) => b.c - a.c);
  console.log("  top-5 heaviest (filing_uuid, resolved_bill_count):");
  for (const t of q5top.slice(0, 5)) console.log(`    ${t.uuid}  ${t.c}`);
  const heaviestBills = q5top.find((t) => t.uuid === heaviest)?.c ?? 0;
  console.log(`  Q1-heaviest filing (${heaviest}) carries ${heaviestBills} resolved bills`);

  // Q2 sample rows (content shape) — read on scanDb so coldDb's Q2 stays a clean
  // cold latency measurement (no extra statement before it).
  const sampleRs = await scanDb.execute({
    sql: `SELECT general_issue_code, general_issue_code_display,
                 LENGTH(description) desc_len, substr(description,1,140) desc_head, bill_ids
          FROM lda_activities WHERE filing_uuid = ? ORDER BY activity_ordinal LIMIT 3`,
    args: [heaviest],
  });
  await scanDb.close();

  // ---- coldDb: Q2 worst-case read as the VERY FIRST statement after connect.
  //      This cold number is the verdict. ------------------------------------
  console.log(`\n--- Q2: worst-case single-filing read (COLD, first statement) : ${heaviest} ---`);
  const coldDb = uncappedLdaClient();
  const q2 = await timedRead(coldDb, heaviest);
  console.log(`  COLD: ${ms(q2.dt)}  rows=${q2.rows}`);
  console.log("  first 3 rows (issue_code | display | LENGTH(description) | substr(description,1,140) | bill_ids):");
  for (const r of sampleRs.rows) {
    console.log(
      `    [${str(r.general_issue_code)}] ${str(r.general_issue_code_display)} | len=${str(r.desc_len)} | ` +
        `"${str(r.desc_head)}" | ${str(r.bill_ids)}`,
    );
  }

  // Q3 — same read for the 3 most-recent filings (warm client now; representative
  // of the typical expand, not the omnibus worst case).
  console.log(`\n--- Q3: recent-filing reads (same client) ---`);
  for (const u of recentUuids) {
    const r = await timedRead(coldDb, u);
    console.log(`  ${u}: ${ms(r.dt)}  rows=${r.rows}`);
  }
  await coldDb.close();

  // ---- Verdict ----------------------------------------------------------------
  const verdict = q2.dt < 1000 ? "GO" : "NO-GO";
  console.log(`\n=== VERDICT: ${verdict} ===`);
  console.log(
    `  Q2 cold=${ms(q2.dt)}  ${q2.dt < BOUNDED_FETCH_CAP_MS ? "FITS" : "EXCEEDS"} the 10s boundedFetch cap ` +
      `(${((q2.dt / BOUNDED_FETCH_CAP_MS) * 100).toFixed(1)}% of cap)`,
  );
  console.log(
    `  panel-sizing: max activities/filing=${q1top[0]?.c}  max resolved bills/filing=${q5top[0]?.c}  ` +
      `desc empty=${((emptyCount / totalActs) * 100).toFixed(1)}%`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
