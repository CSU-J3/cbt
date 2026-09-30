// HO 761 legs: a preload, loaded through NODE_OPTIONS=--require by
// scripts/diagnostic/runoff-rounds-legs-761.ts into the children it spawns (the sync legs' child and
// `npm run repair:runoffs`). It is never loaded by the app, the build, or anything deployed.
//
// It answers every https://ballotpedia.org/ request from HO 747's saved pages, so a leg makes no live
// request:
//   a URL in SHIM_761_MAP (JSON: url -> absolute path of a saved .html.gz)   200 with that page
//   any other ballotpedia.org URL                                             404 (the special-election
//                                                                             URLs among them, which is
//                                                                             what Ballotpedia answers
//                                                                             for SC's and GA's)
// Every other host passes through. Every answer is logged, one line each, to SHIM_761_LOG.
"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");

const MAP = process.env.SHIM_761_MAP;
const LOG = process.env.SHIM_761_LOG;

if (MAP && LOG) {
  const realFetch = globalThis.fetch;
  const map = JSON.parse(fs.readFileSync(MAP, "utf8"));
  const log = (line) => fs.appendFileSync(LOG, `${new Date().toISOString()} pid ${process.pid} ${line}\n`);
  globalThis.fetch = async function shim761Fetch(input, init) {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    let u;
    try {
      u = new URL(href);
    } catch {
      return realFetch(input, init);
    }
    if (u.hostname !== "ballotpedia.org") return realFetch(input, init);
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
