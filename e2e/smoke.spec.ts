import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import zlib from "node:zlib";
import { isKnownNoise } from "./console-noise";
import { ROUTES } from "./routes";

// HO 379 — single smoke crawler. Per route: assert the document returns 200,
// zero failed subrequests (the stylesheet-404 / unstyled-page tell), zero console
// errors, zero uncaught page errors; then screenshot for eyeballing. Plus a
// handful of targeted interactions on the surfaces that actually regress here.
//
// HO 548 — each route is now hit TWICE (cache-miss then cache-hit; see the crawl
// loop). This doubles the crawl to ~52 prod requests. Still gentle, but the
// config's "keep the run gentle" note is now operating at 2× — factor that in
// before adding more routes or dropping the settle.
//
// Runs against the live deploy (playwright.config.ts BASE_URL). Loose assertions
// only — structure/presence, never counts (corpus syncs daily, markets tick).
//
// KNOWN PROD CAVEAT (memory: BotID blocks headless): prod withholds the markets
// tape from headless Chrome, so the B2-hover interaction may find an empty tape.
// That's a measurement artifact of headless-on-prod, not a page bug — flagged,
// not failed, when it happens.

const BASE_URL =
  process.env.BASE_URL ?? "https://congressional-terminal-chi-silk.vercel.app";
const SHOT_DIR = "test-results/smoke";

// ── HO 683: the overflow ALARM ────────────────────────────────────────────────
//
// A prod horizontal-scroll check that rides this crawl at its existing 1280
// viewport for ZERO new requests, and that is deliberately NOT deploy-blocking.
//
// ARMED ONLY ON `schedule` / `workflow_dispatch` (e2e-prod.yml sets the env from
// `github.event_name`). A `deployment_status` run never reads, so a red deploy
// keeps meaning "your change broke it" — this class is DATA-ARMED (HO 682: a
// long committee title arriving overnight blew `/` open with no commit behind
// it), and a defect nobody caused must not red somebody else's deploy. The
// alarm is a GitHub issue instead, which is a phone ping.
//
// 1280 SUFFICES because HO 682 measured the class viewport-independent: the
// blowout fired identically from 430 through 2560. Widening the crawl would buy
// nothing and cost prod requests against the standing 74-request WATCH.
//
// THE EVIDENCE PATH IS `test-results/`, AND THAT IS LOAD-BEARING (HO 683 STEP 0
// row 4). The handoff designated `playwright-report/`; measured, the HTML
// reporter CLEARS that directory at run **END**, so a row written during the run
// is deleted before any workflow step can read it — `hashFiles()` empty, issue
// step skipped, alarm silently unable to fire, and indistinguishable from "prod
// is fine". `test-results/` is the config's `outputDir`, which Playwright cleans
// at run **START** and never at end: a stale file cannot ping AND a row written
// during the run survives. Both properties measured, four paths raced.
// **Keep this in sync with `playwright.config.ts`'s `outputDir` and with
// e2e-prod.yml's `test-results/smoke-overflow-*.md` glob — three places, one
// contract.**
//
// ONE FILE PER ROUTE, never a shared append. `--retries=2` means a failing route
// runs up to three times, and a retry overwriting its OWN file is the whole
// argument — a shared append would stack duplicate rows for one defect. (It also
// sidesteps two CI workers appending concurrently, which is a real question this
// shape never has to answer.)
const OVERFLOW_DIR = "test-results";
const OVERFLOW_PREFIX = "smoke-overflow-";
// Set by the workflow, never by a developer. GATE arms the read; FORCE writes one
// synthetic row so writer → condition → issue can be proven end to end without
// prod actually being broken.
const OVERFLOW_ARMED = !!process.env.SMOKE_OVERFLOW_GATE;
const OVERFLOW_FORCE = !!process.env.SMOKE_OVERFLOW_FORCE;
// Counted per worker, reported in afterAll. The line prints MORE THAN ONCE per
// run and that is expected: under `fullyParallel: true` Playwright batches tests
// across workers and `afterAll` fires per BATCH, not per worker. Measured on the
// first armed prod run (33673524519, 40 routes, 2 CI workers): SIX lines, counts
// 1 · 1 · 2 · 5 · 15 · 16, summing to 40. **Read the sum, not any one line** —
// this comment first said "once per worker, so two lines", which was wrong, and
// a reader who trusted it would have gone looking for four missing lines.
let overflowChecks = 0;

