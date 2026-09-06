// HO 697 — the capture set and the two readings for the masthead tag + clock.
//
// NOT a section of `chrome-shots-690.ts`, deliberately: that file's sections are
// named for HO 690's four subjects (nav | stack | summary | portrait) and adding
// a fifth would make its own header lie about its scope. This one owns HO 697's
// subject — the `IN BETA` tag and the live clock on both mastheads — and the two
// numbers the STEP 0 rows turned on.
//
// TRACKED because findings rest on it (HO 672 rule, applied at the HO 697 STEP 0
// ruling §6): the captures are the evidence for the placement ruling, the `sizes`
// reading is what showed the tag matching its row's neighbours and `/welcome`
// dropping 13px -> 12px, and the `narrow` reading is a NEGATIVE finding that
// decided not to build a `dateClassName` prop. A probe that decided something
// does not live in scratch/.
//
// Sections (argv[2], default "all"):
//   shots  — masthead crops, / /bills /members /welcome at 1440 and 430, plus a
//            SEPARATE reduced-motion pass (a different layout, not a dimmer one)
//   sizes  — computed font-size of the tag vs its row neighbours, per page; the
//            question is whether the tag matches its row, not whether the rows
//            match each other
//   narrow — documentElement scrollWidth vs clientWidth at 430 on the routes
//            whose LAST SYNC line the clock lengthened
//
// READINGS, 2026-09-06, local production build, C1 + C2:
//   sizes   / tag 11px vs row 11px · /bills tag 16px vs row 16px ·
//           /welcome tag 13px pad 5px 0px, tag box 23px, rail 52px @1440 /
//           80.5px @430. The tag matches its own row everywhere; the 11-vs-16
//           gap between mastheads is their pre-existing rungs.
//   narrow  430: / 430/430 · /bills 430/430 · /members 430/430 ·
//           /welcome 430/430 — all clear, so no dateClassName prop was built.
//   shots   animation-name betafade normally, `none` under reduced motion, on
//           all three pages; clock present on both mastheads, absent from
//           /welcome's rail selector because that page uses the module's class.
//
// THE CLOCK ARM THIS MEASURED IS HELD. `sizes` and `shots` still report the
// masthead clock's selectors; on the shipped tree they read null, because the
// mount was built, measured and held at HO 697 (11 fires / 9 clock-bearing
// crawls against 0 / 6 without). The selectors stay so the probe can be pointed
// at `ho697-clock` without being rewritten.
//
// Usage: npx tsx scripts/diagnostic/chrome-shots-697.ts [section] [baseUrl] [outDir]
// Target: `npm run build && npx next start -p 3000` (never `next dev`).
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const SECTION = process.argv[2] ?? "all";
const BASE = process.argv[3] ?? process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[4] ?? "docs/handoffs/697-artifacts";
const TAG = process.env.TAG ?? "c1";

const SHOTS = [
  { slug: "home", path: "/", w: 1440 },
  { slug: "home", path: "/", w: 430 },
  { slug: "bills", path: "/bills", w: 1440 },
  { slug: "bills", path: "/bills", w: 430 },
  { slug: "members", path: "/members", w: 1440 },
  { slug: "members", path: "/members", w: 430 },
  { slug: "welcome", path: "/welcome", w: 1440 },
  { slug: "welcome", path: "/welcome", w: 430 },
];

/** The 430 set the clock could have pushed over. /members is the roster route
 *  HO 694 fixed at this width, so it is the one most likely to be tight. */
const NARROW = ["/", "/bills", "/members", "/welcome"];

async function ctxPage(browser: Browser, reduced: boolean): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await ctx.addCookies([
    { name: "ct_seen", value: "1", domain: "localhost", path: "/" },
  ]);
  return ctx.newPage();
}

