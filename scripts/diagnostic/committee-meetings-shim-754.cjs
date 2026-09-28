// HO 754 legs: a preload for the LOCAL `next start` server only, loaded through
// NODE_OPTIONS=--require by scripts/diagnostic/committee-meetings-legs-754.ts. It is
// never loaded by the app, the build, or anything deployed.
//
// It answers every api.congress.gov request and the membership YAML, so a leg makes
// no live request:
//   /committee-meeting/{c}/{chamber}        a page of the ordering the control file names
//                                           for that chamber, sliced at `offset`/`limit`, with
//                                           the list's own count and a `next` while rows remain.
//                                           `after0` serves a second ordering to every page past
//                                           the first (an event above the boundary moved between
//                                           two reads); `split` serves ordering A below an offset
//                                           and B from it (HO 752's recorded tie); `alternate`
//                                           flips A and B on every request for that chamber;
//                                           `drop` removes events; `bump` gives an event a new
//                                           updateDate and moves it to the top (newest first)
//   /committee-meeting/{c}/{chamber}/{id}   the recorded detail when there is one, else the
//                                           detail built from the event's stored row; its
//                                           updateDate is the one the list currently serves.
//                                           Null (200 with no committeeMeeting), failed (500),
//                                           or delayed on command. A delay honours the caller's
//                                           abort signal, the way the real fetch does
//   /committee/{c}, the YAML, /bill/...     empty answers, so the committees route's other
//                                           steps run and write nothing
//   delayLists                              a chamber's list pages hang (honouring the abort)
// Every other host passes through untouched. The control file is re-read on every
// request, so the driver steers the shim between ticks. Every answer is logged, one
// line each, to SHIM_754_LOG, with the event id and never the key.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CONTROL = process.env.SHIM_754_CONTROL;
const LOG = process.env.SHIM_754_LOG;

