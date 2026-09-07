/**
 * HO 700 — the DEV-MODE ARM: can development React name the node that fires #418?
 *
 * THE ONE THING PRODUCTION CANNOT DO. Every prod fire in this arc is
 * `Minified React error #418 … args[]=HTML` — the STRUCTURAL variant — and that
 * string is byte-identical for every structural mismatch anywhere in the app
 * (589 M1/M2: the component-naming `%s` is DEV-only; the prod `react-dom` bundle
 * contains zero occurrences of the template). So no amount of prod instrumenting
 * can turn a fire into a component name. Development React appends the owner
 * tree, and that is the entire reason this arm exists.
 *
 * WHY THERE IS SOMETHING TO POINT IT AT. Until HO 697 this repo had no tree that
 * fired on demand, so a dev-mode probe would have been a fishing trip. `40c3397`
 * (`ho697-prefix-clock`) fired 3 · 3 on consecutive local production crawls while
 * `main` read 0 · 0 in the same window. HO 700 STEP 0 re-measured it at a
 * different hour: amplifier 1 · 1, `main` 0 · 2 — the amplifier still fires, and
 * `main`'s own rate is NOT zero at this hour, which is why the control leg below
 * is run interleaved rather than assumed quiet.
 *
 * CONTROL(+0) ONLY, AND THAT IS THE POINT. The 590 harness has manufactured-skew
 * arms; they are deliberately NOT used here. This arm asks whether the tree fires
 * ON ITS OWN in dev, because a fire that needs a manufactured clock proves a
 * latent bug (which 589/590 already established and fixed) rather than the prod
 * mechanism. `page.clock.install` is never called.
 *
 * `ownerFrames` / `variantOf` are LIFTED from
 * `scripts/diagnostic/hydration-clock-harness-590.ts:66` / `:71`, not imported —
 * that module calls `main()` at top level and `process.exit`s (`:280`), so any
 * import of it runs the whole harness and terminates this process. The two
 * functions are pure and copied verbatim; the skew arms are not.
 *
 * READINGS ARE THREE, AND ALL THREE ARE A RESULT:
 *   - fires in dev WITH an owner tree  → the node is named; the rest is confirmation
 *   - never fires in dev while production mode does → dev-mode timing hides the
 *     class; recorded as a property of the class, not as a null result
 *   - fires on `main` too → the same-hour control read; the tree it names is the
 *     finding either way
 *
 * MEASURED 2026-09-07, 17:47-18:20Z, `next dev` of both trees, control(+0):
 *
 *   pass 1, the handoff's five routes, N=10
 *     amplifier(40c3397)  0 fires / 100 navs
 *     main(15cde5e)       0 fires / 100 navs
 *   pass 2, re-aimed at the routes that ACTUALLY fired in production mode
 *     (`/amendments`, `/reports/…`, `/electoral`, `/dashboard-v2`,
 *      `/committee/…`, `/bill/…`, `/lobbying`, `/members/…`), N=5
 *     amplifier(40c3397)  0 fires / 80 navs
 *     main(15cde5e)       0 fires / 80 navs
 *
 * THE SECOND READING, and it is not a null result. In the SAME hour and against
 * the SAME two trees, PRODUCTION-mode crawls fired: amplifier 1 · 1 (and 4 in a
 * later run), `main` 0 · 2. Dev mode read 0 in 360 navigations. So the class is
 * hidden by development-mode timing — which also means development React can
 * never be pointed at it, and the ONE thing production cannot do (name the
 * component) stays undone by the one build that could have done it. That is the
 * finding this file exists to record; the arm did not name a node, and saying so
 * is the result rather than a failure to report.
 *
 * DO NOT re-run this expecting a different answer without first changing what
 * makes dev differ — a fire needs the production build's hydration timing, so a
 * dev-mode arm is measured-dead for this class, not merely unlucky.
 *
 *   npx tsx scripts/diagnostic/pageerr-dev-700.ts
 *   AMP_URL=http://localhost:3102 MAIN_URL=http://localhost:3103 npx tsx scripts/diagnostic/pageerr-dev-700.ts
 *
 * Target: `next dev` of each tree (NOT `next start` — a production build has no
 * owner tree to give). Bind-check both ports before trusting a reading.
 */
import { chromium, type BrowserContext } from "@playwright/test";

const AMP_URL = process.env.AMP_URL ?? "http://localhost:3102";
const MAIN_URL = process.env.MAIN_URL ?? "http://localhost:3103";
const N = Number(process.env.N ?? 10);
// THE DEFAULT LIST IS THE HANDOFF'S; THE OVERRIDE IS WHY IT IS OVERRIDABLE.
// HO 700's handoff fixed these five routes before STEP 0 measured which routes
// actually fire, and the measurement disagreed: the amplifier's production-mode
// fires landed on `/amendments`, `/reports/…`, `/electoral`, `/primaries`,
// `/committee/…`, `/races` and `/dashboard-v2` — only the last is on this list.
// A dev arm that reads zero on routes which read zero in production mode either
// way has measured almost nothing, so the second pass re-aims at the observed
// firing set. Both readings are reported; neither replaces the other.
const ROUTES = (process.env.ROUTES ?? "/,/dashboard-v2,/president,/members,/bills")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);
const SETTLE_MS = 2_500;

// Same matcher as the 590 harness — dev phrasing first, minified second, and the
// legacy React 18 wording third so a mixed reading is not silently dropped.
const HYDRATION_RE =
  /Hydration failed because the server rendered|Minified React error #418|did not match the client/i;

