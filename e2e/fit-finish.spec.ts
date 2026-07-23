import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

// HO 472 — the CDP-interaction half the HO 240/379 audits never reached. Drives
// clicks / hovers / modals / Esc / expanders / filters across every live surface
// plus the four aggregate surfaces (/amendments, /nominations, /lobbying,
// /trades) that shipped after the HO 379 crawler and have never been in any
// interaction sweep. Findings-only — this ships zero fixes.
//
// RUN LOCAL, not headless-prod (playwright.config.ts default is prod):
//   npm run build && npm start           (or: set -a; . ./.env; set +a; next start)
//   BASE_URL=http://localhost:3000 npx playwright test e2e/fit-finish.spec.ts
//
// Two reasons it can't run headless-on-prod (HO 472 §2):
//  - BotID withholds the markets tape from headless prod → every tape-hover finds
//    an empty tape. Local renders it.
//  - Hover cards / tooltips / portaled popovers need a real interactive browser.
//
// LOCAL CAVEAT (do NOT file as findings): the local server reads hosted Turso
// (us-west-2), so /changes and /patterns can 500 from localhost purely on the
// DB round-trip vs the 10s bound (both 200 on prod from co-located pdx1). They
// are kept OUT of this suite and covered by the Part-A prod crawler.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = "test-results/fit-finish";

const BILL = process.env.SEED_BILL ?? "119-s-2";
const MEMBER = process.env.SEED_MEMBER ?? "A000055";
const RACE = process.env.SEED_RACE ?? "AL-01-2026";
const COMMITTEE = process.env.SEED_COMMITTEE ?? "hlig00";
const REPORT = process.env.SEED_REPORT ?? "2026-06-15";

const GATE_COOKIE = { name: "ct_seen", value: "1", url: BASE_URL };

// Known-dormant console noise (HO 472 §4) — never file as a new finding.
// (A production build already suppresses React dev-only warnings like the
// FilingRow dup-key, but filter defensively in case the suite runs on dev.)
function isKnownNoise(text: string): boolean {
  return (
    /favicon\.ico|manifest\.webmanifest|apple-touch-icon/.test(text) ||
    /MissingSecret/.test(text) || // NextAuth AUTH_SECRET env OPEN LOOP
    /Encountered two children with the same key/.test(text) || // FilingRow dup-key (HO 463)
    /Download the React DevTools/.test(text) ||
    /\[Fast Refresh\]/.test(text)
  );
}

type Collected = { consoleErr: string[]; pageErr: string[]; bad: string[] };

function attachCollectors(page: Page): Collected {
  const c: Collected = { consoleErr: [], pageErr: [], bad: [] };
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (!isKnownNoise(t)) c.consoleErr.push(t);
  });
  page.on("pageerror", (err) => c.pageErr.push(err.message));
  page.on("response", (resp) => {
    const s = resp.status();
    if (s >= 400 && !isKnownNoise(resp.url())) c.bad.push(`${s} ${resp.url()}`);
  });
  return c;
}

function logClean(slug: string, c: Collected) {
  // eslint-disable-next-line no-console
  console.log(
    `[${slug}] console=${c.consoleErr.length} pageErr=${c.pageErr.length} bad=${c.bad.length}` +
      (c.consoleErr.length ? ` :: ${c.consoleErr.join(" | ")}` : "") +
      (c.pageErr.length ? ` :: PAGEERR ${c.pageErr.join(" | ")}` : ""),
  );
}

function assertClean(c: Collected, label: string) {
  expect.soft(c.consoleErr, `${label} console errors`).toEqual([]);
  expect.soft(c.pageErr, `${label} uncaught page errors`).toEqual([]);
  expect.soft(c.bad, `${label} 4xx/5xx subrequests`).toEqual([]);
}

async function settle(page: Page, ms = 2000) {
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(ms);
}

test.beforeAll(() => fs.mkdirSync(SHOT_DIR, { recursive: true }));

