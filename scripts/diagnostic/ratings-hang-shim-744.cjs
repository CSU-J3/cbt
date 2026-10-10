// HO 744 legs, retargeted at HO 770 — a preload for LOCAL processes only, loaded through
// NODE_OPTIONS=--require: the `next start` server of scripts/diagnostic/ratings-hang-legs-744.ts,
// and leg B's runner in scripts/diagnostic/ratings-source-770.ts. Never loaded by the app, the
// build, or anything deployed.
//
// Since HO 770 a ratings run makes one fetch, Sabato's rating-changes page, and both legs share it.
// This sends THAT fetch somewhere else and passes every other fetch through untouched:
//   HANG_770_MODE=hang        to a local TCP server (HANG_770_PORT) that accepts and never
//                             answers. The caller's `init` goes on as-is, so whatever signal
//                             fetchSource attached is the one that has to end the wait: this
//                             replaces the host, never the timeout (leg c1).
//   HANG_770_MODE=hang-nocap  the same host with the caller's signal DROPPED, which is the cap
//                             removed (leg c3, the control).
//   HANG_770_MODE=serve       answered 200 from a saved file (HANG_770_FILE), as served or
//                             mangled (leg c2; leg B).
// Each interception logs one line with the agent and Accept it was asked with, so a leg can count
// the page fetches a run made and see who made them. (HO 744 pointed one chamber's Ballotpedia
// widget fetch at the hung host; that transport is gone.)
"use strict";

const fs = require("node:fs");

const mode = process.env.HANG_770_MODE;
const TARGET = "centerforpolitics.org/crystalball/2026-rating-changes";

if (mode) {
  if (!["hang", "hang-nocap", "serve"].includes(mode)) {
    throw new Error(`HANG_770_MODE must be hang|hang-nocap|serve, got ${mode}`);
  }
  const port = process.env.HANG_770_PORT;
  const file = process.env.HANG_770_FILE;
  if (mode !== "serve" && !port) throw new Error("HANG_770_PORT is required to hang");
  if (mode === "serve" && !file) throw new Error("HANG_770_FILE is required to serve");

  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = function hang770Fetch(input, init) {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    if (typeof url === "string" && url.includes(TARGET)) {
      n++;
      // A Request carries its own signal; keep it if init does not.
      const signal = (init && init.signal) || (input && typeof input === "object" && input.signal) || undefined;
      const headers = new Headers((init && init.headers) || undefined);
      console.log(
        `[hang-770] page fetch #${n} (${mode}) · User-Agent ${JSON.stringify(headers.get("user-agent"))} · ` +
          `Accept ${JSON.stringify(headers.get("accept"))} · caller passed a signal: ${Boolean(init && init.signal)}`,
      );
      if (mode === "serve") {
        return Promise.resolve(
          new Response(fs.readFileSync(file), { status: 200, headers: { "content-type": "text/html; charset=UTF-8" } }),
        );
      }
      const host = `http://127.0.0.1:${port}/hang-770`;
      if (mode === "hang-nocap") {
        const rest = { ...(init || {}) };
        delete rest.signal;
        return realFetch(host, rest);
      }
      return realFetch(host, { ...(init || {}), signal });
    }
    return realFetch(input, init);
  };
  console.log(
    `[hang-770] preload armed in pid ${process.pid}: ${mode} ${TARGET}` +
      (mode === "serve" ? ` <- ${file}` : ` -> 127.0.0.1:${port}`),
  );
}
