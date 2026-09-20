import { defineConfig, devices } from "@playwright/test";

// HO 379 — smoke crawler config. Runs against the LIVE Vercel deploy by default
// (the worst bugs here are egress/cold-start specific; localhost reproduces none
// of it). Override with BASE_URL for a preview deploy or localhost.
const BASE_URL =
  process.env.BASE_URL ?? "https://congressional-terminal-chi-silk.vercel.app";

// HO 739 — Vercel Deployment Protection (Standard) went on 2026-09-19, which
// walls every Preview and every superseded Production URL behind SSO. The
// production DOMAIN is unaffected, so the daily crawl and the post-FF run are
// untouched; what breaks is `narrow-preview`, whose whole target is a Preview.
//
// THIS IS THE ONE SITE THAT COVERS EVERY REQUEST. `use.baseURL` feeds every
// `page.goto` in every spec, so the header set here rides them all — a per-spec
// version would have to be added again to each new spec, and the one that
// forgot would go green against an SSO page.
//
// CONDITIONAL, and deliberately so: when the env var is unset this is `{}` and
// nothing changes for a local run or for the prod-domain crawl, which must not
// be sent an automation secret it has no use for. When it is set, Vercel
// accepts the request without the SSO round-trip.
//
// WHAT A MISSING SECRET LOOKS LIKE: the SSO wall answers 302 to
// `vercel.com/sso-api`, not 401, and Playwright FOLLOWS it — so a spec would
// assert against Vercel's login page rather than the app. The workflow's
// `/api/version` step is what catches that before any assertion runs; keep it
// ahead of this in the job, and keep it failing loudly.
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
// HO 740 — THE ANNOTATION IS LOAD-BEARING AND THE TYPE IS WHY.
// Unannotated, this reads as a UNION of the two branches, and TS normalizes
// the empty one by adding both keys as `?: undefined`. `extraHTTPHeaders` is
// `{ [key: string]: string }`, `undefined` is not a `string` under that index
// signature, and the whole `use` object then matches no `defineConfig`
// overload — `TS2769` at the `extraHTTPHeaders` line, pointing at a site two
// dozen lines from the cause. `Record<string, string>` makes the empty branch
// an ordinary empty record and the conditional keeps its runtime meaning
// exactly: unset -> `{}` (no header, which the prod-domain crawl requires),
// set -> the two headers. Both ways re-checked at HO 740 because the type
// changed under a behaviour HO 739 had already proven.
const bypassHeaders: Record<string, string> = BYPASS
  ? { "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" }
  : {};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // HO 702 §3 — archive the PREVIOUS crawl's fire dumps before Playwright wipes
  // outputDir. Back-to-back crawls otherwise keep only the last one's evidence;
  // HO 702 lost a real /races fire this way. Prints its count, zero included.
  globalSetup: "./e2e/preserve-dumps.ts",
  // Live target — keep the run gentle so we don't look like an attack and so the
  // shared Turso/Vercel cold-start latency doesn't trip artificial timeouts.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: bypassHeaders,
    headless: true,
    ignoreHTTPSErrors: true,
    // We screenshot manually per route into test-results/smoke/. No golden
    // baselines this pass (toHaveScreenshot needs curated baselines + flaps).
    screenshot: "off",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
