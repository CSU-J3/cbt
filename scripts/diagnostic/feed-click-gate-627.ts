// HO 627 COMMIT 0 GATE — the row is the click target, proven by clicking pixels.
//
// WHY THIS EXISTS, AND WHY IT REPLACES THE §1 REPRODUCTION PERMANENTLY.
// The prior reproductions PASSED while the owner FAILED. They asserted expansion
// by driving the component — dispatching a synthetic event at the row element, or
// clicking a selector Playwright resolves to the row's own box. Users do not click
// "the row". They click the amber id, or the title, or the sponsor. Those were
// child <a> elements calling stopPropagation, so the exact pixels a user aims at
// were the only ones that did NOT expand — and every green reproduction was
// clicking pixels nobody clicks.
//
// So this gate takes each target's OWN client rect, aims at its CENTRE, and issues
// a real mouse click at those viewport coordinates via page.mouse. If something
// overlays the target, or the rect is off-screen, or a child swallows the event,
// this notices; a selector-based click would not.
//
// It also runs from a SCROLLED feed position, because that is the state the owner
// was in and because an element's client rect and its page coordinates diverge
// exactly there — a harness that only ever tests row 1 at scrollTop 0 cannot see a
// coordinate bug.
//
// Local-only. Needs a server on BASE_URL (default localhost:3000). Prefer
// `next start` (a production build) over `next dev` — the dashboard's feed slices
// and container queries should be measured on the build that ships.
//
//   npx tsx scripts/diagnostic/feed-click-gate-627.ts
import { chromium, type Page, type BrowserContext } from "@playwright/test";

const BASE_URL = process.env.GATE_BASE_URL ?? "http://localhost:3000";
const GATE_COOKIE = { name: "ct_seen", value: "1", url: BASE_URL };
const WIDTHS: { label: string; w: number; h: number }[] = [
  { label: "1440", w: 1440, h: 900 },
  { label: "2560", w: 2560, h: 1440 },
];
const SETTLE_MS = 1200;

type Rect = { x: number; y: number; w: number; h: number };
type Result = { name: string; pass: boolean; detail: string };

const results: Result[] = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`   ${pass ? "PASS" : "**FAIL**"}  ${name.padEnd(46)} ${detail}`);
}

// tsx/esbuild keepNames shim — see layout-audit-606.ts for the full explanation.
const NAME_SHIM = () => {
  const g = globalThis as unknown as { __name?: (fn: unknown) => unknown };
  if (!g.__name) g.__name = (fn: unknown) => fn;
};

/** Scroll the feed so we are testing a row that is NOT the first one at rest. */
async function scrollFeedAndPickRow(
  page: Page,
): Promise<{ index: number; total: number; scrolled: number } | null> {
  return page.evaluate(() => {
    const feed = document.querySelector(".feed") as HTMLElement | null;
    const groups = Array.from(document.querySelectorAll(".v2f-group"));
    if (groups.length === 0) return null;
    let scrolled = 0;
    if (feed && feed.scrollHeight > feed.clientHeight + 20) {
      feed.scrollTop = Math.floor((feed.scrollHeight - feed.clientHeight) * 0.5);
      scrolled = feed.scrollTop;
    }
    // Pick the LAST group whose row is fully inside the viewport — the "last
    // visible position of a scrolled feed" the 609 §2 reproduction names.
    let pick = -1;
    groups.forEach((g, i) => {
      const row = g.querySelector(".v2f-row") as HTMLElement | null;
      if (!row) return;
      const r = row.getBoundingClientRect();
      if (r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0) pick = i;
    });
    if (pick < 0) pick = 0;
    return { index: pick, total: groups.length, scrolled };
  });
}

async function rectOf(page: Page, groupIndex: number, sel: string): Promise<Rect | null> {
  return page.evaluate(
    ({ groupIndex, sel }) => {
      const g = document.querySelectorAll(".v2f-group")[groupIndex];
      if (!g) return null;
      const el = g.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    },
    { groupIndex, sel },
  );
}

async function isOpen(page: Page, groupIndex: number): Promise<boolean> {
  return page.evaluate((i) => {
    const g = document.querySelectorAll(".v2f-group")[i];
    const row = g?.querySelector(".v2f-row");
    return row?.getAttribute("aria-expanded") === "true";
  }, groupIndex);
}

async function collapseAll(page: Page, groupIndex: number) {
  if (await isOpen(page, groupIndex)) {
    const r = await rectOf(page, groupIndex, ".v2f-row");
    if (r) await page.mouse.click(r.x + r.w - 6, r.y + r.h / 2);
    await page.waitForTimeout(180);
  }
}

/**
 * Click the centre of a target's own rect with a real mouse.
 *
 * NOTE, and it cost this gate a red run: `page.mouse.click()` takes ONLY
 * {button, clickCount, delay} — it has NO `modifiers` option (that lives on
 * locator.click / page.click). Passing one is silently ignored, so a "ctrl-click"
 * written that way is just a plain click, and the ctrl legs below failed by
 * expanding exactly as a plain click should. The modifier has to be held down
 * around the click via the keyboard. Left as a comment because the silent-ignore
 * is the trap: the harness reported a product failure that was its own.
 */
async function clickCentre(
  page: Page,
  rect: Rect,
  mods: ("Control" | "Shift" | "Meta" | "Alt")[] = [],
) {
  for (const m of mods) await page.keyboard.down(m);
  try {
    await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2);
  } finally {
    for (const m of [...mods].reverse()) await page.keyboard.up(m);
  }
  await page.waitForTimeout(220);
}

