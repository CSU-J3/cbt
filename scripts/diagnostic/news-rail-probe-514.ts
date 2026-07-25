// HO 514 — /news rail probe (read-only, no writes, no schema/route/component change).
//
// The backlog's /news spine item named SOURCES as the rail; that's dead (3 rows =
// the SOURCE chip row relocated). So the rail respec's onto one of two axes, and
// this probe measures both BEFORE either is designed:
//
//   Q1 — Axis A: TOPIC spine (24 rows). Per-topic mention counts, rebased on the
//        other active dims (source/window/signal), SELF-EXCLUDING on topic (HO 496
//        rule). Shape = news_mentions m INNER JOIN bills b + json_each(b.topics)
//        GROUP BY, the getBillTopicRailCounts parity. Two traps, both measured COLD
//        (HO 340: a clean EXPLAIN says nothing about cold latency):
//          (1) the OR-lure — without INDEXED BY idx_news_mentions_published the
//              stateless planner drives from the 16.8k bills side via
//              idx_bills_is_ceremonial (the HO 332/405/479–481 MULTI-INDEX-OR class).
//              Report plan + cold ms WITH and WITHOUT the hint.
//          (2) json_each temp-btrees on the aggregate side (the HO 461 Q6 residual).
//        Also: RE-MEASURE the news_mentions corpus — the SKILL still quotes the
//        stale "227-row" figure from HO 335.
//
//   Q2 — Axis B: MEMBER spine ("who's in the news"), off observation_entities
//        (entity_type='person') → observations. The cardinality that decides whether
//        B is a spine or a top-5 list: distinct bioguides ≥1/≥3/≥10/≥25, the top-20
//        head (name-hydrated, eyeball for boilerplate artifacts), recency shape
//        (30d/7d/24h), cold rollup cost (idx_obs_entities_type_value drive), and the
//        members-side coverage fraction.
//
// COLD DISCIPLINE: every timed query runs as the FIRST+ONLY statement on a fresh
// uncapped libsql client (no boundedFetch 10s abort — so a true >10s cold read is
// visible, not masked as an abort). Single-shot fresh-connection timing is this
// repo's "cold" convention (cold-start-audit-332 / lda-*-cost); the server-side page
// cache is shared across my connections, so the hinted-vs-unhinted DELTA is the hard
// signal, the absolute ms the soft one.
//
//   npx tsx scripts/diagnostic/news-rail-probe-514.ts
import "dotenv/config";
import { createClient, type Client } from "@libsql/client";

const BOUNDED_FETCH_CAP_MS = 10_000; // lib/db.ts boundedFetch abort — the live-safe line
const NEWS_FEED_MIN_CONFIDENCE = 0.7; // = lib/queries.ts NEWS_FEED_MIN_CONFIDENCE
const BREAKING_HOURS = 72; // = BREAKING_WINDOW_HOURS (NEWS_DEFAULT_WINDOW)

const ms = (n: number) => `${n.toFixed(0)}ms`;
const str = (v: unknown): string => String(v ?? "");

function freshClient(): Client {
  return createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

// Timed read as the first+only statement on a fresh connection (best-effort cold).
async function coldTime(
  sql: string,
  args: (string | number)[],
): Promise<{ dt: number; rows: number }> {
  const db = freshClient();
  try {
    const t0 = performance.now();
    const rs = await db.execute({ sql, args });
    return { dt: performance.now() - t0, rows: rs.rows.length };
  } finally {
    await db.close();
  }
}

async function planLines(
  scan: Client,
  sql: string,
  args: (string | number)[],
): Promise<string[]> {
  const rs = await scan.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args });
  return rs.rows.map((r) => str(r.detail));
}

// ── Q1: the topic-rail count query, self-excluding on topic ──────────────────
type Combo = {
  label: string;
  source?: string;
  windowHours: number;
  signal?: "breaking";
};

function railSql(combo: Combo, hinted: boolean): { sql: string; args: (string | number)[] } {
  const hint = hinted ? " INDEXED BY idx_news_mentions_published" : "";
  const parts = [
    "m.published_at >= datetime('now','-' || ? || ' hours')",
    "m.match_confidence >= ?",
    "(b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)",
  ];
  const args: (string | number)[] = [combo.windowHours, NEWS_FEED_MIN_CONFIDENCE];
  if (combo.source) {
    parts.push("m.source = ?");
    args.push(combo.source);
  }
  if (combo.signal === "breaking") {
    // BREAKING = min(window,72h) + confidence floor, inlined constants (as in
    // BREAKING_PREDICATE_SQL). Self-excluding on topic → no topic clause.
    parts.push(
      `m.match_confidence >= ${NEWS_FEED_MIN_CONFIDENCE} AND m.published_at >= datetime('now','-${BREAKING_HOURS} hours')`,
    );
  }
  const sql = `SELECT je.value AS topic, COUNT(*) AS count
      FROM news_mentions m${hint}
      INNER JOIN bills b ON b.id = m.bill_id, json_each(b.topics) je
      WHERE ${parts.join(" AND ")} AND b.topics IS NOT NULL
      GROUP BY je.value
      ORDER BY count DESC`;
  return { sql, args };
}

