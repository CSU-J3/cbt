// HO 674 — backfill `bill_cosponsors` and `bill_related_bills` from the two
// per-bill Congress.gov sub-endpoints.
//
// WHAT THIS WRITES, exactly:
//   bill_cosponsors      — one row per (bill_id, bioguide_id)
//   bill_related_bills   — one row per (bill_id, related_bill_id, relationship_type)
// It writes NOTHING ELSE. `bills` is never touched — in particular
// `bills.cosponsor_count` is left exactly as it is (HO 674 scope), even though
// this script has the live count in hand and can see it disagree.
//
// READ-ONLY BY DEFAULT. A bare invocation and `--check` report what WOULD be
// written and touch nothing. `--write` is required to mutate. A flag you must
// remember in order NOT to write is a flag that will be forgotten exactly once.
//
// RESUMABLE: coverage is read from the DB up front, so a resumed run spends no
// request on a bill already stored. IDEMPOTENT: writes are `INSERT OR REPLACE`
// on the composite PKs, and an already-covered bill is skipped before any fetch.
//
//   npx tsx scripts/backfill-bill-rosters.ts                  # dry run, all bills
//   npx tsx scripts/backfill-bill-rosters.ts --limit 50       # dry run, 50 bills
//   npx tsx scripts/backfill-bill-rosters.ts --limit 50 --write
//   npx tsx scripts/backfill-bill-rosters.ts --bills 119-hr-842,119-s-1
//   npx tsx scripts/backfill-bill-rosters.ts --write --resume  # skip covered
import "dotenv/config";
import { getDb } from "../lib/db";
import {
  fetchCosponsors,
  fetchRelatedBills,
  loadCoveredBillIds,
  type CosponsorRow,
  type RelatedBillRow,
} from "../lib/bill-rosters-sync";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string): string | null => {
  const i = argv.indexOf(f);
  if (i < 0) return null;
  return argv[i + 1] ?? null;
};

const WRITE = has("--write");
const RESUME = has("--resume");
const LIMIT = val("--limit") ? Number(val("--limit")) : null;
const ONLY = val("--bills")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
// Congress.gov measured ceiling is 20,000/hr (x-ratelimit-limit header, HO 674).
// This paces well under it; raise deliberately, not by habit.
const SLEEP_MS = val("--sleep") ? Number(val("--sleep")) : 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Stats = {
  billsConsidered: number;
  billsSkippedCovered: number;
  billsFetched: number;
  requests: number;
  cosponsorRows: number;
  relatedRows: number;
  cosponsorWritten: number;
  relatedWritten: number;
  withdrawnRows: number;
  countAgree: number;
  countDisagree: number;
  disagreements: string[];
  errors: string[];
};

