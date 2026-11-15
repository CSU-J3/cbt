// HO 815 — THE TOUCH GATE: the first spec in this repo that reads a page the way
// a touch device is served it.
//
// WHY IT DID NOT EXIST. Every other spec runs the config's one project, Desktop
// Chrome, whose pointer is fine. So a rule under `@media (pointer: coarse)` was
// invisible to every gate: the narrow gate reads a phone's WIDTH with a mouse's
// pointer. This spec sets `hasTouch` and `isMobile` and reads what that changes.
//
// WHAT IT READS, per route, at two viewports, in this order:
//   1. THE PAGE — the response is 2xx and the browser rests on the route's own
//      path. An error page has no controls and no overflow; green on it would be
//      green on nothing (the narrow gate's HO 703 control, for the same reason).
//   2. THE EMULATION, read inside the page — `matchMedia('(pointer: coarse)')`
//      matches and `innerWidth` equals the viewport's width. HO 708's rule: an
//      emulation is proven by reading it back in the page, never by the option
//      meant to set it. Measured at HO 815's STEP 0 on Chromium 149: `hasTouch`
//      alone flips `pointer: coarse`, `isMobile` alone leaves it fine, and with
//      neither it reads false at the same 390 viewport.
//   3. THE CONTROLS — every visible text-entry control (`TEXT_ENTRY_SELECTOR`,
//      `e2e/routes.ts`). At least one exists, and each computes a `font-size` of
//      16px or more.
//   4. THE WIDTH — `scrollWidth <= clientWidth + 1` on the document, since a
//      control that grows to 16px is wider and taller than it was.
//   5. THE COLOUR — `meta[name="theme-color"]` carries `--bg-base` as computed
//      on `:root`. `app/layout.tsx` states the value as a literal, because a
//      `viewport` export cannot read a CSS variable, so this is what holds the
//      literal and the token together.
//   6. THE FACE (HO 816) — every visible `select` sits in a `.tsel`
//      (`components/TouchSelect.tsx`) and computes opacity 0; its `.tsel-face`
//      is visible, 12px and 28px tall; the select covers the face, left and
//      right within 1px, at least 5px above and below, at least 40px tall; with
//      the control scrolled to the centre, the face's centre hits the select;
//      and the face's text is the selected option's.
//   7. THE TOUCH TARGETS (HO 816) — in every bar (`BAR_SELECTOR`), each control
//      scrolled to the centre first: a hit 4px past the top and the bottom of
//      every segment and checkbox label lands on it (the slop), and a hit 2px
//      inside the top and the bottom of every control in the bar lands on that
//      control (no cover; a select answers as itself or its `.tsel`). Each slug
//      with a bar holds at least `BAR_MINIMUMS`' counts, so a bar where the
//      probe found nothing can't pass. Each cell logs its bar's box and rows.
//
// THE FOLD CELLS (HO 817), on the three `FOLD_ROUTES` at the same two
// viewports, after the cells above. F1 is hard; the rest are soft.
//   F1. THE PAGE AND THE EMULATION, as readings 1 and 2, and reduced motion
//       read back: it pins the dashboard's cycling sync time, which otherwise
//       changes the open masthead's height under F6 (the note at the fold's
//       describes).
//   F2. HIDE, OPEN — exactly one visible `.mh-hide`, 28px tall, its top 8px
//       below its masthead `header`'s, its right edge on the header's (16px in
//       on an inner page, 8 at 700 wide or less); a hit 4px past its top and
//       its bottom lands on it; and no visible text line in the header, read as
//       `Range` rects of its text nodes, overlaps it by more than 1px.
//   F3. A TAP ON HIDE — `html[data-masthead="folded"]` and the stored key;
//       the 44px `.mh-strip` shown and the header 46 or less; the path and the
//       nav hidden; SHOW's centre within 21px of HIDE's; the strip's label is
//       the path's last segment; no sideways scroll.
//   F4. THE MENU — the strip's toggle opens the drawer from the strip's foot,
//       holding the nav's links, and a second tap closes it. HO 818: every
//       `.mobile-nav-icon` is a text glyph, with no `\p{Extended_Pictographic}`
//       code point and no U+FE0F, so no platform swaps in a colour emoji; the
//       log prints the glyphs (`icons=`).
//   F5. A RELOAD — the attribute is on `html` when domcontentloaded returns,
//       and the strip is shown after the load.
//   F6. A TAP ON SHOW — the attribute and the key are gone, the header is its
//       open height again and HIDE is back. HO 818: the menu is opened first,
//       as F4 opens it, and after SHOW no `.mobile-nav-drawer` is in the
//       document (`menu-after-show=gone`).
//   F7. A TAP ON HIDE AGAIN (HO 818), at its centre read fresh — the masthead
//       folds, the strip is shown, its toggle reads `aria-expanded="false"`
//       and no `.mobile-nav-drawer` is in the document (`menu-after-hide=
//       closed`).
// Logged, not asserted: `document.fullscreenEnabled`, whether full screen was
// set after F3's tap, and whether the strip drew FULL. Chromium's emulation
// isn't Chrome on a phone. Vercel's Preview toolbar is hidden before HIDE is
// probed and again after the reload, as at reading 7.
// Three FINE-POINTER cells at 1440 store the fold before the page loads and
// read that the attribute is set (the row reached the boot script), that the
// pointer is fine, and that neither HIDE nor the strip is drawn while the path
// is.
//
// THE ZONE CELLS (HO 818), on the three `FOLD_ROUTES` at 390, 412 and 851, with
// motion on. The masthead's sync time cycles five zones, 4 s each
// (`lib/zone-cycle.ts`), and a zone's text can be wider than another's. The
// page's clock is Playwright's, installed before the load, paused 1 s into
// slot ET and stepped 4 s a slot.
//   Z1. THE PAGE AND THE EMULATION, hard: 2xx on the route's path, `pointer:
//       coarse`, `innerWidth` the viewport's, and reduced motion NOT matching.
//   Z2. In each slot in order (ET, CT, MT, PT, UTC), soft: the masthead's sync
//       line shows exactly one time-and-zone token, the slot's; the
//       `.masthead-clock` after it sits where it sat in slot ET, left and top
//       within 1px; and the masthead `header` is slot ET's height within 1px.
// One log line a cell: the five tokens, the clock's five positions and the
// five heights.
//
// WHAT ITS ZERO MEANS (method.md § Gates). On the nine `TOUCH_ROUTES` at two
// viewports, under Chromium's touch emulation, no visible text-entry control
// computes under 16px and no page scrolls sideways. IT SAYS NOTHING ABOUT iOS
// SAFARI'S ZOOM ITSELF: 16px is the size below which Safari zooms the page when
// a control takes focus, and no gate here can run Safari, so that half is read
// on a phone. Nor does it read a route off the list. A text-entry control on a
// page whose pathname is off the list is the narrow spec's to catch: it asserts
// on every route at every width that a page rendering one lands on a
// `TOUCH_ROUTES` pathname. THAT CHECK IS PER PATHNAME, so a query variant of a
// listed page (`/electoral?cycle=2028`, a distinct render) is read by neither
// spec unless its own slug is on the list.
// AND SINCE HO 816: on the routes with a bar, under the same emulation, every
// filter select is drawn as a 12px face with the select covering it, every
// segment and checkbox label answers a hit 4px past its edges, and no control
// in a bar is covered 2px inside its own. IT SAYS NOTHING ABOUT A PHONE'S OWN
// PICKER OPENING on that tap, or about a route without a bar; a phone reads the
// picker (backlog, HO 816).
// AND SINCE HO 817: under Chromium's touch emulation, on the three fold routes
// at two viewports, HIDE stands clear of the title, folds the masthead and
// unfolds it, and the fold survives a reload; a fine pointer draws none of it,
// even with the fold stored. IT SAYS NOTHING ABOUT CHROME'S OWN BAR GOING on a
// phone, keeping gone through CT's links, or Android's back gesture; the Fold
// reads those (backlog, HO 817).
// AND SINCE HO 818: under the same emulation, on the three fold routes, the
// drawer's icons are text glyphs, and SHOW and HIDE each leave the menu closed;
// and on those routes at 390, 412 and 851, nothing after the sync time moves
// and the masthead keeps its height while the zone cycles. IT SAYS NOTHING
// ABOUT A WIDTH IT DOESN'T READ, about `WelcomeClock`'s own width (its time is
// 10 or 11 characters across the day, read here at one), or about how a phone's
// font draws a glyph; a phone reads the icons.
//
// THE TWO VIEWPORTS. 390 x 844 at DPR 3 is the iPhone 12-to-14 screen in
// Playwright's device table, and 390 is a width the narrow gate already reads.
// 851 x 728 at DPR 2.4375 is Corey's Pixel 10 Pro Fold, open; the second
// describe carries the reading.
//
// THE CONTROL IS THE HISTORY, NOT A PLANT. Run against prod at `e517d37` on
// 2026-11-13 (16:58Z, 9:58 AM MST), before the fix and before the meta, this
// spec was RED on all 18 cells. Every cell was red on the colour: no page
// carried a `theme-color` meta. Sixteen were red on the controls, the same
// thirteen controls at each viewport: `/bills` two selects at 12px and the
// search box at 13px; `/members` two selects at 12px and the search box at
// 14px; `/stale` one select at 12px and the search box at 13px; `/changes`
// 13px; `/search` and `/search?q=appropriations` 14px; `/lobbying` 12px;
// `/electoral` 13px. `/welcome` read 17px, by its own rule, and was red on the
// colour alone. A gate seen failing on live data needs no synthetic leg.
// WHAT THAT RUN DID NOT SHOW RED: assertions 1, 2 and 4. No cell scrolled
// sideways (over=0 on all 18), so the width assertion here is unproven by
// history; its idiom is the narrow gate's, which was. Assertion 2's control is
// STEP 0's read with the options off, quoted above.
// READINGS 6 AND 7 HAVE THE SAME KIND OF CONTROL. Run against prod at `921c371`
// on 2026-11-14 (21:23Z, 2:23 PM MST), before HO 816's change, this spec was
// RED on ten cells and green on eight. Reading 6 was red on /bills (two
// selects), /members (two) and /stale (one) at both viewports: no select sat in
// a `.tsel`. Reading 7 was red on those three and on /changes and /lobbying at
// both: every segment and checkbox label missed both slop probes (a hit 4px
// past its edge landed on the bar), 44 misses a viewport. No cover probe
// missed and no bar fell short of its minimums, so the cover probe and the
// minimums are unproven by history. The four routes without a bar were green.
// THE FOLD CELLS' CONTROL, the same kind. Run against prod at `fa12cde` on
// 2026-11-15 (00:23Z, 5:23 PM MST Nov 14), before HO 817's change, the nine
// fold cells were RED, each on one reading. The six touch cells were red on
// F2, `0 visible .mh-hide, not 1`, so F3 to F6 were never read; their open
// mastheads read 303.5 and 236 on `/`, 307 and 221.5 on `/changes`, 307 and
// 189 on `/bill/119-s-2` (390, 851). The three fine-pointer cells were red on
// the attribute (`html data-masthead is null`), since the boot script had no
// masthead row; HIDE and the strip weren't drawn and the path was. So F3 to
// F6 are unproven by history, as the width reading above is.
// HO 818'S READINGS HAVE THE SAME KIND OF CONTROL. Run against prod at
// `fd60184` on 2026-11-15 (18:10Z, 11:10 AM MST), before HO 818's change:
// - the six touch fold cells were RED on F4, F6 and F7 and green on F2, F3 and
//   F5. F4 read `the drawer's icons draw as emoji: 👥 (Members), 🗳
//   (Electoral)`; F6 `a .mobile-nav-drawer is still in the document after
//   SHOW`; F7 `the strip's toggle reads aria-expanded="true"` and the drawer
//   in the document;
// - the three fine-pointer cells were green, unchanged;
// - the zone cells were RED at 412 and 851, all six on the clock's left: that
//   day's sync read `1:00 PM ET | 12:00 PM CT | 11:00 AM MT | 10:00 AM PT |
//   6:00 PM UTC`, so slot ET's token was a character shorter than the other
//   four's and the clock sat 7.1px further right in CT, MT, PT and UTC. No
//   header moved. Which slot is wide follows the sync's hour. At 390 the three
//   were GREEN: the clock starts its own line there, and the header held 320 on
//   `/` and 307 on the inner pages in every slot. So the zone cells' height
//   reading is unproven by history at these three widths.
//
// NO SCREENSHOTS AND NO COLLECTORS, as in the narrow spec: one log line a
// cell, and one navigation a cell but for the fold's touch cells, which reload
// once (15 documents a run for the nine, and 9 for the nine zone cells).
// Untagged, so `e2e-prod` runs it on every trigger.
import { expect, test } from "@playwright/test";
import { FOLD_ROUTES, TEXT_ENTRY_SELECTOR, TOUCH_ROUTES } from "./routes";

