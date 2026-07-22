// Diagnostic (read-only, HO 495): cost probe for the /bills two-pane redesign's
// 24-topic rail, whose per-topic counts must REBASE on the other active filters
// (stage / chamber / q / ceremonial). This is the query shape that produced the
// HO 382 /?topics= 500 (json_each over the whole corpus). We measure BEFORE the
// rail is spec'd: EXPLAIN plans + cold wall-clock for the seven realistic filter
// combos, plus the cache-key + index verdicts.
//
// Mirrors the LIVE gated helper getTopicDistribution(filters, true) — app/page.tsx
// calls it with summaryGated=true, so `bills.summary IS NOT NULL` + the partial
// covering-index hints are the production baseline (the queries.ts:708 comment
// "`/` calls it ungated" is stale — the call site passes true).
//
// NO writes. NO CREATE INDEX. Run: npx tsx scripts/diagnostic/topic-distribution-filtered-495.ts
import "dotenv/config";
import { getDb } from "../../lib/db";

const HOUSE_BILL_TYPES = "'hr','hjres','hconres','hres'";
const SENATE_BILL_TYPES = "'s','sjres','sconres','sres'";

type Chamber = "house" | "senate" | undefined;
type Variant = {
  n: number;
  label: string;
  stage?: string;
  chamber?: Chamber;
  q?: string;
  includeCeremonial?: boolean;
  hint?: string | null; // null => let the planner choose (no INDEXED BY)
};

// Mirror the live hint logic: stage present -> stage_topics, else summary_topics.
function liveHint(v: Variant): string {
  return v.stage
    ? "idx_bills_summary_stage_topics"
    : "idx_bills_summary_topics";
}

// Build the rail-count SQL. The rail deliberately OMITS any topic predicate
// (self-exclusion, Step 3): getTopicDistribution never reads filters.topic, and
// a rail count must predict what clicking a topic does, so it rebases on
// everything EXCEPT the topic selection. Nothing here couples the two.
function buildSql(v: Variant): { sql: string; args: (string | number)[] } {
  const clauses = ["bills.topics IS NOT NULL", "bills.summary IS NOT NULL"];
  const args: (string | number)[] = [];

  if (!v.includeCeremonial) {
    clauses.push("(bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)");
  }
  if (v.stage) {
    clauses.push("bills.stage = ?");
    args.push(v.stage);
  }
  if (v.chamber === "house") clauses.push(`bills.bill_type IN (${HOUSE_BILL_TYPES})`);
  else if (v.chamber === "senate") clauses.push(`bills.bill_type IN (${SENATE_BILL_TYPES})`);

  const q = v.q?.trim();
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    const idLike = `%${q.toLowerCase().replace(/[\s-]/g, "")}%`;
    clauses.push(
      "(LOWER(bills.id) LIKE ? OR LOWER(bills.title) LIKE ? OR LOWER(bills.sponsor_name) LIKE ? OR LOWER(bills.summary) LIKE ? OR REPLACE(LOWER(bills.id), '-', '') LIKE ?)",
    );
    args.push(like, like, like, like, idLike);
  }

  const hint =
    v.hint === null ? "" : ` INDEXED BY ${v.hint ?? liveHint(v)}`;
  const sql = `SELECT je.value AS topic, COUNT(*) AS count
       FROM bills${hint}, json_each(bills.topics) je
       WHERE ${clauses.join("\n         AND ")}
       GROUP BY je.value
       ORDER BY count DESC`;
  return { sql, args };
}

// The seven variants from the HO table. q-broad = "act" (fans across the whole
// corpus via the 5-way LIKE); q-narrow = "quantum" (few matches — LIKE
// selectivity swings the cost hard). Worst realistic combo (broad-q, no stage
// narrowing = full-corpus LIKE scan) is run FIRST so its number is a true cold.
const VARIANTS: Variant[] = [
  { n: 6, label: "q=act broad (WORST — full-corpus LIKE, no stage seek)", q: "act" },
  { n: 1, label: "none (today's dashboard baseline)" },
  { n: 2, label: "stage=floor", stage: "floor" },
  { n: 3, label: "chamber=house", chamber: "house" },
  { n: 4, label: "stage=floor + chamber=house", stage: "floor", chamber: "house" },
  { n: 5, label: "ceremonial included", includeCeremonial: true },
  { n: 66, label: "q=quantum narrow", q: "quantum" },
  { n: 7, label: "q=act + stage=floor + chamber=house", q: "act", stage: "floor", chamber: "house" },
];

