// HO 687 STEP 0 — READ-ONLY. The noise floor (row 3) and the stack shape (row 4b)
// for the #418 attribution instrument, plus a working prototype of channel C.
//
// WRITES NOTHING to the DB and nothing to the repo. It navigates, retains the
// served bytes, snapshots the settled DOM, and prints. Dump files (with --dump)
// land under test-results/, which Playwright cleans at run START (HO 683).
//
// WHY THIS EXISTS BEFORE THE BUILD. Channel C's whole claim is that an SSR↔DOM
// structural diff LOCALIZES a hydration mismatch without sourcemaps, DEV mode or
// component names. That claim is worthless until we know what a CLEAN load's
// diff looks like: if a healthy route already diverges in twenty places, a fire's
// dump is noise and the instrument reports nothing. So the floor is measured per
// route FIRST, and the legitimate deltas catalogued, exactly as row 3 demands.
//
// THE DIFF IS PREFIX/SUFFIX, NOT AN LCS, and that is a deliberate choice rather
// than a shortcut. Common-prefix + common-suffix over the two element sequences
// is O(n), and the window between them IS the localized mismatch region — which
// is the quantity the instrument exists to produce. An LCS would give a prettier
// edit script and the same window, at O(n²) on 5k-element pages.
//
// NORMALIZATION MATTERS: the SSR string is parsed through the browser's own
// DOMParser in page context, so both sides are compared as the SAME parser sees
// them. Comparing regex-scraped tags against a live DOM measures the parser, not
// the render.
//
// CONTROLS. `--skew` installs a browser clock offset (the HO 590 technique) to
// MANUFACTURE a straddle. A route that diverges under skew and not clean is a
// real detection; a route that diverges on BOTH is floor, not signal. A run with
// no skew that reports fires would mean the floor is not a floor.
//
//   npx tsx scripts/diagnostic/hydration-capture-687.ts
//   npx tsx scripts/diagnostic/hydration-capture-687.ts --skew --dump
import "dotenv/config";
import fs from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";

const BASE =
  process.env.BASE_URL ?? "https://congressional-terminal-chi-silk.vercel.app";
const DUMP_DIR = "test-results/hydration-687";
const SKEW_MS = 40 * 24 * 60 * 60 * 1000; // +40d — the HO 590 blunt skew

const BILL = process.env.SEED_BILL ?? "119-s-2";
const MEMBER = process.env.SEED_MEMBER ?? "A000055";
const STAGES = [
  "introduced",
  "committee",
  "floor",
  "other_chamber",
  "president",
  "enacted",
];

// The firing set, per the handoff's ground truth. /president is tapeless and
// stays named (the HO 574 scoping guard) — dropping it would silently narrow the
// denominator the WATCH counts against.
const ROUTES: { slug: string; path: string }[] = [
  { slug: "home", path: "/" },
  ...STAGES.map((s) => ({ slug: `home-stage-${s}`, path: `/?stage=${s}` })),
  { slug: "dashboard-v2", path: "/dashboard-v2" },
  { slug: "bills", path: "/bills" },
  { slug: "stale", path: "/stale" },
  { slug: "committees-redirect", path: "/committees" },
  { slug: "member-detail", path: `/members/${MEMBER}` },
  { slug: "president", path: "/president" },
  { slug: "bill-detail", path: `/bill/${BILL}` },
];

type Capture = {
  slug: string;
  ssrBytes: number;
  ssrCount: number;
  domCount: number;
  prefix: number;
  suffix: number;
  rawWindow: number;
  normWindow: number;
  lcsIns: number;
  lcsDel: number;
  ssrNorm: number;
  domNorm: number;
  windowSsr: string[];
  windowDom: string[];
  pageErr: { message: string; stack: string | null }[];
};

// Descriptor for one element: tag plus the identity-bearing attributes, so a
// text-only change does NOT register as structural. #418 args[]=HTML is a
// STRUCTURAL mismatch; args[]=text is the sibling class and is not what this
// window is looking for.
const DESCRIBE = `(el) => {
  const cls = (el.getAttribute("class") || "").trim().split(/\\s+/)[0] || "";
  const id = el.getAttribute("id") || "";
  return el.tagName.toLowerCase() + (id ? "#" + id : "") + (cls ? "." + cls : "");
}`;

