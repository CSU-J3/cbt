// HO 675 — the shipped allocateFaces() against the committed ruling record.
// The mock carries seven data-roster cases and prints its own allocation for
// six of them; this asserts the port reproduces them, plus the worked table
// STEP 0 approved. A FALSIFICATION CONTROL runs a deliberately wrong rule
// through the same comparison so a green here cannot come from a comparison
// that never fires.
//   npx tsx scripts/diagnostic/allocate-check-675.ts
import { allocateFaces, FACE_BUDGET, PARTY_ORDER } from "../../lib/bill-rosters-view";

type Counts = Partial<Record<"D" | "R" | "I", number>>;
const fmt = (a: Record<string, number>) =>
  PARTY_ORDER.filter((p) => a[p] != null).map((p) => `${p}${a[p]}`).join("/");

// [label, counts, expected] — expected transcribed from the mock's own
// `allocation ->` output and from the STEP 0 worked table.
const CASES: [string, Counts, string][] = [
  ["mock data-roster D9/R5", { D: 9, R: 5 }, "D3/R3"],
  ["mock data-roster D21/R1", { D: 21, R: 1 }, "D5/R1"],
  ["mock data-roster R4", { R: 4 }, "R4"],
  ["mock data-roster D1/R1", { D: 1, R: 1 }, "D1/R1"],
  ["mock data-roster D6/R2/I1", { D: 6, R: 2, I: 1 }, "D3/R2/I1"],
  ["mock data-roster D218/R184", { D: 218, R: 184 }, "D3/R3"],
  ["d=0, R only x40", { R: 40 }, "R6"],
  ["exactly six D3/R3", { D: 3, R: 3 }, "D3/R3"],
  ["exactly six D5/R1", { D: 5, R: 1 }, "D5/R1"],
  ["fewer than six, D2", { D: 2 }, "D2"],
  ["three parties at 1 each", { D: 1, R: 1, I: 1 }, "D1/R1/I1"],
  ["zero cosponsors", {}, ""],
];

let fails = 0;
console.log("─── shipped allocateFaces() vs the ruling record ────────────────────");
for (const [label, counts, want] of CASES) {
  const got = fmt(allocateFaces(counts));
  const ok = got === want;
  if (!ok) fails++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(30)} -> ${got.padEnd(12)} want ${want}`);
}

// INVARIANTS over the whole plausible input space, not just the named cases.
console.log();
console.log("─── invariants over 0..40 x 0..40 x 0..3 ────────────────────────────");
let checked = 0, drawnBad = 0, overBad = 0, erasedBad = 0;
for (let d = 0; d <= 40; d++)
  for (let r = 0; r <= 40; r++)
    for (let i = 0; i <= 3; i++) {
      const counts = { D: d, R: r, I: i };
      const a = allocateFaces(counts);
      const total = d + r + i;
      const drawn = PARTY_ORDER.reduce((s, p) => s + (a[p] ?? 0), 0);
      checked++;
      // 1. draws min(budget, total)
      if (drawn !== Math.min(FACE_BUDGET, total)) drawnBad++;
      // 2. never allocates a party more faces than it has members
      if (PARTY_ORDER.some((p) => (a[p] ?? 0) > counts[p])) overBad++;
      // 3. never gives a PRESENT party zero faces -- the property that decided
      //    the rule against proportional, so it is asserted rather than assumed
      if (PARTY_ORDER.some((p) => counts[p] > 0 && (a[p] ?? 0) === 0)) erasedBad++;
    }
console.log(`  combinations checked                 ${checked}`);
console.log(`  drawn != min(6, total)               ${drawnBad}`);
console.log(`  a party over-allocated               ${overBad}`);
console.log(`  a PRESENT party erased to 0 faces    ${erasedBad}`);
if (drawnBad || overBad || erasedBad) fails++;

// FALSIFICATION CONTROL: a rule that IS wrong must fail this harness, or the
// harness proves nothing about the rule that passed it.
console.log();
console.log("─── control: a deliberately wrong rule through the same checks ──────");
const wrong = (c: Counts) => {
  const out: Record<string, number> = {};
  let left = FACE_BUDGET;
  for (const p of PARTY_ORDER) {
    if ((c[p] ?? 0) === 0) continue;
    const take = Math.min(left, c[p]!); // greedy: first party takes everything
    out[p] = take;
    left -= take;
  }
  return out;
};
let ctlFails = 0, ctlErased = 0;
for (const [label, counts, want] of CASES) {
  if (fmt(wrong(counts)) !== want) ctlFails++;
  void label;
}
for (let d = 1; d <= 40; d++)
  for (let r = 1; r <= 40; r++) {
    const a = wrong({ D: d, R: r });
    if ((a.R ?? 0) === 0) ctlErased++;
  }
console.log(`  named cases the wrong rule FAILS     ${ctlFails} of ${CASES.length} (want > 0)`);
console.log(`  present-party erasures it produces   ${ctlErased} (want > 0)`);
if (ctlFails === 0 || ctlErased === 0) {
  console.log("  CONTROL DID NOT FIRE — the harness cannot detect a wrong rule.");
  fails++;
}

console.log();
console.log(fails === 0 ? "ALL CHECKS PASS" : `${fails} CHECK GROUP(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