const BASE_URL =
  process.env.BASE_URL ?? "https://congressional-terminal-chi-silk.vercel.app";
// The same idiom as smoke / odds-off / narrow, copied rather than shared: it is
// one line, and the near-miss helpers stay per-spec.
const GATE_COOKIE = { name: "ct_seen", value: "1", url: BASE_URL };

// The narrow gate's 1px subpixel tolerance, for the same reason.
const TOLERANCE = 1;
// The size under which iOS Safari zooms the page on focus. The reason for the
// number is Safari's; this spec measures the number and not the zoom.
const MIN_FONT_PX = 16;

// HO 816 — A BAR is a filter strip holding the controls: `.mc-fbar` (/bills,
// /members, /lobbying) or the `<section class="filter-chips">` of /stale and
// /changes. The bare `.filter-chips` class also names the topic chips' own row
// and NewsFilters' rows, which hold no select, segment or checkbox, so the
// section is what's read.
const BAR_SELECTOR = ".mc-fbar, section.filter-chips";
// The face (reading 6): what a touch device draws over its hidden select.
const FACE_PX = 12;
const FACE_TALL = 28;
// The select covers the face by at least this much above and below, and is at
// least this tall: a 28px face answers a 40px touch.
const FACE_COVER = 5;
const SELECT_TALL = 40;
// The touch targets (reading 7): a hit this far past a segment's or a checkbox
// label's top and bottom edge must still land on it, and a hit this far inside
// any control's edge must land on that control and not on a neighbour's slop.
const SLOP_PX = 4;
const INSET_PX = 2;
// The minimums a slug, so a bar where the probe found nothing can't pass. The
// counts are what each bar renders at HO 816 with no filters set.
const BAR_MINIMUMS: Record<string, { segments: number; checks: number; selects: number }> = {
  bills: { segments: 3, checks: 1, selects: 2 },
  members: { segments: 6, checks: 1, selects: 2 },
  stale: { segments: 3, checks: 2, selects: 1 },
  changes: { segments: 3, checks: 1, selects: 0 },
  lobbying: { segments: 2, checks: 0, selects: 0 },
};

// HO 817 — THE FOLD (readings F1 to F6). HIDE is a 28px button 8px below its
// masthead's top, on its right edge: the `header`'s right on the dashboard, and
// 16px in on an inner page (8 on a phone, 700 wide or less). Folded, the strip
// is 44px and the `header` 46 or less, and SHOW's centre lands within 21px of
// HIDE's. `FOLD_KEY` is `lib/prefs.ts`' masthead row, written out here so a
// renamed key reds rather than following.
const FOLD_KEY = "cbt:pref:masthead";
const HIDE_TALL = 28;
const HIDE_TOP = 8;
const STRIP_TALL = 44;
const FOLDED_MAX = 46;
const SHOW_NEAR = 21;
const PHONE_MAX = 700;
// HO 818 — a nav icon is a text glyph: no code point a platform may draw as a
// colour emoji. U+FE0F asks for the emoji form of the code point before it.
const EMOJI = /\p{Extended_Pictographic}|️/u;

// HO 818 — THE ZONE CELLS. `T0` is a whole minute, so the sync time's slot 0 (ET)
// starts on it (`lib/zone-cycle.ts`: the slot is `floor(now / 4000) % 5`, and a
// minute is fifteen slots), and the masthead's own clock (`WelcomeClock`, pinned
// to MT) reads 12:00:0x PM through all five slots, one width. A time-and-zone
// token is the cycling stamp's shape; the lookbehind keeps `WelcomeClock`'s
// `12:00:05 PM MT` out of it.
const ZONE_T0 = Date.UTC(2026, 10, 16, 19, 0, 0);
const ZONE_SLOTS = ["ET", "CT", "MT", "PT", "UTC"] as const;
const ZONE_TOKEN = /(?<![\d:])\d{1,2}:\d{2} [AP]M (?:ET|CT|MT|PT|UTC)\b/g;

