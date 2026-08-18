// HO 671 STEP 3 reading C — pick the bill whose summary will be reset, and
// capture its full row BEFORE anything is touched. READ-ONLY.
//
// Deliberate, not arbitrary. The pick must be: already summarized (so the reset
// is a reset, not a first fill), non-ceremonial, and invisible on every surface
// this HO measures — which on /welcome means not in the movers window
// (stage_observed_at within 7d), not among the 12 OLDEST by latest_action_date
// (the stalls panel takes exactly those), not enacted (the enacted panel), and
// carrying no news mentions (the news panel). An old, quiet, introduced-stage
// row satisfies all of it.
//
// Also checked because it decides whether the re-summarize appends a
// stage_transitions row: a settled bill's recomputed stage equals its stored
// stage, so decideStage returns "noop" and no transition is logged.
//
//   npx tsx scripts/diagnostic/pick-bill-671.ts [captureFile]
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createClient } from "@libsql/client";

async function main() {
  const capturePath = process.argv[2] ?? "";
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // The 12 oldest by latest_action_date — the /welcome stalls panel's exact
  // slice. The pick must not be one of these.
  const stalls = await db.execute(`
    SELECT id FROM bills
     WHERE latest_action_date IS NOT NULL
       AND latest_action_date < date('now', '-60 days')
       AND stage IN ('introduced','committee','floor','other_chamber','other')
       AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
     ORDER BY latest_action_date ASC
     LIMIT 12`);
  const stallIds = new Set(stalls.rows.map((r) => String(r.id)));
  console.log(`  /welcome stalls slice (excluded): ${[...stallIds].join(", ")}`);

  const cands = await db.execute(`
    SELECT b.id, b.bill_type, b.bill_number, b.stage, b.latest_action_date,
           b.update_date, b.stage_observed_at, b.is_ceremonial, b.cluster_id,
           b.cosponsor_count, length(b.summary) AS summary_len,
           (SELECT COUNT(*) FROM news_mentions n WHERE n.bill_id = b.id) AS mentions
      FROM bills b
     WHERE b.summary IS NOT NULL
       AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
       AND b.stage = 'introduced'
       AND b.latest_action_date < date('now', '-180 days')
       AND (b.stage_observed_at IS NULL OR b.stage_observed_at < datetime('now', '-60 days'))
       AND b.cluster_id IS NULL
     ORDER BY b.latest_action_date DESC
     LIMIT 40`);

  const eligible = cands.rows.filter(
    (r) => !stallIds.has(String(r.id)) && Number(r.mentions ?? 0) === 0,
  );
  console.log(`  candidates: ${cands.rows.length} · after exclusions: ${eligible.length}`);
  const pick = eligible[0];
  if (!pick) {
    console.log("  NO CANDIDATE — widen the window rather than relaxing the exclusions.");
    return;
  }
  console.log("");
  console.log("  PICK:");
  for (const [k, v] of Object.entries(pick)) {
    console.log(`    ${String(k).padEnd(18)} ${String(v).slice(0, 90)}`);
  }

  const full = await db.execute({
    sql: "SELECT * FROM bills WHERE id = ?",
    args: [String(pick.id)],
  });
  const row = full.rows[0];
  if (!row) throw new Error("full row vanished between queries");
  if (capturePath) {
    writeFileSync(capturePath, JSON.stringify(row, null, 1), "utf8");
    console.log(`\n  full row captured -> ${capturePath}`);
  }
  console.log("  columns that the reset clears and the runner rewrites:");
  for (const k of ["summary", "summary_model", "summary_updated_at", "topics", "text_length"]) {
    const v = (row as Record<string, unknown>)[k];
    console.log(
      `    ${k.padEnd(20)} ${v === null ? "NULL" : String(v).slice(0, 70).replace(/\s+/g, " ")}${String(v ?? "").length > 70 ? " …" : ""}`,
    );
  }
  console.log("");
  console.log(`  stage stored: ${row.stage} — a settled bill recomputes to the same stage,`);
  console.log("  so decideStage returns \"noop\" and NO stage_transitions row is appended.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
