// HO 702 — the router-seam interventions, AND THE GATE FOR HO 704's FIX.
//
// TRACKED, not disposable: HO 704's candidate (a) — an explicit <Suspense>
// around {children} in the root layout — is gated by exactly this pair, and a
// gate that lives in a repo-ignored scratch directory is a gate the next HO
// cannot run. Deviation from the ruling's commit list, named here: it lists
// only the patch script under `chore`, but §2 of the same ruling makes this
// harness HO 704's gate.
//
// WHAT IT ESTABLISHED (main's build, unpatched, one window 00:42-00:53Z
// 2026-09-08, 36 routes per mode, TIMEOUTS=0 throughout):
//
//   control  FIRES=0    HYD-BEFORE-TAIL=25  hyd-after-tail=11
//   t2       FIRES=10   HYD-BEFORE-TAIL=35  hyd-after-tail=1
//   t2t1'    FIRES=0    HYD-BEFORE-TAIL=0   hyd-after-tail=36
//
// Hydration starting before the flight tail is NECESSARY, NOT SUFFICIENT: all
// ten fires carried it, no hit with the reverse order has ever fired (47 such
// hits, zero fires), and removing the condition by construction removed every
// fire — but 25 quiet control hits carried it without firing. It opens the
// window; it does not predict the fire.
//
// HYPOTHESIS (702-router-seam-ruling.md §1): during initial hydration React
// reaches `InnerLayoutRouter` for the page segment while that segment's RSC is
// still a pending thenable, because the flight-data `<script>` chunks are in
// the parser's tail. `use(rsc)` (layout-router.js:276) suspends; when the chunk
// lands React REPLAYS the suspended unit, and at the root there is no Suspense
// boundary to reset the hydration cursor, so the replayed host fiber claims
// against a cursor the first attempt already advanced.
//
// T1 AS SPECIFIED CANNOT FAIL, AND THAT IS WHY THE MODES ARE COMPOSED.
// T1 predicts "fires -> 0". The resting rate measured immediately before this
// was 0 fires in 216 hits, so T1 alone reads the same whether the mechanism is
// real or not (docs/method.md § Gates). So T1 is run ON TOP OF T2: T2 must
// RAISE the rate, and T2+T1 must collapse it. Two directions, both against a
// baseline that is not already at the floor.
//
//   mode=control   nothing
//   mode=t2        throttle DOWNLOAD hard, JS already cached  -> expect MANY fires
//   mode=t2t1      t2 + every JS chunk HELD UNTIL DOMContentLoaded -> expect 0 fires
//                  (hydration starts after the tail BY CONSTRUCTION:
//                   HYD-BEFORE-TAIL reads 0 of 36 in this mode. The earlier
//                   500ms version could not collapse anything — under t2 the
//                   document streams for seconds, so a half-second hold still
//                   started hydration mid-parse.)
//
// Usage: npx tsx scripts/diagnostic/seam-intervene-702.ts <base> <mode> [routes…]
import { chromium, type Page } from "@playwright/test";
import { ROUTES } from "../../e2e/routes";

const BASE = process.argv[2];
const MODE = process.argv[3] ?? "control";
if (!BASE || !/^https?:\/\/(localhost|127\.0\.0\.1):/.test(BASE)) {
  console.error("refusing: localhost only");
  process.exit(1);
}
if (!["control", "t2", "t2t1"].includes(MODE)) {
  console.error(`unknown mode ${MODE}`);
  process.exit(1);
}
const PICK = process.argv.slice(4);
const LIST = PICK.length ? ROUTES.filter((r: { slug: string }) => PICK.includes(r.slug)) : ROUTES;

// Same observer contract as Arm A, trimmed to what the interventions read:
// fire-t, dcl, and T3's last-flight.
const INIT = `
(() => {
  const w = window;
  w.__t = { fireT: null, dclT: null, lastFlightT: null, flight: 0, firstPostT: null, hydStartT: null };
  // HO 702 §1 CORRECTED COMPARATOR. The original T3 asked "last-flight > fire-t",
  // but §1 predicts the fire IS the replay, which happens after the thenable
  // resolves, which happens after the last flight script runs — so
  // last-flight < fire-t is what §1 predicts, and TAIL-AFTER-FIRE could never
  // have read true under the mechanism it was meant to test. The comparator §1
  // actually needs is HYDRATION START against last-flight: did the app chunk
  // begin executing before the parser finished the tail? first-post-t is a
  // COMMIT, not a start. self.webpackChunk_N_E is assigned by the first app
  // chunk to evaluate, so trapping its definition stamps the start once.
  // NO BACKTICKS IN HERE: this comment lives inside a template literal and
  // a backtick terminates it. tsconfig excludes scripts/diagnostic/scratch,
  // so tsc cannot catch it either — the runtime is the only gate.
  try {
    let _v;
    Object.defineProperty(w, "webpackChunk_N_E", {
      configurable: true,
      get() { return _v; },
      set(v) { if (w.__t.hydStartT === null) w.__t.hydStartT = performance.now(); _v = v; },
    });
  } catch (e) {}
  addEventListener("error", (e) => {
    const m = (e && e.message) || "";
    if (w.__t.fireT === null && /418/.test(m)) w.__t.fireT = performance.now();
  }, true);
  document.addEventListener("DOMContentLoaded", () => { w.__t.dclT = performance.now(); });
  const o = new MutationObserver((recs) => {
    const t = performance.now();
    if (document.readyState !== "loading" && w.__t.firstPostT === null) w.__t.firstPostT = t;
    for (const r of recs) {
      const seen = r.type === "characterData" ? [r.target] : [...r.addedNodes];
      for (const nd of seen) {
        try {
          const txt = nd.nodeType === 1 ? (nd.tagName === "SCRIPT" ? nd.textContent : "") : nd.data;
          if (String(txt || "").indexOf("self.__next_f.push") === 0) { w.__t.lastFlightT = t; w.__t.flight++; }
        } catch (e) {}
      }
    }
  });
  o.observe(document, { childList: true, subtree: true, characterData: true });
})();
`;