// `e2e/narrow.spec.ts`'s OVER_EDGE, copied as the near-miss helpers are: every
// element whose right edge passes clientWidth, deepest first, unclipped before
// clipped, with the computed values that usually explain it.
//
// ONE DIFFERENCE FROM THE ORIGINAL, AND IT IS DELIBERATE. This is a template
// string, so the whitespace class in the two class-name splits is written with
// a doubled backslash here, to reach the page with one. The narrow spec's copy
// writes a single backslash, which a template string drops, so in the page its
// splits run on the letter `s` and not on whitespace (filed in the backlog at
// HO 815, not fixed in that file). Until it is, the two specs name the same
// element differently in a red log.
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
          ? '.' + a.className.trim().split(/\\s+/)[0] : '';
        clip = a.tagName.toLowerCase() + acls + '(' + ax + ')';
        break;
      }
    }
    const cls = typeof el.className === 'string' && el.className
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.')
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

type Control = { k: string; px: number };

function cells(tag: string, width: number) {
  for (const route of TOUCH_ROUTES) {
    test(`${route.slug} (${route.path}) touch @${tag}`, async ({ page, context }) => {
      await context.addCookies([GATE_COOKIE]);

      const response = await page.goto(route.path, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      // The narrow spec's waits, verbatim: the markets tape polls, so
      // `networkidle` never fires and a fixed settle is the pragmatic choice.
      await page.waitForLoadState("load").catch(() => {});
      await page.waitForTimeout(2_500);

      // ONE READ, TAKEN BEFORE ANY ASSERTION, so a red cell still logs every
      // number: claim 9's red on prod was read off these lines.
      const read = await page.evaluate((selector) => {
        const root = document.documentElement;
        const controls = Array.from(document.querySelectorAll<HTMLElement>(selector))
          .filter((el) => {
            // `checkVisibility`, not a bounding box alone: a closed <details>
            // hides its body with `content-visibility` and its children still
            // report a rect. The box is read too, for a control collapsed to
            // nothing.
            if (!el.checkVisibility({ visibilityProperty: true })) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((el) => {
            const own =
              typeof el.className === "string" && el.className.trim()
                ? "." + el.className.trim().split(/\s+/)[0]
                : "";
            // A class-less control is named by its parent, or the cartogram's
            // and the lobby's inputs would both read as a bare `input`.
            const p = el.parentElement;
            const from =
              own || !p
                ? ""
                : "<" +
                  p.tagName.toLowerCase() +
                  (typeof p.className === "string" && p.className.trim()
                    ? "." + p.className.trim().split(/\s+/)[0]
                    : "");
            return {
              k: el.tagName.toLowerCase() + own + from,
              px: parseFloat(getComputedStyle(el).fontSize),
            };
          });
        const meta = document.querySelector('meta[name="theme-color"]');
        return {
          coarse: matchMedia("(pointer: coarse)").matches,
          inner: window.innerWidth,
          s: root.scrollWidth,
          c: root.clientWidth,
          url: location.pathname + location.search,
          controls,
          theme: meta ? (meta.getAttribute("content") ?? "") : null,
          bgBase: getComputedStyle(root).getPropertyValue("--bg-base"),
        };
      }, TEXT_ENTRY_SELECTOR);

      // THE SECOND READ, readings 6 and 7 (HO 816). It scrolls each control to
      // the centre of the viewport before it probes, so it runs after the read
      // above and still before any assertion.
      const probe = await page.evaluate(
        ({ barSelector, textEntry, k }) => {
          // VERCEL'S PREVIEW TOOLBAR IS NOT THE PAGE. A Preview deployment
          // injects it as a fixed overlay (`vercel-live-feedback`, a custom
          // element), and with a control scrolled to the centre at 390 it sits
          // over the right-most chips: the ref's first narrow-preview run
          // (43645333005, HO 816) read 14 misses on it at 390, 5 on /changes
          // and 9 on /stale, one of them a slop probe. Production doesn't inject it (claim 10's probes on prod hit
          // the same chips). So every `vercel-*` element is hidden before the
          // probe, and the log says how many were.
          let toolbar = 0;
          for (const el of Array.from(document.querySelectorAll("*"))) {
            if (el.tagName.startsWith("VERCEL-")) {
              (el as HTMLElement).style.setProperty("display", "none", "important");
              toolbar++;
            }
          }
          const visible = (el: Element) => {
            if (!(el as HTMLElement).checkVisibility({ visibilityProperty: true })) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const text = (el: Element | null | undefined) =>
            (el?.textContent ?? "").replace(/\s+/g, " ").trim();
          const name = (el: Element | null) => {
            if (!el) return "nothing";
            const tag = el.tagName.toLowerCase();
            if (tag === "select") {
              const s = el as HTMLSelectElement;
              return `select(${s.getAttribute("aria-label") ?? text(s.selectedOptions[0])})`;
            }
            if (tag === "a" || tag === "button" || tag === "label") return `${tag}(${text(el).slice(0, 24)})`;
            const cls =
              typeof el.className === "string" && el.className.trim()
                ? "." + el.className.trim().split(/\s+/)[0]
                : "";
            return tag + cls;
          };
          const centre = (el: Element) => el.scrollIntoView({ block: "center", inline: "nearest" });

          // 6. THE FACE, on every visible select.
          const faceMisses: string[] = [];
          let faces = 0;
          const selects = Array.from(document.querySelectorAll("select")).filter(visible);
          for (const sel of selects) {
            const tsel = sel.closest(".tsel");
            if (!tsel) {
              faceMisses.push(`${name(sel)}: not inside a .tsel`);
              continue;
            }
            const fails: string[] = [];
            const opacity = getComputedStyle(sel).opacity;
            if (opacity !== "0") fails.push(`opacity ${opacity}`);
            const face = tsel.querySelector(":scope > .tsel-face");
            if (!face || !visible(face)) {
              faceMisses.push(`${name(sel)}: ${[...fails, "no visible .tsel-face"].join(", ")}`);
              continue;
            }
            faces++;
            centre(sel);
            const f = face.getBoundingClientRect();
            const s = sel.getBoundingClientRect();
            const px = parseFloat(getComputedStyle(face).fontSize);
            if (px !== k.facePx) fails.push(`face ${px}px`);
            if (Math.abs(f.height - k.faceTall) > 0.5) fails.push(`face ${f.height}px tall`);
            if (Math.abs(s.left - f.left) > 1 || Math.abs(s.right - f.right) > 1)
              fails.push(`select x ${s.left}-${s.right} vs face ${f.left}-${f.right}`);
            if (f.top - s.top < k.cover) fails.push(`select top ${f.top - s.top}px above the face`);
            if (s.bottom - f.bottom < k.cover) fails.push(`select bottom ${s.bottom - f.bottom}px below the face`);
            if (s.height < k.selectTall) fails.push(`select ${s.height}px tall`);
            const hit = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2);
            if (hit !== sel) fails.push(`the face's centre hits ${name(hit)}`);
            const faceText = text(face.querySelector(":scope > span")).toUpperCase();
            const optText = text(sel.selectedOptions[0]).toUpperCase();
            if (faceText !== optText) fails.push(`face "${faceText}" vs option "${optText}"`);
            if (fails.length) faceMisses.push(`${name(sel)}: ${fails.join(", ")}`);
          }

          // 7. THE TOUCH TARGETS, in every bar.
          const bars = Array.from(document.querySelectorAll(barSelector)).filter(visible);
          const boxes: string[] = [];
          const targetMisses: string[] = [];
          const found = { segments: 0, checks: 0, selects: 0 };
          let targets = 0;
          for (const bar of bars) {
            // The box and the rows, read before any scroll moves the page. A
            // display:contents wrapper (the face's, under a fine pointer) is
            // read through to its children.
            const items: DOMRect[] = [];
            const walk = (el: Element) => {
              for (const ch of Array.from(el.children)) {
                if (getComputedStyle(ch).display === "contents") walk(ch);
                else if (visible(ch)) items.push(ch.getBoundingClientRect());
              }
            };
            walk(bar);
            items.sort((a, b) => a.top - b.top);
            let rows = 0;
            let rowBottom = -Infinity;
            for (const r of items) {
              if (r.top >= rowBottom - 0.5) {
                rows++;
                rowBottom = r.bottom;
              } else rowBottom = Math.max(rowBottom, r.bottom);
            }
            const b = bar.getBoundingClientRect();
            boxes.push(`${Math.round(b.width)}x${Math.round(b.height * 10) / 10} rows=${rows}`);

            const segs = Array.from(bar.querySelectorAll('[role="group"] > a')).filter(visible);
            const checks = Array.from(bar.querySelectorAll("label")).filter(
              (l) => l.querySelector('input[type="checkbox"]') && visible(l),
            );
            const sels = Array.from(bar.querySelectorAll("select")).filter(visible);
            const inputs = Array.from(bar.querySelectorAll(textEntry)).filter(
              (el) => el.tagName !== "SELECT" && visible(el),
            );
            const others = Array.from(bar.querySelectorAll("a, button")).filter(
              (el) => !segs.includes(el) && visible(el),
            );
            found.segments += segs.length;
            found.checks += checks.length;
            found.selects += sels.length;

            const answers = (el: Element, hit: Element | null) => {
              if (!hit) return false;
              if (el.tagName === "SELECT") return hit === el || hit === el.closest(".tsel");
              return el.contains(hit);
            };
            const at = (el: Element, where: string, y: (r: DOMRect) => number) => {
              centre(el);
              const r = el.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, y(r));
              if (!answers(el, hit)) targetMisses.push(`${name(el)} ${where} hits ${name(hit)}`);
            };
            for (const el of [...segs, ...checks]) {
              at(el, `${k.slop}px above`, (r) => r.top - k.slop);
              at(el, `${k.slop}px below`, (r) => r.bottom + k.slop);
            }
            for (const el of [...segs, ...checks, ...sels, ...inputs, ...others]) {
              targets++;
              at(el, `${k.inset}px inside the top`, (r) => r.top + k.inset);
              at(el, `${k.inset}px inside the bottom`, (r) => r.bottom - k.inset);
            }
          }
          return { faces, selects: selects.length, faceMisses, bars: boxes, found, targets, targetMisses, toolbar };
        },
        {
          barSelector: BAR_SELECTOR,
          textEntry: TEXT_ENTRY_SELECTOR,
          k: {
            facePx: FACE_PX,
            faceTall: FACE_TALL,
            cover: FACE_COVER,
            selectTall: SELECT_TALL,
            slop: SLOP_PX,
            inset: INSET_PX,
          },
        },
      );
      const minimum = BAR_MINIMUMS[route.slug];
      const shortfalls: string[] = [];
      if (minimum) {
        if (probe.bars.length === 0) shortfalls.push("no bar");
        for (const key of ["segments", "checks", "selects"] as const) {
          if (probe.found[key] < minimum[key])
            shortfalls.push(`${key} ${probe.found[key]} of at least ${minimum[key]}`);
        }
      }

      const controls: Control[] = read.controls;
      const over = read.s - read.c;
      const min = controls.length ? Math.min(...controls.map((c) => c.px)) : null;
      const under = controls.filter((c) => !(c.px >= MIN_FONT_PX));
      const theme = read.theme === null ? null : read.theme.trim().toLowerCase();
      const bgBase = read.bgBase.trim().toLowerCase();
      const culprits =
        over > TOLERANCE ? ((await page.evaluate(OVER_EDGE)) as string[]) : [];
      const listed = controls.map((c) => `${c.k}=${c.px}px`).join(" | ");

      // eslint-disable-next-line no-console
      console.log(
        `[touch ${tag} ${route.slug}] coarse=${read.coarse} inner=${read.inner}` +
          ` controls=${controls.length} min=${min === null ? "none" : `${min}px`}` +
          ` scroll=${read.s}/${read.c} over=${over} theme=${theme ?? "none"}` +
          ` faces=${probe.faces} targets=${probe.targets} miss=${probe.targetMisses.length}` +
          ` bar=${probe.bars.length ? probe.bars.join(" + ") : "none"}` +
          (probe.toolbar ? ` vercel-toolbar-hidden=${probe.toolbar}` : "") +
          (probe.faceMisses.length
            ? `\n    face: ${probe.faceMisses.join("\n          ")}`
            : "") +
          (probe.targetMisses.length
            ? `\n    miss: ${probe.targetMisses.join("\n          ")}`
            : "") +
          (shortfalls.length ? `\n    short: ${shortfalls.join(" | ")}` : "") +
          (under.length
            ? `\n    under ${MIN_FONT_PX}px: ${under.map((c) => `${c.k}=${c.px}px`).join(" | ")}`
            : "") +
          (culprits.length
            ? `\n    over-edge: ${culprits.join("\n               ")}`
            : ""),
      );

      // 1. THE PAGE. Hard, as is the emulation below: every reading after them
      // is only worth the page and the device it was taken on.
      const status = response?.status() ?? 0;
      expect(
        status,
        `${route.path} did not answer 2xx (status ${status}) — an error page ` +
          `has no text-entry control and no overflow to read`,
      ).toBeGreaterThanOrEqual(200);
      expect(status, `${route.path} answered ${status}, not 2xx`).toBeLessThan(300);
      const landedPath = read.url.split("?")[0];
      const ownPath = route.path.split("?")[0];
      expect(
        landedPath,
        `${route.path} landed on ${read.url}, not ${ownPath} — everything ` +
          `below was read on a different page than the one named`,
      ).toBe(ownPath);

      // 2. THE EMULATION, read inside the page.
      expect(
        read.coarse,
        `${route.path} @${tag}: matchMedia('(pointer: coarse)') is false inside ` +
          `the page — the context is not a touch device, so a rule under that ` +
          `media query is not what this cell read`,
      ).toBe(true);
      expect(
        read.inner,
        `${route.path} @${tag}: innerWidth is ${read.inner}, not the ` +
          `viewport's ${width}`,
      ).toBe(width);

      // 3 to 5 are SOFT, so one red cell reports every reading that failed
      // rather than its first. They still fail the test.
      //
      // 3. THE CONTROLS.
      expect
        .soft(
          controls.length,
          `${route.path} @${tag} renders no visible text-entry control — a ` +
            `TOUCH_ROUTES route exists to carry one. If the control left this ` +
            `page, take its slug out of TOUCH_SLUGS (e2e/routes.ts)`,
        )
        .toBeGreaterThanOrEqual(1);
      expect
        .soft(
          under.map((c) => `${c.k}=${c.px}px`),
          `${route.path} @${tag}: ${under.length} of ${controls.length} ` +
            `text-entry controls compute under ${MIN_FONT_PX}px on a touch ` +
            `device, where iOS Safari zooms the page on focus — ${listed}. A ` +
            `new control takes the selector list under \`@media (pointer: ` +
            `coarse)\` in app/globals.css`,
        )
        .toEqual([]);

      // 4. THE WIDTH.
      expect
        .soft(
          read.s,
          `${route.path} scrolls horizontally on a touch device at ${tag} ` +
            `(scrollWidth ${read.s} vs clientWidth ${read.c}, over ${over}px) — ` +
            `over-edge: ${culprits.join(" | ") || "none captured"}`,
        )
        .toBeLessThanOrEqual(read.c + TOLERANCE);

      // 5. THE COLOUR. `--bg-base` must itself read as something, or an empty
      // token and an empty `content` would agree with each other.
      expect
        .soft(bgBase, `${route.path}: --bg-base computes empty on :root`)
        .not.toBe("");
      expect
        .soft(
          theme,
          `${route.path}: meta[name="theme-color"] is ` +
            `${theme === null ? "absent" : JSON.stringify(theme)} and --bg-base ` +
            `computes ${JSON.stringify(bgBase)} — app/layout.tsx's ` +
            `\`viewport.themeColor\` is a literal that has to follow the token ` +
            `(app/globals.css)`,
        )
        .toBe(bgBase);

      // 6. THE FACE (HO 816).
      expect
        .soft(
          probe.faceMisses,
          `${route.path} @${tag}: ${probe.faceMisses.length} of ${probe.selects} ` +
            `visible selects aren't drawn as a face on a touch device — each ` +
            `filter select renders through components/TouchSelect.tsx, and the ` +
            `face's rules sit under \`@media (pointer: coarse)\` in app/globals.css`,
        )
        .toEqual([]);

      // 7. THE TOUCH TARGETS (HO 816).
      expect
        .soft(
          shortfalls,
          `${route.path} @${tag}: the bar holds fewer controls than its ` +
            `minimums (BAR_MINIMUMS), so the probes below read too little to pass`,
        )
        .toEqual([]);
      expect
        .soft(
          probe.targetMisses,
          `${route.path} @${tag}: ${probe.targetMisses.length} touch probes in ` +
            `the bar missed their control — a segment or a checkbox label answers ` +
            `${SLOP_PX}px past its edges, and no control is covered ${INSET_PX}px ` +
            `inside its own`,
        )
        .toEqual([]);
    });
  }
}

test.describe("touch @390", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    storageState: { cookies: [], origins: [] },
  });
  cells("390", 390);
});

