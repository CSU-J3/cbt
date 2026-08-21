// HO 677 STEP 3 — the two capture cases HO 675's harness does not cover.
//
//   1. One of the 108: a bill that stored NULL beside a real roster, so the
//      panel hid its COSPONSORS row AND its faces. Post-reconcile it must render
//      the row, with total == the sum of the group headers.
//   2. THE GATE CONTROL: the member hub, where the row must STILL be absent.
//      `getMemberBills` omits SPONSOR_ENRICH_SELECT, so `cosponsor_count` never
//      reaches that payload — this HO must not have widened the gate.
//
// Captures at the standard viewport set plus a separate reduced-motion pass (a
// different layout, not a dimmer one). Readings are content assertions and are
// necessary-not-sufficient; the PNGs are the check.
//
//   npx tsx scripts/diagnostic/gate-shots-677.ts <baseUrl> <outDir>
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { getDb } from "../../lib/db";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "docs/handoffs/677-artifacts";

const WIDTHS: { w: number; h: number; tag: string; reduced?: boolean }[] = [
  { w: 1920, h: 1400, tag: "1920" },
  { w: 1440, h: 1200, tag: "1440" },
  { w: 1100, h: 1200, tag: "1100" },
  { w: 430, h: 1000, tag: "430" },
  { w: 1920, h: 1400, tag: "1920-reduced", reduced: true },
];

// TWO of the 108-cohort, both of which stored NULL beside a real roster before
// this HO. `119-hres-1334` is is_ceremonial=1, so /bills EXCLUDES it by default —
// the first run of this harness searched without the toggle, found nothing, and
// reported 5 failed opens rather than screenshotting an empty list. The
// non-ceremonial one is the primary case; the ceremonial one rides ?ceremonial=1
// so the cohort is shown to span both.
const NULL_CASES: { id: string; re: RegExp; extra: string }[] = [
  { id: "119-hr-8411", re: /HR\s+8411/, extra: "" },
  { id: "119-hres-1334", re: /HRES\s+1334/, extra: "&ceremonial=1" },
];
// The busiest member hub — the gate control needs a route that actually renders
// rows anonymously, which /watchlist does not (see the note in main()).
const MEMBER = "S001217";

// Same reading shape as HO 675's harness, cut to what this HO asserts. Kept as a
// STRING because tsx/esbuild's keepNames rewrites named functions with a
// `__name(...)` wrapper that does not exist inside the page (HO 670 oddity).
const READ = `(() => {
  const all = (s) => Array.from(document.querySelectorAll(s));
  const rows = all(".bxp-metabox .bxp-mrow");
  const hit = rows.filter((r) => {
    const l = r.querySelector(".bxp-mlabel");
    return l && (l.textContent || "").trim().toLowerCase() === "cosponsors";
  })[0];
  return {
    panelPresent: document.querySelector(".bxp") !== null,
    cosponsorRow: hit
      ? { present: true, total: (hit.querySelector(".bxp-mval").textContent || "").trim() }
      : { present: false, total: null },
    groups: all(".bxp-cospgrp").map((g) => (g.querySelector(".bxp-cospghdr").textContent || "").trim()),
    faceCount: all(".bxp-face").length,
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
  };
})()`;

/** The HO 675 phrase rule: hand FTS the six LONGEST alphanumeric words. */
function phraseFor(title: string): string {
  const words = title.match(/[A-Za-z0-9]{3,}/g) ?? [];
  return [...words].sort((a, b) => b.length - a.length).slice(0, 6).join(" ");
}

/**
 * WAIT FOR THE LAZY PANEL FETCH BEFORE READING. `.bxp` mounts immediately; the
 * roster arrives from /api/bill/[id]/panel afterwards, so a reading taken on
 * `.bxp` alone races it — the first run of this harness reported `groups: []`
 * at the first viewport of every context and populated groups at the rest,
 * which reads exactly like "this bill has no groups" and is not. An empty
 * groups array must mean the panel said so, not that nobody had answered yet.
 * Face images are settled too: an unloaded <img> over a dark panel is
 * pixel-identical to a deliberate tile (HO 673).
 */