async function capture(
  browser: Browser,
  slug: string,
  path: string,
  skew: boolean,
): Promise<Capture | null> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
  const page: Page = await ctx.newPage();

  const pageErr: Capture["pageErr"] = [];
  page.on("pageerror", (err) => {
    // THE POINT OF ROW 4b: err.stack has never been recorded in 42+ fires.
    pageErr.push({ message: err.message, stack: err.stack ?? null });
  });

  // Retain the MAIN-DOCUMENT served bytes. Not a re-fetch: these routes are
  // force-dynamic, so a second GET is a different render and would diff against
  // markup the browser never hydrated.
  // Holder rather than a bare `let`: TS cannot see an assignment made inside the
  // event callback, narrows the variable to `null`, and then narrows the awaited
  // value to `never` past the guard below.
  const held: { ssr: Promise<string> | null } = { ssr: null };
  page.on("response", (resp) => {
    const req = resp.request();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
      held.ssr = resp.text().catch(() => "");
    }
  });

  if (skew) await page.clock.install({ time: new Date(Date.now() + SKEW_MS) });

  try {
    // DOUBLE-HIT BY DEFAULT-ON-FLAG, because the crawl's fires are not evenly
    // split across its two navigations. The 2026-09-03 daily fired on hit2 in
    // 6 of 7 route-attempts, which is the HO 548 cache-hit path — a single-load
    // probe cannot see that class at all, and would have reported a clean prod
    // on a day the daily failed three attempts straight.
    if (process.argv.includes("--double")) {
      await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1200);
      // A fresh goto, NOT reload — same request shape as the crawl's hit 2.
      held.ssr = null;
      pageErr.length = 0; // attribute only to hit 2, as the crawl's marks do
    }
    await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500); // let hydration + any fallback re-render settle
  } catch (e) {
    console.log(`  ${slug}: NAV FAILED — ${String(e).slice(0, 120)}`);
    await ctx.close();
    return null;
  }

  const ssr = held.ssr ? await held.ssr : "";
  if (!ssr) {
    console.log(`  ${slug}: no SSR bytes retained — capture void for this route`);
    await ctx.close();
    return null;
  }

  // THE WHOLE COMPARISON BODY IS A STRING, evaluated in the browser via
  // `new Function`. It cannot be an ordinary inline callback: tsx/esbuild wraps
  // named arrow/function expressions in a `__name(...)` helper that does not
  // exist in the page, so Playwright serializes source referencing an undefined
  // symbol and every evaluate throws `ReferenceError: __name is not defined`.
  // A plain string is not transformed, so it is immune. (Measured, not guessed:
  // the first cut of this file had no inner named consts and worked; adding two
  // broke every route at once.)
  const BODY = `
    var describe = function (el) {
      var cls = (el.getAttribute("class") || "").trim().split(/\s+/)[0] || "";
      var id = el.getAttribute("id") || "";
      return el.tagName.toLowerCase() + (id ? "#" + id : "") + (cls ? "." + cls : "");
    };
    var win = function (a, b) {
      var p = 0;
      while (p < a.length && p < b.length && a[p] === b[p]) p++;
      var s = 0;
      while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
      return { p: p, s: s, size: Math.max(a.length - p - s, b.length - p - s) };
    };
    var DROP = ["link", "script", "style", "noscript", "meta", "title"];
    var keep = function (d) { return DROP.indexOf(d.split(/[#.]/)[0]) === -1; };
    var doc = new DOMParser().parseFromString(ssrHtml, "text/html");
    var a = Array.prototype.slice.call(doc.querySelectorAll("*")).map(describe);
    var b = Array.prototype.slice.call(document.querySelectorAll("*")).map(describe);
    var an = a.filter(keep), bn = b.filter(keep);
    var raw = win(a, b), norm = win(an, bn);
    // ALIGNMENT TEST (row 3's real question): does an insertion-TOLERANT diff
    // localize where prefix/suffix cannot? LCS over the normalized sequences,
    // guarded on size — 4000^2 is already 16M cells and committees-redirect is
    // 12k elements, where the DP is not worth the memory.
    var ins = -1, del = -1;
    if (an.length <= 4000 && bn.length <= 4000) {
      var m = an.length, n = bn.length;
      var prev = new Int32Array(n + 1), cur = new Int32Array(n + 1);
      for (var i = 1; i <= m; i++) {
        for (var j = 1; j <= n; j++) {
          cur[j] = an[i - 1] === bn[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
        }
        var t = prev; prev = cur; cur = t; cur.fill(0);
      }
      var lcs = prev[n];
      del = m - lcs; ins = n - lcs;
    }
    return {
      lcsIns: ins, lcsDel: del,
      ssrCount: a.length, domCount: b.length,
      prefix: norm.p, suffix: norm.s,
      rawWindow: raw.size, normWindow: norm.size,
      ssrNorm: an.length, domNorm: bn.length,
      windowSsr: an.slice(norm.p, an.length - norm.s).slice(0, 12),
      windowDom: bn.slice(norm.p, bn.length - norm.s).slice(0, 12)
    };
  `;
  const cmp = (await page.evaluate(
    ([ssrHtml, src]) => new Function("ssrHtml", src as string)(ssrHtml),
    [ssr, BODY] as const,
  )) as Omit<Capture, "slug" | "ssrBytes" | "pageErr">;

  const out: Capture = { slug, ssrBytes: ssr.length, ...cmp, pageErr };

  if (process.argv.includes("--dump") && pageErr.length > 0) {
    fs.mkdirSync(DUMP_DIR, { recursive: true });
    const dom = await page.content();
    fs.writeFileSync(`${DUMP_DIR}/${slug}.ssr.html`, ssr);
    fs.writeFileSync(`${DUMP_DIR}/${slug}.dom.html`, dom);
    fs.writeFileSync(
      `${DUMP_DIR}/${slug}.fire.json`,
      JSON.stringify({ slug, path, skew, ...cmp, pageErr }, null, 2),
    );
    console.log(`    [dumped ${slug}: ssr ${ssr.length}B, dom ${dom.length}B]`);
  }

  await ctx.close();
  return out;
}