async function runWidth(ctx: BrowserContext, label: string, w: number, h: number) {
  console.log(`\n── ${label} (${w}x${h}) ──`);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(SETTLE_MS);

  const picked = await scrollFeedAndPickRow(page);
  if (!picked) {
    record(`${label} feed present`, false, "no .v2f-group rendered — cannot gate");
    await page.close();
    return;
  }
  const gi = picked.index;
  console.log(
    `   feed: ${picked.total} rows · scrolled ${picked.scrolled}px · testing row index ${gi} (last fully visible)`,
  );
  record(
    `${label} tested from a scrolled position`,
    picked.scrolled > 0 || picked.total <= 6,
    picked.scrolled > 0 ? `scrollTop=${picked.scrolled}` : `feed too short to scroll (${picked.total} rows)`,
  );

  // ---- G1: click the TITLE -> expands
  await collapseAll(page, gi);
  const titleRect = await rectOf(page, gi, ".v2f-title");
  if (titleRect) {
    await clickCentre(page, titleRect);
    record(`${label} click TITLE expands`, await isOpen(page, gi), `at (${Math.round(titleRect.x + titleRect.w / 2)},${Math.round(titleRect.y + titleRect.h / 2)})`);
  } else record(`${label} click TITLE expands`, false, ".v2f-title rect not measurable");

  // ---- G2: click the ID -> expands (the owner-reported defect)
  await collapseAll(page, gi);
  const idRect = await rectOf(page, gi, ".v2f-id");
  if (idRect) {
    const urlBefore = page.url();
    await clickCentre(page, idRect);
    const opened = await isOpen(page, gi);
    const stayed = page.url() === urlBefore;
    record(`${label} click ID expands (not navigates)`, opened && stayed, `open=${opened} url-unchanged=${stayed} at (${Math.round(idRect.x + idRect.w / 2)},${Math.round(idRect.y + idRect.h / 2)})`);
  } else record(`${label} click ID expands (not navigates)`, false, ".v2f-id rect not measurable");

  // ---- G3: ctrl-click the ID -> does NOT expand (default navigation allowed)
  await collapseAll(page, gi);
  const idRect2 = await rectOf(page, gi, ".v2f-id");
  if (idRect2) {
    const before = ctx.pages().length;
    await clickCentre(page, idRect2, ["Control"]);
    await page.waitForTimeout(500);
    const opened = await isOpen(page, gi);
    const after = ctx.pages().length;
    // The decisive assertion is that the row did NOT toggle: that is the exact
    // behavioural fork between "we preventDefault'd and let it bubble" and "we
    // let the browser navigate". New-tab creation is reported but not required
    // (headless background-tab behaviour varies).
    record(`${label} ctrl-click ID does NOT expand`, !opened, `open=${opened} · tabs ${before}->${after}`);
    for (const p of ctx.pages().slice(1)) await p.close();
  } else record(`${label} ctrl-click ID does NOT expand`, false, ".v2f-id rect not measurable");

  // ---- G4: click SPONSOR -> expands (HO 627 §4)
  await collapseAll(page, gi);
  const spRect = await rectOf(page, gi, "a.v2f-sponsor");
  if (spRect) {
    const urlBefore = page.url();
    await clickCentre(page, spRect);
    const opened = await isOpen(page, gi);
    record(`${label} click SPONSOR link expands`, opened && page.url() === urlBefore, `open=${opened}`);
  } else {
    record(`${label} click SPONSOR link expands`, true, "no linked sponsor on this row (plain span) — n/a");
  }

  // ---- G5: keyboard Enter -> expands
  await collapseAll(page, gi);
  await page.evaluate((i) => {
    const row = document.querySelectorAll(".v2f-group")[i]?.querySelector(".v2f-row") as HTMLElement;
    row?.focus();
  }, gi);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(220);
  const enterOpen = await isOpen(page, gi);
  record(`${label} Enter expands`, enterOpen, `open=${enterOpen}`);

  // ---- G6: Space -> toggles
  await page.keyboard.press(" ");
  await page.waitForTimeout(220);
  const spaceClosed = !(await isOpen(page, gi));
  record(`${label} Space toggles`, spaceClosed, `closed-again=${spaceClosed}`);

  // ---- G7: the panel's -> FULL PAGE drill navigates
  await collapseAll(page, gi);
  const idRect3 = await rectOf(page, gi, ".v2f-id");
  if (idRect3) await clickCentre(page, idRect3);
  await page.waitForTimeout(400);
  const drill = await rectOf(page, gi, ".bxp-head-drill");
  if (drill) {
    // Is it actually reachable without hunting? Report its offset from the row.
    const rowRect = await rectOf(page, gi, ".v2f-row");
    const dy = rowRect ? Math.round(drill.y - (rowRect.y + rowRect.h)) : -1;
    await clickCentre(page, drill);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(600);
    const ok = /\/bill\//.test(page.url());
    record(`${label} panel -> FULL PAGE navigates`, ok, `${dy}px below the row · url=${page.url().replace(BASE_URL, "")}`);
  } else {
    record(`${label} panel -> FULL PAGE navigates`, false, ".bxp-head-drill not found in the open panel");
  }

  await page.close();
}

async function main(): Promise<number> {
  console.log("=== HO 627 COMMIT 0 GATE — clicking the pixels users click ===");
  console.log(`    base: ${BASE_URL}\n`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: "reduce" });
  await ctx.addCookies([GATE_COOKIE]);
  await ctx.addInitScript(NAME_SHIM);

  for (const { label, w, h } of WIDTHS) {
    try {
      await runWidth(ctx, label, w, h);
    } catch (e) {
      record(`${label} harness`, false, String(e).slice(0, 160));
    }
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${"─".repeat(70)}`);
  console.log(`GATE: ${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log(`   FAIL  ${f.name} — ${f.detail}`);
  return failed.length === 0 ? 0 : 1;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
