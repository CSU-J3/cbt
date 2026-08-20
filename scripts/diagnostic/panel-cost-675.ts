// HO 675 STEP 0 — price the panel open. READ-ONLY. Runs the THREE queries the
// panel route already issues plus the TWO this HO proposes, against a real
// sample of bills, and reports libsql's rowsRead per statement.
//   npx tsx scripts/diagnostic/panel-cost-675.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const MEETING_JOIN = `SELECT m.event_id FROM committee_meetings m
  JOIN meeting_bills mb ON mb.event_id = m.event_id WHERE mb.bill_id = ?
  ORDER BY m.meeting_date DESC NULLS LAST`;
const COMMITTEE_Q = `SELECT cb.activity_type, cb.activity_date, c.system_code, c.name, c.chamber,
    c.parent_system_code, p.name AS parent_name
  FROM committee_bills cb JOIN committees c ON c.system_code = cb.committee_system_code
  LEFT JOIN committees p ON p.system_code = c.parent_system_code
  WHERE cb.bill_id = ? ORDER BY cb.activity_date DESC NULLS LAST, c.name ASC`;
const NEWS_Q = `SELECT m.id FROM news_mentions m INNER JOIN bills b ON b.id = m.bill_id
  WHERE m.bill_id = ? AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
  ORDER BY m.published_at DESC, m.id DESC LIMIT 5`;
// proposed
const COS_Q = `SELECT bc.bioguide_id, bc.sponsorship_date, bc.is_original,
    m.first_name, m.last_name, m.name, m.party, m.state, m.district, m.chamber, m.depiction_url
  FROM bill_cosponsors bc JOIN members m ON m.bioguide_id = bc.bioguide_id
  WHERE bc.bill_id = ? AND bc.sponsorship_withdrawn_date IS NULL
  ORDER BY bc.sponsorship_date ASC NULLS LAST, bc.bioguide_id ASC`;
const REL_Q = `SELECT r.related_bill_id, r.relationship_type,
    b.title, b.bill_type, b.bill_number, b.introduced_date, b.stage
  FROM bill_related_bills r LEFT JOIN bills b ON b.id = r.related_bill_id
  WHERE r.bill_id = ?`;

// rowsRead is NOT exposed by this @libsql/client version (it read `undefined`
// on the first attempt, which is why this taps the transport instead — the
// same instrument HO 670 used on the server). Turso's HTTP response carries
// rows_read per statement in the pipeline result; this sums it per call.
let tapped = 0;
const realFetch = globalThis.fetch;
const tapFetch: typeof fetch = async (input, init) => {
  const res = await realFetch(input as never, init as never);
  const clone = res.clone();
  try {
    const j: unknown = await clone.json();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.rows_read === "number") tapped += o.rows_read;
        Object.values(o).forEach(walk);
      }
    };
    walk(j);
  } catch { /* non-JSON body: nothing to read */ }
  return res;
};
function readTap(): number { const v = tapped; tapped = 0; return v; }

async function main() {
  const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN, fetch: tapFetch });
  const line = (s = "") => console.log(s);

  // A sample that is not cherry-picked small: the typical case plus the tails.
  const sample = await c.execute(
    `SELECT b.id,
        (SELECT COUNT(*) FROM bill_cosponsors x WHERE x.bill_id=b.id AND x.sponsorship_withdrawn_date IS NULL) cos,
        (SELECT COUNT(*) FROM bill_related_bills x WHERE x.bill_id=b.id) rel
     FROM bills b WHERE b.congress=119 ORDER BY b.id LIMIT 40`,
  );
  const extras = ["119-hr-842", "119-hr-452", "119-hr-7567", "119-hconres-90", "119-hr-14"];

  const ids = [...sample.rows.map((r) => String(r.id)), ...extras];
  let curTotal = 0, newTotal = 0;
  const rows: string[] = [];
  for (const id of ids) {
    readTap();
    const cm = await c.execute({ sql: COMMITTEE_Q, args: [id] });
    const rCm = readTap();
    const nw = await c.execute({ sql: NEWS_Q, args: [id] });
    const rNw = readTap();
    const mt = await c.execute({ sql: MEETING_JOIN, args: [id] });
    const rMt = readTap();
    const cs = await c.execute({ sql: COS_Q, args: [id] });
    const rCs = readTap();
    const rl = await c.execute({ sql: REL_Q, args: [id] });
    const rRl = readTap();
    void cm; void nw; void mt;
    const cur = rCm + rNw + rMt;
    const add = rCs + rRl;
    curTotal += cur; newTotal += add;
    rows.push(
      `  ${id.padEnd(16)} current ${String(cur).padStart(5)} (cmte ${rCm}/news ${rNw}/mtg ${rMt})` +
      `  + rosters ${String(add).padStart(5)} (cos ${rCs}[${cs.rows.length} rows]/rel ${rRl}[${rl.rows.length}])` +
      `  = ${cur + add}`,
    );
  }
  line("─── P1  rows READ per panel open, measured (libsql rowsRead) ────────");
  rows.forEach((r) => line(r));
  line();
  line(`  n = ${ids.length} bills`);
  line(`  current panel open   total ${curTotal}  mean ${(curTotal / ids.length).toFixed(1)} rows`);
  line(`  roster addition      total ${newTotal}  mean ${(newTotal / ids.length).toFixed(1)} rows`);
  line(`  multiple             ${((curTotal + newTotal) / (curTotal || 1)).toFixed(2)}x`);
  line();
  line("─── P2  the counterfactual: rosters on the ROW payload instead ──────");
  const feed = await c.execute(
    `SELECT AVG(cos) ac, AVG(rel) ar FROM (
       SELECT (SELECT COUNT(*) FROM bill_cosponsors x WHERE x.bill_id=b.id AND x.sponsorship_withdrawn_date IS NULL) cos,
              (SELECT COUNT(*) FROM bill_related_bills x WHERE x.bill_id=b.id) rel
         FROM bills b)`,
  );
  const ac = Number(feed.rows[0]!.ac), ar = Number(feed.rows[0]!.ar);
  line(`  corpus mean per bill: cosponsors ${ac.toFixed(2)} · related ${ar.toFixed(2)} · sum ${(ac + ar).toFixed(2)}`);
  line(`  a 50-row feed page would carry ${Math.round((ac + ar) * 50)} extra rows PER RENDER,`);
  line(`  and a bills-tagged entry is re-read after every flush (HO 671/672: ~7.3 flushes/day).`);
  line(`  On the lazy panel route the same data costs ${(newTotal / ids.length).toFixed(1)} rows and only for bills actually opened.`);
  line();
}
main().catch((e) => { console.error(e); process.exit(1); });
