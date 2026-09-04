// HO 690 — does the pre-paint preference attribute cause a hydration mismatch?
// READ-ONLY. Local-only, dev-build-only, same reasons as the HO 590 harness.
//
// The claim being tested is narrow and specific: `lib/prefs.ts`'s <head> script
// writes a `data-*` attribute on <html> BEFORE React hydrates, and React should
// not care, because it never rendered that attribute and therefore has nothing to
// reconcile it against. That is an argument, and an argument is not a reading —
// hence this.
//
// WHY NOT JUST hydration-clock-harness-590.ts: that harness has no notion of a
// stored preference, so running it proves the routes are clean with the pref
// UNSET and says nothing about the set case. This adds exactly that one
// dimension, and reuses the harness's own regex and HTML-vs-text discriminator so
// a fire here and a fire there mean the same thing. The clock skews are the
// harness's control and its bluntest boundary-crosser. ONE DELIBERATE WIDENING:
// this listens on console.error as well as pageerror — see the note at the
// listeners for why a pageerror-only detector cannot see a recoverable mismatch.
//
// WHAT A ZERO MEANS HERE, and what it does not. Zero fires with the pref SET is
// only informative beside zero with it UNSET, because a route that cannot fire at
// all reports zero either way — so both are run and printed. And the detector is
// shown able to fire at all: leg C plants a real structural mismatch on the same
// page under the same detection, and it must fire. Without that leg this file
// would be a green that proves the regex still compiles.
//
// READING AT HO 690 (dev, 2026-09-03): four A/B legs silent, leg C FIRE (HTML,
// via pageerror). The attribute is read back AFTER the 2.5s settle, so
// `data-week-summary=collapsed` on the set legs is the state that SURVIVED
// hydration, not the state the boot script left.
//
// Incidental, recorded because it is easy to misread: leg C reports the attribute
// as `null` even though the preference was stored. React owns <html> in the App
// Router, so a forced tree regeneration takes the extra attribute with it. That
// only happens on a page that is already mismatching, which is why it is a note
// and not a defect — but it does mean this attribute is not a place to put
// anything that must survive a broken render.
//
//   Prereq: `npm run dev` on :3000. Then:
//     npx tsx scripts/diagnostic/pref-hydration-690.ts

import { chromium, type Browser } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const COOKIE = { name: "ct_seen", value: "1", url: BASE };
const KEY = "cbt:pref:weekSummary";
const DAY = 24 * 60 * 60 * 1000;

// Verbatim from hydration-clock-harness-590.ts:55 — see the header.
const HYDRATION_RE =
  /Hydration failed because the server rendered|Minified React error #418|did not match the client/i;

type Result = { fired: boolean; variant: string; first: string };