async function main() {
  console.log("=== HO 514 — /news rail probe (topic cost + member cardinality) ===\n");
  const scan = freshClient();

  // ── Corpus re-measure (the stale 227 figure) ──────────────────────────────
  console.log("--- Corpus: news_mentions size (SKILL still quotes the HO 335 '227-row' figure) ---");
  const totalMentions = Number(
    (await scan.execute("SELECT COUNT(*) n FROM news_mentions")).rows[0]?.n ?? 0,
  );
  const distinctArticles = Number(
    (await scan.execute(
      `SELECT COUNT(DISTINCT COALESCE(article_url, article_title||'|'||source||'|'||published_at)) n FROM news_mentions`,
    )).rows[0]?.n ?? 0,
  );
  const windows: number[] = [24, 72, 168, 720];
  const winCounts: Record<number, number> = {};
  for (const w of windows) {
    winCounts[w] = Number(
      (await scan.execute({
        sql: `SELECT COUNT(*) n FROM news_mentions WHERE published_at >= datetime('now','-'||?||' hours') AND match_confidence >= ?`,
        args: [w, NEWS_FEED_MIN_CONFIDENCE],
      })).rows[0]?.n ?? 0,
    );
  }
  console.log(`  news_mentions total rows            : ${totalMentions}`);
  console.log(`  distinct articles (dedup key)       : ${distinctArticles}`);
  for (const w of windows)
    console.log(`  rows in ${String(w).padStart(3)}h window (conf>=0.7)   : ${winCounts[w]}`);

  // ── Q1: topic-rail cost, combos × {unhinted, hinted}, plan + cold ms ──────
  console.log("\n=== Q1 — Axis A (TOPIC spine) cost ===");
  const combos: Combo[] = [
    { label: "bare (window=72 default)", windowHours: 72 },
    { label: "source=politico", windowHours: 72, source: "politico" },
    { label: "window=24 (selective extreme)", windowHours: 24 },
    { label: "window=720 (non-selective extreme)", windowHours: 720 },
    { label: "signal=breaking", windowHours: 72, signal: "breaking" },
    { label: "stacked: politico + window=720 + breaking", windowHours: 720, source: "politico", signal: "breaking" },
  ];

  let anyUnhintedExceeds = false;
  let sawTempBtree = false;
  for (const combo of combos) {
    console.log(`\n  ▸ ${combo.label}`);
    for (const hinted of [false, true]) {
      const { sql, args } = railSql(combo, hinted);
      const plan = await planLines(scan, sql, args);
      const t = await coldTime(sql, args);
      const tag = hinted ? "HINTED  " : "unhinted";
      const driver = plan.find((p) => /news_mentions|bills/.test(p)) ?? plan[0] ?? "";
      const tempBtree = plan.some((p) => /TEMP B-TREE/i.test(p));
      if (tempBtree) sawTempBtree = true;
      if (!hinted && t.dt >= BOUNDED_FETCH_CAP_MS) anyUnhintedExceeds = true;
      console.log(`    ${tag} : cold ${ms(t.dt).padStart(6)}  rows=${t.rows}${tempBtree ? "  [TEMP B-TREE]" : ""}`);
      for (const p of plan) console.log(`             plan| ${p}`);
      void driver;
    }
  }

  // ── Q2: member-spine cardinality ──────────────────────────────────────────
  console.log("\n=== Q2 — Axis B (MEMBER spine) cardinality ===");

  // Per-bioguide observation counts, all-time (entity_value NOT NULL = resolved).
  const perMember = await scan.execute(
    `SELECT oe.entity_value AS bioguide, COUNT(DISTINCT oe.obs_id) AS c
       FROM observation_entities oe
      WHERE oe.entity_type = 'person' AND oe.entity_value IS NOT NULL
      GROUP BY oe.entity_value`,
  );
  const counts = perMember.rows
    .map((r) => ({ bioguide: str(r.bioguide), c: Number(r.c) }))
    .sort((a, b) => b.c - a.c);
  const atLeast = (n: number) => counts.filter((x) => x.c >= n).length;
  console.log("  distinct RESOLVED bioguides (entity_value NOT NULL), all-time:");
  console.log(
    `    total ≥1: ${atLeast(1)}   ≥3: ${atLeast(3)}   ≥10: ${atLeast(10)}   ≥25: ${atLeast(25)}`,
  );

  // Recency windows: distinct resolved bioguides + ≥3 head, restricted by observed_at.
  console.log("\n  recency (distinct resolved bioguides within window):");
  for (const days of [30, 7, 1]) {
    const rs = await scan.execute({
      sql: `SELECT oe.entity_value AS bioguide, COUNT(DISTINCT oe.obs_id) AS c
              FROM observation_entities oe
              JOIN observations o ON o.obs_id = oe.obs_id
             WHERE oe.entity_type = 'person' AND oe.entity_value IS NOT NULL
               AND o.observed_at >= datetime('now','-'||?||' days')
             GROUP BY oe.entity_value`,
      args: [days],
    });
    const rc = rs.rows.map((r) => Number(r.c));
    const ge = (n: number) => rc.filter((c) => c >= n).length;
    const label = days === 1 ? "24h" : `${days}d`;
    console.log(`    ${label.padStart(3)}: ≥1=${ge(1)}   ≥3=${ge(3)}   ≥10=${ge(10)}`);
  }

  // Top-20 head, name-hydrated (eyeball for boilerplate/leadership artifacts).
  console.log("\n  top-20 head (obs count · bioguide · name — eyeball for matcher artifacts):");
  const topHydrate = await scan.execute({
    sql: `SELECT oe.entity_value AS bioguide, m.name AS name, COUNT(DISTINCT oe.obs_id) AS c
            FROM observation_entities oe
            LEFT JOIN members m ON m.bioguide_id = oe.entity_value
           WHERE oe.entity_type = 'person' AND oe.entity_value IS NOT NULL
           GROUP BY oe.entity_value
           ORDER BY c DESC
           LIMIT 20`,
    args: [],
  });
  for (const r of topHydrate.rows)
    console.log(`    ${str(r.c).padStart(4)}  ${str(r.bioguide).padEnd(8)}  ${str(r.name) || "<no members row>"}`);

  // Coverage: person rows overall, resolved (NOT NULL), and NULL→unjoinable share;
  // plus what fraction of resolved DISTINCT bioguides hit a live members row.
  console.log("\n  coverage (the members-side equivalent of HO 398's challenger edge):");
  const covRow = (await scan.execute(
    `SELECT
        COUNT(*) AS person_rows,
        SUM(CASE WHEN entity_value IS NOT NULL THEN 1 ELSE 0 END) AS resolved_rows
     FROM observation_entities WHERE entity_type = 'person'`,
  )).rows[0];
  const personRows = Number(covRow?.person_rows ?? 0);
  const resolvedRows = Number(covRow?.resolved_rows ?? 0);
  const distinctResolved = counts.length;
  const distinctInMembers = Number(
    (await scan.execute(
      `SELECT COUNT(*) n FROM (
          SELECT DISTINCT oe.entity_value
            FROM observation_entities oe
            JOIN members m ON m.bioguide_id = oe.entity_value
           WHERE oe.entity_type = 'person' AND oe.entity_value IS NOT NULL)`,
    )).rows[0]?.n ?? 0,
  );
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "—");
  console.log(`    person entity rows                 : ${personRows}`);
  console.log(`    resolved (entity_value NOT NULL)   : ${resolvedRows} (${pct(resolvedRows, personRows)}% of person rows)`);
  console.log(`    NULL (honestly unjoinable)         : ${personRows - resolvedRows}`);
  console.log(`    distinct resolved bioguides        : ${distinctResolved}`);
  console.log(`    …that hit a live members row       : ${distinctInMembers} (${pct(distinctInMembers, distinctResolved)}%)`);

  // Cold cost of the full rollup + name hydration + plan (idx_obs_entities_type_value drive?).
  console.log("\n  rollup + hydration cost:");
  const rollupSql = `SELECT oe.entity_value AS bioguide, m.name AS name, COUNT(DISTINCT oe.obs_id) AS c
      FROM observation_entities oe
      JOIN observations o ON o.obs_id = oe.obs_id
      LEFT JOIN members m ON m.bioguide_id = oe.entity_value
     WHERE oe.entity_type = 'person' AND oe.entity_value IS NOT NULL
     GROUP BY oe.entity_value
     ORDER BY c DESC`;
  const rollupPlan = await planLines(scan, rollupSql, []);
  const rollupCold = await coldTime(rollupSql, []);
  console.log(`    all-time rollup+hydration cold : ${ms(rollupCold.dt)}  rows=${rollupCold.rows}`);
  for (const p of rollupPlan) console.log(`             plan| ${p}`);

  await scan.close();

  // ── Verdicts ──────────────────────────────────────────────────────────────
  console.log("\n=== VERDICTS ===");
  console.log(
    `  A (topic spine): corpus=${totalMentions} mentions / ${winCounts[720]} in 720h. ` +
      `unhinted-exceeds-10s-cap seen: ${anyUnhintedExceeds ? "YES" : "no"}. ` +
      `json_each TEMP B-TREE seen: ${sawTempBtree ? "YES" : "no"}. (read the Q1 table for the hint delta)`,
  );
  console.log(
    `  B (member spine): ≥1=${atLeast(1)} ≥3=${atLeast(3)} ≥10=${atLeast(10)} ≥25=${atLeast(25)} resolved bioguides; ` +
      `rollup cold=${ms(rollupCold.dt)}. GO/COLLAPSE + own-window call is judgment over these numbers.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
