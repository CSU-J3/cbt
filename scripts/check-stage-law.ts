// HO 830 — a bill whose detail lists a law stages `enacted`, whatever its latest
// action says. Runs in CI with the other static checks: deterministic, with no
// network, no DB and no secret.
//
// The backlog line *a law can read short of `enacted`* (HO 812): computeStage
// (lib/enums.ts) reads the latest action's text alone, and paperwork filed
// after a bill became law can be that latest action. `119-hr-1043` became
// P.L. 119-68 on 2025-12-29, and on 2026-02-11 a Senate committee filed its
// written report, so computeStage reads `committee`. HO 812 set it to `enacted`
// by hand; the summarizer computes `committee`, pends the downgrade, and takes
// it on the second matching proposal (decideStage, lib/summarize-runner.ts).
// The bill's own detail lists the law: raw_json's `$.laws`.
//
// The check calls the one function both writers stage with (lib/enums.ts,
// beside computeStage) and decideStage, and asserts:
//   1. a law listed, the report as the latest action → enacted;
//   2. no law listed, the same text → committee;
//   3. a law listed, *Became Public Law No: 119-68.* → enacted;
//   4. an empty laws array, a missing one and a null each read as no law;
//   5. the summarizer's decision on 119-hr-1043's shape (current enacted, a law
//      listed, the report, no pending stage) → noop;
//   6. the same with pending_stage already committee → noop.
// The report's text and the law are 119-hr-1043's own, as prod stored them at
// 12:55 PM MST Nov 23, 2026 (HO 830 STEP 0, claim 7).
//
// The function is looked up by name, so this file typechecks and builds before
// the rule exists; at HO 830's test commit every case reads red.
//
//   npm run check:stage-law
import * as enums from "../lib/enums";
import { computeStage } from "../lib/enums";
import { decideStage } from "../lib/summarize-runner";

const NAME = "computeStageWithLaws";
const REPORT = "By Senator Lee from Committee on Energy and Natural Resources filed written report. Report No. 119-109.";
const BECAME = "Became Public Law No: 119-68.";
const LAWS = [{ number: "119-68", type: "Public Law" }];

type Case = { name: string; ok: boolean; got: string };
const cases: Case[] = [];
const show = (v: unknown) => (v === undefined ? "undefined" : JSON.stringify(v));

const rule = (enums as Record<string, unknown>)[NAME] as
  | ((latestActionText: string | null | undefined, laws: unknown) => string)
  | undefined;

const NAMES = [
  "1. a law listed, the report as the latest action → enacted",
  "2. no law listed, the same text → committee",
  "3. a law listed, Became Public Law → enacted",
  "4. an empty laws array, a missing one and a null each read as no law (the report → committee)",
  "5. the summarizer on 119-hr-1043's shape: current enacted, a law listed, the report, no pending → noop",
  "6. the same with pending_stage already committee → noop",
];

if (typeof rule !== "function") {
  for (const name of NAMES) cases.push({ name, ok: false, got: `lib/enums.ts has no ${NAME}` });
} else {
  {
    const got = rule(REPORT, LAWS);
    cases.push({ name: NAMES[0]!, ok: got === "enacted", got: show(got) });
  }
  {
    const got = rule(REPORT, undefined);
    cases.push({ name: NAMES[1]!, ok: got === "committee", got: show(got) });
  }
  {
    const got = rule(BECAME, LAWS);
    cases.push({ name: NAMES[2]!, ok: got === "enacted", got: show(got) });
  }
  {
    const empty = rule(REPORT, []);
    const missing = rule(REPORT, undefined);
    const nul = rule(REPORT, null);
    cases.push({
      name: NAMES[3]!,
      ok: empty === "committee" && missing === "committee" && nul === "committee",
      got: `[] ${show(empty)} · missing ${show(missing)} · null ${show(nul)}`,
    });
  }
  {
    const got = decideStage("enacted", rule(REPORT, LAWS), null);
    cases.push({ name: NAMES[4]!, ok: got === "noop", got: show(got) });
  }
  {
    const got = decideStage("enacted", rule(REPORT, LAWS), "committee");
    cases.push({ name: NAMES[5]!, ok: got === "noop", got: show(got) });
  }
}

// computeStage alone, the expression both writers used before HO 830, on cases
// 1, 5 and 6: printed so a reader sees what each case separates. Not asserted.
const base = computeStage(REPORT);
console.log(
  `check:stage-law — computeStage alone reads the report as ${base}; the summarizer's decision on it: ${decideStage("enacted", base, null)} with no pending, ${decideStage("enacted", base, "committee")} with committee pending`,
);
for (const c of cases) console.log(`  ${c.ok ? "ok  " : "RED "} ${c.name}${c.ok ? "" : ` — got ${c.got}`}`);
const red = cases.filter((c) => !c.ok).length;
console.log(red ? `${red} of ${cases.length} red` : "OK");
process.exit(red ? 1 : 0);
