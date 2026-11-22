import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import zlib from "node:zlib";
import { isKnownNoise } from "./console-noise";
import { ROUTES } from "./routes";
import { RACE_RATING_PAGES_2026, RACE_RATING_SOURCES } from "../lib/enums";
import { CAPITOLSTOCKWATCH_URL, CC_BY_4_URL, LDA_HOME_URL, PRIMARY_CALENDAR_URL, senateRollCallUrl } from "../lib/source-links";
import { parseBillRef } from "../lib/bill-ref";
import { congressTermDates, getCurrentCongress } from "../lib/congress";

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

// ── HO 702 Arm A: the mutation log ───────────────────────────────────────────
//
// HO 700 measured both obvious narrowings of the HO 687 superset dead and left
// one fact standing: on the tapeless tagged-tree routes the recovery render
// produced the SERVER's structure, so the node React refused to match existed
// only in the first client render and never touched the DOM. No snapshot at any
// offset can show it. What nobody had looked at is the records BEFORE the fire —
// a DOM changed *under* hydration.
//
// WHY THIS IS FILTERED AND NOT CAPPED, which is the whole design (HO 702 STEP 0
// row 4, and the architect's own estimate was wrong here). An observer on
// `document` installed before any page script records the HTML PARSER building
// the server's bytes: measured 3,675 / 11,072 / 22,823 records on / /changes
// /members, of which 99.4-99.98% are parser output, and the parsing-phase
// element counts match the served opening-tag counts almost exactly (/changes
// 6,498 vs ~6,490; /members 12,659 vs ~12,649). That is the proof of what they
// are. A cap cannot help: single observer callbacks delivered up to 8,542
// records, so a cap truncates mid-batch, and DCL (280-758ms) overlaps `fire-t`
// (190-1215ms), so "records before the fire" would mean "the parser".
//
// THE RULE. While `document.readyState === "loading"` the parser only ever
// APPENDS to the currently-open element and never removes. So a childList
// record with `nextSibling !== null` OR `removedNodes.length > 0` is not the
// parser and is KEPT; a pure trailing append is DROPPED AND COUNTED.
// `characterData` during loading is KEPT and counted as its own kind (the
// parser extends a text node straddling a chunk boundary — rare, and rare is a
// number, not a word: measured 0 on all five routes). After DOMContentLoaded
// NOTHING is filtered; post-DCL volume is 4-94 records.
//
// AN INSTRUMENT THAT DISCARDS MUST SAY HOW MUCH. Every reading carries
// `parser-dropped`; a reading without it is not a reading. The buffer is capped
// with a separate overflow counter and never silently truncated.
//
// MEASURED BEFORE IT WAS BUILT (HO 702). Filtered `pre` on quiet hits of
// / /changes /members /trends /races: 0, 0, 0, 0, 0 against raw 6,543 / 11,054
// / 22,801 / 891 / 822. A filter that keeps nothing is indistinguishable from a
// filter that eats everything, so the planted-move control ran in the tagged
// worktree: an inline body script that, while `readyState === "loading"`,
// inserts a text node and an element BEFORE an existing sibling and removes the
// text node. Filtered `pre` then read exactly those three records, correct
// kinds and targets, on every route, with all 898 / 827 / 22,806 parser records
// in `parser-dropped`. The zero is a real zero.
const MUT_CAP = 2_000;
const MUT_INIT = `
(() => {
  const w = window;
  const path = (n) => {
    if (!n) return "(null)";
    if (n.nodeType === 3) return "#text";
    if (n.nodeType === 8) return "#comment";
    const t = (n.tagName || "?").toLowerCase();
    const i = n.id ? "#" + n.id : "";
    const c = n.classList && n.classList.length ? "." + n.classList[0] : "";
    return t + i + c;
  };
  const snip = (n) => {
    try {
      if (n.nodeType === 1) return String(n.outerHTML || "").slice(0, 80);
      return String(n.data || "").slice(0, 80);
    } catch (e) { return "(unreadable)"; }
  };
  w.__mut = {
    recs: [], dropped: 0, cdLoading: 0, post: 0, overflow: 0,
    fireT: null, boundaryT: null, firstPostT: null, batch: 0, install: performance.now(),
    landmarks: {}, lastFlightT: null, flightCount: 0, hydStartT: null,
  };
  // HO 702 — HYDRATION START, the comparator that decided this HO. The question
  // is whether the app chunk began executing while the parser was still writing
  // the flight tail; first-post-t is a COMMIT, not a start, and cannot answer
  // it. self.webpackChunk_N_E is assigned by the first app chunk to evaluate,
  // so trapping its setter stamps the start exactly once. Measured 2026-09-08:
  // 10 of 10 fires had hyd-start BEFORE last-flight, and 47 hits with the
  // reverse order across two modes produced zero fires.
  try {
    let _wp;
    Object.defineProperty(w, "webpackChunk_N_E", {
      configurable: true,
      get() { return _wp; },
      set(v) { if (w.__mut.hydStartT === null) w.__mut.hydStartT = performance.now(); _wp = v; },
    });
  } catch (e) {}
  // HO 702 T3 — the parser insertion/extension time of the LAST
  // self.__next_f.push flight-data script. The §1 hypothesis is that
  // InnerLayoutRouter's use(rsc) (layout-router.js:276) suspends because the
  // segment's RSC is still a pending thenable while these chunks are in the
  // parser's tail. So the discriminating quantity is whether the tail was still
  // arriving when hydration ran: on a fire, last-flight should be AFTER
  // fire-t; on a quiet hit, BEFORE first-post-t.
  const flight = (nd, t) => {
    try {
      if (nd.nodeType === 1 && nd.tagName === "SCRIPT" && String(nd.textContent || "").indexOf("self.__next_f.push") === 0) {
        w.__mut.lastFlightT = t; w.__mut.flightCount++;
      } else if (nd.nodeType === 3 && String(nd.data || "").indexOf("self.__next_f.push") === 0) {
        w.__mut.lastFlightT = t; w.__mut.flightCount++;
      }
    } catch (e) {}
  };
  // HO 702 — LANDMARK TIMELINE. The filter drops parser appends by design, so
  // their timestamps are gone with them; but "was the header subtree still
  // being parsed when hydration reached it?" is answerable only from those
  // timestamps. So before dropping, stamp the FIRST insertion time of a short
  // list of named nodes. Cheap (a tag/class test per added element), and it
  // makes the drop lossy in count only, never in the one dimension being asked.
  const LANDMARKS = ["header", ".header-titlebar", ".header-sync-sub", ".header-nav-row", ".masthead-clock", "div.flex"];
  const landmark = (nd, t) => {
    if (!nd || nd.nodeType !== 1) return;
    for (const k of LANDMARKS) {
      if (k in w.__mut.landmarks) continue;
      const hit = k[0] === "." ? (nd.classList && nd.classList.contains(k.slice(1)))
        : k.indexOf(".") > 0 ? (nd.tagName.toLowerCase() === k.split(".")[0] && nd.classList.contains(k.split(".")[1]))
        : nd.tagName.toLowerCase() === k;
      if (hit) w.__mut.landmarks[k] = t;
    }
  };
  // HO 700's fire-time stamp, kept: the partition is meaningless without it.
  addEventListener("error", (e) => {
    const m = (e && e.message) || "";
    if (w.__mut.fireT === null && /418/.test(m)) w.__mut.fireT = performance.now();
  }, true);
  document.addEventListener("DOMContentLoaded", () => {
    w.__mut.boundaryT = performance.now();
  });
  const push = (r) => {
    if (w.__mut.recs.length >= ${MUT_CAP}) { w.__mut.overflow++; return; }
    w.__mut.recs.push(r);
  };
  const o = new MutationObserver((recs) => {
    const t = performance.now();
    const b = ++w.__mut.batch;
    for (const r of recs) {
      const loading = document.readyState === "loading";
      // HO 702 mid-flight — the first React-attributable mutation after DCL.
      // Paired with fire-t it gives two distributions that can be put beside
      // each other: (fire-t - dcl) on fires against (first-post-t - dcl) on
      // quiet hits of the same route. Timing only; no hypothesis is written
      // down until the numbers are.
      if (!loading && w.__mut.firstPostT === null) w.__mut.firstPostT = t;
      if (r.type === "characterData") {
        flight(r.target, t);
        if (loading) w.__mut.cdLoading++; else w.__mut.post++;
        push({ t, b, loading, kind: "text", target: path(r.target), snip: snip(r.target) });
        continue;
      }
      const parserAppend = loading && r.nextSibling === null && r.removedNodes.length === 0;
      if (parserAppend) {
        for (const nd of r.addedNodes) { landmark(nd, t); flight(nd, t); }
        w.__mut.dropped += r.addedNodes.length;
        continue;
      }
      const n = r.addedNodes.length + r.removedNodes.length;
      for (const nd of r.addedNodes) { landmark(nd, t); flight(nd, t); }
      if (!loading) w.__mut.post += n;
      push({
        t, b, loading,
        kind: r.removedNodes.length ? (r.addedNodes.length ? "replace" : "remove") : "insert",
        target: path(r.target),
        next: path(r.nextSibling),
        add: [...r.addedNodes].map((x) => ({ nt: x.nodeType, p: path(x), s: snip(x) })).slice(0, 6),
        rem: [...r.removedNodes].map((x) => ({ nt: x.nodeType, p: path(x), s: snip(x) })).slice(0, 6),
      });
    }
  });
  o.observe(document, { childList: true, subtree: true, characterData: true });
})();
`;

