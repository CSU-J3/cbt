// HO 675 STEP 0 (cont.) — the two caps the design needs a number for, and the
// members columns the hover name/meta reads. READ-ONLY.
//   npx tsx scripts/diagnostic/roster-cap-675.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const SEN = new Set(["s", "sjres", "sconres", "sres"]);
const ALL = new Set(["hr","hjres","hconres","hres","s","sjres","sconres","sres"]);
function chamberOf(id: string): "house" | "senate" | null {
  const p = id.split("-");
  if (p.length !== 3 || !p[1] || !ALL.has(p[1])) return null;
  return SEN.has(p[1]) ? "senate" : "house";
}

async function main() {
  const c = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const line = (s = "") => console.log(s);

  line("─── C1  members columns available for the hover tip ────────────────");
  const cols = await c.execute(`PRAGMA table_info(members)`);
  line("  " + cols.rows.map((r) => r.name).join(", "));

  line();
  line("─── C2  'also related' rows per bill (the non-promoted remainder) ───");
  const rows = await c.execute(
    `SELECT bill_id, related_bill_id, relationship_type FROM bill_related_bills`,
  );
  const restByBill = new Map<string, number>();
  const bills = new Set<string>();
  for (const r of rows.rows) {
    const b = r.bill_id as string;
    bills.add(b);
    const t = (r.relationship_type as string).toLowerCase();
    const cb = chamberOf(b);
    const ct = chamberOf(r.related_bill_id as string);
    const promoted = t.includes("identical") && cb && ct && cb !== ct;
    if (!promoted) restByBill.set(b, (restByBill.get(b) ?? 0) + 1);
  }
  const rest = [...bills].map((b) => restByBill.get(b) ?? 0).sort((a, b) => a - b);
  const n = rest.length;
  const cov = (k: number) => {
    const under = rest.filter((x) => x <= k).length;
    return `cap ${String(k).padStart(2)} covers ${String(under).padStart(5)}/${n} bills = ${((under / n) * 100).toFixed(2)}%`;
  };
  line(`  bills with >=1 related row: ${n}`);
  line(`  distribution: ` + [0,1,2,3,4,5,6,8,10,20,50].map((k) => `<=${k}:${rest.filter((x)=>x<=k).length}`).join(" "));
  [2,3,4,5,6,8,10].forEach((k) => line("  " + cov(k)));
  line(`  max ${rest[n-1]}`);

  line();
  line("─── C3  cosponsor party-group sizes above the 6-face budget ─────────");
  const grp = await c.execute(
    `SELECT bc.bill_id b, m.party p, COUNT(*) n
       FROM bill_cosponsors bc JOIN members m ON m.bioguide_id = bc.bioguide_id
      WHERE bc.sponsorship_withdrawn_date IS NULL
      GROUP BY 1,2`,
  );
  const partiesSeen = new Map<string, number>();
  for (const r of grp.rows) partiesSeen.set(String(r.p), (partiesSeen.get(String(r.p)) ?? 0) + 1);
  line(`  distinct party values across cosponsor groups: ` +
    [...partiesSeen.entries()].map(([k,v]) => `${k}=${v} groups`).join("  "));

  line();
  line("─── C4  a bill whose PROMOTED target is unresolved (STEP 3 target) ──");
  const un = await c.execute(
    `SELECT r.bill_id, r.related_bill_id, r.relationship_type,
            (SELECT COUNT(*) FROM bill_related_bills x WHERE x.bill_id = r.bill_id) AS total,
            (SELECT COUNT(*) FROM bill_cosponsors x WHERE x.bill_id = r.bill_id) AS cos,
            b.summary IS NOT NULL AS has_summary
       FROM bill_related_bills r
       LEFT JOIN bills t ON t.id = r.related_bill_id
       JOIN bills b ON b.id = r.bill_id
      WHERE t.id IS NULL AND LOWER(r.relationship_type) LIKE '%identical%'
      LIMIT 20`,
  );
  un.rows.forEach((r) =>
    line(`  ${r.bill_id} -> ${r.related_bill_id} [${r.relationship_type}] total_rel=${r.total} cos=${r.cos} summary=${r.has_summary}`),
  );

  line();
  line("─── C5  named STEP 3 targets, resolved ──────────────────────────────");
  const named = async (label: string, sql: string) => {
    const rr = await c.execute(sql);
    line(`  ${label}`);
    rr.rows.slice(0, 4).forEach((r) =>
      line("    " + Object.entries(r as Record<string, unknown>).map(([k, v]) => `${k}=${v}`).join(" ")),
    );
    if (!rr.rows.length) line("    (none)");
  };
  await named("multi-CROSS-chamber identical (promoted block is 2 rows):",
    `SELECT r.bill_id, COUNT(*) n, GROUP_CONCAT(r.related_bill_id) tgts
       FROM bill_related_bills r
      WHERE LOWER(r.relationship_type) LIKE '%identical%'
        AND SUBSTR(r.bill_id, INSTR(r.bill_id,'-')+1, 1) <> SUBSTR(r.related_bill_id, INSTR(r.related_bill_id,'-')+1, 1)
      GROUP BY 1 HAVING n > 1 ORDER BY n DESC LIMIT 4`);
  await named("same-chamber identical AND at least one other related row:",
    `SELECT r.bill_id, COUNT(*) n FROM bill_related_bills r
      WHERE r.bill_id IN (SELECT x.bill_id FROM bill_related_bills x
                           WHERE LOWER(x.relationship_type) LIKE '%identical%'
                             AND SUBSTR(x.bill_id, INSTR(x.bill_id,'-')+1, 1) = SUBSTR(x.related_bill_id, INSTR(x.related_bill_id,'-')+1, 1))
      GROUP BY 1 ORDER BY n DESC LIMIT 4`);
  await named("bill with a withdrawn cosponsor AND a cross-chamber identical:",
    `SELECT c.bill_id, COUNT(*) w FROM bill_cosponsors c
      WHERE c.sponsorship_withdrawn_date IS NOT NULL
        AND EXISTS (SELECT 1 FROM bill_related_bills r WHERE r.bill_id=c.bill_id
                      AND LOWER(r.relationship_type) LIKE '%identical%')
      GROUP BY 1 LIMIT 4`);
  await named("bill cosponsored by A000383 or G000608 (no depiction_url) with few cosponsors so the face is IN the 6:",
    `SELECT bc.bill_id, COUNT(*) n FROM bill_cosponsors bc
      WHERE bc.bill_id IN (SELECT bill_id FROM bill_cosponsors
                            WHERE bioguide_id IN ('A000383','G000608')
                              AND sponsorship_withdrawn_date IS NULL)
        AND bc.sponsorship_withdrawn_date IS NULL
      GROUP BY 1 HAVING n <= 6 ORDER BY n ASC LIMIT 6`);
  line();
}
main().catch((e) => { console.error(e); process.exit(1); });
