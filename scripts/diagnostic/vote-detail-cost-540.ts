// HO 540 STEP 0 — /vote/[id] roll-call detail cost + correctness (read-only).
// The seek is bounded by construction (member_votes PK = (vote_id, bioguide_id), so
// WHERE vote_id = ? is a leading-column seek + a chamber caps the row count — the
// HO 448/450 no-probe shape). Three things still want numbers before the build:
//   1. worst-case position list cold (largest House + largest Senate vote) + EXPLAIN
//   2. the member_votes lag population (tally present, zero positions — the empty state)
//   3. bill_id presence across votes (how often the page renders with no bill link)
//
// Raw client, NO boundedFetch — the 10s bound would abort a cold query and hide its
// true cost, which is what this measures. Each query timed.
//
//   npx tsx scripts/diagnostic/vote-detail-cost-540.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  console.log(`   ⏱  ${label}: ${Date.now() - t0}ms`);
  return r;
}

// The getVoteMemberPositions shape (Commit 1): member_votes seek + members join.
const POSITIONS_SQL = `
  SELECT mv.bioguide_id, mv.position, m.name, m.party, m.state
    FROM member_votes mv
    LEFT JOIN members m ON m.bioguide_id = mv.bioguide_id
   WHERE mv.vote_id = ?`;

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.log("TURSO_DATABASE_URL not set — run with the CBT .env (local working tree).");
    return 1;
  }
  const db: Client = createClient({ url, authToken });
  console.log("=== HO 540 STEP 0 — /vote/[id] cost + correctness ===\n");

  // ── 1. WORST-CASE POSITION LIST, cold ────────────────────────────────────
  console.log("── 1. Worst-case position list (largest House + largest Senate vote) ──");
  const sizes = await db.execute(`
    SELECT mv.vote_id, v.chamber, COUNT(*) AS c
      FROM member_votes mv JOIN votes v ON v.id = mv.vote_id
     GROUP BY mv.vote_id, v.chamber
     ORDER BY c DESC`);
  const largestHouse = sizes.rows.find((r) => String(r.chamber) === "house");
  const largestSenate = sizes.rows.find((r) => String(r.chamber) === "senate");
  console.log(`   largest House vote: ${largestHouse?.vote_id} (${largestHouse?.c} positions)`);
  console.log(`   largest Senate vote: ${largestSenate?.vote_id} (${largestSenate?.c} positions)`);

  for (const [label, row] of [["House", largestHouse], ["Senate", largestSenate]] as const) {
    if (!row) continue;
    const id = String(row.vote_id);
    // cold-ish timing (first hit in this process)
    const rs = await timed(`   ${label} positions cold`, () => db.execute({ sql: POSITIONS_SQL, args: [id] }));
    console.log(`      returned ${rs.rows.length} rows`);
    const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${POSITIONS_SQL}`, args: [id] });
    for (const p of plan.rows) console.log(`      ${(p as Row).detail}`);
  }
  console.log("");

  // ── 2. member_votes LAG POPULATION (the empty state) ─────────────────────
  console.log("── 2. member_votes lag (tally present, zero positions) ──");
  // A vote "carries a tally" = it has a votes row with counts (yea/nay NOT NULL by
  // schema). Lag = that row has NO member_votes at all.
  const lag = await db.execute(`
    SELECT v.id, v.chamber, v.vote_date, v.yea_count, v.nay_count,
           v.present_count, v.not_voting_count
      FROM votes v
     WHERE NOT EXISTS (SELECT 1 FROM member_votes mv WHERE mv.vote_id = v.id)
       AND (v.yea_count + v.nay_count + COALESCE(v.present_count,0) + COALESCE(v.not_voting_count,0)) > 0
     ORDER BY v.vote_date DESC`);
  console.log(`   votes with a non-zero tally but ZERO member_votes: ${lag.rows.length}`);
  if (lag.rows.length > 0) {
    const newest = lag.rows[0]!;
    console.log(`   newest such vote: ${newest.id} (${newest.chamber}) date=${newest.vote_date} tally=${newest.yea_count}-${newest.nay_count}`);
    console.log(`   → the empty state (positions-pending) IS exercised on live data.`);
  } else {
    console.log(`   → ZERO today: the lag/empty state is UNEXERCISED — the positions-pending copy ships unverified.`);
    console.log(`     This is a WATCH item (verify the state the next time member detail lags a sync), NOT a blocker.`);
  }
  // Also: votes with NO member_votes AND a zero tally (a genuinely empty/procedural row) — distinct from lag.
  const zeroTallyNoPos = await db.execute(`
    SELECT COUNT(*) AS n FROM votes v
     WHERE NOT EXISTS (SELECT 1 FROM member_votes mv WHERE mv.vote_id = v.id)
       AND (v.yea_count + v.nay_count + COALESCE(v.present_count,0) + COALESCE(v.not_voting_count,0)) = 0`);
  console.log(`   (for reference — votes with zero tally AND zero positions: ${Number(zeroTallyNoPos.rows[0]!.n)})\n`);

  // ── 3. bill_id PRESENCE across votes ─────────────────────────────────────
  console.log("── 3. bill_id presence (how often the page has no direct bill link) ──");
  const billPresence = await db.execute(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN bill_id IS NULL THEN 1 ELSE 0 END) AS no_bill,
           SUM(CASE WHEN bill_id IS NOT NULL THEN 1 ELSE 0 END) AS with_bill
      FROM votes`);
  const bp = billPresence.rows[0]!;
  const total = Number(bp.total);
  const noBill = Number(bp.no_bill);
  console.log(`   votes total: ${total}`);
  console.log(`   with bill_id: ${Number(bp.with_bill)} (${((100 * Number(bp.with_bill)) / total).toFixed(1)}%)`);
  console.log(`   no bill_id:   ${noBill} (${((100 * noBill) / total).toFixed(1)}%)`);
  // Of the no-bill votes, how many resolve to a bill via the amendment_votes link
  // table (an amendment vote → amendments.amended_bill_id) — the page's fallback link.
  const noBillButAmd = await db.execute(`
    SELECT COUNT(DISTINCT v.id) AS n
      FROM votes v
      JOIN amendment_votes av ON av.vote_id = v.id
      JOIN amendments a ON a.id = av.amendment_id
     WHERE v.bill_id IS NULL AND a.amended_bill_id IS NOT NULL`);
  console.log(`   of the no-bill votes, resolve to a bill via amendment_votes: ${Number(noBillButAmd.rows[0]!.n)}`);
  console.log(`   → the rest render with no bill link at all (nominations / procedural / treaty).\n`);

  console.log("=== summary ===");
  console.log(`largest House ${largestHouse?.c} pos / Senate ${largestSenate?.c} pos`);
  console.log(`lag population (empty-state driver): ${lag.rows.length}`);
  console.log(`bill_id: ${noBill}/${total} no-bill (${((100 * noBill) / total).toFixed(1)}%), ${Number(noBillButAmd.rows[0]!.n)} of those amendment-linked`);

  db.close();
  return 0;
}

main()
  .then((c) => {
    process.exitCode = c;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