test.use({ storageState: { cookies: [], origins: [] } });
test.beforeEach(async ({ context }) => {
  await context.addCookies([GATE_COOKIE]);
});

// ─────────────────────────────────────────────────────────────────────────────
// HOME (/) — the live v2 dashboard
// ─────────────────────────────────────────────────────────────────────────────
test.describe("home /", () => {
  test("feed row expand: single-open invariant + re-click + Esc close", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const rows = page.locator(".v2f-row");
    const n = await rows.count();
    expect(n, "home feed should have v2f rows").toBeGreaterThan(1);

    // open first
    await rows.nth(0).click();
    await expect(page.locator(".v2f-group.open .bxp").first()).toBeVisible({ timeout: 15_000 });
    await expect(rows.nth(0)).toHaveAttribute("aria-expanded", "true");
    // open second — first must close (single-open)
    await rows.nth(1).click();
    await expect(page.locator(".v2f-group.open")).toHaveCount(1, { timeout: 8_000 });
    await expect(rows.nth(1)).toHaveAttribute("aria-expanded", "true");
    await expect(rows.nth(0)).toHaveAttribute("aria-expanded", "false");
    // re-click closes
    await rows.nth(1).click();
    await expect(page.locator(".v2f-group.open")).toHaveCount(0, { timeout: 8_000 });
    // Esc closes an open row
    await rows.nth(0).click();
    await expect(page.locator(".v2f-group.open")).toHaveCount(1, { timeout: 8_000 });
    await page.keyboard.press("Escape");
    // HO 473 — Esc now closes the open row (useSingleOpenPanel keydown handler).
    await expect(page.locator(".v2f-group.open"), "Esc should close an expanded feed row").toHaveCount(
      0,
      { timeout: 4_000 },
    );

    await page.screenshot({ path: `${SHOT_DIR}/home-feed-expand.png`, fullPage: true });
    logClean("home-feed-expand", c);
    assertClean(c, "home feed expand");
  });

  test("feed id chip navigates to /bill/[id]; body click expands", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const firstGroup = page.locator(".v2f-group").first();
    const idChip = firstGroup.locator("a.bill-id-chip").first();
    await expect(idChip, "feed row should carry a bill-id-chip link").toBeVisible({ timeout: 15_000 });
    const href = await idChip.getAttribute("href");
    expect(href, "id chip should link to a bill detail").toMatch(/^\/bill\//);
    // id-click navigates (stopPropagation means the row does NOT expand)
    await idChip.click();
    await page.waitForURL(/\/bill\//, { timeout: 15_000 }).catch(() => {});
    expect(page.url(), "id chip click should navigate to /bill/[id]").toContain("/bill/");
    logClean("home-id-chip-nav", c);
    assertClean(c, "home id-chip nav");
  });

  test("markets tape hover → portaled detail popover appears + on-screen", async ({ page }) => {
    test.slow(); // heavy dashboard + the marquee-freeze settle
    const c = attachCollectors(page);
    // Freeze the marquee at translateX(0): set reduced-motion BEFORE nav so the
    // track never starts animating, keeping items in source order and static.
    // (The "freeze the marquee for the B2-hover check" CI-hardening HO 379 names.)
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page, 2500);
    // Belt-and-suspenders: pause any running track so it's provably stable for
    // Playwright's actionability check (reduced-motion alone was racy under load).
    await page.addStyleTag({
      content: ".markets-tape-track { animation-play-state: paused !important; }",
    });
    await page.waitForTimeout(300);
    const items = page.locator(".markets-tape-item");
    const n = await items.count();
    if (n === 0) {
      test.info().annotations.push({
        type: "flag",
        description: "markets tape rendered 0 items on LOCAL — unexpected (BotID is prod-only). Investigate the tape data path.",
      });
      // eslint-disable-next-line no-console
      console.log("[home-tape-hover] FLAG: 0 tape items on local");
      test.skip(true, "no tape items locally");
      return;
    }
    // Pick the first item whose box clears the pinned MARKETS/ODDS label (opaque,
    // absolute, overlays the leftmost items) and sits within the viewport — a
    // normal hover on it fires onMouseEnter deterministically.
    const vp = page.viewportSize();
    let target = items.first();
    for (let i = 0; i < Math.min(n, 14); i++) {
      const box = await items.nth(i).boundingBox();
      if (box && box.x > 130 && vp && box.x + box.width < vp.width) {
        target = items.nth(i);
        break;
      }
    }
    await target.hover();
    const detail = page.locator(".markets-tape-detail--portal");
    await expect(detail, "hover-detail popover should appear").toBeVisible({ timeout: 8_000 });
    // clip check: portaled box must sit within the viewport (HO 375 fix)
    const box = await detail.boundingBox();
    if (box && vp) {
      expect.soft(box.x, "tape detail not clipped left").toBeGreaterThanOrEqual(-1);
      expect.soft(box.y, "tape detail not clipped top (clear of masthead)").toBeGreaterThanOrEqual(-1);
      expect.soft(box.x + box.width, "tape detail not clipped right").toBeLessThanOrEqual(vp.width + 1);
      expect.soft(box.y + box.height, "tape detail not clipped bottom").toBeLessThanOrEqual(vp.height + 1);
    }
    await page.screenshot({ path: `${SHOT_DIR}/home-tape-hover.png` });
    logClean("home-tape-hover", c);
    assertClean(c, "home tape hover");
  });

  test("WeeklyBand metric hover → portaled card", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const metric = page.locator(".wb-metric").first();
    const n = await metric.count();
    if (n === 0) {
      test.skip(true, "no wb-metric present");
      return;
    }
    await metric.hover();
    await expect(page.locator(".wb-card").first(), "weekly-band hover card should appear").toBeVisible({
      timeout: 6_000,
    });
    logClean("home-weeklyband-hover", c);
    assertClean(c, "home weeklyband hover");
  });

  test("distributions click-to-filter: stage bar rebases ?stage= + × Clear resets", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const bar = page.locator("a.stage-funnel-row").first();
    await expect(bar, "a stage funnel row should be present").toBeVisible({ timeout: 15_000 });
    await bar.click();
    await page.waitForURL(/[?&]stage=/, { timeout: 10_000 }).catch(() => {});
    expect(page.url(), "clicking a stage bar should push ?stage=").toMatch(/[?&]stage=/);
    const strip = page.locator(".active-filter-strip");
    await expect(strip, "ActiveFilterStrip should render when filtered").toBeVisible({ timeout: 8_000 });
    // × Clear resets to /
    await page.locator("a.active-filter-link", { hasText: "Clear" }).first().click();
    await page.waitForURL((u) => !/[?&]stage=/.test(u.toString()), { timeout: 8_000 }).catch(() => {});
    expect.soft(page.url(), "× Clear should drop the stage filter").not.toMatch(/[?&]stage=/);
    logClean("home-distributions-filter", c);
    assertClean(c, "home distributions filter");
  });

  test("HEARINGS|RACES tab switch + opening RACES stamps cbt:racesLastView", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const tabs = page.locator("button.dv2-racesbox-tab");
    const cnt = await tabs.count();
    if (cnt < 2) {
      test.skip(true, "races box tabs not present");
      return;
    }
    // open RACES tab (by text)
    await tabs.filter({ hasText: "Races" }).first().click();
    await page.waitForTimeout(500);
    await expect(
      page.locator(".dv2-racesbox-panel--races"),
      "RACES panel should be visible after tab click",
    ).toBeVisible();
    const stamp = await page.evaluate(() => window.localStorage.getItem("cbt:racesLastView"));
    expect.soft(stamp, "opening RACES should stamp cbt:racesLastView").not.toBeNull();
    // switch back to hearings
    await tabs.filter({ hasText: "Hearings" }).first().click();
    await page.waitForTimeout(300);
    logClean("home-races-tabs", c);
    assertClean(c, "home races tabs");
  });

  test("sponsor hover card renders inside the expand panel", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    // open a row that has a resolved sponsor link
    const rows = page.locator(".v2f-row");
    const count = Math.min(await rows.count(), 6);
    let found = false;
    for (let i = 0; i < count; i++) {
      await rows.nth(i).click();
      const panel = page.locator(".v2f-group.open .bxp").first();
      await expect(panel).toBeVisible({ timeout: 10_000 });
      const sponsor = panel.locator("a.bxp-sponsor-name").first();
      if (await sponsor.count()) {
        await sponsor.hover();
        const card = page.locator(".v2f-sc-card").first();
        if (await card.count()) {
          await expect(card, "sponsor hover card should appear").toBeVisible({ timeout: 4_000 });
          found = true;
          break;
        }
      }
      await rows.nth(i).click(); // close before next
    }
    if (!found) {
      test.info().annotations.push({
        type: "note",
        description: "no resolved-sponsor row in first 6 feed rows — sponsor card not exercised (not a finding).",
      });
    }
    logClean("home-sponsor-hover", c);
    assertClean(c, "home sponsor hover");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /electoral — the modal-heavy surface
// ─────────────────────────────────────────────────────────────────────────────
test.describe("electoral /electoral", () => {
  test("state click → RaceDistrictModal opens, confined to viewport, Esc closes", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/electoral", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const cell = page.locator("svg.us-map path.us-map-state").first();
    const n = await cell.count();
    if (n === 0) {
      test.info().annotations.push({ type: "flag", description: "no clickable us-map-state on /electoral (map default view?)" });
      test.skip(true, "no clickable map state");
      return;
    }
    await cell.click({ force: true });
    const panel = page.locator(".rdm-panel");
    await expect(panel, "district modal should open").toBeVisible({ timeout: 10_000 });
    // confinement (recurring clip bug)
    const vp = page.viewportSize();
    const box = await panel.boundingBox();
    expect(box, "modal should have a box").not.toBeNull();
    if (box && vp) {
      expect.soft(box.x, "modal not clipped left").toBeGreaterThanOrEqual(-1);
      expect.soft(box.y, "modal not clipped top").toBeGreaterThanOrEqual(-1);
      expect.soft(box.x + box.width, "modal not clipped right").toBeLessThanOrEqual(vp.width + 1);
    }
    await page.screenshot({ path: `${SHOT_DIR}/electoral-modal.png` });
    // Esc closes
    await page.keyboard.press("Escape");
    await expect(panel, "Esc should close the district modal").toBeHidden({ timeout: 6_000 });
    logClean("electoral-modal", c);
    assertClean(c, "electoral modal");
  });

  test("primary timeline bar click locks a date + CLEAR ALL resets", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/electoral", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const bars = page.locator(".electoral-tl-band rect[role='button']");
    const n = await bars.count();
    if (n === 0) {
      test.skip(true, "no timeline bars present");
      return;
    }
    await bars.first().click();
    await expect(bars.first(), "clicked bar should read aria-pressed=true").toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 6_000 },
    );
    const clear = page.locator("button.electoral-readout-clear");
    await expect(clear, "CLEAR ALL should appear after a lock").toBeVisible({ timeout: 6_000 });
    await clear.click();
    await expect(bars.first(), "CLEAR ALL should un-press bars").toHaveAttribute("aria-pressed", "false", {
      timeout: 6_000,
    });
    logClean("electoral-timeline", c);
    assertClean(c, "electoral timeline");
  });

  test("MAP/LIST toggle → RaceListView accordion single-open", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/electoral", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const listBtn = page.locator("button.cart-viewtoggle-btn", { hasText: "LIST" });
    if (!(await listBtn.count())) {
      test.skip(true, "no MAP/LIST toggle");
      return;
    }
    await listBtn.click();
    const rows = page.locator(".race-list-row");
    await expect(rows.first(), "list rows should render").toBeVisible({ timeout: 8_000 });
    await rows.nth(0).click();
    await expect(page.locator(".race-list-expand")).toHaveCount(1, { timeout: 6_000 });
    await rows.nth(1).click();
    await expect(page.locator(".race-list-expand"), "single-open across the list").toHaveCount(1, {
      timeout: 6_000,
    });
    logClean("electoral-list", c);
    assertClean(c, "electoral list");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate surfaces — never crawled before (HO 461/456/437/389)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("aggregate surfaces", () => {
  test("/amendments loads clean + type/disposition chips rebase", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/amendments", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    await page.screenshot({ path: `${SHOT_DIR}/amendments.png`, fullPage: true });
    // a disposition chip should rebase ?disposition=
    const acted = page.getByRole("link", { name: /^Acted$/ }).first();
    if (await acted.count()) {
      await acted.click();
      await page.waitForURL(/[?&]disposition=acted/, { timeout: 8_000 }).catch(() => {});
      expect.soft(page.url(), "Acted chip should rebase ?disposition=acted").toMatch(/disposition=acted/);
    }
    // dead-affordance note: the status hero segments are non-interactive <div>
    // (title-only), unlike /nominations where the strip segments are <Link>s.
    const heroSegClickable = await page
      .locator("section.mb-5 a[href*='disposition']")
      .first()
      .count();
    // eslint-disable-next-line no-console
    console.log(`[amendments] hero-strip clickable segments = ${heroSegClickable} (nominations strip is clickable)`);
    logClean("amendments", c);
    assertClean(c, "/amendments");
  });

  test("/nominations loads clean + disposition strip + agency facet rebase", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/nominations", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    await page.screenshot({ path: `${SHOT_DIR}/nominations.png`, fullPage: true });
    // agency facet row rebases ?agency=
    const facet = page.locator("section.mb-5 a[href*='agency=']").first();
    if (await facet.count()) {
      await facet.click();
      await page.waitForURL(/[?&]agency=/, { timeout: 8_000 }).catch(() => {});
      expect.soft(page.url(), "agency facet should rebase ?agency=").toMatch(/agency=/);
      // removable chip present + clears
      const clear = page.getByRole("link", { name: /^clear$/ }).first();
      if (await clear.count()) {
        await clear.click();
        await page.waitForURL("**/nominations", { timeout: 8_000 }).catch(() => {});
      }
    }
    logClean("nominations", c);
    assertClean(c, "/nominations");
  });

  test("/lobbying loads clean + issue drill + topic-crosswalk expand → code chip", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/lobbying", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    await page.screenshot({ path: `${SHOT_DIR}/lobbying.png`, fullPage: true });
    // issue bar drill rebases ?issue=
    const issueBar = page.locator(".patterns-left a[href*='issue=']").first();
    if (await issueBar.count()) {
      await issueBar.click();
      await page.waitForURL(/[?&]issue=/, { timeout: 8_000 }).catch(() => {});
      expect.soft(page.url(), "issue bar should rebase ?issue=").toMatch(/issue=/);
    }
    // BY-CBT-TOPIC crosswalk: expand a topic, then click a constituent code chip
    const topicBtn = page.locator("button[aria-expanded]").filter({ hasText: /·|\d/ }).first();
    const anyTopicBtn = page.locator("section.mt-6 button[aria-expanded]:not([disabled])").first();
    const btn = (await anyTopicBtn.count()) ? anyTopicBtn : topicBtn;
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(400);
      const codeChip = page.locator("a[href*='#lobby-drill']").first();
      if (await codeChip.count()) {
        await codeChip.click();
        await page.waitForTimeout(600);
        // #lobby-drill should be scrolled into view
        const drill = page.locator("#lobby-drill");
        const inView = await drill.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.top < window.innerHeight && r.bottom > 0;
        });
        expect.soft(inView, "clicking a crosswalk code chip should scroll #lobby-drill into view").toBe(true);
      }
    }
    logClean("lobbying", c);
    assertClean(c, "/lobbying");
  });

  test("/lobbying: pagination preserves the selected ?issue=", async ({ page }) => {
    const c = attachCollectors(page);
    // land already-filtered, then page the recent-filings feed
    await page.goto("/lobbying?issue=HCR", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const next = page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: /NEXT/ });
    if (!(await next.count())) {
      test.skip(true, "no pagination on /lobbying feed");
      return;
    }
    await next.first().click();
    await page.waitForURL(/[?&]page=/, { timeout: 8_000 }).catch(() => {});
    // HO 473 — pagination now preserves the selected ?issue= (populated carry).
    expect(page.url(), "pagination should preserve the selected ?issue=").toMatch(/issue=/);
    // eslint-disable-next-line no-console
    console.log(`[lobbying-pagination] url after NEXT = ${page.url()}`);
    logClean("lobbying-pagination", c);
    assertClean(c, "/lobbying pagination");
  });

  test("/trades loads clean + rollup + member link navigates to hub", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/trades", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    await page.screenshot({ path: `${SHOT_DIR}/trades.png`, fullPage: true });
    const memberLink = page.locator("a.trade-member, .trade-member a").first();
    if (await memberLink.count()) {
      const href = await memberLink.getAttribute("href");
      expect.soft(href, "trade member link should point at a member hub").toMatch(/^\/members\//);
    }
    logClean("trades", c);
    assertClean(c, "/trades");
  });

  test("/trades?member= scopes cleanly (rollup suppressed, back-link present)", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto(`/trades?member=${MEMBER}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const back = page.getByRole("link", { name: /All trades/ });
    await expect.soft(back, "scoped /trades should show a back-to-all link").toBeVisible({ timeout: 6_000 });
    logClean("trades-scoped", c);
    assertClean(c, "/trades?member=");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Detail pages
// ─────────────────────────────────────────────────────────────────────────────
test.describe("detail pages", () => {
  for (const [slug, path] of [
    ["bill", `/bill/${BILL}`],
    ["member", `/members/${MEMBER}`],
    ["committee", `/committee/${COMMITTEE}`],
    ["report", `/reports/${REPORT}`],
    ["race", `/race/${RACE}`],
  ] as const) {
    test(`${slug} detail loads clean`, async ({ page }) => {
      const c = attachCollectors(page);
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await settle(page);
      await page.screenshot({ path: `${SHOT_DIR}/detail-${slug}.png`, fullPage: true });
      logClean(`detail-${slug}`, c);
      assertClean(c, `${slug} detail`);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// /members — two-pane browser + ideology surfaces
// ─────────────────────────────────────────────────────────────────────────────
test.describe("members /members", () => {
  test("members browser + committee-scoped roster render clean", async ({ page }) => {
    test.slow(); // /members is heavy (unpaginated roster + ideology) from localhost
    const c = attachCollectors(page);
    await page.goto("/members", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    // the committee rail rows scope via onClick router.push (div[role=button]);
    // their nested "committee detail →" <a> links to /committee/[code] — assert
    // the rail rendered by those.
    const railCount = await page.locator("a[href^='/committee/']").count();
    expect.soft(railCount, "committee rail should render /committee/ detail links").toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOT_DIR}/members.png` }); // viewport-only (page is very tall)
    logClean("members", c);
    assertClean(c, "/members");
  });

  test("members committee-scoped view renders clean", async ({ page }) => {
    const c = attachCollectors(page);
    // direct-nav the scoped view (avoids compounding two heavy renders in one test)
    const resp = await page.goto(`/members?committee=${COMMITTEE}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await settle(page);
    expect.soft(resp?.status(), "scoped /members should be 200").toBe(200);
    logClean("members-scoped", c);
    assertClean(c, "/members?committee=");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lighter surfaces (console + one interaction each)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("lighter surfaces", () => {
  test("/stale + INCLUDE PROCEDURAL toggle", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/stale", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const toggle = page.getByText(/procedural/i).first();
    if (await toggle.count()) await toggle.click().catch(() => {});
    await page.waitForTimeout(500);
    logClean("stale", c);
    assertClean(c, "/stale");
  });

  test("/hearings + calendar", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/hearings", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    logClean("hearings", c);
    assertClean(c, "/hearings");
  });

  test("/search tabs + query", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/search?q=tax&tab=bills", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    // switch a tab
    const membersTab = page.getByRole("link", { name: /members/i }).first();
    if (await membersTab.count()) await membersTab.click().catch(() => {});
    await page.waitForTimeout(500);
    logClean("search", c);
    assertClean(c, "/search");
  });

  test("/president loads clean", async ({ page }) => {
    const c = attachCollectors(page);
    const resp = await page.goto("/president", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    // HO 502: /president is a real page (HO 359), no longer the HO 151 redirect
    // to /bills?stage=president — same history as /news. assertClean only catches
    // >=400, so a silent regression back to a redirect would pass. Assert it
    // SERVES the page directly: 200, no redirect hop, and the president-specific
    // subhead (the /bills?stage=president alias renders the full feed, not this
    // line) so we prove the president surface rendered, not just that it answered.
    expect.soft(resp?.status(), "/president should serve 200").toBe(200);
    expect
      .soft(resp?.request().redirectedFrom(), "/president should not redirect")
      .toBeNull();
    await expect
      .soft(
        page.getByText(/racing the 10-day clock/i).first(),
        "/president surface rendered",
      )
      .toBeVisible();
    logClean("president", c);
    assertClean(c, "/president");
  });

  test("/news loads clean", async ({ page }) => {
    const c = attachCollectors(page);
    const resp = await page.goto("/news", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    // HO 502: /news is its own route now (HO 501). assertClean only catches
    // >=400, so a silent revert to a 307 → /bills?mode=news would pass — the
    // exact failure HO 501's redirect-loop guard exists to prevent, invisible
    // to this suite. Assert it SERVES the feed directly: 200, no redirect hop,
    // and a NewsFilters marker so we prove the news surface rendered (not a
    // bare 200 or a redirect to some other page).
    expect.soft(resp?.status(), "/news should serve 200").toBe(200);
    expect
      .soft(resp?.request().redirectedFrom(), "/news should not redirect")
      .toBeNull();
    await expect
      .soft(page.getByText(/most recent/i).first(), "/news feed rendered")
      .toBeVisible();
    logClean("news", c);
    assertClean(c, "/news");
  });

  test("/watchlist anonymous = empty/sign-in, not a 500", async ({ page }) => {
    const c = attachCollectors(page);
    const resp = await page.goto("/watchlist", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    expect.soft(resp?.status(), "/watchlist should not 500 anonymous").toBe(200);
    logClean("watchlist", c);
    assertClean(c, "/watchlist");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part C — the May-30 dropdown hunt (desktop 1280×800 + mobile 390×844)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("dropdown hunt (Part C)", () => {
  for (const vp of [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`/ dropdown controls at ${vp.name} ${vp.width}x${vp.height}`, async ({ page }) => {
      const c = attachCollectors(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
      await settle(page);
      const controls = page.locator("select, [role='combobox'], [role='listbox']");
      const n = await controls.count();
      // eslint-disable-next-line no-console
      console.log(`[dropdown-hunt ${vp.name}] found ${n} select/combobox/listbox controls on /`);
      for (let i = 0; i < n; i++) {
        const el = controls.nth(i);
        const tag = await el.evaluate((e) => e.tagName.toLowerCase());
        // exercise: a native <select> gets its options read; a combobox gets clicked
        if (tag === "select") {
          const opts = await el.locator("option").count();
          // eslint-disable-next-line no-console
          console.log(`[dropdown-hunt ${vp.name}] select#${i} options=${opts}`);
        } else {
          await el.click({ trial: true }).catch(() => {});
        }
      }
      await page.screenshot({ path: `${SHOT_DIR}/dropdown-${vp.name}.png`, fullPage: true });
      logClean(`dropdown-${vp.name}`, c);
      assertClean(c, `dropdown hunt ${vp.name}`);
    });
  }
});
