// HO 555 STEP 0 — amendment disposition vocabulary: read-only probe. BUILDS NOTHING.
//
// HO 554 STEP 0 M2 found deriveDisposition (lib/queries.ts, the prod dot authority)
// renders a muted `other` dot on 53/64 Senate procedural-residual amendments whose
// latest_action_text states an unambiguous fate (mostly "ruled out of order by the
// chair", plus "fell"). This probe DERIVES the widening predicate from the FULL
// corpus population — not from those 3 examples — then HALTS for a GO.
//
//   M1 — the `other` bucket of latest_action_text: normalise + cluster, top-30 shapes,
//        hand-tagged KILL/PASS/NEITHER/AMBIGUOUS. The verbatim strings, not a summary.
//   M2 — every distinct votes.result reachable through the amendment paths, with counts.
//        Collision verdict: does a candidate KILL token appear in a result string? If so
//        the widening must split into two functions (§3), not one shared.
//   M3 — before/after delta on every rendered number (summary acted + voted blocks,
//        corpus dot distribution) under the CANDIDATE classifier. Zero-flip safety gate:
//        NO row may move agreed↔failed; only `other` may move. Non-zero prints + HALTs.
//   M4 — done statically by grep (reported separately): the ?disposition= SQL filter
//        (queries.ts:3748-3749) and the "voted" EXISTS predicate (3753-3755) do NOT call
//        deriveDisposition. Confirmed; §1 blast radius holds.
//
// Raw @libsql/client, NO boundedFetch (10s bound hides a cold query's true cost),
// SELECT only. deriveDisposition is re-declared verbatim from lib/queries.ts:3148 (the
// OLD classifier); the CANDIDATE is deriveDispositionNew below.
//
//   npx tsx scripts/diagnostic/disposition-vocabulary-555.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";
import { SENATE_AMDT_QUESTION_LIKE } from "../../lib/amendment-vote-key";

function s(row: Row | undefined, k: string): string {
  return String((row as Row)?.[k] ?? "");
}

// OLD — verbatim from lib/queries.ts:3148 (the classifier shipping on prod today).
function deriveDisposition(text: string | null): "agreed" | "failed" | "other" {
  if (!text) return "other";
  const t = text.toLowerCase();
  if (/\bnot agreed to\b|\brejected\b|\bfailed\b|motion to table.*\bagreed to\b/.test(t)) return "failed";
  if (/\bagreed to\b|\badopted\b|\bpassed\b/.test(t)) return "agreed";
  return "other";
}

// CANDIDATE — the failed-family gains the two measured kill phrasings HO 554 surfaced.
// Failed-family stays FIRST (ordering guarantee preserved). `withdrawn` / `rendered
// moot` deliberately NOT added — §3 keeps them `other` (the amendment survived the vote,
// or the text describes the cloture motion's fate, not the amendment's). M1 may justify
// widening this further; that's the user's call at GO.
const CANDIDATE_KILL = /ruled out of order|\bfell\b/;
function deriveDispositionNew(text: string | null): "agreed" | "failed" | "other" {
  if (!text) return "other";
  const t = text.toLowerCase();
  if (/\bnot agreed to\b|\brejected\b|\bfailed\b|motion to table.*\bagreed to\b/.test(t) || CANDIDATE_KILL.test(t))
    return "failed";
  if (/\bagreed to\b|\badopted\b|\bpassed\b/.test(t)) return "agreed";
  return "other";
}

// Normalise an action-text string to a cluster shape: lowercase; collapse amendment
// refs (SA N / S.Amdt. N / H.Amdt. N / SUA N), dates, chamber suffixes, and any
// remaining bare number to a stable token, so "Amendment SA 130 ruled out of order by
// the chair" and "...SA 5779..." land in ONE cluster.
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
function normalize(text: string): string {
  let t = text.toLowerCase();
  t = t.replace(/s\.?\s?amdt\.?\s*\d+/g, "samdt#");
  t = t.replace(/h\.?\s?amdt\.?\s*\d+/g, "hamdt#");
  t = t.replace(/\bsua\s*\d+/g, "sua#");
  t = t.replace(/\bsa\s*\d+/g, "sa#");
  t = t.replace(new RegExp(`\\b(${MONTHS})\\s+\\d{1,2},?\\s+\\d{4}`, "g"), "date");
  t = t.replace(/\d{4}-\d{2}-\d{2}/g, "date");
  t = t.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, "date");
  t = t.replace(/\bin (the )?(senate|house)\b/g, "");
  t = t.replace(/\b\d+\b/g, "#");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

