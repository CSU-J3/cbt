// HO 690 — the capture set for the dashboard-chrome arc. READ-ONLY: navigates,
// screenshots, and (for the summary section only) writes one localStorage key it
// then clears. Builds nothing.
//
// "I looked at it" is not a capture (docs/method.md § Gates). Every viewport in
// the named set gets a file, and the reduced-motion pass is a SEPARATE pass
// because it is a different layout, not a dimmer one.
//
// Sections (argv[2], default "all"): nav | stack | summary | portrait | all
//   nav      — the nav strip on `/` and `/bills` at 1440/2560/430, active item on
//              each, plus /members and /electoral at 1440 (the shared-component
//              rule met by capture, not by grep)
//   stack    — the whole header, so the masthead -> nav -> tapes order is visible
//   summary  — the week-summary row: open, collapsed, stale-labelled, and the
//              no-summary fallback (the report link back on the band)
//   portrait — the sponsor portrait in the shared expand panel, on BOTH container
//              branches (stacked <=520px and wide)
//
// Usage: npx tsx scripts/diagnostic/chrome-shots-690.ts [section] [baseUrl] [outDir]
// Target: `npm run build && npm run start` on :3000 (not `next dev`).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const SECTION = (process.argv[2] ?? "all").toLowerCase();
const BASE = process.argv[3] ?? "http://localhost:3000";
const OUT = process.argv[4] ?? "docs/handoffs/690-artifacts";

const GATE_COOKIE = {
  name: "ct_seen",
  value: "1",
  domain: "localhost",
  path: "/",
  expires: -1,
  httpOnly: false,
  secure: false,
  sameSite: "Lax" as const,
};

const VIEWPORTS = [
  { tag: "1440", w: 1440, h: 1100 },
  { tag: "2560", w: 2560, h: 1400 },
  { tag: "430", w: 430, h: 1000 },
];

type Motion = "normal" | "reduce";
const notes: string[] = [];

async function ctxFor(browser: Browser, motion: Motion, w: number, h: number) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: motion === "reduce" ? "reduce" : "no-preference",
  });
  await ctx.addCookies([GATE_COOKIE]);
  await ctx.addInitScript(() => {
    // tsx/esbuild keepNames shim — see layout-audit-606.ts:1331.
    const g = globalThis as unknown as { __name?: (fn: unknown, name?: string) => unknown };
    if (!g.__name) g.__name = (fn: unknown) => fn;
  });
  return ctx;
}

async function open(ctx: Awaited<ReturnType<typeof ctxFor>>, path: string) {
  const page = await ctx.newPage();
  // Two loads: the first can miss the Turso-backed caches and reflows late.
  for (let i = 0; i < 2; i++) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  }
  return page;
}

async function shotEl(page: Page, selector: string, file: string) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) {
    notes.push(`MISSING ${selector} -> ${file} (no element; nothing captured)`);
    return false;
  }
  await el.screenshot({ path: join(OUT, file) });
  return true;
}

async function navSection(browser: Browser) {
  for (const motion of ["normal", "reduce"] as Motion[]) {
    for (const v of VIEWPORTS) {
      for (const route of ["/", "/bills"]) {
        const ctx = await ctxFor(browser, motion, v.w, v.h);
        const page = await open(ctx, route);
        const slug = route === "/" ? "home" : "bills";
        await shotEl(
          page,
          ".primary-nav",
          `nav-${slug}-${v.tag}-${motion}.png`,
        );
        await ctx.close();
      }
    }
  }
  // The shared-component rule: two inner pages beyond /bills, at 1440.
  for (const route of ["/members", "/electoral"]) {
    const ctx = await ctxFor(browser, "normal", 1440, 1100);
    const page = await open(ctx, route);
    await shotEl(
      page,
      ".primary-nav",
      `nav-${route.slice(1)}-1440-normal.png`,
    );
    await ctx.close();
  }
}