// THE FOLD, OPEN. Corey's reading of his Pixel 10 Pro Fold, open, in an in-app
// browser tab on whatismyviewport.com, 9:28 AM MST on 2026-11-13: viewport
// 851 x 728, DPR 2.44, screen 852 x 883. 2.4375 is the handoff's figure for
// that DPR (39/16); the page printed two decimals.
test.describe("touch @851", () => {
  test.use({
    viewport: { width: 851, height: 728 },
    deviceScaleFactor: 2.4375,
    hasTouch: true,
    isMobile: true,
    storageState: { cookies: [], origins: [] },
  });
  cells("851", 851);
});

// HO 817 — THE FOLD CELLS (readings F1 to F6; F7 since HO 818). One navigation
// and one reload a cell, one log line a cell. Every read is taken and every tap made before any
// assertion, so a red cell still logs every number. A step whose control isn't
// there is skipped only where an earlier reading already failed, and the log
// says what wasn't read; a skipped step can't turn a cell green.
type FoldBox = { l: number; t: number; r: number; b: number; w: number; h: number };

function foldCells(tag: string, width: number) {
  for (const route of FOLD_ROUTES) {
    test(`${route.slug} (${route.path}) fold @${tag}`, async ({ page, context }) => {
      await context.addCookies([GATE_COOKIE]);
      const response = await page.goto(route.path, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForLoadState("load").catch(() => {});
      await page.waitForTimeout(2_500);

      const settleTap = () => page.waitForTimeout(400);
      // VERCEL'S PREVIEW TOOLBAR IS NOT THE PAGE, as at reading 7: every
      // `vercel-*` element is hidden before HIDE is probed or tapped, and again
      // after the reload, and the log says how many were.
      const hideToolbar = () =>
        page.evaluate(() => {
          let n = 0;
          for (const el of Array.from(document.querySelectorAll("*"))) {
            if (el.tagName.startsWith("VERCEL-")) {
              (el as HTMLElement).style.setProperty("display", "none", "important");
              n++;
            }
          }
          return n;
        });
      let toolbar = await hideToolbar();
      // HIDE's right edge sits on the dashboard `header`'s right, and 16px in
      // on an inner page's (8 at 700 wide or less).
      const inset = route.slug === "home" ? 0 : width > PHONE_MAX ? 16 : 8;
      const f2: string[] = [];
      const f3: string[] = [];
      const f4: string[] = [];
      const f5: string[] = [];
      const f6: string[] = [];
      const f7: string[] = [];
      const skipped: string[] = [];

      // F1 AND F2, ONE READ. The masthead is the `header` holding the
      // breadcrumb path, so it is found the same way with HIDE or without.
      const open = await page.evaluate(() => {
        const visible = (el: Element | null | undefined): el is HTMLElement => {
          if (!el || !(el as HTMLElement).checkVisibility({ visibilityProperty: true })) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const box = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
        };
        const name = (el: Element | null) => {
          if (!el) return "nothing";
          const cls =
            typeof el.className === "string" && el.className.trim()
              ? "." + el.className.trim().split(/\s+/)[0]
              : "";
          return el.tagName.toLowerCase() + cls;
        };
        const header = document.querySelector(".breadcrumb-path")?.closest("header") ?? null;
        const hides = Array.from(document.querySelectorAll(".mh-hide")).filter(visible);
        const hide = hides.length === 1 ? (hides[0] as HTMLElement) : null;
        const labels = header ? Array.from(header.querySelectorAll(".breadcrumb-seg-label")) : [];
        const out = {
          coarse: matchMedia("(pointer: coarse)").matches,
          inner: window.innerWidth,
          url: location.pathname + location.search,
          header: header ? box(header) : null,
          hides: hides.length,
          hide: hide ? box(hide) : null,
          hideInHeader: !!(hide && header && header.contains(hide)),
          slop: [] as string[],
          overlaps: [] as string[],
          clear: null as number | null,
          lastLabel: (labels[labels.length - 1]?.textContent ?? "").trim(),
          navLinks: header ? header.querySelectorAll(".primary-nav a").length : 0,
          fsEnabled: document.fullscreenEnabled,
          reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
        };
        if (hide && header) {
          const h = hide.getBoundingClientRect();
          const cx = h.left + h.width / 2;
          for (const [where, y] of [
            ["4px above", h.top - 4],
            ["4px below", h.bottom + 4],
          ] as const) {
            const hit = document.elementFromPoint(cx, y);
            if (!hit || !hide.contains(hit)) out.slop.push(`${where} hits ${name(hit)}`);
          }
          // The text lines, as Range client rects of the header's visible text
          // nodes outside the button. A line overlapping HIDE's box by more than
          // 1px each way is a miss; the clearance is the least gap between
          // HIDE's left and the right of a line beside it.
          const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
          const range = document.createRange();
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const p = n.parentElement;
            if (!p || !(n.textContent ?? "").trim() || hide.contains(p) || !visible(p)) continue;
            range.selectNodeContents(n);
            for (const r of Array.from(range.getClientRects())) {
              if (r.width === 0 || r.height === 0) continue;
              const ox = Math.min(r.right, h.right) - Math.max(r.left, h.left);
              const oy = Math.min(r.bottom, h.bottom) - Math.max(r.top, h.top);
              if (oy <= 0) continue;
              const gap = h.left - r.right;
              if (out.clear === null || gap < out.clear) out.clear = gap;
              if (ox > 1 && oy > 1)
                out.overlaps.push(`"${(n.textContent ?? "").trim().slice(0, 24)}" ${Math.round(ox)}x${Math.round(oy)}`);
            }
          }
        }
        return out;
      });

      if (!open.hide || !open.header) {
        f2.push(`${open.hides} visible .mh-hide, not 1${open.header ? "" : ", and no masthead header"}`);
      } else {
        const hb = open.hide;
        if (Math.abs(hb.h - HIDE_TALL) > 1) f2.push(`HIDE ${hb.h}px tall`);
        if (Math.abs(hb.t - open.header.t - HIDE_TOP) > 1)
          f2.push(`HIDE's top ${hb.t - open.header.t}px below the header's`);
        if (Math.abs(open.header.r - inset - hb.r) > 1)
          f2.push(`HIDE's right ${open.header.r - hb.r}px in from the header's, not ${inset}`);
        if (!open.hideInHeader) f2.push("HIDE isn't inside the masthead's header");
        f2.push(...open.slop.map((s) => `slop ${s}`));
        f2.push(...open.overlaps.map((s) => `a text line overlaps HIDE: ${s}`));
      }

      // F3. A TAP ON HIDE, at its centre.
      let folded: {
        attr: string | null;
        stored: string | null;
        strip: FoldBox | null;
        headerH: number | null;
        pathVisible: boolean;
        navVisible: boolean;
        show: FoldBox | null;
        toggle: FoldBox | null;
        label: string;
        s: number;
        c: number;
        fsSet: boolean;
        full: boolean;
      } | null = null;
      if (open.hide) {
        await page.touchscreen.tap(open.hide.l + open.hide.w / 2, open.hide.t + open.hide.h / 2);
        await settleTap();
        folded = await page.evaluate((key) => {
          const visible = (el: Element | null | undefined): el is HTMLElement => {
            if (!el || !(el as HTMLElement).checkVisibility({ visibilityProperty: true })) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const box = (el: Element | null | undefined) => {
            if (!visible(el)) return null;
            const r = el.getBoundingClientRect();
            return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
          };
          const header = document.querySelector(".breadcrumb-path")?.closest("header") ?? null;
          const strip = header?.querySelector(".mh-strip");
          let stored: string | null = null;
          try {
            stored = localStorage.getItem(key);
          } catch {
            stored = "(storage threw)";
          }
          return {
            attr: document.documentElement.getAttribute("data-masthead"),
            stored,
            strip: box(strip),
            headerH: header ? header.getBoundingClientRect().height : null,
            pathVisible: visible(header?.querySelector(".breadcrumb-path")),
            navVisible: visible(header?.querySelector(".primary-nav")),
            show: box(strip?.querySelector(".mh-show")),
            toggle: box(strip?.querySelector(".mobile-nav-toggle")),
            label: (strip?.querySelector(".mh-label")?.textContent ?? "").trim(),
            s: document.documentElement.scrollWidth,
            c: document.documentElement.clientWidth,
            fsSet: document.fullscreenElement !== null,
            full: visible(strip?.querySelector(".mh-face")),
          };
        }, FOLD_KEY);
        if (folded.attr !== "folded") f3.push(`html data-masthead is ${JSON.stringify(folded.attr)}`);
        if (folded.stored !== "folded") f3.push(`${FOLD_KEY} is ${JSON.stringify(folded.stored)}`);
        if (!folded.strip) f3.push("no visible .mh-strip");
        else if (Math.abs(folded.strip.h - STRIP_TALL) > 1) f3.push(`the strip ${folded.strip.h}px tall`);
        if (folded.headerH === null || folded.headerH > FOLDED_MAX)
          f3.push(`the header ${folded.headerH}px tall folded`);
        if (folded.pathVisible) f3.push("the masthead's .breadcrumb-path is still visible");
        if (folded.navVisible) f3.push("the masthead's .primary-nav is still visible");
        if (!folded.show) f3.push("no visible .mh-show");
        else {
          const d = Math.hypot(
            folded.show.l + folded.show.w / 2 - (open.hide.l + open.hide.w / 2),
            folded.show.t + folded.show.h / 2 - (open.hide.t + open.hide.h / 2),
          );
          if (d > SHOW_NEAR) f3.push(`SHOW's centre ${d.toFixed(1)}px from HIDE's`);
        }
        if (folded.label !== open.lastLabel)
          f3.push(`the strip's label "${folded.label}" vs the masthead's last segment "${open.lastLabel}"`);
        if (folded.s > folded.c + TOLERANCE) f3.push(`scrolls sideways folded (${folded.s}/${folded.c})`);
      } else skipped.push("F3 to F6 (F2 found no single HIDE)");

      // The drawer as F4 reads it, and F6 again after the reload: its links, its
      // top against the strip's foot, and each link's icon with its label.
      const readDrawer = () =>
        page.evaluate(() => {
          const d = document.querySelector(".mh-strip .mobile-nav-drawer");
          const strip = document.querySelector(".mh-strip");
          if (!d || !strip || !(d as HTMLElement).checkVisibility()) return null;
          return {
            links: d.querySelectorAll("a").length,
            top: d.getBoundingClientRect().top,
            stripBottom: strip.getBoundingClientRect().bottom,
            icons: Array.from(d.querySelectorAll(".mobile-nav-icon")).map((el) => ({
              icon: (el.textContent ?? "").trim(),
              label: (el.nextElementSibling?.textContent ?? "").trim(),
            })),
          };
        });
      const drawerMisses = (
        d: { links: number; top: number; stripBottom: number },
      ): string[] => {
        const out: string[] = [];
        if (d.links !== open.navLinks)
          out.push(`the drawer holds ${d.links} links, the masthead's nav ${open.navLinks}`);
        if (Math.abs(d.top - d.stripBottom) > 1)
          out.push(`the drawer's top ${d.top - d.stripBottom}px from the strip's foot`);
        return out;
      };

      // F4. THE MENU: the strip's toggle opens the drawer from the strip's foot.
      // HO 818: and every icon in it is a text glyph, drawn in the link's colour:
      // no `\p{Extended_Pictographic}` code point and no U+FE0F, so no platform
      // has a colour emoji to swap in (Android drew MEMBERS and ELECTORAL as
      // emoji on Corey's Fold, Nov 15).
      let drawer: Awaited<ReturnType<typeof readDrawer>> = null;
      let drawerClosed: boolean | null = null;
      if (folded) {
        if (!folded.strip) skipped.push("F4 (F3 found no strip)");
        else if (!folded.toggle) f4.push("no visible .mobile-nav-toggle in the strip");
        else {
          const tx = folded.toggle.l + folded.toggle.w / 2;
          const ty = folded.toggle.t + folded.toggle.h / 2;
          await page.touchscreen.tap(tx, ty);
          await settleTap();
          drawer = await readDrawer();
          if (!drawer) f4.push("a tap on the strip's toggle showed no .mobile-nav-drawer");
          else {
            f4.push(...drawerMisses(drawer));
            const emoji = drawer.icons.filter((i) => EMOJI.test(i.icon));
            if (emoji.length)
              f4.push(`the drawer's icons draw as emoji: ${emoji.map((i) => `${i.icon} (${i.label})`).join(", ")}`);
          }
          await page.touchscreen.tap(tx, ty);
          await settleTap();
          drawerClosed = await page.evaluate(() => {
            const d = document.querySelector(".mh-strip .mobile-nav-drawer");
            return !d || !(d as HTMLElement).checkVisibility();
          });
          if (!drawerClosed) f4.push("a second tap left the drawer open");
        }
      }

      // F5. A RELOAD: the attribute is on `html` when domcontentloaded returns.
      let atDcl: string | null = null;
      let stripAfterLoad: boolean | null = null;
      let showAfterLoad: FoldBox | null = null;
      let toggleAfterLoad: FoldBox | null = null;
      if (folded) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
        atDcl = await page.evaluate(() => document.documentElement.getAttribute("data-masthead"));
        await page.waitForLoadState("load").catch(() => {});
        await page.waitForTimeout(2_500);
        toolbar += await hideToolbar();
        const after = await page.evaluate(() => {
          const visible = (el: Element | null | undefined): el is HTMLElement => {
            if (!el || !(el as HTMLElement).checkVisibility({ visibilityProperty: true })) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const box = (el: Element | null | undefined) => {
            if (!visible(el)) return null;
            const r = el.getBoundingClientRect();
            return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
          };
          const strip = document.querySelector(".breadcrumb-path")?.closest("header")?.querySelector(".mh-strip");
          return {
            strip: visible(strip),
            show: box(strip?.querySelector(".mh-show")),
            toggle: box(strip?.querySelector(".mobile-nav-toggle")),
          };
        });
        stripAfterLoad = after.strip;
        showAfterLoad = after.show;
        toggleAfterLoad = after.toggle;
        if (atDcl !== "folded")
          f5.push(`html data-masthead is ${JSON.stringify(atDcl)} when domcontentloaded returns`);
        if (!stripAfterLoad) f5.push("no visible .mh-strip after the load");
      }

      // F6. A TAP ON SHOW undoes the fold. HO 818: with the menu opened first,
      // as F4 opens it, so SHOW is read closing it. On Corey's Fold (Nov 15) the
      // drawer's open state survived SHOW and came back open on the next HIDE.
      let shown: {
        attr: string | null;
        stored: string | null;
        headerH: number | null;
        hide: boolean;
        drawerInDoc: boolean;
      } | null = null;
      if (folded) {
        if (!showAfterLoad) f6.push("no visible .mh-show to tap after the reload");
        else {
          if (!toggleAfterLoad) f6.push("no visible .mobile-nav-toggle in the strip after the reload");
          else {
            await page.touchscreen.tap(
              toggleAfterLoad.l + toggleAfterLoad.w / 2,
              toggleAfterLoad.t + toggleAfterLoad.h / 2,
            );
            await settleTap();
            const reopened = await readDrawer();
            if (!reopened) f6.push("after the reload, a tap on the strip's toggle showed no .mobile-nav-drawer");
            else f6.push(...drawerMisses(reopened));
          }
          await page.touchscreen.tap(showAfterLoad.l + showAfterLoad.w / 2, showAfterLoad.t + showAfterLoad.h / 2);
          await settleTap();
          shown = await page.evaluate((key) => {
            const header = document.querySelector(".breadcrumb-path")?.closest("header") ?? null;
            const hide = header?.querySelector(".mh-hide") as HTMLElement | null | undefined;
            let stored: string | null = null;
            try {
              stored = localStorage.getItem(key);
            } catch {
              stored = "(storage threw)";
            }
            return {
              attr: document.documentElement.getAttribute("data-masthead"),
              stored,
              headerH: header ? header.getBoundingClientRect().height : null,
              hide: !!hide && hide.checkVisibility() && hide.getBoundingClientRect().height > 0,
              drawerInDoc: document.querySelector(".mobile-nav-drawer") !== null,
            };
          }, FOLD_KEY);
          if (shown.attr !== null) f6.push(`html data-masthead is still ${JSON.stringify(shown.attr)}`);
          if (shown.stored !== null) f6.push(`${FOLD_KEY} is still ${JSON.stringify(shown.stored)}`);
          if (shown.headerH === null || !open.header || Math.abs(shown.headerH - open.header.h) > 1)
            f6.push(`the header ${shown.headerH}px tall shown, ${open.header?.h ?? "?"}px open`);
          if (!shown.hide) f6.push("HIDE isn't visible again");
          if (shown.drawerInDoc) f6.push("a .mobile-nav-drawer is still in the document after SHOW");
        }
      }

      // F7 (HO 818). A TAP ON HIDE AGAIN, at its centre read fresh: the masthead
      // folds with the menu closed.
      let again: {
        attr: string | null;
        strip: boolean;
        expanded: string | null;
        drawerInDoc: boolean;
      } | null = null;
      if (shown) {
        const hideNow = await page.evaluate(() => {
          const el = document.querySelector(".breadcrumb-path")?.closest("header")?.querySelector(".mh-hide");
          if (!el || !(el as HTMLElement).checkVisibility({ visibilityProperty: true })) return null;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
        });
        if (!hideNow) f7.push("no visible .mh-hide to tap after SHOW");
        else {
          await page.touchscreen.tap(hideNow.x, hideNow.y);
          await settleTap();
          again = await page.evaluate(() => {
            const strip = document.querySelector(".breadcrumb-path")?.closest("header")?.querySelector(".mh-strip");
            const r = strip?.getBoundingClientRect();
            return {
              attr: document.documentElement.getAttribute("data-masthead"),
              strip:
                !!strip &&
                (strip as HTMLElement).checkVisibility({ visibilityProperty: true }) &&
                !!r &&
                r.width > 0 &&
                r.height > 0,
              expanded: strip?.querySelector(".mobile-nav-toggle")?.getAttribute("aria-expanded") ?? null,
              drawerInDoc: document.querySelector(".mobile-nav-drawer") !== null,
            };
          });
          if (again.attr !== "folded") f7.push(`html data-masthead is ${JSON.stringify(again.attr)}`);
          if (!again.strip) f7.push("no visible .mh-strip");
          if (again.expanded !== "false")
            f7.push(`the strip's toggle reads aria-expanded=${JSON.stringify(again.expanded)}`);
          if (again.drawerInDoc) f7.push("a .mobile-nav-drawer is in the document");
        }
      } else if (folded) skipped.push("F7 (F6 tapped no SHOW)");

      const r1 = (n: number | null | undefined) => (n === null || n === undefined ? "none" : `${Math.round(n * 10) / 10}`);
      const dist =
        open.hide && folded?.show
          ? Math.hypot(
              folded.show.l + folded.show.w / 2 - (open.hide.l + open.hide.w / 2),
              folded.show.t + folded.show.h / 2 - (open.hide.t + open.hide.h / 2),
            )
          : null;
      const fails = (
        [
          ["F2", f2],
          ["F3", f3],
          ["F4", f4],
          ["F5", f5],
          ["F6", f6],
          ["F7", f7],
        ] as const
      ).filter(([, m]) => m.length);
      // eslint-disable-next-line no-console
      console.log(
        `[fold ${tag} ${route.slug}] coarse=${open.coarse} inner=${open.inner} reduce=${open.reduce}` +
          ` open=${r1(open.header?.h)} folded=${r1(folded?.headerH)}` +
          ` hide=${open.hide ? `${r1(open.hide.w)}x${r1(open.hide.h)}` : `none(${open.hides})`}` +
          ` clear=${r1(open.clear)} dist=${r1(dist)}` +
          ` drawer=${drawer ? `${drawer.links}/${open.navLinks}` : "none"}` +
          ` icons=${drawer ? drawer.icons.map((i) => i.icon).join("") : "none"}` +
          ` reload=${atDcl ?? "none"}` +
          ` menu-after-show=${shown ? (shown.drawerInDoc ? "kept" : "gone") : "none"}` +
          ` menu-after-hide=${again ? (again.expanded === "false" && !again.drawerInDoc ? "closed" : "open") : "none"}` +
          ` fs-enabled=${open.fsEnabled} fs-after-hide=${folded ? folded.fsSet : "none"}` +
          ` full=${folded ? (folded.full ? "drawn" : "no") : "none"}` +
          (toolbar ? ` vercel-toolbar-hidden=${toolbar}` : "") +
          fails.map(([k, m]) => `\n    ${k}: ${m.join("\n        ")}`).join("") +
          (skipped.length ? `\n    not read: ${skipped.join(" | ")}` : ""),
      );

      // F1. THE PAGE AND THE EMULATION, hard, as readings 1 and 2.
      const status = response?.status() ?? 0;
      expect(status, `${route.path} answered ${status}, not 2xx`).toBeGreaterThanOrEqual(200);
      expect(status, `${route.path} answered ${status}, not 2xx`).toBeLessThan(300);
      expect(
        open.url.split("?")[0],
        `${route.path} landed on ${open.url}, so the fold was read on another page`,
      ).toBe(route.path.split("?")[0]);
      expect(open.coarse, `${route.path} @${tag}: matchMedia('(pointer: coarse)') is false`).toBe(true);
      expect(open.inner, `${route.path} @${tag}: innerWidth is ${open.inner}, not ${width}`).toBe(width);
      expect(
        open.reduce,
        `${route.path} @${tag}: prefers-reduced-motion isn't reduce inside the page, so the ` +
          `dashboard's sync time cycles and F6 would read the clock`,
      ).toBe(true);

      // F2 to F6, soft.
      expect
        .soft(f2, `${route.path} @${tag}: HIDE, open — one 28px button 8px down at the masthead's right, answering 4px past its edges, with no text line under it`)
        .toEqual([]);
      expect.soft(f3, `${route.path} @${tag}: a tap on HIDE — the masthead folds into the 44px strip`).toEqual([]);
      expect.soft(f4, `${route.path} @${tag}: the strip's menu — the drawer opens from its foot with text-glyph icons, and closes`).toEqual([]);
      expect.soft(f5, `${route.path} @${tag}: a reload — the fold is on html before first paint`).toEqual([]);
      expect.soft(f6, `${route.path} @${tag}: a tap on SHOW, the menu open — the masthead opens as it was and the menu is gone`).toEqual([]);
      expect.soft(f7, `${route.path} @${tag}: a tap on HIDE again — the masthead folds with the menu closed`).toEqual([]);
    });
  }
}

// REDUCED MOTION, READ BACK IN F1. The dashboard's sync time cycles five zones,
// 4 s each (lib/zone-cycle.ts), and at 390 its UTC phase wraps the meta row:
// the open masthead reads 320 then and 303.5 in the other four (measured on the
// HO 817 build, 2026-11-15). F6 compares the open height before the fold with
// the height after SHOW, so with motion it read the clock and not the fold.
// Reduced motion pins the zone to MT. Since HO 818 the stamp holds its widest
// zone's width (`.zone-stamp`, components/CyclingTimestamp.tsx), so the height
// no longer moves with the zone; the zone cells read that. The pin stays, so a
// fold cell never reads the clock.
test.describe("fold @390", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: "reduce" },
    storageState: { cookies: [], origins: [] },
  });
  foldCells("390", 390);
});