type MutRec = {
  t: number; b: number; loading: boolean; kind: string; target: string;
  next?: string; snip?: string;
  add?: Array<{ nt: number; p: string; s: string }>;
  rem?: Array<{ nt: number; p: string; s: string }>;
};
type MutBuf = {
  recs: MutRec[]; dropped: number; cdLoading: number; post: number;
  overflow: number; fireT: number | null; boundaryT: number | null;
  firstPostT: number | null; batch: number; install: number;
  landmarks: Record<string, number>; lastFlightT: number | null; flightCount: number;
  hydStartT: number | null;
};
type MutRead = {
  pre: MutRec[]; recovery: MutRec[]; post: MutRec[];
  dropped: number; cdLoading: number; overflow: number;
  fireT: number | null; boundaryT: number | null; firstPostT: number | null;
  postCount: number; landmarks: Record<string, number>;
  lastFlightT: number | null; flightCount: number; hydStartT: number | null;
  line: string;
};

// Partition the buffer by `fire-t`. `recovery` is the FIRST OBSERVER BATCH at or
// after the fire — one task, not a time offset. HO 700 measured that a fixed
// offset samples the wrong side of the recovery commit depending on the route
// (one frame landed after it on committee-detail and before it on dashboard-v2),
// which is why the boundary here is the batch index and never a number of ms.
function partitionMut(m: MutBuf | null): MutRead | null {
  if (!m) return null;
  const kinds = (rs: MutRec[]) => {
    const k: Record<string, number> = {};
    for (const r of rs) k[r.kind] = (k[r.kind] ?? 0) + 1;
    const s = Object.entries(k).map(([a, b]) => `${a}:${b}`).join(",");
    return s || "-";
  };
  const base = {
    dropped: m.dropped, cdLoading: m.cdLoading, overflow: m.overflow,
    fireT: m.fireT, boundaryT: m.boundaryT, firstPostT: m.firstPostT,
    postCount: m.post, landmarks: m.landmarks,
    lastFlightT: m.lastFlightT, flightCount: m.flightCount, hydStartT: m.hydStartT,
  };
  const dcl = m.boundaryT;
  const rel = (x: number | null) =>
    x === null ? "n/a" : dcl === null ? `${Math.round(x)}ms` : `${x - dcl >= 0 ? "+" : ""}${Math.round(x - dcl)}ms`;
  // The landmark timeline, printed like every other timing so "was the header
  // subtree still parsing when hydration reached it?" is a comparison a reader
  // makes on one line instead of by opening a dump.
  // NECESSARY, NOT SUFFICIENT: every fire measured carried HYD-BEFORE-TAIL, and
  // no hit with the reverse order has ever fired — but many quiet hits carry it
  // too. It marks the window open, it does not predict the fire.
  const hydOrder =
    m.hydStartT === null || m.lastFlightT === null
      ? "hyd=n/a"
      : m.hydStartT < m.lastFlightT
        ? "HYD-BEFORE-TAIL"
        : "hyd-after-tail";
  const lmLine = Object.entries(m.landmarks)
    .sort((x, y) => x[1] - y[1])
    .map(([k, v]) => `${k}=${Math.round(v)}(${rel(v)})`)
    .join(" ") || "-";
  if (m.fireT === null) {
    // No fire: the partition has no boundary and says so rather than pretending
    // everything is `pre`. The channel is still proven live by `post`.
    return {
      ...base, pre: [], recovery: [], post: m.recs,
      line: `mut kept=${m.recs.length}(${kinds(m.recs)}) loading=${m.recs.filter((r) => r.loading).length} parser-dropped=${m.dropped}` +
            `${m.cdLoading ? ` cd-loading=${m.cdLoading}` : ""} post=${m.post}` +
            ` lm[${lmLine}]` +
            ` hyd-start=${rel(m.hydStartT)} last-flight=${rel(m.lastFlightT)}/${m.flightCount} ${hydOrder}` +
            `${m.overflow ? ` OVERFLOW=${m.overflow}` : ""}`,
    };
  }
  const pre = m.recs.filter((r) => r.t < m.fireT!);
  const after = m.recs.filter((r) => r.t >= m.fireT!);
  const recB = after.length ? after[0]!.b : -1;
  const recovery = after.filter((r) => r.b === recB);
  const post = after.filter((r) => r.b !== recB);
  const a = recovery.reduce((n, r) => n + (r.add?.length ?? 0), 0);
  const d = recovery.reduce((n, r) => n + (r.rem?.length ?? 0), 0);
  return {
    ...base, pre, recovery, post,
    line: `mut pre=${pre.length}(${kinds(pre)}) loading=${m.recs.filter((r) => r.loading).length} parser-dropped=${m.dropped}` +
          `${m.cdLoading ? ` cd-loading=${m.cdLoading}` : ""}` +
          ` rec=+${a}/-${d} post=${post.length} fire-t=${Math.round(m.fireT!)}ms(${rel(m.fireT)})` +
          ` first-post-t=${rel(m.firstPostT)}` +
          ` dcl=${m.boundaryT === null ? "n/a" : Math.round(m.boundaryT) + "ms"}` +
          ` lm[${lmLine}]` +
          ` hyd-start=${rel(m.hydStartT)} last-flight=${rel(m.lastFlightT)}/${m.flightCount} ${hydOrder}` +
          `${m.overflow ? ` OVERFLOW=${m.overflow}` : ""}`,
  };
}

async function readMut(page: Page): Promise<MutRead | null> {
  const m = await page
    .evaluate(() => (window as unknown as { __mut?: MutBuf }).__mut ?? null)
    .catch(() => null);
  return partitionMut(m);
}

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
  // HO 702 Arm A — read the mutation log for THIS hit, partitioned at `fire-t`.
  // Read here, beside the DOM, for the same reason the DOM is: hit 2 destroys
  // hit 1's buffer along with its document.
  const mut = await readMut(page);
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
        // HO 702 Arm A. `pre` is the one nobody had looked at; `parserDropped`
        // is what makes `pre` readable at all, and a `pre` reported without it
        // is not a reading.
        mut: mut
          ? {
              line: mut.line,
              parserDropped: mut.dropped,
              cdLoading: mut.cdLoading,
              overflow: mut.overflow,
              fireT: mut.fireT,
              boundaryT: mut.boundaryT,
              pre: mut.pre,
              recovery: mut.recovery,
              post: mut.post.slice(0, 200),
              postTotal: mut.post.length,
            }
          : null,
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
      // HO 702 Arm A — installed BEFORE the cookie so the observer is running
      // from the first script tick of every navigation in this context.
      await context.addInitScript(MUT_INIT);
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
      // HO 702 Arm A — read hit 1's buffer HERE for the same reason the dump is
      // taken here: the next nav() replaces the document and the buffer with it.
      // Read on EVERY hit, quiet ones included: a `mut` field that only appears
      // on fires cannot distinguish "no mutations" from "channel not installed".
      const mut1 = await readMut(page);
      // ── HO 714 — `/` IS NEVER SILENT. Read on hit 1 and only on `home`,
      // because the next nav() replaces this DOM and because `/` is the only
      // route the Absence Watch band renders on. `.abw-card` is the rack,
      // `.abw--empty` the good-news line; one or the other is always present on
      // a healthy dashboard, and `.abw--failed` is reachable ONLY from the HO
      // 598 guard's `window: null`, which no successful read can produce.
      //
      // WHAT THIS READS IF THE WORK WAS NEVER DONE: before HO 714 an empty band
      // rendered `null`, so `.abw-card` would be 0, `.abw--empty` would not
      // exist as a class, and the first assertion would go red — which is the
      // point. It is not a check that passes on absence. The stage-filtered
      // `home-stage-*` variants render the same band (the band takes no
      // filters), but the assertion is scoped to `home` so there is one place
      // this is stated and one test that fails when it breaks.
      const band =
        route.slug === "home"
          ? {
              present: await page.locator(".abw-card, .abw--empty").count(),
              failed: await page.locator(".abw--failed").count(),
            }
          : null;
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

      // ── HO 818 — EVERY MASTHEAD PATH NAMES ITS SECTION. Read after hit 2's
      // settle, on the page as served. `lib/breadcrumb.ts` maps a page's basePath
      // to its section, and a path it doesn't know falls through to `[]`, so the
      // masthead read `CT:\119TH>` alone, and the folded strip's label with it
      // (`/amendments` and `/nominations` on Corey's Fold, Nov 15). The congress
      // and a section are two labels. A page with no `.breadcrumb-path`
      // (`/welcome`) isn't read.
      const crumbs = await page.evaluate(() => {
        const path = document.querySelector(".breadcrumb-path");
        return path
          ? Array.from(path.querySelectorAll(".breadcrumb-seg-label")).map((el) => (el.textContent ?? "").trim())
          : null;
      });

      const mut2 = await readMut(page);
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
          ` ${mut1?.line ?? "mut=UNINSTALLED"}` +
          (band ? ` band=${band.present}/failed=${band.failed}` : "") +
          ` | hit2=${status2} failed=${failed2.length} bad=${bad2.length} console=${console2.length} pageErr=${pageErr2.length}` +
          ` ${mut2?.line ?? "mut=UNINSTALLED"}`,
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

      // HO 714 — HARD, not soft, and on hit 1. A failed Absence Watch read on
      // production `/` is an incident, not a flake to tolerate: the guard hides
      // it from the request (correctly — the rest of the dashboard should still
      // serve) and this is the only thing that says it happened.
      if (band) {
        // `.abw--failed` FIRST, deliberately: a failed read makes both of these
        // red (a failed band renders no card and no empty line), and the first
        // to fire is the one whose message the reader sees. "The read failed" is
        // the diagnosis; "rendered nothing" is the symptom.
        expect(
          band.failed,
          `${route.path} hit-1 Absence Watch read FAILED ` +
            `(.abw--failed served) — see the [absence-watch] read failed log line`,
        ).toBe(0);
        expect(
          band.present,
          `${route.path} hit-1 Absence Watch rendered nothing ` +
            `(no .abw-card and no .abw--empty)`,
        ).toBeGreaterThanOrEqual(1);
      }

      // HIT 2 — the assertion this commit exists for: the cache-hit path must also
      // be 200 (hard), with the same soft posture on the hit-2 slice.
      expect(status2, `${route.path} hit-2 (cache-hit) document status`).toBe(200);
      expect.soft(failed2, `${route.path} hit-2 failed requests`).toEqual([]);
      expect.soft(bad2, `${route.path} hit-2 4xx/5xx subrequests`).toEqual([]);
      expect.soft(console2, `${route.path} hit-2 console errors`).toEqual([]);
      expect.soft(pageErr2, `${route.path} hit-2 uncaught page errors`).toEqual([]);

      // HO 818 — the masthead path names a section (the read above).
      if (crumbs) {
        expect
          .soft(
            crumbs.length,
            `${route.path} masthead path reads [${crumbs.join(" \\ ")}]: no section, so ` +
              `lib/breadcrumb.ts has no branch for this page's basePath`,
          )
          .toBeGreaterThanOrEqual(2);
      }
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

