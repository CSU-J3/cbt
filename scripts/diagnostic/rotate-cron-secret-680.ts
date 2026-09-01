// HO 680 — rotate CRON_SECRET. Tracked, because this is next year's tool too:
// the annual api.data.gov / secret-rotation calendar line points here so the
// next rotation starts from a script rather than from memory.
//
// WHAT IT DOES
//   1. Generates one new secret: crypto.randomBytes(32).toString("hex") -> 64
//      hex characters, the shape the existing value already has.
//   2. Feeds it to `vercel env add CRON_SECRET production --force --yes` by
//      STDIN. Never as an argument.
//   3. Rewrites the CRON_SECRET= line of .env in place, preserving line
//      endings and every other byte of the file.
//
// WHAT IT DELIBERATELY DOES NOT DO — THE PREVIEW LEG IS ABSENT BY RULING, NOT
// BY OVERSIGHT (HO 680). The Vercel CLI in non-interactive/agent mode refuses
// the all-Preview-branches case and demands `--value <value>`, which would put
// the secret in a command line and therefore in an agent transcript — the exact
// mechanism that burned this secret in HO 678. Four invocation forms were tried
// and all four failed or could not be verified; see the HO 680 strike. The
// Preview value is set by the owner in the Vercel dashboard, copying from .env
// after this script has written it. Ordering matters: Production and .env move
// first, Preview follows minutes later, so there is no window in which any
// environment holds NO value.
//
// THE ONE RULE: no secret value in a command, an argument, an output, a log
// line, a file under the repo other than .env, or the paste-back. This script
// prints only exit codes, line counts, byte lengths and its own self-scan, and
// it ends by scanning everything it printed for a 40+ alphanumeric run or a
// 64-hex run, exiting 1 if it finds one.
//
// READ-BACK IS `vercel env ls production --format json` -> `updatedAt`, NOT the
// human-readable `created` column. That column shows record CREATION and does
// not move on an in-place --force override; HO 680 misread it once and briefly
// concluded a successful write had been a no-op. The JSON record carries both
// createdAt and updatedAt; only the latter answers "did this write land".
//
// Run: npx tsx scripts/diagnostic/rotate-cron-secret-680.ts
//      --dry-run   generate + report lengths, touch nothing

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const DRY = process.argv.includes("--dry-run");
const ENV_PATH = ".env";
const KEY = "CRON_SECRET";

const printed: string[] = [];
const say = (s: string) => {
  printed.push(s);
  console.log(s);
};

// --- 1. generate -----------------------------------------------------------
const secret = randomBytes(32).toString("hex");
say(`generated: ${secret.length} chars, /^[0-9a-f]+$/ = ${/^[0-9a-f]+$/.test(secret)}`);

// --- 2. Vercel, Production only, by stdin ----------------------------------
let addExit: number | null = null;
if (DRY) {
  say("dry-run: skipping vercel env add");
} else {
  // shell: true for the .cmd shim on Windows. The value rides `input:`, never argv.
  const r = spawnSync(
    "vercel",
    ["env", "add", KEY, "production", "--force", "--yes"],
    { input: secret, shell: true, encoding: "utf8" },
  );
  addExit = r.status;
  const combined = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const leaked = /[A-Za-z0-9]{40,}|\b[0-9a-f]{64}\b/.test(combined);
  say(`vercel env add ${KEY} production: exit ${addExit}`);
  say(`  cli output leak-scan: ${leaked ? "LEAK — output withheld" : "clean"}`);
  if (!leaked) {
    for (const line of combined.split(/\r?\n/)) {
      if (/error|warning|Overrode|Added|Saving/i.test(line)) say(`  cli: ${line.trim()}`);
    }
  }
  if (addExit !== 0) {
    say("ABORT: Vercel add failed; .env NOT rewritten, so .env and Vercel stay in agreement.");
    process.exit(1);
  }
}

// --- 3. .env in place ------------------------------------------------------
const before = readFileSync(ENV_PATH);
const beforeLines = before.toString("latin1").split("\n").length;
say(`.env before: ${before.length} bytes, ${beforeLines} lines`);

const lines = before.toString("latin1").split("\n");
let hits = 0;
const after = lines.map((line) => {
  if (!line.startsWith(`${KEY}=`)) return line;
  hits++;
  const eol = line.endsWith("\r") ? "\r" : "";
  return `${KEY}=${secret}${eol}`;
});
if (hits !== 1) {
  say(`ABORT: expected exactly 1 ${KEY}= line, found ${hits}. .env untouched.`);
  process.exit(1);
}

if (DRY) {
  say("dry-run: skipping .env rewrite");
} else {
  writeFileSync(ENV_PATH, Buffer.from(after.join("\n"), "latin1"));
  const now = readFileSync(ENV_PATH);
  const nowLines = now.toString("latin1").split("\n").length;
  say(`.env after : ${now.length} bytes, ${nowLines} lines`);
  say(`  line count unchanged: ${nowLines === beforeLines}`);
  say(`  byte delta: ${now.length - before.length} (expect 0 — 64 hex replaced 64 hex)`);
  const otherBefore = before.toString("latin1").split("\n").filter((l) => !l.startsWith(`${KEY}=`));
  const otherAfter = now.toString("latin1").split("\n").filter((l) => !l.startsWith(`${KEY}=`));
  say(`  all other lines byte-identical: ${JSON.stringify(otherBefore) === JSON.stringify(otherAfter)}`);
  const line = now.toString("latin1").split("\n").find((l) => l.startsWith(`${KEY}=`)) ?? "";
  const v = line.slice(KEY.length + 1).replace(/\r$/, "");
  say(`  ${KEY} value length on that line: ${v.length} (expect 64)`);
  say(`  grep -c '^${KEY}=' equivalent: ${after.filter((l) => l.startsWith(`${KEY}=`)).length}`);
}

// --- mandated self-scan of everything this script printed ------------------
const blob = printed.join("\n");
const bad = [
  ...blob.matchAll(/[A-Za-z0-9]{40,}/g),
  ...blob.matchAll(/\b[0-9a-f]{64}\b/g),
];
console.log(`self-scan: ${bad.length === 0 ? "clean (no 40+ alnum run, no 64-hex run)" : `LEAK — ${bad.length} hit(s)`}`);
if (bad.length > 0) process.exit(1);

if (!DRY) {
  console.log("\nNEXT (owner, dashboard): set CRON_SECRET for Preview by copying the");
  console.log("new value from .env. Until then Preview holds the OLD value — valid,");
  console.log("just not yet rotated. No environment is ever unset.");
}
