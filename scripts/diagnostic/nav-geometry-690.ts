// HO 690 — PrimaryNav geometry, read off the DOM. READ-ONLY: builds nothing,
// fixes nothing, writes nothing.
//
// This is the instrument for STEP 0 row 2 (the BEFORE reading) AND for STEP 1's
// AFTER reading — the same numbers, taken the same way, so the two are
// comparable. The handoff's AFTER targets are checked here rather than eyeballed:
//
//   between-label distance == 2*pad + rule on every adjacent pair in a row
//   between-label distance across the group divider == 2*pad + 2*margin + rule
//   row-2 first-label x == row-1 first-label x
//   first-label x == masthead text x (+-1px)
//   active-item box width == the same label's inactive width on another route
//
// WHY TEXT-TO-TEXT AND NOT BOX-TO-BOX. The shipped nav pads nothing and gaps 14px
// between boxes; the ruled N2 pads 6px inside each tab and gaps 0. Box gaps are
// therefore not comparable across the change and the label-to-label distance is,
// which is also the thing a reader actually sees. Both are printed.
//
// THE LABEL STARTS AT THE SLASH. `\DASHBOARD` reads as one token, so the label's
// left edge is `.pnav-slash`'s left edge, not `.pnav-text`'s. Where a build has no
// slash element the text edge is used and the row says so.
//
// TARGET: `npm run build && npm run start` on :3000, NOT `next dev` — the dev
// overlay and HMR alter the geometry being measured (layout-audit-606.ts's rule,
// same reason). Reads hit prod Turso, so every route is loaded twice and measured
// on hit 2.
//
// Usage:  npx tsx scripts/diagnostic/nav-geometry-690.ts [--json]
//         BASE_URL=http://localhost:3000 (default)

import { chromium, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ROUTES = ["/", "/bills"] as const;
const WIDTHS = [1440, 2560] as const;
const JSON_OUT = process.argv.includes("--json");

type Rect = { x: number; y: number; w: number; h: number; right: number; bottom: number };
type Item = {
  i: number;
  label: string;
  active: boolean;
  box: Rect;
  labelLeft: number | null;
  labelRight: number | null;
  labelSource: "slash" | "text" | "none";
  brackets: number;
  bracketWidth: number;
  padLeft: string;
  padRight: string;
  borderLeft: string;
};
type Reading = {
  route: string;
  width: number;
  navLeft: number;
  navColumnGap: string;
  navRowGap: string;
  navMarginInline: string;
  mastheadTextLeft: number | null;
  dividerIndexAfter: number | null;
  items: Item[];
};

async function read(page: Page, route: string, width: number): Promise<Reading> {
  await page.setViewportSize({ width, height: 1000 });
  // Two loads: the first can miss the Turso-backed caches, and a cold render
  // reflows late. Measure hit 2.
  for (let i = 0; i < 2; i++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  }
  await page.waitForSelector(".primary-nav .pnav-item");
  return (await page.evaluate((routeArg) => {
    const r = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
    };
    const nav = document.querySelector(".primary-nav")!;
    const navCs = getComputedStyle(nav);
    const anchors = Array.from(nav.querySelectorAll<HTMLElement>(".pnav-item"));
    const items = anchors.map((a, i) => {
      const cs = getComputedStyle(a);
      const slash = a.querySelector(".pnav-slash");
      const text = a.querySelector(".pnav-text");
      const brackets = Array.from(a.querySelectorAll(".pnav-bracket"));
      const edge = slash ?? text;
      const box = r(a);
      return {
        i,
        label: text?.textContent?.trim() ?? "",
        active: a.getAttribute("aria-current") === "page",
        box,
        labelLeft: edge ? r(edge).x : null,
        labelRight: text ? r(text).right : null,
        labelSource: (slash ? "slash" : text ? "text" : "none") as
          | "slash"
          | "text"
          | "none",
        brackets: brackets.length,
        bracketWidth: brackets.length ? r(brackets[0]!).w : 0,
        padLeft: cs.paddingLeft,
        padRight: cs.paddingRight,
        borderLeft: `${cs.borderLeftWidth} ${cs.borderLeftStyle}`,
      };
    });
    // The divider sits BEFORE some item index; find which.
    const divider = nav.querySelector(".pnav-divider");
    let dividerIndexAfter: number | null = null;
    if (divider) {
      const kids = Array.from(nav.children);
      const di = kids.indexOf(divider);
      // Count .pnav-item anchors that appear before the divider in DOM order.
      let n = 0;
      for (let k = 0; k < di; k++) {
        const kid = kids[k]!;
        n +=
          kid.querySelectorAll(".pnav-item").length +
          (kid.classList.contains("pnav-item") ? 1 : 0);
      }
      dividerIndexAfter = n;
    }
    // Masthead brand text: the breadcrumb path's own left edge.
    const mast =
      document.querySelector(
        routeArg === "/" ? ".home-header-prompt-row .breadcrumb-path" : ".breadcrumb-path",
      ) ?? document.querySelector(".breadcrumb-path");
    return {
      route: routeArg,
      width: window.innerWidth,
      navLeft: r(nav).x,
      navColumnGap: navCs.columnGap,
      navRowGap: navCs.rowGap,
      navMarginInline: `${navCs.marginLeft} / ${navCs.marginRight}`,
      mastheadTextLeft: mast ? r(mast).x : null,
      dividerIndexAfter,
      items,
    };
  }, route)) as Reading;
}

