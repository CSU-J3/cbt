import { defineConfig, devices } from "@playwright/test";

// HO 379 — smoke crawler config. Runs against the LIVE Vercel deploy by default
// (the worst bugs here are egress/cold-start specific; localhost reproduces none
// of it). Override with BASE_URL for a preview deploy or localhost.
const BASE_URL =
  process.env.BASE_URL ?? "https://congressional-terminal-chi-silk.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
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
