// HO 686 — READ-ONLY. Per-row state + re-derived floor date for the four rows
// whose HO 661 settle windows close on/around 2026-09-03.
//
// BUILDS NOTHING. No INSERT/UPDATE/DELETE. Every statement below is a SELECT.
//
// WHY THIS EXISTS BESIDE settle-predicate-661.ts, RATHER THAN REPLACING IT:
// that instrument is SET-LEVEL — it counts populations and names class members.
// It cannot answer "what is the full state of THIS row and when does IT floor",
// which is what the settle-window read needs. The two are siblings, not
// versions: 661 sizes the reclassification, this reads named rows.
//
// THE PREDICATE IS MIRRORED HERE, a dependency with no compiler edge (SKILL:
// "a diagnostic that pins a verbatim copy of shipped logic must name the
// mirrored SHA"). Source: `lib/primaries-sync.ts::isSettled`, which is NOT
// exported, mirrored at `ab44d3d` (HEAD at authoring). Reconciled at HO 686:
// the only change to that file since the HO 661 code commit `c0d2376` is an
// unrelated `dashboard_state` tenant comment, so this mirror and the 661
// instrument's mirror agree with the shipped predicate.
//
// WHAT IS IMPORTED RATHER THAN MIRRORED — and this is the load-bearing half —
// is the window length (`SETTLE_WINDOW_DAYS`) and the floor derivation
// (`settleWindowFloor`). The floor date below is therefore NOT computed by
// hand-arithmetic ("primary_date + N days"); it is found by SIMULATION — walking
// candidate `today` values through the SHIPPED `settleWindowFloor` until the
// expiry term flips. An off-by-one in my reasoning cannot survive that, which is
// the entire point: the filed floor dates are a claim to re-derive.
//
// CONTROLS. Two, so a reading here is not a constant:
//   POSITIVE — a past-dated contest carrying a winner, well outside the window.
//              The predicate must read SETTLED, and an independent raw read of
//              its candidate rows must show the winner. If this reads NOT
//              SETTLED, the instrument is broken and every verdict below is void.
//   NEGATIVE — a future-dated contest. The predicate must read NOT SETTLED.
//              Without it, a predicate hardwired to `true` would pass the
//              positive control and every target row would read "settled".
// A zero in the target section means "no such row in `primaries`" — which is
// itself a finding, not an absence of data.
//
// REUSABLE ON ANY CONTEST ID. The four HO 686 rows are the DEFAULT, not the
// subject — pass ids positionally to read a different window. This is why the
// successor windows' floors in `docs/backlog.md` are derived by running this
// instrument rather than by the `+30` arithmetic that produced the off-by-one
// it exists to have caught:
//
//   npx tsx scripts/diagnostic/settle-window-686.ts
//   npx tsx scripts/diagnostic/settle-window-686.ts house-AK-00-2026-open senate-AK-2026-open
import "dotenv/config";
import { getDb } from "@/lib/db";
import { SETTLE_WINDOW_DAYS, settleWindowFloor } from "@/lib/primaries-sync";

const DEFAULT_TARGETS = [
  "house-AZ-03-2026-R",
  "house-VA-10-2026-R",
  "house-WA-05-2026-open",
  "house-WA-08-2026-open",
];
const TARGETS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_TARGETS;

// Mirror of isSettled's WHERE, per-id. See the SHA note above.
const SETTLED_SQL = `SELECT 1 FROM primaries p
   WHERE p.id = ? AND p.primary_date < ?
     AND ( EXISTS (SELECT 1 FROM primary_candidates pc
                    WHERE pc.primary_id = p.id AND pc.status = 'winner')
           OR p.primary_date < ? )
   LIMIT 1`;

type Db = ReturnType<typeof getDb>;

async function settled(db: Db, id: string, today: string, floor: string) {
  const rs = await db.execute({ sql: SETTLED_SQL, args: [id, today, floor] });
  return rs.rows.length > 0;
}

// Walk forward from the row's own date until the EXPIRY term flips, using the
// shipped settleWindowFloor. Returns the first YYYY-MM-DD on which the row is
// settled-by-expiry (i.e. settled even with no winner marked).
function floorDate(primaryDate: string): string {
  const start = Date.parse(`${primaryDate}T12:00:00.000Z`);
  for (let d = 0; d <= SETTLE_WINDOW_DAYS + 10; d++) {
    const probe = new Date(start + d * 864e5).toISOString();
    if (primaryDate < settleWindowFloor(probe)) return probe.slice(0, 10);
  }
  return "UNRESOLVED";
}