// ── HO 822: wait for React before clicking a server-rendered control ─────────
//
// WHY: a feed row is a server-rendered `div role="button"`, and the feed tabs are
// server-rendered `<button>`s, so their clicks are React's to handle. Before
// `hydrateRoot` runs nothing listens. After it, Next's React meets a click on a
// dehydrated root by trying one synchronous hydration; if the root is still
// blocked, it stops the event and never replays it
// (next/dist/compiled/react-dom/cjs/react-dom-client.production.js:17693-17740,
// 19.3.0-canary). A test that clicks right after DOMContentLoaded races that, and
// e2e-prod 44164447529's `.bxp` test lost two attempts to it (the likely cause;
// the run kept no trace). So these tests poll the element they're about to click
// until it carries a key starting `__reactProps$`, for up to 10 s, and then click.
// React writes that key on an element when it hydrates it, and reads the
// element's handlers from it when an event comes. No key in 10 s is a real red,
// not a flake.
//
// THE KEY IS REACT-INTERNAL. It has read `__reactProps$` since React 17 (16
// called it `__reactEventHandlers$`). If an upgrade renames it, the wait fails
// loudly at 10 s, so it can't pass silently.
//
// THE READING, one line a test: `[hydrate] <test>: <ms> after DCL`, the
// performance.now() at which the key was first seen, less the navigation entry's
// domContentLoadedEventEnd. That's the window in which a visitor's click on `/`
// does nothing, read on prod every run. "At the first look" means the key was
// already there when the poll began, so the figure is an upper bound.
async function waitForHydration(page: Page, selector: string, index: number, what: string, name: string) {
  const look = (arg: { selector: string; index: number }) => {
    const el = document.querySelectorAll(arg.selector)[arg.index];
    return el && Object.keys(el).some((k) => k.startsWith("__reactProps$")) ? performance.now() : 0;
  };
  const arg = { selector, index };
  const first = await page.evaluate(look, arg);
  const seen =
    first ||
    (await page
      .waitForFunction(look, arg, { timeout: 10_000 })
      .then((h) => h.jsonValue())
      .catch(() => 0));
  const dcl = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav?.domContentLoadedEventEnd ?? 0;
  });
  // eslint-disable-next-line no-console
  console.log(
    seen
      ? `[hydrate] ${name}: ${Math.round(seen - dcl)}ms after DCL${first ? " (at the first look)" : ""}${dcl ? "" : " (DCL unread)"}`
      : `[hydrate] ${name}: not hydrated in 10 s`,
  );
  expect(seen, `${what} never hydrated in 10 s`).toBeGreaterThan(0);
}