// First-pass heuristic tag (I hand-verify against the verbatim strings in the report).
function tag(shape: string): "KILL" | "PASS" | "NEITHER" | "AMBIGUOUS" {
  if (/out of order|\bfell\b|stricken|struck down|killed|tabled/.test(shape)) return "KILL";
  if (/agreed to|adopted|passed|prevailed/.test(shape)) return "PASS";
  if (/withdrawn|rendered moot|pending|submitted|proposed|considered|received|referred|ordered|printed|reserved|placed on/.test(shape))
    return "NEITHER";
  return "AMBIGUOUS";
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.log("TURSO_DATABASE_URL not set — run with the CBT .env (local working tree).");
    return 1;
  }
  const db: Client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  console.log(`=== HO 555 STEP 0 — amendment disposition vocabulary (read-only) ===\n`);

  // ── M1 — the `other` bucket of latest_action_text, clustered ────────────────
  console.log("══ M1 — the `other` bucket of amendments.latest_action_text, clustered ══");
  const acted = await db.execute(
    "SELECT latest_action_text FROM amendments WHERE latest_action_text IS NOT NULL",
  );
  type Cluster = { shape: string; count: number; examples: string[] };
  const clusters = new Map<string, Cluster>();
  let otherCount = 0;
  for (const r of acted.rows) {
    const text = s(r, "latest_action_text");
    if (deriveDisposition(text) !== "other") continue;
    otherCount++;
    const shape = normalize(text);
    const c = clusters.get(shape) ?? { shape, count: 0, examples: [] };
    c.count++;
    if (c.examples.length < 2 && !c.examples.includes(text)) c.examples.push(text);
    clusters.set(shape, c);
  }
  const sorted = [...clusters.values()].sort((a, b) => b.count - a.count);
  console.log(`   acted (latest_action_text NOT NULL): ${acted.rows.length}`);
  console.log(`   → OLD classifier 'other': ${otherCount} (${((otherCount / acted.rows.length) * 100).toFixed(1)}% of acted) · distinct shapes: ${clusters.size}`);
  console.log(`   top 30 shapes by frequency (heuristic tag; verbatim examples for hand-verify):\n`);
  for (const c of sorted.slice(0, 30)) {
    console.log(`   [${tag(c.shape).padEnd(9)}] ${String(c.count).padStart(4)}  ${c.shape}`);
    for (const ex of c.examples) console.log(`                     · "${ex}"`);
  }
  // How much of `other` would the CANDIDATE move out?
  let candidateMoves = 0;
  for (const c of sorted) if (deriveDispositionNew(c.examples[0] ?? c.shape) !== "other") candidateMoves += c.count;
  console.log(`\n   CANDIDATE (ruled out of order | fell) moves ${candidateMoves}/${otherCount} of the 'other' bucket → a decided fate.\n`);

  // ── M2 — every distinct votes.result reachable through the amendment paths ───
  console.log("══ M2 — distinct votes.result over the amendment paths (whole vocabulary) ══");
  const anchored = await db.execute(
    `SELECT v.result AS result, COUNT(*) AS n
       FROM amendment_votes av JOIN votes v ON v.id = av.vote_id
      GROUP BY v.result ORDER BY n DESC`,
  );
  const senateParse = await db.execute({
    sql: `SELECT result, COUNT(*) AS n FROM votes
           WHERE chamber='senate' AND question LIKE ? GROUP BY result ORDER BY n DESC`,
    args: [SENATE_AMDT_QUESTION_LIKE],
  });
  const resultCounts = new Map<string, number>();
  for (const r of anchored.rows) resultCounts.set(s(r, "result"), (resultCounts.get(s(r, "result")) ?? 0) + Number(r.n ?? 0));
  for (const r of senateParse.rows) resultCounts.set(s(r, "result"), (resultCounts.get(s(r, "result")) ?? 0) + Number(r.n ?? 0));
  console.log(`   amendment_votes⋈votes distinct results: ${anchored.rows.length} · senate up-or-down parse distinct: ${senateParse.rows.length}`);
  console.log(`   UNION of distinct result strings (count is across both paths, may double-count a shared vote):`);
  const allResults = [...resultCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [res, n] of allResults) {
    const collide = CANDIDATE_KILL.test(res.toLowerCase());
    console.log(`     ${String(n).padStart(4)}  "${res}"${collide ? "   ⚠ COLLIDES with candidate KILL token" : ""}`);
  }
  const collisions = allResults.filter(([res]) => CANDIDATE_KILL.test(res.toLowerCase()));
  console.log(`\n   COLLISION VERDICT: candidate KILL token (ruled out of order | fell) in a votes.result: ${collisions.length}`);
  if (collisions.length === 0) console.log("   ✓ NONE — the widening can stay a single shared function (§3 stays one function).");
  else { console.log("   ⚠ COLLISION — §3 must split into deriveActionDisposition / deriveVoteDisposition:"); for (const [res, n] of collisions) console.log(`     ${n}  "${res}"`); }
  console.log("");

  // ── M3 — before/after delta on every rendered number + zero-flip gate ───────
  console.log("══ M3 — before/after under the candidate + zero-flip safety gate ══");

  // (a) getAmendmentsSummary acted block (latest_action_text)
  let oAgreed = 0, oFailed = 0, nAgreed = 0, nFailed = 0;
  let actedFlips = 0;
  const actedFlipRows: string[] = [];
  for (const r of acted.rows) {
    const text = s(r, "latest_action_text");
    const o = deriveDisposition(text), n = deriveDispositionNew(text);
    if (o === "agreed") oAgreed++; else if (o === "failed") oFailed++;
    if (n === "agreed") nAgreed++; else if (n === "failed") nFailed++;
    if ((o === "agreed" && n === "failed") || (o === "failed" && n === "agreed")) { actedFlips++; actedFlipRows.push(`[acted] "${text}" ${o}→${n}`); }
  }
  const oOtherActed = acted.rows.length - oAgreed - oFailed;
  const nOtherActed = acted.rows.length - nAgreed - nFailed;
  console.log("   acted block (latest_action_text) — acted/filedOnly unchanged (counts, not classified):");
  console.log(`     agreed     ${oAgreed} → ${nAgreed}`);
  console.log(`     failed     ${oFailed} → ${nFailed}`);
  console.log(`     otherActed ${oOtherActed} → ${nOtherActed}`);

  // (b) getAmendmentsSummary voted block — one canonical (latest) vote per amendment
  const votedRs = await db.execute(
    `WITH ranked AS (
       SELECT av.amendment_id AS amendment_id, v.result AS result,
              ROW_NUMBER() OVER (PARTITION BY av.amendment_id ORDER BY v.vote_date DESC, v.id DESC) AS rn
         FROM amendment_votes av JOIN votes v ON v.id = av.vote_id)
     SELECT r.result FROM ranked r WHERE r.rn = 1`,
  );
  let ovA = 0, ovF = 0, nvA = 0, nvF = 0, votedFlips = 0;
  const votedFlipRows: string[] = [];
  for (const r of votedRs.rows) {
    const res = (r.result as string | null) ?? null;
    const o = deriveDisposition(res), n = deriveDispositionNew(res);
    if (o === "agreed") ovA++; else if (o === "failed") ovF++;
    if (n === "agreed") nvA++; else if (n === "failed") nvF++;
    if ((o === "agreed" && n === "failed") || (o === "failed" && n === "agreed")) { votedFlips++; votedFlipRows.push(`[voted] "${res}" ${o}→${n}`); }
  }
  const ovO = votedRs.rows.length - ovA - ovF;
  const nvO = votedRs.rows.length - nvA - nvF;
  console.log("   voted block (canonical votes.result):");
  console.log(`     votedAgreed ${ovA} → ${nvA}`);
  console.log(`     votedFailed ${ovF} → ${nvF}`);
  console.log(`     votedOther  ${ovO} → ${nvO}`);

  // (c) corpus-wide dot distribution across ALL amendments (null text → other)
  const all = await db.execute("SELECT latest_action_text FROM amendments");
  let cOa = 0, cOf = 0, cOo = 0, cNa = 0, cNf = 0, cNo = 0, corpusFlips = 0;
  const corpusFlipRows: string[] = [];
  for (const r of all.rows) {
    const text = (r.latest_action_text as string | null) ?? null;
    const o = deriveDisposition(text), n = deriveDispositionNew(text);
    if (o === "agreed") cOa++; else if (o === "failed") cOf++; else cOo++;
    if (n === "agreed") cNa++; else if (n === "failed") cNf++; else cNo++;
    if ((o === "agreed" && n === "failed") || (o === "failed" && n === "agreed")) { corpusFlips++; corpusFlipRows.push(`[corpus] "${text}" ${o}→${n}`); }
  }
  console.log(`   corpus dot distribution (all ${all.rows.length} amendments, null text → other):`);
  console.log(`     agreed ${cOa} → ${cNa}  ·  failed ${cOf} → ${cNf}  ·  other ${cOo} → ${cNo}`);

  const totalFlips = actedFlips + votedFlips + corpusFlips;
  console.log(`\n   ZERO-FLIP GATE — rows moving agreed↔failed: acted=${actedFlips} voted=${votedFlips} corpus=${corpusFlips} · TOTAL=${totalFlips}`);
  if (totalFlips === 0) console.log("   ✓ 0 flips — the candidate only moves rows OUT OF `other`. Safe direction.");
  else {
    console.log("   ⚠⚠ NON-ZERO FLIPS — HALT. The predicate reclassifies a decided state:");
    for (const d of [...actedFlipRows, ...votedFlipRows, ...corpusFlipRows]) console.log(`     ✗ ${d}`);
  }
  console.log("");

  // ── M5 — the `when` subordinate-clause WATCH (HO 555 GO addendum) ────────────
  // SA 3963 was mis-read agreed because a trailing "... agreed to" belonged to a
  // subordinate "fell when ..." clause. `fell`/`ruled out of order` rescue the ones
  // that carry a kill token; this counts the residual — rows STILL `agreed` under the
  // NEW classifier whose text carries `when`. Small + all genuine agrees ⇒ SA 3963
  // was alone; any that read as a subject-failed mis-read ⇒ a family → doc-sweep WATCH.
  console.log("══ M5 — `agreed`-under-new rows containing the word `when` (subordinate-clause watch) ══");
  const whenRows: string[] = [];
  for (const r of all.rows) {
    const text = (r.latest_action_text as string | null) ?? null;
    if (!text) continue;
    if (deriveDispositionNew(text) !== "agreed") continue;
    if (/\bwhen\b/.test(text.toLowerCase())) whenRows.push(text);
  }
  console.log(`   agreed-under-new rows with \`when\`: ${whenRows.length}`);
  if (whenRows.length < 20) for (const t of whenRows) console.log(`     · "${t}"`);
  else console.log(`     (≥20 — suppressed; too many to hand-read, promote the query to the WATCH as-is)`);
  console.log("");

  console.log("══ SUMMARY ══");
  console.log(`   M1 other=${otherCount}/${acted.rows.length} acted · candidate moves ${candidateMoves} out of other`);
  console.log(`   M2 collisions=${collisions.length}${collisions.length ? " ⚠ split" : " ✓ single-fn"}`);
  console.log(`   M3 acted other ${oOtherActed}→${nOtherActed} · voted other ${ovO}→${nvO} · corpus other ${cOo}→${cNo} · FLIPS=${totalFlips}${totalFlips ? " ⚠ HALT" : " ✓"}`);
  console.log(`   M4 (grep): ?disposition= filter + voted EXISTS bypass deriveDisposition — confirmed, see report`);
  console.log(`   M5 agreed-under-new rows with \`when\`: ${whenRows.length}`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
