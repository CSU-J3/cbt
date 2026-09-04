// HO 691 — falsification harness for the two pure decisions this HO added:
// `deriveMatchup`'s new `general` shape, and `classifyTarget`'s target status.
//
// NO DB. NO NETWORK. NO WRITES. Every input is constructed in this file, which
// is what lets it exercise cases the live set does not contain — and the live
// set not containing them is exactly why they need a harness rather than a
// screenshot.
//
// NAMED DEVIATION from the handoff, which specified this file for the `general`
// precedence legs (its STEP 2 leg 5) and put the classifier falsification (leg
// 4) in an unnamed scratch harness. Both are pure-function falsifications over
// constructed inputs with no DB write, so they are one instrument here rather
// than two; splitting them would have put half the falsification somewhere
// nothing re-runs.
//
// It renders the REAL PacSpendingLine through react-dom/server rather than
// re-stating its "does the glance survive" predicate. A harness that restates
// the rule it is checking passes whenever it is wrong in the same direction as
// the code.
//
//   npx tsx scripts/diagnostic/matchup-shapes-691.ts
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// tsx compiles the imported component's JSX with the CLASSIC runtime (tsconfig
// sets `jsx: "preserve"` for Next, so esbuild emits React.createElement calls
// with no automatic import). Nothing puts React in scope inside that module when
// it is loaded outside the Next build, so render-time it throws
// "React is not defined". Publishing it globally before the first render is the
// whole fix; it changes nothing about how the component behaves in the app.
(globalThis as { React?: typeof React }).React = React;
import { PacSpendingLine } from "@/components/PacSpendingLine";
import { type ContestRow, classifyTarget } from "@/lib/pac-target-status";
import { deriveMatchup } from "@/lib/race-matchup";
import type { PacIeRow, RaceCandidate, RaceIndexRow } from "@/lib/queries";