if (CONTROL && LOG) {
  const realFetch = globalThis.fetch;
  const cache = new Map();
  const readJson = (file) => {
    const st = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.body;
    const body = JSON.parse(fs.readFileSync(file, "utf8"));
    cache.set(file, { mtimeMs: st.mtimeMs, body });
    return body;
  };
  const control = () => {
    try {
      return JSON.parse(fs.readFileSync(CONTROL, "utf8"));
    } catch {
      return {};
    }
  };
  const log = (line) => fs.appendFileSync(LOG, `${new Date().toISOString()} pid ${process.pid} ${line}\n`);
  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  // A delay that rejects on the caller's abort, as the real fetch does.
  const delay = (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(signal.reason);
      const t = setTimeout(resolve, ms);
      if (signal)
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(signal.reason);
        }, { once: true });
    });
  const requestsByChamber = { house: 0, senate: 0 };

  // The ordering served for a chamber on this request, after drop and bump.
  // A list request counts toward `alternate`; the detail lookup (count false) does not.
  const ordering = (c, chamber, offset, count = true) => {
    let file = (c.lists || {})[chamber];
    if (!file) return null;
    const alt = (c.alternate || {})[chamber];
    const after0 = (c.after0 || {})[chamber];
    const split = (c.split || {})[chamber];
    let which = "A";
    if (after0 && offset > 0) (file = after0), (which = "after0");
    if (split && offset >= split.at) (file = split.file), (which = "B");
    if (alt && count) {
      requestsByChamber[chamber]++;
      if (requestsByChamber[chamber] % 2 === 0) (file = alt), (which = "alt");
    }
    let items = readJson(file).items.slice();
    const drop = new Set(c.drop || []);
    if (drop.size) items = items.filter((x) => !drop.has(String(x.eventId)));
    for (const [id, u] of Object.entries(c.bump || {})) {
      const i = items.findIndex((x) => String(x.eventId) === id);
      if (i >= 0) {
        items.splice(i, 1);
        items.unshift({ eventId: id, updateDate: u });
      }
    }
    return { items, which };
  };

  globalThis.fetch = async function shim754Fetch(input, init) {
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
    if ((u.searchParams.get("api_key") || "").trim() === "") {
      log(`${p} -> 403 API_KEY_MISSING (key absent)`);
      return json(403, { error: { code: "API_KEY_MISSING" } });
    }
    const signal = init && init.signal;
    let m;
    if ((m = p.match(/^\/committee-meeting\/(\d+)\/(house|senate)$/))) {
      const chamber = m[2];
      const offset = Number(u.searchParams.get("offset") || 0);
      const limit = Number(u.searchParams.get("limit") || 20);
      // A list page that hangs (leg 6c), honouring the caller's abort like the real fetch.
      const dl = (c.delayLists || {})[chamber];
      if (dl) {
        try {
          await delay(dl, signal);
        } catch (e) {
          log(`meetings list ${chamber} @${offset} -> aborted after waiting (delay ${dl} ms)`);
          throw e;
        }
      }
      const o = ordering(c, chamber, offset);
      if (!o) {
        log(`meetings list ${chamber} @${offset} -> 200 empty (no ordering)`);
        return json(200, { committeeMeetings: [], pagination: { count: 0 } });
      }
      const rows = o.items.slice(offset, offset + limit);
      const more = offset + limit < o.items.length;
      const pagination = { count: o.items.length };
      if (more) pagination.next = `https://api.congress.gov/v3/committee-meeting/${m[1]}/${chamber}?offset=${offset + limit}&limit=${limit}&format=json`;
      log(`meetings list ${chamber} @${offset} -> 200 ${rows.length} rows of ${o.items.length} (${o.which})`);
      return json(200, { committeeMeetings: rows.map((x) => ({ eventId: x.eventId, updateDate: x.updateDate, chamber, congress: Number(m[1]) })), pagination });
    }
    if ((m = p.match(/^\/committee-meeting\/(\d+)\/(house|senate)\/(\d+)$/))) {
      const chamber = m[2];
      const id = m[3];
      const d = (c.delayDetails || {})[id] ?? c.delayMs ?? 0;
      if (d) {
        try {
          await delay(d, signal);
        } catch (e) {
          log(`meeting ${chamber} ${id} -> aborted after waiting (delay ${d} ms)`);
          throw e;
        }
      }
      if ((c.failDetails || []).includes(id)) {
        log(`meeting ${chamber} ${id} -> 500 (failDetails)`);
        return json(500, { error: "shim 754: failed on command" });
      }
      if ((c.nullDetails || []).includes(id)) {
        log(`meeting ${chamber} ${id} -> 200 null (no committeeMeeting)`);
        return json(200, { request: { eventId: id } });
      }
      const real = c.realDetails ? readJson(c.realDetails)[`${chamber}/${id}`] : undefined;
      const built = c.details ? readJson(c.details)[id] : undefined;
      const body = real && real.committeeMeeting ? real.committeeMeeting : built;
      if (!body) {
        log(`meeting ${chamber} ${id} -> 404 (no detail)`);
        return json(404, { error: "shim 754: no detail" });
      }
      // The detail's updateDate is the one the list serves now (list and detail agreed
      // 104 of 104 at HO 752), unless the control file sets another.
      const o = ordering(c, chamber, 0, false);
      const listed = o ? o.items.find((x) => String(x.eventId) === id) : undefined;
      const upd = (c.detailUpdate || {})[id] ?? (listed ? listed.updateDate : body.updateDate);
      log(`meeting ${chamber} ${id} -> 200 ${real && real.committeeMeeting ? "recorded" : "built"} (updateDate ${upd})`);
      return json(200, { committeeMeeting: { ...body, updateDate: upd } });
    }
    if (/^\/committee\/\d+$/.test(p)) {
      log("committee list -> 200 empty");
      return json(200, { committees: [], pagination: { count: 0 } });
    }
    if (/^\/bill\//.test(p)) {
      log(`bill ${p} -> 200 empty`);
      return json(200, { committees: [], bills: [], pagination: { count: 0 } });
    }
    log(`unmatched api.congress.gov ${p} -> 404`);
    return json(404, { error: "shim 754: unmatched" });
  };
  log(`armed (control ${path.basename(CONTROL)})`);
}
