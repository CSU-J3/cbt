// HO 675 STEP 0 — the measurements the closure table needs before any render
// code exists. READ-ONLY: SELECT only, no mutations, no schema, no network.
//
//   M1 — the `identical` predicate: every relationship_type value, what
//        LOWER(...) LIKE '%identical%' matches, and the CONTROL that it rejects
//        `Related bill` / `Procedurally related`.
//   M2 — cross-chamber derivation from a bill id, and the multi-identical
//        question the handoff makes STEP 0 answer: of the 69 bills carrying >1
//        identical, how many carry >1 CROSS-CHAMBER identical?
//   M3 — the unresolved-target question: do any of the 82 unresolved related
//        ids sit on a row that would be PROMOTED (cross-chamber identical)?
//   M4 — portrait provenance across the cosponsor population specifically.
//   M5 — the apportionment inputs: party mix over the NON-WITHDRAWN set, how
//        often a third party is present, and where mock-allocate and a
//        proportional rule would disagree.
//   M6 — per-panel row cost: rows read for one bill's two rosters, p50/p95/max.
//   M7 — capture-target probes: the specific bills STEP 3 must open.
//
//   npx tsx scripts/diagnostic/roster-panel-675.ts
import "dotenv/config";
import { createClient, type Client } from "@libsql/client";

function db(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}