function rows(items: Item[]): Item[][] {
  const out: Item[][] = [];
  for (const it of items) {
    const row = out.find((rr) => Math.abs(rr[0]!.box.y - it.box.y) < 4);
    if (row) row.push(it);
    else out.push([it]);
  }
  return out;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function report(rd: Reading) {
  console.log(
    `\n=== ${rd.route} @ ${rd.width} ===================================================`,
  );
  console.log(
    `nav left ${px(rd.navLeft)} · column-gap ${rd.navColumnGap} · row-gap ${rd.navRowGap} · margin-inline ${rd.navMarginInline}`,
  );
  console.log(
    `masthead text x ${rd.mastheadTextLeft === null ? "n/a" : px(rd.mastheadTextLeft)} · divider before item index ${rd.dividerIndexAfter}`,
  );
  const it0 = rd.items[0]!;
  console.log(
    `item padding ${it0.padLeft}/${it0.padRight} · border-left "${it0.borderLeft}" · brackets/item ${it0.brackets} (each ${px(it0.bracketWidth)})`,
  );

  const rr = rows(rd.items);
  rr.forEach((row, ri) => {
    console.log(`-- row ${ri + 1} (${row.length} items, y=${px(row[0]!.box.y)})`);
    for (let k = 0; k < row.length; k++) {
      const it = row[k]!;
      const prev = row[k - 1];
      const boxGap = prev ? it.box.x - prev.box.right : null;
      const textGap =
        prev && prev.labelRight !== null && it.labelLeft !== null
          ? it.labelLeft - prev.labelRight
          : null;
      const acrossDivider =
        rd.dividerIndexAfter !== null && it.i === rd.dividerIndexAfter;
      console.log(
        `   [${String(it.i).padStart(2)}] ${it.label.padEnd(12)} ` +
          `box ${px(it.box.w).padStart(9)} @${px(it.box.x).padStart(9)}` +
          ` · label x ${it.labelLeft === null ? "  n/a" : px(it.labelLeft).padStart(9)}` +
          ` · boxGap ${boxGap === null ? "   —" : px(boxGap).padStart(8)}` +
          ` · labelGap ${textGap === null ? "   —" : px(textGap).padStart(8)}` +
          `${acrossDivider ? "  <-- across group divider" : ""}` +
          `${it.active ? "  [ACTIVE]" : ""}`,
      );
    }
  });

  // Derived checks the AFTER reading is graded on.
  const r1 = rr[0]!;
  const r2 = rr[1];
  console.log("-- derived");
  if (r2) {
    const d = (r2[0]!.labelLeft ?? 0) - (r1[0]!.labelLeft ?? 0);
    console.log(
      `   row-2 first-label x ${px(r2[0]!.labelLeft ?? 0)} vs row-1 ${px(r1[0]!.labelLeft ?? 0)} · delta ${px(d)}`,
    );
  } else {
    console.log("   single row (no wrap at this width)");
  }
  if (rd.mastheadTextLeft !== null && r1[0]!.labelLeft !== null) {
    console.log(
      `   first-label x ${px(r1[0]!.labelLeft)} vs masthead text x ${px(rd.mastheadTextLeft)} · delta ${px(r1[0]!.labelLeft - rd.mastheadTextLeft)}`,
    );
  }
  const gaps = rr.flatMap((row) =>
    row.slice(1).map((it, k) => {
      const prev = row[k]!;
      return {
        pair: `${prev.label}->${it.label}`,
        gap:
          prev.labelRight !== null && it.labelLeft !== null
            ? it.labelLeft - prev.labelRight
            : NaN,
        acrossDivider:
          rd.dividerIndexAfter !== null && it.i === rd.dividerIndexAfter,
      };
    }),
  );
  const plain = gaps.filter((g) => !g.acrossDivider && Number.isFinite(g.gap));
  const across = gaps.filter((g) => g.acrossDivider && Number.isFinite(g.gap));
  if (plain.length) {
    const vals = plain.map((g) => g.gap);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    console.log(
      `   label-to-label gap, ${plain.length} adjacent pairs: min ${px(min)} max ${px(max)}${min === max ? "  (uniform)" : "  (NOT uniform)"}`,
    );
  }
  for (const a of across) {
    console.log(`   label-to-label gap across the group divider: ${px(a.gap)}`);
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    // `/` bounces an anonymous visitor to /welcome without this.
    storageState: {
      cookies: [
        {
          name: "ct_seen",
          value: "1",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  });
  // tsx/esbuild compiles with keepNames, which rewrites a named function
  // (including a const-assigned arrow, whose name is inferred) into a call to an
  // injected `__name` helper. That helper exists in the Node module scope but NOT
  // in the page, so a serialized page.evaluate body dies on arrival with
  // "ReferenceError: __name is not defined". Identity shim, Node-side only — it
  // changes nothing about the measurement (layout-audit-606.ts:1331).
  await ctx.addInitScript(() => {
    const g = globalThis as unknown as { __name?: (fn: unknown, name?: string) => unknown };
    if (!g.__name) g.__name = (fn: unknown) => fn;
  });
  const page = await ctx.newPage();
  const readings: Reading[] = [];
  for (const route of ROUTES) {
    for (const width of WIDTHS) {
      readings.push(await read(page, route, width));
    }
  }
  await browser.close();

  if (JSON_OUT) {
    console.log(JSON.stringify(readings, null, 2));
    return;
  }
  for (const rd of readings) report(rd);

  // Cross-route active-width check: the same label rendered active on one route
  // and inactive on another must occupy the same box width.
  console.log("\n=== active vs inactive box width, same label & width =========");
  for (const width of WIDTHS) {
    const set = readings.filter((r) => r.width === width);
    const byLabel = new Map<string, { active?: number; inactive?: number }>();
    for (const rd of set) {
      for (const it of rd.items) {
        const e = byLabel.get(it.label) ?? {};
        if (it.active) e.active = it.box.w;
        else e.inactive = Math.max(e.inactive ?? 0, it.box.w);
        byLabel.set(it.label, e);
      }
    }
    for (const [label, e] of byLabel) {
      if (e.active !== undefined && e.inactive !== undefined) {
        console.log(
          `   @${width} ${label.padEnd(12)} active ${px(e.active).padStart(9)} · inactive ${px(e.inactive).padStart(9)} · delta ${px(e.active - e.inactive)}`,
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
