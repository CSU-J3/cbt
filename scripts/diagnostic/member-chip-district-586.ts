// HO 586 STEP 0 — the LA House member chip: read side of the proxy convention (READ-ONLY).
//
// HO 584 fixed the WRITE side (house-LA-{DD}-2026-open rows now 2026-11-03/12-12/jungle).
// The READ side never moved: getPrimaryForRace (queries.ts:1554) pins p.district IS NULL,
// so a LA House member's chip resolves to senate-LA-2026-{party} @ 2026-05-16 — the same
// member page shows two dates for one contest, live on prod. This measures the fix at the
// QUERY-AND-ARGS level before any build: no write path is involved and none is exercised.
//
// M1 the caller's real arg tuple · M2 the LA disagreement as data · M3 the full-corpus
// delta (THE GATE — any (c) non-null→null halts; (b) each justified individually, the
// HO 576 M3a 127-row lesson) · M4 coverage of the proposed district-first source.
//
// RESULTS (run 2026-08-01, prod Turso):
//   M1 — caller (page.tsx:229) hardcodes district=null for EVERY member and only calls
//        for party D/R. member.district IS available at the call site (Scalise LA-1 = 1),
//        so the caller must pass it: the fix is NOT confined to queries.ts.
//   M2 — all 6 LA House members' chips read senate-LA-2026-{party} @ 2026-05-16 while
//        their own house-LA-{DD}-2026-open row reads 2026-11-03 (jungle). Disagreement real.
//   M3 — GATE CLEAR. 534 members computed; unchanged 110; house changed 424, senate 0.
//        (a) null→non-null = 160 (clean fills: no-2026-Senate-seat + top-two `open` states —
//            this is the HO 576 carry-forward class, closed as a side effect).
//        (b) non-null→different DATE = 6 — EXACTLY the 6 LA House members, each the defect
//            this HO exists to fix (May-16 senate proxy → Nov-3 own row). No non-LA (b).
//        non-null→same-date/diff-row = 258 (chip moves to the member's own district row on a
//            shared date — invisible to the user, structurally more correct).
//        (c) non-null→NULL = 0 (no regression). SENATE changed = 0 (path byte-identical).
//   M4 — house-*-2026 dated rows exist for all 50 states; only the 6 non-voting territories
//        (AS DC GU MP PR VI) find no dated house row → keep the senate proxy (correct fallback).
//   M5 — ROSTER DELTA (owed before C1; the chip renders a roster, M3 saw only dates). 424 changed:
//        253 grew/equal · 134 shrank (district < statewide, expected) · 18 null→dated-empty (benign)
//        · 0 date-moved-empty · 19 SAME-DATE roster-vanish (new==0 & old>0), ALL PAST.
//        Characterized: the 19 are the incumbents sitting in a broader PRE-EXISTING condition —
//        77 of 560 past-dated house rows carry 0 candidates (~14%), NOT 586-created. Of the 19:
//        11 have the OTHER party's house row populated (uncontested incumbent primary → honestly
//        no votebox for the member's party); 8 are both-party empty (district coverage hole). The
//        senate roster the chip shows TODAY for these is the SENATE contest's candidates — wrong
//        contest — so "populated → empty" is "wrong-roster → honest-empty," not a correctness loss.
//   DECISIVE — the consumer renders DATE ONLY. app/members/[bioguideId]/page.tsx:356-372 renders
//        `Primary {D?Dem:Rep}: <date> (Nd)` — it NEVER renders the candidate roster. So the M5
//        roster-vanish is INVISIBLE on the sole getPrimaryForRace consumer; the halt class has no
//        user-visible manifestation. The 77-row empty-past-house-roster condition is real data debt
//        (also on /primaries + /electoral, independent of 586) → backlog, not a 586 blocker.
//   NEW BUILD REQ (render, not in the handoff C1): the label `party==='D'?'Dem':'Rep'` reads the
//        RESOLVED ROW's party, so an `open`/jungle row renders "Primary Rep:" — wrong for D members
//        in open-primary states (LA Carter/Fields; CA/WA Dems among the 160 (a) fills). C1 must
//        handle `open` in the render (drop the party word / all-party), not only in the query.
//   VERDICT: M3 gate clear; M5 halt-class is pre-existing + invisible (date-only render) → SHIP THE
//        GENERAL QUERY (C1) + the caller district pass + the open-label render fix; the 160 (a)
//        fills close the "senate-proxy can't serve top-two/no-Senate-seat" carry-forward as a side
//        effect; file the 77-row empty-past-house-roster as data debt. HALT for confirmation.
import "dotenv/config";
import { getDb } from "@/lib/db";

