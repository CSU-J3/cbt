// HO 738 rows 5-8 — the /stale momentum overlay, read off the served page and
// captured. READ-ONLY: Playwright GETs against a local production server,
// geometry and text reads only. No DB, no writes.
//
// EXISTS BEFORE READS. Row 5 counts the population (rows, HEARD badges, the
// four .row-support bands) before row 6 quotes any of it, because a band with
// zero members and a band that was never queried print the same nothing.
//
// The negative control (row 7) is /bills, where showMomentum is false: a
// nonzero .row-momentum there is a leak, and it is the only reading here that
// can falsify "the overlay is /stale-only".
//
// ── TWO READINGS THIS FILE EXISTS TO KEEP ────────────────────────────────────
//
// 1. ATTACHED AND VISIBLE ARE DIFFERENT QUESTIONS, and on this overlay they
//    give different answers at different widths. Playwright's `waitForSelector`
//    defaults to `state: "visible"`, so the first cut of this probe reported
//    `overlay=false` at 430 and would have read as "the overlay did not render"
//    — while the census, running on the same page a line later, counted 50
//    `.row-momentum` and all four bands. The elements are in the DOM. Both
//    states are now read and both are recorded; a probe that reads only one
//    cannot tell "absent" from "hidden", and those are opposite findings.
//
// 2. THE OVERLAY IS SUPPRESSED BELOW 700px, BY DESIGN AND IN CSS.
//    `app/globals.css` — `@media (max-width: 700px) { .feed-row .row-momentum
//    { display: none } }`, alongside `.row-days-since`. So at 430 the support
//    figure AND the HEARD badge are both gone, and no capture at that width can
//    show a HEARD row however long it waits. This is a narrow-width decision
//    the HO 371 design mock never covered, because the mock only drew a desktop
//    row (docs/design/stale-momentum-row.html). Found by this probe at HO 738.
//
// Both are the same shape as the rest of this repo's instrument failures: a
// reading whose "nothing here" is indistinguishable from "I looked wrongly".
//
//   npx tsx scripts/diagnostic/stale-momentum-738.ts [baseUrl] [outDir]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "docs/handoffs/738-artifacts";

// Template literal: no backslashes (docs/oddities.md, the HO 712 entry).
const CENSUS = `(() => {
  const rows = document.querySelectorAll('li.feed-row');
  const band = (c) => document.querySelectorAll('.row-support.' + c).length;
  const sup = Array.from(document.querySelectorAll('.row-support'));
  return {
    rows: rows.length,
    momentum: document.querySelectorAll('.row-momentum').length,
    heard: document.querySelectorAll('.heard-badge').length,
    hslot: document.querySelectorAll('.row-hslot').length,
    bands: { high: band('high'), mid: band('mid'), low: band('low'), nul: band('nul') },
    figures: sup.slice(0, 60).map((e) => ({
      cls: (e.getAttribute('class') || '').replace('row-support ', ''),
      text: (e.textContent || '').trim(),
    })),
  };
})()`;

const SAMPLE = `(() => {
  const pick = (c) => {
    const e = document.querySelector('.row-support.' + c);
    if (!e) return null;
    const li = e.closest('li.feed-row');
    return {
      cls: c,
      figure: (e.textContent || '').trim(),
      heard: !!(li && li.querySelector('.heard-badge')),
      row: (li ? li.innerText : '').split(String.fromCharCode(10)).join(' ').replace(/  +/g, ' ').trim().slice(0, 120),
    };
  };
  return { high: pick('high'), mid: pick('mid'), low: pick('low'), nul: pick('nul') };
})()`;

const EXPANDED = `(() => {
  const bar = document.querySelector('.bxp-cosbar');
  const segs = document.querySelectorAll('.bxp-cosseg');
  const on = document.querySelectorAll('.bxp-cosseg--on');
  const silent = document.querySelector('.bxp-hsilent');
  const panel = document.querySelector('[class*="bxp"]');
  const txt = (e) => (e ? (e.textContent || '').trim() : null);
  const all = Array.from(document.querySelectorAll('[class*="bxp-"]'))
    .map((e) => e.getAttribute('class'))
    .filter((c, i, a) => a.indexOf(c) === i)
    .slice(0, 40);
  return {
    silentLine: txt(silent),
    segmentsTotal: segs.length,
    segmentsOn: on.length,
    barPresent: !!bar,
    hasPanel: !!panel,
    panelClasses: all,
    cosponsorRow: (() => {
      const r = document.querySelector('.bxp-cosrow');
      return r ? (r.textContent || '').replace(/  +/g, ' ').trim().slice(0, 160) : null;
    })(),
    cosponsorValue: txt(document.querySelector('.bxp-cosval')),
  };
})()`;