/** The single writer. Forced-red goes through it too — not a special case. */
function writeOverflowRow(
  slug: string,
  scrollWidth: number,
  clientWidth: number,
): void {
  fs.mkdirSync(OVERFLOW_DIR, { recursive: true });
  fs.writeFileSync(
    `${OVERFLOW_DIR}/${OVERFLOW_PREFIX}${slug}.md`,
    `| ${slug} | ${scrollWidth} | ${clientWidth} | ${scrollWidth - clientWidth} |\n`,
  );
}

// The gate cookie (`/` redirects anonymous → /welcome; the landing's "Enter
// terminal" sets this). Only `/` gates — every other route is ungated — but we
// set it context-wide so the home renders the terminal, not the landing.
const GATE_COOKIE = { name: "ct_seen", value: "1", url: BASE_URL };

// ── HO 687: the #418 attribution capture ─────────────────────────────────────
//
// The `:50` arc ruled out six hypotheses and established that the prod message
// can NEVER identify a component: `Minified React error #418 … args[]=HTML` is
// byte-identical for every structural mismatch anywhere in the app. Across 42+
// fires this collector recorded `err.message` and nothing else — no stack, no
// served bytes, no DOM. A hydration mismatch means the served HTML and the
// client render disagreed, and BOTH artifacts are in the crawler's hands at the
// moment of the fire; they were simply discarded. This captures them.
//
// THE DIFF IS AN INSERTION-TOLERANT ALIGNMENT, NOT A PREFIX/SUFFIX WINDOW, and
// that is a measured correction to the HO 687 handoff rather than a preference.
// STEP 0 measured the clean-load floor on all 14 firing-set routes: the catalog
// is exactly TWO legitimate deltas — `next-route-announcer` (one element, end of
// body, every route) and `span.micro-tag` (the markets-tape freshness badges,
// client-only, ~100 per load). The announcer sits at the END, so prefix/suffix
// handles it and non-tape routes floor at a window of 1. The micro-tags sit
// EARLY, so ~100 insertions shift every later index and the prefix/suffix window
// becomes the WHOLE DOCUMENT — 1,429-1,959 elements on the eight tape routes,
// which are the top firers. Alignment collapses that to ~+101/-12. A
// prefix/suffix instrument would have reported "somewhere in these ~1,948
// elements" on precisely the routes it exists to explain.
//
// COST CONTROL, and it doubles as correctness: the LCS runs on the sequence
// AFTER common prefix and suffix are trimmed. Trimming is O(n) and exact — a
// common prefix is aligned by definition — so this is not an approximation, it
// is the same answer computed on the part that can differ. `committees-redirect`
// carries 12,685 elements and trims to a window of 1.
//
// THE GUARD IS VISIBLE, NEVER A SILENT ABSENCE (HO 687 ruling 4): if the trimmed
// window still exceeds the cap, `lcsIns`/`lcsDel` report -1 and `lcsSkipped`
// says so in the dump. A missing number and an unrunnable one must not look
// alike.
const PAGEERR_DIR = "test-results";
const PAGEERR_MARK = /Minified React error #418/;
const LCS_CAP = 4000; // trimmed-window ceiling; beyond it the DP is not worth the memory
const MAX_DUMPS = 12; // per run — past this the class is established, not better evidenced
let dumpsWritten = 0;

