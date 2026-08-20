// HO 675 STEP 3 — the render gate. Playwright drives the LOCAL prod server,
// opens the expand panel on named bills, and captures the cosponsor faces and
// the related-bills block at four widths plus a separate reduced-motion pass.
//
// Content assertions are necessary and NOT sufficient (docs/method.md
// § Gates), so this takes screenshots AND reads geometry AND asserts, and each
// reading is written to readings.json beside the images. The three things a
// 200 and a grep cannot see, all of which have bitten this panel before:
//   - the stylesheet actually loading (a stale .next serves a 200 whose CSS
//     404s, so a class in the markup proves nothing about the box on screen);
//   - the metabox / panel height delta, which is the layout shift STEP 0
//     predicted and this measures;
//   - horizontal overflow, which no assertion on text can detect.
//
// The MEASURED-BOTH-SIDES pattern: run once with ROSTER_OFF=1 to capture the
// before state (the two new blocks removed via CSS, which is the only way to
// get a before render out of a single built tree), once without for after.
//
//   npx tsx scripts/diagnostic/roster-shots-675.ts <baseUrl> <outDir> [before]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const WIDTHS: { w: number; h: number; tag: string; reduced?: boolean }[] = [
  { w: 1920, h: 1400, tag: "1920" },
  { w: 1440, h: 1200, tag: "1440" },
  { w: 1100, h: 1200, tag: "1100" },
  { w: 430, h: 1000, tag: "430" },
  // A different layout, not a dimmer one — its own pass.
  { w: 1920, h: 1400, tag: "1920-reduced", reduced: true },
];

// Every case the HO 675 review named, each found by probe rather than by
// browsing, with the reading it exists to produce.
const CASES: { id: string; why: string }[] = [
  { id: "119-hconres-90", why: "cosponsors ZERO + related NONE — both empty states" },
  { id: "119-hconres-24", why: "exactly ONE cosponsor" },
  { id: "119-hconres-32", why: "exactly SIX cosponsors — budget met exactly" },
  { id: "119-hr-842", why: "MANY (338 active) three-party D185/R152/I1 -> D3/R2/I1" },
  { id: "119-hr-452", why: "WITHDRAWN cosponsor: 300 stored, 299 active, groups must sum 299" },
  { id: "119-hr-14", why: "SINGLE-PARTY 220 D — redistribution fires, D6" },
  { id: "119-hjres-124", why: "Identical Bill (Became Law) + 3 types on ONE target (dedupe)" },
  { id: "119-hconres-100", why: "SAME-chamber identicals stay BELOW, nothing promoted" },
  { id: "119-hconres-23", why: "TWO distinct cross-chamber targets — multi-row promoted block" },
  { id: "119-hr-1082", why: "PROMOTED target UNRESOLVED (119-s-4885 not in bills) — no link" },
  { id: "119-hr-7567", why: "91 related, no identical — the +86 more overflow" },
  { id: "119-s-5299", why: "cosponsor with NO depiction_url (A000383) — initials fallback" },
  { id: "119-hr-8591", why: "E2 median: count row 10 vs groups sum 11 (+1)" },
  { id: "119-hr-1628", why: "E2 tail: count row 202 vs groups sum 252 (+50)" },
  // The SPONSOR-side control for the one edit HO 675 made to the sponsor path:
  // SponsorPhoto gained a `className` prop. Its default must still render the
  // pre-675 strings byte for byte, and the FALLBACK string is only reachable on
  // a bill whose sponsor has no depiction_url -- 2 of 17,722 (HO 673).
  { id: "119-s-4944", why: "SPONSOR without a portrait — exercises the --fb class string" },
];

type Reading = Record<string, unknown>;

// Search phrases, emitted from the DB by roster-shot-targets-675.ts.
//
// /bills' ?q goes through bills_fts MATCH (getFeedBills), NOT the id LIKE the
// other feeds use, so a bill cannot be reached by its id here at all — the
// first run of this harness searched `?q=119-hr-842`, got an empty list, and
// captured 70 screenshots of a page with no bills on it while reporting zero
// errors. Hence: search by TITLE, then find the row by its rendered id.
type Target = { id: string; label: string; phrase: string };

