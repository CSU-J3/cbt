// HO 554 STEP 0 — motion-aware amendment-outcome model: read-only probe. BUILDS NOTHING.
//
// HO 550's probe (procedural-amendment-votes-550.ts, committed 9383b9f) priced the
// 64-Senate-roll-call residual and returned GO. This probe closes the four open
// questions before any build leaf/query/component is written, then HALTS for a GO:
//
//   M1 — reconcile HO 550 M4's off-by-one (57 expected clean pairs, 56 measured):
//        which vote fell through `actual===other || implied===other`, and WHICH side.
//   M2 — dot delta (P1 tripwire): deriveDisposition(latest_action_text) — what the
//        prod dot shows TODAY — vs impliedFate(class, votes.result). DISAGREE>0 HALTS.
//   M3 — cardinality: motions per resolved amendment (is the +N-earlier branch reachable?).
//   M4 — the EXACT two-statement hydrate query B2 will run (residual select + member_votes
//        party split), EXPLAIN QUERY PLAN + cold cost from idle, plus residual row count.
//
// Same idiom as HO 550: raw @libsql/client, NO boundedFetch (the 10s bound aborts a
// cold query and hides its true cost), SELECT / EXPLAIN only, dotenv/config, npx tsx.
// Classifiers are RE-DECLARED verbatim from HO 550's probe (it isn't a module — importing
// it runs its main()); deriveDisposition is re-declared verbatim from lib/queries.ts:3148
// (the prod dot authority) so M2 compares against exactly what ships, not actualFate.
//
//   npx tsx scripts/diagnostic/motion-outcome-model-554.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";
import { SENATE_AMDT_QUESTION_LIKE } from "../../lib/amendment-vote-key";

// The residual pre-filter pair B2 will use: mentions an amendment, is NOT up-or-down.
const SENATE_MOTION_QUESTION_LIKE = "%Amdt%";

function timedSync(): number { return Date.now(); }
function s(row: Row | undefined, k: string): string {
  return String((row as Row)?.[k] ?? "");
}
function num(row: Row | undefined, k: string): number {
  return Number((row as Row)?.[k] ?? 0);
}

