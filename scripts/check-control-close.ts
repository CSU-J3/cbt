// HO 827 — a closed chamber-control market reads as no price. Runs in CI with
// the other static checks: deterministic, with no network, no DB and no secret.
//
// Corey's ruling (Nov 20): the control cells on /electoral's hero band are
// added when their market comes up and dropped once the odds close. HO 827's
// STEP 0 read both 2026 control markets on Kalshi's public API as
// `status: "finalized"` (closed on election night, settled an hour later),
// while the cron kept writing their last prices (0.999 and 0.001) and the band
// showed *LIVE → D 100% R 0%*.
//
// The check feeds the control read in lib/kalshi.ts canned market payloads
// through a stubbed `fetch`, calling the exported `fetchChamberControl`, the
// cron's own entry point, and asserts:
//   1. two open, priced outcomes give the odds;
//   2. the same two, closed as STEP 0 read them, give null;
//   3. one open and one closed give null;
//   4. the page rule (lib/electoral-rows.ts): a blob whose write time is 25
//      hours old gives no band, and one an hour old gives it. With a null
//      control the band renders nothing (components/RacesHeroBand.tsx).
// The stub serves its payload whatever query the read sends. So if the read
// asks Kalshi for `status=open` and Kalshi ever ignored that filter, a closed
// market would still reach the parser here: the read has to check each
// market's own status, and case 2 says whether it does.
//
//   npm run check:control-close
import { fetchChamberControl } from "../lib/kalshi";
import * as electoralRows from "../lib/electoral-rows";

// The two House markets as Kalshi served them at 1:40:47 PM MST Nov 20, 2026
// (GET /markets?event_ticker=CONTROLH-2026&limit=8; HO 827 STEP 0, claim 6,
// docs/handoffs/827-artifacts/claim6-CONTROLH-2026.json), trimmed to the fields
// a reader could use. 42 keys each in the original.
const CLOSED_D = {
  ticker: "CONTROLH-2026-D",
  event_ticker: "CONTROLH-2026",
  status: "finalized",
  close_time: "2026-11-04T05:02:53Z",
  last_price_dollars: "0.9990",
  result: "yes",
  yes_sub_title: "Democratic Party",
  no_sub_title: "Democratic Party",
};
const CLOSED_R = {
  ticker: "CONTROLH-2026-R",
  event_ticker: "CONTROLH-2026",
  status: "finalized",
  close_time: "2026-11-04T05:02:53Z",
  last_price_dollars: "0.0010",
  result: "no",
  yes_sub_title: "Republican Party",
  no_sub_title: "Republican Party",
};
// The same two, open. An open market's fields are as Kalshi served them for
// GET /markets?status=open the same minute (claim6-open-sample.json): status
// "active", a close time ahead, an empty result. The prices are HO 219's live
// House reading (78 + 23).
const open = (m: typeof CLOSED_D, price: string) => ({
  ...m,
  status: "active",
  close_time: "2027-02-01T15:00:00Z",
  result: "",
  last_price_dollars: price,
});
const OPEN_D = open(CLOSED_D, "0.7800");
const OPEN_R = open(CLOSED_R, "0.2300");

let served: unknown[] = [];
let asked: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  asked.push(String(input));
  return new Response(JSON.stringify({ cursor: "", markets: served }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

type Case = { name: string; ok: boolean; got: string };
const cases: Case[] = [];
const show = (v: unknown) => JSON.stringify(v);

async function readWith(markets: unknown[]) {
  served = markets;
  asked = [];
  return fetchChamberControl();
}

{
  const got = await readWith([OPEN_D, OPEN_R]);
  const want = { favParty: "D", favPct: 78, otherParty: "R", otherPct: 23 };
  cases.push({
    name: "1. two open, priced outcomes give the odds",
    ok: show(got.house) === show(want) && show(got.senate) === show(want),
    got: show(got),
  });
}
{
  const got = await readWith([CLOSED_D, CLOSED_R]);
  cases.push({
    name: "2. the same two, closed as STEP 0 read them (status finalized), give null",
    ok: got.house === null && got.senate === null,
    got: show(got),
  });
}
{
  const got = await readWith([OPEN_D, CLOSED_R]);
  cases.push({
    name: "3. one open and one closed give null",
    ok: got.house === null && got.senate === null,
    got: show(got),
  });
}
{
  // Looked up by name, so this file typechecks before the rule exists.
  const rule = (electoralRows as Record<string, unknown>).unlessStale as
    | ((value: unknown, updatedAt: string | null, nowMs: number) => unknown)
    | undefined;
  const control = { house: { favParty: "D", favPct: 78, otherParty: "R", otherPct: 23 }, senate: null };
  const nowMs = Date.parse("2026-11-20T20:00:00Z");
  const hours = (h: number) => new Date(nowMs - h * 3_600_000).toISOString();
  if (typeof rule !== "function") {
    cases.push({ name: "4. the page rule: 25 hours old gives no band, 1 hour gives it", ok: false, got: "lib/electoral-rows.ts has no unlessStale" });
  } else {
    const stale = rule(control, hours(25), nowMs);
    const fresh = rule(control, hours(1), nowMs);
    const missing = rule(control, null, nowMs);
    const garbled = rule(control, "not a time", nowMs);
    cases.push({
      name: "4. the page rule: 25 hours old gives no band, 1 hour gives it",
      ok: stale === null && show(fresh) === show(control) && missing === null && garbled === null,
      got: `25 h ${show(stale)} · 1 h ${show(fresh)} · missing ${show(missing)} · unparseable ${show(garbled)}`,
    });
  }
}

const statusAsked = asked.some((u) => /[?&]status=open\b/.test(u));
console.log(`check:control-close — the control read asks Kalshi ${statusAsked ? "with" : "without"} status=open`);
for (const c of cases) console.log(`  ${c.ok ? "ok  " : "RED "} ${c.name}${c.ok ? "" : ` — got ${c.got}`}`);
const red = cases.filter((c) => !c.ok).length;
console.log(red ? `${red} of ${cases.length} red` : "OK");
process.exit(red ? 1 : 0);
