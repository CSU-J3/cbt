// HO 239 synthetic-path test for the stage-monotonicity guard. Pure (no DB):
// drives the decideStage logic through every path — advance / reject / pend /
// confirm / noop — and the two-tick downgrade narrative end to end. Prints each
// decision and exits non-zero on any mismatch. Run: npx tsx scripts/diagnostic/stage-guard-239.ts
import { decideStage, type StageDecision } from "../../lib/summarize-runner";

type Case = {
  name: string;
  current: string | null;
  proposed: string;
  pending: string | null;
  expect: StageDecision;
};

const cases: Case[] = [
  // forward / equal / first-observation
  { name: "forward committee→floor", current: "committee", proposed: "floor", pending: null, expect: "advance" },
  { name: "no change (stable)", current: "floor", proposed: "floor", pending: null, expect: "noop" },
  { name: "first-obs past introduced", current: null, proposed: "enacted", pending: null, expect: "advance" },
  { name: "first-obs at introduced", current: null, proposed: "introduced", pending: null, expect: "noop" },
  // hard reject — the hr-8467 case (committee→introduced) and floor→introduced
  { name: "impossible committee→introduced (hr-8467)", current: "committee", proposed: "introduced", pending: null, expect: "reject" },
  { name: "impossible floor→introduced", current: "floor", proposed: "introduced", pending: null, expect: "reject" },
  // legitimate-looking downgrade: pend first, confirm on repeat
  { name: "downgrade floor→committee, first sight", current: "floor", proposed: "committee", pending: null, expect: "pend" },
  { name: "downgrade floor→committee, confirmed", current: "floor", proposed: "committee", pending: "committee", expect: "advance" },
  // flicker resolves back to current with a pending on record → noop (clears it)
  { name: "flicker resolves to current", current: "floor", proposed: "floor", pending: "committee", expect: "noop" },
  // a different downgrade than what's pending → re-pend the new one
  { name: "different downgrade replaces pending", current: "other_chamber", proposed: "committee", pending: "floor", expect: "pend" },
];

let failures = 0;
console.log("=== HO 239 stage-guard decision table ===");
for (const c of cases) {
  const got = decideStage(c.current, c.proposed, c.pending);
  const ok = got === c.expect;
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${String(c.current).padEnd(13)} →${String(c.proposed).padEnd(13)} pend=${String(c.pending).padEnd(10)} => ${got}${ok ? "" : `  (expected ${c.expect})`}  | ${c.name}`,
  );
}

// Two-tick narrative: a genuine recommit floor→committee, classified twice.
console.log("\n=== two-tick downgrade narrative (floor→committee) ===");
let pending: string | null = null;
const tick1 = decideStage("floor", "committee", pending);
console.log(`tick 1: decision=${tick1}  (records pending=committee, slot stays floor)`);
if (tick1 === "pend") pending = "committee";
const tick2 = decideStage("floor", "committee", pending);
console.log(`tick 2: decision=${tick2}  (same proposal → slot moves to committee, pending cleared)`);
if (tick1 !== "pend" || tick2 !== "advance") {
  failures++;
  console.log("FAIL: two-tick confirmation did not pend-then-advance");
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