// Runs in the PAGE, as a string. It cannot be an ordinary inline callback:
// tsx/esbuild wraps named arrow and function expressions in a `__name(...)`
// helper that does not exist in the browser, so Playwright serializes source
// referencing an undefined symbol and every evaluate throws `ReferenceError:
// __name is not defined`. Measured at HO 687 STEP 0 — the first cut had no inner
// named consts and worked; adding two broke all 14 routes at once. A plain
// string is not transformed, so it is immune. (oddities)
const ALIGN_BODY = `
  var describe = function (el) {
    var cls = (el.getAttribute("class") || "").trim().split(/\\s+/)[0] || "";
    var id = el.getAttribute("id") || "";
    return el.tagName.toLowerCase() + (id ? "#" + id : "") + (cls ? "." + cls : "");
  };
  // Head-only elements are injected by the client runtime and are not the render
  // under test; a single such insertion would otherwise shift every later index.
  var DROP = ["link", "script", "style", "noscript", "meta", "title"];
  var keep = function (d) { return DROP.indexOf(d.split(/[#.]/)[0]) === -1; };
  var doc = new DOMParser().parseFromString(ssrHtml, "text/html");
  var a = Array.prototype.slice.call(doc.querySelectorAll("*")).map(describe).filter(keep);
  var b = Array.prototype.slice.call(document.querySelectorAll("*")).map(describe).filter(keep);
  var p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  var s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  var aw = a.slice(p, a.length - s), bw = b.slice(p, b.length - s);
  var ins = -1, del = -1, skipped = false;
  if (aw.length <= ${LCS_CAP} && bw.length <= ${LCS_CAP}) {
    var m = aw.length, n = bw.length;
    var prev = new Int32Array(n + 1), cur = new Int32Array(n + 1);
    for (var i = 1; i <= m; i++) {
      for (var j = 1; j <= n; j++) {
        cur[j] = aw[i - 1] === bw[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      }
      var t = prev; prev = cur; cur = t; cur.fill(0);
    }
    var lcs = prev[n];
    del = m - lcs; ins = n - lcs;
  } else { skipped = true; }
  // LOCALIZATION BY IDENTITY. The edit COUNTS say how many nodes differ; they do
  // not say which, and "6 of these 1,389 elements" is not an attribution. A
  // multiset difference over the descriptors names them outright — the planted
  // STEP 2.1 defect surfaces as \`span.ho687-plant +1\` — and it costs one pass,
  // no DP table and no O(n^2) backtrack (which at the 4000 cap would need ~64 MB
  // just to walk back through).
  var count = function (arr) {
    var m = {};
    for (var i = 0; i < arr.length; i++) m[arr[i]] = (m[arr[i]] || 0) + 1;
    return m;
  };
  var ca = count(aw), cb = count(bw);
  var added = [], removed = [];
  var k;
  for (k in cb) if ((cb[k] || 0) > (ca[k] || 0)) added.push(k + " +" + (cb[k] - (ca[k] || 0)));
  for (k in ca) if ((ca[k] || 0) > (cb[k] || 0)) removed.push(k + " -" + (ca[k] - (cb[k] || 0)));
  // First positional divergence inside the trimmed window, as a coarse anchor
  // for where in document order the drift starts.
  var firstDiff = -1;
  for (var q = 0; q < Math.min(aw.length, bw.length); q++) {
    if (aw[q] !== bw[q]) { firstDiff = q; break; }
  }
  return {
    ssrCount: a.length, domCount: b.length, prefix: p, suffix: s,
    windowSsrLen: aw.length, windowDomLen: bw.length,
    lcsIns: ins, lcsDel: del, lcsSkipped: skipped,
    addedInDom: added, removedFromSsr: removed,
    firstDivergenceAt: firstDiff,
    contextSsr: firstDiff < 0 ? [] : aw.slice(Math.max(0, firstDiff - 4), firstDiff + 8),
    contextDom: firstDiff < 0 ? [] : bw.slice(Math.max(0, firstDiff - 4), firstDiff + 8)
  };
`;

type Collected = {
  failed: string[]; // requestfailed (network-level), excl. client aborts
  bad: string[]; // any response with status >= 400
  consoleErr: string[];
  pageErr: string[];
  // HO 687 — parallel to `pageErr`, pushed in the SAME handler so indices align
  // 1:1 and the existing mark/slice attribution works on it unchanged. A second
  // array rather than a richer `pageErr` element type is deliberate: `pageErr`
  // feeds the assertions and the log line, and the gate semantics of this crawl
  // are not being touched.
  pageErrStack: (string | null)[];
  // Main-document bodies, one per navigation, in order. The ACTUAL served bytes:
  // a re-fetch would be a different render on these force-dynamic routes and
  // would diff against markup the browser never hydrated.
  docBodies: Promise<string>[];
};

