// HO 252 — prove a pushed commit is actually live. Reads local HEAD, then polls
// prod /api/version until the served SHA equals HEAD. Treats 404 / non-200 /
// "unknown" as "the new build hasn't promoted yet, keep polling" — the current
// live deployment 404s the new route until Vercel finishes building. Code runs
// locally, so it CAN reach the public app URL (a sandbox can't).
//
// Convention (HO 252): a handoff ships with `git push && npm run verify:deploy`,
// and the ship report's last line is the live-verified SHA.
//
// HO 653 — THE FIRST-MATCH SHAPE IS RETIRED, and this is the gate every
// post-deploy measurement runs behind, so a false green here hands its doubt to
// every figure taken after it. Polling until the FIRST match is exactly how a
// promotion transient reads as a live deploy: two instances briefly serve
// different builds, so one matching read proves nothing. Observed twice —
// BANKED at 226bd99 (a match, then the very next request served the
// predecessor) and FIRED at 4051206, where read 9 matched, read 10 served
// f47b807, and this script would have exited green at read 9. It now requires
// REQUIRED_CONSECUTIVE matching reads; a break PRINTS the breaking SHA and
// RESETS the run rather than continuing the count.
import { execSync } from "node:child_process";

const PROD_URL = "https://congressional-terminal-chi-silk.vercel.app";
const VERSION_ENDPOINT = `${PROD_URL}/api/version`;
const POLL_INTERVAL_MS = 10_000;
const TIMEOUT_MS = 5 * 60_000;
const REQUIRED_CONSECUTIVE = 5;

function localHead(): string {
  return execSync("git rev-parse HEAD").toString().trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchServedSha(): Promise<string> {
  try {
    const res = await fetch(VERSION_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return `unknown (HTTP ${res.status})`;
    const body = (await res.json()) as { sha?: string };
    return body.sha ?? "unknown";
  } catch (err) {
    return `unknown (${err instanceof Error ? err.message : String(err)})`;
  }
}

async function main() {
  const expected = localHead();
  console.log(`Expecting live SHA === local HEAD ${expected}`);
  console.log(`Polling ${VERSION_ENDPOINT} every ${POLL_INTERVAL_MS / 1000}s (timeout ${TIMEOUT_MS / 60_000}m)\n`);

  const start = Date.now();
  let run = 0;
  let firstMatchAt: number | null = null;
  while (Date.now() - start < TIMEOUT_MS) {
    const served = await fetchServedSha();
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (served === expected) {
      run += 1;
      if (firstMatchAt === null) firstMatchAt = elapsed;
      if (run >= REQUIRED_CONSECUTIVE) {
        console.log(
          `[${elapsed}s] served ${served} === HEAD on ${run} consecutive reads — deploy confirmed live ✓` +
            (firstMatchAt !== elapsed ? ` (first match at ${firstMatchAt}s)` : ""),
        );
        // process.exit() trips the Windows libuv UV_HANDLE_CLOSING teardown
        // assertion (a passing check mangled into exit 127); set exitCode + return
        // instead (same fix as the cron-check diagnostics).
        process.exitCode = 0;
        return;
      }
      console.log(`[${elapsed}s] served ${served} === HEAD (${run}/${REQUIRED_CONSECUTIVE})`);
    } else if (run > 0) {
      // THE TRANSIENT. Do NOT continue the count: a run interrupted by another
      // build means two instances are still serving different things, so the
      // reads so far prove nothing. Print what broke it — a silent reset would
      // hide the very event this check exists to catch.
      console.log(`[${elapsed}s] BREAK — served ${served}, run reset after ${run}/${REQUIRED_CONSECUTIVE}`);
      run = 0;
    } else {
      console.log(`[${elapsed}s] served ${served} !== expected ${expected} — waiting for promotion`);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const mins = Math.round(TIMEOUT_MS / 60_000);
  console.error(`deploy not confirmed in ${mins}m — check the Vercel dashboard`);
  process.exitCode = 1;
}

main();
