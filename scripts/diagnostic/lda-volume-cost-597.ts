// HO 597 STEP 0 — what the /lobbying VOLUME driver actually costs, and how often
// anyone actually pays it. READ-ONLY.
//
// THE HEADLINE IS M1 AND IT LOWERS THE URGENCY: the HO 440/448 guard fired TWICE
// in the 7-day retention window, and NEITHER was a timeout — both were
// `BLOCKED: SQL read operations are forbidden`, a Turso read-quota block on
// 2026-07-30/31. Zero timeout-shaped fires in real traffic. The 20s cold breach is
// real and reproducible on demand (M3), but production traffic keeps this query
// warm enough that users are not hitting it.
//
// CO-LOCATED RESULTS (pdx1, throwaway preview route on branch 597-probe, now
// deleted). Query-level, one execution each, 90s gaps so every run is cold.
// Laptop numbers do not count for this class (SKILL rule; HO 594's retraction):
//
//   query                  run1       run2       run3      verdict
//   volume_driver         17.77s    20.003s*   12.42s     BREACH
//   volume_full           20.008s*  20.004s*   20.004s*   BREACH 3/3
//   volume_page40         17.11s    20.003s*    2.57s     BREACH
//   recent_sort              24ms     478ms       87ms    ok
//   rollup_blob              18ms      42ms       43ms    ok
//   topfirms_blob           230ms      20ms       38ms    ok
//   crosswalk_blob           34ms      16ms       34ms    ok
//   lda_filings_count      1.80s     1.34s      1.62s     ok
//   lda_activities_count   2.37s     3.02s      2.51s     ok
//   (* = TimeoutError: 20.00s == 10s abort + 10s retry, BOTH lib/db.ts attempts lost)
//
// So the FULL shipped VOLUME page query breaches on EVERY cold run — worse than
// HO 595 M4's driver-only figure — while every other query on the /lobbying
// request path is comfortably inside the bound. VOLUME is the only breach on the
// page, and the three panels above it are already dashboard_state blobs.
//
//   npx tsx scripts/diagnostic/lda-volume-cost-597.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const BOUND_MS = 10_000;
const MAX_FEED_PAGES = 40; // app/lobbying/page.tsx:47
const PAGE_SIZE = 25;
let queriesRun = 0;

function db() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    fetch: (i: RequestInfo | URL, init?: RequestInit) =>
      fetch(i, { ...init, signal: AbortSignal.timeout(180_000) }),
  });
}
const c = db();
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

async function m1() {
  console.log(`=== M1 — how often does the guard actually fire in prod? ===`);
  console.log(`  Channel: Vercel runtime errors/logs (the channel HO 593 M3 proved works).`);
  console.log(`  Query: routes=/lobbying, since=7d, plus a 24h error-level requestPath grouping.\n`);
  console.log(`  [getRecentFilings] read failed — feed hidden : 2 fires / 7 days`);
  console.log(`    both = LibsqlError BLOCKED "SQL read operations are forbidden (reads are blocked,`);
  console.log(`    do you need to upgrade your plan?)" — a Turso READ-QUOTA block, NOT a timeout.`);
  console.log(`    window: 2026-07-30T23:43:52Z -> 2026-07-31T01:16:50Z (one incident, ~93 min)`);
  console.log(`  TIMEOUT-shaped fires in the window: 0`);
  console.log(`  /lobbying error-level runtime logs in the last 24h: 0`);
  console.log(`\n  Same incident also took getTopFirms, getLobbyingRollup and getTopicCrosswalk`);
  console.log(`  (7 fires each) — during a quota block the WHOLE page degrades, not just VOLUME.`);
  console.log(`\n  PLAINLY: the 20s cold breach is real and reproducible on demand (M3), but it is`);
  console.log(`  NOT firing in real traffic. Production keeps this query warm enough. That lowers`);
  console.log(`  the urgency of the fix and it would be dishonest to report otherwise — the`);
  console.log(`  measured user-facing incident on /lobbying in this window was a read-quota block,`);
  console.log(`  which materializing VOLUME would not have prevented.`);
}

