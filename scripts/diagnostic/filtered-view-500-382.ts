// HO 382 — Filtered-view 500 reproduction. READ-ONLY. No writes, no commit.
// Direct script path → no 10s boundedFetch abort, so a timeout-class query runs
// slow-but-completes (timed + EXPLAIN'd) while a logic/SQL-class query throws its
// real message immediately. That split tells bug #1 (size timeout) from bug #2
// (size-independent throw) apart.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const NEWS_CONFIDENCE_FLOOR = 0.7;
const FUNNEL_STAGES = [
  "introduced",
  "committee",
  "floor",
  "other_chamber",
  "president",
  "enacted",
];
const MENTION_SUBQUERY = `LEFT JOIN (
  SELECT bill_id, COUNT(*) AS n
  FROM news_mentions
  WHERE published_at >= datetime('now', '-7 days')
    AND match_confidence >= ${NEWS_CONFIDENCE_FLOOR}
  GROUP BY bill_id
) nm ON nm.bill_id = bills.id`;

function hr(t: string) {
  console.log("\n========== " + t + " ==========");
}

async function timed(label: string, sql: string, args: unknown[] = []) {
  const t0 = Date.now();
  try {
    const rs = await db.execute({ sql, args: args as never });
    const ms = Date.now() - t0;
    console.log(`OK  [${ms}ms] ${label} → ${rs.rows.length} row(s)`);
    return { ok: true as const, ms, rows: rs.rows };
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`THROW [${ms}ms] ${label}`);
    console.log("   message:", (e as Error).message);
    return { ok: false as const, ms, err: e as Error };
  }
}

