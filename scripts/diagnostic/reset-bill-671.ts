// ============================================================================
// !! WRITE INSTRUMENT — THIS MUTATES THE PRODUCTION DATABASE !!
//
//   Mutation:  UPDATE bills SET summary = NULL WHERE id = ?   (one column, one row)
//   Effect:    the bill re-enters the summarize queue and is re-summarized by
//              prod's next */10 tick, which costs one Gemini call.
//
// It is GATED: the mutation runs ONLY with an explicit `--write`. Bare
// invocation, and `--check`, print the row and the eligibility predicate and
// change nothing. The gate exists because this file lives in a directory whose
// README describes read-only probes, and a mutation reached by running a file
// whose name sounded diagnostic is the failure being designed out (HO 672).
// ============================================================================
//
// HO 671 STEP 3 reading C — reset ONE bill's summary so the next tick has work.
//
// Authorised by Corey on the HO 671 review (option 1), conditions attached: the
// bill is named and its full row captured first (pick-bill-671.ts), the pick is
// deliberate (old, quiet, invisible on every /welcome surface), and the attempt
// budget is two. The mutation is one column on one row, and it self-heals: the
// runner repopulates summary/model/updated_at/topics/stage/is_ceremonial/
// text_length, and if this session dies mid-way prod's next unguarded */10 tick
// summarizes it within ten minutes.
//
// `npx tsx -e` is NOT used for this — it silently produced no output twice in
// this repo, which for a WRITE would mean not knowing whether it landed.
//
//   npx tsx scripts/diagnostic/reset-bill-671.ts <billId>            # inspect (default)
//   npx tsx scripts/diagnostic/reset-bill-671.ts <billId> --check    # explicit alias for the above
//   npx tsx scripts/diagnostic/reset-bill-671.ts <billId> --write    # PERFORMS THE MUTATION
import "dotenv/config";
import { createClient } from "@libsql/client";

async function main() {
  const id = process.argv[2];
  // The default is READ-ONLY and the mutation is opt-in. Inverted from the
  // original `--check`-to-be-safe shape: a flag you must remember in order NOT
  // to write is a flag that will be forgotten exactly once.
  const write = process.argv.includes("--write");
  if (!id) {
    throw new Error(
      "usage: reset-bill-671.ts <billId> [--check | --write]   (--write MUTATES prod)",
    );
  }
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const before = await db.execute({
    sql: `SELECT id, summary IS NULL AS summary_null, length(summary) AS len,
                 summary_model, summary_updated_at, topics, text_length, stage,
                 summarize_failed_at, summarize_attempts
            FROM bills WHERE id = ?`,
    args: [id],
  });
  const row = before.rows[0];
  if (!row) throw new Error(`no such bill: ${id}`);
  console.log("  BEFORE:", JSON.stringify(row));

  if (!write) {
    console.log("");
    console.log("  READ-ONLY: no mutation performed. Re-run with --write to null");
    console.log("  `summary` on this row and re-queue it for the next */10 tick.");
    return;
  }

  const res = await db.execute({
    sql: "UPDATE bills SET summary = NULL WHERE id = ?",
    args: [id],
  });
  console.log(`  UPDATE rowsAffected: ${res.rowsAffected}`);

  const after = await db.execute({
    sql: `SELECT summary IS NULL AS summary_null FROM bills WHERE id = ?`,
    args: [id],
  });
  console.log("  AFTER :", JSON.stringify(after.rows[0]));

  // The runner's own eligibility predicate — proof the next tick will claim it,
  // rather than an assumption that nulling one column was sufficient.
  const elig = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM bills
           WHERE id = ?
             AND summary IS NULL
             AND (summarize_failed_at IS NULL OR summarize_failed_at < datetime('now', '-24 hours'))
             AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`,
    args: [id],
  });
  console.log(`  ELIGIBLE under runSummarize's predicate: ${elig.rows[0]?.n} (must be 1)`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
