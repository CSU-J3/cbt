// HO 736 read-back — the CAPTURE half, beside the 09-18 befores. READ-ONLY:
// Playwright GETs against prod, screenshots + innerText readings. No writes,
// no DB, no auth.
//
// TRACKED because the finding rests on it (HO 736 post-close), and because it
// carries two traps that each faked a clean pass before they were found.
//
// TRAP 1 — innerText APPLIES text-transform. The roster label is `Advanced` in
// the DOM and `ADVANCED` on screen, so the first version of `hit()` counted
// case-sensitively and reported `advanced: 0` on all four pages. Zero is also
// what an unrendered page gives, so that reading was worth nothing either way
// (docs/method.md § Gates). Every count here is /i, and `badges` records the
// computed `text-transform` beside the DOM text so the two are never conflated
// again. This exposure is site-wide: every uppercase-styled label on CBT is
// text-transform, not uppercase content.
//
// TRAP 2 — the page body is a TEMPLATE LITERAL, so `\s` is not a regex escape
// here: an unrecognized escape in a template literal resolves to the bare
// character, and `/\s+/g` reached the browser as `/s+/g`, replacing every run
// of the letter s ("Leslie" read back as "Le lie"). Hence `\\s` at that site,
// commented. Same string, second trap — the first is HO 670/675's keepNames
// `__name` wrapper, which is why the body is a string at all.
//
// Reduced motion is forced (docs/method.md — the LAST SYNC zone rotates every
// 4s and a same-SHA capture drifts without it).
//
//   npx tsx scripts/diagnostic/advancer-shots-736.ts <baseUrl> <outDir>
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "https://congressional-terminal-chi-silk.vercel.app";
const OUT = process.argv[3] ?? "docs/handoffs/736-artifacts";
const WIDTHS = [
  { w: 1440, h: 1200, tag: "1440" },
  { w: 430, h: 1000, tag: "430" },
];
const RACES = ["S-AK-2026", "CA-40-2026"];

// A string, not a function — tsx/esbuild's keepNames wrapper does not exist in
// the page (HO 670 / HO 675).
const READ_ROSTER = `(() => {
  // innerText APPLIES text-transform in Chrome, so the roster's "Advanced"
  // arrives as "ADVANCED". A case-sensitive count reads 0 here and 0 on a page
  // that never rendered at all — the same bytes for both answers. Hence /i,
  // and hence wonPrimary/primaryWinner counted the same way as live controls.
  const t = document.body.innerText;
  const hit = (s) => (t.match(new RegExp(s, 'gi')) || []).length;
  const badge = Array.from(document.querySelectorAll('*'))
    .filter((e) => e.children.length === 0 && /^(advanced|won primary|nominee|running|withdrew)$/i.test((e.textContent || '').trim()))
    .map((e) => ({ text: (e.textContent || '').trim(), shown: getComputedStyle(e).textTransform }));
  return {
    advanced: hit('advanced'),
    wonPrimary: hit('won primary'),
    primaryWinner: hit('primary winner'),
    primaryUnresolved: hit('primary unresolved'),
    dagger: (t.match(/†/g) || []).length,
    badges: badge,
    roster: (() => {
      const h = Array.from(document.querySelectorAll('h1,h2,h3'))
        .find((e) => /^CANDIDATES/i.test((e.textContent || '').trim()));
      let n = h;
      for (let i = 0; i < 4 && n; i++) {
        // \\s, not \s: this body is a TEMPLATE LITERAL, which resolves the
        // unrecognized escape \s to a bare s — so /s+/g quietly replaced every
        // run of the letter s with a space ("Leslie" read back as "Le lie").
        const txt = (n.innerText || '').replace(/\\s+/g, ' ').trim();
        if (txt.length > 40) return txt.slice(0, 500);
        n = n.parentElement;
      }
      return h ? (h.innerText || '').trim() : null;
    })(),
  };
})()`;

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const readings: Record<string, unknown> = {};
  let errs = 0;
  for (const { w, h, tag } of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { errs++; console.log(`  PAGEERROR ${e.message}`); });
    for (const id of RACES) {
      const url = `${BASE}/race/${id}`;
      const r = await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForSelector("h1", { timeout: 15000 });
      const reading = await page.evaluate(READ_ROSTER);
      readings[`${id}@${tag}`] = { status: r?.status(), ...(reading as object) };
      const file = join(OUT, `race-${id}-${tag}-after.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`${id} @${tag}  http=${r?.status()}  ${JSON.stringify(reading)}`);
      console.log(`   -> ${file}`);
    }
    await ctx.close();
  }
  await browser.close();
  writeFileSync(join(OUT, "readings-after.json"), JSON.stringify(readings, null, 2));
  console.log(`\npage errors: ${errs}`);
}
main();
