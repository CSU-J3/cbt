// HO 447 read-only coverage diagnostic. Confirms the amendments backfill landed
// and re-checks the HO 446 probe's rates at full scale against the real bills
// corpus. Also reports the magnet-bill fan-out — the surface's cold worst case.
// No writes.
//
//   npx tsx scripts/diagnostic/amendments-coverage-447.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const one = async (sql: string, args: (string | number)[] = []) => (await db.execute({ sql, args })).rows[0];
const many = async (sql: string, args: (string | number)[] = []) => (await db.execute({ sql, args })).rows;
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

console.log("=== amendments coverage (HO 447) ===\n");

const total = Number((await one("SELECT COUNT(*) AS n FROM amendments"))?.n ?? 0);
console.log(`stored rows: ${total}  (HO 446 probe API count was 6,788 — landed-clean check)`);

console.log("\n=== type split ===");
const byType = await many(
  "SELECT amendment_type AS t, COUNT(*) AS n FROM amendments GROUP BY amendment_type ORDER BY n DESC",
);
byType.forEach((r) => console.log(`  ${r.t}: ${r.n}`));

console.log("\n=== join reality (re-check of the probe at full scale) ===");
const withBill = Number((await one("SELECT COUNT(*) AS n FROM amendments WHERE amended_bill_id IS NOT NULL"))?.n ?? 0);
const resolvedBill = Number(
  (await one(
    "SELECT COUNT(*) AS n FROM amendments a JOIN bills b ON b.id = a.amended_bill_id WHERE a.amended_bill_id IS NOT NULL",
  ))?.n ?? 0,
);
const withSubAmend = Number((await one("SELECT COUNT(*) AS n FROM amendments WHERE amends_amendment_id IS NOT NULL"))?.n ?? 0);
const withSponsor = Number((await one("SELECT COUNT(*) AS n FROM amendments WHERE sponsor_bioguide_id IS NOT NULL"))?.n ?? 0);
const withAction = Number((await one("SELECT COUNT(*) AS n FROM amendments WHERE latest_action_text IS NOT NULL"))?.n ?? 0);
console.log(`  amended_bill_id present:            ${withBill}/${total} = ${pct(withBill, total)}`);
console.log(`  ...resolving to a tracked bills row: ${resolvedBill}/${withBill} = ${pct(resolvedBill, withBill)}`);
console.log(`  amends_amendment_id (sub-amendment): ${withSubAmend}/${total} = ${pct(withSubAmend, total)}`);
console.log(`  sponsor_bioguide_id present:         ${withSponsor}/${total} = ${pct(withSponsor, total)}`);
console.log(`  latest_action_text present:          ${withAction}/${total} = ${pct(withAction, total)}`);

// The unresolved amended_bill_id references — expected rare (named/appropriations
// or cross-Congress refs). Surfacing them keeps the "store regardless" bet honest.
const unresolved = await many(
  `SELECT a.amended_bill_id AS bid, COUNT(*) AS n
   FROM amendments a LEFT JOIN bills b ON b.id = a.amended_bill_id
   WHERE a.amended_bill_id IS NOT NULL AND b.id IS NULL
   GROUP BY a.amended_bill_id ORDER BY n DESC LIMIT 15`,
);
if (unresolved.length) {
  console.log(`\n=== unresolved amended_bill_id refs (${unresolved.length} distinct shown) ===`);
  unresolved.forEach((r) => console.log(`  ${r.bid}: ${r.n} amendment(s)`));
} else {
  console.log("\n  (all amended_bill_id refs resolve — no untracked references)");
}

console.log("\n=== magnet-bill fan-out (surface cold worst case: amendments per bill) ===");
const magnets = await many(
  `SELECT a.amended_bill_id AS bid, b.title AS title, COUNT(*) AS n
   FROM amendments a LEFT JOIN bills b ON b.id = a.amended_bill_id
   WHERE a.amended_bill_id IS NOT NULL
   GROUP BY a.amended_bill_id ORDER BY n DESC LIMIT 10`,
);
magnets.forEach((r) =>
  console.log(`  ${r.bid} (n=${r.n}): ${String(r.title ?? "«untracked»").slice(0, 70)}`),
);

process.exit(0);
