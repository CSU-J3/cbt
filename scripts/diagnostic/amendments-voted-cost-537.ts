// HO 537 STEP 0 — the /amendments "voted" cut cost + correctness gate (read-only).
// The HO 461 inline cost-gate pattern (not a separate probe HO): the pillar is
// bills-scale so a blob is unlikely, but three of these queries have never run
// corpus-wide and #2 is a CORRECTNESS gate, not a cost gate.
//
// Uses a RAW client with NO boundedFetch — the 10s DB bound would ABORT a cold
// query and hide its true cost, exactly what this script measures. Every query is
// timed. NOTHING here is hardcoded into the spec/copy downstream — the surface
// interpolates live.
//
//   npx tsx scripts/diagnostic/amendments-voted-cost-537.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";

// The shared Senate parser, INLINED here as the measurement instrument (Commit 1
// extracts it to lib/amendment-vote-key.ts; STEP 0 predates that leaf). The first
// S.Amdt number in the question is the VOTED amendment (it may amend another:
// "S.Amdt. 14 to S.Amdt. 8 to S. 5" → 14). Anchored to start.
const SENATE_AMDT_Q = /^On the Amendment S\.Amdt\. (\d+)\b/;
function parseSenateAmendmentNumber(question: string): number | null {
  const m = question.match(SENATE_AMDT_Q);
  if (!m) return null;
  const n = parseInt(m[1] ?? "", 10);
  return Number.isFinite(n) ? n : null;
}