async function writeCosponsors(rows: CosponsorRow[], stamp: string): Promise<number> {
  if (!rows.length) return 0;
  const db = getDb();
  // Batched INSERT OR REPLACE on the composite PK -- re-running produces no
  // duplicates and no growth.
  await db.batch(
    rows.map((r) => ({
      sql: `INSERT OR REPLACE INTO bill_cosponsors
              (bill_id, bioguide_id, sponsorship_date,
               sponsorship_withdrawn_date, is_original, ingested_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        r.bill_id,
        r.bioguide_id,
        r.sponsorship_date,
        r.sponsorship_withdrawn_date,
        r.is_original,
        stamp,
      ],
    })),
    "write",
  );
  return rows.length;
}

async function writeRelated(rows: RelatedBillRow[], stamp: string): Promise<number> {
  if (!rows.length) return 0;
  const db = getDb();
  await db.batch(
    rows.map((r) => ({
      sql: `INSERT OR REPLACE INTO bill_related_bills
              (bill_id, related_bill_id, relationship_type, identified_by, ingested_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [r.bill_id, r.related_bill_id, r.relationship_type, r.identified_by, stamp],
    })),
    "write",
  );
  return rows.length;
}

async function main() {
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const db = getDb();
  const stamp = new Date().toISOString();

  console.log(WRITE ? "MODE: --write (WILL MUTATE)" : "MODE: dry run (no writes)");

  // Candidate set. Bills with cosponsor_count > 0 need a cosponsor fetch; bills
  // with $.relatedBills.count > 0 need a related fetch. HO 674 measured that
  // cosponsor_count IS NULL is *usually* a genuine zero (the API omits the key
  // rather than returning 0) -- but ~5.8% of a 52-bill sample DID have
  // cosponsors, so NULL bills are included rather than assumed empty.
  let sql = `
    SELECT id,
           cosponsor_count,
           CAST(json_extract(raw_json,'$.relatedBills.count') AS INTEGER) AS rb_count
    FROM bills
    WHERE (cosponsor_count IS NULL OR cosponsor_count > 0)
       OR CAST(json_extract(raw_json,'$.relatedBills.count') AS INTEGER) > 0`;
  if (ONLY) sql = `SELECT id, cosponsor_count,
      CAST(json_extract(raw_json,'$.relatedBills.count') AS INTEGER) AS rb_count
      FROM bills WHERE id IN (${ONLY.map((b) => `'${b.replace(/'/g, "")}'`).join(",")})`;
  if (LIMIT && !ONLY) sql += ` LIMIT ${LIMIT}`;

  const rs = await db.execute(sql);
  const bills = rs.rows.map((r) => ({
    id: String(r.id),
    cos: r.cosponsor_count == null ? null : Number(r.cosponsor_count),
    rb: r.rb_count == null ? 0 : Number(r.rb_count),
  }));

  const coveredCos = RESUME ? await loadCoveredBillIds("bill_cosponsors") : new Set<string>();
  const coveredRel = RESUME ? await loadCoveredBillIds("bill_related_bills") : new Set<string>();
  if (RESUME) {
    console.log(`resume: ${coveredCos.size} bills already have cosponsors, ${coveredRel.size} have related`);
  }

  const s: Stats = {
    billsConsidered: bills.length, billsSkippedCovered: 0, billsFetched: 0,
    requests: 0, cosponsorRows: 0, relatedRows: 0, cosponsorWritten: 0,
    relatedWritten: 0, withdrawnRows: 0, countAgree: 0, countDisagree: 0,
    disagreements: [], errors: [],
  };

  let i = 0;
  for (const b of bills) {
    i++;
    const needCos = (b.cos === null || b.cos > 0) && !coveredCos.has(b.id);
    const needRel = b.rb > 0 && !coveredRel.has(b.id);
    if (!needCos && !needRel) { s.billsSkippedCovered++; continue; }
    s.billsFetched++;

    try {
      if (needCos) {
        const f = await fetchCosponsors(b.id, apiKey);
        s.requests += f.requests;
        s.cosponsorRows += f.rows.length;
        s.withdrawnRows += f.rows.filter((r) => r.sponsorship_withdrawn_date).length;

        // Cross-check against the stored count. Compare the ACTIVE subset only:
        // pagination.count excludes withdrawals, bills.cosponsor_count is
        // sourced from it, and rows.length includes them.
        const active = f.rows.filter((r) => !r.sponsorship_withdrawn_date).length;
        if (b.cos != null) {
          if (active === b.cos) s.countAgree++;
          else {
            s.countDisagree++;
            s.disagreements.push(`${b.id} stored=${b.cos} roster_active=${active} api_count=${f.activeCount}`);
          }
        }
        if (WRITE) s.cosponsorWritten += await writeCosponsors(f.rows, stamp);
      }

      if (needRel) {
        const f = await fetchRelatedBills(b.id, apiKey);
        s.requests += f.requests;
        s.relatedRows += f.rows.length;
        if (WRITE) s.relatedWritten += await writeRelated(f.rows, stamp);
      }
    } catch (e) {
      const msg = `${b.id}: ${e instanceof Error ? e.message : String(e)}`;
      s.errors.push(msg);
      console.log(`  ERROR ${msg}`);
    }

    if (i % 25 === 0) {
      console.log(`  ${i}/${bills.length} · fetched=${s.billsFetched} req=${s.requests} cos_rows=${s.cosponsorRows} rel_rows=${s.relatedRows}`);
    }
    await sleep(SLEEP_MS);
  }

  console.log("\n== RESULT ==");
  console.log(`bills considered      : ${s.billsConsidered}`);
  console.log(`bills skipped (covered): ${s.billsSkippedCovered}`);
  console.log(`bills fetched         : ${s.billsFetched}`);
  console.log(`API requests spent    : ${s.requests}`);
  console.log(`cosponsor rows seen   : ${s.cosponsorRows} (withdrawn: ${s.withdrawnRows})`);
  console.log(`related rows seen     : ${s.relatedRows}`);
  console.log(`cosponsor rows WRITTEN: ${s.cosponsorWritten}`);
  console.log(`related rows WRITTEN  : ${s.relatedWritten}`);
  console.log(`count cross-check     : agree=${s.countAgree} disagree=${s.countDisagree}`);
  if (s.disagreements.length) {
    console.log("disagreements (stored count vs active roster):");
    for (const d of s.disagreements.slice(0, 40)) console.log(`  ${d}`);
    if (s.disagreements.length > 40) console.log(`  … +${s.disagreements.length - 40} more`);
  }
  if (s.errors.length) console.log(`errors: ${s.errors.length}`);

  // READ-BACK. A write instrument that does not read back is not an instrument
  // (docs/method.md § Gates). Reports actual table state, not what we think we
  // wrote -- in dry-run mode these should be unchanged from before the run.
  const cosN = await db.execute("SELECT COUNT(*) AS n, COUNT(DISTINCT bill_id) AS b FROM bill_cosponsors");
  const relN = await db.execute("SELECT COUNT(*) AS n, COUNT(DISTINCT bill_id) AS b FROM bill_related_bills");
  console.log("\n== READ-BACK (actual table state) ==");
  console.log(`bill_cosponsors    : ${cosN.rows[0]?.n} rows across ${cosN.rows[0]?.b} bills`);
  console.log(`bill_related_bills : ${relN.rows[0]?.n} rows across ${relN.rows[0]?.b} bills`);
  if (!WRITE) console.log("(dry run — these are pre-existing rows, this run wrote none)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
