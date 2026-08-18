// HO 670 (review) — a rows_read tap for a RUNNING Next server, not a probe harness.
//
// The cold figure came from calling the query functions directly with an
// always-miss cache stub. That answers "what does this page cost to generate",
// and it cannot answer "what does a warm request cost", because the answer to the
// second question depends on Next's real Data Cache — which lives in
// .next/cache, survives the request, and is exactly the thing a stub replaces.
//
// So: preload this into the server process via NODE_OPTIONS=--require, patch the
// global fetch that lib/db.ts's boundedFetch calls, and write the running total
// to a file after every Turso pipeline response. Read the file before and after a
// request and the delta is that request's rows_read. NODE_OPTIONS is used rather
// than `node --require` so any child process Next spawns inherits the tap.
//
//   ROWS_TAP_FILE=/tmp/tap.json NODE_OPTIONS="--require ./scripts/diagnostic/rows-tap-670.cjs" npx next start -p 3120
const fs = require("node:fs");

const file = process.env.ROWS_TAP_FILE;
if (file && typeof globalThis.fetch === "function") {
  let rows = 0;
  let statements = 0;
  let responses = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const res = await real(input, init);
    try {
      const j = await res.clone().json();
      let sawPipeline = false;
      for (const r of j.results ?? []) {
        const rr = r?.response?.result?.rows_read;
        if (typeof rr === "number") {
          rows += rr;
          statements += 1;
          sawPipeline = true;
        }
      }
      if (sawPipeline) {
        responses += 1;
        fs.writeFileSync(file, JSON.stringify({ rows, statements, responses }));
      }
    } catch {
      /* not a Turso pipeline response */
    }
    return res;
  };
  fs.writeFileSync(file, JSON.stringify({ rows: 0, statements: 0, responses: 0 }));
}
// NOTHING is printed here on purpose. NODE_OPTIONS applies to every node process
// in the chain, including the one npm/npx runs to resolve its own prefix, and npm
// PARSES that process's stdout — a single console.log in this preload makes npm
// try to require the log line as a module path. Cost: one dead server start.
