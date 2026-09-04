// HO 690 — PRE-PAINT PROOF for the client-preference mechanism (lib/prefs.ts +
// the inline <head> script in app/layout.tsx). READ-ONLY apart from one
// localStorage key it sets in the browser profile it created and then discards.
//
// WHAT THIS HAS TO PROVE, and why the obvious check does not. The mechanism
// exists so a reader who collapsed the week summary never sees the text flash in
// on a later visit. Checking that the row is collapsed AFTER the page settles
// proves nothing about that: a `useEffect` that collapses it 400ms late settles
// to exactly the same DOM. The claim is about the FIRST FRAME, so the reading is
// taken at `domcontentloaded` — before `load`, before any bundle, before
// hydration — and it is the state at that instant that is asserted.
//
// WHAT THE INSTRUMENT READS IF THE WORK WERE NEVER DONE: leg A would read
// `attr=null` and `display=block`, i.e. THE TEXT VISIBLE IN THAT FRAME. That is
// not a hypothetical — leg C makes it happen, by intercepting the served HTML and
// stripping the boot script out of it before the browser sees it, with the
// preference still stored. A detector that has never produced its own failure is
// unproven, not protection (docs/method.md § Gates).
//
// FOUR LEGS:
//   A  collapsed  key set, page as served       -> attr "collapsed", text hidden
//   B  default    no key, page as served        -> attr null,        text visible
//   C  control    key set, boot script STRIPPED -> attr null,        text visible
//   D  order      boot script's bytes precede <body> in the served document
//
// A and C differ in exactly one byte-range of the served document, so C is the
// pre-paint script's own falsification and not a different experiment. D exists
// because A/B/C land at whichever readyState the evaluate wins — see its comment.
//
// The cache is disabled over CDP for every leg, so no leg can be served a frame
// the browser had already painted once.
//
// Usage: npx tsx scripts/diagnostic/prepaint-690.ts [baseUrl] [outDir]
// Target: `npm run build && npm run start` on :3000.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "docs/handoffs/690-artifacts";
const KEY = "cbt:pref:weekSummary";
const ATTR = "data-week-summary";

const GATE_COOKIE = {
  name: "ct_seen",
  value: "1",
  domain: "localhost",
  path: "/",
  expires: -1,
  httpOnly: false,
  secure: false,
  sameSite: "Lax" as const,
};

type Leg = { id: string; setKey: boolean; stripBoot: boolean; expect: "hidden" | "visible" };

const LEGS: Leg[] = [
  { id: "A-collapsed", setKey: true, stripBoot: false, expect: "hidden" },
  { id: "B-default", setKey: false, stripBoot: false, expect: "visible" },
  { id: "C-control-boot-stripped", setKey: true, stripBoot: true, expect: "visible" },
];

async function run(browser: Browser, leg: Leg) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  await ctx.addCookies([GATE_COOKIE]);
  if (leg.setKey) {
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
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  if (leg.stripBoot) {
    // Strip ONLY the pre-paint script from the served document. Everything else
    // — the CSS, the markup, the bundle — is byte-identical to leg A.
    await page.route(`${BASE}/`, async (route) => {
      const res = await route.fetch();
      const body = await res.text();
      const stripped = body.replace(
        /<script[^>]*>\(function\(\)\{try\{var P=.*?\}\)\(\);<\/script>/s,
        "",
      );
      if (stripped === body) {
        throw new Error(
          "control leg could not find the boot script to strip — the regex and the emitted script have drifted; the control is invalid, not passing",
        );
      }
      await route.fulfill({ response: res, body: stripped });
    });
  }

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const reading = await page.evaluate(
    ([attr]) => {
      const el = document.querySelector(".week-sentences-text");
      return {
        attr: document.documentElement.getAttribute(attr as string),
        present: !!el,
        display: el ? getComputedStyle(el).display : "(no element)",
        readyState: document.readyState,
      };
    },
    [ATTR],
  );
  await page.screenshot({ path: join(OUT, `prepaint-${leg.id}.png`), fullPage: false });
  await ctx.close();

  const hidden = reading.display === "none";
  const got = hidden ? "hidden" : "visible";
  const pass = reading.present && got === leg.expect;
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${leg.id.padEnd(24)} ` +
      `readyState=${reading.readyState} ${ATTR}=${String(reading.attr)} ` +
      `text ${reading.present ? `display:${reading.display}` : "ABSENT FROM DOM"} ` +
      `-> ${got} (expected ${leg.expect})`,
  );
  return pass;
}

// LEG D — the ORDER, read out of the served bytes.
//
// A, B and C are taken at `domcontentloaded`, and which readyState the evaluate
// actually lands on varies run to run (observed both `interactive` and
// `complete`) — so on its own that trio shows the attribute is applied without
// anything from the bundle, not that it is applied before the body exists. This
// leg closes that gap without adding a timing race: the boot script is
// synchronous and parser-blocking, so if its bytes precede `<body` in the served
// document then it has run before the body element exists, and therefore before
// anything in the body can paint. Byte offsets, printed, not asserted from the
// source.
async function legD(): Promise<boolean> {
  const html = await (await fetch(`${BASE}/`, { headers: { cookie: "ct_seen=1" } })).text();
  const boot = html.indexOf("(function(){try{var P=");
  const head = html.indexOf("<head");
  const body = html.indexOf("<body");
  const ok = boot > -1 && head > -1 && body > -1 && boot > head && boot < body;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  D-order  <head>@${head} · boot script@${boot} · <body>@${body}` +
      ` -> boot ${boot < body ? "PRECEDES" : "FOLLOWS"} <body>`,
  );
  if (boot === -1) console.log("      boot script not found in the served document at all");
  return ok;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let ok = true;
  for (const leg of LEGS) ok = (await run(browser, leg)) && ok;
  console.log("\nD — the order, read out of the served bytes.");
  ok = (await legD()) && ok;
  await browser.close();
  console.log(
    ok
      ? "\nAll four legs as expected. Leg C is the falsification: with the boot script\nstripped and the preference still stored, the same instrument reads the text\nVISIBLE in the first frame — which is what it would read if the script were\nnever wired at all. Leg D is what makes it a claim about the FIRST FRAME rather\nthan about the settled DOM: the script's bytes precede <body>, and it is\nsynchronous, so it ran before the body element existed."
      : "\nAt least one leg did not read as expected — see above.",
  );
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
