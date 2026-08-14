// HO 661 — READ-ONLY. Size the isSettled reclassification and name its members.
//
// BUILDS NOTHING. No INSERT/UPDATE/DELETE, no seed calls, no writes of any kind.
// Every statement below is a SELECT.
//
// Run it TWICE: once pre-deploy (the prediction) and once post-tick (the
// confirmation), so both sides of the predicted-vs-observed table come from ONE
// instrument rather than two hand-written queries that can disagree.
//
// THE PREDICATE IS MIRRORED HERE, and that is a dependency with no compiler edge
// (SKILL: "a diagnostic that pins a verbatim copy of shipped logic must name the
// mirrored SHA"). Source: `lib/primaries-sync.ts::isSettled`, mirrored at
// `4aee4ad`+1 (the HO 661 code commit). It is a SET-LEVEL restatement, not a
// copy — isSettled answers one id, this counts populations — so it cannot be
// replaced by an import. What IS imported rather than mirrored is the window
// length itself (`SETTLE_WINDOW_DAYS`) and the floor derivation
// (`settleWindowFloor`), which is where a silent drift would actually hurt.
//
//   npx tsx scripts/diagnostic/settle-predicate-661.ts
import "dotenv/config";
import { getDb } from "@/lib/db";
import { SETTLE_WINDOW_DAYS, settleWindowFloor } from "@/lib/primaries-sync";

// ── the two predicates, as SQL fragments over `primaries p` ────────────────
const HAS_SHARE = `EXISTS (SELECT 1 FROM primary_candidates pc
                            WHERE pc.primary_id = p.id AND pc.vote_pct IS NOT NULL)`;
const HAS_WINNER = `EXISTS (SELECT 1 FROM primary_candidates pc
                             WHERE pc.primary_id = p.id AND pc.status = 'winner')`;
const HAS_ROSTER = `EXISTS (SELECT 1 FROM primary_candidates pc
                             WHERE pc.primary_id = p.id)`;

// OLD (pre-661): past-dated AND carrying at least one recorded share.
const OLD_SETTLED = `p.primary_date < ? AND ${HAS_SHARE}`;
// NEW (HO 661): past-dated AND (decided OR expired past the re-check window).
const NEW_SETTLED = `p.primary_date < ? AND (${HAS_WINNER} OR p.primary_date < ?)`;

async function main() {
  const db = getDb();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const floor = settleWindowFloor(now);

  console.log("HO 661 — settle-predicate reclassification");
  console.log(`  today=${today}  floor=${floor}  N=${SETTLE_WINDOW_DAYS} days\n`);

  const one = async (sql: string, args: (string | number)[]) => {
    const rs = await db.execute({ sql, args });
    return Number(rs.rows[0]?.n ?? 0);
  };
  const ids = async (sql: string, args: (string | number)[]) => {
    const rs = await db.execute({ sql, args });
    return rs.rows.map((r) => ({
      id: String(r.id),
      date: r.primary_date === null ? "—" : String(r.primary_date),
    }));
  };

  // ── the two settled counts ───────────────────────────────────────────────
  const total = await one(`SELECT COUNT(*) AS n FROM primaries p`, []);
  const oldSettled = await one(
    `SELECT COUNT(*) AS n FROM primaries p WHERE ${OLD_SETTLED}`,
    [today],
  );
  const newSettled = await one(
    `SELECT COUNT(*) AS n FROM primaries p WHERE ${NEW_SETTLED}`,
    [today, floor],
  );

  // ── the five classes ─────────────────────────────────────────────────────
  // 1 — scored, uncalled, age < N → UNFREEZES (the defect class).
  const U = await ids(
    `SELECT p.id, p.primary_date FROM primaries p
      WHERE p.primary_date < ? AND p.primary_date >= ?
        AND ${HAS_SHARE} AND NOT ${HAS_WINNER}
      ORDER BY p.primary_date DESC, p.id`,
    [today, floor],
  );
  // 2 — scored, uncalled, age >= N → stays settled, now via expiry.
  const X = await ids(
    `SELECT p.id, p.primary_date FROM primaries p
      WHERE p.primary_date < ? AND ${HAS_SHARE} AND NOT ${HAS_WINNER}
      ORDER BY p.primary_date DESC, p.id`,
    [floor],
  );
  // 3 — called, shareless → NEWLY SETTLES.
  const C = await ids(
    `SELECT p.id, p.primary_date FROM primaries p
      WHERE p.primary_date < ? AND ${HAS_WINNER} AND NOT ${HAS_SHARE}
      ORDER BY p.primary_date DESC, p.id`,
    [today],
  );
  // 4 — shareless, uncalled, age >= N → NEWLY SETTLES via expiry.
  const E = await one(
    `SELECT COUNT(*) AS n FROM primaries p
      WHERE p.primary_date < ? AND NOT ${HAS_SHARE} AND NOT ${HAS_WINNER}`,
    [floor],
  );
  const eRoster = await one(
    `SELECT COUNT(*) AS n FROM primaries p
      WHERE p.primary_date < ? AND NOT ${HAS_SHARE} AND NOT ${HAS_WINNER}
        AND ${HAS_ROSTER}`,
    [floor],
  );

  console.log("=== settled counts ===");
  console.log(`  primaries rows total:   ${total}`);
  console.log(`  OLD settled (scored):   ${oldSettled}`);
  console.log(`  NEW settled (decided|expired): ${newSettled}`);
  console.log(`  observed delta:         ${newSettled - oldSettled >= 0 ? "+" : ""}${newSettled - oldSettled}`);
  console.log(
    `  predicted delta (+|C| +|E| −|U|): ${C.length + E - U.length >= 0 ? "+" : ""}${C.length + E - U.length}` +
      `   [C=${C.length} E=${E} U=${U.length}]`,
  );
  const reconciles = newSettled - oldSettled === C.length + E - U.length;
  console.log(`  class arithmetic reconciles: ${reconciles ? "PASS" : "FAIL — investigate"}\n`);

  console.log(`=== class 1 — UNFREEZES (scored, uncalled, age < ${SETTLE_WINDOW_DAYS}d) — ${U.length} ===`);
  for (const r of U) console.log(`    ${r.date}  ${r.id}`);
  if (U.length === 0) console.log("    (none)");

  console.log(`\n=== class 2 — stays settled via EXPIRY (scored, uncalled, age >= ${SETTLE_WINDOW_DAYS}d) — ${X.length} ===`);
  for (const r of X) console.log(`    ${r.date}  ${r.id}`);
  if (X.length === 0) console.log("    (none)");

  console.log(`\n=== class 3 — NEWLY SETTLES (called, shareless) — ${C.length} ===`);
  for (const r of C) console.log(`    ${r.date}  ${r.id}`);
  if (C.length === 0) console.log("    (none)");

  console.log(`\n=== class 4 — NEWLY SETTLES via EXPIRY (shareless, uncalled, age >= ${SETTLE_WINDOW_DAYS}d) — ${E} ===`);
  console.log(`    with a roster on file:  ${eRoster}`);
  console.log(`    never had a page/roster: ${E - eRoster}`);

  console.log("\n  (class 5 — everything age < N shareless, plus all future rows — open, unchanged.)");
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
