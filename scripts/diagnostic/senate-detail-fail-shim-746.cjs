// HO 746 legs — preload for `scripts/sync-senate-votes.ts` runs against a `file:`
// copy only, loaded through NODE_OPTIONS=--require by
// scripts/diagnostic/senate-watermark-legs-746.ts. Never loaded by the app, the
// build, or anything deployed.
//
// It makes ONE roll's detail URL answer HTTP 500 and passes every other fetch
// through untouched. lib/senate-votes-sync.ts's `fetchXml` retries only 502/503,
// so a 500 fails on the first response and the roll is counted `votesFailed`,
// not retried: a roll that fails before its `votes` row is written, which is
// the exact shape the MAX(roll_call) watermark strands.
"use strict";

const roll = process.env.FAIL_ROLL_746; // e.g. "239"
const congress = process.env.FAIL_CONGRESS_746; // e.g. "119"
const session = process.env.FAIL_SESSION_746; // e.g. "2"

if (roll && congress && session) {
  // lib/senate-votes-sync.ts pads the roll to five digits for the detail URL.
  const padded = String(Number(roll)).padStart(5, "0");
  const target = `vote_${congress}_${session}_${padded}.xml`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = function failOneRoll(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    if (typeof url === "string" && url.includes("/roll_call_votes/") && url.endsWith(target)) {
      console.log(`[fail-746] ${target} -> HTTP 500 (forced)`);
      return Promise.resolve(new Response("forced 500 (HO 746 legs shim)", { status: 500 }));
    }
    return realFetch(input, init);
  };
  console.log(`[fail-746] preload armed in pid ${process.pid}: ${target} answers 500`);
}
