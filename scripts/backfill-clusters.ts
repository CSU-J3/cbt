import "dotenv/config";
import { CLUSTER_PATTERNS, classifyCluster } from "../lib/cluster-patterns";
import { getDb } from "../lib/db";

type Row = { id: string; title: string; bill_type: string };

async function fetchRows(): Promise<Row[]> {
  const db = getDb();
  const rs = await db.execute(
    "SELECT id, title, bill_type FROM bills WHERE cluster_id IS NULL",
  );
  return rs.rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    bill_type: r.bill_type as string,
  }));
}

async function revalidateBillsCache(): Promise<void> {
  const url = process.env.REVALIDATE_URL;
  const secret = process.env.CRON_SECRET;
  if (!url || !secret) {
    console.log(
      "\nskipping cache revalidation: set REVALIDATE_URL and CRON_SECRET to auto-invalidate.",
    );
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) {
      console.warn(`revalidate POST ${url} -> ${res.status}: ${await res.text()}`);
      return;
    }
    console.log(`revalidated bills cache via ${url}`);
  } catch (err) {
    console.warn(`revalidate failed: ${(err as Error).message}`);
  }
}

async function main() {
  const rows = await fetchRows();
  console.log(`scanning ${rows.length} bill(s) with NULL cluster_id`);
  if (rows.length === 0) {
    console.log("nothing to do");
    return;
  }

  const db = getDb();
  const counts = new Map<string, number>();
  for (const p of CLUSTER_PATTERNS) counts.set(p.id, 0);
  let matched = 0;

  const t0 = Date.now();
  for (const row of rows) {
    const id = classifyCluster(row.title, row.bill_type);
    if (!id) continue;
    await db.execute({
      sql: "UPDATE bills SET cluster_id = ? WHERE id = ?",
      args: [id, row.id],
    });
    counts.set(id, (counts.get(id) ?? 0) + 1);
    matched++;
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\ndone in ${elapsed}s: matched ${matched}/${rows.length}`);
  for (const p of CLUSTER_PATTERNS) {
    console.log(`  ${p.id}: ${counts.get(p.id) ?? 0}`);
  }
  await revalidateBillsCache();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
