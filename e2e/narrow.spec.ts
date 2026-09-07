// HO 694 — THE NARROW GATE: the doc-scroll invariant at 430, for every crawl
// route.
//
// WHY IT DID NOT EXIST, which is the whole reason three filed defects sat
// unrepaired. Every standing width gate in this repo is WIDE-VIEWPORT-ONLY:
// `fit-finish.spec.ts` asserts `scrollWidth <= clientWidth` on `/` at 1440 and
// 2560, and the layout audit's M0 collects the same pair at 2560. Nothing could
// see a narrow defect, so `/members` shipped scrolling horizontally by 141px and
// stayed that way. This does not invent the idiom — `odds-off.spec.ts` (HO 693)
// already asserts doc-scroll at 430 on five routes; this GENERALISES it to the
// ~36 the crawl walks, and takes the list from `routes.ts` so it cannot silently
// cover fewer than the crawl does.
//
// WHAT ITS ZERO MEANS (method.md § Gates). A green run means: at a 430 viewport,
// after load plus a fixed settle, no route's document scroller is wider than its
// client width by more than 1px. It does NOT mean the page is legible, that
// nothing is clipped by an `overflow:hidden` ancestor, or that anything is true
// at any other narrow width — a defect that overflows a CHILD with its own
// scroller is invisible here by construction, exactly as it is to the 1440/2560
// invariant this joins.
//
// THE CONTROL IS THE HISTORY, NOT A PLANT. Run against prod at `409e074`, before
// any fix, this spec was RED on seven routes (`/members`, `/members/pass-rate`,
// `/committees` — one page reached three ways, 141px — plus `/news` 97,
// `/lobbying` 91, `/committee/[code]` 57 and `/members/[id]` 10). A gate seen
// failing on live data needs no synthetic leg; the readings are in the HO 694
// roadmap block.
//
// ON FAILURE IT NAMES ITS CAUSE. A red run in CI is unattended, so the assertion
// message alone ("it scrolls") would send the next reader to a local repro that
// may not reproduce — the class is data-armed (HO 682/683). So a failing route
// logs the over-edge elements: every element whose right edge passes
// `clientWidth`, deepest-first, with the computed `white-space` / `min-width`
// that usually explain why. That is the HO 690 attribution method with one
// deliberate substitution, recorded rather than silent: `elementsFromPoint`
// cannot sample past the viewport's right edge without first scrolling the
// document, and scrolling changes the geometry being measured, so this reads
// `getBoundingClientRect()` at scroll 0 instead. Same question, one fewer moving
// part.
//
// NO SCREENSHOTS AND NO COLLECTORS. The crawl already owns console/pageerror/
// failed-request attribution on these routes; this spec asserts one number and
// spends one navigation per route.
import { expect, test } from "@playwright/test";
import { ROUTES } from "./routes";

const BASE_URL =
  process.env.BASE_URL ?? "https://congressional-terminal-chi-silk.vercel.app";
// Same idiom as smoke.spec.ts / odds-off.spec.ts, deliberately copied rather
// than shared: it is one line, and the near-miss helpers stay per-spec.
const GATE_COOKIE = { name: "ct_seen", value: "1", url: BASE_URL };

// 430 is the iPhone 15 Pro Max CSS width and the narrow viewport the HO 670
// capture set and `odds-off.spec.ts` already use — one narrow number across the
// repo rather than a second one to keep in step.
const NARROW = { width: 430, height: 932 };

// The same 1px subpixel tolerance the layout audit's M0 and the HO 683 overflow
// alarm use, for the same reason and deliberately not tighter.
const TOLERANCE = 1;

/** Every element whose right edge passes clientWidth, deepest offender first. */
// HO 698 — the diagnostic that reads the /welcome @430 red on Ubuntu.
// Three things the HO 697 version could not say, each of which cost a wrong read:
//   CLIPPED — an element whose rect is past the edge but which sits inside an
//     overflow-x-clipping ancestor cannot move the document scroller. The
//     /welcome marquee spans (right ~4030 at a 430 viewport) filled the whole
//     list and hid whatever the real 15px was.
//   FONT    — the family and size actually resolved on that element, because the
//     suspicion is that the hosts differ only in the window BEFORE the
//     self-hosted face applies.
//   ORDER   — unclipped first, so the list opens on what can actually push the
//     document.
type FontState = {
  status: string;
  mono: boolean;
  sans: boolean;
  bodyFamily: string;
};

