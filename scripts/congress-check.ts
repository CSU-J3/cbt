import { currentCongressLabel, getCurrentCongress, ordinal } from "../lib/congress";

type Case = { input: Date | number; expected: string | number; got: string | number };

const congressCases: Case[] = [
  { input: new Date("2026-05-04T00:00:00Z"), expected: 119, got: 0 },
  { input: new Date("2027-01-02T23:59:59Z"), expected: 119, got: 0 },
  { input: new Date("2027-01-03T00:00:00Z"), expected: 120, got: 0 },
  { input: new Date("2028-12-31T23:59:59Z"), expected: 120, got: 0 },
  { input: new Date("2029-01-03T00:00:00Z"), expected: 121, got: 0 },
];

const ordinalCases: Case[] = [
  { input: 119, expected: "119th", got: "" },
  { input: 120, expected: "120th", got: "" },
  { input: 121, expected: "121st", got: "" },
  { input: 122, expected: "122nd", got: "" },
  { input: 123, expected: "123rd", got: "" },
  { input: 131, expected: "131st", got: "" },
];

let failed = 0;

console.log("getCurrentCongress:");
for (const c of congressCases) {
  c.got = getCurrentCongress(c.input as Date);
  const ok = c.got === c.expected;
  if (!ok) failed++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${(c.input as Date).toISOString()} → ${c.got} (expected ${c.expected})`,
  );
}

console.log("\nordinal:");
for (const c of ordinalCases) {
  c.got = ordinal(c.input as number);
  const ok = c.got === c.expected;
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${c.input} → "${c.got}" (expected "${c.expected}")`);
}

console.log(`\ntoday: ${currentCongressLabel()}`);

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log("\nall passed");