async function settlePanel(page: Page): Promise<void> {
  await page
    .waitForFunction(
      `document.querySelector(".bxp-cospgrp") !== null ||
       document.querySelector(".bxp-relempty") !== null ||
       document.querySelector(".bxp-summary") !== null`,
      { timeout: 8000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1400);
  await page
    .waitForFunction(
      `Array.from(document.querySelectorAll("img.bxp-face-photo")).every((i) => i.complete)`,
      { timeout: 8000 },
    )
    .catch(() => {});
}

async function expandFirstRow(page: Page): Promise<boolean> {
  const ok = await page.waitForSelector("li.feed-row", { timeout: 15000 }).then(() => true).catch(() => false);
  if (!ok) return false;
  await page.locator("li.feed-row .row-content").first().click();
  return page.waitForSelector(".bxp", { timeout: 15000 }).then(() => true).catch(() => false);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const db = getDb();
  const phrases = new Map<string, string>();
  for (const c of NULL_CASES) {
    const t = await db.execute({ sql: "SELECT title FROM bills WHERE id = ?", args: [c.id] });
    const p = phraseFor(String(t.rows[0]?.title ?? ""));
    phrases.set(c.id, p);
    console.log(`${c.id} search phrase: "${p}"`);
  }

  const browser = await chromium.launch();
  const readings: unknown[] = [];
  let failures = 0;

  for (const v of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: v.w, height: v.h },
      reducedMotion: v.reduced ? "reduce" : "no-preference",
      // The landing redirect is not what is under test here.
      storageState: { cookies: [{ name: "ct_seen", value: "1", domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" as const }], origins: [] },
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    // CASE 1 — the 108 cohort on /bills, where the enrichment IS present.
    for (const c of NULL_CASES) {
      errors.length = 0;
      await page.goto(
        `${BASE}/bills?q=${encodeURIComponent(phrases.get(c.id) ?? "")}${c.extra}`,
        { waitUntil: "networkidle" },
      );
      let opened = false;
      const listed = await page
        .waitForSelector("li.feed-row", { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      if (listed) {
        const rows = page.locator("li.feed-row");
        const n = await rows.count();
        for (let i = 0; i < n; i++) {
          const row = rows.nth(i);
          if (c.re.test((await row.innerText()).replace(/\s+/g, " "))) {
            await row.locator(".row-content").first().click();
            opened = await page
              .waitForSelector(".bxp", { timeout: 15000 })
              .then(() => true)
              .catch(() => false);
            break;
          }
        }
      }
      if (opened) await settlePanel(page);
      const r1 = opened ? await page.evaluate(READ) : null;
      if (!opened) failures++;
      const f1 = join(OUT, `gate-${v.tag}-${c.id}.png`);
      await page.screenshot({ path: f1, fullPage: false });
      readings.push({ case: c.id, route: "/bills", tag: v.tag, reduced: !!v.reduced, opened, file: f1, errors: [...errors], reading: r1 });
    }

    // CASE 2 — the member hub. The row must be ABSENT: this is the control that
    // the gate was not widened, so an ABSENT row here is the PASS.
    errors.length = 0;
    await page.goto(`${BASE}/members/${MEMBER}`, { waitUntil: "networkidle" });
    const opened2 = await expandFirstRow(page);
    if (opened2) await settlePanel(page);
    const r2 = opened2 ? await page.evaluate(READ) : null;
    if (!opened2) failures++;
    const f2 = join(OUT, `gate-${v.tag}-member-${MEMBER}.png`);
    await page.screenshot({ path: f2, fullPage: false });
    readings.push({ case: `member-${MEMBER}`, route: `/members/${MEMBER}`, tag: v.tag, reduced: !!v.reduced, opened: opened2, file: f2, errors: [...errors], reading: r2 });

    await ctx.close();
  }
  await browser.close();

  const path = join(OUT, "gate-readings.json");
  writeFileSync(path, JSON.stringify(readings, null, 2));
  console.log(`wrote ${readings.length} readings -> ${path}`);
  console.log(`panels that failed to open: ${failures}`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
