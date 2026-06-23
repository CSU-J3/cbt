// HO 329 — diagnose the member-expand cold-start 500.
//
// The /members ?expanded=<bioguide> path fires 5 queries server-side
// (getSponsorStats, getSponsorTopTopics, getSponsorRecentBills,
// getMemberCommittees, getMemberAffiliations). On a cold cache it can trip the
// 10s DB-abort (lib/db.ts, HO 238) → 500. This probe replicates each query's
// SQL inline (bypassing the unstable_cache layer), times cold→warm against prod
// Turso, EXPLAINs each, measures the actual Promise.all wall-time, and tests the
// candidate fix (drop the unindexed `OR sponsor_name` branch so the planner can
// use idx_bills_sponsor_agg). Read-only — NO writes, NO index creation.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const CEREM = " AND (is_ceremonial = 0 OR is_ceremonial IS NULL)";

// The 5 expansion queries, parameterized by sponsorKey (bioguide). SQL copied
// verbatim from lib/queries.ts (default includeCeremonial=false path).
function buildQueries(key: string) {
  return {
    getSponsorStats: {
      sql: `SELECT COUNT(*) AS total,
          SUM(CASE WHEN stage='enacted' THEN 1 ELSE 0 END) AS enacted,
          SUM(CASE WHEN stage='introduced' THEN 1 ELSE 0 END) AS introduced,
          SUM(CASE WHEN stage='committee' THEN 1 ELSE 0 END) AS committee,
          SUM(CASE WHEN stage='floor' THEN 1 ELSE 0 END) AS floor_count,
          SUM(CASE WHEN stage='other_chamber' THEN 1 ELSE 0 END) AS other_chamber,
          SUM(CASE WHEN stage='president' THEN 1 ELSE 0 END) AS president
        FROM bills
        WHERE (sponsor_bioguide_id = ? OR sponsor_name = ?)${CEREM}`,
      args: [key, key],
    },
    getSponsorTopTopics: {
      sql: `SELECT topics FROM bills
            WHERE topics IS NOT NULL
              AND (sponsor_bioguide_id = ? OR sponsor_name = ?)${CEREM}`,
      args: [key, key],
    },
    getSponsorRecentBills: {
      sql: `SELECT id, congress, bill_type, bill_number, title,
              sponsor_name, sponsor_party, sponsor_state, introduced_date,
              latest_action_date, latest_action_text, update_date,
              summary, topics, stage, stage_changed_at
            FROM bills
            WHERE summary IS NOT NULL
              AND (sponsor_bioguide_id = ? OR sponsor_name = ?)${CEREM}
            ORDER BY latest_action_date DESC NULLS LAST`,
      args: [key, key],
    },
    getMemberCommittees: {
      sql: `SELECT cm.role, cm.party_side, cm.rank,
                   c.system_code, c.name, c.chamber, c.committee_type,
                   c.parent_system_code, p.name AS parent_name
            FROM committee_members cm
            JOIN committees c ON c.system_code = cm.committee_system_code
            LEFT JOIN committees p ON p.system_code = c.parent_system_code
            WHERE cm.bioguide_id = ? AND c.is_current = 1
            ORDER BY c.parent_system_code IS NOT NULL ASC, c.name ASC`,
      args: [key],
    },
    getMemberAffiliations: {
      sql: `SELECT org, category, source_url, last_verified
            FROM affiliations WHERE bioguide_id = ?`,
      args: [key],
    },
  };
}

// Candidate fix: the same getSponsorStats / TopTopics / RecentBills but with the
// `OR sponsor_name` branch dropped, hinted onto idx_bills_sponsor_agg.
function buildFixed(key: string) {
  return {
    "getSponsorStats (bioguide-only, hinted)": {
      sql: `SELECT COUNT(*) AS total,
          SUM(CASE WHEN stage='enacted' THEN 1 ELSE 0 END) AS enacted
        FROM bills INDEXED BY idx_bills_sponsor_agg
        WHERE sponsor_bioguide_id = ?${CEREM}`,
      args: [key],
    },
    "getSponsorTopTopics (bioguide-only, hinted)": {
      sql: `SELECT topics FROM bills INDEXED BY idx_bills_sponsor_topics
            WHERE topics IS NOT NULL AND sponsor_bioguide_id = ?${CEREM}`,
      args: [key],
    },
    "getSponsorRecentBills (bioguide-only)": {
      sql: `SELECT id, title, latest_action_date FROM bills
            WHERE summary IS NOT NULL AND sponsor_bioguide_id = ?${CEREM}
            ORDER BY latest_action_date DESC NULLS LAST`,
      args: [key],
    },
  };
}