// favicon/manifest 404s are cosmetic and noisy; record them in the run log but
// don't fail the network assertion on them.
function isIgnorableBad(url: string, status: number): boolean {
  return /\/favicon\.ico|\/manifest\.webmanifest|\/apple-touch-icon/.test(url) && status === 404;
}

function attachCollectors(page: Page): Collected {
  const c: Collected = {
    failed: [],
    bad: [],
    consoleErr: [],
    pageErr: [],
    pageErrStack: [],
    docBodies: [],
  };
  page.on("response", (resp) => {
    const req = resp.request();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
      // Buffered here, resolved only if this route actually fires — the body is
      // held either way, but nothing is written on a clean route.
      c.docBodies.push(resp.text().catch(() => ""));
    }
  });
  page.on("requestfailed", (req) => {
    const err = req.failure()?.errorText ?? "unknown";
    // Client-cancelled requests during navigation are not real failures.
    if (err.includes("ERR_ABORTED")) return;
    c.failed.push(`${err} ${req.method()} ${req.url()}`);
  });
  page.on("response", (resp) => {
    const status = resp.status();
    if (status >= 400) c.bad.push(`${status} ${resp.url()}`);
  });
  page.on("console", (msg) => {
    // HO 504: share the HO 472 noise allowlist (MissingSecret + friends) so an
    // unattended prod run doesn't red on known-benign console output.
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (!isKnownNoise(t)) c.consoleErr.push(t);
  });
  page.on("pageerror", (err) => {
    c.pageErr.push(err.message);
    // HO 687 channel A — one property read, never taken in 42+ fires. Minified
    // frames may name nothing on their own (prod serves no sourcemaps: measured
    // at STEP 0, chunk 200 / .map 404 / no sourceMappingURL), but they are
    // evidence, and they cost nothing to keep.
    c.pageErrStack.push(err.stack ?? null);
  });
  return c;
}

// HO 687 — dump the differential for one fire. Called IMMEDIATELY after the hit
// that fired, never at end of test: hit 2's navigation destroys hit 1's DOM, so
// a post-both snapshot can only ever describe hit 2 and would silently
// mis-attribute every hit-1 fire.
async function dumpPageErrFire(
  page: Page,
  c: Collected,
  slug: string,
  path: string,
  hit: 1 | 2,
  from: number,
  attempt: number,
): Promise<string | null> {
  const idx = c.pageErr.findIndex((m, i) => i >= from && PAGEERR_MARK.test(m));
  if (idx < 0) return null;
  if (dumpsWritten >= MAX_DUMPS) {
    // Visible, not silent — a cap that swallows evidence without saying so is
    // the same defect class this instrument exists to remove.
    // eslint-disable-next-line no-console
    console.log(`[${slug}] pageerr-dump SKIPPED (cap ${MAX_DUMPS} reached)`);
    return null;
  }

  const ssr = c.docBodies[hit - 1] ? await c.docBodies[hit - 1]! : "";
  if (!ssr) {
    // eslint-disable-next-line no-console
    console.log(`[${slug}] pageerr-dump hit=${hit}: no served bytes retained — capture void`);
    return null;
  }

  let align: Record<string, unknown> = { error: "align-failed" };
  try {
    align = (await page.evaluate(
      ([ssrHtml, src]) => new Function("ssrHtml", src as string)(ssrHtml),
      [ssr, ALIGN_BODY] as const,
    )) as Record<string, unknown>;
  } catch (e) {
    align = { error: String(e).slice(0, 300) };
  }

  const dom = await page.content().catch(() => "");
  const base = `${PAGEERR_DIR}/pageerr-${slug}-hit${hit}-att${attempt}`;
  fs.mkdirSync(PAGEERR_DIR, { recursive: true });
  // gzipped: the largest firing-set page is /members at 2.41 MB served (STEP 0),
  // so an uncompressed SSR+DOM pair is ~4.8 MB and a bad run could carry ~38 MB.
  fs.writeFileSync(`${base}.ssr.html.gz`, zlib.gzipSync(ssr));
  fs.writeFileSync(`${base}.dom.html.gz`, zlib.gzipSync(dom));
  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify(
      {
        slug,
        path,
        hit,
        attempt,
        at: new Date().toISOString(),
        message: c.pageErr[idx],
        stack: c.pageErrStack[idx] ?? null,
        ssrBytes: ssr.length,
        domBytes: dom.length,
        align,
      },
      null,
      2,
    ),
  );
  dumpsWritten++;
  const a = align as {
    lcsIns?: number; lcsDel?: number; lcsSkipped?: boolean; addedInDom?: string[];
  };
  // HO 574's rule — if a collector stores it, print it. The alignment numbers on
  // the log line are what make a failing unattended run self-diagnosing.
  // eslint-disable-next-line no-console
  console.log(
    `[${slug}] pageerr-dump hit=${hit} att=${attempt} ` +
      `lcs(+${a.lcsIns ?? "?"}/-${a.lcsDel ?? "?"})${a.lcsSkipped ? " GUARD-SKIPPED" : ""}` +
      ` added=[${(a.addedInDom ?? []).slice(0, 6).join(", ") || "none"}] → ${base}.json`,
  );
  return `${base}.json`;
}

