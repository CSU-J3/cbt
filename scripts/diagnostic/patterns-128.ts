// HO 128 Phase 1 — read-only diagnostic for /patterns bubble-cluster design.
// Runs the five queries from the handoff against the live Turso DB and
// prints raw output. No writes.
import "dotenv/config";
import { getDb } from "../../lib/db";

async function main() {
  const db = getDb();

  console.log("\n--- 1. Per-cluster counts ---");
  const counts = await db.execute(
    `SELECT cluster_id, COUNT(*) AS n
     FROM bills
     WHERE cluster_id IS NOT NULL
     GROUP BY cluster_id
     ORDER BY n DESC`,
  );
  for (const r of counts.rows) {
    console.log(`${r.cluster_id}\t${r.n}`);
  }

  console.log("\n--- 2. Ceremonial ratio per cluster ---");
  const cer = await db.execute(
    `SELECT cluster_id,
            COUNT(*) AS total,
            SUM(CASE WHEN is_ceremonial = 1 THEN 1 ELSE 0 END) AS ceremonial,
            ROUND(100.0 * SUM(CASE WHEN is_ceremonial = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS ceremonial_pct
     FROM bills
     WHERE cluster_id IS NOT NULL
     GROUP BY cluster_id
     ORDER BY total DESC`,
  );
  for (const r of cer.rows) {
    console.log(
      `${r.cluster_id}\ttotal=${r.total}\tceremonial=${r.ceremonial}\tpct=${r.ceremonial_pct}%`,
    );
  }

  console.log("\n--- 3. Stage mix per cluster ---");
  const stages = await db.execute(
    `SELECT cluster_id, stage, COUNT(*) AS n
     FROM bills
     WHERE cluster_id IS NOT NULL
     GROUP BY cluster_id, stage
     ORDER BY cluster_id, n DESC`,
  );
  for (const r of stages.rows) {
    console.log(`${r.cluster_id}\t${r.stage ?? "(null)"}\t${r.n}`);
  }

  console.log("\n--- 4a. Top 5 sponsors per cluster (each) ---");
  const clusters = (counts.rows.map((r) => r.cluster_id) as string[]).filter(
    Boolean,
  );
  for (const c of clusters) {
    console.log(`\n  cluster=${c}`);
    const tops = await db.execute({
      sql: `SELECT sponsor_name, sponsor_party, COUNT(*) AS n
            FROM bills
            WHERE cluster_id = ?
            GROUP BY sponsor_name
            ORDER BY n DESC
            LIMIT 5`,
      args: [c],
    });
    for (const r of tops.rows) {
      console.log(
        `    ${r.sponsor_name ?? "(null)"} (${r.sponsor_party ?? "?"})\t${r.n}`,
      );
    }
  }

  console.log("\n--- 5. Unmatched count ---");
  const um = await db.execute(
    `SELECT COUNT(*) AS unmatched FROM bills WHERE cluster_id IS NULL`,
  );
  console.log(`unmatched=${um.rows[0]?.unmatched}`);

  console.log("\n--- 5b. Unmatched non-ceremonial count (page actually shows) ---");
  const umNc = await db.execute(
    `SELECT COUNT(*) AS unmatched FROM bills
     WHERE cluster_id IS NULL
       AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`,
  );
  console.log(`unmatched_non_ceremonial=${umNc.rows[0]?.unmatched}`);

  console.log("\n--- 6. Dominant topic per cluster (preview for encoding option c) ---");
  const topics = await db.execute(
    `SELECT b.cluster_id, t.value AS topic, COUNT(*) AS n
     FROM bills b, json_each(b.topics) t
     WHERE b.cluster_id IS NOT NULL AND b.topics IS NOT NULL
     GROUP BY b.cluster_id, t.value
     ORDER BY b.cluster_id, n DESC`,
  );
  let last = "";
  for (const r of topics.rows) {
    const cid = r.cluster_id as string;
    if (cid !== last) {
      console.log(`  ${cid}:`);
      last = cid;
    }
    console.log(`    ${r.topic ?? "(null)"}\t${r.n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
