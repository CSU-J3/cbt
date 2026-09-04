// HO 692 — the toggle's behavioural proof: first paint, round trip,
// persistence, and the one gated site that is a STRING rather than an element.
//
// LOCAL ONLY, and it wants a production build (`next start`), not `next dev`.
//
// NO NAMED FUNCTIONS INSIDE `page.evaluate` — tsx wraps them in a `__name`
// helper the page does not have, and the whole leg dies with
// "ReferenceError: __name is not defined" (HO 687). Everything inside an
// evaluate here is inline for that reason; it reads worse and it runs.
//
//   npx tsx scripts/diagnostic/odds-toggle-692.ts
import { type Browser, type BrowserContext, chromium } from "playwright";

const B = process.env.BASE_URL ?? "http://localhost:3000";
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`,
  );
}

async function ctxFor(
  browser: Browser,
  opts: { off?: boolean; stripBoot?: boolean } = {},
): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([
    { name: "ct_seen", value: "1", domain: new URL(B).hostname, path: "/" },
  ]);
  if (opts.off)
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("cbt:pref:odds", "off");
      } catch {}
    });
  if (opts.stripBoot)
    // THE FALSIFICATION LEG. Same document, preference still stored, ONLY the
    // pre-paint script removed. What this leg reads is exactly what the
    // instrument would read if the boot wiring had never been done — so if it
    // did not differ from the real run in that one frame, the first-paint claim
    // would be untested rather than proven.
    await ctx.route(`${B}/`, async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace(
        /<script>\(function\(\)\{try\{var P=[\s\S]*?\}\)\(\);<\/script>/,
        "",
      );
      await route.fulfill({ response: res, body });
    });
  return ctx;
}

async function main() {
  const browser = await chromium.launch();

  // ── LEG 2 — the FIRST FRAME, read at domcontentloaded ─────────────────────
  console.log("\n-- LEG 2: first paint (read at domcontentloaded)");
  for (const [label, opts, expectAttr, expectHidden] of [
    ["pref OFF, boot wired", { off: true }, "off", true],
    ["pref UNSET (control)", {}, null, false],
    ["pref OFF, boot STRIPPED (falsification)", { off: true, stripBoot: true }, null, false],
  ] as const) {
    const ctx = await ctxFor(browser, opts);
    const p = await ctx.newPage();
    await p.goto(`${B}/`, { waitUntil: "domcontentloaded" });
    const r = await p.evaluate(() => {
      const tapes = document.querySelectorAll(".dv2-tapes .markets-tape");
      const tape = tapes[1] as HTMLElement | undefined;
      const kp = document.querySelector(".rc-kpline") as HTMLElement | null;
      return {
        attr: document.documentElement.getAttribute("data-odds"),
        tapeVisible: tape ? getComputedStyle(tape).display !== "none" : null,
        kpVisible: kp ? getComputedStyle(kp).display !== "none" : null,
      };
    });
    check(`${label} — data-odds`, r.attr, expectAttr);
    check(`${label} — ODDS tape hidden in first frame`, r.tapeVisible === false, expectHidden);
    check(`${label} — K/P line hidden in first frame`, r.kpVisible === false, expectHidden);
    await ctx.close();
  }

  // ── LEG 3 — round trip, no navigation, persistence ────────────────────────
  console.log("\n-- LEG 3: toggle round trip");
  const ctx = await ctxFor(browser);
  const p = await ctx.newPage();
  await p.goto(`${B}/`, { waitUntil: "networkidle" });
  await p.locator(".dv2-racesbox-tab", { hasText: "RACES" }).first().click();
  await p.waitForTimeout(300);
  // A window marker a real navigation would destroy — that is how "no reload"
  // is asserted rather than assumed.
  await p.evaluate(() => {
    (window as unknown as { __ho692?: boolean }).__ho692 = true;
  });
  const state = () =>
    p.evaluate(() => {
      const tapes = document.querySelectorAll(".dv2-tapes .markets-tape");
      const tape = tapes[1] as HTMLElement | undefined;
      const kp = document.querySelector(".rc-kpline") as HTMLElement | null;
      const btn = document.querySelector(".odds-toggle") as HTMLElement | null;
      return {
        attr: document.documentElement.getAttribute("data-odds"),
        stored: localStorage.getItem("cbt:pref:odds"),
        tape: tape ? getComputedStyle(tape).display !== "none" : null,
        kp: kp ? getComputedStyle(kp).display !== "none" : null,
        label: btn ? btn.innerText.replace(/\s+/g, " ").trim() : null,
        pressed: btn ? btn.getAttribute("aria-pressed") : null,
        marker: (window as unknown as { __ho692?: boolean }).__ho692 === true,
      };
    });

  check("initial (default: attribute and key both ABSENT)", await state(), {
    attr: null, stored: null, tape: true, kp: true, label: "ODDS ON", pressed: "true", marker: true,
  });
  await p.locator(".odds-toggle").first().click();
  await p.waitForTimeout(200);
  check("after 1st click", await state(), {
    attr: "off", stored: "off", tape: false, kp: false, label: "ODDS OFF", pressed: "false", marker: true,
  });
  await p.locator(".odds-toggle").first().click();
  await p.waitForTimeout(200);
  // Back to default REMOVES the key rather than storing "on" — one
  // representation of the default, which is what keeps an unset browser and a
  // reset one byte-identical.
  check("after 2nd click (key REMOVED, not set to 'on')", await state(), {
    attr: null, stored: null, tape: true, kp: true, label: "ODDS ON", pressed: "true", marker: true,
  });

  await p.locator(".odds-toggle").first().click();
  await p.waitForTimeout(200);
  await p.reload({ waitUntil: "networkidle" });
  await p.locator(".dv2-racesbox-tab", { hasText: "RACES" }).first().click();
  await p.waitForTimeout(300);
  const after = await state();
  check("persisted across reload — attr", after.attr, "off");
  check("persisted across reload — tape hidden", after.tape, false);
  check("the reload really happened (marker gone)", after.marker, false);
  await ctx.close();

  // ── SITE 13 — the export markdown, which no CSS can reach ─────────────────
  console.log("\n-- SITE 13: district-modal export markdown (the real string)");
  for (const [label, off, expectKalshi] of [
    ["odds ON", false, true],
    ["odds OFF", true, false],
  ] as const) {
    const c = await ctxFor(browser, { off });
    const pg = await c.newPage();
    // Intercept the Blob the download handler builds rather than the file.
    await pg.addInitScript(() => {
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (b: Blob | MediaSource) => {
        if (b instanceof Blob)
          b.text().then((t) => {
            (window as unknown as { __md?: string }).__md = t;
          });
        return orig(b as Blob);
      };
    });
    await pg.goto(`${B}/electoral`, { waitUntil: "networkidle" });
    // A competitive state on the map: `.us-map-state` is the ACTIVE class
    // (`--inactive` states have no contests and open nothing).
    await pg.locator("path.us-map-state").first().click({ force: true }).catch(() => {});
    await pg.waitForTimeout(700);
    const chip = pg.locator(".rdm-chip").first();
    if (await chip.count()) {
      await chip.click().catch(() => {});
      await pg.waitForTimeout(400);
    }
    const exp = pg.locator("button", { hasText: "EXPORT" }).first();
    if (await exp.count()) {
      await exp.click().catch(() => {});
      await pg.waitForTimeout(600);
    }
    const md = await pg.evaluate(
      () => (window as unknown as { __md?: string }).__md ?? null,
    );
    if (md === null) {
      // Reported, never counted as a pass — a leg that could not run is not a
      // leg that succeeded (the skip-on-empty inversion).
      console.log(`  SKIP  ${label} — export not reachable in this run (no district selected)`);
      fail++;
    } else {
      check(`${label} — export contains "Kalshi market:"`, md.includes("Kalshi market:"), expectKalshi);
      console.log(`        head: ${md.split("\n").slice(0, 5).join(" | ")}`);
    }
    await c.close();
  }

  await browser.close();
  console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILURE(S)/SKIP(S)`}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