async function timeIt(sql: string, args: (string | number)[], runs = 3) {
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = Date.now();
    await db.execute({ sql, args });
    ts.push(Date.now() - s);
  }
  return ts;
}

async function plan(sql: string, args: (string | number)[]) {
  const rs = await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args });
  return rs.rows.map((r) => "    " + (r.detail as string));
}

async function main() {
  // Find the heaviest sponsor by bill count (the real worst case).
  const heavy = await db.execute(
    `SELECT sponsor_bioguide_id AS bid, MAX(sponsor_name) AS name, COUNT(*) AS n
     FROM bills WHERE sponsor_bioguide_id IS NOT NULL
     GROUP BY sponsor_bioguide_id ORDER BY n DESC LIMIT 5`,
  );
  console.log("=== Top-5 sponsors by bill count ===");
  for (const r of heavy.rows) {
    console.log(`  ${r.bid}  ${r.name}  ${r.n} bills`);
  }
  const top = heavy.rows[0];
  if (!top) throw new Error("no sponsors found");
  const key = top.bid as string;
  const name = top.name as string;
  const n = Number(top.n);
  console.log(`\nProbing heaviest: ${key} (${name}, ${n} bills)\n`);

  const queries = buildQueries(key);

  // 1. Per-query cold latency + EXPLAIN, in isolation (fresh connection cold).
  console.log("=== 1. Per-query latency (t1=coldest) + EXPLAIN QUERY PLAN ===");
  const results: { label: string; t1: number; ts: number[] }[] = [];
  for (const [label, q] of Object.entries(queries)) {
    const p = await plan(q.sql, q.args);
    const ts = await timeIt(q.sql, q.args);
    results.push({ label, t1: ts[0] ?? 0, ts });
    console.log(`\n${label}: t1=${ts[0]}ms  [${ts.join(", ")}]ms`);
    for (const line of p) console.log(line);
  }

  console.log("\n=== Per-query cold (t1), sorted slowest first ===");
  for (const r of [...results].sort((a, b) => b.t1 - a.t1)) {
    console.log(`  ${r.t1.toString().padStart(6)}ms  ${r.label}`);
  }

  // 2. Promise.all wall-time (the real path) vs sum-of-cold. Fresh keys would be
  // ideal for cold, but server-side page cache is warm now; report both anyway.
  console.log("\n=== 2. Promise.all wall-time (the actual page path) ===");
  const all = Object.values(queries);
  const sAll = Date.now();
  await Promise.all(all.map((q) => db.execute({ sql: q.sql, args: q.args })));
  console.log(`  Promise.all of 5: ${Date.now() - sAll}ms (warm-ish)`);
  console.log(
    `  sum of t1 (if these were sequential): ${results.reduce((a, r) => a + r.t1, 0)}ms`,
  );
  console.log("  → page code at app/members/page.tsx:173 already uses Promise.all");

  // 3. Candidate fix: bioguide-only, hinted. Before/after.
  console.log("\n=== 3. Candidate fix — drop `OR sponsor_name`, hint index ===");
  const fixed = buildFixed(key);
  for (const [label, q] of Object.entries(fixed)) {
    const p = await plan(q.sql, q.args);
    const ts = await timeIt(q.sql, q.args);
    console.log(`\n${label}: t1=${ts[0]}ms  [${ts.join(", ")}]ms`);
    for (const line of p) console.log(line);
  }

  // 4. Corpus size context (why a full scan is expensive).
  const sz = await db.execute(`SELECT COUNT(*) AS n FROM bills`);
  console.log(`\n=== 4. Context: bills table has ${sz.rows[0]?.n} rows ===`);
  console.log(`  DB_REQUEST_TIMEOUT_MS = 10_000 (lib/db.ts). A cold full scan`);
  console.log(`  over the fat bills table that exceeds 10s aborts → 500.`);
}

main().then(() => process.exit(0));
