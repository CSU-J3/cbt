// HO 595 — falsification for the materialized participation path. READ-MOSTLY.
//
// Three sides, plus the one the handoff added:
//   --control  value fingerprints against HO 594's, from the materialized table
//   --failure  FIRE the refresh's non-destructive branches against the REAL table
//              and confirm it keeps its previous values and does not re-stamp
//   --stamp    print the current freshness stamp (the instrument for a stale table)
//
// Why --failure exists: the non-destructive guards ARE the safety argument of
// lib/participation-refresh.ts, and an untriggered guard is UNPROVEN rather than
// protection. HO 552 is the precedent — a transient failure became permanent data
// loss in a branch nobody had fired. So each branch is driven for real here.
//
//   npx tsx scripts/diagnostic/participation-falsify-595.ts --control
//   npx tsx scripts/diagnostic/participation-falsify-595.ts --failure
import "dotenv/config";
import { createClient } from "@libsql/client";
import { refreshMemberParticipation } from "../../lib/participation-refresh";

const FLOOR = 50;

function raw() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    fetch: (i: RequestInfo | URL, init?: RequestInit) =>
      fetch(i, { ...init, signal: AbortSignal.timeout(120_000) }),
  });
}
const db = raw();

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
};
const fp = (rows: Array<Record<string, unknown>>, keys: string[]) =>
  hash(rows.map((r) => keys.map((k) => `${r[k]}`).join("|")).sort().join("\n"));

// The shipped fingerprints from HO 594, computed against member_votes directly.
const WANT = { strip: "1eedaa8d", cte: "21611d72", ctx: "349972d" } as const;

async function tableState() {
  const r = await db.execute(
    "SELECT COUNT(*) AS n, MAX(refreshed_at) AS stamp FROM member_participation",
  );
  const row = r.rows[0] as Record<string, unknown>;
  return { rows: Number(row.n ?? 0), stamp: (row.stamp as string | null) ?? null };
}

async function control() {
  console.log("=== CONTROL — materialized values vs HO 594 fingerprints ===");
  const strip = await db.execute(`SELECT p.bioguide_id AS bioguideId,
      CASE WHEN m.chamber='house' AND m.state IN ('DC','AS','GU','MP','PR','VI') THEN 1 ELSE 0 END AS isDelegate,
      p.total AS total, p.not_voting AS nv
    FROM member_participation p JOIN members m ON m.bioguide_id = p.bioguide_id
    WHERE m.is_current = 1 AND p.total >= ${FLOOR}`);
  const cte = await db.execute(`SELECT bioguide_id AS bid, CAST(not_voting AS REAL)/total AS missed_pct
    FROM member_participation WHERE total >= ${FLOOR}`);
  const ctx = await db.execute(`SELECT m.chamber AS chamber, p.total AS total, p.not_voting AS nv
    FROM member_participation p JOIN members m ON m.bioguide_id = p.bioguide_id
    WHERE m.is_current = 1 AND p.total >= ${FLOOR}`);

  const got = {
    strip: fp(strip.rows as never, ["bioguideId", "total", "nv", "isDelegate"]),
    cte: fp(cte.rows as never, ["bid", "missed_pct"]),
    ctx: fp(ctx.rows as never, ["chamber", "total", "nv"]),
  };
  let ok = true;
  for (const k of ["strip", "cte", "ctx"] as const) {
    const match = got[k] === WANT[k];
    if (!match) ok = false;
    const n = k === "strip" ? strip.rows.length : k === "cte" ? cte.rows.length : ctx.rows.length;
    console.log(`  ${k.padEnd(6)} ${String(n).padStart(4)} rows  ${got[k]}  want ${WANT[k]}  ${match ? "MATCH" : "*** DIFFERS ***"}`);
  }
  const st = await tableState();
  console.log(`  table: ${st.rows} rows, refreshed_at=${st.stamp}`);
  console.log(`  => ${ok ? "values identical to the member_votes-derived originals" : "REGRESSION"}`);
}

async function failure() {
  console.log("=== FAILURE PATHS — fired for real against the live table ===");
  const before = await tableState();
  console.log(`  baseline: ${before.rows} rows, stamp=${before.stamp}\n`);
  if (before.rows === 0) {
    console.log("  REFUSING to run: the table is empty, so 'kept previous values' would prove nothing.");
    return;
  }

  const cases: Array<{ sim: "empty" | "shrink" | "throw"; expect: string }> = [
    { sim: "empty", expect: "skipped (0 rows)" },
    { sim: "shrink", expect: "skipped (< 0.5x held)" },
    { sim: "throw", expect: "error before any write" },
  ];

  let allHeld = true;
  for (const c of cases) {
    const res = await refreshMemberParticipation({ simulate: c.sim });
    const after = await tableState();
    const held = after.rows === before.rows && after.stamp === before.stamp;
    if (!held) allHeld = false;
    console.log(`  simulate=${c.sim.padEnd(7)} ok=${String(res.ok).padEnd(5)} ${res.skipped ?? res.error ?? ""}`);
    console.log(`      table after: ${after.rows} rows, stamp=${after.stamp}`);
    console.log(`      ${held ? "HELD — previous values kept, stamp did NOT advance" : "*** DATA MOVED — NON-DESTRUCTIVE GUARANTEE BROKEN ***"}  (expected: ${c.expect})`);
  }

  console.log(`\n  now a REAL refresh, to prove the path still works after the failures:`);
  const real = await refreshMemberParticipation();
  const after = await tableState();
  console.log(`      ok=${real.ok} rows=${real.rows} ms=${real.ms}`);
  console.log(`      table after: ${after.rows} rows, stamp=${after.stamp}`);
  const advanced = after.stamp !== before.stamp && after.rows === before.rows;
  console.log(`      ${advanced ? "STAMP ADVANCED and row count is stable" : "*** unexpected ***"}`);
  console.log(`\n  => ${allHeld && advanced ? "non-destructive path PROVEN (all three branches fired)" : "NOT PROVEN"}`);
}

async function main() {
  if (process.argv.includes("--failure")) return failure();
  if (process.argv.includes("--stamp")) {
    const st = await tableState();
    console.log(JSON.stringify(st));
    return;
  }
  return control();
}

main().catch((e) => { console.error(e); process.exit(1); });