// Locate the row for `label` ("HR 842") in the current list, paging forward if
// the phrase ranked it off page 1. Returns null rather than throwing so the
// caller can record the miss and fail once, loudly, at the end.
async function findRow(page: Page, base: string, t: Target, extra: string) {
  const [type, num] = t.label.split(" ");
  const re = new RegExp(`(^|\\s)${type}\\s+${num}(\\s|$)`);
  for (let pg = 1; pg <= 3; pg++) {
    await page.goto(
      `${base}/bills?q=${encodeURIComponent(t.phrase)}${extra}&page=${pg}`,
      { waitUntil: "networkidle" },
    );
    // The list is inside a Suspense boundary, so it is absent from the initial
    // HTML and `networkidle` alone does not prove it arrived.
    const ok = await page
      .waitForSelector("li.feed-row", { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) return null;
    const rows = page.locator("li.feed-row");
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      const text = (await row.innerText()).replace(/\s+/g, " ");
      if (re.test(text)) return row;
    }
  }
  return null;
}

// THE BODY IS A STRING, not a function, and that is not a style choice.
// tsx/esbuild compiles with `keepNames`, which rewrites every named function in
// this file to carry a `__name(...)` wrapper. Ship that into `page.evaluate`
// and the browser throws `ReferenceError: __name is not defined`, because the
// helper only exists in the Node bundle. Already on the record as a throwaway-
// instrument trap at HO 670 (docs/oddities.md); it bit again here.
//
// A string is handed to the page verbatim, so nothing transpiles it.
const READ_PANEL = `(() => {
  const q = (s) => document.querySelector(s);
  const all = (s) => Array.from(document.querySelectorAll(s));
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  };
  const txt = (el) => (el ? (el.textContent || "").trim() : null);
  return {
    panel: box(q(".bxp")),
    metabox: box(q(".bxp-metabox")),
    stageBar: box(q(".v2f-bar")),
    sponsorBlock: box(q(".bxp-sponsor")),
    sponsorMarkup: q(".bxp-sponsor") ? q(".bxp-sponsor").outerHTML : null,
    cosponsorRow: (() => {
      // SCOPED TO THE ROW WHOSE LABEL SAYS "Cosponsors". The first version took
      // the first .bxp-mval.tabular-nums in the metabox, which is the INTRODUCED
      // row when the Cosponsors row is absent -- so a bill with no cosponsors
      // reported a DATE as its cosponsor total and the reading looked populated.
      const rows = all(".bxp-metabox .bxp-mrow");
      const hit = rows.filter((r) => {
        const l = r.querySelector(".bxp-mlabel");
        return l && (l.textContent || "").trim().toLowerCase() === "cosponsors";
      })[0];
      if (!hit) return { present: false, total: null };
      const v = hit.querySelector(".bxp-mval");
      return { present: true, total: v ? (v.textContent || "").trim() : null };
    })(),
    faceCount: all(".bxp-face").length,
    facesByParty: all(".bxp-cospgrp").map((g) => ({
      header: (g.querySelector(".bxp-cospghdr").textContent || "").trim(),
      faces: g.querySelectorAll(".bxp-face").length,
      more: (g.querySelector(".bxp-cosmore")
        ? g.querySelector(".bxp-cosmore").textContent
        : "").trim() || null,
    })),
    faceLinks: all("a.bxp-face").map((a) => a.getAttribute("href")),
    faceImages: all("img.bxp-face-photo").map((e) => ({
      complete: e.complete,
      naturalWidth: e.naturalWidth,
      w: Math.round(e.getBoundingClientRect().width),
      h: Math.round(e.getBoundingClientRect().height),
    })),
    faceFallbacks: all("span.bxp-face-photo--fb").map((e) => (e.textContent || "").trim()),
    relatedHeaders: all(".bxp-relhdr").map((e) => (e.textContent || "").trim()),
    promoted: all(".bxp-comp").map((e) => ({
      label: (e.querySelector(".bxp-complbl").textContent || "").trim(),
      row: (e.querySelector(".bxp-comprow").textContent || "").trim(),
      isLink: e.querySelector("a.bxp-comprow") !== null,
      meta: (e.querySelector(".bxp-compmeta")
        ? e.querySelector(".bxp-compmeta").textContent
        : "").trim() || null,
    })),
    restLabel: txt(q(".bxp-restlbl")),
    restRows: all(".bxp-rb").map((e) => ({
      id: (e.querySelector(".bxp-rbid").textContent || "").trim(),
      rel: (e.querySelector(".bxp-rbrel")
        ? e.querySelector(".bxp-rbrel").textContent
        : "").trim(),
      isLink: e.tagName === "A",
    })),
    rbMore: txt(q(".bxp-rbmore")),
    relatedEmpty: all(".bxp-relempty").map((e) => (e.textContent || "").trim()),
    tipDisplay: q(".bxp-tip") ? getComputedStyle(q(".bxp-tip")).display : null,
    tipName: txt(q(".bxp-tipname")),
    faceEdge: q(".bxp-face-photo")
      ? getComputedStyle(q(".bxp-face-photo")).borderBottomColor
      : null,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
  };
})()`;