const SENATE_TYPES = new Set(["s", "sjres", "sconres", "sres"]);
// Chamber from a bill id: "119-hr-842" -> type segment. Returns null when the
// id does not parse into three segments with a known type.
const ALL_TYPES = new Set([
  "hr", "hjres", "hconres", "hres", "s", "sjres", "sconres", "sres",
]);
function chamberOf(billId: string): "house" | "senate" | null {
  const parts = billId.split("-");
  if (parts.length !== 3) return null;
  const t = parts[1];
  if (!t || !ALL_TYPES.has(t)) return null;
  return SENATE_TYPES.has(t) ? "senate" : "house";
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(2)}%`;
}
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i]!;
}

// ---- the two candidate apportionment rules -------------------------------
const BUDGET = 6;
const PORDER = ["D", "R", "I"] as const;
type P = (typeof PORDER)[number];

// VERBATIM from docs/design/mock-673-sponsor-cosponsor.html's allocate().
function allocMock(counts: Record<string, number>): Record<string, number> {
  const groups = PORDER.filter((p) => (counts[p] ?? 0) > 0);
  const out: Record<string, number> = {};
  groups.forEach((p) => (out[p] = 0));
  let left = Math.min(
    BUDGET,
    groups.reduce((s, p) => s + counts[p]!, 0),
  );
  while (left > 0) {
    const open = groups.filter((p) => out[p]! < counts[p]!);
    if (open.length === 0) break;
    const share = Math.floor(left / open.length);
    if (share === 0) {
      open.sort((a, b) => counts[b]! - counts[a]!);
      for (let i = 0; i < left && i < open.length; i++) out[open[i]!] = out[open[i]!]! + 1;
      break;
    }
    open.forEach((p) => {
      const take = Math.min(share, counts[p]! - out[p]!);
      out[p] = out[p]! + take;
      left -= take;
    });
  }
  return out;
}

// The handoff bullet's literal reading: proportional to the party breakdown,
// largest-remainder, capped at each party's count.
function allocProportional(counts: Record<string, number>): Record<string, number> {
  const groups = PORDER.filter((p) => (counts[p] ?? 0) > 0);
  const total = groups.reduce((s, p) => s + counts[p]!, 0);
  const budget = Math.min(BUDGET, total);
  const out: Record<string, number> = {};
  const rem: { p: P; r: number }[] = [];
  let used = 0;
  groups.forEach((p) => {
    const exact = (counts[p]! / total) * budget;
    const fl = Math.min(Math.floor(exact), counts[p]!);
    out[p] = fl;
    used += fl;
    rem.push({ p, r: exact - Math.floor(exact) });
  });
  rem.sort((a, b) => b.r - a.r || counts[b.p]! - counts[a.p]!);
  let i = 0;
  while (used < budget && i < 1000) {
    const cand = rem[i % rem.length]!;
    if (out[cand.p]! < counts[cand.p]!) {
      out[cand.p] = out[cand.p]! + 1;
      used++;
    }
    i++;
    if (i > rem.length * BUDGET * 2) break;
  }
  return out;
}

function fmtAlloc(a: Record<string, number>): string {
  return PORDER.filter((p) => a[p] != null)
    .map((p) => `${p}${a[p]}`)
    .join("/");
}

async function main() {
  const c = db();
  const line = (s = "") => console.log(s);
  const hdr = (s: string) => {
    line();
    line(`─── ${s} ${"─".repeat(Math.max(0, 68 - s.length))}`);
  };

  // ── M1 — the identical predicate + control ──────────────────────────────
  hdr("M1  relationship_type value set + the `identical` predicate");
  const types = await c.execute(
    `SELECT relationship_type AS t, COUNT(*) AS n
       FROM bill_related_bills GROUP BY 1 ORDER BY n DESC`,
  );
  const PRED = (t: string) => t.toLowerCase().includes("identical");
  let matched = 0,
    rejected = 0;
  line(`  ${"value".padEnd(34)} ${"rows".padStart(7)}  LOWER LIKE '%identical%'`);
  for (const r of types.rows) {
    const t = r.t as string;
    const n = Number(r.n);
    const m = PRED(t);
    if (m) matched += n;
    else rejected += n;
    line(`  ${t.padEnd(34)} ${String(n).padStart(7)}  ${m ? "MATCH" : "reject"}`);
  }
  line(`  distinct values: ${types.rows.length}`);
  line(`  matched rows ${matched} · rejected rows ${rejected} · total ${matched + rejected}`);

  // The equality control the ruling forbids.
  const eq = await c.execute(
    `SELECT COUNT(*) AS n FROM bill_related_bills WHERE relationship_type = 'Identical bill'`,
  );
  const like = await c.execute(
    `SELECT COUNT(*) AS n FROM bill_related_bills
      WHERE LOWER(relationship_type) LIKE '%identical%'`,
  );
  line(
    `  CONTROL  = 'Identical bill' -> ${Number(eq.rows[0]!.n)} rows` +
      ` | LOWER LIKE '%identical%' -> ${Number(like.rows[0]!.n)} rows` +
      ` | equality DROPS ${Number(like.rows[0]!.n) - Number(eq.rows[0]!.n)}`,
  );
  // Non-zero control on the same instrument: the predicate must reject these.
  const ctlReject = await c.execute(
    `SELECT COUNT(*) AS n FROM bill_related_bills
      WHERE relationship_type IN ('Related bill','Procedurally related')
        AND LOWER(relationship_type) LIKE '%identical%'`,
  );
  const ctlExists = await c.execute(
    `SELECT COUNT(*) AS n FROM bill_related_bills
      WHERE relationship_type IN ('Related bill','Procedurally related')`,
  );
  line(
    `  CONTROL  Related/Procedural rows existing: ${Number(ctlExists.rows[0]!.n)}` +
      ` (non-zero, so the instrument can move) · of which predicate matches: ${Number(ctlReject.rows[0]!.n)} (want 0)`,
  );

  // ── M2 — cross-chamber, and the multi-identical question ────────────────
  hdr("M2  cross-chamber identicals + the 69 multi-identical bills");
  const ident = await c.execute(
    `SELECT bill_id, related_bill_id, relationship_type
       FROM bill_related_bills
      WHERE LOWER(relationship_type) LIKE '%identical%'`,
  );
  let unparsableSrc = 0,
    unparsableTgt = 0,
    cross = 0,
    same = 0;
  const crossByBill = new Map<string, number>();
  const identByBill = new Map<string, number>();
  for (const r of ident.rows) {
    const b = r.bill_id as string;
    const t = r.related_bill_id as string;
    identByBill.set(b, (identByBill.get(b) ?? 0) + 1);
    const cb = chamberOf(b);
    const ct = chamberOf(t);
    if (!cb) unparsableSrc++;
    if (!ct) unparsableTgt++;
    if (!cb || !ct) continue;
    if (cb !== ct) {
      cross++;
      crossByBill.set(b, (crossByBill.get(b) ?? 0) + 1);
    } else same++;
  }
  line(`  identical rows total       ${ident.rows.length}`);
  line(`  cross-chamber              ${cross}  (${pct(cross, ident.rows.length)})`);
  line(`  same-chamber               ${same}  (${pct(same, ident.rows.length)})`);
  line(`  unparsable source id       ${unparsableSrc}`);
  line(`  unparsable target id       ${unparsableTgt}`);
  const multiIdent = [...identByBill.values()].filter((n) => n > 1).length;
  const multiCross = [...crossByBill.values()].filter((n) => n > 1).length;
  const crossBills = crossByBill.size;
  line(`  bills carrying >=1 identical        ${identByBill.size}`);
  line(`  bills carrying >1  identical        ${multiIdent}   <- the "69"`);
  line(`  bills carrying >=1 CROSS identical  ${crossBills}`);
  line(
    `  bills carrying >1  CROSS identical  ${multiCross}   <- THE STEP 0 ANSWER` +
      ` (${pct(multiCross, crossBills)} of promoted blocks are multi-row)`,
  );
  const dist = new Map<number, number>();
  for (const n of crossByBill.values()) dist.set(n, (dist.get(n) ?? 0) + 1);
  line(
    `  promoted-block size distribution: ` +
      [...dist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}->${v}`).join("  "),
  );
  // Named example bills for STEP 3.
  const multiCrossIds = [...crossByBill.entries()].filter(([, n]) => n > 1).map(([b]) => b);
  line(`  example multi-cross bills: ${multiCrossIds.slice(0, 6).join(", ") || "(none)"}`);

  // ── M3 — unresolved targets, and whether any would be promoted ──────────
  hdr("M3  unresolved related targets (the 82) vs the promoted row");
  const unres = await c.execute(
    `SELECT r.bill_id, r.related_bill_id, r.relationship_type
       FROM bill_related_bills r
       LEFT JOIN bills b ON b.id = r.related_bill_id
      WHERE b.id IS NULL`,
  );
  line(`  unresolved relationship rows: ${unres.rows.length}`);
  const unresPromoted: string[] = [];
  for (const r of unres.rows) {
    const t = r.relationship_type as string;
    if (!PRED(t)) continue;
    const cb = chamberOf(r.bill_id as string);
    const ct = chamberOf(r.related_bill_id as string);
    if (cb && ct && cb !== ct) unresPromoted.push(`${r.bill_id} -> ${r.related_bill_id} (${t})`);
  }
  line(`  of those, rows that WOULD be promoted (cross-chamber identical): ${unresPromoted.length}`);
  unresPromoted.slice(0, 10).forEach((s) => line(`    ${s}`));

  // ── M4 — portrait provenance across the cosponsor population ────────────
  hdr("M4  depiction_url coverage over the cosponsor population");
  const cov = await c.execute(
    `SELECT COUNT(*) AS rows_total,
            SUM(CASE WHEN m.bioguide_id IS NULL THEN 1 ELSE 0 END) AS unmatched,
            SUM(CASE WHEN m.bioguide_id IS NOT NULL AND (m.depiction_url IS NULL OR m.depiction_url = '')
                     THEN 1 ELSE 0 END) AS no_photo
       FROM bill_cosponsors bc
       LEFT JOIN members m ON m.bioguide_id = bc.bioguide_id
      WHERE bc.sponsorship_withdrawn_date IS NULL`,
  );
  const r0 = cov.rows[0]!;
  line(`  active cosponsor rows        ${Number(r0.rows_total)}`);
  line(`  rows with no members match   ${Number(r0.unmatched)}`);
  line(`  rows whose member has NO depiction_url  ${Number(r0.no_photo)}`);
  const distinctCos = await c.execute(
    `SELECT COUNT(DISTINCT bc.bioguide_id) AS d,
            SUM(CASE WHEN m.depiction_url IS NULL OR m.depiction_url='' THEN 1 ELSE 0 END) AS nod
       FROM (SELECT DISTINCT bioguide_id FROM bill_cosponsors
              WHERE sponsorship_withdrawn_date IS NULL) bc
       LEFT JOIN members m ON m.bioguide_id = bc.bioguide_id`,
  );
  line(
    `  distinct cosponsor members ${Number(distinctCos.rows[0]!.d)}` +
      ` · without depiction_url ${Number(distinctCos.rows[0]!.nod)}`,
  );
  const noPhotoWho = await c.execute(
    `SELECT DISTINCT bc.bioguide_id, m.name, m.party
       FROM bill_cosponsors bc
       LEFT JOIN members m ON m.bioguide_id = bc.bioguide_id
      WHERE bc.sponsorship_withdrawn_date IS NULL
        AND (m.bioguide_id IS NULL OR m.depiction_url IS NULL OR m.depiction_url='')
      LIMIT 20`,
  );
  noPhotoWho.rows.forEach((r) =>
    line(`    ${r.bioguide_id} ${String(r.name ?? "(no members row)")} ${String(r.party ?? "")}`),
  );
  // A bill that actually renders one, for STEP 3's probe-not-browse requirement.
  if (noPhotoWho.rows.length > 0) {
    const ids = noPhotoWho.rows.map((r) => `'${r.bioguide_id}'`).join(",");
    const bills = await c.execute(
      `SELECT bc.bioguide_id, bc.bill_id, COUNT(*) OVER () AS _n
         FROM bill_cosponsors bc
        WHERE bc.bioguide_id IN (${ids}) AND bc.sponsorship_withdrawn_date IS NULL
        LIMIT 10`,
    );
    bills.rows.forEach((r) => line(`    renders on: ${r.bill_id} (via ${r.bioguide_id})`));
  }

  // ── M5 — party mix + the two apportionment rules ────────────────────────
  hdr("M5  party mix over the non-withdrawn set; mock-allocate vs proportional");
  const mix = await c.execute(
    `SELECT bc.bill_id AS b,
            SUM(CASE WHEN m.party='D' THEN 1 ELSE 0 END) AS d,
            SUM(CASE WHEN m.party='R' THEN 1 ELSE 0 END) AS r,
            SUM(CASE WHEN m.party IS NOT NULL AND m.party NOT IN ('D','R') THEN 1 ELSE 0 END) AS i,
            SUM(CASE WHEN m.party IS NULL THEN 1 ELSE 0 END) AS unk,
            COUNT(*) AS n
       FROM bill_cosponsors bc
       LEFT JOIN members m ON m.bioguide_id = bc.bioguide_id
      WHERE bc.sponsorship_withdrawn_date IS NULL
      GROUP BY 1`,
  );
  let threeParty = 0,
    twoParty = 0,
    onePartyOnly = 0,
    withUnk = 0,
    disagree = 0,
    under6 = 0,
    exactly6 = 0;
  const disagreeEx: string[] = [];
  const sizes: number[] = [];
  for (const row of mix.rows) {
    const d = Number(row.d),
      r = Number(row.r),
      i = Number(row.i),
      unk = Number(row.unk),
      n = Number(row.n);
    sizes.push(n);
    if (unk > 0) withUnk++;
    const counts: Record<string, number> = { D: d, R: r, I: i };
    const present = PORDER.filter((p) => counts[p]! > 0).length;
    if (present >= 3) threeParty++;
    else if (present === 2) twoParty++;
    else onePartyOnly++;
    if (n < 6) under6++;
    if (n === 6) exactly6++;
    const a = allocMock(counts);
    const b = allocProportional(counts);
    if (fmtAlloc(a) !== fmtAlloc(b)) {
      disagree++;
      if (disagreeEx.length < 8)
        disagreeEx.push(
          `${row.b}  D${d}/R${r}/I${i}  mock=${fmtAlloc(a)}  proportional=${fmtAlloc(b)}`,
        );
    }
  }
  const nb = mix.rows.length;
  line(`  bills with >=1 active cosponsor  ${nb}`);
  line(`  single-party rosters             ${onePartyOnly}  (${pct(onePartyOnly, nb)})  <- where redistribution fires`);
  line(`  two-party rosters                ${twoParty}  (${pct(twoParty, nb)})`);
  line(`  three-party rosters              ${threeParty}  (${pct(threeParty, nb)})`);
  line(`  rosters with an unknown-party member ${withUnk}`);
  line(`  rosters under 6                  ${under6}   · exactly 6  ${exactly6}`);
  line(`  MOCK vs PROPORTIONAL disagree on ${disagree} bills (${pct(disagree, nb)})`);
  disagreeEx.forEach((s) => line(`    ${s}`));
  // Worked cases the closure table must state.
  hdr("M5b apportionment, worked (mock rule, verbatim from the ruling record)");
  const cases: [string, Record<string, number>][] = [
    ["d=0 (R only, 4)", { D: 0, R: 4, I: 0 }],
    ["d=0 (R only, 40)", { D: 0, R: 40, I: 0 }],
    ["other>0 (D6/R2/I1)", { D: 6, R: 2, I: 1 }],
    ["fewer than six (D1/R1)", { D: 1, R: 1, I: 0 }],
    ["fewer than six (D2)", { D: 2, R: 0, I: 0 }],
    ["exactly six (D3/R3)", { D: 3, R: 3, I: 0 }],
    ["exactly six (D5/R1)", { D: 5, R: 1, I: 0 }],
    ["party at exactly half (D3/R3 of 6)", { D: 3, R: 3, I: 0 }],
    ["lopsided (D21/R1)", { D: 21, R: 1, I: 0 }],
    ["lopsided (D218/R184)", { D: 218, R: 184, I: 0 }],
    ["tie-break stress (D1/R1/I1, budget 6)", { D: 1, R: 1, I: 1 }],
    ["tie-break stress (D9/R5)", { D: 9, R: 5, I: 0 }],
    ["zero cosponsors", { D: 0, R: 0, I: 0 }],
  ];
  for (const [label, counts] of cases) {
    const a = allocMock(counts);
    const drawn = PORDER.reduce((s, p) => s + (a[p] ?? 0), 0);
    const tot = PORDER.reduce((s, p) => s + (counts[p] ?? 0), 0);
    line(`  ${label.padEnd(40)} -> ${fmtAlloc(a).padEnd(12)} (${drawn} of ${tot})`);
  }

  // ── M6 — per-panel row cost ─────────────────────────────────────────────
  hdr("M6  rows read per panel open");
  const sorted = sizes.slice().sort((a, b) => a - b);
  line(
    `  cosponsor rows/bill: p50 ${quantile(sorted, 0.5)} · p95 ${quantile(sorted, 0.95)}` +
      ` · p99 ${quantile(sorted, 0.99)} · max ${sorted[sorted.length - 1] ?? 0}` +
      ` · mean ${(sizes.reduce((a, b) => a + b, 0) / (sizes.length || 1)).toFixed(1)}`,
  );
  const relSizes = await c.execute(
    `SELECT bill_id, COUNT(*) AS n FROM bill_related_bills GROUP BY 1`,
  );
  const rs = relSizes.rows.map((r) => Number(r.n)).sort((a, b) => a - b);
  line(
    `  related rows/bill:   p50 ${quantile(rs, 0.5)} · p95 ${quantile(rs, 0.95)}` +
      ` · p99 ${quantile(rs, 0.99)} · max ${rs[rs.length - 1] ?? 0}` +
      ` · mean ${(rs.reduce((a, b) => a + b, 0) / (rs.length || 1)).toFixed(1)}`,
  );
  const tot = await c.execute(
    `SELECT (SELECT COUNT(*) FROM bill_cosponsors) AS c,
            (SELECT COUNT(*) FROM bill_related_bills) AS r,
            (SELECT COUNT(*) FROM bills) AS b`,
  );
  line(
    `  corpus: bill_cosponsors ${Number(tot.rows[0]!.c)} · bill_related_bills ${Number(tot.rows[0]!.r)}` +
      ` · bills ${Number(tot.rows[0]!.b)}`,
  );
  // What a full-corpus cache flush would cost IF these rode a bills-tagged query.
  line(
    `  a full-corpus roster read would be ${Number(tot.rows[0]!.c) + Number(tot.rows[0]!.r)} rows;` +
      ` per-bill lazy is the p95 pair above.`,
  );

  // ── M7 — capture targets ────────────────────────────────────────────────
  hdr("M7  STEP 3 capture targets, found by probe");
  const q = async (label: string, sql: string) => {
    const rr = await c.execute(sql);
    line(`  ${label}`);
    rr.rows.slice(0, 5).forEach((r) =>
      line(`    ${Object.entries(r as Record<string, unknown>).map(([k, v]) => `${k}=${v}`).join(" ")}`),
    );
    if (rr.rows.length === 0) line("    (none)");
  };
  await q(
    "zero cosponsors (bill exists, no roster rows):",
    `SELECT b.id, b.cosponsor_count FROM bills b
      WHERE NOT EXISTS (SELECT 1 FROM bill_cosponsors x WHERE x.bill_id=b.id)
        AND b.congress=119 AND b.summary IS NOT NULL LIMIT 5`,
  );
  await q(
    "exactly one cosponsor:",
    `SELECT bill_id, COUNT(*) n FROM bill_cosponsors
      WHERE sponsorship_withdrawn_date IS NULL GROUP BY 1 HAVING n=1 LIMIT 5`,
  );
  await q(
    "exactly six cosponsors:",
    `SELECT bill_id, COUNT(*) n FROM bill_cosponsors
      WHERE sponsorship_withdrawn_date IS NULL GROUP BY 1 HAVING n=6 LIMIT 5`,
  );
  await q(
    "many cosponsors (top 5):",
    `SELECT bill_id, COUNT(*) n FROM bill_cosponsors
      WHERE sponsorship_withdrawn_date IS NULL GROUP BY 1 ORDER BY n DESC LIMIT 5`,
  );
  await q(
    "withdrawn cosponsor present:",
    `SELECT bill_id,
            SUM(CASE WHEN sponsorship_withdrawn_date IS NOT NULL THEN 1 ELSE 0 END) w,
            SUM(CASE WHEN sponsorship_withdrawn_date IS NULL THEN 1 ELSE 0 END) a
       FROM bill_cosponsors GROUP BY 1 HAVING w > 0 ORDER BY a DESC LIMIT 5`,
  );
  await q(
    "single-party roster with >6 members (redistribution fires):",
    `SELECT bc.bill_id,
            SUM(CASE WHEN m.party='D' THEN 1 ELSE 0 END) d,
            SUM(CASE WHEN m.party='R' THEN 1 ELSE 0 END) r,
            COUNT(*) n
       FROM bill_cosponsors bc LEFT JOIN members m ON m.bioguide_id=bc.bioguide_id
      WHERE bc.sponsorship_withdrawn_date IS NULL
      GROUP BY 1 HAVING (d=0 OR r=0) AND n>6 ORDER BY n DESC LIMIT 5`,
  );
  await q(
    "cross-chamber identical present:",
    `SELECT r.bill_id, r.related_bill_id, r.relationship_type
       FROM bill_related_bills r
      WHERE LOWER(r.relationship_type) LIKE '%identical%'
        AND SUBSTR(r.bill_id, INSTR(r.bill_id,'-')+1, 1) <> SUBSTR(r.related_bill_id, INSTR(r.related_bill_id,'-')+1, 1)
      LIMIT 5`,
  );
  await q(
    "same-chamber identical present (must stay BELOW):",
    `SELECT r.bill_id, r.related_bill_id, r.relationship_type
       FROM bill_related_bills r
      WHERE LOWER(r.relationship_type) LIKE '%identical%'
        AND SUBSTR(r.bill_id, INSTR(r.bill_id,'-')+1, 1) = SUBSTR(r.related_bill_id, INSTR(r.related_bill_id,'-')+1, 1)
      LIMIT 5`,
  );
  await q(
    "Identical Bill (Became Law) rows:",
    `SELECT bill_id, related_bill_id, relationship_type FROM bill_related_bills
      WHERE relationship_type LIKE '%Became Law%' LIMIT 5`,
  );
  await q(
    "related bills but NO identical:",
    `SELECT r.bill_id, COUNT(*) n FROM bill_related_bills r
      WHERE NOT EXISTS (SELECT 1 FROM bill_related_bills x
                         WHERE x.bill_id=r.bill_id AND LOWER(x.relationship_type) LIKE '%identical%')
      GROUP BY 1 ORDER BY n DESC LIMIT 5`,
  );
  await q(
    "no related bills at all (and has a summary, so the panel is worth opening):",
    `SELECT b.id FROM bills b
      WHERE NOT EXISTS (SELECT 1 FROM bill_related_bills x WHERE x.bill_id=b.id)
        AND b.congress=119 AND b.summary IS NOT NULL LIMIT 5`,
  );

  line();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ── M8 — the two forks, quantified (appended after the first run) ─────────