const WRITE = /\b(insert|update|delete|create|drop|alter|replace|vacuum|reindex)\b/i;
function ro(sql: string): string {
  if (WRITE.test(sql)) throw new Error(`read-only guard tripped: ${sql.slice(0, 70)}`);
  return sql;
}
const TODAY = new Date().toISOString().slice(0, 10);
function hr() {
  console.log("─".repeat(72));
}

type Chip = { id: string; primary_date: string | null } | null;

const db = getDb();

// The SHIPPED getPrimaryForRace (queries.ts:1554), reduced to id + date. Statewide
// pin (district IS NULL), party-keyed, NOT_SPECIAL_UNLESS_SENATE, future-first order.
async function shippedChip(
  state: string,
  party: string,
  memberChamber: "house" | "senate",
): Promise<Chip> {
  const rs = await db.execute({
    sql: ro(`SELECT p.id, p.primary_date
             FROM primaries p
             WHERE p.state = ? AND p.party = ? AND p.district IS NULL
               AND p.election_round = 'primary'
               AND (? = 'senate' OR p.id NOT LIKE '%-special-%')
             ORDER BY (CASE WHEN p.primary_date >= ? THEN 0 ELSE 1 END),
                      (CASE WHEN p.primary_date >= ? THEN p.primary_date END) ASC,
                      p.primary_date DESC
             LIMIT 1`),
    args: [state, party, memberChamber, TODAY, TODAY],
  });
  const r = rs.rows[0] as Record<string, unknown> | undefined;
  return r ? { id: r.id as string, primary_date: (r.primary_date as string) ?? null } : null;
}

// The PROPOSED district-first resolution (C1 shape, not yet built). For a House member
// with a real district: prefer the member's OWN house-{ST}-{DD}-2026-* row, matching
// p.party = ? OR p.party = 'open' (all-party contests). Fall back to the senate proxy
// only when no district row is found. Senate path is byte-identical to shipped.
async function proposedChip(
  state: string,
  districtInt: number | null,
  party: string,
  memberChamber: "house" | "senate",
): Promise<Chip> {
  if (memberChamber === "house") {
    // MIRRORS getPrimaryForRace: at-large (members.district=NULL) → "00" (HO 586 M6).
    const dd = districtInt == null ? "00" : String(districtInt).padStart(2, "0");
    const rs = await db.execute({
      sql: ro(`SELECT p.id, p.primary_date
               FROM primaries p
               WHERE p.state = ? AND p.chamber = 'house' AND p.district = ?
                 AND (p.party = ? OR p.party = 'open')
                 AND p.election_round = 'primary'
                 AND p.id NOT LIKE '%-special-%'
               -- MIRRORS getPrimaryForRace branch 1 EXACTLY (queries.ts): future-first
               -- PRIMARY, exact-party-over-'open' as the within-temporal-class tie-break.
               ORDER BY (CASE WHEN p.primary_date >= ? THEN 0 ELSE 1 END),
                        (CASE WHEN p.party = ? THEN 0 ELSE 1 END),
                        (CASE WHEN p.primary_date >= ? THEN p.primary_date END) ASC,
                        p.primary_date DESC
               LIMIT 1`),
      args: [state, dd, party, TODAY, party, TODAY],
    });
    const r = rs.rows[0] as Record<string, unknown> | undefined;
    if (r) return { id: r.id as string, primary_date: (r.primary_date as string) ?? null };
  }
  return shippedChip(state, party, memberChamber);
}

function fmt(c: Chip): string {
  return c ? `${c.id} @ ${JSON.stringify(c.primary_date)}` : "null";
}

