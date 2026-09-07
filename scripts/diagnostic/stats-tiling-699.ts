/**
 * HO 699 — is the `/welcome` stats strip TILED, at every wrap it is allowed?
 *
 * THE QUESTION IS NOT "DOES IT LOOK RIGHT AT 390". That question has a
 * breakpoint for an answer, and a breakpoint is exactly what HO 698 ruled out:
 * where this strip wraps is a function of the face's advance widths on the host
 * doing the measuring, so a rule tuned to the wrap point we can see here is a
 * rule that depends on the fonts we happen to ship. The question this asks
 * instead is a property that holds under EVERY wrap outcome: the cells, plus
 * the gaps between them, exactly cover the container's inner box, with no
 * uncovered area anywhere and nothing hanging past an edge.
 *
 *   per row      Sum(cell widths) + (n - 1) * gap  ==  container inner width
 *   down the box Sum(row heights)  + (r - 1) * gap ==  container inner height
 *
 * Both within 1px, because subpixel layout is real and a tolerance stated up
 * front is not the same as a tolerance widened until the run goes green.
 *
 * WHY THIS FAILS ON `main` AND THAT IS THE POINT. `.stats` is `width:max-content;
 * max-width:100%`, so once the content outgrows the viewport the container is
 * clamped to 100% while the cells keep their content widths. Below 900 the
 * strip is allowed to wrap. At 390 the third cell drops to its own row and
 * NEITHER row fills the box: row one stops short and row two is one cell wide,
 * so the container's border encloses an area no cell covers -- which reads as
 * an empty bordered cell, and is what Corey saw in the HO 698 @390 capture.
 * A probe that PASSES at 390 against `main` is therefore broken, and the
 * handoff says so: STEP 2 stops rather than trusting it.
 *
 * THE GAP IS READ, NOT ASSUMED. `main` draws its dividers as `border-right` on
 * each cell (inside the cell's own border box, so the gap is 0) and C1 draws
 * them as a 1px `gap` showing the container's background through. Reading
 * `column-gap` off the computed style is what lets one instrument measure both
 * trees; hardcoding 1 would make the before-reading fail for the wrong reason
 * and prove nothing about the after.
 *
 * THE CONTROL IS THE HO 698 ONE, AND IT IS THE WHOLE CLAIM. A tiling that only
 * holds for IBM Plex is a tiling tuned to a font. So the last two runs force a
 * proportional serif at +2px letter-spacing onto the strip's subtree -- far
 * fatter than any host resolves, moving the wrap point somewhere we did not
 * choose -- and assert the same two equalities. If those pass, the strip is
 * correct under wraps nobody has drawn.
 *
 *   npx tsx scripts/diagnostic/stats-tiling-699.ts
 *   BASE_URL=http://localhost:3000 npx tsx scripts/diagnostic/stats-tiling-699.ts
 */
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "https://congressional-terminal-chi-silk.vercel.app";
const WIDTHS = [1440, 900, 600, 430, 390, 360];
const TOL = 1;

/** Fatter than any host resolves. Scoped to the strip so the page still lays out. */
const FAT = `[class*="landing_stats"],[class*="landing_stats"] *{
  font-family:serif !important;letter-spacing:2px !important}`;

type Row = { top: number; n: number; sum: number; height: number };
type Reading = {
  innerW: number; innerH: number; gap: number; rows: Row[];
  dividers: string; bg: string; wrap: string;
};

async function read(page: Page): Promise<Reading | null> {
  return page.evaluate(() => {
    const box = document.querySelector('[class*="landing_stats"]');
    if (!box) return null;
    const cs = getComputedStyle(box);
    const gap = parseFloat(cs.columnGap) || 0;
    const cells = Array.from(box.children) as HTMLElement[];
    // Group by top edge. Rounding to 1px keeps subpixel row starts together
    // without merging genuinely different rows (rows here are >40px tall).
    const byTop = new Map<number, HTMLElement[]>();
    for (const c of cells) {
      const t = Math.round(c.getBoundingClientRect().top);
      const k = [...byTop.keys()].find((x) => Math.abs(x - t) <= 1) ?? t;
      byTop.set(k, [...(byTop.get(k) ?? []), c]);
    }
    const rows = [...byTop.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([top, cs2]) => ({
        top,
        n: cs2.length,
        sum: cs2.reduce((a, c) => a + c.getBoundingClientRect().width, 0),
        height: Math.max(...cs2.map((c) => c.getBoundingClientRect().height)),
      }));
    // Inner box excludes the container's own border, which is NOT part of the
    // tiling -- it frames it.
    const r = box.getBoundingClientRect();
    const bw = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    const bh = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const first = cells[0] ? getComputedStyle(cells[0]) : null;
    return {
      innerW: r.width - bw,
      innerH: r.height - bh,
      gap,
      rows,
      dividers: first
        ? `border-right ${first.borderRightWidth} ${first.borderRightColor} · flex ${first.flexGrow}/${first.flexShrink}/${first.flexBasis} · min-width ${first.minWidth}`
        : "no cells",
      bg: cs.backgroundColor,
      wrap: cs.flexWrap,
    };
  });
}

function verdict(r: Reading): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  for (const row of r.rows) {
    const covered = row.sum + (row.n - 1) * r.gap;
    const d = covered - r.innerW;
    const pass = Math.abs(d) <= TOL;
    ok &&= pass;
    lines.push(
      `      row@${String(row.top).padStart(4)}  n=${row.n}  Σw=${row.sum.toFixed(1)}` +
        ` +${row.n - 1}×${r.gap} = ${covered.toFixed(1)}  vs inner ${r.innerW.toFixed(1)}` +
        `  Δ=${d >= 0 ? "+" : ""}${d.toFixed(1)}  ${pass ? "TILED" : "UNCOVERED"}`,
    );
  }
  const stackH =
    r.rows.reduce((a, x) => a + x.height, 0) + (r.rows.length - 1) * r.gap;
  const dh = stackH - r.innerH;
  const hpass = Math.abs(dh) <= TOL;
  ok &&= hpass;
  lines.push(
    `      height   Σh=${stackH.toFixed(1)} vs inner ${r.innerH.toFixed(1)}` +
      `  Δ=${dh >= 0 ? "+" : ""}${dh.toFixed(1)}  ${hpass ? "TILED" : "UNCOVERED"}`,
  );
  return { ok, lines };
}

async function main() {
  const browser = await chromium.launch();
  console.log(`base ${BASE}\n`);
  let fails = 0;
  const run = async (w: number, fat: boolean) => {
    const page = await browser.newPage({ viewport: { width: w, height: 1400 } });
    await page.goto(`${BASE}/welcome`, { waitUntil: "networkidle" });
    if (fat) await page.addStyleTag({ content: FAT });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const r = await read(page);
    await page.close();
    const tag = `@${String(w).padEnd(4)}${fat ? " CONTROL(fatter face)" : ""}`;
    if (!r) { console.log(`${tag}  NO .stats FOUND — probe cannot answer`); fails++; return; }
    const v = verdict(r);
    if (!v.ok) fails++;
    console.log(`${tag}  ${v.ok ? "PASS" : "FAIL"}  rows=${r.rows.length} gap=${r.gap} wrap=${r.wrap} bg=${r.bg}`);
    console.log(`      cell: ${r.dividers}`);
    v.lines.forEach((l) => console.log(l));
  };
  for (const w of WIDTHS) await run(w, false);
  console.log("");
  for (const w of [430, 390]) await run(w, true);
  await browser.close();
  console.log(`\n${fails === 0 ? "OK — tiled at every width" : `${fails} width(s) UNCOVERED`}`);
}

main();