test.describe("fold @851", () => {
  test.use({
    viewport: { width: 851, height: 728 },
    deviceScaleFactor: 2.4375,
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: "reduce" },
    storageState: { cookies: [], origins: [] },
  });
  foldCells("851", 851);
});

// HO 817 — A FINE POINTER DRAWS NONE OF IT, even with the fold stored. The init
// script stores the fold before the page's own scripts run, so the boot script
// in <head> reads it: the attribute proves the row reached the boot script, and
// the rules under `(pointer: coarse)` are why nothing changes.
test.describe("fold, fine pointer @1440", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    storageState: { cookies: [], origins: [] },
  });
  for (const route of FOLD_ROUTES) {
    test(`${route.slug} (${route.path}) fold, fine pointer @1440`, async ({ page, context }) => {
      await context.addCookies([GATE_COOKIE]);
      await context.addInitScript((key) => {
        try {
          localStorage.setItem(key, "folded");
        } catch {
          /* the read below reports the attribute missing */
        }
      }, FOLD_KEY);
      const response = await page.goto(route.path, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForLoadState("load").catch(() => {});
      await page.waitForTimeout(2_500);
      const read = await page.evaluate(() => {
        const visible = (el: Element | null | undefined) => {
          if (!el || !(el as HTMLElement).checkVisibility({ visibilityProperty: true })) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const header = document.querySelector(".breadcrumb-path")?.closest("header") ?? null;
        return {
          url: location.pathname + location.search,
          attr: document.documentElement.getAttribute("data-masthead"),
          coarse: matchMedia("(pointer: coarse)").matches,
          hide: Array.from(document.querySelectorAll(".mh-hide")).some(visible),
          strip: Array.from(document.querySelectorAll(".mh-strip")).some(visible),
          path: visible(header?.querySelector(".breadcrumb-path")),
        };
      });
      const misses: string[] = [];
      if (read.attr !== "folded") misses.push(`html data-masthead is ${JSON.stringify(read.attr)}, not "folded"`);
      if (read.coarse) misses.push("matchMedia('(pointer: coarse)') is true");
      if (read.hide) misses.push("a .mh-hide is visible");
      if (read.strip) misses.push("a .mh-strip is visible");
      if (!read.path) misses.push("the masthead's .breadcrumb-path isn't visible");
      // eslint-disable-next-line no-console
      console.log(
        `[fold 1440 ${route.slug}] coarse=${read.coarse} attr=${read.attr ?? "none"}` +
          ` hide=${read.hide ? "visible" : "hidden"} strip=${read.strip ? "visible" : "hidden"}` +
          ` path=${read.path ? "visible" : "hidden"}` +
          (misses.length ? `\n    fine: ${misses.join("\n          ")}` : ""),
      );

      const status = response?.status() ?? 0;
      expect(status, `${route.path} answered ${status}, not 2xx`).toBeGreaterThanOrEqual(200);
      expect(status, `${route.path} answered ${status}, not 2xx`).toBeLessThan(300);
      expect(
        read.url.split("?")[0],
        `${route.path} landed on ${read.url}, so the fold was read on another page`,
      ).toBe(route.path.split("?")[0]);
      expect
        .soft(
          misses,
          `${route.path} @1440 with a fine pointer and the fold stored: the attribute is set ` +
            `and nothing of the fold is drawn — every rule sits under \`(pointer: coarse)\``,
        )
        .toEqual([]);
    });
  }
});