/** LIFTED from hydration-clock-harness-590.ts:71 — see header for why not imported. */
function variantOf(msg: string): "HTML" | "text" | null {
  if (/server rendered HTML/i.test(msg)) return "HTML";
  if (/server rendered text/i.test(msg)) return "text";
  return null;
}

/** LIFTED from hydration-clock-harness-590.ts:66 — see header for why not imported. */
function ownerFrames(msg: string): string[] {
  return msg
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^<[A-Za-z][\w.]*/.test(l) || l === "...");
}

/**
 * The first frame that is an APP component rather than a host element. React's
 * dev owner tree interleaves both (`<div>` beside `<HeaderBar>`); the uppercase
 * initial is the discriminator, because JSX resolves a lowercase tag to a host
 * element by construction. Returns null when the tree is all host elements —
 * which is itself worth printing, not worth hiding.
 */
function firstAppComponent(frames: string[]): string | null {
  return frames.find((f) => /^<[A-Z]/.test(f)) ?? null;
}

type Fire = {
  tree: string;
  route: string;
  hit: 1 | 2;
  loop: number;
  at: string;
  variant: "HTML" | "text" | null;
  message: string;
  ownerTree: string[];
  firstApp: string | null;
};

async function runOne(
  ctx: BrowserContext,
  base: string,
  route: string,
): Promise<{ messages: string[] }> {
  const page = await ctx.newPage();
  const messages: string[] = [];
  // BOTH channels: dev React reports the recoverable hydration error through
  // console.error as well as through the error event, and the console copy is
  // the one that carries the component diff on some paths.
  page.on("pageerror", (e) => messages.push(e.message + (e.stack ? "\n" + e.stack : "")));
  page.on("console", (m) => {
    if (m.type() === "error") messages.push(m.text());
  });
  try {
    await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(SETTLE_MS);
  } catch {
    /* dev-server compile hiccup — record nothing for this nav, keep going */
  }
  await page.close();
  return { messages: messages.filter((m) => HYDRATION_RE.test(m)) };
}

async function runTree(label: string, base: string): Promise<Fire[]> {
  const browser = await chromium.launch();
  const fires: Fire[] = [];
  let navs = 0;
  for (let loop = 1; loop <= N; loop++) {
    for (const route of ROUTES) {
      // A FRESH CONTEXT PER ROUTE-PAIR, so hit 2 is a genuine second hit against
      // a warm server and not a same-context reload. Matches the crawl's shape.
      const ctx = await browser.newContext();
      await ctx.addCookies([{ name: "ct_seen", value: "1", url: base }]);
      for (const hit of [1, 2] as const) {
        const { messages } = await runOne(ctx, base, route);
        navs++;
        if (!messages.length) continue;
        const msg = messages[0]!;
        const frames = ownerFrames(msg);
        fires.push({
          tree: label,
          route,
          hit,
          loop,
          at: new Date().toISOString(),
          variant: variantOf(msg),
          message: msg,
          ownerTree: frames,
          firstApp: firstAppComponent(frames),
        });
        // eslint-disable-next-line no-console
        console.log(
          `  FIRE ${label} ${route} hit${hit} loop${loop} variant=${variantOf(msg)} ` +
            `firstApp=${firstAppComponent(frames) ?? "none"} frames=${frames.length}`,
        );
      }
      await ctx.close();
    }
    // eslint-disable-next-line no-console
    console.log(`  ${label} loop ${loop}/${N} done — ${fires.length} fires in ${navs} navs`);
  }
  await browser.close();
  return fires;
}

async function main() {
  for (const [label, base] of [
    ["amplifier(40c3397)", AMP_URL],
    ["main", MAIN_URL],
  ] as const) {
    if (!/^http:\/\/localhost:/.test(base)) {
      // eslint-disable-next-line no-console
      console.log(`REFUSING non-localhost target "${base}" for ${label}.`);
      process.exit(1);
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `HO 700 dev arm — control(+0) only, N=${N}, ${ROUTES.length} routes × 2 hits per loop\n` +
      `  amplifier ${AMP_URL}\n  main      ${MAIN_URL}\n`,
  );

  const all: Fire[] = [];
  for (const [label, base] of [
    ["amplifier(40c3397)", AMP_URL],
    ["main", MAIN_URL],
  ] as const) {
    // eslint-disable-next-line no-console
    console.log(`── ${label} (${base}) ${new Date().toISOString()}`);
    all.push(...(await runTree(label, base)));
  }

  // eslint-disable-next-line no-console
  console.log("\n═══ RESULT ═══");
  for (const label of ["amplifier(40c3397)", "main"]) {
    const f = all.filter((x) => x.tree === label);
    const total = N * ROUTES.length * 2;
    // eslint-disable-next-line no-console
    console.log(`${label}: ${f.length} fires in ${total} navs`);
    for (const x of f) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${x.at} ${x.route} hit${x.hit} loop${x.loop} variant=${x.variant} ` +
          `firstApp=${x.firstApp ?? "none"}`,
      );
      // THE FULL DEV MESSAGE AND TREE, never a truncation — the whole reason this
      // arm exists is the part a truncation would cut.
      // eslint-disable-next-line no-console
      console.log(`    ownerTree: ${x.ownerTree.join(" ") || "(none)"}`);
      // eslint-disable-next-line no-console
      console.log(`    message: ${x.message.replace(/\n/g, "\n      ")}`);
    }
  }
  if (!all.length) {
    // eslint-disable-next-line no-console
    console.log(
      "\nNO FIRES ON EITHER TREE. This is a reading, not a null result: production\n" +
        "mode fires on the amplifier at this hour (STEP 0 rows 2/3), so dev-mode\n" +
        "timing hides the class — record it and let the durable arm carry the HO.",
    );
  }
}

main();
