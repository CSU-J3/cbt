// HO 594 phase 2 — falsification instrument for the covering-index fix. READ-MOSTLY.
//
// Modes (all take --repeats N, default 5):
//   --time        time the three shipped aggregates through the PRODUCTION client
//                 (lib/db.ts, 10s abort + retry-once) — RED is a TimeoutError here
//   --raw         same three, through an unbounded client, for the true worst case
//   --plan        EXPLAIN QUERY PLAN, unhinted vs hinted (does the statless planner
//                 take the new index without an INDEXED BY?)
//   --write-cost  time the votes sync's ATOMIC WRITE UNIT, idempotently
//   --control     dump the three call sites' values for a before/after diff
//
// WHY --write-cost REPLICATES THE UNIT INSTEAD OF RUNNING `npm run sync:votes`:
// runVotesSync skips vote ids it already has, so a second run writes NOTHING and
// a before/after wall-clock of it compares two no-ops. Its atomic unit of work is
// per-vote `DELETE FROM member_votes WHERE vote_id = ?` + N re-INSERTs in one
// batch (lib/votes-sync.ts:333) — member_votes is DELETE-AND-REBUILD, not
// append-only (HO 566/567), which is exactly why an extra index has to be priced.
// So this reads a real vote's rows and writes back BYTE-IDENTICAL rows through the
// same batch shape. Net data change: zero, verified by a row-count assert.
//
//   npx tsx scripts/diagnostic/participation-index-falsify-594.ts --time
import "dotenv/config";
import { createClient } from "@libsql/client";
import { getDb } from "../../lib/db";

const PROD_BOUND_MS = 10_000;
const PARTICIPATION_FLOOR = 50;
const INDEX_NAME = "idx_member_votes_participation";

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const REPEATS = Number(arg("--repeats") ?? 5);

function rawClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    fetch: (i: RequestInfo | URL, init?: RequestInit) =>
      fetch(i, { ...init, signal: AbortSignal.timeout(120_000) }),
  });
}

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

// The three shipped aggregates, verbatim. `HINT` is spliced in for --plan.
const Q = {
  strip: (hint = "") => `SELECT mv.bioguide_id AS bioguideId, m.name AS name, m.party AS party,
                   m.chamber AS chamber,
                   CASE WHEN m.chamber = 'house'
                         AND m.state IN ('DC','AS','GU','MP','PR','VI')
                        THEN 1 ELSE 0 END AS isDelegate,
                   COUNT(*) AS total,
                   SUM(CASE WHEN mv.position = 'not_voting' THEN 1 ELSE 0 END) AS nv
              FROM member_votes mv ${hint}
              JOIN members m ON m.bioguide_id = mv.bioguide_id
             WHERE m.is_current = 1
             GROUP BY mv.bioguide_id
            HAVING total >= ${PARTICIPATION_FLOOR}`,
  context: (hint = "") => `SELECT m.chamber AS chamber, COUNT(*) AS total,
                   SUM(CASE WHEN mv.position = 'not_voting' THEN 1 ELSE 0 END) AS nv
              FROM member_votes mv ${hint}
              JOIN members m ON m.bioguide_id = mv.bioguide_id
             WHERE m.is_current = 1
             GROUP BY mv.bioguide_id
            HAVING total >= ${PARTICIPATION_FLOOR}`,
  cte: (hint = "") => `SELECT mv.bioguide_id AS bid,
                   CAST(SUM(CASE WHEN mv.position = 'not_voting' THEN 1 ELSE 0 END) AS REAL)
                     / COUNT(*) AS missed_pct
              FROM member_votes mv ${hint}
             GROUP BY mv.bioguide_id
            HAVING COUNT(*) >= ${PARTICIPATION_FLOOR}`,
};