// HO 818 — THE ZONE CELLS (Z1 and Z2). The sync time cycles five zones, 4 s each,
// and nothing after it on its line may move, nor the masthead grow, while it
// does. The page's clock is Playwright's: installed before the load, run during
// it, then paused 1 s into slot 0 and stepped 4 s a slot, so each slot is read
// once, in order, whatever the wall clock says. Motion is on: reduced motion
// pins the zone to MT and would read one slot five times.
type ZoneRead = {
  tokens: string[];
  clock: { l: number; t: number } | null;
  headerH: number | null;
};

function zoneCells(tag: string, width: number) {
  for (const route of FOLD_ROUTES) {
    test(`${route.slug} (${route.path}) zones @${tag}`, async ({ page, context }) => {
      await page.clock.install({ time: ZONE_T0 - 120_000 });
      await context.addCookies([GATE_COOKIE]);
      const response = await page.goto(route.path, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForLoadState("load").catch(() => {});
      await page.waitForTimeout(2_500);
      await page.clock.pauseAt(ZONE_T0 + 1_000);

      const env = await page.evaluate(() => ({
        coarse: matchMedia("(pointer: coarse)").matches,
        inner: window.innerWidth,
        url: location.pathname + location.search,
        reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
      }));

      // The masthead is the `header` holding the breadcrumb path, as the fold
      // cells find it. Its sync line: `.home-header-meta` holding `.show-mobile`
      // on `/`, `.header-sync-sub` elsewhere. `innerText` skips text that isn't
      // rendered, `visibility: hidden` included, so its tokens are the ones seen.
      const readZone = () =>
        page.evaluate((home): { text: string | null; clock: { l: number; t: number } | null; headerH: number | null } => {
          const header = document.querySelector(".breadcrumb-path")?.closest("header") ?? null;
          const line = !header
            ? null
            : home
              ? (Array.from(header.querySelectorAll(".home-header-meta")).find((p) => p.querySelector(".show-mobile")) ?? null)
              : header.querySelector(".header-sync-sub");
          const clock = header?.querySelector(".masthead-clock");
          const r = clock ? clock.getBoundingClientRect() : null;
          return {
            text: line ? (line as HTMLElement).innerText : null,
            clock: r ? { l: r.left, t: r.top } : null,
            headerH: header ? header.getBoundingClientRect().height : null,
          };
        }, route.slug === "home");

      const z2: string[] = [];
      const reads: (ZoneRead | null)[] = [];
      for (const [i, want] of ZONE_SLOTS.entries()) {
        if (i > 0) await page.clock.runFor(4_000);
        const held: { last: ZoneRead | null } = { last: null };
        const zoneOf = async () => {
          const r = await readZone();
          const read: ZoneRead = {
            tokens: r.text === null ? [] : (r.text.match(ZONE_TOKEN) ?? []),
            clock: r.clock,
            headerH: r.headerH,
          };
          held.last = read;
          return read.tokens.length === 1 ? (read.tokens[0] ?? "").split(" ").pop() : `${read.tokens.length} tokens`;
        };
        try {
          await expect.poll(zoneOf, { timeout: 3_000, intervals: [100] }).toBe(want);
        } catch {
          const seen = held.last;
          z2.push(
            `slot ${want}: the sync line read ${seen ? (seen.tokens.length ? seen.tokens.join(" | ") : "no token") : "nothing"}`,
          );
        }
        reads.push(held.last);
      }

      const base = reads[0];
      for (const [i, want] of ZONE_SLOTS.entries()) {
        const r = reads[i];
        if (i === 0 || !r || !base) continue;
        if (!r.clock || !base.clock) z2.push(`slot ${want}: no .masthead-clock in the masthead`);
        else {
          const dl = r.clock.l - base.clock.l;
          const dt = r.clock.t - base.clock.t;
          if (Math.abs(dl) > TOLERANCE) z2.push(`slot ${want}: the clock's left ${dl > 0 ? "+" : ""}${Math.round(dl * 10) / 10}px on ET's`);
          if (Math.abs(dt) > TOLERANCE) z2.push(`slot ${want}: the clock's top ${dt > 0 ? "+" : ""}${Math.round(dt * 10) / 10}px on ET's`);
        }
        if (r.headerH === null || base.headerH === null) z2.push(`slot ${want}: no masthead header`);
        else if (Math.abs(r.headerH - base.headerH) > TOLERANCE)
          z2.push(`slot ${want}: the header ${r.headerH}px tall, ${base.headerH}px in ET`);
      }

      const r1 = (n: number | null | undefined) => (n === null || n === undefined ? "none" : `${Math.round(n * 10) / 10}`);
      // eslint-disable-next-line no-console
      console.log(
        `[zone ${tag} ${route.slug}] coarse=${env.coarse} inner=${env.inner} reduce=${env.reduce}` +
          ` tokens=${reads.map((r) => (r && r.tokens.length ? r.tokens.join("+") : "none")).join("|")}` +
          ` clock=${reads.map((r) => (r?.clock ? `${r1(r.clock.l)},${r1(r.clock.t)}` : "none")).join("|")}` +
          ` header=${reads.map((r) => r1(r?.headerH)).join("|")}` +
          (z2.length ? `\n    Z2: ${z2.join("\n        ")}` : ""),
      );

      // Z1. THE PAGE AND THE EMULATION, hard: motion is on, or Z2 reads one slot.
      const status = response?.status() ?? 0;
      expect(status, `${route.path} answered ${status}, not 2xx`).toBeGreaterThanOrEqual(200);
      expect(status, `${route.path} answered ${status}, not 2xx`).toBeLessThan(300);
      expect(
        env.url.split("?")[0],
        `${route.path} landed on ${env.url}, so the zones were read on another page`,
      ).toBe(route.path.split("?")[0]);
      expect(env.coarse, `${route.path} @${tag}: matchMedia('(pointer: coarse)') is false`).toBe(true);
      expect(env.inner, `${route.path} @${tag}: innerWidth is ${env.inner}, not ${width}`).toBe(width);
      expect(
        env.reduce,
        `${route.path} @${tag}: prefers-reduced-motion is reduce inside the page, so the sync time is pinned to MT`,
      ).toBe(false);

      // Z2, soft.
      expect
        .soft(
          z2,
          `${route.path} @${tag}: the sync time cycles ET, CT, MT, PT, UTC with nothing after it moving ` +
            `and the masthead's height held`,
        )
        .toEqual([]);
    });
  }
}

test.describe("zones @390", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: "no-preference" },
    storageState: { cookies: [], origins: [] },
  });
  zoneCells("390", 390);
});

// THE FOLD, CLOSED, ESTIMATED: 412 x 915 at DPR 2.625 is a common Android phone
// screen. Nobody has read the cover screen's CSS width.
test.describe("zones @412", () => {
  test.use({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: "no-preference" },
    storageState: { cookies: [], origins: [] },
  });
  zoneCells("412", 412);
});

test.describe("zones @851", () => {
  test.use({
    viewport: { width: 851, height: 728 },
    deviceScaleFactor: 2.4375,
    hasTouch: true,
    isMobile: true,
    contextOptions: { reducedMotion: "no-preference" },
    storageState: { cookies: [], origins: [] },
  });
  zoneCells("851", 851);
});
