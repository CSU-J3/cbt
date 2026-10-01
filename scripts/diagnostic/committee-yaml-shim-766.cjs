// HO 766 legs: a preload, loaded through NODE_OPTIONS=--require by scripts/diagnostic/select-codes-legs-766.ts
// into the children it spawns. It is never loaded by the app, the build, or anything deployed.
// It answers the members step's one request, the unitedstates committee-membership YAML on
// raw.githubusercontent.com, from the file SHIM_766_YAML names (a saved copy, or a planted one), so a
// leg makes no live request. Every other host passes through. Each answer is logged to SHIM_766_LOG.
"use strict";

const fs = require("node:fs");

const FILE = process.env.SHIM_766_YAML;
const LOG = process.env.SHIM_766_LOG;

if (FILE && LOG) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function shim766Fetch(input, init) {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    let u;
    try {
      u = new URL(href);
    } catch {
      return realFetch(input, init);
    }
    if (u.hostname !== "raw.githubusercontent.com" || !u.pathname.endsWith("/committee-membership-current.yaml")) return realFetch(input, init);
    const body = fs.readFileSync(FILE, "utf8");
    fs.appendFileSync(LOG, `${new Date().toISOString()} pid ${process.pid} 200 ${u.href} <- ${FILE} (${Buffer.byteLength(body)} bytes)\n`);
    return new Response(body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  };
}