const FONT_STATE = `(() => ({
  status: document.fonts.status,
  mono: document.fonts.check('12px "IBM Plex Mono"'),
  sans: document.fonts.check('12px "IBM Plex Sans"'),
  bodyFamily: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/["']/g, ''),
}))()`;

const OVER_EDGE = `(() => {
  const cw = document.documentElement.clientWidth;
  const rows = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right <= cw + 1) continue;
    let childOver = false;
    for (const ch of Array.from(el.children)) {
      if (ch.getBoundingClientRect().right > cw + 1) { childOver = true; break; }
    }
    if (childOver) continue;
    let clip = '';
    for (let a = el.parentElement; a; a = a.parentElement) {
      const ax = getComputedStyle(a).overflowX;
      if (ax && ax !== 'visible') {
        const acls = typeof a.className === 'string' && a.className
          ? '.' + a.className.trim().split(/\s+/)[0] : '';
        clip = a.tagName.toLowerCase() + acls + '(' + ax + ')';
        break;
      }
    }
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    const cs = getComputedStyle(el);
    rows.push({
      k: el.tagName.toLowerCase() + cls,
      right: Math.round(r.right),
      w: Math.round(r.width),
      ws: cs.whiteSpace,
      minw: cs.minWidth,
      font: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim() + '/' + cs.fontSize,
      clip: clip,
    });
  }
  rows.sort((a, b) => (a.clip === b.clip ? b.right - a.right : (a.clip ? 1 : -1)));
  const seen = new Set();
  const out = [];
  for (const o of rows) {
    const key = o.k + '|' + o.right;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o.k + ' right=' + o.right + ' w=' + o.w + ' ws=' + o.ws
      + ' minw=' + o.minw + ' font=' + o.font
      + (o.clip ? ' CLIPPED-BY=' + o.clip : ' UNCLIPPED'));
    if (out.length >= 10) break;
  }
  return out;
})()`;

test.describe("narrow doc-scroll @430", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of ROUTES) {
    test(`${route.slug} (${route.path})`, async ({ page, context }) => {
      await context.addCookies([GATE_COOKIE]);
      await page.setViewportSize(NARROW);

      await page.goto(route.path, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      // The crawl's settle, verbatim: the markets tape polls, so `networkidle`
      // never fires and a fixed wait is the pragmatic choice.
      await page.waitForLoadState("load").catch(() => {});
      await page.waitForTimeout(2_500);

      // A redirect route (`/races`, `/primaries`, `/committees`, `/dashboard-v2`,
      // `/members/pass-rate`) asserts on the page it ARRIVES at, which is the
      // honest reading — that is the document a reader actually gets — and the
      // landed URL is logged so a redirect that changes destination is visible
      // here rather than only in the crawl.
      const doc = await page.evaluate(() => ({
        s: document.documentElement.scrollWidth,
        c: document.documentElement.clientWidth,
        url: location.pathname + location.search,
      }));
      const over = doc.s - doc.c;

      // HO 698 — read the font state AT the width, not after, and take a second
      // width once the face has definitely applied. A 445 that becomes 430 at
      // `fonts.ready` is a load-window reading, not a layout defect.
      const fonts = (await page.evaluate(FONT_STATE)) as FontState;
      const culprits =
        over > TOLERANCE ? ((await page.evaluate(OVER_EDGE)) as string[]) : [];
      let after = doc.s;
      let fontsAfter = fonts;
      if (over > TOLERANCE) {
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        after = await page.evaluate(() => document.documentElement.scrollWidth);
        fontsAfter = (await page.evaluate(FONT_STATE)) as FontState;
      }

      // eslint-disable-next-line no-console
      console.log(
        `[narrow ${route.slug}] landed=${doc.url} scroll=${doc.s}/${doc.c} over=${over}` +
          ` fonts=${fonts.status}/mono:${fonts.mono}/sans:${fonts.sans}/body:${fonts.bodyFamily}` +
          (over > TOLERANCE
            ? `
    after fonts.ready: scroll=${after}/${doc.c} over=${after - doc.c}` +
              ` fonts=${fontsAfter.status}/mono:${fontsAfter.mono}`
            : "") +
          (culprits.length
            ? `\n    over-edge: ${culprits.join("\n               ")}`
            : ""),
      );

      expect(
        doc.s,
        `${route.path} scrolls horizontally at ${NARROW.width} ` +
          `(scrollWidth ${doc.s} vs clientWidth ${doc.c}, over ${over}px) — ` +
          `over-edge: ${culprits.join(" | ") || "none captured"}`,
      ).toBeLessThanOrEqual(doc.c + TOLERANCE);
    });
  }
});
