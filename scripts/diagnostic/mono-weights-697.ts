/**
 * HO 697 row 3 — which mono weights are actually rendered.
 *
 * C2 swaps `--font-mono` to a SELF-HOSTED face, so the weight list stops being
 * free: a weight that is used but not loaded is synthesised (faux bold, wrong
 * metrics — the HO 642 complaint that produced `.v2f-title`'s explicit 400), and
 * a weight that is loaded but unused is bytes on every page. Neither is visible
 * without asking the DOM.
 *
 * Walks every `e2e/routes.ts` ROUTES entry at 1440 against a LOCAL PRODUCTION
 * build and, for each element whose computed `font-family` resolves through the
 * mono token, records the computed `font-weight` and `font-feature-settings`.
 * Histogram per route and in total.
 *
 * Mono is the app default (`html, body { font-family: var(--font-mono) }`), so
 * "resolves through the token" is detected by the token's own first family
 * rather than by a sans exclusion: an element inheriting mono reports the whole
 * stack, an element on `--sans` reports Plex Sans first. Read the marker off
 * globals.css rather than hardcoding it, so the probe survives C2.
 *
 * Run against `next start` on :3000, never `next dev` (dev serves different
 * CSS ordering). Read-only: no DB, no writes, no network beyond localhost.
 *
 * READINGS. Both runs, 36/36 routes, 1440, local production build.
 *
 *   2026-09-05, pre-swap (at 90dc6ad + C1): 33,966 mono text elements —
 *     400 27,508 (81.0%) · 600 4,636 (13.6%) · 500 1,549 (4.6%) · 700 273 (0.8%)
 *     font-feature-settings computed "cv02","ss01" on 33,964 of 33,966.
 *   2026-09-06, post-swap: 33,565 elements — 400 27,219 (81.1%) ·
 *     600 4,626 (13.8%) · 500 1,471 (4.4%) · 700 249 (0.7%)
 *     font-feature-settings computed "normal" on ALL 33,565.
 *
 * The element-count drift is live data between runs, not structure; the weight
 * distribution is the same and is what C2 loads. The second run also proves the
 * marker fix below: the token now leads with a var(), and a first-family match
 * would have printed a confident zero on every route.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { ROUTES } from "../../e2e/routes";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const VIEWPORT = { width: 1440, height: 1200 };

/**
 * A family from the --font-mono token that a COMPUTED fontFamily will contain.
 *
 * Deliberately not "the first family": after HO 697 C2 the token leads with
 * `var(--font-plex-mono)`, which the computed value RESOLVES — so matching on it
 * finds nothing and the probe reports a confident zero on every route. Take the
 * first entry that is a literal family name instead; `ui-monospace` sits behind
 * the var and survives both sides of that change, which is what makes this read
 * off the file rather than a hardcoded string.
 */
function monoMarker(): string {
  const css = readFileSync("app/globals.css", "utf8");
  const m = css.match(/--font-mono:\s*([^;]+);/);
  if (!m || !m[1]) throw new Error("could not read --font-mono from globals.css");
  const families = m[1]
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .filter((f) => f.length > 0 && !f.startsWith("var("));
  const first = families[0];
  if (!first) throw new Error("no literal family in --font-mono");
  return first;
}

type Row = { weight: string; feat: string };

async function main(): Promise<void> {
  const marker = monoMarker();
  console.log(`mono marker (first family of --font-mono): ${marker}`);
  console.log(`base ${BASE} · viewport ${VIEWPORT.width}x${VIEWPORT.height}\n`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  await ctx.addCookies([
    { name: "ct_seen", value: "1", domain: "localhost", path: "/" },
  ]);
  const page = await ctx.newPage();

  const total = new Map<string, number>();
  const feats = new Map<string, number>();
  let routesOk = 0;

  for (const r of ROUTES) {
    try {
      await page.goto(`${BASE}${r.path}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(400);
    } catch {
      console.log(`${r.slug.padEnd(24)} — navigation failed, skipped`);
      continue;
    }

    const rows: Row[] = await page.evaluate((mk) => {
      const out: { weight: string; feat: string }[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        const cs = getComputedStyle(el);
        if (!cs.fontFamily.includes(mk)) continue;
        // Only elements that actually paint text of their own.
        const hasText = Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0,
        );
        if (!hasText) continue;
        out.push({ weight: cs.fontWeight, feat: cs.fontFeatureSettings });
      }
      return out;
    }, marker);

    routesOk++;
    const per = new Map<string, number>();
    for (const row of rows) {
      per.set(row.weight, (per.get(row.weight) ?? 0) + 1);
      total.set(row.weight, (total.get(row.weight) ?? 0) + 1);
      feats.set(row.feat, (feats.get(row.feat) ?? 0) + 1);
    }
    const line = [...per.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([w, n]) => `${w}:${n}`)
      .join("  ");
    console.log(`${r.slug.padEnd(24)} ${rows.length.toString().padStart(5)} mono els   ${line}`);
  }

  await browser.close();

  console.log(`\n=== TOTAL over ${routesOk}/${ROUTES.length} routes ===`);
  const sum = [...total.values()].reduce((a, b) => a + b, 0);
  for (const [w, n] of [...total.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const pct = ((n / sum) * 100).toFixed(1);
    console.log(`  weight ${w.padEnd(4)} ${n.toString().padStart(6)}  ${pct}%`);
  }
  console.log(`  ---- ${sum} mono text elements`);
  console.log("\n=== computed font-feature-settings seen ===");
  for (const [f, n] of [...feats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${JSON.stringify(f)}  ${n}`);
  }
  console.log(
    "\nWEIGHTS TO LOAD = the set above. A used weight not loaded is synthesised;",
  );
  console.log("a loaded weight unused is bytes on every page.");
}

main();
