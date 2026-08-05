// HO 601 §4 — falsification, three legs. This one WRITES (leg 1 is a real run).
//
// Leg 1  the payoff: a real run writes 10 rows to senate-SC-2026-special-R
//        matching the published Aug 11 field by name. Not a dry run.
// Leg 2  the freeze, fired deliberately: senate-SC-2026-R must be byte-identical
//        to its before-image AND the branch that produced that must be named —
//        isSettled consulted and refused, versus never reached. A green diff on
//        its own is NOT the proof (HO 600 showed this row survives for reasons
//        that have nothing to do with the guard).
// Leg 3  FL/OH regression: fingerprint before and after, unchanged.
//
// Fingerprints compare CONTENT (name|party|status|vote_pct), not updated_at — a
// re-write with identical content is a pass, and updated_at moving is how you
// tell a rewrite from a skip. Both are reported.
//
//   npx tsx scripts/diagnostic/special-router-falsify-601.ts
import "dotenv/config";
import { getDb } from "../../lib/db";
import {
  runSpecialPriorityPass,
  syncSenateCandidates,
} from "../../lib/primaries-sync";

const db = getDb();

// The published Aug 11 Republican field (HO 600 M4, read off Ballotpedia).
const EXPECTED_SC_AUG = [
  "Darline Graham",
  "Duke Buckner",
  "Danny Ford",
  "Russell Fry",
  "Mark Lynch",
  "Mark McBride",
  "Ralph Norman",
  "Glenda Gail Parker",
  "Mark Sanford",
  "Sam Shepherd",
];

const WATCHED = [
  "senate-SC-2026-special-R",
  "senate-SC-2026-R",
  "senate-SC-2026-D",
  "senate-FL-2026-D",
  "senate-FL-2026-R",
  "senate-OH-2026-D",
  "senate-OH-2026-R",
];

type Print = { n: number; content: string; updated: string };

function hr(t: string) {
  console.log(`\n${"=".repeat(74)}\n${t}\n${"=".repeat(74)}`);
}

async function fingerprint(id: string): Promise<Print> {
  const rs = await db.execute({
    sql: `SELECT name, party, status, vote_pct, updated_at
            FROM primary_candidates WHERE primary_id = ? ORDER BY name`,
    args: [id],
  });
  return {
    n: rs.rows.length,
    content: rs.rows
      .map(
        (r) =>
          `${String(r.name)}|${String(r.party)}|${String(r.status)}|${String(r.vote_pct)}`,
      )
      .join(" ;; "),
    updated: rs.rows.map((r) => String(r.updated_at)).join(","),
  };
}

async function snapshot(): Promise<Map<string, Print>> {
  const m = new Map<string, Print>();
  for (const id of WATCHED) m.set(id, await fingerprint(id));
  return m;
}

function diff(before: Map<string, Print>, after: Map<string, Print>, ids: string[]) {
  for (const id of ids) {
    const b = before.get(id)!;
    const a = after.get(id)!;
    const contentSame = b.content === a.content;
    const updatedSame = b.updated === a.updated;
    console.log(
      `    ${id.padEnd(26)} rows ${b.n}->${a.n}  content=${
        contentSame ? "IDENTICAL" : "CHANGED"
      }  updated_at=${updatedSame ? "untouched (skipped)" : "moved (rewritten)"}`,
    );
    if (!contentSame) {
      console.log(`        before: ${b.content || "(empty)"}`);
      console.log(`        after:  ${a.content || "(empty)"}`);
    }
  }
}

