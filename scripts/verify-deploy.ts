// HO 252 — prove a pushed commit is actually live. Reads local HEAD, then polls
// prod /api/version until the served SHA equals HEAD. Treats 404 / non-200 /
// "unknown" as "the new build hasn't promoted yet, keep polling" — the current
// live deployment 404s the new route until Vercel finishes building. Code runs
// locally, so it CAN reach the public app URL (a sandbox can't).
//
// Convention (HO 252): a handoff ships with `git push && npm run verify:deploy`,
// and the ship report's last line is the live-verified SHA.
import { execSync } from "node:child_process";

const PROD_URL = "https://congressional-terminal-chi-silk.vercel.app";
const VERSION_ENDPOINT = `${PROD_URL}/api/version`;
const POLL_INTERVAL_MS = 10_000;
const TIMEOUT_MS = 5 * 60_000;

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
  while (Date.now() - start < TIMEOUT_MS) {
    const served = await fetchServedSha();
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (served === expected) {
      console.log(`[${elapsed}s] served ${served} === HEAD — deploy confirmed live ✓`);
      process.exit(0);
    }
    console.log(`[${elapsed}s] served ${served} !== expected ${expected} — waiting for promotion`);
    await sleep(POLL_INTERVAL_MS);
  }

  const mins = Math.round(TIMEOUT_MS / 60_000);
  console.error(`deploy not confirmed in ${mins}m — check the Vercel dashboard`);
  process.exit(1);
}

main();
