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
//
// NO SCREENSHOTS AND NO COLLECTORS, as in the narrow spec: one navigation a
// cell, one log line a cell. Untagged, so `e2e-prod` runs it on every trigger.
import { expect, test } from "@playwright/test";
import { TEXT_ENTRY_SELECTOR, TOUCH_ROUTES } from "./routes";

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