async function main() {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  console.log(`HO 601 §4 falsification — ${now}\n`);

  const before = await snapshot();
  console.log("BEFORE:");
  for (const id of WATCHED) {
    const p = before.get(id)!;
    console.log(`    ${id.padEnd(26)} ${p.n} row(s)  ${p.content.slice(0, 90) || "(empty)"}`);
  }

  // ---------------------------------------------------------------- LEG 1 ---
  hr("LEG 1 — the payoff: runSpecialPriorityPass writes the Aug 11 field");
  const pri = await runSpecialPriorityPass(db, now, today);
  console.log(`\n  attemptedIds:    ${JSON.stringify(pri.attemptedIds)}`);
  console.log(`  populatedIds:    ${JSON.stringify(pri.populatedIds)}`);
  console.log(`  fetchFailures:   ${JSON.stringify(pri.fetchFailures)}`);
  console.log(`  settledSkipped:  ${JSON.stringify(pri.settledSkipped)}`);
  console.log(`  sources:         ${JSON.stringify(pri.sources, null, 2)}`);

  const afterLeg1 = await fingerprint("senate-SC-2026-special-R");
  const got = (
    await db.execute({
      sql: `SELECT name, party, status, vote_pct FROM primary_candidates
             WHERE primary_id = 'senate-SC-2026-special-R' ORDER BY name`,
      args: [],
    })
  ).rows.map((r) => String(r.name));

  console.log(`\n  senate-SC-2026-special-R now holds ${afterLeg1.n} row(s):`);
  for (const n of got) console.log(`      ${n}`);

  const missing = EXPECTED_SC_AUG.filter((e) => !got.includes(e));
  const extra = got.filter((g) => !EXPECTED_SC_AUG.includes(g));
  console.log(
    `\n  vs the published field (${EXPECTED_SC_AUG.length} names):` +
      `\n    missing: ${missing.length ? missing.join(", ") : "none"}` +
      `\n    extra:   ${extra.length ? extra.join(", ") : "none"}` +
      `\n  LEG 1: ${
        afterLeg1.n === 10 && missing.length === 0 && extra.length === 0
          ? "PASS"
          : "FAIL"
      }`,
  );

  // ---------------------------------------------------------------- LEG 2 ---
  hr("LEG 2 — the freeze, fired deliberately (standard pass over SC)");
  console.log(
    `\n  Running syncSenateCandidates(["SC"]) — the CURSOR pass. Its input is the\n` +
      `  regular SC page, which now carries the June D/R boxes AND the Aug 11\n` +
      `  special box. This is the substitution scenario HO 560 was built for.\n`,
  );
  const scSummary = await syncSenateCandidates(["SC"]);
  console.log(`  okStates:             ${scSummary.okStates}`);
  console.log(`  totalCandidates:      ${scSummary.totalCandidates}`);
  console.log(`  failures:             ${JSON.stringify(scSummary.failures)}`);
  console.log(`  fetchFailures:        ${JSON.stringify(scSummary.fetchFailures)}`);
  console.log(`  settledSkipped:       ${JSON.stringify(scSummary.settledSkipped)}`);
  console.log(
    `  rosterDeletesRefused: ${JSON.stringify(scSummary.rosterDeletesRefused)}`,
  );

  const afterLeg2 = await snapshot();
  console.log(`\n  SC rows before -> after:`);
  diff(before, afterLeg2, [
    "senate-SC-2026-R",
    "senate-SC-2026-D",
    "senate-SC-2026-special-R",
  ]);

  // WHICH BRANCH — this is the part the handoff insists on. A green diff alone
  // proves nothing; name the mechanism that produced it.
  const settledFired = scSummary.settledSkipped.includes("senate-SC-2026-R");
  const refusedFired = scSummary.rosterDeletesRefused.includes("senate-SC-2026-R");
  console.log(
    `\n  BRANCH TAKEN for senate-SC-2026-R:` +
      `\n    isSettled consulted and REFUSED:      ${settledFired}` +
      `\n    empty-roster delete refused (HO 564): ${refusedFired}` +
      `\n    neither (never reached):              ${!settledFired && !refusedFired}`,
  );
  const b = before.get("senate-SC-2026-R")!;
  const a2 = afterLeg2.get("senate-SC-2026-R")!;
  console.log(
    `  LEG 2: ${
      b.content === a2.content && b.updated === a2.updated && settledFired
        ? "PASS — row byte-identical AND the freeze is the named cause"
        : b.content === a2.content
          ? "PASS on the diff, but read the branch above before calling the freeze proven"
          : "FAIL — the settled row changed"
    }`,
  );

  // ---------------------------------------------------------------- LEG 3 ---
  hr("LEG 3 — FL/OH regression (the states the router must not touch)");
  const flohSummary = await syncSenateCandidates(["FL", "OH"]);
  console.log(`\n  okStates:             ${flohSummary.okStates}`);
  console.log(`  totalCandidates:      ${flohSummary.totalCandidates}`);
  console.log(`  failures:             ${JSON.stringify(flohSummary.failures)}`);
  console.log(`  settledSkipped:       ${JSON.stringify(flohSummary.settledSkipped)}`);
  console.log(
    `  rosterDeletesRefused: ${JSON.stringify(flohSummary.rosterDeletesRefused)}`,
  );

  const afterLeg3 = await snapshot();
  console.log(`\n  FL/OH rows before -> after:`);
  const flohIds = [
    "senate-FL-2026-D",
    "senate-FL-2026-R",
    "senate-OH-2026-D",
    "senate-OH-2026-R",
  ];
  diff(before, afterLeg3, flohIds);
  const flohOk = flohIds.every(
    (id) => before.get(id)!.content === afterLeg3.get(id)!.content,
  );
  console.log(
    `\n  no -special- row was created for FL/OH: ${
      (
        await db.execute({
          sql: `SELECT COUNT(*) AS n FROM primaries
                 WHERE id LIKE 'senate-FL-2026-special-%'
                    OR id LIKE 'senate-OH-2026-special-%'`,
          args: [],
        })
      ).rows[0]!.n
    } (must be 0)`,
  );
  console.log(`  LEG 3: ${flohOk ? "PASS — content identical" : "FAIL"}`);

  // Standing guard (HO 600 §4 C3).
  const dGuard = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM primaries WHERE id = 'senate-SC-2026-special-D'`,
    args: [],
  });
  hr("STANDING GUARD");
  console.log(
    `  senate-SC-2026-special-D rows: ${dGuard.rows[0]!.n} (must be 0)\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
