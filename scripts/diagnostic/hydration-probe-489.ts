// HO 489 — React #418 hydration mismatch probe (read-only diagnostic).
// Drives dev-mode Chromium at localhost:3000 and dumps the VERBATIM hydration
// warning + component stack for /bills, /changes, /dashboard-v2. Dev, not prod:
// prod minifies #418 to a bare code; dev prints the server-vs-client diff.
// Run: npx tsx scripts/diagnostic/hydration-probe-489.ts
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ROUTES = (process.env.ROUTES ?? "/bills,/changes,/dashboard-v2").split(",");
const RELOADS = Number(process.env.RELOADS ?? "3");

// Forcing the straddle: dev's SSR→hydrate gap is ~0ms so a minute/day-bucketed
// relative-age rarely crosses a boundary naturally. Advancing ONLY the client's
// Date.now() (Date.parse untouched, so ISO parsing is unaffected) makes the
// client compute a later bucket than the server did — the exact production
// server-slow / client-late straddle, made deterministic. 0 = off.
const CLOCK_OFFSET_MS = Number(process.env.CLOCK_OFFSET_MS ?? "0");

const browser = await chromium.launch();
const context = await browser.newContext();
await context.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
if (CLOCK_OFFSET_MS) {
  await context.addInitScript((off: number) => {
    const real = Date.now.bind(Date);
    Date.now = () => real() + off;
  }, CLOCK_OFFSET_MS);
}

for (const route of ROUTES) {
  for (let i = 0; i < RELOADS; i++) {
    const page = await context.newPage();
    const msgs: string[] = [];
    page.on("console", (m) => {
      const t = m.type();
      if (t === "error" || t === "warning") msgs.push(`[console.${t}] ${m.text()}`);
    });
    page.on("pageerror", (e) => msgs.push(`[pageerror] ${e.message}\n${e.stack ?? ""}`));
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
    } catch (e) {
      msgs.push(`[goto-failed] ${(e as Error).message}`);
    }
    await page.waitForTimeout(1500);
    const hy = msgs.filter((m) =>
      /hydrat|#418|#419|#423|did not match|server.rendered|Text content|tree hydrated/i.test(m),
    );
    console.log(`\n===== ${route}  (load ${i + 1}/${RELOADS}) =====`);
    if (msgs.length === 0) console.log("  (no console.error / console.warning / pageerror)");
    else for (const m of msgs) console.log("  " + m.replace(/\n/g, "\n  "));
    console.log(`  --> hydration-related count: ${hy.length}`);
    await page.close();
  }
}

await browser.close();
