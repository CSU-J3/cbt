// HO 350 — procedural-housekeeping candidate set for /stale. READ-ONLY.
// Prints EXACTLY what the default filter would remove (frozen IDs OR the
// recurring "Electing Members…" title pattern, minus the blocklist), so the
// frozen list can be eyeballed before it freezes. No writes, no commit.
import "dotenv/config";
import { createClient } from "@libsql/client";
import {
  STALE_PROCEDURAL_BLOCKLIST,
  STALE_PROCEDURAL_IDS,
  STALE_PROCEDURAL_TITLE_PATTERN,
} from "../../lib/stale-procedural";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const STALE_DAYS = 60;
const PAST_COMMITTEE = ["floor", "other_chamber", "president"];

function line(r: Record<string, unknown>, tag: string) {
  console.log(
    `   ${tag.padEnd(8)} ${String(r.id).padEnd(15)} ${String(r.stage ?? "NULL").padEnd(13)} ${String(r.latest_action_date ?? "-").padEnd(11)} ${String(r.t)}`,
  );
}

async function main() {
  console.log("INSTANCE:", (process.env.TURSO_DATABASE_URL || "").replace(/\?.*/, ""));
  const idPh = STALE_PROCEDURAL_IDS.map(() => "?").join(",");
  const blockPh = STALE_PROCEDURAL_BLOCKLIST.map(() => "?").join(",");

  // The FULL candidate removal set (any stage) — frozen IDs OR title pattern,
  // minus the blocklist. This is what the default filter hides.
  const removed = await db.execute({
    sql: `SELECT id, stage, latest_action_date,
                 substr(title,1,90) AS t,
                 CASE WHEN id IN (${idPh}) THEN 'frozen' ELSE 'pattern' END AS via
          FROM bills
          WHERE (id IN (${idPh}) OR lower(title) LIKE ?)
            AND id NOT IN (${blockPh})
          ORDER BY via, id`,
    args: [
      ...STALE_PROCEDURAL_IDS,
      ...STALE_PROCEDURAL_IDS,
      STALE_PROCEDURAL_TITLE_PATTERN,
      ...STALE_PROCEDURAL_BLOCKLIST,
    ] as never,
  });
  const frozen = removed.rows.filter((r) => r.via === "frozen");
  const pattern = removed.rows.filter((r) => r.via === "pattern");

  console.log(`\n========== FROZEN IDs (one-time opening-week) — ${frozen.length} ==========`);
  for (const r of frozen) line(r, "frozen");

  console.log(`\n========== TITLE PATTERN "${STALE_PROCEDURAL_TITLE_PATTERN}" — ${pattern.length} ==========`);
  for (const r of pattern) line(r, "pattern");

  console.log(`\n   TOTAL candidate removals (all stages): ${removed.rows.length}`);

  // How many fall in the DEFAULT view (past-committee + 60-day stale) — the rows
  // the default actually strips from what the user sees.
  const inDefault = removed.rows.filter(
    (r) =>
      r.stage != null &&
      PAST_COMMITTEE.includes(String(r.stage)) &&
      r.latest_action_date != null,
  );
  console.log(
    `   ...of which sit in the DEFAULT past-committee group (floor/other_chamber/president): ${inDefault.length}`,
  );

  // Blocklist confirmation — these must NOT be in the removal set.
  console.log(`\n========== BLOCKLIST (must SURVIVE) — ${STALE_PROCEDURAL_BLOCKLIST.length} ==========`);
  const block = await db.execute({
    sql: `SELECT id, stage, latest_action_date, substr(title,1,90) AS t FROM bills WHERE id IN (${blockPh}) ORDER BY id`,
    args: [...STALE_PROCEDURAL_BLOCKLIST] as never,
  });
  const removedIds = new Set(removed.rows.map((r) => String(r.id)));
  for (const r of block.rows) {
    const bad = removedIds.has(String(r.id)) ? "  <-- **REMOVED (BAD)**" : "  (survives ✓)";
    line(r, "block");
    console.log(bad);
  }

  // Boundary: the Rules package + "Amending the Rules" must NOT be caught.
  console.log(`\n========== BOUNDARY: Rules resolutions (must SURVIVE) ==========`);
  const rules = await db.execute(
    `SELECT id, stage, latest_action_date, substr(title,1,90) AS t FROM bills
     WHERE bill_type IN ('hres','sres') AND lower(title) LIKE '%rules of the house%' ORDER BY id LIMIT 12`,
  );
  for (const r of rules.rows) {
    const caught = removedIds.has(String(r.id)) ? "  <-- **CAUGHT (BAD)**" : "  (survives ✓)";
    line(r, "rules");
    console.log(caught);
  }

  console.log("\nDONE.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
