import "dotenv/config";
import { readFileSync } from "node:fs";
import { getDb } from "../lib/db";
import { ALLOWED_STAGES } from "../lib/summarize";

async function main() {
  const db = getDb();

  const topicAffected = readFileSync(process.argv[2] ?? "/tmp/affected_topic_bills.txt", "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const placeholders = ALLOWED_STAGES.map(() => "?").join(",");
  const stageRs = await db.execute({
    sql: `SELECT id FROM bills WHERE stage NOT IN (${placeholders})`,
    args: [...ALLOWED_STAGES],
  });
  const stageAffected = stageRs.rows.map((r) => r.id as string);

  const all = Array.from(new Set([...topicAffected, ...stageAffected]));
  console.log(
    `topic-affected: ${topicAffected.length}, stage-affected: ${stageAffected.length}, union: ${all.length}`,
  );
  console.log("stage-affected ids:", stageAffected);

  if (all.length === 0) {
    console.log("nothing to clear");
    return;
  }

  const idPlaceholders = all.map(() => "?").join(",");
  const result = await db.execute({
    sql: `UPDATE bills
          SET summary = NULL, summary_model = NULL, summary_updated_at = NULL,
              topics = NULL, stage = NULL
          WHERE id IN (${idPlaceholders})`,
    args: all,
  });
  console.log(`cleared ${result.rowsAffected} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