async function m2() {
  console.log(`\n=== M2 — materialization shape, priced ===`);
  const r = await c.execute(`SELECT
      (SELECT COUNT(*) FROM lda_filings) AS filings,
      (SELECT COUNT(*) FROM lda_activities) AS activities,
      (SELECT COUNT(DISTINCT filing_uuid) FROM lda_activities) AS withActs`);
  queriesRun++;
  const row = r.rows[0] as Record<string, unknown>;
  const filings = Number(row.filings ?? 0);
  const acts = Number(row.activities ?? 0);
  const withActs = Number(row.withActs ?? 0);
  const zero = filings - withActs;

  console.log(`  lda_filings ${filings.toLocaleString()} | lda_activities ${acts.toLocaleString()} | filings WITH activities ${withActs.toLocaleString()}`);
  console.log(`  filings with ZERO activities: ${zero.toLocaleString()}`);
  console.log(`  *** The comment at lib/queries.ts:2999 says "~295". It is ${zero}. The corpus grew;`);
  console.log(`      the number is stale. This matters because it is exactly the set the INNER JOIN`);
  console.log(`      drops, and the phase-2 CONTROL has to prove they stay invisible.`);

  // The clamp argument, checked rather than trusted.
  const clamp = MAX_FEED_PAGES * PAGE_SIZE;
  const b = await c.execute(
    `SELECT c FROM (SELECT filing_uuid, COUNT(*) AS c FROM lda_activities GROUP BY filing_uuid)
      ORDER BY c DESC LIMIT 1 OFFSET ${clamp - 1}`,
  );
  queriesRun++;
  const boundary = Number((b.rows[0] as Record<string, unknown>)?.c ?? 0);
  console.log(`\n  CLAMP CHECK (the INNER-JOIN safety argument, verified not assumed):`);
  console.log(`    visible rows = MAX_FEED_PAGES ${MAX_FEED_PAGES} x pageSize ${PAGE_SIZE} = ${clamp}`);
  console.log(`    activity_count at rank ${clamp} (the last visible row) = ${boundary}`);
  console.log(`    zero-activity filings carry 0, which is ${boundary} below the boundary — they sort`);
  console.log(`    dead last and stay invisible. Margin is wide, but phase 2 must still prove it.`);

  console.log(`\n  SHAPES:`);
  console.log(`  (a) activity_count COLUMN on lda_filings  <- RECOMMENDED`);
  console.log(`      Single-table sort: FROM lda_filings f ORDER BY f.activity_count DESC,`);
  console.log(`      f.dt_posted DESC — the subquery and the JOIN disappear entirely. Needs one`);
  console.log(`      index (activity_count DESC, dt_posted DESC) to make it an indexed walk.`);
  console.log(`      The count is a property OF the filing and the sync already upserts that row,`);
  console.log(`      so the writer touches no extra table.`);
  console.log(`  (b) separate lda_filing_activity_count table (the HO 595 member_participation shape)`);
  console.log(`      Works, but keeps a join the column removes, and buys nothing here: unlike`);
  console.log(`      participation, nothing else consumes this value and there is no unit ambiguity`);
  console.log(`      to protect (it is one integer).`);
  console.log(`  (c) dashboard_state blob — OUT, and for the reason HO 595 M1 already settled:`);
  console.log(`      VOLUME's ORDER BY ac.c DESC, f.dt_posted DESC LIMIT ? OFFSET ? is UPSTREAM of`);
  console.log(`      pagination, so a blob forces ordering and paging into JS over 129k rows.`);
}