async function main() {
  console.log("HO 586 STEP 0 — member-chip district resolution (READ-ONLY)\n");
  console.log(`today = ${TODAY}\n`);

  // ── M1 — what the call site actually passes ──────────────────────────────────
  hr();
  console.log("M1 — THE CALLER'S REAL ARG TUPLE (app/members/[bioguideId]/page.tsx:229)");
  console.log("  The caller builds: (member.state, null, member.party, chamber==='senate'?'senate':'house')");
  console.log("  — district is HARDCODED null for EVERY member, and it only calls when party is D or R.\n");
  for (const [label, pred] of [
    ["LA HOUSE sample", "chamber='house' AND state='LA'"],
    ["control SENATE sample", "chamber='senate'"],
  ] as const) {
    const m = (
      await db.execute(
        ro(`SELECT bioguide_id, name, state, district, party, chamber
            FROM members
            WHERE is_current=1 AND party IN ('D','R') AND ${pred}
            ORDER BY district IS NULL, district LIMIT 1`),
      )
    ).rows[0] as Record<string, unknown> | undefined;
    if (!m) {
      console.log(`  ${label}: none found`);
      continue;
    }
    const memberChamber = m.chamber === "senate" ? "senate" : "house";
    console.log(`  ${label}: ${m.name} (${m.bioguide_id}) state=${m.state} district=${JSON.stringify(m.district)} party=${m.party} chamber=${m.chamber}`);
    console.log(`    caller passes  → getPrimaryForRace(${JSON.stringify(m.state)}, null, ${JSON.stringify(m.party)}, ${JSON.stringify(memberChamber)})`);
    console.log(`    member.district AVAILABLE at call site = ${JSON.stringify(m.district)}  (proposed fix needs this passed, not null)`);
  }
  console.log("\n  FINDING: caller hardcodes district=null → the fix is NOT confined to queries.ts;");
  console.log("  the caller must supply member.district for House members (M1 confirms it is in scope there).");

  // ── M2 — confirm the disagreement on prod ────────────────────────────────────
  hr();
  console.log("M2 — THE LA DISAGREEMENT AS DATA (chip today vs the member's own House row)");
  const laHouse = (
    await db.execute(
      ro(`SELECT bioguide_id, name, state, district, party, chamber
          FROM members WHERE is_current=1 AND chamber='house' AND state='LA' AND party IN ('D','R')
          ORDER BY district`),
    )
  ).rows as Record<string, unknown>[];
  console.log(`  current LA House D/R members = ${laHouse.length}`);
  for (const m of laHouse.slice(0, 4)) {
    const mc = "house" as const;
    const chip = await shippedChip(m.state as string, m.party as string, mc);
    const dd = m.district != null ? String(m.district as number).padStart(2, "0") : "??";
    const own = (
      await db.execute({
        sql: ro(`SELECT id, primary_date, party, primary_type FROM primaries
                 WHERE state='LA' AND chamber='house' AND district=? AND election_round='primary'
                   AND id NOT LIKE '%-special-%' ORDER BY id`),
        args: [dd],
      })
    ).rows as Record<string, unknown>[];
    const ownStr = own.map((r) => `${r.id} @ ${JSON.stringify(r.primary_date)} (party=${r.party}, type=${JSON.stringify(r.primary_type)})`).join(" · ") || "NONE";
    console.log(`  ${(m.name as string).padEnd(22)} d=${dd} party=${m.party}`);
    console.log(`      chip today (shipped) = ${fmt(chip)}`);
    console.log(`      own House row(s)     = ${ownStr}`);
  }
  console.log("  → the chip date and the House-row date differ ⇒ two dates for one contest on one page.");

  // ── M3 — the full-corpus delta (THE GATE) ────────────────────────────────────
  hr();
  console.log("M3 — FULL-CORPUS DELTA (shipped chip vs proposed district-first) — THE GATE");
  const members = (
    await db.execute(
      ro(`SELECT bioguide_id, name, state, district, party, chamber
          FROM members
          WHERE is_current=1 AND party IN ('D','R') AND state IS NOT NULL AND state <> ''`),
    )
  ).rows as Record<string, unknown>[];
  console.log(`  members computed (D/R, state present — the caller's gate) = ${members.length}`);

  const catA: string[] = []; // null -> non-null
  const catB: string[] = []; // non-null -> different date
  const catBSameDate: string[] = []; // non-null -> different ROW, same date (invisible to a date diff)
  const catC: string[] = []; // non-null -> null  (REGRESSION)
  let unchanged = 0;
  let houseChanged = 0;
  let senateChanged = 0;

  for (const m of members) {
    const mc = m.chamber === "senate" ? "senate" : "house";
    const state = m.state as string;
    const party = m.party as string;
    const district = (m.district as number) ?? null;
    const before = await shippedChip(state, party, mc);
    const after = await proposedChip(state, district, party, mc);
    const bId = before?.id ?? null;
    const aId = after?.id ?? null;
    const bDate = before?.primary_date ?? null;
    const aDate = after?.primary_date ?? null;
    if (bId === aId && bDate === aDate) {
      unchanged++;
      continue;
    }
    if (mc === "house") houseChanged++;
    else senateChanged++;
    const line = `    ${(m.name as string).padEnd(24)} ${state}-${m.district ?? "—"} ${party} ${mc}  |  ${fmt(before)}  →  ${fmt(after)}`;
    if (before == null && after != null) catA.push(line);
    else if (before != null && after == null) catC.push(line);
    else if (bDate !== aDate) catB.push(line);
    else catBSameDate.push(line); // date same, row/id changed
  }

  console.log(`  unchanged = ${unchanged}  |  changed: house=${houseChanged} senate=${senateChanged}`);
  console.log(`  (a) null → non-null           : ${catA.length}`);
  console.log(`  (b) non-null → different DATE : ${catB.length}   ← each must be individually defensible`);
  console.log(`      non-null → same date, diff ROW : ${catBSameDate.length}   (id moved to the House row, date coincides)`);
  console.log(`  (c) non-null → null           : ${catC.length}   ← ANY non-zero HALTS THE BUILD`);
  console.log(`  SENATE changes (must be 0 — path is meant byte-identical) : ${senateChanged}`);

  const dump = (label: string, arr: string[]) => {
    if (arr.length === 0) return;
    console.log(`\n  ── ${label} (${arr.length}) ──`);
    for (const l of arr) console.log(l);
  };
  dump("(a) null → non-null", catA);
  dump("(b) non-null → DIFFERENT DATE", catB);
  dump("non-null → same date, different row", catBSameDate);
  dump("(c) non-null → NULL  [REGRESSION]", catC);

  console.log("\n  GATE VERDICT:");
  console.log(`    (c) count = ${catC.length} → ${catC.length === 0 ? "clear" : "HALT — build blocked"}`);
  console.log(`    senate changed = ${senateChanged} → ${senateChanged === 0 ? "clear" : "HALT — senate path moved"}`);
  console.log("    (b) rows above must each be justified as an improvement, not counted in aggregate (the 127-row lesson).");
  console.log("    Scope call: LA-only vs general is decided from the (b) list — if every (b) is LA (or clean fills), ship general.");

  // ── M4 — coverage of the proposed district-first source ──────────────────────
  hr();
  console.log("M4 — COVERAGE OF THE PROPOSED SOURCE (house-{ST}-{DD}-2026-* rows)");
  const houseRows = (
    await db.execute(
      ro(`SELECT state,
                 COUNT(*) AS rows,
                 SUM(CASE WHEN primary_date IS NOT NULL THEN 1 ELSE 0 END) AS dated,
                 GROUP_CONCAT(DISTINCT party) AS parties
          FROM primaries
          WHERE chamber='house' AND election_round='primary' AND id NOT LIKE '%-special-%'
          GROUP BY state ORDER BY state`),
    )
  ).rows as Record<string, unknown>[];
  const statesWithHouse = new Set(houseRows.map((r) => r.state as string));
  console.log(`  states with any house-*-2026 primary row = ${statesWithHouse.size}`);
  console.log("  state | rows | dated | parties");
  for (const r of houseRows) {
    console.log(`    ${String(r.state).padEnd(3)} | ${String(r.rows).padStart(4)} | ${String(r.dated).padStart(5)} | ${r.parties}`);
  }
  // states whose current House members' district lookup finds nothing (the fallback set)
  const houseStates = (
    await db.execute(
      ro(`SELECT DISTINCT state FROM members WHERE is_current=1 AND chamber='house' AND party IN ('D','R') AND state IS NOT NULL ORDER BY state`),
    )
  ).rows.map((r) => (r as Record<string, unknown>).state as string);
  const gap: string[] = [];
  for (const st of houseStates) {
    const dated = houseRows.find((r) => r.state === st && (r.dated as number) > 0);
    if (!dated) gap.push(st);
  }
  console.log(`\n  states where district-first finds NO dated house row → members keep the senate proxy (fallback, not a bug):`);
  console.log(`    ${gap.join(" ") || "(none)"}`);
  console.log("  (expect the HO 209 no-2026-Senate-seat / frozen-date gap states here.)");

  // ── M5 — roster delta on every CHANGED row (the chip renders a ROSTER, M3 saw only dates) ──
  hr();
  console.log("M5 — ROSTER DELTA on changed rows (candidate count old→new; the chip renders GROUP_CONCAT + seat incumbent)");
  const countCache = new Map<string, number>();
  async function roster(id: string | null): Promise<number> {
    if (id == null) return 0;
    const hit = countCache.get(id);
    if (hit != null) return hit;
    const rs = await db.execute({
      sql: ro(`SELECT COUNT(*) AS n FROM primary_candidates WHERE primary_id = ?`),
      args: [id],
    });
    const n = Number((rs.rows[0] as Record<string, unknown>).n ?? 0);
    countCache.set(id, n);
    return n;
  }
  const haltRegression: string[] = []; // new==0 & old>0 & SAME-DATE — the true regression (roster vanished, no date change to explain it)
  const laHonestEmpty: string[] = []; // new==0 & old>0 & date-moved — correct-date row whose contest hasn't qualified yet (HO 584 M4)
  const zeroWasNull: string[] = []; // new==0 & old==0 — null→dated-empty chip (benign; was no chip before)
  const shrank: string[] = []; // 0<new<old — district field smaller than statewide (verify it's that, not erasure)
  let grewOrEqual = 0;
  let changedTotal = 0;
  for (const m of members) {
    const mc = m.chamber === "senate" ? "senate" : "house";
    const state = m.state as string;
    const party = m.party as string;
    const district = (m.district as number) ?? null;
    const before = await shippedChip(state, party, mc);
    const after = await proposedChip(state, district, party, mc);
    if ((before?.id ?? null) === (after?.id ?? null)) continue; // row unchanged, roster unchanged
    changedTotal++;
    const oldN = await roster(before?.id ?? null);
    const newN = await roster(after?.id ?? null);
    const sameDate = (before?.primary_date ?? null) === (after?.primary_date ?? null);
    const newDate = after?.primary_date ?? null;
    const pastFuture = newDate == null ? "no-date" : newDate < TODAY ? "PAST" : "future";
    const line = `    ${(m.name as string).padEnd(24)} ${state}-${m.district ?? "—"} ${party}  ${sameDate ? "SAME-DATE" : "date-moved"}  ${before?.id ?? "null"}(${oldN}) → ${after?.id}(${newN}) [${pastFuture}]`;
    if (newN === 0 && oldN > 0 && sameDate) haltRegression.push(line);
    else if (newN === 0 && oldN > 0) laHonestEmpty.push(line);
    else if (newN === 0) zeroWasNull.push(line);
    else if (newN < oldN) shrank.push(line);
    else grewOrEqual++;
  }
  console.log(`  changed rows = ${changedTotal}`);
  console.log(`  new >= old / grew (aggregate fine)                       = ${grewOrEqual}`);
  console.log(`  0 < new < old (district < statewide — expected shrink)   = ${shrank.length}`);
  console.log(`  new==0 & old==0 (null → dated-empty chip, benign)        = ${zeroWasNull.length}`);
  console.log(`  new==0 & old>0 & DATE MOVED (honest empty, HO 584 M4)    = ${laHonestEmpty.length}`);
  console.log(`  new==0 & old>0 & SAME-DATE (roster vanished)             = ${haltRegression.length}   ← HALT CLASS (any PAST here = HO 563 erasure)`);
  dump("new==0 & old>0 & SAME-DATE — REGRESSION / erasure candidates", haltRegression);
  dump("new==0 & old>0 & date-moved — honest empty (verify all future)", laHonestEmpty);
  dump("0 < new < old — must read district-vs-statewide, not erasure", shrank.slice(0, 20));
  if (shrank.length > 20) console.log(`    … ${shrank.length - 20} more shrink rows omitted (all old>new>0)`);
  if (zeroWasNull.length) {
    console.log(`\n  ── null → dated-empty (benign) sample (${Math.min(8, zeroWasNull.length)} of ${zeroWasNull.length}) ──`);
    for (const l of zeroWasNull.slice(0, 8)) console.log(l);
  }
  console.log("\n  M5 VERDICT:");
  console.log(`    SAME-DATE roster-vanish = ${haltRegression.length} → ${haltRegression.length === 0 ? "clear" : "HALT — inspect each (PAST ⇒ HO 563 erasure, pre-existing, changes what ships)"}`);
  console.log("    C1 fallback fires ONLY on NO row found — never on a found-but-empty row — so any zero here stays measurable, not papered over.");

  // ── M6 — at-large padding contract (M3 is BLIND to a silent branch-1 miss) ──
  hr();
  console.log("M6 — AT-LARGE PADDING CONTRACT (padStart(2,'0') on members.district must match primaries.district)");
  console.log("  A silent branch-1 miss (member.district=0 vs primaries '01') falls to branch 2 and M3 records");
  console.log("  it as UNCHANGED — invisible to every date/roster gate. DE/ND/SD/VT/WY are partisan at-large");
  console.log("  (AK is at-large too but 'open', so it doesn't prove the partisan path).");
  let m6fallbacks = 0;
  for (const st of ["DE", "ND", "SD", "VT", "WY"]) {
    const m = (
      await db.execute({
        sql: ro(`SELECT bioguide_id, name, district, party FROM members
                 WHERE is_current=1 AND chamber='house' AND state=? AND party IN ('D','R')
                 ORDER BY district LIMIT 1`),
        args: [st],
      })
    ).rows[0] as Record<string, unknown> | undefined;
    if (!m) {
      console.log(`  ${st}: no current D/R at-large House member`);
      continue;
    }
    const dInt = (m.district as number) ?? null;
    const dd = dInt != null ? String(dInt).padStart(2, "0") : "(null)";
    const hrows = (
      await db.execute({
        sql: ro(`SELECT id, district, party, primary_date FROM primaries
                 WHERE state=? AND chamber='house' AND election_round='primary' AND id NOT LIKE '%-special-%'
                 ORDER BY id`),
        args: [st],
      })
    ).rows as Record<string, unknown>[];
    const hrowStr = hrows.map((r) => `${r.id}(district=${JSON.stringify(r.district)})`).join(" ") || "NONE";
    const resolved = await proposedChip(st, dInt, m.party as string, "house");
    const branch = resolved == null ? "2 → null" : resolved.id.startsWith("house-") ? "1 (district-first) ✓" : "2 (senate fallback)";
    if (!(resolved && resolved.id.startsWith("house-"))) m6fallbacks++;
    console.log(`  ${st}: ${m.name} member.district=${JSON.stringify(dInt)} → padded '${dd}'`);
    console.log(`       primaries house rows: ${hrowStr}`);
    console.log(`       branch fired = ${branch}  → ${resolved ? resolved.id : "null"}`);
  }
  console.log(`  M6 VERDICT: at-large branch-2 fallbacks = ${m6fallbacks} → ${m6fallbacks === 0 ? "clear (every state fires branch 1)" : "HALT — padding mismatch, fix the contract (do NOT special-case states)"}`);

  hr();
  console.log("\nHALT — STEP 0 complete. No build code until the halt clears (M3 gate decides LA-only vs general).");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
