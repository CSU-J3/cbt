// HO 689 — backfill the three-sentence week summary onto existing `reports`
// rows, through the SHIPPED path.
//
// It calls exactly what `/api/cron/weekly-report` calls — buildWeekSummaryPayload
// → generateWeekSummary → the same UPDATE the cron's writeReport performs — so a
// row produced here and a row produced by the Monday tick are the same artifact.
// A backfill that reimplemented the generation would be proving a path nobody
// runs.
//
// REFUSALS ARE REPORTED AND SKIPPED, never patched around: if the grounding gate
// or the three-sentence cap rejects a week (twice, counting the one corrective
// retry inside generateWeekSummary), that week keeps a NULL summary. NULL is a
// real state the dashboard handles by falling back to the last week that has
// one, under that week's own label.
//
// This does NOT write content_md and does not regenerate reports — it only ever
// sets summary_text on rows that already exist.
//
//   npx tsx scripts/backfill-week-summaries.ts            # dry run, prints only
//   npx tsx scripts/backfill-week-summaries.ts --write     # persist
//   npx tsx scripts/backfill-week-summaries.ts --write --weeks 3
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { getDb } from "../lib/db";
import {
  buildWeekSummaryPayload,
  generateWeekSummary,
} from "../lib/week-summary";

async function main() {
  const write = process.argv.includes("--write");
  const wi = process.argv.indexOf("--weeks");
  const limit = wi >= 0 ? Number(process.argv[wi + 1] ?? 3) : 3;
  const onlyMissing = !process.argv.includes("--all");

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("GEMINI_API_KEY is not set");
    process.exit(1);
  }

  const db = getDb();
  const client = new GoogleGenAI({ apiKey: key });

  const rs = await db.execute({
    sql: `SELECT slug, summary_text FROM reports
           ${onlyMissing ? "WHERE summary_text IS NULL" : ""}
           ORDER BY week_start DESC LIMIT ?`,
    args: [limit],
  });

  console.log(
    `HO 689 week-summary backfill — ${rs.rows.length} week(s), ${write ? "WRITE" : "DRY RUN"}\n`,
  );

  let stored = 0;
  let refused = 0;
  for (const row of rs.rows) {
    const slug = String(row.slug);
    const payload = await buildWeekSummaryPayload(db, slug);
    const gen = await generateWeekSummary(client, payload);

    if (!gen.ok) {
      refused++;
      console.log(`  ${slug}  REFUSED after ${gen.attempts} attempt(s): ${gen.reason}`);
      continue;
    }
    console.log(`  ${slug}  OK (attempt ${gen.attempts})`);
    console.log(`    ${gen.text}`);

    if (write) {
      const up = await db.execute({
        sql: `UPDATE reports SET summary_text = ? WHERE slug = ?`,
        args: [gen.text, slug],
      });
      // Read back — a write that is not read back is not an instrument.
      const check = await db.execute({
        sql: `SELECT length(summary_text) AS n FROM reports WHERE slug = ?`,
        args: [slug],
      });
      console.log(
        `    written: rowsAffected=${up.rowsAffected}, stored length=${check.rows[0]?.n ?? "NULL"}`,
      );
      stored++;
    }
    console.log("");
  }

  console.log(`\n  stored=${stored}  refused=${refused}  (${write ? "written" : "dry run — nothing persisted"})`);
  if (write) {
    console.log(
      "  NOTE: the dashboard reads this through the `reports` cache tag; the weekly cron revalidates it. Flush manually with POST /api/revalidate?tag=reports if you need it immediately.",
    );
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