async function run(
  browser: Browser,
  opts: { pref: "set" | "unset"; skew: string; time: Date; plant?: boolean },
): Promise<Result> {
  const ctx = await browser.newContext();
  await ctx.addCookies([COOKIE]);
  if (opts.pref === "set") {
    await ctx.addInitScript(
      ([k]) => {
        try {
          window.localStorage.setItem(k as string, "collapsed");
        } catch {
          /* private mode */
        }
      },
      [KEY],
    );
  }
  if (opts.plant) {
    // LEG C — a REAL mismatch, planted on the same page under the same detector:
    // an element is REMOVED from inside the React tree after the SSR markup is
    // parsed and before hydration runs, which is a structural mismatch React must
    // report. That is the contrast the A/B legs need — an attribute on <html> that
    // React never rendered versus a node inside the tree that it did.
    //
    // NOT a <body> className rewrite, which was the first attempt and did NOT
    // fire: React deliberately tolerates <html>/<body> attribute drift because
    // browser extensions do exactly that, so a plant there is silent and the
    // control would have read as "cannot fire" while actually being "not
    // reconciled" — the same-as-success shape inside the control itself.
    // Polled, not a MutationObserver and not a DOMContentLoaded listener. At
    // init-script time `document.documentElement` is still null, so observe()
    // throws; and DOMContentLoaded can land after hydration has already walked the
    // subtree, in which case the removal is a post-hydration DOM edit React never
    // sees. A 1ms poll takes the node the instant the parser emits it, which is
    // the window a real pre-hydration mismatch lives in.
    await ctx.addInitScript(() => {
      const w = window as unknown as { __ho690Stripped?: number };
      w.__ho690Stripped = 0;
      const t = setInterval(() => {
        const el = document.querySelector(".week-sentences-chev");
        if (el) {
          el.remove();
          w.__ho690Stripped = (w.__ho690Stripped ?? 0) + 1;
          clearInterval(t);
        }
      }, 1);
      setTimeout(() => clearInterval(t), 15000);
    });
  }
  const page = await ctx.newPage();
  // BOTH CHANNELS. React 19 reports a RECOVERABLE hydration mismatch through
  // console.error and only throws for the unrecoverable ones, so a pageerror-only
  // detector reads "no fire" on a real mismatch — which is what the first two
  // attempts at leg C did. The channel each hit arrived on is printed, so a reader
  // can see which kind of fire it was.
  const messages: string[] = [];
  const channels: string[] = [];
  page.on("pageerror", (e) => {
    messages.push(e.message + (e.stack ? `\n${e.stack}` : ""));
    channels.push("pageerror");
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    messages.push(m.text());
    channels.push("console");
  });
  try {
    await page.clock.install({ time: opts.time });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);
  } catch {
    /* nav/compile hiccup — record nothing, keep going */
  }
  const hits = messages
    .map((m, i) => ({ m, ch: channels[i] ?? "?" }))
    .filter((x) => HYDRATION_RE.test(x.m));
  const hy = hits.map((x) => x.m);
  const attr = await page
    .evaluate(() => document.documentElement.getAttribute("data-week-summary"))
    .catch(() => "(unreadable)");
  // Did the plant actually land? A control that silently failed to plant reads
  // exactly like a control that planted and was tolerated.
  const stripped = opts.plant
    ? await page
        .evaluate(
          () => (window as unknown as { __ho690Stripped?: number }).__ho690Stripped ?? 0,
        )
        .catch(() => -1)
    : null;
  await page.close();
  await ctx.close();
  const variant = hy.length
    ? /server rendered HTML/i.test(hy[0]!)
      ? "HTML"
      : /server rendered text/i.test(hy[0]!)
        ? "text"
        : "?"
    : "-";
  console.log(
    `  pref=${opts.pref.padEnd(5)} skew=${opts.skew.padEnd(11)} ` +
      `${opts.plant ? `PLANTED(x${stripped}) ` : "             "}data-week-summary=${String(attr).padEnd(10)} ` +
      `-> ${hy.length ? `FIRE (${variant}, via ${hits[0]!.ch})` : "no fire"}`,
  );
  if (hy.length) console.log(`      ${hy[0]!.split("\n")[0]}`);
  return { fired: hy.length > 0, variant, first: hy[0]?.split("\n")[0] ?? "" };
}

async function main() {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(BASE)) {
    console.log(`REFUSING to run against non-localhost target "${BASE}" — this needs a DEV build.`);
    process.exit(2);
  }
  const browser = await chromium.launch();
  const control = () => new Date();
  const blunt = () => new Date(Date.now() + 40 * DAY);

  console.log("A/B — the subject: does the pre-paint attribute change anything?");
  const a1 = await run(browser, { pref: "unset", skew: "control(+0)", time: control() });
  const a2 = await run(browser, { pref: "set", skew: "control(+0)", time: control() });
  const a3 = await run(browser, { pref: "unset", skew: "blunt(+40d)", time: blunt() });
  const a4 = await run(browser, { pref: "set", skew: "blunt(+40d)", time: blunt() });

  console.log("\nC — the control: can this detector fire on this page at all?");
  const c1 = await run(browser, {
    pref: "set",
    skew: "control(+0)",
    time: control(),
    plant: true,
  });
  await browser.close();

  const quiet = [a1, a2, a3, a4].every((r) => !r.fired);
  const ok = quiet && c1.fired;
  console.log(
    `\nA/B: ${quiet ? "zero fires with the pref set AND unset" : "AT LEAST ONE FIRE — see above"}`,
  );
  console.log(
    `C  : ${c1.fired ? "the planted mismatch FIRED — the detector works on this page" : "THE PLANT DID NOT FIRE — this run proves nothing; the A/B zeros are not evidence"}`,
  );
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
