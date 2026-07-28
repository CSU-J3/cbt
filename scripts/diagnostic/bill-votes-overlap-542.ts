// HO 542 STEP 0 — bill-hub VOTES tab: overlap + own-vote population (read-only).
// getVotesByBill(billId) returns EVERY vote carrying this bill's bill_id. Some of
// those are amendment votes already shown in the Amendments tab (HO 532: House
// amendment votes carry bill_id; Senate ones are question-matched and mostly don't).
// The VOTES tab must show the bill's OWN votes (passage / motion / cloture /
// procedural on the bill itself) — i.e. getVotesByBill MINUS the amendment-vote set.
//
// This measures whether an own-vote population actually exists once amendment votes
// are excluded — the GO/NO-GO for the tab. Exclusion set (the union, belt-and-braces):
//   (a) House-linked: vote.id EXISTS in amendment_votes (the HO 532 walk table)
//   (b) Senate-pattern: vote.question LIKE the shared SENATE_AMDT_QUESTION_LIKE
//       (imported from the leaf lib/amendment-vote-key.ts — anti-drift with the
//        request-time getBillAmendmentVotes matcher, never a re-typed literal).
//
// Raw client, NO boundedFetch (same as vote-detail-cost-540.ts — the 10s bound would
// abort a cold aggregate and hide its cost). Read-only: SELECT only, no writes.
//
//   npx tsx scripts/diagnostic/bill-votes-overlap-542.ts
import "dotenv/config";
import { createClient, type Client } from "@libsql/client";
import { SENATE_AMDT_QUESTION_LIKE } from "../../lib/amendment-vote-key";

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