async function explain(label: string, sql: string, args: unknown[] = []) {
  try {
    const rs = await db.execute({
      sql: "EXPLAIN QUERY PLAN " + sql,
      args: args as never,
    });
    console.log(`PLAN ${label}:`);
    for (const r of rs.rows) console.log("   " + (r.detail as string));
  } catch (e) {
    console.log(`PLAN ${label} — EXPLAIN threw: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------- BUG #2
// The four home queries that take `filters`. Run each with stage='president'
// (1 row — proves size-independence) AND topic='defense'.
async function bug2(stage: string | null, topic: string | null) {
  hr(`BUG #2 — home filtered queries · stage=${stage} topic=${topic}`);

  // 1. getStageDistribution(filters, true) — summaryGated forces idx_bills_summary_stage
  {
    const topicClause = topic
      ? " AND EXISTS (SELECT 1 FROM json_each(bills.topics) WHERE value = ?)"
      : "";
    const topicArgs = topic ? [topic] : [];
    const ph = FUNNEL_STAGES.map(() => "?").join(", ");
    const sql = `SELECT stage, COUNT(*) AS count
      FROM bills INDEXED BY idx_bills_summary_stage
      WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
        AND stage IN (${ph}) AND summary IS NOT NULL${topicClause}
      GROUP BY stage`;
    await timed("getStageDistribution.bars(gated)", sql, [
      ...FUNNEL_STAGES,
      ...topicArgs,
    ]);
    const offSql = `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_summary_stage
      WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
        AND (stage = 'other' OR stage IS NULL) AND summary IS NOT NULL${topicClause}`;
    await timed("getStageDistribution.offPath(gated)", offSql, [...topicArgs]);
  }

  // 2. getTopicDistribution(filters, true) — summaryGated forces idx_bills_summary_topics
  {
    const stageClause = stage ? " AND bills.stage = ?" : "";
    const stageArgs = stage ? [stage] : [];
    const sql = `SELECT je.value AS topic, COUNT(*) AS count
      FROM bills INDEXED BY idx_bills_summary_topics, json_each(bills.topics) je
      WHERE bills.topics IS NOT NULL
        AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)
        AND bills.summary IS NOT NULL${stageClause}
      GROUP BY je.value ORDER BY count DESC`;
    const r = await timed("getTopicDistribution(gated)", sql, [...stageArgs]);
    if (!r.ok) await explain("getTopicDistribution(gated)", sql, [...stageArgs]);
  }

  // 3. getBreakingNewsForHomeCount({filters})
  {
    const stageClause = stage ? " AND b.stage = ?" : "";
    const topicClause = topic
      ? " AND EXISTS (SELECT 1 FROM json_each(b.topics) WHERE value = ?)"
      : "";
    const fa: unknown[] = [];
    if (stage) fa.push(stage);
    if (topic) fa.push(topic);
    const sql = `SELECT COUNT(DISTINCT COALESCE(
        m.article_url, m.article_title || '|' || m.source || '|' || m.published_at
      )) AS n
      FROM news_mentions m INDEXED BY idx_news_mentions_published
      INNER JOIN bills b ON b.id = m.bill_id
      WHERE m.published_at >= datetime('now', '-72 hours')
        AND m.match_confidence >= 0.7
        AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)${stageClause}${topicClause}`;
    await timed("getBreakingNewsForHomeCount", sql, [...fa]);
  }

  // 4. getStageChangesCount({}, 7, filters) — buildChangesWhere + dashboard filter
  {
    // filters={} so buildFeedWhere({}) = [summary IS NOT NULL, non-ceremonial].
    // dashboard.stage → "(stage = ? OR previous_stage = ?)"
    // dashboard.topic → json_each EXISTS
    const clauses = [
      "summary IS NOT NULL",
      "(is_ceremonial = 0 OR is_ceremonial IS NULL)",
      "stage_changed_at IS NOT NULL",
      "stage_changed_at > datetime('now', '-7 days')",
    ];
    const args: unknown[] = [];
    if (stage) {
      clauses.push("(stage = ? OR previous_stage = ?)");
      args.push(stage, stage);
    }
    if (topic) {
      clauses.push("EXISTS (SELECT 1 FROM json_each(bills.topics) WHERE value = ?)");
      args.push(topic);
    }
    const sql = `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_stage_changed_at WHERE ${clauses.join(
      " AND ",
    )}`;
    await timed("getStageChangesCount.filtered", sql, args);
  }
}

// ---------------------------------------------------------------- BUG #1
// getFeedBills(stage='committee') — count + select. Time + EXPLAIN both.
async function bug1() {
  hr("BUG #1 — getFeedBills stage=committee (count + select)");

  // buildFeedWhere({stage:'committee'}) (no prefix):
  const where =
    "summary IS NOT NULL AND stage = ? AND (is_ceremonial = 0 OR is_ceremonial IS NULL)";

  // count — stage filter set → countHint="" (no INDEXED BY)
  const countSql = `SELECT COUNT(*) AS n FROM bills WHERE ${where}`;
  await explain("count", countSql, ["committee"]);
  await timed("count", countSql, ["committee"]);

  // select — stage filter set → selectHint="" (no INDEXED BY). ORDER BY latest_action_date DESC
  const selectSql = `SELECT id, congress, bill_type, bill_number, title,
      sponsor_name, sponsor_party, sponsor_state, introduced_date,
      latest_action_date, latest_action_text, update_date,
      summary, topics, stage, stage_changed_at,
      sponsor_bioguide_id, cosponsor_count,
      msp.depiction_url AS sponsor_depiction_url,
      msp.first_name AS sponsor_first_name,
      msp.last_name AS sponsor_last_name,
      msp.district AS sponsor_district,
      COALESCE(nm.n, 0) AS mention_count_7d
      FROM bills
      ${MENTION_SUBQUERY}
      LEFT JOIN members msp ON msp.bioguide_id = bills.sponsor_bioguide_id
      WHERE ${where}
      ORDER BY latest_action_date DESC NULLS LAST, id DESC
      LIMIT ? OFFSET ?`;
  await explain("select", selectSql, ["committee", 25, 0]);
  await timed("select", selectSql, ["committee", 25, 0]);
}

async function main() {
  hr("corpus sanity");
  const c = await db.execute(
    "SELECT stage, COUNT(*) AS n FROM bills GROUP BY stage ORDER BY n DESC",
  );
  console.table(c.rows.map((r) => ({ stage: r.stage, n: Number(r.n) })));

  await bug2("president", null); // size-independent (1-row stage)
  await bug2(null, "defense"); // topic path
  await bug1();
}

main().then(() => process.exit(0));
