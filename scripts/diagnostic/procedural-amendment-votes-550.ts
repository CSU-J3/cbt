// HO 550 STEP 0 — procedural amendment outcomes: read-only probe. BUILDS NOTHING.
//
// The banked HO 537 M8 item is the 64 Senate roll calls that TOUCH an amendment
// without being its up-or-down vote — Motion to Table, Cloture Motion, Decision of
// the Chair, and the "Motion to Waive … Budgetary Discipline Re: … Amdt. No. N"
// budget waivers. Their yea/nay is on the MOTION, not the amendment, so the tally
// polarity is inverted or orthogonal and the amendment-framed VoteLine renders them
// wrong (lib/amendment-vote-key.ts SCOPE note). This probe measures whether a
// motion-aware surface is worth building AND whether the premise holds on BOTH
// chambers — then HALTS for a GO/NO-GO call. No query layer, component, or migration.
//
// M5 is the priority: the Senate MATERIALIZER excludes procedural (SENATE_AMDT_Q),
// but the HOUSE WALK (lib/amendment-votes-walk.ts) links EVERY recordedVotes entry
// off a HAMDT's /actions with no question filter. If a procedural House roll call is
// attached, it's in amendment_votes rendering as the amendment's own outcome — WRONG
// DATA ON PROD, which outranks the feature. Run + report M5 first.
//
// Raw @libsql/client, NO boundedFetch (the 10s bound aborts a cold query and hides
// its true cost — the HO 540/543/546 idiom). Read-only: SELECT / EXPLAIN only.
//
//   npx tsx scripts/diagnostic/procedural-amendment-votes-550.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";
import { SENATE_AMDT_Q, SENATE_AMDT_QUESTION_LIKE } from "../../lib/amendment-vote-key";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  console.log(`   ⏱  ${label}: ${Date.now() - t0}ms`);
  return r;
}
function s(row: Row | undefined, k: string): string {
  return String((row as Row)?.[k] ?? "");
}
function num(row: Row | undefined, k: string): number {
  return Number((row as Row)?.[k] ?? 0);
}