async function timeAll(useProdClient: boolean) {
  const db = useProdClient ? getDb() : rawClient();
  console.log(
    `=== timing the three shipped aggregates (${useProdClient ? "PRODUCTION client: 10s abort + retry-once" : "unbounded client"}, ${REPEATS} runs) ===`,
  );
  for (const [name, sql] of Object.entries(Q)) {
    const times: number[] = [];
    let rows = 0, fails = 0, lastErr = "";
    for (let i = 0; i < REPEATS; i++) {
      const t0 = performance.now();
      try {
        const r = await db.execute(sql());
        times.push(performance.now() - t0);
        rows = r.rows.length;
      } catch (e) {
        fails++;
        lastErr = e instanceof Error ? e.name : String(e);
        times.push(performance.now() - t0);
      }
    }
    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const worst = sorted[sorted.length - 1] ?? 0;
    const margin = PROD_BOUND_MS - worst;
    console.log(
      `  ${name.padEnd(9)} median=${ms(median).padStart(8)} worst=${ms(worst).padStart(8)} rows=${String(rows).padStart(4)} fails=${fails}/${REPEATS}${lastErr ? " (" + lastErr + ")" : ""}`,
    );
    console.log(
      `            worst-case margin under the ${ms(PROD_BOUND_MS)} bound: ${margin >= 0 ? "+" : ""}${ms(margin)}  ${margin <= 0 ? "*** OVER BOUND ***" : margin < 5000 ? "(under 5s margin)" : "OK"}`,
    );
  }
}

async function plan() {
  const db = rawClient();
  console.log(`=== EXPLAIN QUERY PLAN — does the statless planner take ${INDEX_NAME} UNHINTED? ===`);
  console.log(`  (HO 277 precedent, migrate.ts: the unhinted plan kept the bad index even once the`);
  console.log(`   covering one existed, so both queries there carry a mandatory INDEXED BY.)\n`);
  for (const [name, sql] of Object.entries(Q)) {
    for (const [label, hint] of [["unhinted", ""], ["hinted", `INDEXED BY ${INDEX_NAME}`]] as const) {
      try {
        const r = await db.execute(`EXPLAIN QUERY PLAN ${sql(hint)}`);
        const detail = r.rows.map((x) => String(x.detail ?? "")).join(" | ");
        const takes = detail.includes(INDEX_NAME);
        console.log(`  ${name.padEnd(9)} ${label.padEnd(9)} ${takes ? "USES NEW INDEX" : "does NOT use it"}`);
        console.log(`            ${detail}`);
      } catch (e) {
        console.log(`  ${name.padEnd(9)} ${label.padEnd(9)} ERROR ${String(e).slice(0, 90)}`);
      }
    }
  }
}

// Time the sync's atomic write unit without changing any data.
async function writeCost() {
  const db = rawClient();
  const n = Number(arg("--votes") ?? 3);
  console.log(`=== write cost — the votes-sync atomic unit (DELETE + re-INSERT), ${n} real votes ===`);
  const before = await db.execute("SELECT COUNT(*) AS n FROM member_votes");
  const beforeN = Number((before.rows[0] as Record<string, unknown>).n ?? 0);
  console.log(`  member_votes rows before: ${beforeN.toLocaleString()}`);

  const picked = await db.execute({
    sql: `SELECT vote_id, COUNT(*) AS c FROM member_votes GROUP BY vote_id ORDER BY vote_id DESC LIMIT ?`,
    args: [n],
  });

  const times: number[] = [];
  for (const row of picked.rows) {
    const voteId = String(row.vote_id);
    const rows = await db.execute({
      sql: "SELECT vote_id, bioguide_id, position FROM member_votes WHERE vote_id = ?",
      args: [voteId],
    });
    // Byte-identical write-back through the sync's own batch shape.
    const stmts: Array<{ sql: string; args: (string | number)[] }> = [
      { sql: "DELETE FROM member_votes WHERE vote_id = ?", args: [voteId] },
    ];
    for (const r of rows.rows) {
      stmts.push({
        sql: "INSERT INTO member_votes (vote_id, bioguide_id, position) VALUES (?, ?, ?)",
        args: [String(r.vote_id), String(r.bioguide_id), String(r.position)],
      });
    }
    const t0 = performance.now();
    await db.batch(stmts, "write");
    const dt = performance.now() - t0;
    times.push(dt);
    console.log(`  ${voteId.padEnd(28)} ${String(rows.rows.length).padStart(4)} rows  ${ms(dt).padStart(8)}`);
  }

  const after = await db.execute("SELECT COUNT(*) AS n FROM member_votes");
  const afterN = Number((after.rows[0] as Record<string, unknown>).n ?? 0);
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`  member_votes rows after : ${afterN.toLocaleString()}  ${afterN === beforeN ? "UNCHANGED (net-zero write, as intended)" : "*** ROW COUNT CHANGED — INVESTIGATE ***"}`);
  console.log(`  per-vote write unit: median ${ms(sorted[Math.floor(sorted.length / 2)] ?? 0)}  worst ${ms(sorted[sorted.length - 1] ?? 0)}`);
}