const TODAY = "2026-09-04";
let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`,
  );
}

// ── shape legs ───────────────────────────────────────────────────────────────
function row(overrides: Partial<RaceIndexRow> = {}): RaceIndexRow {
  return {
    raceId: "S-XX-2026",
    incumbentBioguideId: null,
    incumbentName: null,
    incumbentParty: null,
    incumbentRunning: null,
    kalshiOdds: null,
    polymarketOdds: null,
    ...overrides,
  } as unknown as RaceIndexRow;
}
function cand(name: string, party: string | null, status: string | null): RaceCandidate {
  return { name, party, status, bioguideId: null } as unknown as RaceCandidate;
}
// A candidate-named market favourite, the shape kalshi_odds/polymarket_odds give.
const favors = (label: string, party: string) => ({
  favoriteLabel: label,
  favoriteIsParty: false,
  favoriteParty: party,
  closeTime: null,
});

console.log("── deriveMatchup shapes\n");

// 1. Two cross-party nominees → general. The live S-MI-2026 case.
check(
  "two cross-party nominees → general",
  deriveMatchup(row({ kalshiOdds: favors("Abdul El-Sayed", "D") } as never), [
    cand("Abdul El-Sayed", "D", "won_primary"),
    cand("Mike Rogers", "R", "won_primary"),
  ]).challenger.kind,
  "general",
);

// 2. general suppresses the page footnote. presumptiveParty IS the footnote's
//    input (CompetitiveRacesStrip collects it), so this is the assertion that
//    "no dagger, no footnote" is structural rather than a render-side omission.
check(
  "general → presumptiveParty null (footnote cannot fire)",
  deriveMatchup(row({ kalshiOdds: favors("Abdul El-Sayed", "D") } as never), [
    cand("Abdul El-Sayed", "D", "won_primary"),
    cand("Mike Rogers", "R", "won_primary"),
  ]).presumptiveParty,
  null,
);

// 3. SAME-PARTY nominees still → general. A top-two seat (CA/WA) can send two
//    candidates of one party to November; testing for one-of-each would drop
//    this back to `leader` and re-dagger a decided contest.
check(
  "two SAME-party nominees → general (top-two seat)",
  deriveMatchup(row({ kalshiOdds: favors("Aisha Wahab", "D") } as never), [
    cand("Aisha Wahab", "D", "won_primary"),
    cand("Melissa Hernandez", "D", "won_primary"),
  ]).challenger.kind,
  "general",
);

// 4. One nominee + one still running → nominee. general must NOT swallow this.
check(
  "one nominee + one running → nominee",
  deriveMatchup(row({ kalshiOdds: favors("Abdul El-Sayed", "D") } as never), [
    cand("Abdul El-Sayed", "D", "won_primary"),
    cand("Haley Stevens", "D", "running"),
  ]).challenger.kind,
  "nominee",
);

// 5. Two running, same party, market favourite present → leader. UNCHANGED
//    behaviour — this is the regression leg, and its dagger is still correct
//    because that primary really is unresolved.
{
  const m = deriveMatchup(row({ kalshiOdds: favors("Haley Stevens", "D") } as never), [
    cand("Haley Stevens", "D", "running"),
    cand("Abdul El-Sayed", "D", "running"),
  ]);
  check("two running + favourite → leader (unchanged)", m.challenger.kind, "leader");
  check("leader still sets presumptiveParty (footnote still fires)", m.presumptiveParty, "D");
}

// ── classifier legs ──────────────────────────────────────────────────────────
console.log("\n── classifyTarget\n");

const MI: ContestRow[] = [
  { primaryId: "senate-MI-2026-D", primaryDate: "2026-08-04", runoffDate: null, round: "primary", name: "Abdul El-Sayed", status: "winner", votePct: 48.5 },
  { primaryId: "senate-MI-2026-D", primaryDate: "2026-08-04", runoffDate: null, round: "primary", name: "Haley Stevens", status: "running", votePct: 47.5 },
];

check("Stevens (resulted, not winner) → lost", classifyTarget("STEVENS, HALEY", MI, [], TODAY).status, "lost");
check("El-Sayed (winner) → active", classifyTarget("EL-SAYED, ABDUL", MI, [], TODAY).status, "active");
// The mangled name is the falsification: the classifier can no longer find the
// target, so it must fall to `unknown` rather than guess.
check("mangled name → unknown", classifyTarget("STVNS, HAYLEE", MI, [], TODAY).status, "unknown");
// A contest that has not been counted yet is not a contest somebody lost.
check(
  "past-dated but NO results posted → unknown",
  classifyTarget("STEVENS, HALEY", MI.map((c) => ({ ...c, votePct: null, status: "running" })), [], TODAY).status,
  "unknown",
);
check(
  "future-dated contest → unknown",
  classifyTarget("STEVENS, HALEY", MI.map((c) => ({ ...c, primaryDate: "2026-12-01" })), [], TODAY).status,
  "unknown",
);

// THE ROUND RULE. The live set has NO resulted runoff row for any PAC seat —
// the corpus holds 3 runoff rows total and none for Texas — so legs (a) and (b)
// exist only here. Leg (c) IS live: TX-23-2026.
console.log("\n  round rule (legs a/b constructed — the live set has no resulted runoff row):");
const TX_BASE: ContestRow[] = [
  { primaryId: "house-TX-23-2026-R", primaryDate: "2026-03-03", runoffDate: "2026-05-26", round: "primary", name: "Brandon Herrera", status: "winner", votePct: 43.3 },
  { primaryId: "house-TX-23-2026-R", primaryDate: "2026-03-03", runoffDate: "2026-05-26", round: "primary", name: "Tony Gonzales", status: "winner", votePct: 41.8 },
];
const runoff = (herreraWon: boolean): ContestRow[] => [
  ...TX_BASE,
  { primaryId: "house-TX-23-2026-R-runoff", primaryDate: "2026-05-26", runoffDate: null, round: "runoff", name: "Brandon Herrera", status: herreraWon ? "winner" : "running", votePct: herreraWon ? 55.0 : 45.0 },
  { primaryId: "house-TX-23-2026-R-runoff", primaryDate: "2026-05-26", runoffDate: null, round: "runoff", name: "Tony Gonzales", status: herreraWon ? "running" : "winner", votePct: herreraWon ? 45.0 : 55.0 },
];
check("(a) primary winner + won the runoff → active", classifyTarget("HERRERA, BRANDON", runoff(true), [], TODAY).status, "active");
check("(b) primary winner + LOST the runoff → lost", classifyTarget("HERRERA, BRANDON", runoff(false), [], TODAY).status, "lost");
check("(c) primary winner + runoff_date set, no runoff row → unknown [LIVE: TX-23]", classifyTarget("HERRERA, BRANDON", TX_BASE, [], TODAY).status, "unknown");

// The roster is consulted only where there is no contest evidence — otherwise a
// harvest sentinel (derived FROM primary_candidates.status='winner') would
// overrule the source it was copied from and silently undo leg (c).
check(
  "roster won_primary does NOT override contest evidence (leg c holds)",
  classifyTarget("HERRERA, BRANDON", TX_BASE, [{ name: "Brandon Herrera", status: "won_primary" }], TODAY).status,
  "unknown",
);
check(
  "roster nominee IS used when there is no contest row (convention route)",
  classifyTarget("JACKSON, TROY", [], [{ name: "Troy Jackson", status: "nominee" }], TODAY).status,
  "active",
);
check(
  "roster withdrew, no contest row → withdrew",
  classifyTarget("PLATNER, GRAHAM", [], [{ name: "Graham Platner", status: "withdrew" }], TODAY).status,
  "withdrew",
);

// ── the asymmetry, rendered ──────────────────────────────────────────────────
// This renders the REAL component. `unknown` must RENDER (present tense);
// `lost` alone must make the glance line ABSENT.
console.log("\n── the safety asymmetry, through the real PacSpendingLine\n");
function pacRow(name: string, so: "S" | "O", status: PacIeRow["targetStatus"]): PacIeRow {
  return {
    raceId: "S-MI-2026",
    committeeId: "C00799031",
    candidateId: `X${name}`,
    candidateName: name,
    supportOppose: so,
    earliestDate: "2026-06-09",
    targetStatus: status,
  };
}
const glance = (rows: PacIeRow[]) =>
  renderToStaticMarkup(createElement(PacSpendingLine, { rows, variant: "glance" as const }));

const unknownOnly = glance([pacRow("STEVENS, HALEY", "S", "unknown")]);
const lostOnly = glance([pacRow("STEVENS, HALEY", "S", "lost")]);
const mixed = glance([pacRow("STEVENS, HALEY", "S", "lost"), pacRow("EL-SAYED, ABDUL", "O", "active")]);

check("unknown target → glance RENDERS", unknownOnly.includes("backing Stevens"), true);
check("lost-only seat → glance ABSENT", lostOnly, "");
check("mixed seat → glance shows only the current direction", mixed.includes("opposing El-Sayed") && !mixed.includes("Stevens"), true);

console.log(
  "\n  What an INVERTED asymmetry would read here: `unknownOnly` would be \"\" —" +
    "\n  the line hidden on a seat we simply have no status for, silently discarding" +
    "\n  a stored FEC filing because a classifier could not place a name. That is why" +
    "\n  unknown renders and only a POSITIVE finding of `lost` removes anything.",
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