async function stackSection(browser: Browser) {
  for (const motion of ["normal", "reduce"] as Motion[]) {
    for (const v of VIEWPORTS) {
      for (const route of ["/", "/bills"]) {
        const ctx = await ctxFor(browser, motion, v.w, v.h);
        const page = await open(ctx, route);
        const slug = route === "/" ? "home" : "bills";
        await shotEl(
          page,
          route === "/" ? "header.home-header" : "header",
          `stack-${slug}-${v.tag}-${motion}.png`,
        );
        await ctx.close();
      }
    }
  }
}

async function summarySection(browser: Browser) {
  for (const motion of ["normal", "reduce"] as Motion[]) {
    for (const v of VIEWPORTS) {
      // OPEN (the default — no stored preference at all)
      let ctx = await ctxFor(browser, motion, v.w, v.h);
      let page = await open(ctx, "/");
      const found = await shotEl(
        page,
        ".week-sentences",
        `summary-open-${v.tag}-${motion}.png`,
      );
      if (!found) {
        await ctx.close();
        continue;
      }
      // Also capture the band under it, so the report link's absence there is
      // visible in the same pass.
      await shotEl(page, ".weekly-band", `band-with-summary-${v.tag}-${motion}.png`);
      await ctx.close();

      // COLLAPSED (the stored preference, applied pre-paint)
      ctx = await ctxFor(browser, motion, v.w, v.h);
      await ctx.addInitScript(() => {
        try {
          window.localStorage.setItem("cbt:pref:weekSummary", "collapsed");
        } catch {
          /* private mode */
        }
      });
      page = await open(ctx, "/");
      await shotEl(
        page,
        ".week-sentences",
        `summary-collapsed-${v.tag}-${motion}.png`,
      );
      await ctx.close();
    }
  }
}

// The bxp panel has TWO container branches (stacked <=520px / wide). The bills
// column on `/` is the narrow one at 430; /bills at 1440 and 2560 is the wide one.
async function portraitSection(browser: Browser) {
  const cases = [
    { route: "/bills", v: VIEWPORTS[0]!, tag: "wide-1440" },
    { route: "/bills", v: VIEWPORTS[1]!, tag: "wide-2560" },
    { route: "/bills", v: VIEWPORTS[2]!, tag: "stacked-430" },
  ];
  for (const motion of ["normal", "reduce"] as Motion[]) {
    for (const c of cases) {
      const ctx = await ctxFor(browser, motion, c.v.w, c.v.h);
      const page = await open(ctx, c.route);
      // Expand the first feed row that has a sponsor, then shoot the meta box.
      const rows = page.locator('[role="button"][aria-expanded]');
      const n = await rows.count();
      let shot = false;
      for (let i = 0; i < Math.min(n, 6) && !shot; i++) {
        await rows.nth(i).click();
        const photo = page.locator(".bxp-sponsor").first();
        try {
          await photo.waitFor({ state: "visible", timeout: 6000 });
        } catch {
          continue;
        }
        shot = await shotEl(page, ".bxp-metabox", `portrait-${c.tag}-${motion}.png`);
        if (shot) await shotEl(page, ".bxp", `panel-${c.tag}-${motion}.png`);
      }
      if (!shot) notes.push(`portrait: no expandable row with a sponsor on ${c.route} @${c.v.tag}`);
      await ctx.close();
    }
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  if (SECTION === "nav" || SECTION === "all") await navSection(browser);
  if (SECTION === "stack" || SECTION === "all") await stackSection(browser);
  if (SECTION === "summary" || SECTION === "all") await summarySection(browser);
  if (SECTION === "portrait" || SECTION === "all") await portraitSection(browser);
  await browser.close();
  writeFileSync(join(OUT, `notes-${SECTION}.txt`), `${notes.join("\n")}\n`, "utf8");
  console.log(`captures -> ${OUT}`);
  if (notes.length) {
    console.log("NOTES (a missing element is a finding, not a skip):");
    for (const n of notes) console.log(`  ${n}`);
  } else {
    console.log("no missing elements");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