test.describe("targeted interactions", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(MUT_INIT);
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
    // HO 822: React first, or the click can be dropped (waitForHydration says why).
    await waitForHydration(page, '.v2f [role="button"][aria-expanded]', 0, "the row", ".bxp row");
    await firstRow.click();
    await expect(
      page.locator(".v2f-group.open .bxp").first(),
      "the unified expand panel should mount",
    ).toBeVisible({ timeout: 15_000 });
    await expect(firstRow).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: `${SHOT_DIR}/x-bill-expand.png`, fullPage: true });
  });

  test("feed tabs: New / Movers / Top Stalls; opens on New, or Movers when New is empty; ?stage= opens on Movers", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const tabs = page.locator('.breaking-stalls-tabs [role="tab"]');
    await expect(tabs).toHaveCount(3, { timeout: 20_000 });
    // HO 822: React first, for the Top Stalls click below, or it can be dropped
    // (waitForHydration says why). It waits here, as soon as the tabs are drawn,
    // so its reading is as close to hydration as the poll can get.
    await waitForHydration(page, '.breaking-stalls-tabs [role="tab"]', 2, "the Top Stalls tab", "feed tabs");
    await expect(tabs.nth(0)).toContainText("New This Week");
    await expect(tabs.nth(1)).toContainText("Movers");
    await expect(tabs.nth(2)).toContainText("Top Stalls");
    const newIsEmpty = /\(0\)/.test((await tabs.nth(0).textContent()) ?? "");
    await expect(tabs.nth(newIsEmpty ? 1 : 0)).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".breaking-stalls-tabs .feed-chamber")).toHaveCount(0);
    await expect(page.locator(".feed-chamber-row .feed-chamber-opt")).toHaveCount(3);

    // HO 807: TOP STALLS' badge counts the stale set (it read the constant 5 over a
    // 60-row tab). Open the tab: the badge is at least the rows the panel renders,
    // and equals them when the set is under the tab's 60-row ceiling.
    const stallsTab = tabs.nth(2);
    const badgeText = (await stallsTab.locator(".count").textContent()) ?? "";
    const badge = Number(badgeText.replace(/[^0-9]/g, ""));
    await stallsTab.click();
    await expect(stallsTab).toHaveAttribute("aria-current", "page");
    const stallRows = page.locator(".breaking-stalls-tabs").locator("xpath=..").locator(".v2f-row");
    if (badge > 0) await expect(stallRows.first()).toBeVisible({ timeout: 15_000 });
    const rowCount = await stallRows.count();
    expect(badge, `Top Stalls badge ${badgeText} against ${rowCount} rows`).toBeGreaterThanOrEqual(rowCount);
    if (rowCount < 60) {
      expect(badge, `Top Stalls badge ${badgeText} should equal its ${rowCount} rows under the ceiling`).toBe(rowCount);
    }

    await page.goto("/?stage=floor", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await expect(tabs.nth(1)).toHaveAttribute("aria-current", "page", { timeout: 20_000 });
  });

  // HO 823: the stall count is bills only, the four types that can become law.
  // The floor group is where adopted simple and concurrent resolutions sat as
  // finished business (33 of /stale?stage=floor's 50 rows on prod at 66bd819).
  // A /stale row is an expandable div role=button with no /bill/ link, so its id
  // is its rail: the type and the number. Every row must read a law-eligible
  // type, which also fails a rail that reads empty. No rows fails too: the floor
  // group isn't empty, so zero rows is a broken read, not a pass.
  test("/stale counts bills only (HO 823)", async ({ page }) => {
    await page.goto("/stale?stage=floor", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const rows = page.locator("li.feed-row");
    await expect(rows.first(), "/stale?stage=floor should have rows").toBeVisible({ timeout: 20_000 });
    const ids = await rows.evaluateAll((els) =>
      els.map((li) => {
        const type = (li.querySelector(".bill-rail .rail-type")?.textContent ?? "").trim().toLowerCase();
        const num = (li.querySelector(".bill-rail .rail-number")?.textContent ?? "").trim();
        return `${type}-${num}`;
      }),
    );
    const notBills = ids.filter((id) => !/^(hr|s|hjres|sjres)-\d+$/.test(id));
    const resolutions = ids.filter((id) => /^(hres|sres|hconres|sconres)-/.test(id));
    // eslint-disable-next-line no-console
    console.log(`[stale-bills-only] rows=${ids.length} resolutions=${resolutions.length} not-bills=${notBills.length}`);
    expect(ids.length, "/stale?stage=floor rows read").toBeGreaterThan(0);
    expect(
      notBills,
      `/stale?stage=floor holds ${notBills.length} of ${ids.length} rows that aren't bills: ${notBills.join(" ")}`,
    ).toEqual([]);
  });

  // HO 828: /stale's footer counts the stalled committee bills its link opens,
  // under the page's own filters. Before, it counted the whole committee backlog
  // (`stage = 'committee'`, every filter ignored), so it read the same with the
  // chamber toggle on or off. The two chambers split the bill types between
  // them, so their counts sum to the unfiltered one on any corpus read at one
  // moment. A footer that isn't drawn reads 0, so a day with no stalled
  // committee bill reads 0, 0, 0 and the sum still holds. The footer is found by
  // its words, old or new, so the old one is read too.
  //
  // HO 829: a count the page caught and dropped isn't a 0. It leaves a hidden,
  // empty marker where the footer would be, `[data-stale-count="failed"]`, and
  // each page read here must not carry it. The check is soft: a count that
  // throws at once reds on each of the three pages (planted: 47.9 s of the 60 s
  // budget, each check waiting out the 15 s expect timeout). One that stalls
  // into the store's 10 s abort and retry holds each page about 20 s first, so
  // the test timeout can end the test on the second page: one red and a
  // timeout, still a failure.
  test("/stale's footer counts what its link opens (HO 828)", async ({ page }) => {
    const footer = page.locator("main a").filter({ hasText: /\d more \w+ in committee/ });
    const failedCount = page.locator('[data-stale-count="failed"]');
    const readFooter = async (path: string): Promise<number> => {
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45_000 });
      // The page awaits its reads before it renders, so the filter row and the
      // footer arrive together.
      await expect(page.locator("section.filter-chips"), `${path} should render`).toBeVisible({ timeout: 20_000 });
      await expect
        .soft(
          failedCount,
          `${path}: the footer's count failed and the page dropped it (a [data-stale-count="failed"] marker is in the DOM); the server log's [stale] line has the error`,
        )
        .toHaveCount(0);
      if ((await footer.count()) === 0) return 0;
      const text = (await footer.first().textContent()) ?? "";
      const digits = text.match(/([\d,]+)\s+more\b/)?.[1];
      expect(digits, `${path}'s footer should open with a number: "${text}"`).toBeDefined();
      return Number((digits ?? "").replace(/,/g, ""));
    };

    const all = await readFooter("/stale");
    const allHref = all > 0 ? await footer.first().getAttribute("href") : null;
    const allText = all > 0 ? ((await footer.first().textContent()) ?? "") : "";
    const house = await readFooter("/stale?chamber=house");
    const senate = await readFooter("/stale?chamber=senate");
    // eslint-disable-next-line no-console
    console.log(`[stale-footer] all=${all} house=${house} senate=${senate} href=${allHref ?? "none"}`);

    // 1. The chambers sum to the unfiltered count, within max(25, 2% of it)
    // (HO 828's review ruling). The three pages read three cache entries, each
    // kept an hour and then served stale once while it refreshes, and the 60-day
    // cutoff, date('now', '-60 days'), moves at 00:00 UTC. So a crawl after the
    // move can read one count cached before it and two after, a day's bills
    // apart on a correct page, until the entries refresh or the crons' flush of
    // `bills` drops them. The tolerance still has teeth: the old count missed by
    // the whole backlog (house + senate 36,558 against 18,279), and it misses
    // whenever the backlog passes 25. A count the page caught and dropped draws
    // no footer, so it reads 0 here too, and a drop on one or two of the three
    // pages reds the sum. Dropped on all three it reads 0, 0, 0 and the sum
    // holds, so the sum alone can't see a count that always fails: the marker
    // check in readFooter is what reds it (HO 829).
    const tolerance = Math.max(25, 0.02 * all);
    expect(
      Math.abs(house + senate - all),
      `/stale's footer: house ${house} + senate ${senate} should be within ${tolerance.toFixed(2)} of the unfiltered ${all}`,
    ).toBeLessThanOrEqual(tolerance);

    // 2. The link opens ?stage=committee, and that page draws no footer: the
    // list above it is that view, so "more" would be false.
    if (allHref) {
      expect(new URL(allHref, "https://cbt.invalid").searchParams.get("stage"), `the footer's link ${allHref}`).toBe("committee");
    }
    const committeePath = allHref ?? "/stale?stage=committee";
    await readFooter(committeePath);
    await expect(footer, `${committeePath} should draw no footer`).toHaveCount(0);

    // 3. The words say the count is the stalled part of the backlog.
    if (all > 0) expect(allText, "/stale's footer words").toMatch(/more stalled in committee/i);
  });

  test("open a race district drawer → .rdm-panel opens and stays within viewport", async ({
    page,
  }) => {
    // HO 504: target /electoral directly. /races 308-redirects here (HO 333); the
    // redirect itself is covered by the route crawl (ROUTES carries /races). A
    // drawer test shouldn't silently ride a 308 to get to the map.
    await page.goto("/electoral", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1_500);
    // HO 767: /electoral opens on the LIST in the general window; the map is one
    // MAP toggle away, unchanged. The click that reveals it comes first, so the
    // count below still reads the map, never an absent one.
    await page.locator(".cart-viewtoggle-btn", { hasText: "MAP" }).click();
    const cells = page.locator(".us-map-state");
    await cells.first().waitFor({ state: "attached", timeout: 10_000 }).catch(() => {});
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

  test("the ratings sources line names, links and dates the raters", async ({ page }) => {
    // HO 784 (mock-784 v3): /electoral's line under the list box, its links
    // following the tab; /race/[id]'s under the chip strip, naming the strip's
    // raters; /welcome's foot, linking each rater's House page. The dates are
    // data, so this reads their shape; HO 784's legs read them against the
    // database.
    const order = ["cook", "inside_elections", "sabato"] as const;
    const fresh = /as of \d{4}-\d{2}-\d{2}( · via ballotpedia| · direct)?/i;

    await page.goto("/electoral", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const line = page.locator(".rl-main > .rl-sources > [data-rating-sources]");
    await expect(line, "/electoral's sources line").toBeVisible({ timeout: 20_000 });
    const [boxBottom, lineTop] = await page.evaluate(() => [
      document.querySelector(".rl-main > .rl-box")?.getBoundingClientRect().bottom ?? Infinity,
      document.querySelector(".rl-main > .rl-sources")?.getBoundingClientRect().top ?? -Infinity,
    ]);
    expect(lineTop, "the line sits under the list box").toBeGreaterThanOrEqual(boxBottom - 1);
    expect(
      await line.locator("[data-rater]").evaluateAll((els) => els.map((e) => e.getAttribute("data-rater"))),
      "the three raters, in order",
    ).toEqual([...order]);
    for (const chamber of ["senate", "house"] as const) {
      if (chamber === "house") await page.locator(".rl-tab", { hasText: "HOUSE" }).click();
      for (const s of order) {
        await expect(line.locator(`[data-rater="${s}"] a`), `${s}'s ${chamber} page`).toHaveAttribute(
          "href",
          RACE_RATING_PAGES_2026[s]?.[chamber] ?? "",
        );
      }
    }
    const dates = await line.locator("[data-rater-freshness]").allTextContents();
    expect(dates.length, "at least one rater says how old its ratings are").toBeGreaterThan(0);
    for (const d of dates) expect(d, "AS OF, then VIA when known").toMatch(fresh);

    await page.goto("/race/S-AK-2026", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const raceLine = page.locator(".race-header [data-rating-sources]");
    await expect(raceLine, "the race page's sources line").toBeVisible({ timeout: 20_000 });
    const [strip, named] = await raceLine.evaluate((el, full) => {
      const raters = (root: Element | null) =>
        root
          ? [...root.querySelectorAll("[title]")]
              .map((e) => e.getAttribute("title") ?? "")
              .filter((t) => full.includes(t))
              .sort()
          : [];
      return [raters(el.previousElementSibling), raters(el)];
    }, Object.values(RACE_RATING_SOURCES));
    expect(named.length, "the line names raters").toBeGreaterThan(0);
    expect(named, "the line's raters are the strip's").toEqual(strip);

    await page.goto("/welcome", { waitUntil: "domcontentloaded", timeout: 45_000 });
    // HO 813: the foot is the lobby's <footer>, and its ratings line reads "Race
    // ratings from Cook, Inside Elections and Sabato, as of <date>, via
    // Ballotpedia": the raters sit between "ratings" and "as of", so the date is
    // read after the raters rather than as "ratings as of".
    const foot = page.locator("footer");
    await expect(foot, "/welcome's footer").toHaveCount(1);
    for (const s of order) {
      await expect(
        foot.locator(`a[href="${RACE_RATING_PAGES_2026[s]?.house ?? ""}"]`),
        `the footer links ${s}'s House page`,
      ).toHaveCount(1);
    }
    await expect(foot).toContainText(/Race ratings from .+, as of \d{4}-\d{2}-\d{2}/);
    await expect(foot).toContainText("four times a day");
  });

  test("the sources lines name where the data comes from", async ({ page }) => {
    // HO 786: /electoral's line under the calendar band, /lobbying's under the
    // header and a Senate roll call's under its head, each linking the page its
    // data is read from (lib/source-links.ts).
    await page.goto("/electoral", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const electoral = page.locator("[data-sources]");
    await expect(electoral, "/electoral's sources line").toBeVisible({ timeout: 20_000 });
    await expect(electoral).toContainText(/primary dates via 270toWin/i);
    await expect(electoral).toContainText(/candidates and results via ballotpedia/i);
    await expect(
      electoral.locator(`a[href="${PRIMARY_CALENDAR_URL}"]`),
      "270toWin links its calendar",
    ).toHaveCount(1);

    await page.goto("/lobbying", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const lobbying = page.locator("[data-sources]");
    await expect(lobbying, "/lobbying's sources line").toBeVisible({ timeout: 20_000 });
    await expect(lobbying).toContainText(/filings via lda\.gov/i);
    await expect(lobbying.locator(`a[href="${LDA_HOME_URL}"]`), "lda.gov links its home").toHaveCount(1);

    await page.goto("/vote/senate-119-1-1", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const vote = page.locator("[data-sources]");
    await expect(vote, "a Senate roll call's sources line").toBeVisible({ timeout: 20_000 });
    await expect(vote).toContainText(/roll call via senate\.gov/i);
    await expect(
      vote.locator(`a[href="${senateRollCallUrl(119, 1, 1, "htm")}"]`),
      "senate.gov links the roll call's own page",
    ).toHaveCount(1);

    // HO 806: /trades credits CapitolStockWatch and links its licence (CC BY 4.0).
    await page.goto("/trades", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const trades = page.locator("[data-sources]");
    await expect(trades, "/trades's sources line").toBeVisible({ timeout: 20_000 });
    await expect(trades).toContainText(/trades via capitolstockwatch/i);
    await expect(trades.locator(`a[href="${CAPITOLSTOCKWATCH_URL}"]`), "CapitolStockWatch links its site").toHaveCount(1);
    await expect(trades.locator(`a[href="${CC_BY_4_URL}"]`), "the licence links CC BY 4.0").toHaveCount(1);
  });

  // HO 808: SHUTDOWN is Kalshi's alone (no liquid Polymarket market asks its
  // question), so its ODDS item holds the K group alone, while FED CUT, which both
  // venues price, keeps two. Read once the tape settles, since the client lays down
  // its copies after hydration. Prod renders the tape to headless Chrome (read Nov
  // 7, 2026: 42 symbols and 18 pair items after hydration), so this asserts rather
  // than skipping on an empty tape.
  test("ODDS on /: SHUTDOWN holds one source group, FED CUT two", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const groups = (re: RegExp) => [
              ...new Set(
                [...document.querySelectorAll(".markets-tape-item--pair")]
                  .filter((it) => re.test(it.querySelector(".markets-tape-symbol")?.textContent?.trim() ?? ""))
                  .map((it) => it.querySelectorAll(".markets-tape-pair-grp").length),
              ),
            ];
            return { shutdown: groups(/^SHUTDOWN$/), fedCut: groups(/^FED CUT/) };
          }),
        { message: "every SHUTDOWN item holds one group and every FED CUT item two", timeout: 20_000 },
      )
      .toEqual({ shutdown: [1], fedCut: [2] });
  });

  // HO 813: the lobby's funnel card. Its title is getCorpusStats(true).total and
  // its bars are getStageDistribution(undefined, true), one scope (summarized,
  // non-ceremonial, every such bill on one of six stages), so the six counts sum
  // to the title. A card that disagrees with itself fails here.
  test("/welcome's funnel sums to its title", async ({ page }) => {
    await page.goto("/welcome", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const card = page.locator("[data-landing-funnel]");
    await expect(card, "/welcome's funnel card").toHaveCount(1, { timeout: 20_000 });
    const rows = card.locator("[data-funnel-row]");
    await expect(rows, "six stage rows").toHaveCount(6);
    const title = ((await card.locator("h2").textContent()) ?? "").trim();
    expect(title, "the title reads N bills, by stage").toMatch(/^[\d,]+ bills, by stage$/);
    const counts = await rows.evaluateAll((els) => els.map((el) => el.lastElementChild?.textContent ?? ""));
    const n = (s: string) => Number(s.replace(/[^0-9]/g, ""));
    const sum = counts.reduce((a, c) => a + n(c), 0);
    expect(sum, `the six counts (${counts.join(" + ")}) sum to the title (${title})`).toBe(n(title));
    await expect(rows.last().locator("span").first(), "the last row's label").toHaveText("Became law");
  });

  // HO 813: the lobby's search is a plain GET form to /search, and /search sends a
  // bill reference to its bill page when CT holds it (lib/bill-ref.ts). The
  // Congress is read at test time, not written as 119.
  //
  // Three readings past the handoff's wording (HO 813, flagged): the redirect is
  // asserted while CT holds the bill, so the leg survives Jan 3, 2027, when the
  // Congress turns 120 and CT holds no 120-hr-3978 for months; a five-digit
  // reference CT doesn't hold reaches getBillById and must fall through, since
  // HR 999999's six digits never parse; and a reference typed into the search box
  // stays on /search, because only a page load takes the fast path.
  test("/welcome searches /search, and a bill number goes to its page", async ({ page }) => {
    await page.goto("/welcome", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const form = page.locator('form[role="search"]');
    await expect(form, "/welcome's search form").toHaveCount(1, { timeout: 20_000 });
    await expect(form, "it submits to /search").toHaveAttribute("action", "/search");
    await expect(form.locator('input[name="q"]'), "its input is named q").toHaveCount(1);

    const id = `${getCurrentCongress()}-hr-3978`;
    const held = (await page.request.get(`/bill/${id}`)).status() === 200;
    if (!held) {
      test.info().annotations.push({
        type: "flag",
        description: `CT holds no ${id} yet, so the fall-through is read instead of the redirect`,
      });
    }
    await page.goto("/search?q=HR+3978", { waitUntil: "domcontentloaded", timeout: 45_000 });
    expect(
      new URL(page.url()).pathname,
      held ? "HR 3978 lands on its bill page" : `CT holds no ${id}, so HR 3978 stays on the search`,
    ).toBe(held ? `/bill/${id}` : "/search");

    await page.goto("/search?q=HR+99999", { waitUntil: "domcontentloaded", timeout: 45_000 });
    expect(new URL(page.url()).pathname, "a reference CT doesn't hold falls through to the search").toBe("/search");
    await page.goto("/search?q=HR+999999", { waitUntil: "domcontentloaded", timeout: 45_000 });
    expect(new URL(page.url()).pathname, "six digits isn't a bill reference, so it stays on the search").toBe("/search");

    await page.goto("/search", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const box = page.locator("input.search-box:visible").first();
    await expect(box, "/search's search box").toBeVisible({ timeout: 20_000 });
    await box.fill("HR 3978");
    await page.waitForURL(/[?&]q=HR\+3978/, { timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(new URL(page.url()).pathname, "a reference typed into the search box stays on /search").toBe("/search");
  });

  // HO 813: What's inside is the nav's pages less Dashboard, in nav order. The nav
  // is read where it renders (an inner page's PrimaryNav, `.primary-nav`), which
  // holds the list to NAV_ITEMS without importing a server component here.
  test("/welcome lists the nine pages", async ({ page }) => {
    await page.goto("/reports", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const nav = page.locator("nav.primary-nav a.pnav-item");
    await expect(nav.first(), "an inner page's nav").toBeAttached({ timeout: 20_000 });
    const navHrefs = await nav.evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    const expected = navHrefs.filter((h) => h !== "/");
    await page.goto("/welcome", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const inside = page.locator("section", { has: page.locator("h2", { hasText: "What's inside" }) });
    await expect(inside, "the What's inside section").toHaveCount(1, { timeout: 20_000 });
    const hrefs = await inside.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(hrefs, "nine links").toHaveLength(9);
    expect(hrefs, "the nav's hrefs less Dashboard, in nav order").toEqual(expected);
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

// HO 813: the lobby's two small libs, checked with no page. The repo has no unit
// runner, only Playwright, and this spec already imports from lib/.
test.describe("lib, no page", () => {
  test("lib: the term dates and the bill reference", () => {
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const t119 = congressTermDates(119);
    const t120 = congressTermDates(120);
    expect([ymd(t119.start), ymd(t119.end)], "the 119th's term").toEqual(["2025-01-03", "2027-01-03"]);
    expect([ymd(t120.start), ymd(t120.end)], "the 120th's term").toEqual(["2027-01-03", "2029-01-03"]);
    const forms: [string, string, number][] = [
      ["H.R. 3978", "hr", 3978],
      ["HR3978", "hr", 3978],
      ["hr 3978", "hr", 3978],
      ["S. 1", "s", 1],
      ["H.J.Res. 12", "hjres", 12],
      ["S.Res. 5", "sres", 5],
      ["H.Con.Res. 1", "hconres", 1],
      ["S.Con.Res. 2", "sconres", 2],
    ];
    for (const [q, type, number] of forms) expect(parseBillRef(q), q).toEqual({ type, number });
    for (const q of ["veterans", "HR", "3978"]) expect(parseBillRef(q), q).toBeNull();
  });
});

// ── HO 819: the icon set and the manifest ────────────────────────────────────
//
// WHAT ITS ZERO MEANS: prod serves the ruled icon set (C, `:\` on amber, ruled
// on mock-819 v2, which scripts/render-icons.ts cites) and a manifest that
// makes CT installable as `standalone`. I1 the ICO at 16, 32 and 48; I2 `/`'s
// head links the 32px PNG, the 180px touch icon, one manifest and the iPhone
// title `CT`; I3 every linked file answers as a PNG of the size it declares; I4
// the manifest's fields, its colours held to the served theme-color, and a 192
// any, 512 any and 512 maskable; I5 the mark's pixels, off the 512 maskable and
// the 32px icon. It says NOTHING about what a launcher draws, or how: Android
// masks and crops, iOS rounds the corners, and neither is readable from here.
//
// THE CONTROL: against prod at 87b0b75 (HO 818's head), at 11:40 AM MST
// 2026-11-16, before any icon existed, all 17 readings were red: "/favicon.ico
// answers 404" (as text/html), "/'s head holds 0 link[rel="manifest"]",
// "apple-mobile-web-app-title reads []", "I3 found 0 icon files to read", "I5:
// the 32px icon's four corners read null as the ground", and the rest alike.
// The served theme-color read "#0a0e14", the colour I4 holds the manifest to.
//
// The files are scripts/render-icons.ts's output. I5 reads their pixels, so a
// re-render that moves the mark out of the maskable safe circle (radius 40%,
// 205px at 512) or off the ground reds here.
const ICON_GROUND = [0xd9, 0x77, 0x06]; // #d97706
const ICON_MARK = [0x0a, 0x0e, 0x14]; // #0a0e14

test.describe("icon and manifest (HO 819)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ context }) => {
    await context.addCookies([GATE_COOKIE]);
  });

  test("the icon set, the manifest and the mark's pixels", async ({ page, request }) => {
    const resp = await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    expect.soft(resp?.status(), `/ answers ${resp?.status()}`).toBe(200);

    // I1, the ICO: 200, an icon type, the ICONDIR magic, and its directory.
    const ico = await request.get("/favicon.ico");
    const icoType = (ico.headers()["content-type"] ?? "").split(";")[0]?.trim() ?? "";
    const icoBuf = ico.ok() ? await ico.body() : Buffer.alloc(0);
    const icoMagic = icoBuf.subarray(0, 4).toString("hex");
    const icoSizes: string[] = [];
    if (icoMagic === "00000100" && icoBuf.length >= 6) {
      const n = icoBuf.readUInt16LE(4);
      for (let i = 0; i < n && 6 + 16 * (i + 1) <= icoBuf.length; i++)
        icoSizes.push(`${icoBuf[6 + 16 * i] || 256}x${icoBuf[7 + 16 * i] || 256}`);
    }
    expect.soft(ico.status(), `/favicon.ico answers ${ico.status()}`).toBe(200);
    expect
      .soft(["image/x-icon", "image/vnd.microsoft.icon"], `/favicon.ico's content-type reads "${icoType}"`)
      .toContain(icoType);
    expect.soft(icoMagic, `/favicon.ico's first four bytes read ${icoMagic || "(none)"}`).toBe("00000100");
    expect
      .soft(
        [...icoSizes].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)),
        `/favicon.ico's directory lists [${icoSizes.join(", ")}]`,
      )
      .toEqual(["16x16", "32x32", "48x48"]);

    // I2, the links in `/`'s head.
    const head = await page.evaluate(() => {
      const links = (rel: string) =>
        Array.from(document.head.querySelectorAll(`link[rel="${rel}"]`)).map((l) => ({
          href: (l as HTMLLinkElement).href,
          type: l.getAttribute("type"),
          sizes: l.getAttribute("sizes"),
        }));
      const metas = (name: string) =>
        Array.from(document.head.querySelectorAll(`meta[name="${name}"]`)).map((m) =>
          m.getAttribute("content"),
        );
      return {
        icon: links("icon"),
        touch: links("apple-touch-icon"),
        manifest: links("manifest"),
        title: metas("apple-mobile-web-app-title"),
        theme: metas("theme-color"),
      };
    });
    const pngIcon = head.icon.find((l) => l.type === "image/png" && l.sizes === "32x32");
    const touchIcon = head.touch.find((l) => l.sizes === "180x180");
    expect
      .soft(pngIcon, `/'s head has no link[rel="icon"] of image/png 32x32; its icon links read ${JSON.stringify(head.icon)}`)
      .toBeTruthy();
    expect
      .soft(touchIcon, `/'s head has no apple-touch-icon of 180x180; its touch links read ${JSON.stringify(head.touch)}`)
      .toBeTruthy();
    expect.soft(head.manifest.length, `/'s head holds ${head.manifest.length} link[rel="manifest"]`).toBe(1);
    expect
      .soft(head.title, `/'s head: apple-mobile-web-app-title reads ${JSON.stringify(head.title)}`)
      .toEqual(["CT"]);

    // I4, the manifest (read before I3, which reads its icons). Its colours are
    // held to the served theme-color, which the touch gate holds to --bg-base.
    type ManifestIcon = { src?: string; sizes?: string; type?: string; purpose?: string };
    const manifestUrl = head.manifest[0]?.href ?? null;
    let manifestStatus = 0;
    let manifest: Record<string, unknown> | null = null;
    if (manifestUrl) {
      const r = await request.get(manifestUrl);
      manifestStatus = r.status();
      try {
        manifest = JSON.parse(await r.text());
      } catch {
        manifest = null;
      }
    }
    expect
      .soft(manifestStatus, `the linked manifest (${manifestUrl ?? "none linked"}) answers ${manifestStatus || "nothing"}`)
      .toBe(200);
    expect.soft(manifest, "the linked manifest parses as JSON").not.toBeNull();
    const m = manifest ?? {};
    const fields = {
      name: m.name,
      short_name: m.short_name,
      id: m.id,
      start_url: m.start_url,
      scope: m.scope,
      display: m.display,
    };
    expect.soft(fields, `the manifest reads ${JSON.stringify(fields)}`).toEqual({
      name: "Congressional Terminal",
      short_name: "CT",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    const theme = (head.theme[0] ?? "").toLowerCase();
    const want = theme || "(no theme-color served)";
    expect
      .soft(
        [String(m.theme_color ?? "").toLowerCase(), String(m.background_color ?? "").toLowerCase()],
        `the manifest's theme_color and background_color read ${m.theme_color} and ${m.background_color}, against the served theme-color "${theme}"`,
      )
      .toEqual([want, want]);
    const icons: ManifestIcon[] = Array.isArray(m.icons) ? (m.icons as ManifestIcon[]) : [];
    const iconFor = (size: number, purpose: string) =>
      icons.find(
        (i) => i.sizes === `${size}x${size}` && (i.purpose ?? "any").split(/\s+/).includes(purpose),
      );
    const missing = ([[192, "any"], [512, "any"], [512, "maskable"]] as const)
      .filter(([s, p]) => !iconFor(s, p))
      .map(([s, p]) => `${s} ${p}`);
    expect.soft(missing, `the manifest's icons lack these; they read ${JSON.stringify(icons)}`).toEqual([]);

    // I3, the files: each answers as a PNG and decodes at its declared size.
    const files: { what: string; url: string; size: number }[] = [];
    if (pngIcon) files.push({ what: "icon 32x32", url: pngIcon.href, size: 32 });
    if (touchIcon) files.push({ what: "apple-touch-icon 180x180", url: touchIcon.href, size: 180 });
    for (const i of icons)
      if (i.src && manifestUrl)
        files.push({
          what: `manifest icon ${i.sizes} ${i.purpose ?? "any"}`,
          url: new URL(i.src, manifestUrl).href,
          size: Number(/^(\d+)x\1$/.exec(i.sizes ?? "")?.[1] ?? NaN),
        });
    expect.soft(files.length, `I3 found ${files.length} icon files to read`).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const r = await request.get(f.url);
      const type = (r.headers()["content-type"] ?? "").split(";")[0]?.trim() ?? "";
      expect.soft([r.status(), type], `${f.what} (${f.url}) answers ${r.status()} as "${type}"`).toEqual([200, "image/png"]);
      const dims = await page.evaluate(async (u) => {
        const img = new Image();
        img.src = u;
        try {
          await img.decode();
          return [img.naturalWidth, img.naturalHeight];
        } catch {
          return null;
        }
      }, f.url);
      expect.soft(dims, `${f.what} decodes at ${JSON.stringify(dims)}`).toEqual([f.size, f.size]);
    }

    // I5, the mark's pixels: off the 512 maskable, drawn to a canvas in the page.
    const maskable = iconFor(512, "maskable");
    const px = await page.evaluate(
      async ({ maskUrl, iconUrl, ground, mark }) => {
        const near = (d: Uint8ClampedArray, i: number, c: number[], tol: number) =>
          [0, 1, 2].every((k) => Math.abs((d[i + k] ?? -999) - (c[k] ?? 999)) <= tol);
        const pixels = async (u: string, n: number) => {
          const img = new Image();
          img.src = u;
          await img.decode();
          const cv = document.createElement("canvas");
          cv.width = n;
          cv.height = n;
          const ctx = cv.getContext("2d")!;
          ctx.drawImage(img, 0, 0, n, n);
          return ctx.getImageData(0, 0, n, n).data;
        };
        const out = { outside: -1, outsideOff: -1, inside: -1, insideMark: -1, farthest: -1, corners: null as boolean[] | null };
        if (maskUrl) {
          try {
            const d = await pixels(maskUrl, 512);
            let outside = 0, outsideOff = 0, inside = 0, insideMark = 0, farthest = 0;
            for (let y = 0; y < 512; y++)
              for (let x = 0; x < 512; x++) {
                const r = Math.hypot(x + 0.5 - 256, y + 0.5 - 256);
                const i = (y * 512 + x) * 4;
                const isMark = near(d, i, mark, 12);
                if (isMark && r > farthest) farthest = r;
                if (r > 205) {
                  outside++;
                  if (!near(d, i, ground, 3)) outsideOff++;
                } else {
                  inside++;
                  if (isMark) insideMark++;
                }
              }
            Object.assign(out, { outside, outsideOff, inside, insideMark, farthest: Math.round(farthest) });
          } catch {
            /* stays -1: read as red below */
          }
        }
        if (iconUrl) {
          try {
            const d = await pixels(iconUrl, 32);
            out.corners = [0, 31 * 4, 31 * 32 * 4, (31 * 32 + 31) * 4].map((i) => near(d, i, ground, 3));
          } catch {
            /* stays null */
          }
        }
        return out;
      },
      {
        maskUrl: maskable?.src && manifestUrl ? new URL(maskable.src, manifestUrl).href : null,
        iconUrl: pngIcon?.href ?? null,
        ground: ICON_GROUND,
        mark: ICON_MARK,
      },
    );
    const share = px.inside > 0 ? px.insideMark / px.inside : 0;
    expect
      .soft(px.outsideOff, `I5: ${px.outsideOff} of the 512 maskable's ${px.outside} pixels outside the safe circle are off the ground`)
      .toBe(0);
    expect
      .soft(share, `I5: ${(share * 100).toFixed(1)}% of the safe circle is the mark (${px.insideMark} of ${px.inside})`)
      .toBeGreaterThanOrEqual(0.03);
    expect
      .soft(px.corners, `I5: the 32px icon's four corners read ${JSON.stringify(px.corners)} as the ground`)
      .toEqual([true, true, true, true]);

    // eslint-disable-next-line no-console
    console.log(
      `[icons] ico=${icoSizes.join(",") || "none"}` +
        ` links=icon-png-32:${pngIcon ? 1 : 0} touch-180:${touchIcon ? 1 : 0} manifest:${head.manifest.length} title:${head.title.join("|") || "none"}` +
        ` display=${String(m.display ?? "none")} short_name=${String(m.short_name ?? "none")}` +
        ` I5 off-ground-outside=${px.outsideOff}/${px.outside} mark-inside=${px.insideMark}/${px.inside} (${(share * 100).toFixed(1)}%) farthest-mark=${px.farthest}px`,
    );
  });
});

// ── HO 821: the dashboard search ──────────────────────────────────────────────
//
// WHAT ITS ZERO MEANS: the two read-only routes answer as /search counts (S1:
// the four counts equal the tab counts /search prints for the same q, each list
// at most 4, a bill number puts its bill first), the card route answers a pick
// and refuses a bad one without leaking a stack or a driver message (S2), and on
// the dashboard at 1440 the bar sits under the masthead, takes `/`, lists as you
// type, opens the pick as a card under itself, keeps it through a reload and
// clears it (S3). It says NOTHING about speed on a phone's network, what a real
// keyboard does, or a phone at all: the touch gate's Q1 to Q4 read the ⌕.
//
// S1'S CACHE HEADER, AS EACH HOST SERVES IT (HO 821's follow-up). The route sends
// `public, s-maxage=60, stale-while-revalidate=300`. With no `x-vercel-cache`
// header (a local `next start`) S1 reads that header untouched: it holds
// `s-maxage=60`. Behind Vercel's CDN, which consumes `s-maxage` and
// `stale-while-revalidate` and forwards `public` (e2e-prod 44033213197, the
// Production run after HO 821's FF, read `public` and went red on `s-maxage`),
// S1 reads `vercelCacheable`: `public`, and none of `no-store`, `private`,
// `max-age=0` or `must-revalidate`. Then it repeats the request once and LOGS the
// repeat's `x-vercel-cache` and time, unasserted: a cold edge can miss twice.
// ITS CONTROL is `CLAIM11_404_CC`, `public, max-age=0, must-revalidate`, the header
// claim 11 read on prod at 601f90e on 2026-11-16 (7:26 PM MST), when both routes
// answered Next's 404 page. It's the header Vercel sends for a response the route
// sets nothing on, and it holds `public`, so a check on `public` alone would pass
// it. `vercelCacheable` must reject it, inside S1, on every run.
//
// S3'S AMBER RUN (HO 822). Twice, `document.getAnimations()` holds no running
// CSSAnimation named `ds-pull`: on the idle bar before typing, and once tax's list
// has drawn and `.ds-pull` has lost `on` (no request out). ITS CONTROL is HO 822's
// STEP 0 claim 6: on prod at 5829418, an idle `/` at 1280 held one on
// `.ds-pull::before`, with `.ds-pull` not on, and the same read under reduced
// motion held none.
//
// THE CONTROL: claim 11, on prod at 601f90e, 2026-11-16 7:26 PM MST, read every
// reading red. Both routes answered 404 with Next's HTML page (`public,
// max-age=0, must-revalidate`): no counts against /search's (tax 1,696 / 0 / 52
// / 15), no lists, no bills for tax or shutdown, `q=a` 404 not 400, no `ref`
// for 119-hr-3978 (which CT holds), no card, no stages against the bill page's
// six, `pick=nonsense` 404 not 400, and the not-found body HTML, not
// `{"error":"not found"}`. On / at 1440 no `.ds` input, so `/`, the list, its
// groups, `aria-expanded`, the card, the pick, the reload and the clear all read
// red. The no-leak read is a GUARD, with no red at the base (nothing to leak).
// Its control is a plant on a local build, the card route's read made to throw:
// 503 `{"error":"unavailable"}` with no stack reads green, and a plant that
// echoes the error into the body reads red.
const SEARCH_QS = ["tax", "shutdown"] as const;
const STACK_OR_DRIVER = /\bat [\w$.<>]+ \(|\n\s+at \S|SQLITE|LibsqlError/;
const CLAIM11_404_CC = "public, max-age=0, must-revalidate";
const UNCACHEABLE = ["no-store", "private", "max-age=0", "must-revalidate"];
// Behind Vercel's CDN: `public`, and none of the four, read directive by directive.
function vercelCacheable(cc: string): boolean {
  const d = cc.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  return d.includes("public") && !d.some((x) => UNCACHEABLE.includes(x));
}
// HO 822: the running `ds-pull` animations, with whether `.ds-pull` was on and
// what each animation read, for the message.
const readPull = (page: Page) =>
  page.evaluate(() => {
    const running = document
      .getAnimations()
      .filter((a): a is CSSAnimation => a instanceof CSSAnimation && a.animationName === "ds-pull" && a.playState === "running");
    return {
      running: running.length,
      on: document.querySelector(".ds-pull")?.classList.contains("on") ?? null,
      read: running
        .map((a) => `${(a.effect as KeyframeEffect | null)?.pseudoElement ?? "(element)"} at ${Math.round(Number(a.currentTime ?? 0))}ms`)
        .join(", "),
    };
  });
const pullSaid = (p: { running: number; on: boolean | null; read: string }) =>
  `${p.running} (.ds-pull ${p.on === null ? "missing" : p.on ? "on" : "not on"}${p.read ? `; ${p.read}` : ""})`;

test.describe("dashboard search (HO 821)", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ context }) => {
    await context.addCookies([GATE_COOKIE]);
  });

  test("the routes answer as /search counts, and the bar finds, picks and keeps a pick", async ({ page, request }) => {
    type Suggest = {
      q?: string;
      ref?: string | null;
      counts?: Record<string, number>;
      bills?: { id: string }[];
      members?: unknown[];
      news?: unknown[];
      reports?: unknown[];
    };
    const timed = async (url: string) => {
      const t0 = Date.now();
      const r = await request.get(url);
      const text = await r.text();
      return { r, text, ms: Date.now() - t0 };
    };
    const tabCounts = async (q: string) => {
      await page.goto(`/search?q=${encodeURIComponent(q)}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      return page.evaluate(() => {
        const out: Record<string, number> = {};
        for (const a of Array.from(document.querySelectorAll('.search-tabs a[role="tab"]'))) {
          const tab = new URL((a as HTMLAnchorElement).href).searchParams.get("tab") ?? "";
          out[tab] = Number((a.querySelector(".count")?.textContent ?? "").replace(/[^0-9]/g, ""));
        }
        return out;
      });
    };
    const bodies: string[] = [];
    const logParts: string[] = [];

    // S1, the suggest route.
    expect
      .soft(vercelCacheable(CLAIM11_404_CC), `S1's control: the Vercel predicate passes claim 11's 404 header "${CLAIM11_404_CC}"`)
      .toBe(false);
    let firstBill: string | null = null;
    for (const q of SEARCH_QS) {
      const want = await tabCounts(q);
      const { r, text, ms } = await timed(`/api/search/suggest?q=${encodeURIComponent(q)}`);
      bodies.push(text);
      let body: Suggest = {};
      try {
        body = JSON.parse(text);
      } catch {
        body = {};
      }
      const cc = r.headers()["cache-control"] ?? "";
      expect.soft(r.status(), `S1 suggest q=${q} answers ${r.status()}`).toBe(200);
      expect.soft(r.headers()["content-type"] ?? "", `S1 suggest q=${q} content-type`).toContain("application/json");
      const edge = r.headers()["x-vercel-cache"] ?? null;
      if (edge === null) {
        expect.soft(cc, `S1 suggest q=${q}, no x-vercel-cache: cache-control reads "${cc}"`).toContain("s-maxage=60");
      } else {
        expect.soft(vercelCacheable(cc), `S1 suggest q=${q}, x-vercel-cache ${edge}: cache-control reads "${cc}"`).toBe(true);
      }
      let repeat = "none";
      if (edge !== null) {
        const again = await timed(`/api/search/suggest?q=${encodeURIComponent(q)}`);
        repeat = `${again.r.headers()["x-vercel-cache"] ?? "none"} ${again.ms}ms`;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[search cache] ${q}: branch=${edge === null ? "local" : "vercel"} cc="${cc}" x-vercel-cache=${edge ?? "none"} repeat=${repeat} control=${vercelCacheable(CLAIM11_404_CC) ? "PASSED" : "rejected"}`,
      );
      expect.soft(body.counts ?? null, `S1 q=${q}: the route's counts against /search's tabs ${JSON.stringify(want)}`).toEqual(want);
      for (const k of ["bills", "members", "news", "reports"] as const) {
        const n = Array.isArray(body[k]) ? (body[k] as unknown[]).length : -1;
        expect.soft(n >= 0 && n <= 4, `S1 q=${q}: ${k} holds ${n} rows, not 0 to 4`).toBe(true);
      }
      // The shape read alone is vacuous on an empty list (claim 11 read it green
      // on a 404), so it's one reading with the list's length: a q whose
      // LEGISLATION tab counts bills (tax 1,696, shutdown 169) must list some,
      // and every row must have the shape.
      const billIds = (body.bills ?? []).map((b) => b.id);
      const badIds = billIds.filter((id) => !/^\d+-[a-z]+-\d+$/.test(id));
      expect.soft(
        { listed: (want.bills ?? 0) > 0 ? billIds.length > 0 : true, offShape: badIds },
        `S1 q=${q}: bills listed (its tab counts ${want.bills}) and none off the id shape`,
      ).toEqual({ listed: true, offShape: [] });
      firstBill ??= body.bills?.[0]?.id ?? null;
      logParts.push(`${q}: ${r.status()} ${ms}ms counts=${JSON.stringify(body.counts ?? null)} /search=${JSON.stringify(want)}`);
    }
    const short = await timed("/api/search/suggest?q=a");
    bodies.push(short.text);
    expect.soft(short.r.status(), `S1 suggest q=a answers ${short.r.status()}, not 400`).toBe(400);

    // The bill-number line, read the way HO 813's test reads it: whether CT
    // holds the current Congress's HR 3978 decides what the route must say.
    const refId = `${getCurrentCongress()}-hr-3978`;
    const held = (await request.get(`/bill/${refId}`)).status() === 200;
    const ref = await timed(`/api/search/suggest?q=${encodeURIComponent("hr 3978")}`);
    bodies.push(ref.text);
    let refBody: Suggest = {};
    try {
      refBody = JSON.parse(ref.text);
    } catch {
      refBody = {};
    }
    if (held) {
      expect.soft(refBody.ref ?? null, `S1 hr 3978: ref`).toBe(refId);
      expect.soft(refBody.bills?.[0]?.id ?? null, `S1 hr 3978: bills[0]`).toBe(refId);
    } else {
      test.info().annotations.push({ type: "flag", description: `CT holds no ${refId}, so ref is read as null` });
      expect.soft(refBody.ref ?? null, `S1 hr 3978: CT holds no ${refId}, so ref`).toBeNull();
    }
    logParts.push(`hr 3978: ${ref.r.status()} ${ref.ms}ms ref=${refBody.ref ?? "null"} held=${held}`);

    // S2, the card route.
    const pickId = held ? refId : firstBill;
    let cardTitle = "";
    if (!pickId) expect.soft(pickId, "S2 has no bill to pick").not.toBeNull();
    else {
      const card = await timed(`/api/search/card?pick=${encodeURIComponent(`bill:${pickId}`)}`);
      bodies.push(card.text);
      let c: { title?: string; href?: string; stage?: string | null; stages?: string[] } = {};
      try {
        c = JSON.parse(card.text);
      } catch {
        c = {};
      }
      await page.goto(`/bill/${pickId}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      const pageTitle = ((await page.locator("h1").first().textContent()) ?? "").trim();
      // The six stage labels the bill page draws (BillStageBar), held against the
      // card's: the route's copy of them can't drift unread.
      const pageStages = (await page.locator('.v2f-bar[aria-label="Bill stage"] .v2f-blabel').allTextContents()).map((s) => s.trim());
      cardTitle = c.title ?? "";
      expect.soft(card.r.status(), `S2 card bill:${pickId} answers ${card.r.status()}`).toBe(200);
      expect.soft(cardTitle, `S2 card bill:${pickId}: title against the bill page's h1`).toBe(pageTitle);
      expect.soft(c.href ?? "", `S2 card bill:${pickId}: href`).toBe(`/bill/${pickId}`);
      if (pageStages.length === 6) {
        expect.soft(c.stages ?? null, `S2 card bill:${pickId}: stages against the bill page's ${JSON.stringify(pageStages)}`).toEqual(pageStages);
      } else {
        test.info().annotations.push({ type: "flag", description: `/bill/${pickId} draws ${pageStages.length} stage labels, so its stage is read as null` });
        expect.soft("stage" in c ? c.stage : "(missing)", `S2 card bill:${pickId}: the page draws no stage track, so the card's stage`).toBeNull();
      }
      logParts.push(`card bill:${pickId} ${card.r.status()} ${card.ms}ms stages=${JSON.stringify(c.stages ?? null)} page-stages=${JSON.stringify(pageStages)}`);
    }
    const bad = await timed("/api/search/card?pick=nonsense");
    bodies.push(bad.text);
    expect.soft(bad.r.status(), `S2 card pick=nonsense answers ${bad.r.status()}, not 400`).toBe(400);
    const gone = await timed(`/api/search/card?pick=${encodeURIComponent(`bill:${getCurrentCongress()}-hr-999999`)}`);
    bodies.push(gone.text);
    expect.soft(gone.r.status(), `S2 card for a bill CT doesn't hold answers ${gone.r.status()}, not 404`).toBe(404);
    // A status alone can't tell the route's 404 from no route (claim 11 read it
    // green on Next's HTML 404), so the body is the route's own contract.
    let goneBody: unknown = null;
    try {
      goneBody = JSON.parse(gone.text);
    } catch {
      goneBody = gone.text.slice(0, 60);
    }
    expect.soft(goneBody, "S2 card for a bill CT doesn't hold: the body").toEqual({ error: "not found" });
    // A GUARD, with no red at the base by nature (no route, nothing to leak). Its
    // control is a plant on a local build, recorded in the header.
    const leaks = bodies.filter((b) => STACK_OR_DRIVER.test(b)).map((b) => b.slice(0, 120));
    expect.soft(leaks, "S2: no body, red or green, holds a stack frame or a driver message").toEqual([]);

    // S3, the bar at 1440, a fine pointer.
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("load").catch(() => {});
    await page.waitForTimeout(1_500);
    const boxes = await page.evaluate(() => {
      const visible = (el: Element | null): el is HTMLElement =>
        !!el && (el as HTMLElement).checkVisibility({ visibilityProperty: true }) && el.getBoundingClientRect().width > 0;
      const inputs = Array.from(document.querySelectorAll('.ds input[type="search"]')).filter(visible);
      const input = inputs[0] ?? null;
      const ds = input?.closest(".ds") ?? null;
      const header = document.querySelector(".dash-left > .home-header");
      const left = document.querySelector(".dash-left");
      // The first panel is read without the bar: the first visible child of
      // .dash-left after the masthead that isn't the bar and doesn't hold it,
      // so a bar drawn below a panel reads red.
      const kids = left ? Array.from(left.children) : [];
      const after = header ? kids.indexOf(header) + 1 : 0;
      const panel = kids.slice(after).find((el) => !el.matches(".ds") && !el.querySelector(".ds") && visible(el)) ?? null;
      const r = (el: Element | null | undefined) => (el ? el.getBoundingClientRect() : null);
      const b = (el: Element | null | undefined) => {
        const x = r(el);
        return x ? { t: x.top, b: x.bottom, l: x.left, w: x.width } : null;
      };
      return { inputs: inputs.length, input: b(input), header: b(header), panel: b(panel), left: b(left) };
    });
    expect.soft(boxes.inputs, "S3: visible .ds input[type=search] on /").toBe(1);
    // The placement reads four boxes; a missing one is a red reading, not a skip.
    expect.soft(
      { input: !!boxes.input, header: !!boxes.header, panel: !!boxes.panel, left: !!boxes.left },
      "S3: the boxes the placement reads (the bar's input, the masthead, the first panel, .dash-left)",
    ).toEqual({ input: true, header: true, panel: true, left: true });
    if (boxes.input && boxes.header && boxes.panel && boxes.left) {
      expect.soft(boxes.input.t >= boxes.header.b, `S3: the bar's top ${boxes.input.t} is below the masthead's bottom ${boxes.header.b}`).toBe(true);
      expect.soft(boxes.input.t < boxes.panel.t, `S3: the bar's top ${boxes.input.t} is above the first panel's ${boxes.panel.t}`).toBe(true);
      expect.soft(Math.abs(boxes.input.w - boxes.left.w), `S3: the bar ${boxes.input.w} wide, .dash-left ${boxes.left.w}`).toBeLessThanOrEqual(1);
    }
    // HO 822: the amber run on the idle bar, before typing.
    const pullIdle = await readPull(page);
    let pullAfter: Awaited<ReturnType<typeof readPull>> | null = null;
    const input = page.locator('.ds input[type="search"]').first();
    let s3 = { slash: false, options: 0, groups: 0, maxGroup: 0,expanded: null as string | null, cardGap: null as number | null, href: "", pick: "", reloadTitle: "", cleared: false, firstTitle: "" };
    if (boxes.inputs === 1) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("/");
      s3.slash = await input.evaluate((el) => el === document.activeElement);
      await page.keyboard.type("tax", { delay: 60 });
      await page.locator('.ds-drop [role="option"]').first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
      // HO 822: the second moment, tax's list drawn and no request out.
      await page.waitForFunction(() => !document.querySelector(".ds-pull.on"), null, { timeout: 5_000 }).catch(() => {});
      pullAfter = await readPull(page);
      const drop = await page.evaluate(() => {
        const groups = Array.from(document.querySelectorAll(".ds-drop [role='group']"));
        return {
          options: document.querySelectorAll('.ds-drop [role="option"]').length,
          groups: groups.length,
          maxGroup: Math.max(0, ...groups.map((g) => g.querySelectorAll('[role="option"]').length)),
          expanded: document.querySelector('.ds input[type="search"]')?.getAttribute("aria-expanded") ?? null,
        };
      });
      Object.assign(s3, drop);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.locator(".ds-card").first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
      const picked = await page.evaluate(() => {
        const card = document.querySelector(".ds-card");
        const form = document.querySelector(".ds form");
        const open = card?.querySelector("a.ds-card-open") as HTMLAnchorElement | null;
        return {
          gap: card && form ? card.getBoundingClientRect().top - form.getBoundingClientRect().bottom : null,
          href: open?.getAttribute("href") ?? "",
          pick: new URL(location.href).searchParams.get("pick") ?? "",
          title: (card?.querySelector(".ds-card-title")?.textContent ?? "").trim(),
        };
      });
      s3.cardGap = picked.gap;
      s3.href = picked.href;
      s3.pick = picked.pick;
      s3.firstTitle = picked.title;
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.locator(".ds-card").first().waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
      s3.reloadTitle = ((await page.locator(".ds-card .ds-card-title").first().textContent().catch(() => "")) ?? "").trim();
      await page.locator(".ds-card .ds-card-clear").first().click({ timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(400);
      s3.cleared = await page.evaluate(
        () => !document.querySelector(".ds-card") && !new URL(location.href).searchParams.has("pick"),
      );
    }
    expect.soft(s3.slash, "S3: / from the page body focuses the bar").toBe(true);
    expect.soft(s3.options, "S3: typing tax lists options within 5 s").toBeGreaterThan(0);
    // Vacuous with no list (the re-run of claim 11 read it green at the base), so
    // one reading with the group count: groups drawn, none holding more than 4.
    expect.soft(
      { grouped: s3.groups > 0, over4: s3.maxGroup > 4 },
      `S3: ${s3.groups} groups, the largest ${s3.maxGroup} rows: groups drawn, none over 4`,
    ).toEqual({ grouped: true, over4: false });
    expect.soft(s3.expanded, "S3: the input's aria-expanded while listing").toBe("true");
    expect.soft(s3.cardGap !== null && s3.cardGap >= 0 && s3.cardGap <= 8, `S3: the card's top sits ${s3.cardGap}px under the bar`).toBe(true);
    expect.soft(s3.href.startsWith("/bill/"), `S3: the card's OPEN link reads ${s3.href}`).toBe(true);
    expect.soft(s3.pick, "S3: the URL's pick").toBe(`bill:${s3.href.replace(/^\/bill\//, "")}`);
    expect.soft(s3.reloadTitle, "S3: after a reload the card is back with the same title").toBe(s3.firstTitle || "(no card title read)");
    expect.soft(s3.cleared, "S3: ✕ on the card clears it and the pick").toBe(true);
    expect.soft(pullIdle.running, `S3: running ds-pull animations on the idle bar, before typing: ${pullSaid(pullIdle)}`).toBe(0);
    expect
      .soft(
        pullAfter?.running ?? null,
        `S3: running ds-pull animations once tax's list drew, no request out: ${pullAfter ? pullSaid(pullAfter) : "not read (no bar)"}`,
      )
      .toBe(0);

    // eslint-disable-next-line no-console
    console.log(
      `[search] ${logParts.join(" | ")} | card-title=${JSON.stringify(cardTitle)}` +
        ` | S3 inputs=${boxes.inputs} input=${JSON.stringify(boxes.input)} header-bottom=${boxes.header?.b ?? "none"} panel-top=${boxes.panel?.t ?? "none"} left-w=${boxes.left?.w ?? "none"}` +
        ` slash=${s3.slash} options=${s3.options} groups=${s3.groups} max-group=${s3.maxGroup} expanded=${s3.expanded} gap=${s3.cardGap} pick=${s3.pick || "none"} reload=${JSON.stringify(s3.reloadTitle)} cleared=${s3.cleared}` +
        ` pull-idle=${pullIdle.running} pull-after=${pullAfter?.running ?? "unread"}`,
    );
  });
});
