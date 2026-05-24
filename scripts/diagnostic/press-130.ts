// HO 130 Phase 1 — read-only diagnostic for media-attention column.
// Distribution + EXPLAIN for JOIN-at-read vs denormalize tradeoff. No writes.
import "dotenv/config";
import { getDb } from "../../lib/db";

const FLOOR = 0.7;

async function main() {
  const db = getDb();

  // 1. Confirm news_mentions table info + indexes
  console.log("--- 1. Table info ---");
  const tableInfo = await db.execute(
    "SELECT COUNT(*) AS n FROM news_mentions",
  );
  console.log(`news_mentions total rows: ${tableInfo.rows[0]?.n}`);

  const confidenceDist = await db.execute(
    `SELECT
       CASE WHEN match_confidence IS NULL THEN 'null'
            WHEN match_confidence >= 0.9 THEN '>=0.9'
            WHEN match_confidence >= 0.7 THEN '0.7-0.9'
            WHEN match_confidence >= 0.5 THEN '0.5-0.7'
            ELSE '<0.5' END AS bucket,
       COUNT(*) AS n
     FROM news_mentions GROUP BY bucket ORDER BY bucket DESC`,
  );
  for (const r of confidenceDist.rows) {
    console.log(`  confidence ${r.bucket}: ${r.n}`);
  }

  // 2. Distribution of mention counts per bill, 7d window
  for (const days of [7, 30] as const) {
    console.log(`\n--- 2. Distribution per bill, last ${days}d (conf>=${FLOOR}) ---`);
    const rs = await db.execute({
      sql: `
        WITH recent AS (
          SELECT bill_id, COUNT(*) AS n
          FROM news_mentions
          WHERE published_at >= datetime('now', '-' || ? || ' days')
            AND match_confidence >= ?
          GROUP BY bill_id
        )
        SELECT
          CASE
            WHEN n = 1 THEN '1'
            WHEN n <= 3 THEN '2-3'
            WHEN n <= 7 THEN '4-7'
            WHEN n <= 15 THEN '8-15'
            ELSE '16+'
          END AS bucket,
          COUNT(*) AS bills_in_bucket
        FROM recent
        GROUP BY bucket
        ORDER BY MIN(n)
      `,
      args: [days, FLOOR],
    });
    for (const r of rs.rows) {
      console.log(`  ${r.bucket}: ${r.bills_in_bucket} bills`);
    }
  }

  // 3. How many distinct bills have ANY mentions at each window
  console.log(`\n--- 3. Distinct-bills with mentions ---`);
  const dr = await db.execute({
    sql: `SELECT
            COUNT(DISTINCT CASE WHEN published_at >= datetime('now', '-7 days') THEN bill_id END) AS last_7d,
            COUNT(DISTINCT CASE WHEN published_at >= datetime('now', '-30 days') THEN bill_id END) AS last_30d,
            COUNT(DISTINCT bill_id) AS all_time
          FROM news_mentions
          WHERE match_confidence >= ?`,
    args: [FLOOR],
  });
  const row = dr.rows[0];
  console.log(
    `  last_7d=${row?.last_7d}   last_30d=${row?.last_30d}   all_time=${row?.all_time}`,
  );

  // 4. Top 10 most-mentioned bills, 7d window
  console.log(`\n--- 4. Top 10 most-mentioned bills, 7d ---`);
  const top = await db.execute({
    sql: `SELECT m.bill_id, b.title, COUNT(*) AS n
          FROM news_mentions m
          INNER JOIN bills b ON b.id = m.bill_id
          WHERE m.published_at >= datetime('now', '-7 days')
            AND m.match_confidence >= ?
          GROUP BY m.bill_id
          ORDER BY n DESC
          LIMIT 10`,
    args: [FLOOR],
  });
  for (const r of top.rows) {
    console.log(`  ${r.bill_id}\tn=${r.n}\t${(r.title as string).slice(0, 80)}`);
  }

  // 5. Total bills with summary (denominator for "% of feed rows that show a count")
  console.log(`\n--- 5. Feed denominator ---`);
  const denom = await db.execute(
    `SELECT
       COUNT(*) AS bills_total,
       SUM(CASE WHEN summary IS NOT NULL AND (is_ceremonial = 0 OR is_ceremonial IS NULL) THEN 1 ELSE 0 END) AS feed_visible
     FROM bills`,
  );
  console.log(`  bills_total=${denom.rows[0]?.bills_total}`);
  console.log(`  feed_visible (summary IS NOT NULL, non-ceremonial)=${denom.rows[0]?.feed_visible}`);

  // 6. EXPLAIN: JOIN-at-read shape used by getFeedBills with mention_count_7d
  console.log(`\n--- 6. EXPLAIN QUERY PLAN: JOIN-at-read getFeedBills shape ---`);
  const eqp = await db.execute({
    sql: `EXPLAIN QUERY PLAN
          SELECT b.id, b.title, b.latest_action_date,
                 COALESCE(m.n, 0) AS mention_count_7d
          FROM bills b
          LEFT JOIN (
            SELECT bill_id, COUNT(*) AS n
            FROM news_mentions
            WHERE published_at >= datetime('now', '-7 days')
              AND match_confidence >= ?
            GROUP BY bill_id
          ) m ON m.bill_id = b.id
          WHERE b.summary IS NOT NULL
            AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
          ORDER BY b.latest_action_date DESC NULLS LAST, b.id DESC
          LIMIT 50`,
    args: [FLOOR],
  });
  for (const r of eqp.rows) {
    console.log(`  ${JSON.stringify(r)}`);
  }

  // 7. Time the join-at-read query
  console.log(`\n--- 7. Wall-clock for JOIN-at-read getFeedBills shape ---`);
  const t0 = Date.now();
  const r2 = await db.execute({
    sql: `SELECT b.id, b.title, b.latest_action_date,
                 COALESCE(m.n, 0) AS mention_count_7d
          FROM bills b
          LEFT JOIN (
            SELECT bill_id, COUNT(*) AS n
            FROM news_mentions
            WHERE published_at >= datetime('now', '-7 days')
              AND match_confidence >= ?
            GROUP BY bill_id
          ) m ON m.bill_id = b.id
          WHERE b.summary IS NOT NULL
            AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
          ORDER BY b.latest_action_date DESC NULLS LAST, b.id DESC
          LIMIT 50`,
    args: [FLOOR],
  });
  console.log(`  rows=${r2.rows.length}  time=${Date.now() - t0}ms`);

  // 8. Compare: plain getFeedBills shape WITHOUT the join
  console.log(`\n--- 8. Wall-clock for plain getFeedBills (no join) ---`);
  const t1 = Date.now();
  const r3 = await db.execute(
    `SELECT id, title, latest_action_date
     FROM bills
     WHERE summary IS NOT NULL
       AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
     ORDER BY latest_action_date DESC NULLS LAST, id DESC
     LIMIT 50`,
  );
  console.log(`  rows=${r3.rows.length}  time=${Date.now() - t1}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