// ── Classifiers, verbatim from HO 550's probe (scripts/diagnostic/procedural-amendment-votes-550.ts)
type Cls = "table" | "cloture" | "chair" | "waiver" | "tail";
function classify(question: string): Cls {
  if (/^On the Motion to Table S\.Amdt\./.test(question)) return "table";
  if (/^On the Cloture Motion S\.Amdt\./.test(question)) return "cloture";
  if (/^On the Decision of the Chair S\.Amdt\./.test(question)) return "chair";
  if (/^On the Motion \(Motion to\s+Waive.*Amdt\. No\.\s*\d+/i.test(question)) return "waiver";
  return "tail";
}
function amdtNumber(cls: Cls, question: string): number | null {
  const re = cls === "waiver" ? /Amdt\. No\.\s*(\d+)/i : /S\.Amdt\. (\d+)/;
  const m = question.match(re);
  const n = m ? parseInt(m[1] ?? "", 10) : NaN;
  return Number.isFinite(n) ? n : null;
}
function motionOutcome(result: string): "agreed" | "failed" | "other" {
  const r = result.toLowerCase();
  if (/not agreed|rejected|failed|defeated/.test(r)) return "failed";
  if (/agreed to|passed|sustained|adopted/.test(r)) return "agreed";
  return "other";
}
function impliedFate(cls: Cls, result: string): "agreed" | "failed" | "orthogonal" | "other" {
  const o = motionOutcome(result);
  if (cls === "table") return o === "agreed" ? "failed" : o === "failed" ? "agreed" : "other";
  if (cls === "waiver") return o === "agreed" ? "agreed" : o === "failed" ? "failed" : "other";
  return "orthogonal";
}
// HO 550 M4's own action-text classifier, verbatim — needed ONLY to reproduce M1's
// exact accounting (which side of `actual/implied` returned other). NOT the dot.
function actualFate(text: string | null): "agreed" | "failed" | "withdrawn" | "other" {
  if (!text) return "other";
  const t = text.toLowerCase();
  if (/motion to table.*\bagreed to\b/.test(t)) return "failed";
  if (/ruled out of order/.test(t)) return "failed";
  if (/\bwithdrawn\b/.test(t)) return "withdrawn";
  if (/\bfell\b/.test(t)) return "failed";
  if (/\bnot agreed to\b|\brejected\b|\bfailed\b/.test(t)) return "failed";
  if (/\bagreed to\b|\badopted\b|\bpassed\b/.test(t)) return "agreed";
  return "other";
}

// deriveDisposition, verbatim from lib/queries.ts:3148 — THE prod dot authority.
// M2 must compare against this, not actualFate (they differ: no withdrawn/fell/
// out-of-order handling), because this is what renders on prod today.
function deriveDisposition(text: string | null): "agreed" | "failed" | "other" {
  if (!text) return "other";
  const t = text.toLowerCase();
  if (/\bnot agreed to\b|\brejected\b|\bfailed\b|motion to table.*\bagreed to\b/.test(t)) return "failed";
  if (/\bagreed to\b|\badopted\b|\bpassed\b/.test(t)) return "agreed";
  return "other";
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.log("TURSO_DATABASE_URL not set — run with the CBT .env (local working tree).");
    return 1;
  }
  const db: Client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const congress = num((await db.execute(`SELECT MAX(congress) AS c FROM amendments`)).rows[0], "c");
  console.log(`=== HO 554 STEP 0 — motion-aware amendment-outcome model (read-only) — congress ${congress} ===\n`);

  // Pull the residual once (the same predicate B2 uses), classify + resolve each.
  // latest_action_text lives on `amendments`, not `votes`, so it's fetched per-
  // amendment inside the loop below (M2 needs it; the resolve join is 1:1 per M3).
  const residual = await db.execute({
    sql: `SELECT id, congress, question, result FROM votes
          WHERE chamber='senate' AND question LIKE ? AND question NOT LIKE ? ORDER BY id`,
    args: [SENATE_MOTION_QUESTION_LIKE, SENATE_AMDT_QUESTION_LIKE],
  });

  // Resolve each residual vote → amendment id + its latest_action_text (from amendments).
  type Resolved = {
    voteId: string; cls: Cls; question: string; result: string;
    n: number | null; amendmentId: string | null; lat: string | null; anchored: boolean;
  };
  const resolvedList: Resolved[] = [];
  for (const r of residual.rows) {
    const question = s(r, "question");
    const result = s(r, "result");
    const cls = classify(question);
    const n = cls === "tail" ? null : amdtNumber(cls, question);
    const amendmentId = n == null ? null : `${congress}-samdt-${n}`;
    let lat: string | null = null;
    let anchored = false;
    let resolvedId: string | null = amendmentId;
    if (amendmentId) {
      const arow = (await db.execute({
        sql: `SELECT latest_action_text FROM amendments WHERE id=?`, args: [amendmentId],
      })).rows[0];
      if (arow === undefined) {
        resolvedId = null; // number parsed, but no such amendment row exists
      } else {
        lat = (arow as Row).latest_action_text as string | null;
        const anc = (await db.execute({
          sql: `SELECT COUNT(*) AS c FROM amendment_votes WHERE amendment_id=?`, args: [amendmentId],
        })).rows[0];
        anchored = num(anc, "c") > 0;
      }
    }
    resolvedList.push({ voteId: s(r, "id"), cls, question, result, n, amendmentId: resolvedId, lat, anchored });
  }
  const resolvedOnly = resolvedList.filter((x) => x.amendmentId !== null);
  console.log(`residual votes: ${residual.rows.length} · resolved to an existing amendment: ${resolvedOnly.length}`);
  const tails = resolvedList.filter((x) => x.cls === "tail");
  if (tails.length) { console.log(`⚠ TAIL (unclassified) rows: ${tails.length}`); for (const t of tails) console.log(`   "${t.question}"`); }
  console.log("");

  // ── M1 — reconcile HO 550 M4's off-by-one (57 expected, 56 measured) ────────
  console.log("══ M1 — the off-by-one: rows dropped by `actual===other || implied===other` ══");
  let withText = 0, orthogonal = 0, withdrawn = 0, n4 = 0, agree = 0;
  const droppedOther: string[] = [];
  for (const x of resolvedOnly) {
    if (!x.lat) continue;
    withText++;
    const implied = impliedFate(x.cls, x.result);
    if (implied === "orthogonal") { orthogonal++; continue; }
    const actual = actualFate(x.lat);
    if (actual === "withdrawn") { withdrawn++; continue; }
    if (actual === "other" || implied === "other") {
      const side = implied === "other" ? (actual === "other" ? "BOTH" : "implied") : "actual";
      droppedOther.push(
        `${x.amendmentId} [${x.cls}] side=${side}  vote=${x.voteId}\n` +
        `        question="${x.question}"\n` +
        `        result  ="${x.result}"  → motionOutcome=${motionOutcome(x.result)} impliedFate=${implied}\n` +
        `        action  ="${x.lat}"  → actualFate=${actual}`,
      );
      continue;
    }
    n4++;
    if (implied === actual) agree++;
  }
  console.log(`   withText=${withText} · orthogonal=${orthogonal} · withdrawn=${withdrawn} · N(clean pairs)=${n4} · agree=${agree}/${n4}`);
  console.log(`   accounting: ${withText} − ${orthogonal} orthogonal − ${withdrawn} withdrawn − ${droppedOther.length} other = ${withText - orthogonal - withdrawn - droppedOther.length} (== N)`);
  if (droppedOther.length === 0) console.log("   (no rows dropped by the other-branch)");
  for (const d of droppedOther) {
    console.log("   ✗ DROPPED (other-branch):");
    console.log(`     ${d}`);
    console.log(`     → implied===other is a RENDER gap (motion has no verb); actual===other is a VALIDATION-coverage gap only.`);
  }
  console.log("");

  // ── M2 — dot delta (P1 tripwire) ────────────────────────────────────────────
  console.log("══ M2 — dot delta: deriveDisposition(latest_action_text) [PROD DOT] vs impliedFate ══");
  let AGREE = 0, DOT_OTHER = 0, ORTHOGONAL = 0, DISAGREE = 0, MOTION_OTHER = 0, NO_TEXT = 0;
  const dotOtherRows: string[] = [];
  const disagreeRows: string[] = [];
  const motionOtherRows: string[] = [];
  for (const x of resolvedOnly) {
    const implied = impliedFate(x.cls, x.result);
    if (implied === "orthogonal") { ORTHOGONAL++; continue; }
    if (implied === "other") {
      MOTION_OTHER++;
      motionOtherRows.push(`${x.amendmentId} [${x.cls}] result="${x.result}" dot=${deriveDisposition(x.lat)} anchored=${x.anchored}`);
      continue;
    }
    const dot = deriveDisposition(x.lat);
    if (x.lat === null) NO_TEXT++;
    if (dot === "other") {
      DOT_OTHER++;
      dotOtherRows.push(`${x.amendmentId} [${x.cls}] dot=other implied=${implied} result="${x.result}" anchored=${x.anchored}\n        action="${x.lat}"`);
    } else if (dot === implied) {
      AGREE++;
    } else {
      DISAGREE++;
      disagreeRows.push(`${x.amendmentId} [${x.cls}] dot=${dot} implied=${implied} result="${x.result}" anchored=${x.anchored}\n        action="${x.lat}"`);
    }
  }
  console.log(`   AGREE=${AGREE} · DOT-OTHER=${DOT_OTHER} · ORTHOGONAL=${ORTHOGONAL} · DISAGREE=${DISAGREE} · (MOTION-OTHER=${MOTION_OTHER}, NO-TEXT=${NO_TEXT})`);
  if (MOTION_OTHER) { console.log("   MOTION-OTHER rows (motion result unclassifiable → no implied fate; excluded, ~the M1 row):"); for (const m of motionOtherRows) console.log(`     · ${m}`); }
  if (DOT_OTHER) { console.log("   DOT-OTHER rows (muted dot, motion implies a clean fate → surface would ADD outcome):"); for (const d of dotOtherRows) console.log(`     · ${d}`); }
  if (DISAGREE) {
    console.log("   ⚠⚠ DISAGREE > 0 — HALT. Dot and motion imply OPPOSITE fates on live prod:");
    for (const d of disagreeRows) console.log(`     ✗ ${d}`);
  } else {
    console.log("   ✓ DISAGREE = 0 — no row where dot and motion imply opposite fates.");
  }
  console.log("");

  // ── M3 — cardinality: motions per resolved amendment ────────────────────────
  console.log("══ M3 — cardinality: residual motions per resolved amendment ══");
  const perAmendment = new Map<string, string[]>();
  for (const x of resolvedOnly) {
    const list = perAmendment.get(x.amendmentId as string) ?? [];
    list.push(x.voteId);
    perAmendment.set(x.amendmentId as string, list);
  }
  let maxCount = 0;
  const multi: string[] = [];
  for (const [id, votes] of perAmendment) {
    if (votes.length > maxCount) maxCount = votes.length;
    if (votes.length > 1) multi.push(`${id} → ${votes.length} motions: ${votes.join(", ")}`);
  }
  console.log(`   distinct resolved amendments: ${perAmendment.size} · residual votes: ${resolvedOnly.length} · MAX(motions/amendment)=${maxCount}`);
  if (maxCount <= 1) console.log("   ✓ 1:1 — the +N-earlier overflow branch is UNREACHABLE on live data (ships unexercised; §6 falsification applies).");
  else { console.log(`   ⚠ MAX > 1 — the +N-earlier branch IS reachable:`); for (const m of multi) console.log(`     · ${m}`); }
  console.log("");

  // ── M4 — the exact two-statement hydrate query: plans + cold cost ───────────
  console.log("══ M4 — B2's two-statement hydrate: EXPLAIN QUERY PLAN + cold cost from idle ══");
  const residualSql =
    `SELECT id, congress, question, result, vote_date, yea_count, nay_count, present_count, not_voting_count
       FROM votes WHERE chamber='senate' AND question LIKE ? AND question NOT LIKE ?`;
  console.log("   ── statement 1: residual select ──");
  {
    const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${residualSql}`, args: [SENATE_MOTION_QUESTION_LIKE, SENATE_AMDT_QUESTION_LIKE] });
    for (const p of plan.rows) console.log(`      · ${s(p, "detail")}`);
  }
  const t0 = timedSync();
  const step1 = await db.execute({ sql: residualSql, args: [SENATE_MOTION_QUESTION_LIKE, SENATE_AMDT_QUESTION_LIKE] });
  console.log(`   ⏱  statement 1 (cold): ${Date.now() - t0}ms · rows=${step1.rows.length}`);
  console.log(`   (note above whether it rides idx_votes_chamber_date (chamber seek) or SCANs votes — LIKE on question can't be indexed)`);
  const voteIds = step1.rows.map((r) => s(r, "id"));

  console.log("   ── statement 2: member_votes × members party split over those vote ids ──");
  if (voteIds.length === 0) {
    console.log("   (no residual vote ids — split query skipped)");
  } else {
    const splitSql =
      `SELECT mv.vote_id, m.party, mv.position, COUNT(*) AS c
         FROM member_votes mv JOIN members m ON m.bioguide_id = mv.bioguide_id
        WHERE mv.vote_id IN (${voteIds.map(() => "?").join(",")})
        GROUP BY mv.vote_id, m.party, mv.position`;
    {
      const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${splitSql}`, args: voteIds });
      for (const p of plan.rows) console.log(`      · ${s(p, "detail")}`);
    }
    const t1 = timedSync();
    const step2 = await db.execute({ sql: splitSql, args: voteIds });
    console.log(`   ⏱  statement 2 (cold): ${Date.now() - t1}ms · rows=${step2.rows.length}`);
  }
  console.log("");

  console.log("══ SUMMARY ══");
  console.log(`   M1 dropped-other: ${droppedOther.length}${droppedOther.length ? " (see side above)" : ""} · N=${n4}`);
  console.log(`   M2 AGREE=${AGREE} DOT-OTHER=${DOT_OTHER} ORTHOGONAL=${ORTHOGONAL} DISAGREE=${DISAGREE}${DISAGREE ? " ⚠ HALT" : " ✓"} (MOTION-OTHER=${MOTION_OTHER})`);
  console.log(`   M3 MAX(motions/amendment)=${maxCount}${maxCount <= 1 ? " (1:1)" : " ⚠"}`);
  console.log(`   M4 residual rows=${step1.rows.length}`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