async function applyT2(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  // Download hard-throttled; JS is already cached from the warm pass, so what
  // arrives slowly is the DOCUMENT and its flight tail — exactly the condition
  // §1 says produces the race.
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 20,
    // Rate chosen so the tail is genuinely starved but the page still LOADS:
    // at 8 KB/s (64 kbit) /members needs ~293s against a 60s goto timeout, so
    // that reading would have been "timeout", not "no fire". Measured sizes:
    // /members 2.41MB, / 507KB, /changes 668KB. KBPS is overridable.
    downloadThroughput: (Number(process.env.T2_KBPS ?? 1500) * 1024) / 8,
    uploadThroughput: (1024 * 1024) / 8,
  });
}

async function applyT1(page: Page) {
  // T1' — CALIBRATED. The original 500ms was sized for an unthrottled tail;
  // under t2 the document streams for SECONDS (/members ~13s at 1500 kbit/s),
  // so a half-second hold still starts hydration mid-parse and "t2t1 did not
  // collapse" is what §1 predicts too. Holding until `domcontentloaded` makes
  // hydration start after the tail is parsed BY CONSTRUCTION, at any throttle.
  await page.route("**/_next/static/chunks/**", async (route) => {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await route.continue().catch(() => {});
  });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(INIT);
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
  const page = await ctx.newPage();
  const msgs: string[] = [];
  page.on("pageerror", (e) => { if (/418/.test(e.message)) msgs.push(e.message); });

  let fires = 0;
  let hits = 0;
  let timeouts = 0;
  const rows: string[] = [];
  for (const r of LIST) {
    // hit 1 — always unmodified: it warms the JS cache, which every mode needs.
    await page.goto(BASE + r.path, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
    await page.waitForLoadState("load").catch(() => {});
    await page.waitForTimeout(1_500);

    if (MODE === "t2" || MODE === "t2t1") await applyT2(page);
    if (MODE === "t2t1") await applyT1(page);

    const before = msgs.length;
    // A HIT THAT TIMES OUT IS A THIRD STATE. Swallowing the goto rejection
    // made "never loaded" and "loaded, did not fire" the same output — which
    // is how the 64 kbit/s attempt would have reported a table of zeros for
    // routes that never rendered. TIMEOUT is printed per hit and counted
    // separately, so the two can never share an output again at any throttle.
    let timedOut = false;
    await page
      .goto(BASE + r.path, { waitUntil: "domcontentloaded", timeout: 60_000 })
      .catch(() => { timedOut = true; });
    if (!timedOut) await page.waitForLoadState("load").catch(() => { timedOut = true; });
    await page.waitForTimeout(2_500);
    hits++;
    if (timedOut) timeouts++;
    const t = (await page.evaluate(() => (window as never as { __t: Record<string, number | null> }).__t).catch(() => null)) as
      | { fireT: number | null; dclT: number | null; lastFlightT: number | null; flight: number; firstPostT: number | null; hydStartT: number | null }
      | null;
    const fired = msgs.length - before;
    fires += fired;
    if (t) {
      const rel = (x: number | null) => (x === null || t.dclT === null ? "n/a" : `${x - t.dclT >= 0 ? "+" : ""}${Math.round(x - t.dclT)}ms`);
      // §1 predicts HYD-BEFORE-TAIL on fires (hydration started while the tail
      // was still arriving) and hyd-after-tail on quiet hits.
      const order = t.hydStartT !== null && t.lastFlightT !== null
        ? (t.hydStartT < t.lastFlightT ? "HYD-BEFORE-TAIL" : "hyd-after-tail")
        : "n/a";
      rows.push(
        `  ${r.slug.padEnd(26)} ${timedOut ? "TIMEOUT" : `fired=${fired}`} fire-t=${rel(t.fireT)} hyd-start=${rel(t.hydStartT)} last-flight=${rel(t.lastFlightT)}/${t.flight} first-post=${rel(t.firstPostT)} dcl=${t.dclT === null ? "n/a" : Math.round(t.dclT)}ms  ${order}`,
      );
    }
    if (fired) for (const m of msgs.slice(before)) rows.push(`      ${m}`);

    // reset for the next route's warm pass
    if (MODE === "t2" || MODE === "t2t1") {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    if (MODE === "t2t1") await page.unroute("**/_next/static/chunks/**");
  }
  await browser.close();
  console.log(rows.join("\n"));
  console.log(
    `\nMODE=${MODE}  hits=${hits}  FIRES=${fires}  TIMEOUTS=${timeouts}` +
      (timeouts ? "  <- timeouts are NOT no-fires; the rate is too low to measure at" : ""),
  );
}
main();