test.beforeAll(() => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});

test.describe("route crawl", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of ROUTES) {
    test(`${route.slug} (${route.path})`, async ({ page, context }, testInfo) => {
      await context.addCookies([GATE_COOKIE]);
      // The collectors accumulate across BOTH navigations. To attribute a failure
      // to the right hit, mark each array's length after hit 1 and assert the
      // second hit on the slices past those marks. Helper: split a collector by mark
      // and drop ignorable 4xx (favicon/manifest).
      const c = attachCollectors(page);
      const realBad = (bads: string[]) =>
        bads.filter((b) => {
          const [s, ...rest] = b.split(" ");
          return !isIgnorableBad(rest.join(" "), Number(s));
        });

      const nav = async () => {
        const resp = await page.goto(route.path, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        // Let the load event + late XHR/console settle. The markets tape polls, so
        // networkidle never fires here — a fixed settle is the pragmatic choice.
        await page.waitForLoadState("load").catch(() => {});
        await page.waitForTimeout(2_500);
        return resp?.status() ?? 0;
      };

      // ── HIT 1 — the post-deploy cache-MISS window (unstable_cache builds in-process)
      const status1 = await nav();
      // Screenshot BEFORE assertions so failures still leave an image to eyeball.
      await page.screenshot({ path: `${SHOT_DIR}/${route.slug}.png`, fullPage: true });
      // HO 687 — capture hit 1's differential HERE, while hit 1's DOM still
      // exists. The next nav() replaces it.
      const dump1 = await dumpPageErrFire(
        page, c, route.slug, route.path, 1, 0, testInfo.retry,
      );
      const mark = {
        failed: c.failed.length,
        bad: c.bad.length,
        consoleErr: c.consoleErr.length,
        pageErr: c.pageErr.length,
      };

      // ── HIT 2 — the cache-HIT window (HO 533: a cached unstable_cache value that
      // round-trips wrong — a Map → {} — 500s here while hit 1 200'd). A fresh
      // page.goto, NOT page.reload() — we want the same request shape hit 1 made.
      // CAVEAT: if a route were served from Next's full-route cache, hit 2 wouldn't
      // re-enter the component and this would prove nothing (not prove safety). Every
      // route here reads searchParams / is dynamic, so the component DOES re-run — but
      // a green hit 2 is a "no serialization regression observed," not a stronger claim.
      const status2 = await nav();
      // HO 687 — hit 2's differential. `mark.pageErr` is the attribution boundary
      // the crawl already maintains, so this reuses it rather than inventing a
      // second notion of which hit a fire belongs to.
      const dump2 = await dumpPageErrFire(
        page, c, route.slug, route.path, 2, mark.pageErr, testInfo.retry,
      );

      // ── HO 683 overflow alarm. Joins HERE, after hit 2's settle: `nav()` waits
      // for `load` plus a fixed 2.5s, so this is the last fully-settled state of
      // the route, and reading before the route's own waits would measure a page
      // mid-layout. Unarmed runs do no reads at all.
      if (OVERFLOW_ARMED) {
        overflowChecks++;
        const doc = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        // `over > 1` — the same 1px subpixel tolerance the layout audit's M0 uses,
        // for the same reason and deliberately not tighter.
        if (doc.scrollWidth - doc.clientWidth > 1) {
          writeOverflowRow(route.slug, doc.scrollWidth, doc.clientWidth);
          expect(
            doc.scrollWidth,
            `${route.path} scrolls horizontally on prod ` +
              `(scrollWidth ${doc.scrollWidth} vs clientWidth ${doc.clientWidth})`,
          ).toBeLessThanOrEqual(doc.clientWidth);
        }
      }

      const failed1 = c.failed.slice(0, mark.failed);
      const failed2 = c.failed.slice(mark.failed);
      const bad1 = realBad(c.bad.slice(0, mark.bad));
      const bad2 = realBad(c.bad.slice(mark.bad));
      const console1 = c.consoleErr.slice(0, mark.consoleErr);
      const console2 = c.consoleErr.slice(mark.consoleErr);
      const pageErr1 = c.pageErr.slice(0, mark.pageErr);
      const pageErr2 = c.pageErr.slice(mark.pageErr);

      // One line, both hits — "hit2=500 where hit1=200" is the HO 533 signature and
      // should be readable straight off the CI log without opening a trace.
      // eslint-disable-next-line no-console
      console.log(
        `[${route.slug}] hit1=${status1} failed=${failed1.length} bad=${bad1.length} console=${console1.length} pageErr=${pageErr1.length}` +
          ` | hit2=${status2} failed=${failed2.length} bad=${bad2.length} console=${console2.length} pageErr=${pageErr2.length}`,
      );

      // HO 574: when anything is non-empty, print the actual MESSAGES (whitespace-
      // collapsed + truncated per message) on a second line, so the next occurrence
      // is readable straight off the CI log without downloading the 14-day-retention
      // report artifact — the gap that turned the pageErr #418 finding into an
      // artifact dig. pageErr is the one that matters; console/bad ride along.
      const detail = (label: string, hit: 1 | 2, arr: string[]): string[] =>
        arr.length
          ? [`${label}#${hit}=[${arr.map((m) => m.replace(/\s+/g, " ").slice(0, 200)).join(" ¦ ")}]`]
          : [];
      const msgs = [
        ...detail("pageErr", 1, pageErr1),
        ...detail("pageErr", 2, pageErr2),
        ...detail("console", 1, console1),
        ...detail("console", 2, console2),
        ...detail("bad", 1, bad1),
        ...detail("bad", 2, bad2),
        // HO 687 — the dump path rides the EXISTING message line rather than a
        // second reporting path, so there is one place a reader looks.
        ...[dump1, dump2].filter(Boolean).map((p) => `dump=${p}`),
      ];
      if (msgs.length) {
        // eslint-disable-next-line no-console
        console.log(`[${route.slug}] ${msgs.join("  |  ")}`);
      }

      // HIT 1 — document 200 (redirects resolve to their 200 target); soft on the rest.
      expect(status1, `${route.path} hit-1 document status`).toBe(200);
      expect.soft(failed1, `${route.path} hit-1 failed requests`).toEqual([]);
      expect.soft(bad1, `${route.path} hit-1 4xx/5xx subrequests`).toEqual([]);
      expect.soft(console1, `${route.path} hit-1 console errors`).toEqual([]);
      expect.soft(pageErr1, `${route.path} hit-1 uncaught page errors`).toEqual([]);

      // HIT 2 — the assertion this commit exists for: the cache-hit path must also
      // be 200 (hard), with the same soft posture on the hit-2 slice.
      expect(status2, `${route.path} hit-2 (cache-hit) document status`).toBe(200);
      expect.soft(failed2, `${route.path} hit-2 failed requests`).toEqual([]);
      expect.soft(bad2, `${route.path} hit-2 4xx/5xx subrequests`).toEqual([]);
      expect.soft(console2, `${route.path} hit-2 console errors`).toEqual([]);
      expect.soft(pageErr2, `${route.path} hit-2 uncaught page errors`).toEqual([]);
    });
  }

  // HO 683 — the forced-red leg. An alarm nobody has ever seen fire is not
  // protection, and the part most likely to be silently broken is the plumbing
  // BETWEEN the writer and the phone: the file glob, the step condition, the
  // token permission, the dedupe. This exercises all of it end to end without
  // prod being broken, through the SAME writer as a real finding — a special
  // case here would prove the special case rather than the path.
  //
  // DECLARED ONLY WHEN FORCED, not skipped-when-unforced: a permanently-skipped
  // test in every run's output is a thing readers learn to scroll past, and this
  // one is supposed to be conspicuous on the two runs it exists for.
  if (OVERFLOW_FORCE) {
    test("FORCED-RED — overflow alarm plumbing, writer → file → condition → issue", async () => {
      writeOverflowRow("FORCED-RED", 1, 0);
      expect(
        1,
        "SMOKE_OVERFLOW_FORCE is set — this failure is synthetic and prod is not " +
          "overflowing. It exists to prove the alarm can reach a human.",
      ).toBeLessThanOrEqual(0);
    });
  }

  // Both branches of the arming gate are readable in the run output, so "the
  // alarm did not fire" and "the alarm never looked" are never the same line.
  // Prints once PER WORKER (CI runs 2), so two lines summing to the route count
  // is correct — see OVERFLOW_ARMED above.
  test.afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(
      OVERFLOW_ARMED
        ? `overflow gate: armed, ${overflowChecks} checks`
        : "overflow gate: unarmed, 0 checks",
    );
  });
});