async function main() {
  const base = process.argv[2] ?? "http://localhost:3000";
  const out = process.argv[3] ?? ".";
  const before = process.argv[4] === "before";
  if (!existsSync(out)) mkdirSync(out, { recursive: true });

  const TARGETS: Target[] = JSON.parse(
    readFileSync(join(out, "shot-targets.json"), "utf8"),
  );
  const missing = CASES.filter((c) => !TARGETS.some((t) => t.id === c.id));
  if (missing.length) {
    console.error("no search phrase for: " + missing.map((m) => m.id).join(", "));
    process.exit(1);
  }

  const browser = await chromium.launch();
  const readings: Reading[] = [];
  try {
    for (const { w, h, tag, reduced } of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        reducedMotion: reduced ? "reduce" : "no-preference",
      });
      for (const c of CASES) {
        const page = await ctx.newPage();
        const errors: string[] = [];
        const css: { name: string; status: number }[] = [];
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text().slice(0, 200));
        });
        page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
        page.on("response", (r) => {
          if (r.url().includes("/_next/static/css/"))
            css.push({ name: r.url().split("/").pop() ?? "", status: r.status() });
        });

        // ceremonial=1 widens the list rather than narrowing it: the feed
        // hides ceremonial bills by default and three of these targets are
        // Gold Medal / Capitol-hall resolutions that the default gate removes.
        const target = TARGETS.find((t) => t.id === c.id)!;
        const found = await findRow(page, base, target, "&ceremonial=1");
        if (before) {
          // The BEFORE side of the diff, produced from the SAME built tree by
          // removing only the two new blocks. Anything else about the page —
          // fonts, spacing, the stage bar — is therefore identical by
          // construction rather than by assertion.
          await page.addStyleTag({
            content:
              ".bxp-cospgrp{display:none!important}" +
              ".bxp-relblock:has(.bxp-comp),.bxp-relblock:has(.bxp-rb){display:none!important}",
          });
        }
        // THE TRIGGER SELECTOR IS SCOPED TO THE ROW, and the scope is the
        // second lesson of this harness. `[role="button"][aria-expanded]`
        // unscoped matches the MOBILE-NAV TOGGLE in the header — Playwright
        // clicked that on all 70 passes of run 1 and the report came back 0
        // console errors / 0 CSS failures / 0 overflow, three greens from an
        // instrument that never reached the thing under test.
        let opened = false;
        if (found) {
          await found.locator('[role="button"][aria-expanded]').first().click();
          await page
            .waitForSelector("li.feed-row .bxp", { timeout: 8000 })
            .catch(() => {});
          opened = (await page.locator(".bxp").count()) > 0;
        }
        await page.waitForTimeout(1400); // the lazy panel fetch
        // Let the face portraits settle. Without this, `complete:false` is
        // ambiguous between "still downloading" and "404 and the onError
        // fallback never fired" -- and an unloaded <img> over a dark panel is
        // pixel-identical to a deliberate tile (HO 673).
        await page
          .waitForFunction(
            `Array.from(document.querySelectorAll("img.bxp-face-photo")).every((i) => i.complete)`,
            { timeout: 8000 },
          )
          .catch(() => {});
        const reading = opened
          ? ((await page.evaluate(READ_PANEL)) as Reading)
          : {};
        const file = `${before ? "before" : "after"}-${tag}-${c.id}.png`;
        const panel = page.locator(".bxp").first();
        if (await panel.count()) {
          await panel.screenshot({ path: join(out, file) }).catch(() => {});
        } else {
          await page.screenshot({ path: join(out, file), fullPage: false });
        }
        // THE HOVER, ACTUALLY PERFORMED. `display:none` in the resting reading
        // is what a working tip AND a missing stylesheet both look like; only
        // driving the hover separates them. Read the same property after a real
        // mouse move onto the first face.
        if (opened && (await page.locator("a.bxp-face").count())) {
          await page.locator("a.bxp-face").first().hover();
          await page.waitForTimeout(150);
          reading.tipDisplayHovered = await page.evaluate(
            `(() => { const t = document.querySelector(".bxp-tip"); ` +
              `return t ? getComputedStyle(t).display : null; })()`,
          );
          reading.tipBoxHovered = await page.evaluate(
            `(() => { const t = document.querySelector(".bxp-tip"); ` +
              `if (!t) return null; const r = t.getBoundingClientRect(); ` +
              `return { w: Math.round(r.width), h: Math.round(r.height) }; })()`,
          );
          // The hover state gets its OWN image. The first run shot the panel
          // while the tip was open, so the tip covered the COSPONSORS label and
          // the first group header in every capture -- the resting layout, the
          // thing the gate exists to look at, was never photographed.
          const hfile = `hover-${tag}-${c.id}.png`;
          const hp = page.locator(".bxp").first();
          if (await hp.count()) {
            await hp.screenshot({ path: join(out, hfile) }).catch(() => {});
            reading.hoverFile = hfile;
          }
        }
        // THE LAYOUT DELTA, measured by REMOVING exactly the nodes this HO
        // adds and re-reading the same boxes.
        //
        // This replaces the obvious alternative — build the pre-change tree and
        // diff two runs — for two reasons. It is exact: the removed nodes are
        // precisely the addition, so nothing else can differ between the two
        // readings, where two builds differ in everything the browser happened
        // to do that run. And it needs no git operation on a working tree that
        // other sessions share (docs/method.md § Session start).
        //
        // Done AFTER the screenshot and the hover, so it cannot affect them.
        if (opened) {
          reading.delta = await page.evaluate(
            `(() => {
              const mb = document.querySelector(".bxp-metabox");
              const px = document.querySelector(".bxp");
              const lf = document.querySelector(".bxp-left");
              const h = (e) => (e ? Math.round(e.getBoundingClientRect().height) : null);
              const bar = document.querySelector(".v2f-bar");
              const sp = document.querySelector(".bxp-sponsor");
              const bx = (e) => {
                if (!e) return null;
                const r = e.getBoundingClientRect();
                return Math.round(r.width) + "x" + Math.round(r.height);
              };
              const after = {
                panel: h(px), metabox: h(mb), left: h(lf),
                // The two things this HO must NOT move. Measured on BOTH sides
                // of the removal, so "unchanged" is a comparison rather than an
                // assertion about code that was not edited.
                stageBar: bx(bar), sponsor: bx(sp),
                sponsorHtml: sp ? sp.outerHTML : null,
              };
              document.querySelectorAll(".bxp-cospgrp").forEach((n) => n.remove());
              const blocks = Array.from(document.querySelectorAll(".bxp-left .bxp-relblock"));
              const rb = blocks.filter((b) => {
                const hd = b.querySelector(".bxp-relhdr");
                return hd && (hd.textContent || "").trim() === "Related Bills";
              })[0];
              if (rb) rb.remove();
              const before = {
                panel: h(px), metabox: h(mb), left: h(lf),
                stageBar: bx(bar), sponsor: bx(sp),
                sponsorHtml: sp ? sp.outerHTML : null,
              };
              return {
                before,
                after,
                panelDelta: after.panel - before.panel,
                metaboxDelta: after.metabox - before.metabox,
                leftDelta: after.left - before.left,
                removedRelatedBlock: !!rb,
                stageBarUnmoved: before.stageBar === after.stageBar,
                sponsorUnmoved:
                  before.sponsor === after.sponsor &&
                  before.sponsorHtml === after.sponsorHtml,
              };
            })()`,
          );
        }

        readings.push({
          side: before ? "before" : "after",
          tag,
          reduced: !!reduced,
          bill: c.id,
          why: c.why,
          opened,
          consoleErrors: errors,
          cssResponses: css,
          file,
          ...reading,
        });
        await page.close();
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  const path = join(out, `readings-${before ? "before" : "after"}.json`);
  writeFileSync(path, JSON.stringify(readings, null, 2));
  const opened = readings.filter((r) => r.opened).length;
  const errs = readings.reduce(
    (n, r) => n + ((r.consoleErrors as string[]) ?? []).length,
    0,
  );
  const badCss = readings.reduce(
    (n, r) =>
      n +
      ((r.cssResponses as { status: number }[]) ?? []).filter(
        (c) => c.status !== 200,
      ).length,
    0,
  );
  const overflow = readings.filter(
    (r) => (r.docScrollW as number) > (r.docClientW as number),
  ).length;
  console.log(`wrote ${readings.length} readings -> ${path}`);
  console.log(`  panels opened      ${opened} / ${readings.length}`);
  console.log(`  console errors     ${errs}`);
  console.log(`  non-200 stylesheet ${badCss}`);
  console.log(`  horizontal overflow ${overflow}`);
  // A NON-ZERO EXIT WHEN NOTHING OPENED. Every other number this harness prints
  // is meaningless unless this one is full, so it is checked first and it is
  // fatal — a clean report from a harness that captured nothing is the failure
  // this guard exists to make impossible.
  if (opened !== readings.length) {
    console.error(
      `FATAL: ${readings.length - opened} case(s) never opened a panel; ` +
        `every reading above is from a page with no panel on it.`,
    );
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
