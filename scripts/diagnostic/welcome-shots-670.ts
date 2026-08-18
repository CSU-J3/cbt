// HO 670 STEP 3 — styled-render eyeball. Playwright screenshots of the rebuilt
// /welcome at four widths, plus the assertions a 200 alone does not make: that
// the stylesheets actually loaded (a stale .next serves a 200 page whose CSS
// 404s), that the console is clean, and that the board's computed geometry is
// what the spec says it is.
//
// Animations are PAUSED rather than disabled: pausing captures the crossfade
// mid-flight with the -0s/-15s/-30s panel offsets visible, which is the thing
// worth looking at. Disabling them would show three identical first datasets.
//
//   npx tsx scripts/diagnostic/welcome-shots-670.ts [baseUrl] [outDir]
import { chromium } from "@playwright/test";

const WIDTHS: { w: number; h: number; tag: string; reduced?: boolean }[] = [
  { w: 1920, h: 1200, tag: "1920" },
  { w: 1440, h: 1000, tag: "1440" },
  { w: 1100, h: 1000, tag: "1100" },
  { w: 430, h: 950, tag: "430" },
  // The reduced-motion contract: every animation off, dataset 1 shown, datasets
  // 2 and 3 display:none. An unchecked media query is an intention, not a guard.
  { w: 1920, h: 1200, tag: "1920-reduced", reduced: true },
];

async function main() {
  const base = process.argv[2] ?? "http://localhost:3110";
  const out = process.argv[3] ?? ".";
  const browser = await chromium.launch();
  try {
    for (const { w, h, tag, reduced } of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        reducedMotion: reduced ? "reduce" : "no-preference",
      });
      const page = await ctx.newPage();
      const errors: string[] = [];
      const cssResponses: { url: string; status: number }[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text().slice(0, 200));
      });
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
      page.on("response", (r) => {
        if (r.url().includes("/_next/static/css/")) {
          cssResponses.push({ url: r.url().split("/").pop() ?? "", status: r.status() });
        }
      });

      const res = await page.goto(base + "/welcome", { waitUntil: "networkidle" });
      // Freeze every animation so the capture is deterministic.
      await page.addStyleTag({
        content: "*,*::before,*::after{animation-play-state:paused !important}",
      });
      await page.waitForTimeout(400);

      // Evaluated as a STRING, not a closure: tsx compiles with esbuild's
      // keepNames, which injects a __name helper that does not exist in the page.
      const probe = (await page.evaluate(`(() => {
        // How many elements are actually animating, and how many dataset layers
        // are visible? Both are the reduced-motion contract, measured not assumed.
        let animating = 0, hiddenLayers = 0, visibleLayers = 0;
        for (const el of Array.from(document.querySelectorAll("*"))) {
          const cs = getComputedStyle(el);
          if (cs.animationName && cs.animationName !== "none") animating++;
        }
        const stacks = Array.from(document.querySelectorAll("div")).filter(
          (d) => getComputedStyle(d).position === "absolute" && d.querySelector("div > div"),
        );
        for (const st of stacks) {
          const cs = getComputedStyle(st);
          if (cs.display === "none") hiddenLayers++; else visibleLayers++;
        }
        const h1 = document.querySelector("h1");
        const h1s = h1 ? getComputedStyle(h1) : null;
        const viewports = Array.from(document.querySelectorAll("div")).filter(
          (d) => Math.round(d.getBoundingClientRect().height) === 420,
        );
        const rows = document.querySelectorAll("div[class]").length;
        let sheets = 0;
        for (const s of Array.from(document.styleSheets)) {
          try { if ((s.cssRules || []).length > 0) sheets++; } catch (e) {}
        }
        return {
          h1Font: h1s ? h1s.fontFamily : "(none)",
          h1Size: h1s ? h1s.fontSize : "(none)",
          panelViewports: viewports.length,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          liveSheets: sheets,
          divCount: rows,
          animating: animating,
          hiddenLayers: hiddenLayers,
          visibleLayers: visibleLayers,
        };
      })()`)) as {
        h1Font: string;
        h1Size: string;
        panelViewports: number;
        horizontalOverflow: boolean;
        liveSheets: number;
        divCount: number;
        animating: number;
        hiddenLayers: number;
        visibleLayers: number;
      };

      const path = `${out}/welcome-670-${tag}.png`;
      await page.screenshot({ path, fullPage: false });
      console.log(
        `${tag.padStart(4)}px  status ${res?.status()}` +
          ` · css ${cssResponses.map((c) => c.status).join(",") || "none"}` +
          ` · sheets ${probe.liveSheets}` +
          ` · h1 ${probe.h1Size} ${probe.h1Font.split(",")[0]}` +
          ` · 420px viewports ${probe.panelViewports}` +
          ` · h-overflow ${probe.horizontalOverflow}` +
          ` · animating ${probe.animating}` +
          ` · layers vis/hidden ${probe.visibleLayers}/${probe.hiddenLayers}` +
          ` · console errors ${errors.length}` +
          ` -> ${path}`,
      );
      for (const e of errors) console.log(`        ! ${e}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
