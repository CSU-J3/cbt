// HO 692 — does the `data-odds` pre-paint attribute cause a hydration mismatch?
// READ-ONLY. Local-only, DEV-BUILD-only (React 19 names components and reports
// recoverable mismatches only in a dev build).
//
// WHY A NEW FILE RATHER THAN REUSING pref-hydration-690.ts. That harness is
// hardcoded to the weekSummary key AND its control plants on
// `.week-sentences-chev`, which exists on `/` and NOWHERE ELSE — so on
// `/electoral` its control is structurally unable to fire, and a run there would
// be A/B zeros with no way to tell "clean" from "detector blind". Parameterising
// it was tried first and left it reporting `PLANTED(x0)` inconsistently, i.e. a
// tracked instrument degraded for a reason not attributed; it was reverted
// untouched rather than shipped half-understood. This file borrows its ideas —
// same regex, both channels, plant-as-control — and plants on `.pnav-item`,
// which is on every route through PrimaryNav.
//
// WHAT A ZERO MEANS, AND WHAT IT DOES NOT. Zero fires with the pref SET is only
// evidence beside zero with it UNSET *and* a control that DID fire in the same
// run. A route that cannot fire reports zero either way, so all three are run
// and printed, and the verdict per route is withheld unless the control fired.
//
//   Prereq: `npm run dev` on :3000. Then:
//     npx tsx scripts/diagnostic/odds-hydration-692.ts
import { type Browser, chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ROUTES = ["/", "/electoral"];

// Verbatim from hydration-clock-harness-590.ts / pref-hydration-690.ts, so a
// fire here and a fire there mean the same thing.
const HYDRATION_RE =
  /Hydration failed because the server rendered|Minified React error #418|did not match the client/i;

type Leg = { fired: boolean; channel: string; attr: string | null; planted: number | null };

async function run(
  browser: Browser,
  route: string,
  opts: { off: boolean; plant?: boolean },
): Promise<Leg> {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
  // NOTE: every function handed to addInitScript stays inline and tiny. tsx can
  // emit `__name` wrappers around named functions, and those are serialised into
  // the PAGE where `__name` does not exist — the init script then throws
  // silently and the run reports a clean page it never actually configured
  // (HO 687, one API over).
  if (opts.off)
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("cbt:pref:odds", "off");
      } catch {}
    });
  if (opts.plant)
    // THE CONTROL. Remove a node from inside the React tree after the SSR markup
    // is parsed and before hydration walks it — a structural mismatch React must
    // report. Polled at 1ms rather than observed: at init-script time
    // `document.documentElement` is still null so observe() throws, and a
    // DOMContentLoaded listener can land after hydration, making the edit a
    // post-hydration change React never sees.
    await ctx.addInitScript(() => {
      const w = window as unknown as { __planted?: number };
      w.__planted = 0;
      const t = setInterval(() => {
        const el = document.querySelector(".pnav-item");
        if (el) {
          el.remove();
          w.__planted = (w.__planted ?? 0) + 1;
          clearInterval(t);
        }
      }, 1);
      setTimeout(() => clearInterval(t), 60000);
    });

  const page = await ctx.newPage();
  const msgs: { m: string; ch: string }[] = [];
  page.on("pageerror", (e) => msgs.push({ m: e.message, ch: "pageerror" }));
  page.on("console", (m) => {
    if (m.type() === "error") msgs.push({ m: m.text(), ch: "console" });
  });

  let loaded = false;
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    loaded = true;
    await page.waitForTimeout(3000);
  } catch {
    // Recorded, never swallowed: a leg whose page did not load has no reading,
    // and must not be printed as a clean one.
  }
  const attr = loaded
    ? await page
        .evaluate(() => document.documentElement.getAttribute("data-odds"))
        .catch(() => null)
    : null;
  const planted = opts.plant && loaded
    ? await page
        .evaluate(() => (window as unknown as { __planted?: number }).__planted ?? 0)
        .catch(() => -1)
    : null;
  const hit = msgs.find((x) => HYDRATION_RE.test(x.m));
  await ctx.close();
  if (!loaded) return { fired: false, channel: "PAGE DID NOT LOAD", attr: null, planted };
  return { fired: !!hit, channel: hit?.ch ?? "", attr, planted };
}

async function main() {
  const browser = await chromium.launch();
  let bad = 0;
  for (const route of ROUTES) {
    console.log(`\n======== ${route} ========`);
    const unset = await run(browser, route, { off: false });
    const set = await run(browser, route, { off: true });
    const ctrl = await run(browser, route, { off: true, plant: true });
    const line = (l: string, r: Leg) =>
      console.log(
        `  ${l.padEnd(26)} data-odds=${String(r.attr).padEnd(5)} ${r.planted === null ? "" : `PLANTED(x${r.planted}) `}-> ${r.fired ? `FIRE (via ${r.channel})` : r.channel || "no fire"}`,
      );
    line("A  pref UNSET", unset);
    line("B  pref OFF", set);
    line("C  pref OFF + PLANT", ctrl);

    if (set.attr !== "off") {
      console.log("  VERDICT: WITHHELD — leg B never got data-odds=off, so it configured nothing.");
      bad++;
    } else if (!ctrl.fired || !ctrl.planted) {
      console.log("  VERDICT: WITHHELD — the control did not fire, so the A/B zeros are not evidence.");
      bad++;
    } else if (unset.fired || set.fired) {
      console.log("  VERDICT: MISMATCH on a subject leg.");
      bad++;
    } else {
      console.log("  VERDICT: CLEAN — control fired, both subject legs silent, pref applied.");
    }
  }
  await browser.close();
  console.log(`\n${bad === 0 ? "ALL ROUTES CLEAN" : `${bad} ROUTE(S) WITHHELD OR FAILING`}`);
  process.exit(bad === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