// The deep-link bug the handoff wants confirmed: an anonymous (no-cookie) visit
// to a `?stage=` deep link is bounced to /welcome and the param is dropped.
test.describe("gate / deep-link param drop", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("anonymous /?stage=president redirects to /welcome and drops the param", async ({
    page,
  }) => {
    const resp = await page.goto("/?stage=president", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.screenshot({ path: `${SHOT_DIR}/gate-anon-stage-president.png`, fullPage: true });
    const finalUrl = page.url();
    // eslint-disable-next-line no-console
    console.log(`[gate] status=${resp?.status()} finalUrl=${finalUrl}`);
    expect(finalUrl, "anon deep link should land on /welcome").toContain("/welcome");
    expect(finalUrl, "the stage param should be dropped by the redirect").not.toContain(
      "stage=president",
    );
  });
});

test.describe("targeted interactions", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ context }) => {
    await context.addCookies([GATE_COOKIE]);
  });

  test("expand a bill row → unified expand panel (.bxp) opens", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    // HO 504 (hardening #3): anchor on the V2FeedList toggle contract
    // (role=button + aria-expanded inside .v2f), not the .v2f-row styling class —
    // the row selector has churned twice. The next assertion already relies on
    // aria-expanded flipping to "true", so this is the same contract.
    const firstRow = page.locator('.v2f [role="button"][aria-expanded]').first();
    await expect(firstRow, "home feed should have rows").toBeVisible({ timeout: 20_000 });
    await firstRow.click();
    await expect(
      page.locator(".v2f-group.open .bxp").first(),
      "the unified expand panel should mount",
    ).toBeVisible({ timeout: 15_000 });
    await expect(firstRow).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: `${SHOT_DIR}/x-bill-expand.png`, fullPage: true });
  });

  test("open a race district drawer → .rdm-panel opens and stays within viewport", async ({
    page,
  }) => {
    // HO 504: target /electoral directly. /races 308-redirects here (HO 333); the
    // redirect itself is covered by the route crawl (ROUTES carries /races). A
    // drawer test shouldn't silently ride a 308 to get to the map.
    await page.goto("/electoral", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1_500);
    const cells = page.locator(".us-map-state");
    const found = await cells.count();
    // HO 504: hard assertion, not a skip. .us-map-state cells are static us-atlas
    // topojson geometry (CartogramShell), never DB rows — a zero count means the
    // cartogram failed to render (a real prod regression), not data variability.
    // A skip here would let that regress silently green (the HO 503 false-green
    // class the whole audit exists to close).
    expect(found, "electoral cartogram must render map-state cells").toBeGreaterThan(0);
    const cell = cells.first();
    await cell.click({ force: true });
    const panel = page.locator(".rdm-panel");
    await expect(panel, "race district modal should open").toBeVisible({ timeout: 10_000 });
    // Confinement check (the recurring clip bug): panel box within the viewport.
    const vp = page.viewportSize();
    const box = await panel.boundingBox();
    await page.screenshot({ path: `${SHOT_DIR}/x-race-drawer.png`, fullPage: true });
    expect(box, "panel should have a box").not.toBeNull();
    if (box && vp) {
      expect.soft(box.x, "panel not clipped left").toBeGreaterThanOrEqual(-1);
      expect.soft(box.y, "panel not clipped top").toBeGreaterThanOrEqual(-1);
      expect.soft(box.x + box.width, "panel not clipped right").toBeLessThanOrEqual(vp.width + 1);
    }
  });

  test("/races 308-redirects to /electoral (not somewhere wrong)", async ({ page }) => {
    // HO 570 C6: the route crawl asserts 200 only AFTER page.goto has followed the
    // 308, so it catches /races breaking outright but not /races redirecting to the
    // wrong place. Pin the landing explicitly — HO 333 collapsed /races (+ /primaries)
    // into /electoral.
    const resp = await page.goto("/races", { waitUntil: "domcontentloaded", timeout: 45_000 });
    expect(page.url(), "/races should land on /electoral").toContain("/electoral");
    expect(resp?.status(), "and resolve 200 at the target").toBe(200);
  });

  // @nonci — excluded from the unattended prod run (e2e-prod.yml --grep-invert
  // "@nonci"). Bucket D: prod withholds the markets tape from headless Chrome
  // under BotID, so there's nothing to hover. The skip guard below stays honest
  // for the manual/local run; the tag keeps it out of the scheduled crawl.
  test("B2 markets hover → hover card appears (flagged if tape empty on headless prod) @nonci", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2_500);
    const items = page.locator(".markets-tape-item");
    const n = await items.count();
    if (n === 0) {
      test.info().annotations.push({
        type: "flag",
        description:
          "markets tape rendered 0 items — consistent with prod BotID withholding the tape from headless Chrome (memory). Not a page bug; re-verify the hover via local CDP.",
      });
      test.skip(true, "tape empty (BotID withholds on headless prod)");
      return;
    }
    await items.first().hover();
    await expect(
      page.locator(".markets-tape-detail--portal, .markets-tape-detail").first(),
      "hover-detail popover should appear",
    ).toBeVisible({ timeout: 8_000 });
    await page.screenshot({ path: `${SHOT_DIR}/x-markets-hover.png`, fullPage: true });
  });

  test("click the PRESIDENT stage row → filters to a clean empty state, not an error", async ({
    page,
  }) => {
    const c = attachCollectors(page);
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const presRow = page.locator("a.stage-funnel-row", { hasText: "PRESIDENT" }).first();
    await expect(presRow, "PRESIDENT funnel row should be present and clickable").toBeVisible({
      timeout: 20_000,
    });
    await presRow.click();
    // HO 570 C6: predicate-wait on the rebase instead of a fixed 1.5s (which
    // --retries=2 would mask on the unattended run). Same pattern both specs use.
    await page.waitForURL(/[?&]stage=president/, { timeout: 8_000 }).catch(() => {});
    await page.screenshot({ path: `${SHOT_DIR}/x-stage-president-click.png`, fullPage: true });
    const finalUrl = page.url();
    // eslint-disable-next-line no-console
    console.log(
      `[stage-click] url=${finalUrl} console=${c.consoleErr.length} pageErr=${c.pageErr.length}`,
    );
    expect(finalUrl, "clicking PRESIDENT should write ?stage=president").toContain(
      "stage=president",
    );
    // The point of the check: it must NOT throw — a clean empty state is fine.
    expect.soft(c.pageErr, "no uncaught error on the empty PRESIDENT filter").toEqual([]);
  });
});
