// HO 730 — does a hearing's detail land ON the list it annotates?
//
// Opens one entry BY CLICK on /hearings (.hcal-entry) and on / (.hsch-row, the
// HEARINGS tab) at each width, and reads the floating card's rect against the
// anchor's and against every sibling row's. Click, never hover, and that is
// load-bearing: HO 730 removes /hearings' hover path, so a hover-opening
// instrument would read `.hearing-panel=0` on the converted route and render a
// working conversion as a failure. Click opens on both sides of the change.
//
// WHAT ITS ZERO MEANS: `rowsUnderCard=0` means no row of the SAME list
// intersects the card's box — not that the card covers nothing (on / at 1440 it
// sits over the MOVERS feed, which this does not count). A missing card prints
// `.hcal-card=0` with no rects, so absence never reads as "no overlap".
//
// THE FRESHNESS DISCRIMINATOR rides every line: `.hcal-card` and `.hearing-panel`
// counts with the entry open. Before HO 730 /hearings reads 1 / 0; after, 0 / 1.
// `/` reads `.hcal-card=1` on both sides — the control: a zero there is a stale
// build or a broken dashboard, and a /hearings zero proves nothing beside it.
//
// `doc=` is the doc-scroll reading (scrollWidth/clientWidth, over past 1px) with
// the entry OPEN, which the narrow gate cannot take: it measures collapsed pages.
//
//   BASE_URL=http://localhost:3000 npx tsx scripts/diagnostic/card-overlap-730.ts
//   MSYS_NO_PATHCONV=1 WIDTHS=430,390 ROUTES=/hearings npx tsx scripts/diagnostic/card-overlap-730.ts
//
// Measured at 8712236 (HO 730 STEP 0): /hearings card L8 at 1440 and 2560 over
// 6 and 7 rows; / card beside its row at both, 0 rows at 1440, 12 at 2560.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOT_DIR ?? "docs/handoffs/730-artifacts";
const TAG = process.env.TAG ?? "run";
const WIDTHS = (process.env.WIDTHS || "1440,2560").split(",").map((w) => Number(w.trim()));
const ROUTE_FILTER = (process.env.ROUTES || "/hearings,/").split(",").map((r) => r.trim());
const CASES = [
  { route: "/hearings", row: ".hcal-entry", slug: "hearings" },
  { route: "/", row: ".hsch-row", slug: "dash" },
].filter((c) => ROUTE_FILTER.includes(c.route));
// An empty selection must not exit 0 on no output. Git Bash rewrites a bare
// `ROUTES=/hearings` into a Windows path (set MSYS_NO_PATHCONV=1), which is how
// this guard was earned: the first narrow run matched nothing and printed nothing.
if (!CASES.length) throw new Error(`ROUTES matched no case: ${JSON.stringify(ROUTE_FILTER)}`);

type R = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Read = {
  anchor: R;
  card: R | null;
  panel: R | null;
  visibility: string | null;
  rows: R[];
  cards: number;
  panels: number;
  vw: number;
  sw: number;
  cw: number;
};
const area = (a: R, b: R) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const fmt = (x: R) =>
  `L${x.left.toFixed(0)} T${x.top.toFixed(0)} R${x.right.toFixed(0)} B${x.bottom.toFixed(0)} (${x.width.toFixed(0)}×${x.height.toFixed(0)})`;

(async () => {
  const browser = await chromium.launch();
  for (const c of CASES) {
    for (const w of WIDTHS) {
      const h = w <= 500 ? 932 : w >= 2560 ? 1440 : 900;
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
      const page = await ctx.newPage();
      const resp = await page.goto(BASE + c.route, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const rows = page.locator(c.row);
      const count = await rows.count();
      // the first row whose box sits inside the viewport
      let idx = -1;
      for (let i = 0; i < count; i++) {
        const b = await rows.nth(i).boundingBox();
        if (b && b.y > 0 && b.y + b.height < h - 40) {
          idx = i;
          break;
        }
      }
      const head = `${c.route} @${w}: status=${resp?.status()} rows=${count}`;
      if (idx < 0) {
        console.log(`${head} NO ROW IN VIEWPORT`);
        await ctx.close();
        continue;
      }
      await rows.nth(idx).click();
      await page.waitForTimeout(400);
      // A string body: tsx's esbuild wraps named closures in __name(), which
      // does not exist in page scope.
      const r = (await page.evaluate(`(() => {
        const sel = ${JSON.stringify(c.row)}; const idx = ${idx};
        const rect = (e) => { const b = e.getBoundingClientRect();
          return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
        const all = Array.from(document.querySelectorAll(sel));
        const card = document.querySelector(".hcal-card");
        const panel = document.querySelector(".hearing-panel");
        const d = document.documentElement;
        return { anchor: rect(all[idx]), card: card ? rect(card) : null, panel: panel ? rect(panel) : null,
          visibility: card ? getComputedStyle(card).visibility : null,
          rows: all.map(rect), cards: document.querySelectorAll(".hcal-card").length,
          panels: document.querySelectorAll(".hearing-panel").length, vw: window.innerWidth,
          sw: d.scrollWidth, cw: d.clientWidth };
      })()`)) as Read;
      const over = Math.max(0, r.sw - r.cw);
      const lines = [
        `${head} opened=#${idx} .hcal-card=${r.cards} .hearing-panel=${r.panels} doc=${r.sw}/${r.cw} over=${over > 1 ? over : 0}`,
        `  anchor ${fmt(r.anchor)}`,
      ];
      if (r.card) {
        const under = r.rows.filter((x) => area(r.card!, x) > 0);
        const underArea = under.reduce((s, x) => s + area(r.card!, x), 0);
        lines.push(
          `  card   ${fmt(r.card)} visibility=${r.visibility}`,
          `  overlap card∩anchor=${area(r.card, r.anchor).toFixed(0)}px²  rowsUnderCard=${under.length}  card∩rows=${underArea.toFixed(0)}px²`,
        );
      }
      if (r.panel) {
        const under = r.rows.filter((x) => area(r.panel!, x) > 0);
        lines.push(`  panel  ${fmt(r.panel)} rowsUnderPanel=${under.length}`);
      }
      console.log(lines.join("\n"));
      await page.screenshot({ path: `${OUT}/730-${TAG}-${c.slug}-${w}.png` });
      await ctx.close();
    }
  }
  await browser.close();
})();
