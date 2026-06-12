import "dotenv/config";
import { createClient } from "@libsql/client";

// HO 238 regression guard: a libsql client whose custom fetch is bounded by a 2s
// AbortSignal.timeout, pointed at an unroutable (black-hole) address, must FAIL
// in ~2s — not hang to the function/process ceiling. If this ever sits past a
// few seconds, the lib/db.ts bounding has regressed (a bare client, or a
// Promise.race pseudo-timeout that leaves the socket alive).
//
// Run: npx tsx scripts/diagnostic/db-timeout-blackhole-238.ts
const TIMEOUT_MS = 2000;
// 192.0.2.1 = RFC 5737 TEST-NET-1, reserved + non-routable → the TCP connect
// hangs (no host answers), which is exactly the dead-connection case the
// AbortSignal.timeout must cut off.
const BLACKHOLE_URL = "https://192.0.2.1";

// Mirror of lib/db.ts's bound, minus the retry (we want a single ~2s timeout
// here, not 2× the window) — this validates the timeout mechanism itself.
function boundedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function main() {
  const db = createClient({
    url: BLACKHOLE_URL,
    authToken: "scratch",
    fetch: boundedFetch,
  });
  const t0 = Date.now();
  try {
    await db.execute("SELECT 1");
    console.log(`UNEXPECTED: query returned in ${Date.now() - t0}ms`);
    process.exit(1);
  } catch (e) {
    const dt = Date.now() - t0;
    console.log(
      `failed in ${dt}ms: ${(e as Error).name} — ${(e as Error).message.slice(0, 100)}`,
    );
    if (dt < 5000) {
      console.log(
        `PASS: bounded — failed fast (<5s) at the ${TIMEOUT_MS}ms timeout, not a ceiling hang.`,
      );
    } else {
      console.log("FAIL: took too long — the timeout bound is not working.");
      process.exit(1);
    }
  }
}

main();