async function time<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = process.hrtime.bigint();
  const r = await fn();
  const t1 = process.hrtime.bigint();
  return [r, Number(t1 - t0) / 1e6];
}

async function main() {
  const db = getDb();

  console.log("=== HO 495 — filtered topic-distribution cost probe ===\n");

  // --- Index definitions relevant to this query shape ---
  console.log("--- Index DDL on bills (topic/summary/stage/chamber family) ---");
  const idx = await db.execute(
    `SELECT name, sql FROM sqlite_master
     WHERE type='index' AND tbl_name='bills'
       AND (name LIKE '%topic%' OR name LIKE '%summary%' OR name LIKE '%stage%' OR name LIKE '%chamber%' OR name LIKE '%ceremonial%')
     ORDER BY name`,
  );
  for (const r of idx.rows) {
    console.log(`  ${r.name}:`);
    console.log(`    ${r.sql}`);
  }
  const corpus = await db.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN summary IS NOT NULL THEN 1 ELSE 0 END) AS summarized,
            SUM(CASE WHEN topics IS NOT NULL THEN 1 ELSE 0 END) AS tagged,
            SUM(CASE WHEN (is_ceremonial=0 OR is_ceremonial IS NULL) THEN 1 ELSE 0 END) AS non_ceremonial
     FROM bills`,
  );
  console.log("\n  corpus:", JSON.stringify(corpus.rows[0]));
  const stages = await db.execute(
    `SELECT stage, COUNT(*) AS n FROM bills WHERE summary IS NOT NULL GROUP BY stage ORDER BY n DESC`,
  );
  console.log("  distinct stages (summarized):", stages.rows.map((r) => `${r.stage}=${r.n}`).join(", "));

  // --- STEP 1: EXPLAIN QUERY PLAN (planning only; does not warm data pages) ---
  console.log("\n=== STEP 1 — EXPLAIN QUERY PLAN (verbatim) ===");
  for (const v of VARIANTS) {
    const { sql, args } = buildSql(v);
    const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args });
    console.log(`\n[#${v.n}] ${v.label}  (hint: ${v.hint === null ? "NONE" : liveHint(v)})`);
    for (const r of plan.rows) console.log(`    ${r.detail}`);
  }

  // Step 5 aid: for chamber-only and q-only, also show what the planner picks
  // WITH NO HINT — reveals whether a better index than the forced one exists.
  console.log("\n--- STEP 5 aid: same queries, planner free (no INDEXED BY) ---");
  for (const base of VARIANTS.filter((v) => [3, 6, 66, 7].includes(v.n))) {
    const v = { ...base, hint: null };
    const { sql, args } = buildSql(v);
    const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args });
    console.log(`\n[#${v.n} free] ${v.label}`);
    for (const r of plan.rows) console.log(`    ${r.detail}`);
  }

  // --- STEP 2: cold wall-clock. WORST FIRST (VARIANTS[0]). Only that first
  // executed query is truly server-cold; the rest are partially warmed (same
  // bills table pages) and are diagnostic, per the HO. Warm = immediate re-run.
  console.log("\n=== STEP 2 — timings (ms) | rows returned | total tag-count ===");
  console.log("(first query below is the true cold verdict; rest ride a warming connection)\n");
  for (const v of VARIANTS) {
    const { sql, args } = buildSql(v);
    const [rs1, cold] = await time(() => db.execute({ sql, args }));
    const [, warm] = await time(() => db.execute({ sql, args }));
    const rows = rs1.rows.length;
    const total = rs1.rows.reduce((a, r) => a + Number(r.count ?? 0), 0);
    console.log(
      `[#${v.n}] cold ${cold.toFixed(0)}ms | warm ${warm.toFixed(0)}ms | ${rows} topics | ${total} tag-instances  — ${v.label}`,
    );
  }

  console.log("\n=== done ===");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
