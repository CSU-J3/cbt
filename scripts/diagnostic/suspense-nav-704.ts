// HO 704 — THE FALLBACK-FLASH GATE for a Suspense boundary above the page
// segment. Tracked, not disposable: any future boundary (candidate (C), a
// reshaped one with a designed fallback) is gated by exactly this, and a gate
// in a repo-ignored scratch directory is a gate the next HO cannot run.
//
// WHAT IT READS. Two client navigations driven through the REAL NAV ROW
// (a.pnav-item[href=...]) at 1440: / -> /bills -> /members. Three frames per
// transition — before the click, 150ms after, and settled — and per frame:
// bodyChildren, elementCount, body innerText length, whether <main> exists, and
// a screenshot.
//
// THE NUMBERS ARE THE GATE, THE PNG IS ONLY THE RECORD. A null-fallback boundary
// that flashes empties <body> for a frame, so the reading that fails is
// bodyChildren collapsing toward 1 and elementCount toward single digits at
// t=150ms with main=false. "I looked at the screenshots" is not a check
// (docs/method.md § Gates).
//
// WHAT IT CANNOT SEE, stated so a green is not over-read: this measures CLIENT
// TRANSITIONS only. HO 704's declined candidate (a) passed here cleanly — six
// frames, main present and non-empty on every one, worst bodyChildren 37 vs 20
// on the unfixed build, i.e. MORE nodes rather than fewer — and was still
// declined, because its fallback was visible on INITIAL LOAD, which this
// harness never navigates. The initial-load half is
// scripts/diagnostic/throttled-fcp-704.ts, and a boundary needs BOTH readings.
//
// Local-only, read-only. Wants a local PRODUCTION build (`next start`).
//
// usage: npx tsx scripts/diagnostic/suspense-nav-704.ts <base> <label> [outDir]
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2];
const LABEL = process.argv[3] ?? "run";
const OUT = process.argv[4] ?? "./nav-frames";
if (!BASE || !/^https?:\/\/(localhost|127\.0\.0\.1):/.test(BASE)) {
  console.error("refusing: localhost only");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const HOPS: { from: string; toHref: string; name: string }[] = [
  { from: "/", toHref: "/bills", name: "home-to-bills" },
  { from: "/bills", toHref: "/members", name: "bills-to-members" },
];

type FrameRead = {
  bodyChildren: number;
  bodyTextLen: number;
  elementCount: number;
  mainPresent: boolean;
  url: string;
};

async function snap(page: Page, file: string, tag: string): Promise<FrameRead> {
  const m: FrameRead = await page.evaluate(() => ({
    bodyChildren: document.body.children.length,
    bodyTextLen: (document.body.innerText || "").length,
    elementCount: document.querySelectorAll("*").length,
    mainPresent: !!document.querySelector("main"),
    url: location.pathname + location.search,
  }));
  await page.screenshot({ path: file, fullPage: false });
  console.log(
    `    ${tag.padEnd(14)} url=${m.url.padEnd(10)} bodyChildren=${m.bodyChildren}` +
      ` elements=${m.elementCount} textLen=${m.bodyTextLen} main=${m.mainPresent}`,
  );
  return m;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
  const page = await ctx.newPage();
  const pageErrs: string[] = [];
  page.on("pageerror", (e) => pageErrs.push(e.message));

  console.log(`SUSPENSE-NAV ${LABEL} base=${BASE} viewport=1440`);
  let worstChildren = Number.POSITIVE_INFINITY;
  let worstElements = Number.POSITIVE_INFINITY;
  let mainMissing = 0;

  for (const hop of HOPS) {
    console.log(`  ${hop.name}:`);
    await page.goto(BASE + hop.from, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(1_500);
    const link = page.locator(`a.pnav-item[href="${hop.toHref}"]`).first();
    await link.waitFor({ state: "visible", timeout: 10_000 });

    const before = await snap(page, `${OUT}/${LABEL}-${hop.name}-1-before.png`, "1-before");
    await link.click({ noWaitAfter: true });
    await page.waitForTimeout(150);
    const mid = await snap(page, `${OUT}/${LABEL}-${hop.name}-2-t150.png`, "2-t150ms");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1_200);
    const settled = await snap(page, `${OUT}/${LABEL}-${hop.name}-3-settled.png`, "3-settled");

    for (const m of [before, mid, settled]) {
      worstChildren = Math.min(worstChildren, m.bodyChildren);
      worstElements = Math.min(worstElements, m.elementCount);
      if (!m.mainPresent) mainMissing++;
    }
  }

  console.log(
    `  VERDICT ${LABEL}: worst bodyChildren=${worstChildren}, worst elementCount=${worstElements},` +
      ` frames without <main>=${mainMissing}, pageErrors=${pageErrs.length}`,
  );
  for (const e of pageErrs) console.log(`    pageErr: ${e.slice(0, 200)}`);
  await browser.close();
}
main();
