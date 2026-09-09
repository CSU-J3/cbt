// HO 706 — the render gate for a bundler (or any whole-build) change.
//
// A bundler swap is render-touching, and SKILL's HO 670 rule is that a visual
// check with no capture is not a check. This captures the whole crawl set at
// three viewport configs from ONE build, then compares a SECOND build against
// those captures with Playwright's own comparator. Nothing is added to
// package.json for it; the baseline PNGs are gitignored, the spec is not.
//
// @nonci — it needs two local production servers and is never part of the
// unattended run.
//
//   CAPTURE_FROM     the build the baselines come from   (default :3000)
//   CAPTURE_AGAINST  the build being judged              (default :3007)
//   CAPTURE_ROLE     baseline | compare                  (default compare)
//
//   CAPTURE_ROLE=baseline npx playwright test e2e/bundler-captures-706.spec.ts --update-snapshots
//   CAPTURE_ROLE=compare  npx playwright test e2e/bundler-captures-706.spec.ts
//
// ────────────────────────────────────────────────────────────────────────────
// FLUSH BOTH SERVERS FIRST. THIS IS NOT OPTIONAL AND IT IS NOT COSMETIC.
//
// The two servers are separate processes with separate `unstable_cache` state,
// so they hold DIFFERENT CACHE GENERATIONS — the one started earlier serves an
// older snapshot. HO 706 hit this: `/bills` failed at all three viewports, and
// unlike ordinary drift it SURVIVED a back-to-back re-run seconds apart, which
// is exactly what a real render regression looks like. It was not one. Both
// servers served 25 rows; the newer build's list was shifted by exactly 7. The
// proof was HTML, not pixels: after POSTing /api/revalidate?tag=bills to BOTH
// servers the two title lists diffed IDENTICAL and the three captures then
// passed 3/3.
//
// So: flush every tag the routes under test read, on BOTH servers, before any
// pixel is read. And when a capture does fail, DIFF THE SERVED HTML BEFORE THE
// PNG — it is far cheaper and it answers "same content?" directly, which is the
// question a pixel diff only answers by implication.
//
// LIVE-DATA DRIFT IS ~1% AND IS NOT ZERO. Measured, not assumed: re-running the
// n15 baseline against the n15 build ITSELF gave 1 failure in 108
// (`home-stage-president @2560`), which passed on a back-to-back re-run. That
// control is what makes a small number of failures readable rather than
// alarming — the crawl renders live data, so a relative-age string or a ticking
// market price moves real pixels. maxDiffPixelRatio absorbs a few glyphs;
// anything larger gets the HTML treatment above before it is called a
// regression.
//
// What this does NOT cover: hover and interaction states — that is
// fit-finish.spec.ts's job.
import { test, expect } from "@playwright/test";
import { ROUTES } from "./routes";

const FROM = process.env.CAPTURE_FROM ?? "http://localhost:3000";
const AGAINST = process.env.CAPTURE_AGAINST ?? "http://localhost:3007";
const ROLE = process.env.CAPTURE_ROLE === "baseline" ? "baseline" : "compare";
const BASE = ROLE === "baseline" ? FROM : AGAINST;

const VIEWS = [
  { tag: "1440", w: 1440, h: 1200, reduced: false },
  { tag: "2560", w: 2560, h: 1440, reduced: false },
  { tag: "1440-reduced", w: 1440, h: 1200, reduced: true },
] as const;

test.describe("@nonci bundler captures", () => {
  for (const v of VIEWS) {
    test.describe(`@${v.tag}`, () => {
      test.use({
        viewport: { width: v.w, height: v.h },
        reducedMotion: v.reduced ? "reduce" : "no-preference",
      });

      for (const r of ROUTES as { slug: string; path: string }[]) {
        test(`${r.slug} @${v.tag}`, async ({ page }) => {
          await page.context().addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
          await page.goto(BASE + r.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
          await page.waitForLoadState("load").catch(() => {});
          // let the tape/marquee settle; animations are frozen by the comparator
          await page.waitForTimeout(1_200);
          await expect(page).toHaveScreenshot(`${r.slug}-${v.tag}.png`, {
            fullPage: true,
            animations: "disabled",
            caret: "hide",
            maxDiffPixelRatio: 0.002,
            timeout: 30_000,
          });
        });
      }
    });
  }
});