async function shot(page: Page, name: string) {
  const file = join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`   -> ${file}`);
}

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const readings: Record<string, unknown> = {};
  let errs = 0;

  // ── ROW 5 + 8: /stale at 1440 and 430 ────────────────────────────────────
  for (const w of [1440, 430]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: w === 1440 ? 1400 : 1000 },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { errs++; console.log(`  PAGEERROR ${e.message}`); });
    await page.goto(`${BASE}/stale`, { waitUntil: "networkidle" });
    // Wait for the overlay itself, not merely for the page: its absence is the
    // failure this probe exists to detect, so it must be waited for and named.
    // ATTACHED vs VISIBLE are different questions and the overlay answers them
    // differently by width: `@media (max-width: 700px)` sets
    // `.feed-row .row-momentum { display: none }` beside `.row-days-since`, so
    // at 430 the cluster is in the DOM and deliberately off-screen. Waiting for
    // "visible" there reports a miss where the design is working, so both are
    // read and both are recorded.
    const attached = await page
      .waitForSelector(".row-support", { state: "attached", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    const visible = attached
      ? await page.locator(".row-support").first().isVisible()
      : false;
    const c = (await page.evaluate(CENSUS)) as Record<string, unknown>;
    readings[`stale@${w}`] = { overlayAttached: attached, overlayVisible: visible, ...c };
    console.log(`\n/stale @${w}  overlay attached=${attached} visible=${visible}`);
    console.log(`   rows=${c.rows} momentum=${c.momentum} heard=${c.heard} hslot=${c.hslot}`);
    console.log(`   bands=${JSON.stringify(c.bands)}`);
    if (w === 1440) {
      const s = await page.evaluate(SAMPLE);
      readings.sample = s;
      console.log(`   samples=${JSON.stringify(s, null, 1)}`);
    }
    // Put a HEARD row in frame before the capture.
    const heard = page.locator("li.feed-row").filter({ has: page.locator(".heard-badge") }).first();
    if (await heard.count()) await heard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, `stale-collapsed-${w}.png`);

    // ── ROW 6 + 8: expand the HEARD row (1440 only) ────────────────────────
    if (w === 1440 && (await heard.count())) {
      const before = await page.evaluate(`document.querySelectorAll('[aria-expanded="true"]').length`);
      await heard.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(900);
      const after = await page.evaluate(`document.querySelectorAll('[aria-expanded="true"]').length`);
      const moved = Number(after) > Number(before);
      const e = (await page.evaluate(EXPANDED)) as Record<string, unknown>;
      readings.expanded = { moved, before, after, ...e };
      console.log(`   EXPAND moved=${moved} (${before} -> ${after})`);
      console.log(`   ${JSON.stringify(e, null, 1)}`);
      await shot(page, "stale-heard-expanded-1440.png");
    }
    await ctx.close();
  }

  // ── ROW 7: the negative control ──────────────────────────────────────────
  for (const w of [1440]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 1400 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { errs++; console.log(`  PAGEERROR ${e.message}`); });
    await page.goto(`${BASE}/bills`, { waitUntil: "networkidle" });
    await page.waitForSelector("li.feed-row", { timeout: 15000 }).catch(() => {});
    const c = (await page.evaluate(CENSUS)) as Record<string, unknown>;
    readings[`bills@${w}`] = c;
    console.log(`\n/bills @${w} (CONTROL — showMomentum false)`);
    console.log(`   rows=${c.rows} momentum=${c.momentum} heard=${c.heard}  <-- momentum must be 0`);
    await shot(page, `bills-control-${w}.png`);
    await ctx.close();
  }

  await browser.close();
  writeFileSync(join(OUT, "readings-738.json"), JSON.stringify(readings, null, 2));
  console.log(`\npage errors: ${errs}`);
}

main();