async function main() {
  const db = getDb();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const floor = settleWindowFloor(now);

  console.log("HO 686 — settle-window per-row read");
  console.log(`  now=${now}`);
  console.log(`  today=${today}  windowFloor=${floor}  N=${SETTLE_WINDOW_DAYS} days\n`);

  // ── controls ────────────────────────────────────────────────────────────
  console.log("=== CONTROLS ===");
  const posRs = await db.execute({
    sql: `SELECT p.id, p.primary_date FROM primaries p
           WHERE p.primary_date < ?
             AND EXISTS (SELECT 1 FROM primary_candidates pc
                          WHERE pc.primary_id = p.id AND pc.status = 'winner')
           ORDER BY p.primary_date ASC LIMIT 1`,
    args: [floor],
  });
  if (posRs.rows.length === 0) {
    console.log("  POSITIVE: NO CANDIDATE FOUND — cannot validate. HALT.");
  } else {
    const id = String(posRs.rows[0]!.id);
    const date = String(posRs.rows[0]!.primary_date);
    const verdict = await settled(db, id, today, floor);
    const raw = await db.execute({
      sql: `SELECT name, status, vote_pct FROM primary_candidates
             WHERE primary_id = ? AND status = 'winner'`,
      args: [id],
    });
    console.log(`  POSITIVE  ${id}  (${date})`);
    console.log(`    predicate says SETTLED: ${verdict}   [expected true]`);
    console.log(
      `    independent raw read — winner rows: ${raw.rows.length}` +
        raw.rows.map((r) => `\n      ${String(r.name)} · ${String(r.status)} · vote_pct=${r.vote_pct ?? "NULL"}`).join(""),
    );
    console.log(`    VERDICT: ${verdict && raw.rows.length > 0 ? "PASS" : "FAIL — instrument void"}`);
  }

  const negRs = await db.execute({
    sql: `SELECT id, primary_date FROM primaries
           WHERE primary_date > ? ORDER BY primary_date ASC LIMIT 1`,
    args: [today],
  });
  if (negRs.rows.length === 0) {
    console.log("  NEGATIVE: no future-dated row exists — control unavailable.");
  } else {
    const id = String(negRs.rows[0]!.id);
    const date = String(negRs.rows[0]!.primary_date);
    const verdict = await settled(db, id, today, floor);
    console.log(`  NEGATIVE  ${id}  (${date})`);
    console.log(`    predicate says SETTLED: ${verdict}   [expected false]`);
    console.log(`    VERDICT: ${verdict === false ? "PASS" : "FAIL — predicate is constant-true"}`);
  }

  // ── the four target rows ────────────────────────────────────────────────
  console.log("\n=== TARGET ROWS ===");
  for (const id of TARGETS) {
    const pr = await db.execute({
      sql: `SELECT id, state, district, chamber, party, primary_date, runoff_date,
                   primary_type, election_round, updated_at
              FROM primaries WHERE id = ?`,
      args: [id],
    });
    console.log(`\n── ${id}`);
    if (pr.rows.length === 0) {
      console.log("   NO SUCH ROW in `primaries` — finding, not an absence of data.");
      continue;
    }
    const r = pr.rows[0]!;
    const pdate = r.primary_date === null ? null : String(r.primary_date);
    console.log(
      `   primary_date=${pdate ?? "NULL"}  round=${String(r.election_round)}  ` +
        `type=${r.primary_type ?? "NULL"}  runoff_date=${r.runoff_date ?? "NULL"}`,
    );
    console.log(`   primaries.updated_at=${r.updated_at ?? "NULL"}`);

    if (pdate === null) {
      console.log("   floor: UNDEFINED (NULL primary_date — never settles by expiry; the date term is NULL-false)");
    } else {
      const fd = floorDate(pdate);
      console.log(`   RE-DERIVED floor (first settled-by-expiry day) = ${fd}`);
      const daysPast = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${fd}T12:00:00Z`)) / 864e5);
      console.log(
        `   vs today ${today}: ${daysPast > 0 ? `${daysPast} day(s) PAST floor` : daysPast === 0 ? "floors TODAY" : `${-daysPast} day(s) BEFORE floor`}`,
      );
    }

    const isS = await settled(db, id, today, floor);
    const hasWinner = await db.execute({
      sql: `SELECT 1 FROM primary_candidates WHERE primary_id = ? AND status = 'winner' LIMIT 1`,
      args: [id],
    });
    console.log(`   FROZEN NOW (isSettled): ${isS}`);
    console.log(`     ├─ decided term (winner exists): ${hasWinner.rows.length > 0}`);
    console.log(`     └─ expired term (primary_date < ${floor}): ${pdate !== null && pdate < floor}`);

    const cands = await db.execute({
      sql: `SELECT name, party, incumbent, status, vote_pct, updated_at
              FROM primary_candidates WHERE primary_id = ?
             ORDER BY (vote_pct IS NULL), vote_pct DESC, name`,
      args: [id],
    });
    console.log(`   candidates: ${cands.rows.length}`);
    for (const c of cands.rows) {
      console.log(
        `     ${String(c.status).padEnd(8)} ${String(c.vote_pct ?? "—").toString().padStart(6)}%  ` +
          `${String(c.name)} (${c.party ?? "?"})${c.incumbent ? " [INC]" : ""}  upd=${c.updated_at ?? "NULL"}`,
      );
    }
    if (cands.rows.length === 0) console.log("     (empty roster)");

    const stamps = [...new Set(cands.rows.map((c) => String(c.updated_at ?? "NULL")))];
    console.log(`   distinct candidate updated_at: ${stamps.join(", ") || "(none)"}`);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
