// HO 737 row 9 — the `/members/[bioguideId]` 430px overflow, measured with a
// row OPEN. READ-ONLY: Playwright GETs against a local production server,
// geometry reads only. No DB, no writes, no network beyond the server named.
//
//   npx tsx scripts/diagnostic/member-open-overflow-737.ts [baseUrl] [label]
//
// WHY IT IS TRACKED. `docs/backlog.md`'s line ("overflows horizontally by 10px
// at 430, found HO 677") was closed by measurement rather than by a fix, and a
// measurement close rests on the instrument that took it. This file is that
// instrument, and it is the before/after comparator too: run it against a build
// of the HO 677 tree and against HEAD and the two readings are the strike.
//
// ── THE CONTROL, which the first pass did not have ───────────────────────────
// The defect only appears with a bill row EXPANDED, so the probe must click one
// open. A click that silently does nothing leaves the page collapsed and clean,
// and `scrollWidth == clientWidth` is then reported as a PASS — the identical
// output to a genuine pass (docs/method.md § Gates: say what the check reads if
// the work was never done; if that is success, it is not a check).
//
// So `expandFirstBillRow` snapshots the page BEFORE the click and requires the
// state to MOVE. On this route, opening one row reads:
//     [aria-expanded="true"]  0 -> 1
//     .is-open                0 -> 2   (the <li> and the chevron)
//     element count           +69 to +75
// `moved: false` in the output means the geometry below is meaningless, not
// that the page is clean. Do not read the deltas without reading `moved`.
//
// ── THE OTHER TRAP IN HERE ───────────────────────────────────────────────────
// `MEASURE` is a template literal (the HO 670/675/687 keepNames remedy), so a
// backslash in it is consumed before the browser sees it: `/\s+/g` arrives as
// `/s+/g`. The text normaliser therefore uses `String.fromCharCode(10)` and a
// space-only class — no backslash to lose. See docs/oddities.md, HO 712's entry.
import { chromium, type Page } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const LABEL = process.argv[3] ?? "HEAD";
// Three high-bill sponsors, so a thin roster cannot be the reason a row is clean.
const BIOS = ["S001217", "M000133", "B001243"];
const WIDTHS = [430, 390];

const MEASURE = `(() => {
  const de = document.documentElement;
  const w = de.clientWidth;
  const over = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > w + 0.5) {
      over.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').slice(0, 90),
        right: Math.round(r.right * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        text: (el.textContent || '')
          .split(String.fromCharCode(10)).join(' ')
          .replace(/  +/g, ' ').trim().slice(0, 60),
      });
    }
  }
  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    delta: de.scrollWidth - de.clientWidth,
    overCount: over.length,
    over: over.slice(-8),
  };
})()`;

const SNAP = `({
  exp: document.querySelectorAll('[aria-expanded="true"]').length,
  open: document.querySelectorAll('.is-open').length,
  nodes: document.querySelectorAll('*').length
})`;

type Snap = { exp: number; open: number; nodes: number };

async function expandFirstBillRow(page: Page) {
  const snap = () => page.evaluate(SNAP) as Promise<Snap>;
  const rows = page.locator("li.feed-row");
  const count = await rows.count();
  if (count === 0)
    return { count: 0, before: null, after: null, moved: false };
  const before = await snap();
  await rows.first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  const after = await snap();
  const moved =
    after.exp > before.exp ||
    after.open > before.open ||
    after.nodes > before.nodes + 3;
  return { count, before, after, moved };
}

async function main() {
  console.log(`HO 737 row 9 — ${LABEL} @ ${BASE}\n`);
  const browser = await chromium.launch();
  let worstDelta = 0;
  let unmoved = 0;
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    for (const bio of BIOS) {
      await page.goto(`${BASE}/members/${bio}`, { waitUntil: "networkidle" });
      await page.waitForSelector("h1", { timeout: 15000 });
      const collapsed = (await page.evaluate(MEASURE)) as Record<string, unknown>;
      const ex = await expandFirstBillRow(page);
      const open = (await page.evaluate(MEASURE)) as Record<string, unknown>;
      if (!ex.moved) unmoved++;
      worstDelta = Math.max(worstDelta, Number(collapsed.delta), Number(open.delta));
      console.log(`@${w} ${bio}  rows=${ex.count} MOVED=${ex.moved}`);
      console.log(`   control : ${JSON.stringify(ex.before)} -> ${JSON.stringify(ex.after)}`);
      console.log(`   collapsed: ${collapsed.scrollWidth}/${collapsed.clientWidth} delta=${collapsed.delta} over=${collapsed.overCount}`);
      console.log(`   open     : ${open.scrollWidth}/${open.clientWidth} delta=${open.delta} over=${open.overCount}`);
      if (Number(open.overCount) > 0)
        console.log(`   offenders: ${JSON.stringify(open.over)}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${LABEL}: worst delta ${worstDelta}px across ${WIDTHS.length * BIOS.length} runs`);
  if (unmoved > 0) {
    console.log(`CONTROL FAILED on ${unmoved} run(s) — the geometry above proves nothing.`);
    process.exit(1);
  }
  console.log("control held on every run (a row was open for each geometry read)");
}

main();