// The residual class vocabulary (M1). Up-or-down is SENATE_AMDT_Q; these are the
// procedural forms that TOUCH an amendment. Number token differs: table/cloture/
// chair carry `S.Amdt. N`; waivers carry `Amdt. No. N`.
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
// A waiver names its sponsor ("… Re: Merkley Amdt. No. 2446"); surname → coherence check.
function waiverSurname(question: string): string | null {
  const m = question.match(/Re:\s*([A-Za-z]+)\s+Amdt\. No\./i);
  return m ? (m[1] ?? "").toLowerCase() : null;
}
function motionOutcome(result: string): "agreed" | "failed" | "other" {
  const r = result.toLowerCase();
  if (/not agreed|rejected|failed|defeated/.test(r)) return "failed";
  if (/agreed to|passed|sustained|adopted/.test(r)) return "agreed";
  return "other";
}
// Implied AMENDMENT fate under the inversion model (table/waiver only; cloture +
// chair are orthogonal to the amendment's fate and can't imply one).
function impliedFate(cls: Cls, result: string): "agreed" | "failed" | "orthogonal" | "other" {
  const o = motionOutcome(result);
  if (cls === "table") return o === "agreed" ? "failed" : o === "failed" ? "agreed" : "other"; // tabling agreed = killed
  if (cls === "waiver") return o === "agreed" ? "agreed" : o === "failed" ? "failed" : "other"; // waive agreed = amendment survives
  return "orthogonal";
}
// The amendment's recorded fate from ITS OWN latest_action_text. Order-sensitive:
// the "killed" phrasings ("Motion to table … agreed to", "ruled out of order",
// "fell") must be tested BEFORE the bare "agreed to" (a table motion agreed = the
// amendment KILLED, not agreed — the same trap deriveDisposition guards). "withdrawn"
// is neither a clean agree nor a fail (the amendment survived the procedural vote and
// was pulled later), so it's its own bucket, excluded from the agreement rate.
function actualFate(text: string | null): "agreed" | "failed" | "withdrawn" | "other" {
  if (!text) return "other";
  const t = text.toLowerCase();
  if (/motion to table.*\bagreed to\b/.test(t)) return "failed"; // tabled = killed
  if (/ruled out of order/.test(t)) return "failed"; // point of order sustained = out
  if (/\bwithdrawn\b/.test(t)) return "withdrawn";
  if (/\bfell\b/.test(t)) return "failed";
  if (/\bnot agreed to\b|\brejected\b|\bfailed\b/.test(t)) return "failed";
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
  const congress = num(
    (await db.execute(`SELECT MAX(congress) AS c FROM amendments`)).rows[0],
    "c",
  );
  console.log(`=== HO 550 STEP 0 — procedural amendment-vote residual (read-only) — congress ${congress} ===\n`);

  // ── M5 — THE HOUSE ASYMMETRY (first + first-reported) ──────────────────────
  console.log("══ M5 — House asymmetry: procedural votes ALREADY in amendment_votes ══");
  const linked = await db.execute(`
    SELECT av.amendment_id, av.vote_id, v.chamber, v.question, v.result,
           v.yea_count, v.nay_count
    FROM amendment_votes av JOIN votes v ON v.id = av.vote_id`);
  // up-or-down: House "On Agreeing to the Amendment%"; Senate SENATE_AMDT_Q.
  const suspect = linked.rows.filter((r) => {
    const q = s(r, "question");
    const ch = s(r, "chamber");
    const upDown = ch === "house" ? /^On Agreeing to the Amendment\b/.test(q) : SENATE_AMDT_Q.test(q);
    return !upDown;
  });
  console.log(`   amendment_votes rows: ${linked.rows.length} · NON-up-or-down (procedural) linked: ${suspect.length}`);
  if (suspect.length === 0) {
    console.log("   ✓ ZERO — the unfiltered House walk is safe by upstream luck (Congress.gov attaches only");
    console.log("     decisive roll calls to a HAMDT's actions); a dependency on their behaviour, not construction.\n");
  } else {
    console.log("   ⚠ NON-ZERO → P1: these render through the amendment-framed VoteLine as the amendment's outcome TODAY:");
    for (const r of suspect) {
      console.log(`     ${s(r, "amendment_id")}  vote=${s(r, "vote_id")}  [${s(r, "chamber")}]  "${s(r, "question")}"  result="${s(r, "result")}"  ${num(r, "yea_count")}-${num(r, "nay_count")}`);
    }
    console.log("");
  }

  // ── M1 — class coverage (the M8 residual, expected 64 = 14 + 50) ───────────
  console.log("══ M1 — residual class coverage (Senate votes mentioning an amdt, NOT up-or-down) ══");
  const residual = await db.execute({
    sql: `SELECT id, question, result FROM votes
          WHERE chamber='senate' AND question LIKE '%Amdt%'
            AND question NOT LIKE ? ORDER BY id`,
    args: [SENATE_AMDT_QUESTION_LIKE],
  });
  const byClass: Record<Cls, Row[]> = { table: [], cloture: [], chair: [], waiver: [], tail: [] };
  for (const r of residual.rows) byClass[classify(s(r, "question"))].push(r);
  console.log(`   residual total: ${residual.rows.length} (M8: 64 = 14 S.Amdt-form + 50 waivers)`);
  for (const c of ["table", "cloture", "chair", "waiver", "tail"] as Cls[]) {
    console.log(`   ${c.padEnd(8)} ${byClass[c].length}`);
  }
  const sAmdtForm = byClass.table.length + byClass.cloture.length + byClass.chair.length;
  console.log(`   → S.Amdt-form (table+cloture+chair) = ${sAmdtForm}  ·  waiver = ${byClass.waiver.length}  ·  TAIL = ${byClass.tail.length}`);
  if (byClass.tail.length) {
    console.log("   ⚠ TAIL present — vocabulary is NOT closed; a motion-aware model can't be deterministic:");
    for (const r of byClass.tail) console.log(`     "${s(r, "question")}"`);
  } else {
    console.log("   ✓ vocabulary CLOSED (table / cloture / chair / waiver) — no tail.");
  }
  console.log("");

  // ── M2 — number-token resolution + namespace coherence ─────────────────────
  console.log("══ M2 — number-token resolution per class + waiver namespace check ══");
  const resolvedIds = new Set<string>();
  for (const c of ["table", "cloture", "chair", "waiver"] as Cls[]) {
    let resolved = 0;
    let coherent = 0; // exists as SAMDT + this congress
    let sponsorOk = 0;
    let sponsorChecked = 0;
    for (const r of byClass[c]) {
      const n = amdtNumber(c, s(r, "question"));
      if (n == null) continue;
      const id = `${congress}-samdt-${n}`;
      const arow = (
        await db.execute({
          sql: `SELECT id, amendment_type, congress, sponsor_name FROM amendments WHERE id=?`,
          args: [id],
        })
      ).rows[0];
      if (arow) {
        resolved++;
        resolvedIds.add(id);
        if (s(arow, "amendment_type") === "SAMDT" && num(arow, "congress") === congress) coherent++;
        if (c === "waiver") {
          const surname = waiverSurname(s(r, "question"));
          if (surname) {
            sponsorChecked++;
            if (s(arow, "sponsor_name").toLowerCase().includes(surname)) sponsorOk++;
          }
        }
      }
    }
    const extra =
      c === "waiver" && sponsorChecked
        ? ` · sponsor-name matches ${sponsorOk}/${sponsorChecked} (namespace = Senate S.Amdt number)`
        : "";
    console.log(`   ${c.padEnd(8)} resolved ${resolved}/${byClass[c].length} · coherent SAMDT/${congress}: ${coherent}${extra}`);
  }
  console.log(`   → distinct residual-resolved amendments: ${resolvedIds.size}\n`);

  // ── M3 — the payoff: residual-resolved amendments with NO anchored decisive vote
  console.log("══ M3 — payoff: residual-resolved amendments that would GAIN a line ══");
  let wouldGain = 0;
  let alreadyAnchored = 0; // already in amendment_votes (double-line risk)
  for (const id of resolvedIds) {
    const anchored = num(
      (await db.execute({ sql: `SELECT COUNT(*) AS c FROM amendment_votes WHERE amendment_id=?`, args: [id] })).rows[0],
      "c",
    );
    if (anchored > 0) alreadyAnchored++;
    else wouldGain++;
  }
  console.log(`   residual-resolved amendments: ${resolvedIds.size}`);
  console.log(`   already carry an anchored decisive vote (double-line risk): ${alreadyAnchored}`);
  console.log(`   ✦ would GAIN a line they don't have today (the payoff): ${wouldGain}\n`);

  // ── M4 — polarity rule agreement vs latest_action_text (report N) ──────────
  console.log("══ M4 — inversion-model agreement vs amendments.latest_action_text (with N) ══");
  let withText = 0; // residual-resolved amendments that carry ANY action text
  let orthogonal = 0; // cloture/chair — can't imply a fate
  let withdrawn = 0; // amendment survived the vote, pulled later — excluded from rate
  let n4 = 0; // clean cross-check pairs (table/waiver × classifiable fate)
  let agree = 0;
  const disagreements: string[] = [];
  for (const c of ["table", "cloture", "chair", "waiver"] as Cls[]) {
    for (const r of byClass[c]) {
      const n = amdtNumber(c, s(r, "question"));
      if (n == null) continue;
      const id = `${congress}-samdt-${n}`;
      const arow = (
        await db.execute({ sql: `SELECT latest_action_text FROM amendments WHERE id=?`, args: [id] })
      ).rows[0];
      const lat = arow ? ((arow as Row).latest_action_text as string | null) : null;
      if (!lat) continue;
      withText++;
      const implied = impliedFate(c, s(r, "result"));
      if (implied === "orthogonal") { orthogonal++; continue; }
      const actual = actualFate(lat);
      if (actual === "withdrawn") { withdrawn++; continue; }
      if (actual === "other" || implied === "other") continue;
      n4++;
      if (implied === actual) agree++;
      else disagreements.push(`samdt-${n} [${c}] implied=${implied} actual=${actual} motion="${s(r, "result")}" action="${lat.slice(0, 70)}"`);
    }
  }
  console.log(`   COVERAGE for THIS set: ${withText}/${resolvedIds.size} residual-resolved amendments carry action text`);
  console.log(`     (NOT the corpus-wide ~8.6% — a procedural floor vote generates an action, so this set is ~fully covered)`);
  console.log(`   clean cross-check pairs (table/waiver × classifiable fate): N=${n4}`);
  console.log(`   agreement: ${agree}/${n4}${n4 ? ` (${((agree / n4) * 100).toFixed(0)}%)` : ""}`);
  console.log(`   cloture/chair orthogonal (excluded): ${orthogonal} · withdrawn/pulled-later (excluded): ${withdrawn}`);
  for (const d of disagreements) console.log(`   ✗ ${d}`);
  console.log("");

  // ── M6 — cold cost of the join the surface would need ──────────────────────
  console.log("══ M6 — cold cost of the residual + member_votes party-split join (from idle) ══");
  const joinSql = `SELECT v.id, v.result,
      SUM(CASE WHEN mv.position='yea' THEN 1 ELSE 0 END) AS yea,
      SUM(CASE WHEN mv.position='nay' THEN 1 ELSE 0 END) AS nay
    FROM votes v LEFT JOIN member_votes mv ON mv.vote_id = v.id
    WHERE v.chamber='senate' AND v.question LIKE '%Amdt%' AND v.question NOT LIKE ?
    GROUP BY v.id`;
  await (async () => {
    const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${joinSql}`, args: [SENATE_AMDT_QUESTION_LIKE] });
    for (const p of plan.rows) console.log(`      · ${s(p, "detail")}`);
  })();
  const jr = await timed("residual × member_votes party split (cold)", () =>
    db.execute({ sql: joinSql, args: [SENATE_AMDT_QUESTION_LIKE] }),
  );
  console.log(`   rows: ${jr.rows.length} (64 residual votes — trivial; measured not asserted, HO 340/543)\n`);

  console.log("══ SUMMARY ══");
  console.log(`   M5 procedural-in-amendment_votes: ${suspect.length}${suspect.length ? " ⚠ P1" : " ✓"}`);
  console.log(`   M1 residual ${residual.rows.length} (tail ${byClass.tail.length}) · M2 resolved ${resolvedIds.size} · M3 would-gain ${wouldGain} · M4 N=${n4}`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
