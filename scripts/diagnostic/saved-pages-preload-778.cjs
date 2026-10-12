// HO 778 leg L: a preload, loaded through NODE_OPTIONS=--require by
// scripts/diagnostic/nov4-routes-legs-778.ts into the `next start` servers it spawns. It is never
// loaded by the app, the build, or anything deployed. Built on HO 761's runoff-pages-shim-761.cjs,
// with one difference: every other host is refused, not passed through, so a leg makes no live
// request of any kind.
//
//   a URL in SHIM_778_MAP (JSON: url -> absolute path of a saved .html.gz)   200 with that page
//   any other ballotpedia.org URL                                             404 (not saved)
//   any other host                                                            refused (a thrown
//                                                                             TypeError, as a
//                                                                             network failure is)
// Every request is logged, one line each, to SHIM_778_LOG.
"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");

const MAP = process.env.SHIM_778_MAP;
const LOG = process.env.SHIM_778_LOG;

if (MAP && LOG) {
  const map = JSON.parse(fs.readFileSync(MAP, "utf8"));
  const log = (line) => fs.appendFileSync(LOG, `${new Date().toISOString()} pid ${process.pid} ${line}\n`);
  globalThis.fetch = async function shim778Fetch(input) {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    let u;
    try {
      u = new URL(href);
    } catch {
      log(`REFUSED unparsable ${String(href).slice(0, 200)}`);
      throw new TypeError("fetch refused by the HO 778 preload (unparsable URL)");
    }
    if (u.hostname !== "ballotpedia.org") {
      log(`REFUSED ${u.hostname} ${u.href}`);
      throw new TypeError(`fetch refused by the HO 778 preload: ${u.hostname}`);
    }
    const file = map[u.href];
    if (!file) {
      log(`404 ${u.href}`);
      return new Response("not saved", { status: 404, headers: { "content-type": "text/html" } });
    }
    const body = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
    log(`200 ${u.href} <- ${file} (${Buffer.byteLength(body)} bytes)`);
    return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
}