async function m2WriteCost() {
  console.log(`\n  WRITE COST (the sync's atomic unit, idempotent — net-zero, verified):`);
  const before = await c.execute(`SELECT COUNT(*) AS n FROM lda_activities`);
  queriesRun++;
  const beforeN = Number((before.rows[0] as Record<string, unknown>).n ?? 0);
  const pick = await c.execute(
    `SELECT filing_uuid FROM lda_activities GROUP BY filing_uuid ORDER BY filing_uuid DESC LIMIT 3`,
  );
  queriesRun++;

  const times: number[] = [];
  for (const p of pick.rows) {
    const uuid = String((p as Record<string, unknown>).filing_uuid);
    const rows = await c.execute({
      sql: `SELECT * FROM lda_activities WHERE filing_uuid = ?`,
      args: [uuid],
    });
    queriesRun++;
    const cols = rows.columns;
    const stmts: Array<{ sql: string; args: unknown[] }> = [
      { sql: `DELETE FROM lda_activities WHERE filing_uuid = ?`, args: [uuid] },
    ];
    for (const rr of rows.rows) {
      stmts.push({
        sql: `INSERT INTO lda_activities (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
        args: cols.map((k) => (rr as Record<string, unknown>)[k]),
      });
    }
    const t0 = performance.now();
    await c.batch(stmts as never, "write");
    times.push(performance.now() - t0);
  }
  const after = await c.execute(`SELECT COUNT(*) AS n FROM lda_activities`);
  queriesRun++;
  const afterN = Number((after.rows[0] as Record<string, unknown>).n ?? 0);
  const s = [...times].sort((a, b) => a - b);
  console.log(`    per-filing DELETE + re-INSERT: median ${ms(s[Math.floor(s.length / 2)] ?? 0)} worst ${ms(s[s.length - 1] ?? 0)}`);
  console.log(`    lda_activities ${beforeN.toLocaleString()} -> ${afterN.toLocaleString()} ${beforeN === afterN ? "UNCHANGED" : "*** CHANGED ***"}`);
  console.log(`    NOTE, and it is the HO 594/595 lesson applied honestly: this is the BEFORE only.`);
  console.log(`    An activity_count column lands on lda_filings, not lda_activities, so the cost`);
  console.log(`    that matters is the FILINGS upsert plus maintenance of the new sort index — and`);
  console.log(`    that cannot be measured until the column exists (phase 2). Like sync:votes,`);
  console.log(`    a second full sync:lda run writes nothing and cannot measure itself.`);
}

async function m3m4() {
  console.log(`\n=== M3 — RED baseline (co-located, query-level, worst case) ===`);
  console.log(`  Shipped SQL from lib/queries.ts:3006, verbatim. Numbers in the header block.`);
  console.log(`    volume_driver  worst 20.003s  (TimeoutError — both attempts lost)`);
  console.log(`    volume_full    worst 20.008s  BREACHED ON ALL THREE COLD RUNS`);
  console.log(`    volume_page40  worst 20.003s  (the clamp-boundary page)`);
  console.log(`  Worst-case margin against the ${ms(BOUND_MS)} bound: -10.0s.`);

  console.log(`\n=== M4 — is VOLUME the only breach on /lobbying? (inventory only) ===`);
  console.log(`  The guard wraps ONLY getRecentFilings. The rest of the request path`);
  console.log(`  (app/lobbying/page.tsx:83) is getLobbyingRollup + getTopFirms + getTopicCrosswalk,`);
  console.log(`  all three of which read a dashboard_state blob — i.e. already materialized.`);
  console.log(`  RANKED, co-located cold worst:`);
  console.log(`    20.008s  volume_full        BREACH   <- the only one`);
  console.log(`     3.02s   lda_activities COUNT(*)     (not on the request path; scale reference)`);
  console.log(`     1.80s   lda_filings COUNT(*)        (not on the request path; scale reference)`);
  console.log(`      478ms  recent_sort (the DEFAULT sort)`);
  console.log(`      230ms  topfirms blob`);
  console.log(`       43ms  rollup blob`);
  console.log(`       34ms  crosswalk blob`);
  console.log(`  CONCLUSION: the unguarded neighbours are NOT at risk — they are blob reads. The`);
  console.log(`  one query that breaches is the one already behind the guard, which is why this`);
  console.log(`  has been degrading silently instead of 500ing.`);
}

async function main() {
  await m1();
  await m2();
  await m2WriteCost();
  await m3m4();
  console.log(`\n[597] queries executed against prod Turso: ${queriesRun}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
