// HO 353 — Reports weekly-content probe. READ-ONLY diagnostic.
// No writes, no schema change, no commit. Counts/aggregates over the corpus,
// well inside any timeout. Direct script path, so the 10s app abort wrapper
// doesn't apply. Two sources: A) floor votes (priority), B) stock trades.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function rows(sql: string, args: unknown[] = []) {
  const rs = await db.execute({ sql, args: args as never });
  return rs.rows as Record<string, unknown>[];
}
async function one(sql: string, args: unknown[] = []): Promise<number> {
  const r = await rows(sql, args);
  return Number(r[0]?.n ?? 0);
}

// Last 3 COMPLETED weeks (Mon..Sun). "today" = 2026-06-24 (Wed). The last
// completed week ended Sun 2026-06-22. We compute the 3 prior Mon-Sun spans.
function lastThreeCompletedWeeks(today: Date): { start: string; end: string }[] {
  // find most recent Sunday strictly before today's week — i.e. the Sunday
  // that ended the last completed week.
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  // days since the most recent Monday (start of CURRENT, incomplete week)
  const sinceMon = (dow + 6) % 7;
  const curMon = new Date(d);
  curMon.setUTCDate(d.getUTCDate() - sinceMon); // Monday of current week
  const weeks: { start: string; end: string }[] = [];
  for (let i = 1; i <= 3; i++) {
    const start = new Date(curMon);
    start.setUTCDate(curMon.getUTCDate() - 7 * i);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    weeks.push({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
  }
  return weeks.reverse(); // oldest first
}

async function main() {
  console.log("INSTANCE:", (process.env.TURSO_DATABASE_URL || "").replace(/\?.*/, ""));
  const weeks = lastThreeCompletedWeeks(new Date("2026-06-24T00:00:00Z"));
  console.log("LAST 3 COMPLETED WEEKS (Mon..Sun):", weeks.map((w) => `${w.start}..${w.end}`).join("  "));
  console.log();

  // confirm the relevant tables actually exist (grep the live schema)
  const tbls = await rows(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('votes','member_votes','stock_trades','members') ORDER BY name",
  );
  console.log("TABLES PRESENT:", tbls.map((t) => t.name).join(", "));
  console.log();

  // ============================================================
  console.log("################  A. FLOOR VOTES  ################\n");

  // A1 — shape: distinct chambers + congresses
  console.log("=== A1. SOURCE / SHAPE ===");
  const chCong = await rows(
    "SELECT chamber, congress, COUNT(*) AS n FROM votes GROUP BY chamber, congress ORDER BY congress DESC, chamber",
  );
  for (const r of chCong) console.log(`   chamber=${r.chamber} congress=${r.congress}  rows=${r.n}`);
  const total = await one("SELECT COUNT(*) AS n FROM votes");
  console.log(`   TOTAL votes rows: ${total}`);
  console.log();

  // A2 — date field range (vote_date) per chamber, 119th
  console.log("=== A2. DATE-RANGE QUERYABILITY (vote_date, 119th) ===");
  const range = await rows(
    "SELECT chamber, MIN(vote_date) AS mn, MAX(vote_date) AS mx, COUNT(*) AS n FROM votes WHERE congress=119 GROUP BY chamber",
  );
  for (const r of range) console.log(`   ${r.chamber}: ${r.mn}  ->  ${r.mx}   (n=${r.n})`);
  console.log();

  // A3 — coverage: roll-call count per week, per chamber (last 3 weeks)
  console.log("=== A3. COVERAGE — roll-calls per week per chamber (119th) ===");
  for (const w of weeks) {
    // vote_date is an ISO timestamp; compare on the date prefix inclusive of Sunday
    const perCh = await rows(
      `SELECT chamber, COUNT(*) AS n FROM votes
         WHERE congress=119 AND substr(vote_date,1,10) BETWEEN ? AND ?
         GROUP BY chamber ORDER BY chamber`,
      [w.start, w.end],
    );
    const h = perCh.find((r) => r.chamber === "house")?.n ?? 0;
    const s = perCh.find((r) => r.chamber === "senate")?.n ?? 0;
    console.log(`   ${w.start}..${w.end}   house=${h}   senate=${s}`);
  }
  console.log();

  // A4 — fields present per vote: sample one recent row per chamber + null-coverage
  console.log("=== A4. FIELDS PRESENT (sample recent row per chamber) ===");
  for (const ch of ["house", "senate"]) {
    const r = (await rows(
      "SELECT * FROM votes WHERE congress=119 AND chamber=? ORDER BY vote_date DESC LIMIT 1",
      [ch],
    ))[0];
    if (!r) {
      console.log(`   ${ch}: (no rows)`);
      continue;
    }
    console.log(`   --- ${ch} sample (${r.id}) ---`);
    for (const k of ["question", "description", "result", "vote_date", "yea_count", "nay_count", "present_count", "not_voting_count", "bill_id", "amendment_designation"]) {
      const v = r[k];
      console.log(`      ${k.padEnd(20)} = ${v === null || v === undefined ? "NULL" : JSON.stringify(v)}`);
    }
  }
  // null coverage on key fields across 119th
  console.log("   --- null coverage (119th, all rows) ---");
  for (const k of ["question", "description", "result"]) {
    const nn = await one(`SELECT COUNT(*) AS n FROM votes WHERE congress=119 AND ${k} IS NOT NULL`);
    const tot = await one("SELECT COUNT(*) AS n FROM votes WHERE congress=119");
    console.log(`      ${k.padEnd(14)} non-null ${nn}/${tot}`);
  }
  console.log();

  // A4b — party split availability: member_votes join. Can we compute yea/nay by party?
  console.log("=== A4b. PARTY-SPLIT FEASIBILITY (member_votes ⋈ members) ===");
  const mvTotal = await one("SELECT COUNT(*) AS n FROM member_votes");
  const mvRecent = (await rows(
    `SELECT v.id, COUNT(*) AS positions,
            SUM(CASE WHEN m.bioguide_id IS NOT NULL THEN 1 ELSE 0 END) AS matched
       FROM votes v JOIN member_votes mv ON mv.vote_id = v.id
       LEFT JOIN members m ON m.bioguide_id = mv.bioguide_id
       WHERE v.congress=119
       GROUP BY v.id ORDER BY v.vote_date DESC LIMIT 1`,
  ))[0];
  console.log(`   member_votes total rows: ${mvTotal}`);
  if (mvRecent)
    console.log(`   most-recent vote ${mvRecent.id}: ${mvRecent.positions} positions, ${mvRecent.matched} matched to members (party derivable)`);
  // sample a party split on that vote
  if (mvRecent) {
    const split = await rows(
      `SELECT m.party AS party, mv.position AS pos, COUNT(*) AS n
         FROM member_votes mv JOIN members m ON m.bioguide_id = mv.bioguide_id
        WHERE mv.vote_id = ? GROUP BY m.party, mv.position ORDER BY m.party, mv.position`,
      [mvRecent.id],
    );
    console.log(`   party×position on ${mvRecent.id}:`);
    for (const r of split) console.log(`      ${String(r.party).padEnd(4)} ${String(r.pos).padEnd(12)} ${r.n}`);
  }
  console.log();

  // A5 — bill linkage + non-bill typing
  console.log("=== A5. BILL LINKAGE / NON-BILL TYPING (119th) ===");
  const linked = await one("SELECT COUNT(*) AS n FROM votes WHERE congress=119 AND bill_id IS NOT NULL");
  const linkedJoinable = await one(
    "SELECT COUNT(*) AS n FROM votes v JOIN bills b ON b.id=v.bill_id WHERE v.congress=119",
  );
  const nonBill = await one("SELECT COUNT(*) AS n FROM votes WHERE congress=119 AND bill_id IS NULL");
  const nonBillWithDesig = await one(
    "SELECT COUNT(*) AS n FROM votes WHERE congress=119 AND bill_id IS NULL AND amendment_designation IS NOT NULL",
  );
  console.log(`   bill_id NOT NULL: ${linked}  (of which join to a synced bill: ${linkedJoinable})`);
  console.log(`   bill_id NULL (procedural/nom/amendment): ${nonBill}  (with amendment_designation set: ${nonBillWithDesig})`);
  // sample non-bill designations
  const desigSample = await rows(
    "SELECT amendment_designation AS d, COUNT(*) AS n FROM votes WHERE congress=119 AND bill_id IS NULL AND amendment_designation IS NOT NULL GROUP BY substr(amendment_designation,1,3) ORDER BY n DESC LIMIT 8",
  );
  console.log("   sample non-bill designation prefixes:");
  for (const r of desigSample) console.log(`      ${String(r.d).slice(0, 18).padEnd(18)} … n(prefix-grouped)=${r.n}`);
  console.log();

  // A6 — freshness
  console.log("=== A6. FRESHNESS ===");
  const fresh = await rows(
    "SELECT chamber, MAX(vote_date) AS mx, MAX(update_date) AS upd FROM votes WHERE congress=119 GROUP BY chamber",
  );
  for (const r of fresh) console.log(`   ${r.chamber}: latest vote_date=${r.mx}  latest update_date=${r.upd}`);
  console.log();

  // ============================================================
  console.log("################  B. STOCK TRADES  ################\n");

  console.log("=== B1. POPULATED / SHAPE ===");
  const tTotal = await one("SELECT COUNT(*) AS n FROM stock_trades");
  const byCh = await rows("SELECT chamber, COUNT(*) AS n FROM stock_trades GROUP BY chamber ORDER BY n DESC");
  console.log(`   TOTAL stock_trades rows: ${tTotal}`);
  for (const r of byCh) console.log(`   chamber=${r.chamber}  n=${r.n}`);
  console.log();

  console.log("=== B2/B6. DISCLOSURE-DATE RANGE + FRESHNESS ===");
  const dRange = (await rows(
    "SELECT MIN(disclosure_date) AS mn, MAX(disclosure_date) AS mx, MAX(ingested_at) AS ing FROM stock_trades",
  ))[0]!;
  console.log(`   disclosure_date: ${dRange.mn}  ->  ${dRange.mx}`);
  console.log(`   latest ingested_at: ${dRange.ing}`);
  console.log();

  console.log("=== B3. COVERAGE — disclosures per week (last 3 weeks, by disclosure_date) ===");
  for (const w of weeks) {
    const n = await one(
      "SELECT COUNT(*) AS n FROM stock_trades WHERE substr(disclosure_date,1,10) BETWEEN ? AND ?",
      [w.start, w.end],
    );
    console.log(`   ${w.start}..${w.end}   disclosures=${n}`);
  }
  // also: most recent 8 weeks coarse, to see if the feed is alive at all
  console.log("   --- recent disclosure_date distribution (top 10 dates) ---");
  const recentDates = await rows(
    "SELECT substr(disclosure_date,1,10) AS d, COUNT(*) AS n FROM stock_trades WHERE disclosure_date IS NOT NULL GROUP BY d ORDER BY d DESC LIMIT 10",
  );
  for (const r of recentDates) console.log(`      ${r.d}  n=${r.n}`);
  console.log();

  console.log("=== B4. FIELDS PRESENT (sample recent rows) ===");
  const tSample = await rows(
    "SELECT member_name_raw, chamber, ticker, transaction_type, transaction_date, disclosure_date, amount, owner, bioguide_id FROM stock_trades ORDER BY disclosure_date DESC LIMIT 3",
  );
  for (const r of tSample) console.log("   " + JSON.stringify(r));
  // null coverage
  console.log("   --- null coverage ---");
  for (const k of ["ticker", "transaction_type", "transaction_date", "disclosure_date", "amount", "bioguide_id"]) {
    const nn = await one(`SELECT COUNT(*) AS n FROM stock_trades WHERE ${k} IS NOT NULL`);
    console.log(`      ${k.padEnd(18)} non-null ${nn}/${tTotal}`);
  }
  console.log();

  console.log("=== B5. MEMBER LINKAGE (bioguide join to members) ===");
  const matched = await one("SELECT COUNT(*) AS n FROM stock_trades WHERE bioguide_id IS NOT NULL");
  const joinable = await one(
    "SELECT COUNT(*) AS n FROM stock_trades t JOIN members m ON m.bioguide_id=t.bioguide_id",
  );
  console.log(`   bioguide_id set: ${matched}/${tTotal}   (join to a members row: ${joinable})`);
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