async function shots(browser: Browser): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const rm of [false, true]) {
    const page = await ctxPage(browser, rm);
    for (const s of SHOTS) {
      if (rm && s.w !== 1440) continue;
      await page.setViewportSize({ width: s.w, height: 900 });
      await page.goto(`${BASE}${s.path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const name = `${TAG}-${s.slug}-${s.w}${rm ? "-rm" : ""}.png`;
      await page.screenshot({
        path: `${OUT}/${name}`,
        clip: { x: 0, y: 0, width: s.w, height: s.w === 430 ? 340 : 240 },
      });
      const m = await page.evaluate(() => {
        const tag = document.querySelector<HTMLElement>(".beta-tag");
        const clock = document.querySelector<HTMLElement>(".masthead-clock");
        const cs = tag ? getComputedStyle(tag) : null;
        return {
          tagText: tag?.textContent ?? null,
          anim: cs?.animationName ?? null,
          size: cs?.fontSize ?? null,
          pad: cs?.padding ?? null,
          clock: (clock?.textContent ?? "").trim() || null,
        };
      });
      console.log(
        `${name.padEnd(28)} tag=${JSON.stringify(m.tagText)} anim=${m.anim} ` +
          `size=${m.size} pad=${m.pad} clock=${JSON.stringify(m.clock)}`,
      );
    }
    await page.context().close();
  }
}

async function sizes(browser: Browser): Promise<void> {
  const page = await ctxPage(browser, false);
  for (const [slug, path] of [
    ["home", "/"],
    ["bills", "/bills"],
    ["welcome", "/welcome"],
  ] as const) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    // No nested named function inside evaluate — tsx injects a `__name` helper
    // that does not exist in the page context and the call throws there.
    const r = await page.evaluate(() => {
      const sel: Record<string, string> = {
        tag: ".beta-tag",
        row: ".header-titlebar-auth, .home-header-meta",
        sync: ".header-sync-sub, .home-header-meta",
        clock: ".masthead-clock, [class*='clock']",
        brand: ".breadcrumb-path",
      };
      const out: Record<string, string | null> = {};
      for (const k of Object.keys(sel)) {
        const el = document.querySelector<HTMLElement>(sel[k] as string);
        out[k] = el ? getComputedStyle(el).fontSize : null;
      }
      const tag = document.querySelector<HTMLElement>(".beta-tag");
      out["tagPad"] = tag ? getComputedStyle(tag).padding : null;
      // Geometry, not just the declaration: the HO 697 STEP 0 ruling asks that
      // the rail's HEIGHT match its pre-HO capture, which a font-size readback
      // alone does not show.
      out["tagH"] = tag ? String(+tag.getBoundingClientRect().height.toFixed(2)) : null;
      out["rowH"] = tag?.parentElement
        ? String(+tag.parentElement.getBoundingClientRect().height.toFixed(2))
        : null;
      out["fs13"] = getComputedStyle(document.documentElement)
        .getPropertyValue("--fs-13")
        .trim();
      return out;
    });
    console.log(`${slug.padEnd(9)} ${JSON.stringify(r)}`);
  }
  await page.context().close();
}

async function narrow(browser: Browser): Promise<void> {
  const page = await ctxPage(browser, false);
  await page.setViewportSize({ width: 430, height: 900 });
  let over = 0;
  for (const path of NARROW) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const m = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    const d = m.doc - m.client;
    if (d > 1) over++;
    console.log(
      `430 ${path.padEnd(10)} doc ${m.doc}/${m.client}${d > 1 ? `  OVER ${d}` : "  clear"}`,
    );
  }
  console.log(
    over === 0
      ? "\nNo route over at 430 — the clock did not push any LAST SYNC line out,\n" +
          "so the dateClassName prop is NOT built (a prop for an overflow that does\n" +
          "not happen is unrequested surface)."
      : `\n${over} route(s) over — the conditional fires; build dateClassName.`,
  );
  await page.context().close();
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  if (SECTION === "shots" || SECTION === "all") await shots(browser);
  if (SECTION === "sizes" || SECTION === "all") await sizes(browser);
  if (SECTION === "narrow" || SECTION === "all") await narrow(browser);
  await browser.close();
}

main();
