// HO 769 leg C's control: one planted row appended to one Google Sheet tab's CSV export, so the
// shipped scripts/sync-palestine.ts reads it as if the sheet held it. Loaded only by
// scripts/diagnostic/tracker-match-769.ts, through NODE_OPTIONS=--require, which reaches the
// process tsx starts. Inert unless both PLANT_ROW_GID and PLANT_ROW_CSV are set. Every other
// fetch, the other tab's included, passes through untouched.
"use strict";

const gid = process.env.PLANT_ROW_GID;
const line = process.env.PLANT_ROW_CSV;
if (gid && line && typeof globalThis.fetch === "function") {
  const real = globalThis.fetch;
  globalThis.fetch = async function plantShimFetch(input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const res = await real(input, init);
    if (!res.ok || !url.includes("export?format=csv") || !url.includes(`gid=${gid}`)) return res;
    const text = await res.text();
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const body = text.replace(/(\r?\n)+$/, "") + eol + line + eol;
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    process.stderr.write(`[tracker-plant-shim-769] appended to gid ${gid}: ${line}\n`);
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
  };
}
