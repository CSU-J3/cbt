// HO 744 legs — preload for the LOCAL `next start` server only, loaded through
// NODE_OPTIONS=--require by scripts/diagnostic/ratings-hang-legs-744.ts. Never
// loaded by the app, the build, or anything deployed.
//
// It points ONE chamber's widget fetch at a local TCP server that accepts the
// connection and never answers, and passes every other fetch through untouched
// (the other chamber's page and widget are live Ballotpedia). The caller's
// `init` is passed on as-is, so whatever signal fetchHtml attached is the one
// that has to end the wait: this replaces the host, never the timeout.
"use strict";

const target = process.env.HANG_744_TARGET;
const port = process.env.HANG_744_PORT;

if (target && port) {
  const want =
    target === "senate" ? "office_type=Senate" : target === "house" ? "office_type=House" : null;
  if (!want) throw new Error(`HANG_744_TARGET must be senate|house, got ${target}`);

  const realFetch = globalThis.fetch;
  globalThis.fetch = function hang744Fetch(input, init) {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
    if (typeof url === "string" && url.includes("race-ratings-full-table") && url.includes(want)) {
      // A Request carries its own signal; keep it if init does not.
      const signal = (init && init.signal) || (input && typeof input === "object" && input.signal) || undefined;
      console.log(
        `[hang-744] ${target} widget fetch -> 127.0.0.1:${port} (accepts, never answers); ` +
          `caller passed a signal: ${Boolean(init && init.signal)}`,
      );
      return realFetch(`http://127.0.0.1:${port}/hang-744`, { ...(init || {}), signal });
    }
    return realFetch(input, init);
  };
  console.log(`[hang-744] preload armed in pid ${process.pid}: ${target} widget -> 127.0.0.1:${port}`);
}