async function m8() {
  const c = db();
  const line = (s = "") => console.log(s);
  line();
  line("─── M8  the two forks, quantified ──────────────────────────────────────");

  // 8a — where does HO 674's "69" come from? Equality vs the LIKE predicate.
  const byEq = await c.execute(
    `SELECT bill_id, COUNT(*) n FROM bill_related_bills
      WHERE relationship_type = 'Identical bill' GROUP BY 1 HAVING n > 1`,
  );
  const byLike = await c.execute(
    `SELECT bill_id, COUNT(*) n FROM bill_related_bills
      WHERE LOWER(relationship_type) LIKE '%identical%' GROUP BY 1 HAVING n > 1`,
  );
  const byEqDistinct = await c.execute(
    `SELECT bill_id, COUNT(DISTINCT related_bill_id) n FROM bill_related_bills
      WHERE relationship_type = 'Identical bill' GROUP BY 1 HAVING n > 1`,
  );
  line(`  bills with >1 identical, = 'Identical bill'          ${byEq.rows.length}`);
  line(`  bills with >1 identical, LOWER LIKE '%identical%'    ${byLike.rows.length}`);
  line(`  bills with >1 DISTINCT identical target, equality    ${byEqDistinct.rows.length}`);

  // 8b — how often the mock rule lands on exactly 3/3 (the handoff's "fixed 3/3").
  // 8c — how often proportional allocates ZERO faces to a party that IS present.
  const mix = await c.execute(
    `SELECT bc.bill_id AS b,
            SUM(CASE WHEN m.party='D' THEN 1 ELSE 0 END) AS d,
            SUM(CASE WHEN m.party='R' THEN 1 ELSE 0 END) AS r,
            SUM(CASE WHEN m.party IS NOT NULL AND m.party NOT IN ('D','R') THEN 1 ELSE 0 END) AS i
       FROM bill_cosponsors bc
       LEFT JOIN members m ON m.bioguide_id = bc.bioguide_id
      WHERE bc.sponsorship_withdrawn_date IS NULL
      GROUP BY 1`,
  );
  let two = 0,
    twoIs33 = 0,
    propErases = 0,
    mockErases = 0;
  const eraseEx: string[] = [];
  for (const row of mix.rows) {
    const counts: Record<string, number> = {
      D: Number(row.d),
      R: Number(row.r),
      I: Number(row.i),
    };
    const present = PORDER.filter((p) => counts[p]! > 0);
    const a = allocMock(counts);
    const b = allocProportional(counts);
    if (present.length === 2) {
      two++;
      if (present.every((p) => a[p] === 3)) twoIs33++;
    }
    if (present.some((p) => (b[p] ?? 0) === 0)) {
      propErases++;
      if (eraseEx.length < 8)
        eraseEx.push(
          `${row.b}  D${counts.D}/R${counts.R}/I${counts.I}  mock=${fmtAlloc(a)}  proportional=${fmtAlloc(b)}`,
        );
    }
    if (present.some((p) => (a[p] ?? 0) === 0)) mockErases++;
  }
  line(`  two-party rosters                                    ${two}`);
  line(`  ... of which the MOCK rule draws exactly 3/3         ${twoIs33} (${pct(twoIs33, two)})`);
  line(`  rosters where PROPORTIONAL gives a present party 0 faces  ${propErases}`);
  line(`  rosters where MOCK        gives a present party 0 faces  ${mockErases}`);
  eraseEx.forEach((s) => line(`    ${s}`));
  line();
}
m8().catch((e) => {
  console.error(e);
  process.exit(1);
});