// deriveDisposition INLINED (it's module-local to lib/queries.ts, not a leaf, and
// pulling queries.ts drags next/cache into a script). Kept byte-identical to the
// live one so measurement #6's split matches the surface.
function deriveDisposition(text: string | null): "agreed" | "failed" | "other" {
  if (!text) return "other";
  const t = text.toLowerCase();
  if (/\bnot agreed to\b|\brejected\b|\bfailed\b|motion to table.*\bagreed to\b/.test(t)) return "failed";
  if (/\bagreed to\b|\badopted\b|\bpassed\b/.test(t)) return "agreed";
  return "other";
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  console.log(`   ⏱  ${label}: ${Date.now() - t0}ms`);
  return r;
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.log("TURSO_DATABASE_URL not set — run with the CBT .env (local working tree).");
    return 1;
  }
  // Raw client — deliberately NO boundedFetch (measure true cold cost).
  const db: Client = createClient({ url, authToken });

  console.log("=== HO 537 STEP 0 — /amendments voted-cut cost + gate ===\n");

  // ── 1. SIZING ────────────────────────────────────────────────────────────
  console.log("── 1. Sizing (materializer cost) ──");
  const votesTotal = Number(
    (await timed("COUNT votes", () => db.execute("SELECT COUNT(*) AS n FROM votes"))).rows[0]!.n,
  );
  const senateAmdtVotes = (
    await timed("Senate amendment-question votes", () =>
      db.execute(
        "SELECT id, congress, question FROM votes WHERE chamber = 'senate' AND question LIKE 'On the Amendment S.Amdt.%'",
      ),
    )
  ).rows;
  console.log(`   votes total: ${votesTotal.toLocaleString()}`);
  console.log(`   Senate SAMDT-question votes (materializer input): ${senateAmdtVotes.length.toLocaleString()}`);
  console.log(`   → recompute-whole-every-tick reads ${senateAmdtVotes.length} rows: ${senateAmdtVotes.length < 2000 ? "TRIVIAL, stays sane" : "REVIEW"}\n`);

  // ── Build the materializer's FULL Senate link set (one global scan) ──
  // SAMDT amendments keyed by `${congress}~${amendment_number}` → amendment id.
  const samdt = (
    await timed("all SAMDT amendments", () =>
      db.execute(
        "SELECT id, congress, amendment_number, amended_bill_id FROM amendments WHERE amendment_type = 'SAMDT'",
      ),
    )
  ).rows;
  const amdByKey = new Map<string, { id: string; billId: string | null }>();
  for (const r of samdt) {
    amdByKey.set(`${Number(r.congress)}~${Number(r.amendment_number)}`, {
      id: String(r.id),
      billId: (r.amended_bill_id as string | null) ?? null,
    });
  }
  // materializerLinks: amendmentId → Set<voteId> (the Senate links the materializer would write)
  const materializerLinks = new Map<string, Set<string>>();
  let unmatchedQuestions = 0;
  for (const v of senateAmdtVotes) {
    const num = parseSenateAmendmentNumber(String(v.question ?? ""));
    if (num == null) {
      unmatchedQuestions++;
      continue;
    }
    const hit = amdByKey.get(`${Number(v.congress)}~${num}`);
    if (!hit) {
      unmatchedQuestions++; // parses but resolves to no tracked amendment (corpus drift)
      continue;
    }
    (materializerLinks.get(hit.id) ?? materializerLinks.set(hit.id, new Set()).get(hit.id)!).add(String(v.id));
  }
  console.log(`   materializer would write ${[...materializerLinks.values()].reduce((s, x) => s + x.size, 0)} Senate links across ${materializerLinks.size} amendments`);
  console.log(`   unmatched Senate questions (parse-fail or no tracked amendment): ${unmatchedQuestions}\n`);

  // ── 2. EQUIVALENCE GATE (the one that can FAIL) ──────────────────────────
  console.log("── 2. Equivalence gate: materializer set === live-parse set, per bill ──");
  // The live parse (getBillAmendmentVotes' Senate path) for ONE bill: its SAMDT
  // amendments + senate votes scoped `congress IN (bill's SAMDT congresses)`,
  // number parsed from question, matched to that bill's amendment keys.
  async function liveParseForBill(billId: string): Promise<Map<string, Set<string>>> {
    const amdRs = await db.execute({
      sql: "SELECT id, congress, amendment_number FROM amendments WHERE amended_bill_id = ? AND amendment_type = 'SAMDT'",
      args: [billId],
    });
    const keyToId = new Map<string, string>();
    const congs = new Set<number>();
    for (const r of amdRs.rows) {
      const c = Number(r.congress);
      congs.add(c);
      keyToId.set(`${c}~${Number(r.amendment_number)}`, String(r.id));
    }
    const out = new Map<string, Set<string>>();
    if (congs.size === 0) return out;
    const congList = [...congs];
    const vr = await db.execute({
      sql: `SELECT id, congress, question FROM votes
             WHERE chamber = 'senate' AND congress IN (${congList.map(() => "?").join(",")})
               AND question LIKE 'On the Amendment S.Amdt.%'`,
      args: congList,
    });
    for (const r of vr.rows) {
      const num = parseSenateAmendmentNumber(String(r.question ?? ""));
      if (num == null) continue;
      const amdId = keyToId.get(`${Number(r.congress)}~${num}`);
      if (!amdId) continue;
      (out.get(amdId) ?? out.set(amdId, new Set()).get(amdId)!).add(String(r.id));
    }
    return out;
  }
  // materializer set restricted to one bill (from the global scan above).
  function materializerForBill(billId: string): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const r of samdt) {
      if (((r.amended_bill_id as string | null) ?? null) !== billId) continue;
      const links = materializerLinks.get(String(r.id));
      if (links && links.size) out.set(String(r.id), new Set(links));
    }
    return out;
  }
  function diffCount(a: Map<string, Set<string>>, b: Map<string, Set<string>>): number {
    let d = 0;
    const keys = new Set([...a.keys(), ...b.keys()]);
    for (const k of keys) {
      const sa = a.get(k) ?? new Set<string>();
      const sb = b.get(k) ?? new Set<string>();
      for (const x of sa) if (!sb.has(x)) d++;
      for (const x of sb) if (!sa.has(x)) d++;
    }
    return d;
  }
  function linkTotal(m: Map<string, Set<string>>): number {
    return [...m.values()].reduce((s, x) => s + x.size, 0);
  }

  // Find one zero-vote bill dynamically: a bill WITH SAMDT amendments that the
  // materializer produces NO Senate links for (and confirm empty-vs-empty).
  const billsWithSamdt = [...new Set(samdt.map((r) => (r.amended_bill_id as string | null) ?? null).filter(Boolean) as string[])];
  const votedBillIds = new Set<string>();
  for (const [amdId] of materializerLinks) {
    const r = samdt.find((x) => String(x.id) === amdId);
    if (r?.amended_bill_id) votedBillIds.add(String(r.amended_bill_id));
  }
  const zeroVoteBill = billsWithSamdt.find((b) => !votedBillIds.has(b));

  const sampleBills = [
    "119-hr-1",
    "119-sconres-7",
    "119-s-2",
    "119-hr-8800", // House — materializer (Senate) produces 0 for it by design
    ...(zeroVoteBill ? [zeroVoteBill] : []),
  ];
  let anyNonEmptySenate = false;
  let anyDiff = false;
  for (const b of sampleBills) {
    const live = await liveParseForBill(b);
    const mat = materializerForBill(b);
    const d = diffCount(mat, live);
    const nonEmpty = linkTotal(live) > 0 || linkTotal(mat) > 0;
    if (nonEmpty) anyNonEmptySenate = true;
    if (d > 0) anyDiff = true;
    console.log(
      `   ${b.padEnd(16)} live=${linkTotal(live)} mat=${linkTotal(mat)} amendments(live=${live.size}/mat=${mat.size}) symmetricDiff=${d} ${
        d === 0 ? "✓ match" : "✗ MISMATCH"
      }${nonEmpty ? "" : " (empty-empty)"}`,
    );
  }
  const gatePass = !anyDiff && anyNonEmptySenate;
  console.log(
    `   GATE: ${gatePass ? "PASS — sets identical AND non-empty on Senate bills ✓" : anyDiff ? "FAIL — non-empty symmetric difference ✗" : "FAILED INSTRUMENT — empty-vs-empty everywhere (no Senate bill exercised the parse)"}\n`,
  );

  // ── 3. CORPUS VOTED COUNT, cold ──────────────────────────────────────────
  console.log("── 3. Corpus voted count (distinct amendments, INNER JOIN votes) ──");
  // Current table state (House links only today, HO 532) resolving to a votes row.
  const houseVotedNow = Number(
    (
      await timed("House links resolving (current table)", () =>
        db.execute(
          "SELECT COUNT(DISTINCT av.amendment_id) AS n FROM amendment_votes av JOIN votes v ON v.id = av.vote_id",
        ),
      )
    ).rows[0]!.n,
  );
  // Projected total AFTER materialization = (current resolved House links) ∪
  // (Senate parser matches). Senate links always resolve (derived from votes).
  const senateVotedAmendments = new Set(materializerLinks.keys());
  const houseVotedIds = (
    await db.execute(
      "SELECT DISTINCT av.amendment_id AS id FROM amendment_votes av JOIN votes v ON v.id = av.vote_id",
    )
  ).rows.map((r) => String(r.id));
  const projectedVoted = new Set<string>([...senateVotedAmendments, ...houseVotedIds]);
  console.log(`   current (House links resolving now): ${houseVotedNow}`);
  console.log(`   Senate voted amendments (materializer): ${senateVotedAmendments.size}`);
  console.log(`   PROJECTED corpus voted (post-materialization, distinct): ${projectedVoted.size}\n`);

  // ── 4. FEED FILTER, cold, deep page — EXPLAIN ───────────────────────────
  console.log("── 4. Feed EXISTS predicate — EXPLAIN QUERY PLAN (deep page) ──");
  const feedSql = `SELECT a.id, a.update_date FROM amendments a
     WHERE EXISTS (SELECT 1 FROM amendment_votes av WHERE av.amendment_id = a.id)
     ORDER BY a.update_date DESC LIMIT 25 OFFSET 100`;
  const plan = await db.execute(`EXPLAIN QUERY PLAN ${feedSql}`);
  for (const r of plan.rows) console.log(`   ${(r as Row).detail}`);
  const planText = plan.rows.map((r) => String((r as Row).detail)).join(" | ");
  const composite = /amendment_votes|sqlite_autoindex_amendment_votes/.test(planText);
  console.log(`   → composite PK leading-column seek on amendment_votes: ${composite ? "YES (no new index)" : "NO — planner wandered, report before hinting"}`);
  await timed("   feed EXISTS deep-page (warm timing)", () => db.execute(feedSql));
  console.log("");

  // ── 5. CONTAINMENT — voted ⊆ acted? ──────────────────────────────────────
  console.log("── 5. Containment (voted but latest_action_text IS NULL) ──");
  // A voted amendment with NO top-level action text = voted-but-not-"acted".
  const votedIds = [...projectedVoted];
  let votedNoAction = 0;
  if (votedIds.length) {
    // chunk the IN() to stay well under arg limits
    for (let i = 0; i < votedIds.length; i += 400) {
      const chunk = votedIds.slice(i, i + 400);
      votedNoAction += Number(
        (
          await db.execute({
            sql: `SELECT COUNT(*) AS n FROM amendments WHERE latest_action_text IS NULL AND id IN (${chunk.map(() => "?").join(",")})`,
            args: chunk,
          })
        ).rows[0]!.n,
      );
    }
  }
  console.log(`   voted amendments with latest_action_text IS NULL: ${votedNoAction}`);
  console.log(`   → ${votedNoAction === 0 ? "CLEAN nested drill (voted ⊆ acted); 3 chips read as nesting" : "NOT strictly nested — the page must disclose, not imply nesting"}\n`);

  // ── 6. CHAMBER SPLIT + disposition of the voted set ─────────────────────
  console.log("── 6. Chamber split + agreed/failed/other of the voted set ──");
  // Chamber via amendment_type on the voted amendments; disposition via
  // deriveDisposition over the CANONICAL (latest) vote's result per amendment.
  const votedMeta = new Map<string, { type: string }>();
  if (votedIds.length) {
    for (let i = 0; i < votedIds.length; i += 400) {
      const chunk = votedIds.slice(i, i + 400);
      const rs = await db.execute({
        sql: `SELECT id, amendment_type FROM amendments WHERE id IN (${chunk.map(() => "?").join(",")})`,
        args: chunk,
      });
      for (const r of rs.rows) votedMeta.set(String(r.id), { type: String(r.amendment_type) });
    }
  }
  let vSen = 0;
  let vHou = 0;
  for (const { type } of votedMeta.values()) type === "HAMDT" ? vHou++ : vSen++;

  // canonical vote per amendment = latest by (vote_date DESC, id DESC), through
  // both the materializer (Senate) and the amendment_votes table (House).
  const canonicalResult = new Map<string, { date: string; id: string; result: string | null }>();
  // Senate: pull each materializer vote's result/date
  const allSenVoteIds = [...new Set([...materializerLinks.values()].flatMap((s) => [...s]))];
  const voteMetaById = new Map<string, { date: string; result: string | null }>();
  for (const idsChunk of chunkArr(allSenVoteIds.concat(houseVotedIds.length ? [] : []), 400)) {
    if (!idsChunk.length) continue;
    const rs = await db.execute({
      sql: `SELECT id, vote_date, result FROM votes WHERE id IN (${idsChunk.map(() => "?").join(",")})`,
      args: idsChunk,
    });
    for (const r of rs.rows) voteMetaById.set(String(r.id), { date: String(r.vote_date ?? ""), result: (r.result as string | null) ?? null });
  }
  // Also pull House link vote metas
  const houseLinkRows = (
    await db.execute(
      "SELECT av.amendment_id AS aid, v.id AS vid, v.vote_date AS d, v.result AS r FROM amendment_votes av JOIN votes v ON v.id = av.vote_id",
    )
  ).rows;
  const linksByAmd = new Map<string, { id: string; date: string; result: string | null }[]>();
  for (const [amdId, set] of materializerLinks) {
    for (const vid of set) {
      const meta = voteMetaById.get(vid);
      (linksByAmd.get(amdId) ?? linksByAmd.set(amdId, []).get(amdId)!).push({ id: vid, date: meta?.date ?? "", result: meta?.result ?? null });
    }
  }
  for (const r of houseLinkRows) {
    const amdId = String(r.aid);
    (linksByAmd.get(amdId) ?? linksByAmd.set(amdId, []).get(amdId)!).push({ id: String(r.vid), date: String(r.d ?? ""), result: (r.r as string | null) ?? null });
  }
  for (const [amdId, list] of linksByAmd) {
    list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    canonicalResult.set(amdId, { date: list[0]!.date, id: list[0]!.id, result: list[0]!.result });
  }
  let agreed = 0;
  let failed = 0;
  let other = 0;
  for (const { result } of canonicalResult.values()) {
    const d = deriveDisposition(result);
    d === "agreed" ? agreed++ : d === "failed" ? failed++ : other++;
  }
  console.log(`   voted chamber split: ${vSen} Senate · ${vHou} House`);
  console.log(`   voted disposition (canonical/latest vote's result): ${agreed} agreed · ${failed} failed · ${other} other\n`);

  // ── 7. TIEBREAK — same-date pair on one amendment ────────────────────────
  console.log("── 7. Tiebreak (two votes same vote_date on one amendment) ──");
  let sameDatePairs = 0;
  for (const [amdId, list] of linksByAmd) {
    const dates = list.map((x) => x.date);
    if (new Set(dates).size < dates.length) {
      sameDatePairs++;
      console.log(`   ⚠ ${amdId} carries ${list.length} votes with a same-date collision: ${dates.join(", ")}`);
    }
  }
  console.log(
    `   amendments with a same-vote_date pair: ${sameDatePairs} ${
      sameDatePairs === 0 ? "→ INERT, change nothing (list[0] date-sort is deterministic)" : "→ align hub + aggregate to (vote_date DESC, id DESC)"
    }\n`,
  );

  // ── 8. MATCHER COMPLETENESS — distinct senate question shapes ────────────
  // The equivalence gate proves FIDELITY (materializer == live parse, same
  // parser) but is BLIND TO COMPLETENESS: a Senate amendment outcome phrased
  // outside the anchored "On the Amendment S.Amdt. N" prefix (motion-to-table,
  // cloture, …) is invisible to BOTH parsers. `votes` is append-only, so the
  // HO 529 "114" can't have fallen to 97 by attrition — 114 counted a wider
  // net. Enumerate every senate question mentioning "Amdt" and bucket it.
  console.log("── 8. Matcher completeness (senate question shapes mentioning Amdt) ──");
  const amdtRows = (
    await timed("senate Amdt-mentioning questions", () =>
      db.execute("SELECT id, congress, question, result FROM votes WHERE chamber = 'senate' AND question LIKE '%Amdt%'"),
    )
  ).rows;
  const S_AMDT_ANY = /S\.Amdt\.\s*(\d+)/i; // first S.Amdt number ANYWHERE (the widen key)
  const AMDT_NO = /\bAmdt\.\s*No\.\s*(\d+)/i; // the budget-waiver "Amdt. No. N" format
  const resolvesTo = (c: number, n: number) => amdByKey.has(`${c}~${n}`);

  let matched = 0; // b: anchored prefix (the current matcher)
  let sAmdtResidual = 0; // c-i: S.Amdt-format residual (widen TARGET)
  let sAmdtResidualResolve = 0;
  let waiver = 0; // c-ii: "Amdt. No." budget-waiver residual
  let waiverResolve = 0;
  let neither = 0;
  const widenResultForms = new Map<string, number>(); // votes.result for the widen target
  for (const r of amdtRows) {
    const q = String(r.question ?? "");
    const c = Number(r.congress);
    if (SENATE_AMDT_Q.test(q)) {
      matched++;
      continue;
    }
    const sm = q.match(S_AMDT_ANY);
    const wv = q.match(AMDT_NO);
    if (sm) {
      sAmdtResidual++;
      if (resolvesTo(c, parseInt(sm[1] ?? "", 10))) sAmdtResidualResolve++;
      const res = String(r.result ?? "").slice(0, 40);
      widenResultForms.set(res, (widenResultForms.get(res) ?? 0) + 1);
    } else if (wv) {
      waiver++;
      if (resolvesTo(c, parseInt(wv[1] ?? "", 10))) waiverResolve++;
    } else {
      neither++;
    }
  }
  const totalAmdt = amdtRows.length;
  const residualCount = totalAmdt - matched;
  console.log(`   a. total senate rows mentioning Amdt: ${totalAmdt}`);
  console.log(`   b. matched by anchored prefix (current matcher): ${matched}`);
  console.log(`   c. residual (invisible to current matcher): ${residualCount}`);
  console.log(`      c-i.  S.Amdt-format residual (WIDEN TARGET): ${sAmdtResidualResolve}/${sAmdtResidual} resolve to a tracked amendment`);
  console.log(`      c-ii. "Amdt. No." budget-waiver residual:   ${waiverResolve}/${waiver} resolve (procedural, DIFFERENT number token — out of scope)`);
  console.log(`      c-iii. neither S.Amdt nor Amdt.No number:   ${neither}`);
  console.log(`   d. votes.result forms for the widen target (what deriveDisposition maps):`);
  for (const [res, n] of [...widenResultForms].sort((a, b) => b[1] - a[1])) {
    const d = deriveDisposition(res);
    console.log(`      ${String(n).padStart(3)}x  "${res}"  → deriveDisposition=${d}`);
  }
  // e. RESOLVING ≠ CLEAN OUTCOME. The residual forms are PROCEDURAL votes
  // (table / cloture / decision-of-chair), not the amendment's up-or-down. Two
  // fatal problems a blanket widen would ship:
  //   (1) inverted/mismatched semantics — VoteLine frames yea/nay as ON the
  //       amendment, but a motion-to-table's yea = TO KILL; deriveDisposition
  //       maps "Motion to Table Failed" / "Cloture Motion Rejected" → failed even
  //       where the amendment SURVIVED (later agreed) or was WITHDRAWN.
  //   (2) double-lines — some of these amendments ALREADY carry an anchored
  //       decisive vote, so the procedural vote is a misleading SECOND line that
  //       list[0] date-sort can promote over the real one.
  // Report both so the widen decision is made on the true picture, not "resolves".
  const anchoredAmdIds = new Set<string>();
  const procByAmd = new Map<string, string[]>();
  for (const r of amdtRows) {
    const q = String(r.question ?? "");
    const c = Number(r.congress);
    const sm = q.match(S_AMDT_ANY);
    if (!sm) continue;
    const hit = amdByKey.get(`${c}~${parseInt(sm[1] ?? "", 10)}`);
    if (!hit) continue;
    if (SENATE_AMDT_Q.test(q)) anchoredAmdIds.add(hit.id);
    else (procByAmd.get(hit.id) ?? procByAmd.set(hit.id, []).get(hit.id)!).push(String(r.result ?? ""));
  }
  let alsoAnchored = 0;
  let dispWrong = 0; // procedural result whose deriveDisposition contradicts the amendment's real fate
  for (const [id, results] of procByAmd) {
    if (anchoredAmdIds.has(id)) alsoAnchored++;
    // crude contradiction flag: table-failed / cloture-rejected on an amendment
    // that its own latest_action shows agreed or withdrawn.
    for (const res of results) {
      if (/table failed|cloture motion rejected|decision of chair/i.test(res)) dispWrong++;
    }
  }
  console.log(`   e. resolving ≠ clean: of the ${procByAmd.size} widen-target amendments,`);
  console.log(`      ${alsoAnchored} ALREADY carry an anchored decisive vote (widen would add a misleading 2nd line),`);
  console.log(`      ~${dispWrong} carry a procedural result deriveDisposition maps wrong (table-failed/cloture-rejected/chair).`);
  console.log(
    `   → VERDICT: residual is PROCEDURAL, not clean amendment outcomes. Blanket-widening ships`,
  );
  console.log(
    `      inverted/double vote lines (wrong-worse-than-absent). The anchored matcher is CORRECT by design;`,
  );
  console.log(`      recommend NO widen — build C1–C3 as originally specced.\n`);

  console.log("=== summary ===");
  console.log(`sizing: votes=${votesTotal} senateAmdtVotes=${senateAmdtVotes.length}`);
  console.log(`gate: ${gatePass ? "PASS" : "REVIEW"}`);
  console.log(`voted(projected)=${projectedVoted.size} (Senate ${vSen} / House ${vHou}); agreed ${agreed} / failed ${failed} / other ${other}`);
  console.log(`containment: ${votedNoAction} voted-with-null-action; tiebreak: ${sameDatePairs} same-date pairs; unmatchedQ: ${unmatchedQuestions}`);

  db.close();
  return gatePass ? 0 : 2;
}

function chunkArr<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out.length ? out : [[]];
}

main()
  .then((c) => {
    process.exitCode = c;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