async function main() {
  const skew = process.argv.includes("--skew");
  console.log("HO 687 STEP 0 — hydration capture prototype");
  console.log(`  target: ${BASE}`);
  console.log(`  mode:   ${skew ? `SKEW +40d (manufacture a straddle)` : "CLEAN (noise floor)"}\n`);

  const browser = await chromium.launch();
  const rows: Capture[] = [];
  for (const r of ROUTES) {
    const c = await capture(browser, r.slug, r.path, skew);
    if (!c) continue;
    rows.push(c);
    const windowSize = c.normWindow;
    console.log(
      `  ${c.slug.padEnd(22)} ssr=${String(c.ssrCount).padStart(5)} dom=${String(c.domCount).padStart(5)} ` +
        `rawWin=${String(c.rawWindow).padStart(5)}  normWin=${String(c.normWindow).padStart(4)}  ` +
        `lcs(+${c.lcsIns}/-${c.lcsDel})  ` +
        `pageErr=${c.pageErr.length}`,
    );
    if (windowSize > 0) {
      console.log(`      ssr[${c.prefix}..]: ${c.windowSsr.join(" ") || "(none)"}`);
      console.log(`      dom[${c.prefix}..]: ${c.windowDom.join(" ") || "(none)"}`);
    }
    for (const e of c.pageErr) {
      console.log(`      FIRE: ${e.message.slice(0, 110)}`);
      console.log(`      stack: ${e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : "(null)"}`);
    }
  }
  await browser.close();

  const clean = rows.filter((r) => r.normWindow === 0);
  console.log(`\n=== summary (${rows.length} routes captured) ===`);
  console.log(`  routes with a ZERO structural window: ${clean.length}/${rows.length}`);
  console.log(`  routes with any pageErr:              ${rows.filter((r) => r.pageErr.length > 0).length}/${rows.length}`);
  console.log(
    `  norm windows: ${rows.map((r) => `${r.slug}=${r.normWindow}`).join(" ")}`,
  );
  console.log("\n  A zero window on a clean load is the floor the instrument needs.");
  console.log("  A non-zero window on a clean load is CATALOG (legitimate delta), not signal.");
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
