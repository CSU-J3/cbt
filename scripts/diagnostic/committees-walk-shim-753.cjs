// HO 753 legs: a preload for the LOCAL `next start` server and the
// `scripts/sync.ts` / `repair:committee-bills` CLIs only, loaded through
// NODE_OPTIONS=--require by scripts/diagnostic/committees-walk-legs-753.ts.
// It is never loaded by the app, the build, or anything deployed.
//
// It answers every api.congress.gov request and the membership YAML, so a leg
// makes no live request:
//   /bill/{c}/{t}/{n}/committees  the recorded body for that bill, the page picked by
//                                 `offset` (synthetic bills, number >= 90000, get a generic
//                                 one-committee body), failed with HTTP 500, delayed, or
//                                 answered 429, per the control file
//   /bill/{c}                     the list page the control file sets (the `/api/sync` legs)
//   /bill/{c}/{t}/{n}             the detail the control file sets for that bill
//   /committee/{c}, /committee-meeting/{c}/{chamber}, the YAML: empty answers, so the
//                                 route's other steps run and write nothing
// Every other host passes through untouched. The control file is re-read on every
// request, so the driver steers the shim between ticks. Every answer is logged,
// one line each, to SHIM_753_LOG, with the bill id and never the key.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONTROL = process.env.SHIM_753_CONTROL;
const RECORDED = process.env.SHIM_753_RECORDED;
const LOG = process.env.SHIM_753_LOG;

if (CONTROL && RECORDED && LOG) {
  const realFetch = globalThis.fetch;
  let served = 0;
  const control = () => {
    try {
      return JSON.parse(fs.readFileSync(CONTROL, "utf8"));
    } catch {
      return {};
    }
  };
  const log = (line) => fs.appendFileSync(LOG, `${new Date().toISOString()} pid ${process.pid} ${line}\n`);
  const json = (status, body, extra) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...(extra || {}) },
    });
  const rateHeaders = () => ({
    "x-ratelimit-limit": "20000",
    "x-ratelimit-remaining": String(Math.max(0, 19999 - served)),
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  globalThis.fetch = async function shim753Fetch(input, init) {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    let u;
    try {
      u = new URL(href);
    } catch {
      return realFetch(input, init);
    }
    if (u.hostname === "raw.githubusercontent.com" && u.pathname.endsWith("committee-membership-current.yaml")) {
      log("yaml -> 200 {}");
      return new Response("{}", { status: 200, headers: { "content-type": "text/plain" } });
    }
    if (u.hostname !== "api.congress.gov") return realFetch(input, init);

    const c = control();
    const p = u.pathname.replace(/^\/v3/, "");
    // api.data.gov refuses a request with no key (403 API_KEY_MISSING); so does the shim,
    // which is what lets a leg catch a page-2 request sent without one. Presence only is logged.
    const keyed = (u.searchParams.get("api_key") || "").trim() !== "";
    let m;    if ((m = p.match(/^\/bill\/(\d+)\/([a-z]+)\/(\d+)\/committees$/))) {
      const id = `${m[1]}-${m[2]}-${m[3]}`;
      const offset = Number(u.searchParams.get("offset") || 0);
      if (!keyed) {
        log(`committees ${id} @${offset} -> 403 API_KEY_MISSING (key absent)`);
        return json(403, { error: { code: "API_KEY_MISSING" } });
      }
      served++;
      if (c.delayMs) await sleep(c.delayMs);
      // A per-bill delay on the first page only. It ignores the caller's abort signal, so the page
      // can land after the tick's deadline (leg 4b).
      const d = (c.delayBills || {})[id];
      if (d && offset === 0) await sleep(d);
      if ((c.rateLimitAfter != null && served > c.rateLimitAfter) || (c.rateLimitBills || []).includes(id)) {
        log(`committees ${id} @${offset} -> 429`);
        return json(429, { error: { code: "OVER_RATE_LIMIT" } }, rateHeaders());
      }
      if ((c.failBills || []).includes(id)) {
        log(`committees ${id} @${offset} -> 500 (failBills)`);
        return json(500, { error: "shim 753: failed on command" }, rateHeaders());
      }
      if (Number(m[3]) >= 90000) {
        log(`committees ${id} @${offset} -> 200 synthetic`);
        return json(200, {
          committees: [{ systemCode: "hsju00", name: "Judiciary Committee", activities: [{ name: "Referred To", date: "2026-01-02T15:00:00Z" }] }],
          pagination: { count: 1 },
        }, rateHeaders());
      }
      const file = path.join(RECORDED, `${id}.json`);
      if (!fs.existsSync(file)) {
        log(`committees ${id} @${offset} -> 404 (not recorded)`);
        return json(404, { error: "shim 753: not recorded" }, rateHeaders());
      }
      const rec = JSON.parse(fs.readFileSync(file, "utf8"));
      const page = rec.pages.find((pg) => Number(pg.offset) === offset);
      if (!page) {
        log(`committees ${id} @${offset} -> 404 (no recorded page at that offset)`);
        return json(404, { error: "shim 753: no page" }, rateHeaders());
      }
      log(`committees ${id} @${offset} -> 200 recorded (${(page.body.committees || []).length} committees)`);
      return json(200, page.body, rateHeaders());
    }
    if (!keyed) {
      log(`${p} -> 403 API_KEY_MISSING (key absent)`);
      return json(403, { error: { code: "API_KEY_MISSING" } });
    }
    if ((m = p.match(/^\/bill\/(\d+)$/))) {
      const bills = c.syncList || [];
      log(`bill list -> 200 (${bills.length} bills)`);
      return json(200, { bills, pagination: { count: bills.length } });
    }
    if ((m = p.match(/^\/bill\/(\d+)\/([a-z]+)\/(\d+)$/))) {
      const id = `${m[1]}-${m[2]}-${m[3]}`;
      const bill = (c.syncDetail || {})[id];
      log(`bill detail ${id} -> ${bill ? 200 : 404}`);
      return bill ? json(200, { bill }) : json(404, { error: "shim 753: no detail" });
    }
    if (/^\/committee\/\d+$/.test(p)) {
      log("committee list -> 200 empty");
      return json(200, { committees: [], pagination: { count: 0 } });
    }
    if (/^\/committee-meeting\/\d+\/(house|senate)$/.test(p)) {
      log(`meetings list ${p} -> 200 empty`);
      return json(200, { committeeMeetings: [], pagination: { count: 0 } });
    }
    log(`unmatched api.congress.gov ${p} -> 404`);
    return json(404, { error: "shim 753: unmatched" });
  };
  log(`armed (control ${path.basename(CONTROL)}, recorded ${path.basename(RECORDED)})`);
}