// p-quantile of a sorted ascending numeric array (nearest-rank).
function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1));
  return sortedAsc[idx]!;
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.log("TURSO_DATABASE_URL not set — run with the CBT .env (local working tree).");
    return 1;
  }
  const db: Client = createClient({ url, authToken });
  console.log("=== HO 542 STEP 0 — bill-hub VOTES tab: overlap + own-vote population ===");
  console.log(`   Senate exclusion LIKE (from lib/amendment-vote-key.ts): '${SENATE_AMDT_QUESTION_LIKE}'\n`);

  // ── the exclusion flag, expressed once and reused ─────────────────────────
  // A vote V in getVotesByBill is an AMENDMENT vote (belongs to the Amendments
  // tab, not VOTES) if it is House-linked OR matches the Senate pattern.
  const EXCLUDED_EXPR = `(
    EXISTS (SELECT 1 FROM amendment_votes av WHERE av.vote_id = v.id)
    OR v.question LIKE ?
  )`;

  // ── 1 + 2. PER-BILL breakdown across the bill_id-carrying votes ───────────
  // (getVotesByBill = WHERE v.bill_id = ? — so grouping by bill_id reproduces
  //  every bill's returned set at once. total = getVotesByBill count.)
  console.log("── corpus: per-bill totals over bill_id-carrying votes ──");
  const perBill = await db.execute({
    sql: `
      SELECT v.bill_id AS bill_id,
             COUNT(*) AS total,
             SUM(CASE WHEN EXISTS (SELECT 1 FROM amendment_votes av WHERE av.vote_id = v.id)
                      THEN 1 ELSE 0 END) AS excl_house,
             SUM(CASE WHEN v.question LIKE ? THEN 1 ELSE 0 END) AS excl_senate,
             SUM(CASE WHEN ${EXCLUDED_EXPR} THEN 1 ELSE 0 END) AS excluded
        FROM votes v
       WHERE v.bill_id IS NOT NULL
       GROUP BY v.bill_id`,
    args: [SENATE_AMDT_QUESTION_LIKE, SENATE_AMDT_QUESTION_LIKE],
  });

  type BillRow = { billId: string; total: number; exclHouse: number; exclSenate: number; excluded: number; own: number };
  const rows: BillRow[] = perBill.rows.map((r) => {
    const total = Number(r.total);
    const excluded = Number(r.excluded);
    return {
      billId: String(r.bill_id),
      total,
      exclHouse: Number(r.excl_house),
      exclSenate: Number(r.excl_senate),
      excluded,
      own: total - excluded,
    };
  });

  const billIdCarryingVotes = rows.reduce((a, b) => a + b.total, 0);
  const totalExcluded = rows.reduce((a, b) => a + b.excluded, 0);
  const totalOwn = rows.reduce((a, b) => a + b.own, 0);
  const billsWithBillIdVotes = rows.length;
  const billsWithOwnVote = rows.filter((b) => b.own > 0);
  const ownCounts = billsWithOwnVote.map((b) => b.own).sort((a, b) => a - b);
  // Senate-pattern votes that AREN'T also House-linked — the "does Senate leak in" answer.
  const senateOnlyLeak = rows.reduce(
    (a, b) => a + Math.max(0, b.excluded - b.exclHouse),
    0,
  );

  console.log(`   bills carrying ≥1 bill_id vote:        ${billsWithBillIdVotes}`);
  console.log(`   total bill_id-carrying votes:          ${billIdCarryingVotes} (HO 540 STEP 0 measured 890)`);
  console.log(`   excluded as amendment votes:           ${totalExcluded} (${pct(totalExcluded, billIdCarryingVotes)})`);
  console.log(`      of which House-linked (amendment_votes): ${rows.reduce((a, b) => a + b.exclHouse, 0)}`);
  console.log(`      Senate-pattern hits (LIKE):              ${rows.reduce((a, b) => a + b.exclSenate, 0)}`);
  console.log(`      Senate-pattern NOT also House-linked:    ${senateOnlyLeak}  ← does Senate leak into getVotesByBill?`);
  console.log("");
  console.log(`── the GO number: OWN votes after exclusion ──`);
  console.log(`   total own (passage/procedural) votes:  ${totalOwn}`);
  console.log(`   bills that would get a VOTES tab (own>0): ${billsWithOwnVote.length}`);
  if (ownCounts.length > 0) {
    console.log(
      `   own-vote count distribution (bills with a tab): p50=${quantile(ownCounts, 0.5)} · p90=${quantile(ownCounts, 0.9)} · max=${ownCounts[ownCounts.length - 1]}`,
    );
  }
  console.log("");

  // ── 3. THREE named sample bills ───────────────────────────────────────────
  // Magnet + auto-selected representatives so we don't guess IDs:
  //   - House-amendment-bearing = max House-linked exclusions
  //   - normal passage = most own votes with ZERO exclusions
  const byId = (id: string) => rows.find((b) => b.billId === id);
  const houseAmdSample = [...rows].filter((b) => b.exclHouse > 0).sort((a, b) => b.exclHouse - a.exclHouse)[0];
  const passageSample = [...rows]
    .filter((b) => b.excluded === 0 && b.own > 0 && b.billId !== "119-hr-1")
    .sort((a, b) => b.own - a.own)[0];

  const samples: Array<{ tag: string; row: BillRow | undefined }> = [
    { tag: "vote-a-rama magnet", row: byId("119-hr-1") },
    { tag: "House-amendment-bearing (max overlap)", row: houseAmdSample },
    { tag: "normal passage (own>0, zero overlap)", row: passageSample },
  ];

  console.log("── 3 sample bills (total = getVotesByBill count · own = the VOTES tab) ──");
  for (const { tag, row } of samples) {
    if (!row) {
      console.log(`   [${tag}]: (no matching bill found)`);
      continue;
    }
    console.log(
      `   ${row.billId}  [${tag}]`,
    );
    console.log(
      `      total ${row.total} · excluded ${row.excluded} (House-link ${row.exclHouse} + Senate-pattern ${row.exclSenate}) · OWN ${row.own}`,
    );
    // Show a few own-vote questions so the "is this real passage/procedural" claim is inspectable.
    const own = await db.execute({
      sql: `SELECT v.id, v.chamber, v.result,
                   v.yea_count, v.nay_count, v.present_count, v.not_voting_count,
                   COALESCE(v.question, v.description, '—') AS label
              FROM votes v
             WHERE v.bill_id = ?
               AND NOT ${EXCLUDED_EXPR}
             ORDER BY v.vote_date DESC, v.id DESC
             LIMIT 4`,
      args: [row.billId, SENATE_AMDT_QUESTION_LIKE],
    });
    for (const o of own.rows) {
      const tally =
        Number(o.yea_count) + Number(o.nay_count) + Number(o.present_count ?? 0) + Number(o.not_voting_count ?? 0) === 0
          ? "(no tally — by-name/procedural)"
          : `${o.yea_count}-${o.nay_count}`;
      console.log(`         · ${o.id} [${o.chamber}] ${tally} · ${String(o.label).slice(0, 68)}`);
    }
  }
  console.log("");

  console.log("=== summary ===");
  console.log(
    `own votes ${totalOwn} across ${billsWithOwnVote.length} bills (of ${billsWithBillIdVotes} bill_id-carrying); ` +
      `excluded ${totalExcluded} amendment votes; Senate-leak-into-getVotesByBill ${senateOnlyLeak}`,
  );
  console.log(
    `GO shape = a real own-vote population + overlap concentrated on amendment-heavy bills; ` +
      `NO-GO = exclusion empties the tab on nearly all bills.`,
  );

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
