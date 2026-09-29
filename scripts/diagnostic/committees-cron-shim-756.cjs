// HO 756 legs: a preload for the LOCAL `next start` server only, loaded through
// NODE_OPTIONS=--require by scripts/diagnostic/committees-cron-legs-756.ts. It is never
// loaded by the app, the build, or anything deployed.
//
// It answers every api.congress.gov request and the membership YAML, so a leg makes no
// live request:
//   /committee/{c}                          the committees list: 200 empty, or held on
//                                           command (`hangListMs`) until the caller aborts
//   the membership YAML                     200 `{}`
//   /bill/{c}/{t}/{n}/committees            a synthetic bill (number >= 90000): a one-
//                                           committee body after `delayMs`; a request that
//                                           starts at or after `holdFrom` (epoch ms) is held
//                                           `holdMs` more. Every delay honours the caller's
//                                           abort signal, the way the real fetch does
//   listStatus / billStatus                 answer the list, or every bill, with that HTTP
//                                           status (an outage or a bad key, leg 5)
//   anything else                           404
// Every other host passes through. The control file is re-read on every request. Every
// answer is logged, one line each, to SHIM_756_LOG, with the bill id and never the key.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONTROL = process.env.SHIM_756_CONTROL;
const LOG = process.env.SHIM_756_LOG;

if (CONTROL && LOG) {
  const realFetch = globalThis.fetch;
  const control = () => {
    try {
      return JSON.parse(fs.readFileSync(CONTROL, "utf8"));
    } catch {
      return {};
    }
  };
  const log = (line) => fs.appendFileSync(LOG, `${new Date().toISOString()} pid ${process.pid} ${line}\n`);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const wait = (ms, signal) =>
    new Promise((resolve, reject) => {
      if (!ms) return resolve();
      if (signal && signal.aborted) return reject(signal.reason);
      const t = setTimeout(resolve, ms);
      if (signal)
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(signal.reason);
        }, { once: true });
    });

  globalThis.fetch = async function shim756Fetch(input, init) {
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
    const signal = init && init.signal;
    if ((u.searchParams.get("api_key") || "").trim() === "") {
      log(`${p} -> 403 API_KEY_MISSING (key absent)`);
      return json(403, { error: { code: "API_KEY_MISSING" } });
    }
    let m;
    if (/^\/committee\/\d+$/.test(p)) {
      if (c.listStatus) {
        log(`committee list -> ${c.listStatus} (listStatus)`);
        return json(c.listStatus, { error: { code: "SHIM_756" } });
      }
      if (c.hangListMs) {
        const t0 = Date.now();
        try {
          await wait(c.hangListMs, signal);
        } catch (e) {
          log(`committee list -> aborted after ${Date.now() - t0} ms (held ${c.hangListMs} ms)`);
          throw e;
        }
      }
      log("committee list -> 200 empty");
      return json(200, { committees: [], pagination: { count: 0 } });
    }
    if ((m = p.match(/^\/bill\/(\d+)\/([a-z]+)\/(\d+)\/committees$/))) {
      const id = `${m[1]}-${m[2]}-${m[3]}`;
      if (c.billStatus) {
        log(`committees ${id} -> ${c.billStatus} (billStatus)`);
        return json(c.billStatus, { error: { code: "SHIM_756" } });
      }
      const start = Date.now();
      const hold = c.holdFrom && start >= c.holdFrom ? c.holdMs || 0 : 0;
      try {
        await wait((c.delayMs || 0) + hold, signal);
      } catch (e) {
        log(`committees ${id} -> aborted after ${Date.now() - start} ms${hold ? ` (held ${hold} ms)` : ""}`);
        throw e;
      }
      if (Number(m[3]) >= 90000) {
        log(`committees ${id} -> 200 synthetic after ${Date.now() - start} ms${hold ? " (held)" : ""}`);
        return json(200, {
          committees: [{ systemCode: "hsju00", name: "Judiciary Committee", activities: [{ name: "Referred To", date: "2026-01-02T15:00:00Z" }] }],
          pagination: { count: 1 },
        });
      }
      log(`committees ${id} -> 404 (not synthetic)`);
      return json(404, { error: "shim 756: not synthetic" });
    }
    log(`unmatched api.congress.gov ${p} -> 404`);
    return json(404, { error: "shim 756: unmatched" });
  };
  log(`armed (control ${path.basename(CONTROL)})`);
}
