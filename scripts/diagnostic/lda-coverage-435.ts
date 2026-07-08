// HO 435 read-only coverage diagnostic. Confirms the backfill landed and
// re-checks the HO 434 probe's rates at full scale against the real bills
// corpus. No writes.
//
//   npx tsx scripts/diagnostic/lda-coverage-435.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const one = async (sql: string, args: (string | number)[] = []) =>
  (await db.execute({ sql, args })).rows[0];
const many = async (sql: string, args: (string | number)[] = []) =>
  (await db.execute({ sql, args })).rows;

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

console.log("=== LDA coverage (HO 435) ===\n");

const totals = await one(
  `SELECT
     (SELECT COUNT(*) FROM lda_filings) AS filings,
     (SELECT COUNT(*) FROM lda_activities) AS activities,
     (SELECT COUNT(*) FROM lda_activity_bills) AS bill_links,
     (SELECT COUNT(DISTINCT registrant_id) FROM lda_filings) AS registrants,
     (SELECT COUNT(DISTINCT client_id) FROM lda_filings) AS clients`,
);
console.log(
  `filings=${totals?.filings} activities=${totals?.activities} bill_links=${totals?.bill_links} ` +
    `distinct_registrants=${totals?.registrants} distinct_clients=${totals?.clients}`,
);

// Resume frontier is DB-derived per combo (no dashboard_state cursor), so the
// per-quarter table below doubles as the resume-state view.
console.log("");

console.log("=== filings per quarter ===");
const perQ = await many(
  `SELECT filing_year, filing_type, COUNT(*) AS n
   FROM lda_filings GROUP BY filing_year, filing_type ORDER BY filing_year, filing_type`,
);
perQ.forEach((r) => console.log(`  ${r.filing_year} ${r.filing_type}: ${r.n}`));

console.log("\n=== join rate (re-check of the probe) ===");
const acts = Number((await one("SELECT COUNT(*) AS n FROM lda_activities"))?.n ?? 0);
const actsWithId = Number(
  (await one("SELECT COUNT(*) AS n FROM lda_activities WHERE bill_ids != '[]' AND bill_ids IS NOT NULL"))?.n ?? 0,
);
const actsWithLink = Number(
  (await one("SELECT COUNT(DISTINCT filing_uuid || ':' || activity_ordinal) AS n FROM lda_activity_bills"))?.n ?? 0,
);
const filings = Number(totals?.filings ?? 0);
const filingsWithLink = Number(
  (await one("SELECT COUNT(DISTINCT filing_uuid) AS n FROM lda_activity_bills"))?.n ?? 0,
);
console.log(`  filings with >=1 joined bill:      ${filingsWithLink}/${filings} = ${pct(filingsWithLink, filings)}`);
console.log(`  activities with >=1 parsed bill_id: ${actsWithId}/${acts} = ${pct(actsWithId, acts)}`);
console.log(`  activities with a JOINED bill:      ${actsWithLink}/${acts} = ${pct(actsWithLink, acts)}`);
console.log(`  (parsed→joined retention:           ${pct(actsWithLink, actsWithId)})`);

console.log("\n=== top issue codes by activity count ===");
const topIssues = await many(
  `SELECT general_issue_code AS code, general_issue_code_display AS name, COUNT(*) AS n
   FROM lda_activities GROUP BY general_issue_code ORDER BY n DESC LIMIT 15`,
);
topIssues.forEach((r) => console.log(`  ${r.code} (${r.name}): ${r.n}`));

console.log("\n=== spam-skew check: bills by distinct-filer vs raw activity count ===");
const topBills = await many(
  `SELECT bill_id,
          COUNT(*) AS raw_activities,
          COUNT(DISTINCT lf.registrant_id) AS distinct_registrants
   FROM lda_activity_bills lab
   JOIN lda_filings lf USING (filing_uuid)
   GROUP BY bill_id ORDER BY raw_activities DESC LIMIT 12`,
);
topBills.forEach((r) =>
  console.log(`  ${r.bill_id}: raw=${r.raw_activities} distinct_filers=${r.distinct_registrants}`),
);

process.exit(0);
