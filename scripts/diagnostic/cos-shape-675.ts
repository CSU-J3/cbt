// HO 675 STEP 0 — the cosponsor query SHAPE, priced. The first probe measured
// 1,015 rows read to draw SIX faces on 119-hr-842 (338 cosponsors), a 3.0x
// multiple over the rows returned. This asks whether a cheaper shape exists,
// by measurement rather than by reasoning. READ-ONLY.
import "dotenv/config";
import { createClient } from "@libsql/client";
let tapped = 0;
const realFetch = globalThis.fetch;
const tapFetch: typeof fetch = async (i, init) => {
  const res = await realFetch(i as never, init as never);
  try {
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.rows_read === "number") tapped += o.rows_read;
        Object.values(o).forEach(walk);
      }
    };
    walk(await res.clone().json());
  } catch { /* non-JSON */ }
  return res;
};
const tap = () => { const v = tapped; tapped = 0; return v; };

const BILLS = ["119-hr-842", "119-hr-14", "119-hconres-3", "119-hconres-29", "119-hr-452"];

async function main() {
  const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN, fetch: tapFetch });
  const line = (s = "") => console.log(s);
  const run = async (sql: string, args: unknown[]) => {
    tap();
    const r = await c.execute({ sql, args: args as never });
    return { read: tap(), n: r.rows.length, rows: r.rows };
  };

  line("─── S1  candidate shapes, rows READ per bill ────────────────────────");
  line(`  ${"bill".padEnd(15)} ${"cos".padStart(5)} | A full-join | B counts | C top6/party | B+C | D no-join`);
  for (const b of BILLS) {
    const A = await run(
      `SELECT bc.bioguide_id, bc.sponsorship_date, bc.is_original, m.first_name, m.last_name,
              m.name, m.party, m.state, m.district, m.chamber, m.depiction_url
         FROM bill_cosponsors bc JOIN members m ON m.bioguide_id = bc.bioguide_id
        WHERE bc.bill_id = ? AND bc.sponsorship_withdrawn_date IS NULL
        ORDER BY bc.sponsorship_date ASC NULLS LAST, bc.bioguide_id ASC`, [b]);
    const B = await run(
      `SELECT m.party, COUNT(*) n FROM bill_cosponsors bc
         JOIN members m ON m.bioguide_id = bc.bioguide_id
        WHERE bc.bill_id = ? AND bc.sponsorship_withdrawn_date IS NULL GROUP BY 1`, [b]);
    // C: the <=6 actually drawn, one statement per party present.
    let cRead = 0, cN = 0;
    for (const r of B.rows) {
      const C = await run(
        `SELECT bc.bioguide_id, bc.sponsorship_date, m.first_name, m.last_name, m.name,
                m.party, m.state, m.district, m.chamber, m.depiction_url
           FROM bill_cosponsors bc JOIN members m ON m.bioguide_id = bc.bioguide_id
          WHERE bc.bill_id = ? AND bc.sponsorship_withdrawn_date IS NULL AND m.party = ?
          ORDER BY bc.sponsorship_date ASC NULLS LAST, bc.bioguide_id ASC LIMIT 6`, [b, r.party]);
      cRead += C.read; cN += C.n;
    }
    const D = await run(
      `SELECT bioguide_id, sponsorship_date FROM bill_cosponsors
        WHERE bill_id = ? AND sponsorship_withdrawn_date IS NULL`, [b]);
    line(`  ${b.padEnd(15)} ${String(A.n).padStart(5)} | ${String(A.read).padStart(10)} | ${String(B.read).padStart(8)} | ${String(cRead).padStart(11)} | ${String(B.read + cRead).padStart(3)} | ${String(D.read).padStart(7)}`);
  }
  line();
  line("  A = one full join, every active cosponsor (the obvious shape)");
  line("  B = party counts only (GROUP BY), the split's input");
  line("  C = the <=6 drawn faces, one LIMIT 6 statement per party present");
  line("  D = roster ids only, NO members join (party unavailable -> cannot split)");
  line();
}
main().catch((e) => { console.error(e); process.exit(1); });
