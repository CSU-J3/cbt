// HO 129 Phase 1 — read-only diagnostic for /search tabs.
// Picks one query and runs per-entity COUNT + sample rows so the
// relative ratios decide which tabs are worth shipping. No writes.
import "dotenv/config";
import { getDb } from "../../lib/db";

const Q = process.argv[2] ?? "education";

async function main() {
  const db = getDb();
  const like = `%${Q.toLowerCase()}%`;
  const idLike = `%${Q.toLowerCase().replace(/-/g, "")}%`;

  console.log(`\nrepresentative query: "${Q}"\n`);

  // 1. BILLS — mirror the existing /feed?q= LIKE clause exactly.
  console.log("--- 1. BILLS count ---");
  const bills = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM bills
          WHERE summary IS NOT NULL
            AND (LOWER(title) LIKE ?
              OR LOWER(summary) LIKE ?
              OR LOWER(id) LIKE ?
              OR LOWER(sponsor_name) LIKE ?
              OR REPLACE(LOWER(id), '-', '') LIKE ?)`,
    args: [like, like, like, like, idLike],
  });
  console.log(`bills_count=${bills.rows[0]?.n}`);

  const billsSamples = await db.execute({
    sql: `SELECT id, title FROM bills
          WHERE summary IS NOT NULL
            AND (LOWER(title) LIKE ?
              OR LOWER(summary) LIKE ?
              OR LOWER(id) LIKE ?
              OR LOWER(sponsor_name) LIKE ?
              OR REPLACE(LOWER(id), '-', '') LIKE ?)
          ORDER BY latest_action_date DESC NULLS LAST
          LIMIT 3`,
    args: [like, like, like, like, idLike],
  });
  for (const r of billsSamples.rows) {
    console.log(`  ${r.id}\t${(r.title as string).slice(0, 90)}`);
  }

  // 2. MEMBERS — query the members table directly (canonical per HO 60).
  console.log("\n--- 2. MEMBERS count (members table) ---");
  const members = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM members
          WHERE LOWER(name) LIKE ?
             OR LOWER(state_name) LIKE ?`,
    args: [like, like],
  });
  console.log(`members_count=${members.rows[0]?.n}`);

  const membersSamples = await db.execute({
    sql: `SELECT bioguide_id, name, party, state FROM members
          WHERE LOWER(name) LIKE ?
             OR LOWER(state_name) LIKE ?
          LIMIT 5`,
    args: [like, like],
  });
  for (const r of membersSamples.rows) {
    console.log(`  ${r.bioguide_id}\t${r.name}\t${r.party}-${r.state}`);
  }

  // Sanity: also report the legacy distinct-sponsor-name route the
  // handoff template assumed, in case it surfaces matches members misses.
  console.log("\n--- 2b. legacy DISTINCT sponsor_name match (for compare) ---");
  const sponsorAlt = await db.execute({
    sql: `SELECT COUNT(DISTINCT sponsor_name) AS n FROM bills
          WHERE LOWER(sponsor_name) LIKE ?`,
    args: [like],
  });
  console.log(`distinct_sponsor_count=${sponsorAlt.rows[0]?.n}`);

  // 3. NEWS — actual columns are article_title / article_summary / source.
  console.log("\n--- 3. NEWS count (news_mentions) ---");
  const news = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM news_mentions
          WHERE LOWER(article_title) LIKE ?
             OR LOWER(article_summary) LIKE ?
             OR LOWER(source) LIKE ?`,
    args: [like, like, like],
  });
  console.log(`news_count=${news.rows[0]?.n}`);

  const newsSamples = await db.execute({
    sql: `SELECT bill_id, source, article_title, published_at
          FROM news_mentions
          WHERE LOWER(article_title) LIKE ?
             OR LOWER(article_summary) LIKE ?
             OR LOWER(source) LIKE ?
          ORDER BY published_at DESC
          LIMIT 3`,
    args: [like, like, like],
  });
  for (const r of newsSamples.rows) {
    console.log(
      `  [${r.bill_id}] ${r.source}\t${(r.article_title as string).slice(0, 80)}\t${(r.published_at as string).slice(0, 10)}`,
    );
  }

  // 4. REPORTS — title + content_md (single TEXT column).
  console.log("\n--- 4. REPORTS count (reports.title + content_md) ---");
  const reports = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM reports
          WHERE LOWER(title) LIKE ?
             OR LOWER(content_md) LIKE ?`,
    args: [like, like],
  });
  console.log(`reports_count=${reports.rows[0]?.n}`);

  const reportsSamples = await db.execute({
    sql: `SELECT slug, title, week_start FROM reports
          WHERE LOWER(title) LIKE ?
             OR LOWER(content_md) LIKE ?
          ORDER BY week_start DESC
          LIMIT 3`,
    args: [like, like],
  });
  for (const r of reportsSamples.rows) {
    console.log(`  ${r.slug}\t${r.week_start}\t${r.title}`);
  }

  // 5. Cost shape — confirm reports table size before assuming the LIKE
  // scan is cheap.
  console.log("\n--- 5. reports table size + avg content_md length ---");
  const sz = await db.execute(
    `SELECT COUNT(*) AS n,
            AVG(LENGTH(content_md)) AS avg_len,
            MAX(LENGTH(content_md)) AS max_len
     FROM reports`,
  );
  const row = sz.rows[0];
  console.log(
    `rows=${row?.n}\tavg_len=${row?.avg_len}\tmax_len=${row?.max_len}`,
  );

  // 6. Run two more queries to confirm the ratios aren't an artifact of
  // "education" being unusually broad.
  for (const alt of ["immigration", "healthcare"]) {
    const aLike = `%${alt}%`;
    const aIdLike = `%${alt}%`;
    const [b, m, nw, rp] = await Promise.all([
      db.execute({
        sql: `SELECT COUNT(*) AS n FROM bills
              WHERE summary IS NOT NULL
                AND (LOWER(title) LIKE ?
                  OR LOWER(summary) LIKE ?
                  OR LOWER(id) LIKE ?
                  OR LOWER(sponsor_name) LIKE ?
                  OR REPLACE(LOWER(id), '-', '') LIKE ?)`,
        args: [aLike, aLike, aLike, aLike, aIdLike],
      }),
      db.execute({
        sql: `SELECT COUNT(*) AS n FROM members
              WHERE LOWER(name) LIKE ? OR LOWER(state_name) LIKE ?`,
        args: [aLike, aLike],
      }),
      db.execute({
        sql: `SELECT COUNT(*) AS n FROM news_mentions
              WHERE LOWER(article_title) LIKE ?
                 OR LOWER(article_summary) LIKE ?
                 OR LOWER(source) LIKE ?`,
        args: [aLike, aLike, aLike],
      }),
      db.execute({
        sql: `SELECT COUNT(*) AS n FROM reports
              WHERE LOWER(title) LIKE ?
                 OR LOWER(content_md) LIKE ?`,
        args: [aLike, aLike],
      }),
    ]);
    console.log(
      `\n[${alt}] bills=${b.rows[0]?.n} members=${m.rows[0]?.n} news=${nw.rows[0]?.n} reports=${rp.rows[0]?.n}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
