// HO 692 — the ON-path baseline, captured at HEAD BEFORE the build and re-run
// after it. The claim being tested is "a reader who never touches the toggle
// sees exactly what they saw before".
//
// GEOMETRY, NOT PIXELS, and that is a deliberate substitution for the handoff's
// "byte-identical capture". Three things on these routes are nondeterministic by
// design and would defeat a pixel diff without saying anything about this change:
// the markets marquee SHUFFLES its item order on mount (HO 376, Fisher-Yates),
// the masthead clock CYCLES zones every 4s (HO 183), and the race cards carry a
// rotating news head. A pixel diff over those reads red on every run, which is
// the same-as-failure twin of a green that means nothing.
//
// So: bounding boxes for a fixed selector set per route, plus the document
// scroll pair, plus the computed `display` of every element that will carry a
// gating class. Robust to all three nondeterminisms, and it measures the thing
// the change could actually break — layout.
//
// `--no-toggle` suppresses the toggle's own masthead row before measuring. That
// exists because the ON invariant has TWO parts and only one of them is about
// this change: the GATING must perturb nothing, but the CONTROL is a new visible
// element and legitimately occupies space. Measured at HO 692, it costs 21px at
// 430 (the masthead meta wraps there) and nothing at 1440/2560. Run with the
// flag to see the gating residual alone; without it to see the shipped page.
//
//   npx tsx scripts/diagnostic/on-baseline-692.ts <out.json> [--odds-off] [--no-toggle]
import { chromium, type Page } from "playwright";
import { writeFileSync } from "node:fs";

const B = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "scripts/diagnostic/artifacts-692/on-baseline.json";
const ODDS_OFF = process.argv.includes("--odds-off");
const NO_TOGGLE = process.argv.includes("--no-toggle");

// Selectors whose geometry must not move on the ON path. Deliberately a mix of
// gated elements and their NEIGHBOURS — a gating bug shows up in the neighbour.
const SELECTORS: Record<string, string[]> = {
  "/": [
    ".home-header", ".dv2-tapes", ".dv2-tapes .markets-tape:nth-of-type(1)",
    ".dv2-tapes .markets-tape:nth-of-type(2)", ".home-header-nav",
    ".race-grid", "a.race-card", "a.race-card .rc-kpline",
    "a.race-card .rc-pac--glance", ".weekly-band", ".dash-left",
  ],
  "/electoral": [
    ".races-hero-band", ".races-hero-cell:nth-child(1)",
    ".races-hero-cell:nth-child(3)", ".cart-controls",
  ],
  "/bills": [".mc-pane", ".bl-rail", ".mc-content"],
  "/race/S-MI-2026": [".rc-pac", "main"],
  "/welcome": ['[class*="taperow"]:nth-of-type(1)', '[class*="taperow"]:nth-of-type(2)'],
};

// Elements that WILL carry a gating class. On the ON path their computed
// display must be unchanged; this is what catches a rule that leaks into ON.
const GATED = [".dv2-tapes .markets-tape:nth-of-type(2)", ".rc-kpline", ".sb-mkt",
  ".rc-diverge", ".racecard-kalshi", ".races-hero-cell", ".race-list-diverge"];

async function boxes(p: Page, sels: string[]) {
  return p.evaluate((ss) => {
    const out: Record<string, unknown> = {};
    for (const s of ss) {
      const e = document.querySelector(s);
      out[s] = e
        ? (() => { const r = e.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; })()
        : null;
    }
    return out;
  }, sels);
}

async function main() {
  const b = await chromium.launch();
  const result: Record<string, unknown> = {};
  for (const [w, h, tag, rm] of [[1440, 1200, "1440", false], [2560, 1400, "2560", false],
                                 [430, 932, "430", false], [1440, 1200, "1440rm", true]] as const) {
    const ctx = await b.newContext({ viewport: { width: w, height: h },
      reducedMotion: rm ? "reduce" : "no-preference" });
    await ctx.addCookies([{ name: "ct_seen", value: "1", domain: new URL(B).hostname, path: "/" }]);
    if (ODDS_OFF)
      await ctx.addInitScript(() => {
        try { localStorage.setItem("cbt:pref:odds", "off"); } catch {}
      });
    if (NO_TOGGLE)
      await ctx.addInitScript(() => {
        const css = ".home-header-meta:has(.odds-toggle){display:none}" +
          ".header-titlebar-auth .odds-toggle{display:none}";
        document.addEventListener("DOMContentLoaded", () => {
          const s = document.createElement("style");
          s.textContent = css;
          document.head.appendChild(s);
        });
      });
    const p = await ctx.newPage();
    for (const [route, sels] of Object.entries(SELECTORS)) {
      await p.goto(`${B}${route}`, { waitUntil: "networkidle" });
      if (route === "/") {
        try { await p.locator(".dv2-racesbox-tab", { hasText: "RACES" }).first().click();
              await p.waitForTimeout(350); } catch {}
      }
      const scroll = await p.evaluate(() => ({
        s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth,
        odds: document.documentElement.getAttribute("data-odds"),
      }));
      const disp = await p.evaluate((gs) => {
        const o: Record<string, string | null> = {};
        for (const g of gs) { const e = document.querySelector(g);
          o[g] = e ? getComputedStyle(e).display : null; }
        return o;
      }, GATED);
      result[`${tag}|${route}`] = { scroll, boxes: await boxes(p, sels), display: disp };
    }
    await ctx.close();
  }
  await b.close();
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`wrote ${OUT}  (odds-off=${ODDS_OFF})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