// CONTROL — the values the three call sites depend on. Diff before vs after.
async function control() {
  const db = rawClient();
  console.log(`=== CONTROL — values behind the three call sites (diff this before vs after) ===`);
  const strip = await db.execute(Q.strip());
  const cte = await db.execute(Q.cte());
  const ctx = await db.execute(Q.context());

  const fp = (rows: Array<Record<string, unknown>>, keys: string[]) =>
    rows
      .map((r) => keys.map((k) => `${r[k]}`).join("|"))
      .sort()
      .join("\n");

  const stripFp = fp(strip.rows as never, ["bioguideId", "total", "nv", "isDelegate"]);
  const cteFp = fp(cte.rows as never, ["bid", "missed_pct"]);
  const ctxFp = fp(ctx.rows as never, ["chamber", "total", "nv"]);
  const hash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  };
  console.log(`  getParticipationStrip : ${strip.rows.length} rows  fingerprint=${hash(stripFp)}`);
  console.log(`  participationAggCte   : ${cte.rows.length} rows  fingerprint=${hash(cteFp)}`);
  console.log(`  chamberContext        : ${ctx.rows.length} rows  fingerprint=${hash(ctxFp)}`);
  console.log(`  (fingerprints are order-independent over the value columns — a query made fast by`);
  console.log(`   changing WHAT it counts moves these.)`);
}

// RED/GREEN at the ROUTE level, DETERMINISTIC — not 593's stochastic 2/20.
//
// The lever: getMembersRanked / getCommitteeRoster are unstable_cache'd on their
// ARGUMENTS, so every distinct filter combination is its own cache key. An unused
// combination is therefore a GUARANTEED cold miss that must run participationAggCte
// synchronously — no waiting for a 3600s TTL and no hammering. `votes` is not in
// the /api/revalidate allowlist, so this forces the miss without touching a prod
// route or its auth.
//
// Pass DISJOINT state sets for RED and GREEN: RED warms the keys it uses, so
// re-using them for GREEN would measure the cache, not the fix.
async function routes() {
  const base = process.env.BASE_URL ?? "https://congressional-terminal-chi-silk.vercel.app";
  const states = (arg("--states") ?? "AK,AZ,CO,CT,DE,HI,IA,ID,KS,ME").split(",");
  const targets = [
    ...states.map((s) => `/members?state=${s}`),
    ...states.slice(0, 3).map((s) => `/members?state=${s}&sort=missed`),
  ];
  console.log(`=== forced-cold-key route probe (${targets.length} distinct unused cache keys) ===`);
  const codes: number[] = [];
  for (const t of targets) {
    const t0 = performance.now();
    let status = 0;
    try {
      const r = await fetch(base + t, { headers: { cookie: "ct_seen=1" }, redirect: "follow" });
      status = r.status;
    } catch { status = 0; }
    const dt = performance.now() - t0;
    codes.push(status);
    console.log(`  ${t.padEnd(38)} ${status}  ${ms(dt)}`);
  }
  const bad = codes.filter((c) => c !== 200).length;
  console.log(`\n  non-200: ${bad}/${codes.length}  (${((bad / codes.length) * 100).toFixed(0)}%)`);
}

async function main() {
  if (process.argv.includes("--routes")) return routes();
  if (process.argv.includes("--plan")) return plan();
  if (process.argv.includes("--write-cost")) return writeCost();
  if (process.argv.includes("--control")) return control();
  if (process.argv.includes("--raw")) return timeAll(false);
  return timeAll(true);
}

main().catch((e) => { console.error(e); process.exit(1); });
