// HO 344 — Filler Watch Phase-1 diagnostic. READ-ONLY. No writes, no commit.
// Counts over ~16k bills rows; well inside any timeout. Direct script path,
// so the 10s app abort wrapper doesn't apply.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const FOUR = [
  "awareness-designation",
  "honoring-resolution",
  "facility-naming",
  "sense-of-congress",
];
const PLACE = FOUR.map(() => "?").join(",");

function normalizeParty(p: string | null): "R" | "D" | "I" | null {
  if (!p) return null;
  const u = p.trim().toUpperCase();
  if (u === "R") return "R";
  if (u === "D") return "D";
  return "I";
}

async function one(sql: string, args: unknown[] = []): Promise<number> {
  const rs = await db.execute({ sql, args: args as never });
  return Number(rs.rows[0]?.n ?? 0);
}

async function main() {
  console.log("INSTANCE:", (process.env.TURSO_DATABASE_URL || "").replace(/\?.*/, ""));
  console.log();

  // confirm the live distinct stage values
  const stagesRs = await db.execute(
    "SELECT stage, COUNT(*) AS n FROM bills GROUP BY stage ORDER BY n DESC",
  );
  console.log("DISTINCT bills.stage (whole corpus):");
  for (const r of stagesRs.rows) console.log(`   ${r.stage ?? "NULL"} = ${r.n}`);
  console.log();

  // ---- 1. Union total + per-pattern ----
  console.log("=== 1. UNION TOTAL + PER-PATTERN ===");
  const perPattern: Record<string, number> = {};
  for (const id of FOUR) {
    perPattern[id] = await one(
      "SELECT COUNT(*) AS n FROM bills WHERE cluster_id = ?",
      [id],
    );
  }
  const union = await one(
    `SELECT COUNT(DISTINCT id) AS n FROM bills WHERE cluster_id IN (${PLACE})`,
    FOUR,
  );
  const expected: Record<string, number> = {
    "facility-naming": 624,
    "honoring-resolution": 349,
    "awareness-designation": 128,
    "sense-of-congress": 124,
  };
  for (const id of FOUR) {
    const exp = expected[id] ?? 0;
    const got = perPattern[id] ?? 0;
    const drift = got - exp;
    console.log(
      `   ${id.padEnd(22)} ${String(got).padStart(5)}  (expected ${exp}, drift ${drift >= 0 ? "+" : ""}${drift})`,
    );
  }
  console.log(`   UNION (distinct bills)  ${String(union).padStart(5)}  (expected 1,225, drift ${union - 1225 >= 0 ? "+" : ""}${union - 1225})`);
  console.log();

  // ---- 2. Past-committee rate (aggregate) + full stage distribution across the four ----
  console.log("=== 2. PAST-COMMITTEE RATE + STAGE DIST (across the four) ===");
  const stageDistRs = await db.execute({
    sql: `SELECT stage, COUNT(DISTINCT id) AS n FROM bills WHERE cluster_id IN (${PLACE}) GROUP BY stage ORDER BY n DESC`,
    args: FOUR as never,
  });
  let pastCommittee = 0;
  let otherCount = 0;
  for (const r of stageDistRs.rows) {
    const stage = (r.stage as string) ?? "NULL";
    const n = Number(r.n);
    console.log(`   ${stage.padEnd(16)} ${String(n).padStart(5)}`);
    if (stage === "other") otherCount = n;
    // past committee = NOT introduced/committee, AND treat 'other' as NOT past-committee, NULL as not
    if (
      stage !== "introduced" &&
      stage !== "committee" &&
      stage !== "other" &&
      r.stage != null
    ) {
      pastCommittee += n;
    }
  }
  const rate = union ? (pastCommittee / union) * 100 : 0;
  console.log(
    `   --> past committee (excl 'other'/NULL): ${pastCommittee} / ${union} = ${rate.toFixed(1)}%`,
  );
  console.log(`   --> 'other' catchall (reported separately): ${otherCount}`);
  console.log();

  // ---- 3. Enacted count ----
  console.log("=== 3. ENACTED ===");
  const unionEnacted = await one(
    `SELECT COUNT(DISTINCT id) AS n FROM bills WHERE cluster_id IN (${PLACE}) AND stage = 'enacted'`,
    FOUR,
  );
  console.log(`   union enacted: ${unionEnacted}`);
  for (const id of FOUR) {
    const n = await one(
      "SELECT COUNT(*) AS n FROM bills WHERE cluster_id = ? AND stage = 'enacted'",
      [id],
    );
    const flag = id !== "facility-naming" && n > 0 ? "  <-- FLAG (should be 0)" : "";
    console.log(`     ${id.padEnd(22)} enacted = ${n}${flag}`);
  }
  console.log();

  // ---- 4. Sponsor party split (across the four) ----
  console.log("=== 4. SPONSOR PARTY SPLIT (across the four) ===");
  const partyRs = await db.execute({
    sql: `SELECT sponsor_party AS p, COUNT(DISTINCT id) AS n FROM bills WHERE cluster_id IN (${PLACE}) GROUP BY sponsor_party`,
    args: FOUR as never,
  });
  let d = 0,
    r = 0,
    i = 0,
    nullp = 0;
  for (const row of partyRs.rows) {
    const k = normalizeParty(row.p as string | null);
    const n = Number(row.n);
    if (row.p == null) nullp += n;
    else if (k === "D") d += n;
    else if (k === "R") r += n;
    else i += n;
  }
  const partisan = d + r;
  console.log(`   D = ${d}, R = ${r}, I/other = ${i}, NULL = ${nullp}`);
  console.log(
    `   among partisan (${partisan}): ${((d / partisan) * 100).toFixed(0)}% D / ${((r / partisan) * 100).toFixed(0)}% R`,
  );
  console.log();

  // ---- 5. Weekly (reuse the week-strip's own window) ----
  console.log("=== 5. WEEKLY (strip window: introduced_date > date('now','-7 days')) ===");
  // (a) this week's NEW BILLS = the strip count: non-ceremonial introduced in last 7d
  const newBills = await one(
    `SELECT COUNT(*) AS n FROM bills
       WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
         AND introduced_date IS NOT NULL
         AND introduced_date > date('now', '-7 days')`,
  );
  // (b) of those, filler under BROAD def: is_ceremonial=1 OR cluster_id IN (the four), deduped.
  // NOTE: the strip's NEW BILLS excludes ceremonial, so the broad-filler subset
  // within that SAME population is cluster-only (ceremonial already excluded).
  // Report both the broad-over-strip and broad-over-all-introductions reads.
  const fillerInStrip = await one(
    `SELECT COUNT(DISTINCT id) AS n FROM bills
       WHERE introduced_date IS NOT NULL
         AND introduced_date > date('now', '-7 days')
         AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
         AND cluster_id IN (${PLACE})`,
    FOUR,
  );
  // all introductions this week (ceremonial included) + broad filler over that
  const allIntro = await one(
    `SELECT COUNT(*) AS n FROM bills
       WHERE introduced_date IS NOT NULL
         AND introduced_date > date('now', '-7 days')`,
  );
  const broadFillerAll = await one(
    `SELECT COUNT(DISTINCT id) AS n FROM bills
       WHERE introduced_date IS NOT NULL
         AND introduced_date > date('now', '-7 days')
         AND (is_ceremonial = 1 OR cluster_id IN (${PLACE}))`,
    FOUR,
  );
  console.log(`   (a) NEW BILLS (strip count, non-ceremonial): ${newBills}`);
  console.log(`   (b) filler within that strip population (cluster-only, ceremonial already excl): ${fillerInStrip}`);
  console.log(`   --- broader read over ALL introductions this week ---`);
  console.log(`   all introductions this week (ceremonial incl): ${allIntro}`);
  console.log(`   broad filler (is_ceremonial=1 OR cluster IN four, deduped): ${broadFillerAll}`);
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
