// HO 435 rev — READ-ONLY resume-plan validation. Proves the resume is safe
// BEFORE running it: for each (filing_year, filing_type) it compares rows-in-DB
// vs the API's `count`, shows the DB-derived frontier (MAX dt_posted → the
// `filing_dt_posted_after` the resume will use), and flags any shortfall. Also
// runs a global duplicate check on the existing rows to prove the PKs make a
// re-touch idempotent (not additive). No writes.
//
//   npx tsx scripts/diagnostic/lda-resume-plan-435.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const KEY = process.env.LDA_API_KEY as string;
const BASE = "https://lda.gov/api/v1";
const FILING_TYPES = ["Q1", "Q2", "Q3", "Q4", "1A", "2A", "3A", "4A"];
const YEARS = [2025, 2026];
const DAY_MS = 86_400_000;

async function apiCount(year: number, type: string): Promise<number> {
  const r = await fetch(
    `${BASE}/filings/?filing_year=${year}&filing_type=${type}&page_size=1`,
    { headers: { Authorization: `Token ${KEY}`, Accept: "application/json" } },
  );
  const j = (await r.json()) as { count: number };
  return j.count;
}

console.log("=== LDA resume plan (read-only) — db vs api per combo ===\n");
console.log("year type |    db |   api | short | frontier (resume-after)");
console.log("----------+-------+-------+-------+------------------------");

let totalDb = 0;
let totalApi = 0;
let anyShort = false;
for (const year of YEARS) {
  for (const type of FILING_TYPES) {
    const rs = await db.execute({
      sql: "SELECT COUNT(*) AS n, MAX(dt_posted) AS mx FROM lda_filings WHERE filing_year = ? AND filing_type = ?",
      args: [year, type],
    });
    const dbCount = Number(rs.rows[0]?.n ?? 0);
    const maxDt = (rs.rows[0]?.mx as string | null) ?? null;
    const api = await apiCount(year, type);
    totalDb += dbCount;
    totalApi += api;
    const short = api - dbCount;
    if (short > 0 && dbCount > 0) anyShort = true;
    const afterDate =
      maxDt != null
        ? new Date(Date.parse(maxDt) - DAY_MS).toISOString().slice(0, 10)
        : "start(fresh)";
    const flag = dbCount === 0 ? "fresh" : short > 0 ? `SHORT ${short}` : "ok";
    console.log(
      `${year} ${type.padEnd(4)}| ${String(dbCount).padStart(5)} | ${String(api).padStart(5)} | ${String(short).padStart(5)} | ${afterDate}  [${flag}]`,
    );
  }
}
console.log("----------+-------+-------+-------+------------------------");
console.log(`total     | ${String(totalDb).padStart(5)} | ${String(totalApi).padStart(5)} | ${String(totalApi - totalDb).padStart(5)} |`);

console.log("\n=== idempotency proof: duplicate check on existing rows ===");
const dupF = await db.execute(
  "SELECT COUNT(*) AS n FROM (SELECT filing_uuid FROM lda_filings GROUP BY filing_uuid HAVING COUNT(*) > 1)",
);
const dupA = await db.execute(
  "SELECT COUNT(*) AS n FROM (SELECT filing_uuid, activity_ordinal FROM lda_activities GROUP BY filing_uuid, activity_ordinal HAVING COUNT(*) > 1)",
);
const dupB = await db.execute(
  "SELECT COUNT(*) AS n FROM (SELECT filing_uuid, activity_ordinal, bill_id FROM lda_activity_bills GROUP BY filing_uuid, activity_ordinal, bill_id HAVING COUNT(*) > 1)",
);
console.log(`  duplicate filing_uuid rows:                 ${Number(dupF.rows[0]?.n)}`);
console.log(`  duplicate (filing_uuid,ordinal) activities: ${Number(dupA.rows[0]?.n)}`);
console.log(`  duplicate (uuid,ordinal,bill) links:        ${Number(dupB.rows[0]?.n)}`);
console.log(
  "  → 0 across all three = the PKs already enforce single rows; a re-touched",
);
console.log(
  "    filing (delete-rebuild under those PKs) resets cleanly, never doubles.",
);

console.log(
  `\nSummary: ${anyShort ? "some quarters are SHORT — the DB-derived frontier re-fetches the trailing shortfall (see above)." : "no completed quarter is short."}`,
);
process.exit(0);
