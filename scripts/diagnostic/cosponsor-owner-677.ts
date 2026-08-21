// HO 677 STEP 0 — price the ownership options for `bills.cosponsor_count`.
// READ-ONLY: DB reads via the hrana pipeline so every figure carries rows_read
// rather than a bare COUNT. Writes nothing.
//
//   npx tsx scripts/diagnostic/cosponsor-owner-677.ts
//
// rows_read harness lifted from scripts/diagnostic/absence-atrisk-642.ts.
import "dotenv/config";

type Exec = { rows: unknown[][]; rowsRead: number; ms: number };

let httpUrl = "";
let token = "";

async function exec(sql: string, args: (string | number)[] = []): Promise<Exec> {
  const res = await fetch(`${httpUrl}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          type: "execute",
          stmt: {
            sql,
            args: args.map((a) =>
              typeof a === "number"
                ? { type: "integer", value: String(a) }
                : { type: "text", value: a },
            ),
          },
        },
        { type: "close" },
      ],
    }),
  });
  const j = (await res.json()) as {
    results?: { type: string; response?: { result?: Record<string, unknown> }; error?: unknown }[];
  };
  const r = j.results?.[0];
  if (!r || r.type !== "ok" || !r.response?.result) {
    throw new Error(`query failed: ${JSON.stringify(r?.error ?? r).slice(0, 400)}\n  sql: ${sql.slice(0, 160)}`);
  }
  const q = r.response.result as {
    rows: { value: unknown }[][];
    rows_read: number;
    query_duration_ms: number;
  };
  return {
    rows: q.rows.map((row) => row.map((cell) => cell?.value)),
    rowsRead: q.rows_read,
    ms: q.query_duration_ms,
  };
}

const S = (v: unknown): string => String(v ?? "");
const N = (v: unknown): number => Number(v ?? 0);
const padL = (v: string | number, w: number) => String(v).padStart(w);

async function main() {
  const raw = process.env.TURSO_DATABASE_URL ?? "";
  token = process.env.TURSO_AUTH_TOKEN ?? "";
  if (!raw || !token) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN required");
  httpUrl = raw.replace(/^libsql:/, "https:");
  const cost = (label: string, e: Exec) =>
    console.log(`  ${label.padEnd(50)} rows_read ${padL(e.rowsRead, 8)} - ${padL(e.ms, 6)}ms`);

  console.log(`\n=== 0.0 CORPUS (${new Date().toISOString()}) ===`);
  const c = await exec(`
    SELECT (SELECT COUNT(*) FROM bills) AS bills,
           (SELECT COUNT(*) FROM bills WHERE cosponsor_count IS NULL) AS cnt_null,
           (SELECT COUNT(*) FROM bills WHERE cosponsor_count = 0) AS cnt_zero,
           (SELECT COUNT(*) FROM bills WHERE cosponsor_count > 0) AS cnt_pos,
           (SELECT COUNT(*) FROM bill_roster_state) AS state_rows,
           (SELECT COUNT(*) FROM bill_cosponsors) AS cos_rows`);
  const cc = c.rows[0] ?? [];
  console.log(`  bills ${N(cc[0])} - cosponsor_count NULL ${N(cc[1])} / =0 ${N(cc[2])} / >0 ${N(cc[3])}`);
  console.log(`  bill_roster_state ${N(cc[4])} rows - bill_cosponsors ${N(cc[5])} rows`);

  console.log(`\n=== 0.3 COVERAGE — how trustworthy is the derived count ===`);
  const cov = await exec(`
    SELECT COUNT(*) AS state_rows,
           SUM(CASE WHEN checked_at >= '2026-08-21' THEN 1 ELSE 0 END) AS refreshed,
           SUM(CASE WHEN checked_at <  '2026-08-21' THEN 1 ELSE 0 END) AS seed_stamp,
           MIN(checked_at) AS oldest, MAX(checked_at) AS newest
    FROM bill_roster_state`);
  const cv = cov.rows[0] ?? [];
  console.log(`  state rows ${N(cv[0])} - checked by the REFRESH ${N(cv[1])} - carrying the SEED stamp ${N(cv[2])}`);
  console.log(`  checked_at range ${S(cv[3])} .. ${S(cv[4])}`);
  const gap = await exec(`
    SELECT COUNT(*) AS n FROM bills b
    WHERE NOT EXISTS (SELECT 1 FROM bill_roster_state s WHERE s.bill_id = b.id)`);
  console.log(`  bills with NO state row at all (the T1 never-checked band): ${N(gap.rows[0]?.[0])}`);
  const empty = await exec(`
    SELECT COUNT(*) AS n FROM bill_roster_state WHERE active_count = 0 AND related_count = 0`);
  console.log(`  state rows recording a genuinely EMPTY roster: ${N(empty.rows[0]?.[0])}`);
  const emptyCos = await exec(`SELECT COUNT(*) AS n FROM bill_roster_state WHERE active_count = 0`);
  console.log(`  state rows with active_count = 0 (no cosponsors seen): ${N(emptyCos.rows[0]?.[0])}`);

  console.log(`\n=== 0.1/0.4 THE DISAGREEMENT, against the MATERIALIZED count ===`);
  const dis = await exec(`
    SELECT COUNT(*) AS carrying,
           SUM(CASE WHEN b.cosponsor_count <> s.active_count THEN 1 ELSE 0 END) AS disagree,
           SUM(CASE WHEN s.active_count > b.cosponsor_count THEN 1 ELSE 0 END) AS roster_ahead,
           SUM(CASE WHEN s.active_count < b.cosponsor_count THEN 1 ELSE 0 END) AS count_ahead,
           SUM(CASE WHEN b.cosponsor_count <> s.active_count
                    THEN s.active_count - b.cosponsor_count ELSE 0 END) AS net
    FROM bills b JOIN bill_roster_state s ON s.bill_id = b.id
    WHERE b.cosponsor_count IS NOT NULL`);
  const d = dis.rows[0] ?? [];
  console.log(`  of ${N(d[0])} bills carrying a count: DISAGREE ${N(d[1])}` +
    ` (roster ahead ${N(d[2])} - count ahead ${N(d[3])}) - net ${N(d[4])}`);
  cost("^ the before/after instrument for this HO", dis);

  const dist = await exec(`
    SELECT SUM(CASE WHEN delta = 1 THEN 1 ELSE 0 END) AS d1,
           SUM(CASE WHEN delta BETWEEN 2 AND 3 THEN 1 ELSE 0 END) AS d2_3,
           SUM(CASE WHEN delta BETWEEN 4 AND 10 THEN 1 ELSE 0 END) AS d4_10,
           SUM(CASE WHEN delta > 10 THEN 1 ELSE 0 END) AS d10p,
           MAX(delta) AS worst
    FROM (SELECT s.active_count - b.cosponsor_count AS delta
          FROM bills b JOIN bill_roster_state s ON s.bill_id = b.id
          WHERE b.cosponsor_count IS NOT NULL AND s.active_count > b.cosponsor_count)`);
  const dd = dist.rows[0] ?? [];
  console.log(`  understatement: +1 on ${N(dd[0])} - +2..3 on ${N(dd[1])} - +4..10 on ${N(dd[2])} - >10 on ${N(dd[3])} - worst +${N(dd[4])}`);

  console.log(`\n=== 0.6 THE 109 — NULL count, roster present ===`);
  const nulls = await exec(`
    SELECT COUNT(*) AS null_bills,
           SUM(CASE WHEN s.active_count > 0 THEN 1 ELSE 0 END) AS with_roster,
           SUM(CASE WHEN s.active_count = 0 THEN 1 ELSE 0 END) AS genuinely_empty
    FROM bills b JOIN bill_roster_state s ON s.bill_id = b.id
    WHERE b.cosponsor_count IS NULL`);
  const nu = nulls.rows[0] ?? [];
  console.log(`  NULL-count bills with a state row: ${N(nu[0])} - active_count > 0 on ${N(nu[1])} - = 0 on ${N(nu[2])}`);
  const sample = await exec(`
    SELECT b.id, s.active_count FROM bills b JOIN bill_roster_state s ON s.bill_id = b.id
    WHERE b.cosponsor_count IS NULL AND s.active_count > 0
    ORDER BY s.active_count DESC LIMIT 5`);
  for (const r of sample.rows) console.log(`    ${S(r[0]).padEnd(16)} roster ${N(r[1])} vs stored NULL`);

  console.log(`\n=== 0.4-A how often would /api/sync overwrite a corrected value ===`);
  const churn = await exec(`
    SELECT SUM(CASE WHEN update_date >= date('now','-1 day')  THEN 1 ELSE 0 END) AS d1,
           SUM(CASE WHEN update_date >= date('now','-7 days') THEN 1 ELSE 0 END) AS d7,
           SUM(CASE WHEN update_date >= date('now','-30 days') THEN 1 ELSE 0 END) AS d30
    FROM bills`);
  const ch = churn.rows[0] ?? [];
  console.log(`  bills whose update_date moved: 1d ${N(ch[0])} - 7d ${N(ch[1])} - 30d ${N(ch[2])}`);
  const churnDis = await exec(`
    SELECT COUNT(*) AS n FROM bills b JOIN bill_roster_state s ON s.bill_id = b.id
    WHERE b.cosponsor_count IS NOT NULL AND b.cosponsor_count <> s.active_count
      AND b.update_date >= date('now','-30 days')`);
  console.log(`  ... of the disagreeing set, moved in 30d: ${N(churnDis.rows[0]?.[0])}`);

  console.log(`\n=== 0.4-C what a bill_roster_state JOIN costs the feed ===`);
  const feedNow = await exec(`
    SELECT bills.id, bills.cosponsor_count
    FROM bills INDEXED BY idx_bills_latest_action
    WHERE bills.summary IS NOT NULL AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)
    ORDER BY bills.latest_action_date DESC NULLS LAST, bills.id DESC LIMIT 25`);
  cost("feed page shape TODAY (column read)", feedNow);
  const feedJoin = await exec(`
    SELECT bills.id, s.active_count
    FROM bills INDEXED BY idx_bills_latest_action
    LEFT JOIN bill_roster_state s ON s.bill_id = bills.id
    WHERE bills.summary IS NOT NULL AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)
    ORDER BY bills.latest_action_date DESC NULLS LAST, bills.id DESC LIMIT 25`);
  cost("feed page shape with a bill_roster_state JOIN", feedJoin);

  console.log(`\n=== STEP 3 capture candidates ===`);
  const pick = async (label: string, sql: string) => {
    const r = await exec(sql);
    console.log(`  ${label}`);
    for (const x of r.rows) console.log(`    ${S(x[0]).padEnd(16)} stored ${S(x[1])} roster ${S(x[2])}`);
  };
  await pick("median class (+1):", `
    SELECT b.id, b.cosponsor_count, s.active_count FROM bills b JOIN bill_roster_state s ON s.bill_id=b.id
    WHERE b.cosponsor_count IS NOT NULL AND s.active_count - b.cosponsor_count = 1
    ORDER BY b.cosponsor_count DESC LIMIT 3`);
  await pick("tail class (largest understatement):", `
    SELECT b.id, b.cosponsor_count, s.active_count FROM bills b JOIN bill_roster_state s ON s.bill_id=b.id
    WHERE b.cosponsor_count IS NOT NULL
    ORDER BY (s.active_count - b.cosponsor_count) DESC LIMIT 3`);
  await pick("agreed before, must still agree:", `
    SELECT b.id, b.cosponsor_count, s.active_count FROM bills b JOIN bill_roster_state s ON s.bill_id=b.id
    WHERE b.cosponsor_count IS NOT NULL AND b.cosponsor_count = s.active_count AND b.cosponsor_count > 20
    ORDER BY b.id LIMIT 3`);
  await pick("NULL count + roster (one of the 109):", `
    SELECT b.id, 'NULL', s.active_count FROM bills b JOIN bill_roster_state s ON s.bill_id=b.id
    WHERE b.cosponsor_count IS NULL AND s.active_count > 0
    ORDER BY s.active_count DESC LIMIT 3`);
  await pick("genuine zero (NULL count, empty roster):", `
    SELECT b.id, 'NULL', s.active_count FROM bills b JOIN bill_roster_state s ON s.bill_id=b.id
    WHERE b.cosponsor_count IS NULL AND s.active_count = 0 ORDER BY b.id LIMIT 3`);
  await pick("never checked by the refresh (no state row):", `
    SELECT b.id, b.cosponsor_count, 'no-state-row' FROM bills b
    WHERE NOT EXISTS (SELECT 1 FROM bill_roster_state s WHERE s.bill_id=b.id) LIMIT 3`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
