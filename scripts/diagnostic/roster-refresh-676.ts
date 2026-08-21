// HO 676 STEP 0 — price the roster refresh. READ-ONLY: DB reads via the hrana
// pipeline (so every figure carries rows_read, not a bare COUNT) plus GET-only
// Congress.gov calls to characterise the five uncovered bills. It writes
// nothing to either the DB or the API.
//
//   npx tsx scripts/diagnostic/roster-refresh-676.ts
//
// rows_read harness lifted from scripts/diagnostic/absence-atrisk-642.ts.
import "dotenv/config";
import { fetchCosponsors, fetchRelatedBills } from "../../lib/bill-rosters-sync";

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

// The five from the HO 675 close. Named, not re-derived, so the characterisation
// is against the filed set rather than against whatever today's query returns.
const FIVE = ["119-s-5354", "119-s-5319", "119-s-5311", "119-s-5310", "119-hres-1400"];

const ACTIVE_ROSTER_CTE = `
  WITH r AS (
    SELECT bill_id, COUNT(*) AS active
    FROM bill_cosponsors
    WHERE sponsorship_withdrawn_date IS NULL
    GROUP BY bill_id
  )`;

async function main() {
  const raw = process.env.TURSO_DATABASE_URL ?? "";
  token = process.env.TURSO_AUTH_TOKEN ?? "";
  if (!raw || !token) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN required");
  httpUrl = raw.replace(/^libsql:/, "https:");
  const apiKey = (process.env.CONGRESS_API_KEY ?? "").trim();

  const line = (label: string, e: Exec) =>
    console.log(`  ${label.padEnd(46)} rows_read ${padL(e.rowsRead, 8)} - ${padL(e.ms, 6)}ms`);

  console.log(`\n=== 0.0 CORPUS (as of ${new Date().toISOString()}) ===`);
  const corpus = await exec(`
    SELECT (SELECT COUNT(*) FROM bills) AS bills,
           (SELECT COUNT(*) FROM bills WHERE cosponsor_count IS NOT NULL) AS with_count,
           (SELECT COUNT(*) FROM bills WHERE cosponsor_count > 0) AS count_pos,
           (SELECT COUNT(*) FROM bills WHERE cosponsor_count IS NULL) AS count_null,
           (SELECT COUNT(*) FROM bill_cosponsors) AS cos_rows,
           (SELECT COUNT(DISTINCT bill_id) FROM bill_cosponsors) AS cos_bills,
           (SELECT COUNT(*) FROM bill_related_bills) AS rel_rows,
           (SELECT COUNT(DISTINCT bill_id) FROM bill_related_bills) AS rel_bills,
           (SELECT MAX(ingested_at) FROM bill_cosponsors) AS cos_last,
           (SELECT MIN(ingested_at) FROM bill_cosponsors) AS cos_first,
           (SELECT MAX(ingested_at) FROM bill_related_bills) AS rel_last`);
  const c = corpus.rows[0] ?? [];
  console.log(`  bills ${N(c[0])} - with count ${N(c[1])} (>0 ${N(c[2])}, NULL ${N(c[3])})`);
  console.log(`  bill_cosponsors    ${N(c[4])} rows / ${N(c[5])} bills   ingested ${S(c[9])} .. ${S(c[8])}`);
  console.log(`  bill_related_bills ${N(c[6])} rows / ${N(c[7])} bills   last ${S(c[10])}`);

  console.log(`\n=== 0.1 THE FIVE - characterise ===`);
  for (const id of FIVE) {
    const q = await exec(
      `SELECT b.id, b.cosponsor_count, b.introduced_date, b.update_date,
              CAST(json_extract(b.raw_json,'$.relatedBills.count') AS INTEGER) AS rb_count,
              (SELECT COUNT(*) FROM bill_cosponsors x WHERE x.bill_id=b.id) AS cos_rows,
              (SELECT COUNT(*) FROM bill_related_bills y WHERE y.bill_id=b.id) AS rel_rows,
              (SELECT MAX(ingested_at) FROM bill_cosponsors x WHERE x.bill_id=b.id) AS cos_stamp
       FROM bills b WHERE b.id = ?`,
      [id],
    );
    const r = q.rows[0];
    if (!r) {
      console.log(`  ${id}: NOT IN bills`);
      continue;
    }
    let api = "(no CONGRESS_API_KEY - API leg skipped)";
    if (apiKey) {
      try {
        const f = await fetchCosponsors(id, apiKey);
        const active = f.rows.filter((x) => !x.sponsorship_withdrawn_date).length;
        const rb = await fetchRelatedBills(id, apiKey);
        api = `API now: cosponsors listed ${f.rows.length} (active ${active}, pagination.count ${f.activeCount}) - related entries ${rb.rows.length}`;
      } catch (e) {
        api = `API ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    console.log(`  ${id}`);
    console.log(`    stored: cosponsor_count=${S(r[1])} rb_count=${S(r[4])} cos_rows=${N(r[5])} rel_rows=${N(r[6])} cos_stamp=${S(r[7])}`);
    console.log(`    dates : introduced=${S(r[2])} update_date=${S(r[3])}`);
    console.log(`    ${api}`);
  }

  console.log(`\n=== 0.1b the population, re-measured now ===`);
  const pop = await exec(`
    SELECT COUNT(*) FROM bills b
    WHERE b.cosponsor_count > 0
      AND NOT EXISTS (SELECT 1 FROM bill_cosponsors x WHERE x.bill_id = b.id)`);
  console.log(`  bills with cosponsor_count>0 and ZERO roster rows: ${N(pop.rows[0]?.[0])}`);
  line("^ that query", pop);
  const popIds = await exec(`
    SELECT b.id, b.cosponsor_count, b.introduced_date, b.update_date FROM bills b
    WHERE b.cosponsor_count > 0
      AND NOT EXISTS (SELECT 1 FROM bill_cosponsors x WHERE x.bill_id = b.id)
    ORDER BY b.update_date DESC`);
  for (const r of popIds.rows) {
    console.log(`    ${S(r[0]).padEnd(16)} count=${padL(S(r[1]), 4)} intro=${S(r[2])} update=${S(r[3])}`);
  }

  console.log(`\n=== 0.2 THE TRIGGER - direction of disagreement ===`);
  const dir = await exec(`${ACTIVE_ROSTER_CTE}
    SELECT
      SUM(CASE WHEN r.active IS NULL THEN 1 ELSE 0 END) AS no_roster,
      SUM(CASE WHEN r.active IS NOT NULL AND r.active  > b.cosponsor_count THEN 1 ELSE 0 END) AS roster_ahead,
      SUM(CASE WHEN r.active IS NOT NULL AND r.active  < b.cosponsor_count THEN 1 ELSE 0 END) AS count_ahead,
      SUM(CASE WHEN r.active IS NOT NULL AND r.active  = b.cosponsor_count THEN 1 ELSE 0 END) AS agree,
      SUM(CASE WHEN r.active IS NOT NULL AND r.active <> b.cosponsor_count THEN r.active - b.cosponsor_count ELSE 0 END) AS net
    FROM bills b LEFT JOIN r ON r.bill_id = b.id
    WHERE b.cosponsor_count IS NOT NULL`);
  const d = dir.rows[0] ?? [];
  console.log(`  of ${N(c[1])} bills carrying a count:`);
  console.log(`    agree                       ${padL(N(d[3]), 6)}`);
  console.log(`    ROSTER ahead of count       ${padL(N(d[1]), 6)}   <- refetch changes nothing`);
  console.log(`    COUNT ahead of roster       ${padL(N(d[2]), 6)}   <- roster genuinely behind`);
  console.log(`    no roster row at all        ${padL(N(d[0]), 6)}`);
  console.log(`    net (roster - count)        ${padL(N(d[4]), 6)}`);
  line("^ that query", dir);

  console.log(`\n=== 0.2b NULL-count bills and the empty-roster population ===`);
  const nulls = await exec(`
    SELECT
      SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM bill_cosponsors x WHERE x.bill_id=b.id) THEN 1 ELSE 0 END) AS null_no_roster,
      SUM(CASE WHEN     EXISTS (SELECT 1 FROM bill_cosponsors x WHERE x.bill_id=b.id) THEN 1 ELSE 0 END) AS null_with_roster,
      COUNT(*) AS total
    FROM bills b WHERE b.cosponsor_count IS NULL`);
  const nu = nulls.rows[0] ?? [];
  console.log(`  cosponsor_count IS NULL: ${N(nu[2])} total - ${N(nu[0])} with no roster, ${N(nu[1])} WITH a roster`);
  const tax = await exec(`
    SELECT COUNT(*) FROM bills b
    WHERE (b.cosponsor_count IS NULL OR b.cosponsor_count > 0)
      AND NOT EXISTS (SELECT 1 FROM bill_cosponsors x WHERE x.bill_id=b.id)`);
  console.log(`  BACKFILL-CANDIDATE bills with zero roster rows (the row-presence tax): ${N(tax.rows[0]?.[0])}`);

  console.log(`\n=== 0.2c RELATED BILLS - is there a comparand? ===`);
  const relq = await exec(`
    WITH rr AS (SELECT bill_id, COUNT(*) AS n FROM bill_related_bills GROUP BY bill_id)
    SELECT
      COUNT(*) AS bills_with_rb_count,
      SUM(CASE WHEN rr.n IS NULL THEN 1 ELSE 0 END) AS no_rows,
      SUM(CASE WHEN rr.n > b.rb THEN 1 ELSE 0 END) AS stored_ahead,
      SUM(CASE WHEN rr.n < b.rb THEN 1 ELSE 0 END) AS count_ahead,
      SUM(CASE WHEN rr.n = b.rb THEN 1 ELSE 0 END) AS agree
    FROM (SELECT id, CAST(json_extract(raw_json,'$.relatedBills.count') AS INTEGER) AS rb FROM bills) b
    LEFT JOIN rr ON rr.bill_id = b.id
    WHERE b.rb > 0`);
  const rq = relq.rows[0] ?? [];
  console.log(`  bills with $.relatedBills.count > 0: ${N(rq[0])}`);
  console.log(`    agree                       ${padL(N(rq[4]), 6)}`);
  console.log(`    stored rows ahead of count  ${padL(N(rq[2]), 6)}`);
  console.log(`    COUNT ahead of stored rows  ${padL(N(rq[3]), 6)}`);
  console.log(`    no stored rows at all       ${padL(N(rq[1]), 6)}`);
  line("^ json_extract over raw_json", relq);

  console.log(`\n=== 0.2d cost: the cheap (count-only) selection vs the json_extract one ===`);
  const cheap = await exec(`${ACTIVE_ROSTER_CTE}
    SELECT b.id FROM bills b LEFT JOIN r ON r.bill_id = b.id
    WHERE b.cosponsor_count IS NOT NULL
      AND b.cosponsor_count > COALESCE(r.active, 0)
    LIMIT 50`);
  console.log(`  count-ahead selection returned ${cheap.rows.length} (LIMIT 50)`);
  line("^ count-ahead selection", cheap);
  const neverChecked = await exec(`
    SELECT b.id FROM bills b
    WHERE b.cosponsor_count > 0
      AND NOT EXISTS (SELECT 1 FROM bill_cosponsors x WHERE x.bill_id=b.id)
    LIMIT 50`);
  line("^ never-checked selection", neverChecked);

  console.log(`\n=== 0.4 request shape: how many bills need >1 cosponsor page ===`);
  const pages = await exec(`
    SELECT SUM(CASE WHEN n > 250 THEN 1 ELSE 0 END) AS multipage,
           MAX(n) AS max_rows, COUNT(*) AS bills, SUM(n) AS rows
    FROM (SELECT bill_id, COUNT(*) AS n FROM bill_cosponsors GROUP BY bill_id)`);
  const pg = pages.rows[0] ?? [];
  console.log(`  rostered bills ${N(pg[2])} - max roster ${N(pg[1])} - >250 (2nd page) ${N(pg[0])}`);

  console.log(`\n=== 0.4b recency: how much of the corpus is plausibly still accruing ===`);
  const rec = await exec(`
    SELECT
      SUM(CASE WHEN latest_action_date >= date('now','-30 days')  THEN 1 ELSE 0 END) AS d30,
      SUM(CASE WHEN latest_action_date >= date('now','-90 days')  THEN 1 ELSE 0 END) AS d90,
      SUM(CASE WHEN latest_action_date >= date('now','-180 days') THEN 1 ELSE 0 END) AS d180,
      SUM(CASE WHEN introduced_date   >= date('now','-30 days')   THEN 1 ELSE 0 END) AS intro30,
      COUNT(*) AS total
    FROM bills`);
  const rc = rec.rows[0] ?? [];
  console.log(`  corpus ${N(rc[4])} - latest_action <=30d ${N(rc[0])} - <=90d ${N(rc[1])} - <=180d ${N(rc[2])} - introduced <=30d ${N(rc[3])}`);

  console.log(`\n=== 0.4c the disagreeing set, by recency (who a scoped sweep would reach) ===`);
  const disRec = await exec(`${ACTIVE_ROSTER_CTE}
    SELECT
      SUM(CASE WHEN b.latest_action_date >= date('now','-90 days') THEN 1 ELSE 0 END) AS d90,
      SUM(CASE WHEN b.latest_action_date >= date('now','-180 days') THEN 1 ELSE 0 END) AS d180,
      COUNT(*) AS total
    FROM bills b JOIN r ON r.bill_id = b.id
    WHERE b.cosponsor_count IS NOT NULL AND r.active <> b.cosponsor_count`);
  const dr = disRec.rows[0] ?? [];
  console.log(`  disagreeing bills ${N(dr[2])} - action <=90d ${N(dr[0])} - <=180d ${N(dr[1])}`);

  // ── The cadence's own inputs ────────────────────────────────────────────────
  // These three were scratch probes while STEP 0 ran and are folded in here
  // because they are LOAD-BEARING for the sweep size: a cadence defended by a
  // gitignored file is the dangling-instrument problem HO 672 closed.

  console.log(`\n=== 0.4d ACCRUAL RATE - read off sponsorship_date in the roster itself ===`);
  const win = await exec(`SELECT MIN(sponsorship_date), MAX(sponsorship_date) FROM bill_cosponsors`);
  console.log(`  sponsorship_date range ${S(win.rows[0]?.[0])} .. ${S(win.rows[0]?.[1])}`);
  console.log(`  (a max several days back means the chamber is in recess and every`);
  console.log(`   figure below is a LOW-SIDE average of the session-time rate)`);
  for (const d of [7, 30, 60]) {
    const a = await exec(`
      SELECT COUNT(*) AS rows, COUNT(DISTINCT bill_id) AS bills
      FROM bill_cosponsors WHERE sponsorship_date >= date('now','-${d} days')`);
    const later = await exec(`
      SELECT COUNT(DISTINCT bill_id) AS bills FROM bill_cosponsors
      WHERE is_original = 0 AND sponsorship_date >= date('now','-${d} days')`);
    console.log(
      `  ${String(d).padStart(2)}d: ${padL(N(a.rows[0]?.[0]), 6)} rows across ${padL(N(a.rows[0]?.[1]), 5)} bills` +
        `  (of which ${padL(N(later.rows[0]?.[0]), 5)} gained a LATER cosponsor)`,
    );
  }

  console.log(`\n=== 0.2e DOES A LATER COSPONSOR MOVE updateDate? (the sweep's justification) ===`);
  console.log(`  If it does, the count-ahead trigger catches the accrual for free on the`);
  console.log(`  next sync upsert. If it does not, nothing count-based can ever see it.`);
  for (const d of [30, 60, 120]) {
    const u = await exec(`
      WITH lastc AS (
        SELECT bill_id, MAX(sponsorship_date) AS last_d
        FROM bill_cosponsors
        WHERE is_original = 0 AND sponsorship_date >= date('now','-${d} days')
        GROUP BY bill_id
      )
      SELECT COUNT(*) AS bills,
             SUM(CASE WHEN substr(b.update_date,1,10) >= lastc.last_d THEN 1 ELSE 0 END) AS caught,
             SUM(CASE WHEN substr(b.update_date,1,10) <  lastc.last_d THEN 1 ELSE 0 END) AS missed
      FROM lastc JOIN bills b ON b.id = lastc.bill_id`);
    const uu = u.rows[0] ?? [];
    const bills = N(uu[0]);
    const caught = N(uu[1]);
    const pct = bills ? Math.round((caught / bills) * 100) : 0;
    console.log(`  ${String(d).padStart(3)}d: ${padL(bills, 5)} bills - updateDate at/after ${padL(caught, 5)} (${pct}%) - before ${padL(N(uu[2]), 5)}`);
  }

  console.log(`\n=== 0.1c THE FIVE, discriminated by sponsorship_date ===`);
  console.log(`  Every cosponsor an ORIGINAL dated at introduction means the roster existed`);
  console.log(`  upstream before the backfill ran - so had the bill been a candidate it`);
  console.log(`  would have been fetched. It has no rows, therefore it was not a candidate.`);
  if (apiKey) {
    for (const id of FIVE) {
      const f = await fetchCosponsors(id, apiKey);
      const dates = f.rows.map((r) => `${r.sponsorship_date}${r.is_original ? "*" : ""}`);
      console.log(`  ${id.padEnd(16)} n=${f.rows.length}  ${dates.join(", ")}   (* = original)`);
      await new Promise((r) => setTimeout(r, 80));
    }
  } else {
    console.log("  (no CONGRESS_API_KEY - skipped)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
