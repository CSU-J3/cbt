import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { isKnownNoise } from "./console-noise";

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
// HO 548 seeds (picked from prod Turso — see the ship report for each query):
// VOTE      — Senate roll call with member positions + a bill link (119-sjres-180).
// VOTE_BILL — a bill with BOTH own passage votes AND amendment votes (HO 542: 21
//             unique /vote links = 2 own + 19 amendment).
// NOVOTE_BILL — introduced-never-voted (votes(bill_id)=0 → no VOTES tab).
// TABS_MEMBER — a member hub with ≥1 zero-count tab (A000055: amendments=0, trades=0).
// FILING_UUID — the top-volume filing (31 activities, 27 clamped + 4 short) — reached
//             via ?sort=volume so it's on page 1 of the feed the ?expanded= renders.
const VOTE = process.env.SEED_VOTE ?? "senate-119-2-207";
const VOTE_BILL = process.env.SEED_VOTE_BILL ?? "119-hr-8800";
const NOVOTE_BILL = process.env.SEED_NOVOTE_BILL ?? "119-hr-3034";
const TABS_MEMBER = process.env.SEED_TABS_MEMBER ?? "A000055";
const FILING_UUID =
  process.env.SEED_FILING_UUID ?? "cd77f510-f0d8-416b-a11c-b304e8653c7d";

const GATE_COOKIE = { name: "ct_seen", value: "1", url: BASE_URL };

// Console-noise allowlist extracted to ./console-noise (HO 504) — shared with
// smoke.spec.ts so the two crawlers can't drift. See that file for per-entry
// provenance (MissingSecret + FilingRow dup-key are open loops).

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

  // HO 655 — this test used to be titled "feed id chip navigates to /bill/[id];
  // body click expands" and asserted exactly that. Both halves were rot:
  //   · the SELECTOR (a.bill-id-chip) stopped rendering here when the v2 row
  //     swapped the bordered chip for plain amber id text (C3) — the row uses
  //     a.v2f-id now, and BillIdChip is still live on other surfaces;
  //   · the BEHAVIOUR was deliberately reversed (HO 609/613/627) — a plain
  //     click now EXPANDS the row rather than navigating.
  // Repointing the selector alone would have satisfied the old line 143 and
  // failed four lines later, where it reads as an app regression rather than as
  // a stale fixture. The contract below is the current one, and it is richer
  // than the one it replaces: the third leg (modified click navigates AND does
  // not also expand) had no spec coverage at all.
  test("feed id: plain click expands the row; modified click opens /bill/[id] in a new tab", async ({
    page,
    context,
  }) => {
    const c = attachCollectors(page);
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const firstGroup = page.locator(".v2f-group").first();
    const id = firstGroup.locator("a.v2f-id").first();

    // (1) still a REAL link — this is the new-tab / copy-link / a11y guarantee
    // the component comment claims, and it is what makes leg 3 meaningful.
    await expect(id, "feed row should carry an id link").toBeVisible({ timeout: 15_000 });
    const href = await id.getAttribute("href");
    expect(href, "row id should link to a bill detail").toMatch(/^\/bill\//);

    // (2) PLAIN click expands, does not navigate.
    const urlBefore = page.url();
    await id.click();
    await page.waitForTimeout(600);
    expect(page.url(), "a plain id click must NOT navigate").toBe(urlBefore);
    await expect(
      page.locator(".v2f-group.open"),
      "a plain id click must expand exactly one row",
    ).toHaveCount(1);

    // (3) MODIFIED click navigates in a new tab and must NOT also expand. The
    // second half is the mirrored defect rowLinkClick's stopPropagation exists
    // to prevent (open in a background tab AND leave the row expanded) — assert
    // it, or the guard is untested and its removal reads green.
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const id2 = page.locator(".v2f-group").first().locator("a.v2f-id").first();
    await expect(id2).toBeVisible({ timeout: 15_000 });
    const popupP = context.waitForEvent("page", { timeout: 10_000 });
    await id2.click({ modifiers: ["ControlOrMeta"] });
    const popup = await popupP;
    // The page event fires while the new tab is still about:blank, so WAIT for
    // the navigation rather than sampling popup.url() — reading it immediately
    // is a race that reports about:blank on a working app.
    await popup.waitForURL(/\/bill\//, { timeout: 15_000 });
    expect(popup.url(), "a modified id click should open the bill detail").toContain("/bill/");
    await expect(
      page.locator(".v2f-group.open"),
      "a modified id click must NOT also expand the row",
    ).toHaveCount(0);
    await popup.close();

    logClean("home-id-click-contract", c);
    assertClean(c, "home id click contract");
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

  // HO 681 — ONE Fed-cut horizon on the ODDS strip.
  //
  // Why this lives here and NOT in smoke.spec.ts, which is the suite that
  // actually runs unattended: BotID withholds the markets tape from headless
  // prod, so `.markets-tape-item` reads 0 there and smoke's tape test
  // `test.skip`s on empty. An odds-count assertion behind that skip would be
  // STRUCTURALLY INCAPABLE OF FIRING on prod and would report green forever —
  // the skip-on-empty inversion this repo has already been bitten by. Local is
  // the only place the strip renders, so local is the only place the gate is
  // real. Cost, stated plainly: it is a manual gate, not a CI one.
  //
  // The count is DERIVED FROM THE DOM, not hardcoded, because the live tape
  // picks its repeat count by measurement — `copies = max(2, ceil(container /
  // setWidth))` per half — so it varies with viewport. SHUTDOWN is the
  // reference: it is the one ODDS pair that has always been singular, so
  // "FED CUT appears exactly as often as SHUTDOWN" says one horizon regardless
  // of how many copies the marquee laid down.
  //
  // Reading at c84c02f (pre-change): FED CUT was 2x SHUTDOWN. That is the
  // failure mode, which is what makes this a gate rather than a decoration.
  test("ODDS strip carries ONE FED CUT per marquee copy", async ({ page }) => {
    test.slow();
    const c = attachCollectors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page, 2500);
    await page.addStyleTag({
      content: ".markets-tape-track { animation-play-state: paused !important; }",
    });
    await page.waitForTimeout(300);

    const texts = await page.locator(".markets-tape-item").allTextContents();
    // An empty tape is a REGRESSION here, not a variability to skip past: on
    // local there is no BotID and the strip is server-fed from market_ticks.
    expect(texts.length, "tape rendered items on local").toBeGreaterThan(0);

    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    const fedCut = texts.filter((t) => norm(t).startsWith("FED CUT"));
    const shutdown = texts.filter((t) => norm(t).startsWith("SHUTDOWN"));

    // eslint-disable-next-line no-console
    console.log(
      `[odds-one-fedcut] / → items=${texts.length} FED CUT=${fedCut.length} SHUTDOWN=${shutdown.length}` +
        ` | sample=${JSON.stringify(fedCut.slice(0, 2).map(norm))}`,
    );

    expect(shutdown.length, "SHUTDOWN reference pair present").toBeGreaterThan(0);
    expect(
      fedCut.length,
      "exactly one FED CUT per marquee copy (was 2x SHUTDOWN at c84c02f)",
    ).toBe(shutdown.length);

    await page.screenshot({ path: `${SHOT_DIR}/odds-one-fedcut-home.png` });
    logClean("odds-one-fedcut-home", c);
    assertClean(c, "odds one fedcut home");
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

  // HO 684 — THE BADGE'S REFERENT. The RACES tab advertises `MOVES n` / `NEW n`;
  // this asserts that clicking it opens a panel actually carrying n markers.
  //
  // It is a SIBLING of the stamp test above rather than an addition to it,
  // deliberately: that test asserts the CAUSE (the localStorage stamp lands) and
  // is exactly the shape HO 684 was filed against — the one e2e in the area
  // verified the mechanism that was destroying the artifact, so the artifact's
  // absence was invisible to it for ~250 handoffs. It stays green as written.
  //
  // NO SKIP-ON-EMPTY. The branch is LOGGED either way — `chips gate: armed
  // moves=X new=Y` or `chips gate: unarmed (badges 0)` — because a zero reading
  // here is same-as-success: if no featured seat has any move or news history at
  // run time, both the pre-click badges and the post-click chips are 0 and the
  // assertion passes without having tested anything. That reading is
  // UNAVAILABLE, not green, and the log line is the only thing that separates
  // them (docs/method.md § Gates). Measured on prod at HO 684: MOVES 3 / NEW 6,
  // sum 9 — so the armed branch is the expected one, and the unarmed branch is a
  // named contingency rather than a hope.
  //
  // The context is fresh per Playwright test, so localStorage carries no stamp:
  // lastViewMs hydrates to 0 and every real move/news item registers.
  test("opening RACES leaves the chips the badge counted on screen", async ({
    page,
  }) => {
    const c = attachCollectors(page);
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);

    const tabs = page.locator("button.dv2-racesbox-tab");
    await expect(
      tabs.first(),
      "races box tabs should render on / — the races box is not optional here",
    ).toBeVisible({ timeout: 15_000 });

    // Pre-click badge counts. Absent badge = 0 (RacesBoxTabs renders the span
    // only when the count is > 0), which is a real reading, not a missing one.
    const badgeCount = async (cls: string) => {
      const el = page.locator(`.${cls}`);
      if ((await el.count()) === 0) return 0;
      const txt = (await el.first().textContent()) ?? "";
      const m = txt.match(/(\d+)/);
      return m?.[1] ? Number(m[1]) : 0;
    };
    const moves = await badgeCount("rbx-badge-moves");
    const news = await badgeCount("rbx-badge-new");
    const promised = moves + news;

    if (promised === 0) {
      console.log("chips gate: unarmed (badges 0) — reading is UNAVAILABLE, not a pass");
    } else {
      console.log(`chips gate: armed moves=${moves} new=${news}`);
    }

    await tabs.filter({ hasText: "Races" }).first().click();
    await page.waitForTimeout(600);
    await expect(
      page.locator(".dv2-racesbox-panel--races"),
      "RACES panel should be visible after the tab click",
    ).toBeVisible();

    const shown =
      (await page.locator(".rc-moved:visible").count()) +
      (await page.locator(".rc-new:visible").count());

    console.log(`chips gate: promised=${promised} shown=${shown}`);
    expect(
      shown,
      `the RACES tab promised ${promised} update(s) (MOVES ${moves} + NEW ${news}); ` +
        `the opened panel shows ${shown} chip(s). A click that acknowledges N ` +
        `updates must not delete the evidence for them.`,
    ).toBe(promised);

    // The badges themselves must still clear on open — the HO 684 split is only
    // correct if the acknowledge half is untouched.
    expect
      .soft(
        await badgeCount("rbx-badge-moves"),
        "MOVES badge should clear on open",
      )
      .toBe(0);
    expect
      .soft(await badgeCount("rbx-badge-new"), "NEW badge should clear on open")
      .toBe(0);

    logClean("home-races-chips", c);
    assertClean(c, "home races chips");
  });

  // HO 682 — the document must not scroll horizontally on `/`, at either width,
  // in either tab state.
  //
  // THE INVARIANT IS THE DURABLE FORM OF THE GATE; THE CAPTURE IS NOT. The
  // defect this closes was latent from the component's build and armed by the
  // DATA: on 2026-09-02 a markup whose published Congress.gov title is the full
  // semicolon-joined ten-measure list landed on the shown day, the nowrap title
  // set the grid track's min-content, and the document went 6719 wide against a
  // 2560 viewport. The mandated 1440/2560 captures passed at HO 610 and HO 670
  // because a capture is about the data on the table that day, and no long title
  // was on the table on those days. So this assertion is deliberately about the
  // PAGE and not about hearings: it holds after today's row rotates out, and it
  // fires on the next unbounded string anywhere on `/`.
  //
  // Both tab states, because the two panels are different subtrees and only one
  // of them is mounted at a time. No skip-on-empty guard: the races box is not
  // optional on `/`, so absent tabs are a regression, not a reason to go green
  // (docs/method.md § Gates).
  test("/ does not scroll horizontally at 1440 or 2560, in either tab state", async ({ page }) => {
    const c = attachCollectors(page);

    const readDoc = () =>
      page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));

    for (const width of [1440, 2560]) {
      await page.setViewportSize({ width, height: 1400 });
      await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
      await settle(page);

      const tabs = page.locator("button.dv2-racesbox-tab");
      await expect(
        tabs.first(),
        `races box tabs should render on / at ${width}`,
      ).toBeVisible({ timeout: 15_000 });

      for (const tab of ["Hearings", "Races"]) {
        await tabs.filter({ hasText: tab }).first().click();
        await page.waitForTimeout(500);
        const d = await readDoc();
        expect(
          d.scrollWidth,
          `/ at ${width} on the ${tab} tab must not overflow the document scroller ` +
            `(scrollWidth ${d.scrollWidth} vs clientWidth ${d.clientWidth})`,
        ).toBeLessThanOrEqual(d.clientWidth);
      }
    }

    logClean("home-no-horizontal-scroll", c);
    assertClean(c, "home horizontal scroll");
  });

  // HO 673 — REPLACES "sponsor hover card renders inside the expand panel".
  //
  // The test this supersedes asserted the portrait appeared ON HOVER, and it
  // guarded the assertion with `if (await card.count())`. That guard made it
  // green-on-deletion: remove `.v2f-sc-card` and the count is 0, the assertion
  // never runs, and the test passes while annotating itself "not a finding" —
  // the check reads the same whether the work was done or never existed
  // (docs/method.md § Gates). HO 673 removes that card, so the replacement
  // asserts the OPPOSITE property and carries no skip-on-empty guard:
  //   - the portrait is visible WITHOUT any hover, and
  //   - a run that finds no resolved-sponsor row FAILS rather than annotating.
  test("sponsor portrait is always on inside the expand panel", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);

    const rows = page.locator(".v2f-row");
    const count = Math.min(await rows.count(), 6);
    expect(count, "feed should render rows to open").toBeGreaterThan(0);

    let sponsorRows = 0;
    for (let i = 0; i < count; i++) {
      await rows.nth(i).click();
      const panel = page.locator(".v2f-group.open .bxp").first();
      await expect(panel).toBeVisible({ timeout: 10_000 });

      const sponsor = panel.locator(".bxp-sponsor").first();
      if (await sponsor.count()) {
        sponsorRows++;
        // The portrait must be visible with NO hover and NO focus. Deliberately
        // asserted before any pointer interaction with the sponsor block.
        const photo = sponsor.locator(".bxp-sponsor-photo").first();
        await expect(
          photo,
          "sponsor portrait should be visible without hovering",
        ).toBeVisible({ timeout: 4_000 });

        // The re-homed field: the retired hover card was the ONLY place full
        // state name + chamber rendered (the bracket carries "[D-NV-4]" only).
        await expect(
          sponsor.locator(".bxp-sponsor-meta").first(),
          "state/chamber line should survive the hover-card retirement",
        ).toBeVisible({ timeout: 4_000 });

        // The retired card must be gone, not merely hidden.
        expect(
          await page.locator(".v2f-sc-card").count(),
          "retired sponsor hover card should not be in the DOM",
        ).toBe(0);
        break;
      }
      await rows.nth(i).click(); // close before next
    }

    // No skip-on-empty: if nothing was exercised, that is a failure, not a note.
    expect(
      sponsorRows,
      `no resolved-sponsor row in first ${count} feed rows — portrait not exercised`,
    ).toBeGreaterThan(0);

    logClean("home-sponsor-portrait", c);
    assertClean(c, "home sponsor portrait");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /welcome — its own tape markup, so its own assertion (HO 681)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("welcome /welcome", () => {
  // /welcome renders its OWN strip — bespoke markup in app/welcome/page.tsx,
  // NOT the shared MarketsTape client island — so it needs its own assertion
  // rather than riding the `/` one above. Two differences that matter:
  // its copy count is a SERVER CONSTANT (2 halves x ODDS_COPIES_PER_HALF = 6,
  // because a server-rendered strip cannot measure and so overshoots), and it
  // labels from MARKET_SYMBOLS[].label rather than `showMonth`, so the string
  // is "FED CUT ODDS" and never "FED CUT SEP".
  //
  // Reading at c84c02f (pre-change): 12 — six "FED CUT ODDS" and six
  // "FED CUT ODDS (SEP)", visually distinct while carrying identical numbers.
  test("/welcome ODDS strip carries ONE FED CUT per copy", async ({ page }) => {
    const c = attachCollectors(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/welcome", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page, 1500);

    // Class names are CSS-module-hashed, so select the row structurally: the
    // ODDS taperow is the element with a DIRECT span child reading exactly
    // "ODDS" (the pinned left label).
    const oddsRow = page.locator('div:has(> span:text-is("ODDS"))').last();
    await expect(oddsRow, "welcome ODDS row present").toBeVisible({ timeout: 10_000 });

    const rowText = (await oddsRow.innerText()).replace(/\s+/g, " ");
    const count = rowText.split("FED CUT ODDS").length - 1;

    // eslint-disable-next-line no-console
    console.log(`[odds-one-fedcut] /welcome → "FED CUT ODDS" occurrences=${count}`);

    expect(
      count,
      "6 = 2 halves x ODDS_COPIES_PER_HALF (was 12 at c84c02f)",
    ).toBe(6);
    // The pinned-September label must be gone outright, not merely deduped.
    expect(rowText, "no September-pinned label survives").not.toContain("(SEP)");

    await page.screenshot({ path: `${SHOT_DIR}/odds-one-fedcut-welcome.png` });
    logClean("odds-one-fedcut-welcome", c);
    assertClean(c, "odds one fedcut welcome");
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
        expect(inView, "clicking a crosswalk code chip should scroll #lobby-drill into view").toBe(true);
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

  test("/hearings loads clean", async ({ page }) => {
    const c = attachCollectors(page);
    const resp = await page.goto("/hearings", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    // HO 502(a): retitled from "/hearings + calendar" — the body never exercised
    // the calendar, so the old title claimed coverage it didn't have (that
    // interaction is backlogged as (b), for the Phase 2 seeded fixture). Harden
    // what it DOES test: assertClean only catches >=400, so a silent redirect
    // would pass. Assert 200 + no redirect hop + a NON-calendar page marker (the
    // masthead breadcrumb "Hearings" segment — a wrong page renders a different
    // crumb) so we prove we're on the hearings surface without touching the
    // calendar, keeping the title honest about scope.
    expect.soft(resp?.status(), "/hearings should serve 200").toBe(200);
    expect
      .soft(resp?.request().redirectedFrom(), "/hearings should not redirect")
      .toBeNull();
    await expect
      .soft(
        page.locator(".breadcrumb-seg-label", { hasText: "Hearings" }),
        "/hearings surface rendered",
      )
      .toBeVisible();
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

// ═════════════════════════════════════════════════════════════════════════════
// HO 548 — coverage extension for the post-472 interactive surfaces.
// ═════════════════════════════════════════════════════════════════════════════

// A. RecordTabs (HO 509/510) — the shared record box on /bill/[id] + /members/[id].
test.describe("RecordTabs (509/510)", () => {
  for (const [slug, path] of [
    ["bill", `/bill/${VOTE_BILL}`],
    ["member", `/members/${TABS_MEMBER}`],
  ] as const) {
    test(`${slug} hub: tablist + mount-all + scroll reset`, async ({ page }) => {
      const c = attachCollectors(page);
      await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await settle(page);
      // 1. tablist renders; >1 tab
      await expect(page.locator('[role="tablist"]'), "record box tablist").toBeVisible();
      const tabs = page.locator(".rec-tab");
      expect(await tabs.count(), "record box should have >1 tab").toBeGreaterThan(1);

      // 2. mount-all: swap to a non-active tab; every panel stays in the DOM,
      // inactive ones carry `hidden` (HO 509 comment — unmounting would drop an
      // open row). If this ever becomes conditional mounting, nothing else catches it.
      const panelsBefore = await page.locator(".rec-panel").count();
      await tabs.nth(1).click();
      await page.waitForTimeout(300);
      const panelsAfter = await page.locator(".rec-panel").count();
      expect(panelsAfter, "all panels stay mounted across a swap").toBe(panelsBefore);
      expect(
        await page.locator(".rec-panel[hidden]").count(),
        "exactly the inactive panels carry hidden",
      ).toBe(panelsAfter - 1);

      // 3. scroll reset: scroll the body, swap, assert scrollTop 0 (select() zeroes it).
      // The reset can only be exercised when the active panel actually overflows the
      // 430px body. Guard on that + LOG when it doesn't (not a silent skip — the test
      // still covers tablist + mount-all, and the member hub, whose Bills panel does
      // overflow, exercises the reset). This is the honest form of the HO 503 lesson:
      // surface the non-exercise, don't pretend a vacuous pass is coverage.
      const body = page.locator(".rec-body");
      await body.evaluate((el) => {
        el.scrollTop = 300;
      });
      const scrolled = await body.evaluate((el) => el.scrollTop);
      if (scrolled > 0) {
        await tabs.nth(0).click();
        await page.waitForTimeout(300);
        expect(
          await body.evaluate((el) => el.scrollTop),
          `${slug} scroll resets to 0 on tab swap`,
        ).toBe(0);
      } else {
        // eslint-disable-next-line no-console
        console.log(`[rectabs-${slug}] active panel fits the 430px body — scroll-reset not exercised here`);
      }

      await page.screenshot({ path: `${SHOT_DIR}/rectabs-${slug}.png`, fullPage: true });
      logClean(`rectabs-${slug}`, c);
      assertClean(c, `${slug} RecordTabs`);
    });
  }

  test("member Bills tab: an open row survives a tab swap", async ({ page }) => {
    const c = attachCollectors(page);
    // Member hub opens on tabs[0] = Bills (BillRowList → expandable rows).
    await page.goto(`/members/${TABS_MEMBER}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const activePanel = page.locator(".rec-panel:not([hidden])").first();
    const panelId = await activePanel.getAttribute("id");
    const row = page.locator(`#${panelId} [role="button"][aria-expanded]`).first();
    if (!(await row.count())) {
      // SKIP (named in the ship report): active panel has no expander.
      test.skip(true, `member active panel ${panelId} has no expandable row`);
      return;
    }
    await row.click();
    await expect(row, "row opens").toHaveAttribute("aria-expanded", "true");
    const tabs = page.locator(".rec-tab");
    await tabs.nth(1).click();
    await page.waitForTimeout(300);
    await tabs.nth(0).click();
    await page.waitForTimeout(300);
    await expect(row, "open row survives swap-away-and-back (panels stay mounted)").toHaveAttribute(
      "aria-expanded",
      "true",
    );
    logClean("rectabs-openrow", c);
    assertClean(c, "RecordTabs open-row survival");
  });

  test("opposite empty-state policy: member DIMS zero tabs, bill OMITS them", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto(`/members/${TABS_MEMBER}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    expect(
      await page.locator('.rec-tab[data-empty="true"]').count(),
      "member hub dims ≥1 zero-count tab (the deliberate dim-at-zero policy)",
    ).toBeGreaterThan(0);

    await page.goto(`/bill/${VOTE_BILL}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    expect(
      await page.locator(".rec-tab[data-empty]").count(),
      "bill hub omits zero tabs — none should be present-but-dimmed",
    ).toBe(0);
    logClean("rectabs-empty-policy", c);
    assertClean(c, "RecordTabs empty-state policy");
  });
});

// B. /vote/[id] (HO 540) — reached by navigation (exercises the HO 542 link) + cold.
test.describe("/vote/[id] (540)", () => {
  test("reach /vote via the bill VOTES tab → positions + bill back-link", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto(`/bill/${VOTE_BILL}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    await page.getByRole("tab", { name: /votes/i }).first().click();
    await page.waitForTimeout(400);
    const roll = page.locator(".bvote-roll").first();
    await expect(roll, "VOTES tab should carry a roll-call link").toBeVisible({ timeout: 8_000 });
    await roll.click();
    await page.waitForURL(/\/vote\//, { timeout: 8_000 });
    expect(page.url(), "clicking a roll link navigates to /vote/").toMatch(/\/vote\//);
    await settle(page);
    expect(
      await page.locator("a[href^='/members/']").count(),
      "positions rendered (member links)",
    ).toBeGreaterThan(0);
    expect(
      await page.locator("a[href^='/bill/']").count(),
      "a /bill/ back-link is present",
    ).toBeGreaterThan(0);
    logClean("vote-via-nav", c);
    assertClean(c, "/vote via nav");
  });

  test("/vote/[id] cold direct-nav renders positions + bill link", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto(`/vote/${VOTE}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    await page.screenshot({ path: `${SHOT_DIR}/vote-direct.png`, fullPage: true });
    expect(
      await page.locator("a[href^='/members/']").count(),
      "positions rendered on cold entry",
    ).toBeGreaterThan(0);
    expect(await page.locator("a[href^='/bill/']").count(), "bill back-link present").toBeGreaterThan(0);
    logClean("vote-direct", c);
    assertClean(c, "/vote direct");
  });
});

// C. /bill/[id] no-double-count invariant (HO 542): own passage votes and House
// amendment votes (which carry bill_id) must not both surface as the same /vote link.
test.describe("bill /vote/ links (542)", () => {
  test(`${VOTE_BILL}: every /vote/ link is unique page-wide`, async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto(`/bill/${VOTE_BILL}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    // All panels mount (hidden), so both tabs' /vote/ links are queryable page-wide.
    const hrefs = await page
      .locator("a[href^='/vote/']")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    // eslint-disable-next-line no-console
    console.log(`[vote-dedupe] ${VOTE_BILL} /vote/ links=${hrefs.length} unique=${new Set(hrefs).size}`);
    expect(hrefs.length, "bill should carry /vote/ links").toBeGreaterThan(0);
    expect(
      new Set(hrefs).size,
      "no duplicate /vote/ links (own passage vs amendment overlap)",
    ).toBe(hrefs.length);
    logClean("vote-dedupe", c);
    assertClean(c, "bill /vote/ dedupe");
  });

  test(`${NOVOTE_BILL}: introduced-never-voted → no VOTES tab`, async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto(`/bill/${NOVOTE_BILL}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    expect(
      await page.getByRole("tab", { name: /^\s*votes/i }).count(),
      "a never-voted bill omits the VOTES tab",
    ).toBe(0);
    logClean("vote-notab", c);
    assertClean(c, "no VOTES tab");
  });
});

// D. /lobbying fbar (HO 544/547) — URL-level, cheap.
test.describe("/lobbying fbar (544/547)", () => {
  test("sort/linked rebase + compose; search forces RECENT; clear; scoped hides", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/lobbying", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    expect(await page.locator(".lob-fbar-controls").count(), "unscoped /lobbying shows fbar controls").toBeGreaterThan(0);

    // VOLUME segment rebases ?sort=volume
    await page.locator(".lob-fbar-controls").getByRole("link", { name: "VOLUME" }).click();
    await page.waitForURL(/sort=volume/, { timeout: 8_000 });
    expect(page.url(), "VOLUME rebases ?sort=volume").toMatch(/sort=volume/);

    // bill-linked toggles linked=1
    await page.goto("/lobbying", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    await page.locator(".lob-fbar-linked").click();
    await page.waitForURL(/linked=1/, { timeout: 8_000 });
    expect(page.url(), "bill-linked toggles ?linked=1").toMatch(/linked=1/);
    // compose: add VOLUME on top of linked
    await page.locator(".lob-fbar-controls").getByRole("link", { name: "VOLUME" }).click();
    await page.waitForURL(/sort=volume/, { timeout: 8_000 });
    expect(page.url(), "sort+linked compose").toMatch(/linked=1/);
    expect(page.url()).toMatch(/sort=volume/);

    // search forces RECENT: fill + submit → ?q=, VOLUME becomes inert
    await page.goto("/lobbying", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    const input = page.locator(".lob-fbar-search-input");
    await input.fill("boeing");
    await input.press("Enter");
    await page.waitForURL(/q=boeing/, { timeout: 8_000 });
    expect(page.url(), "search writes ?q=").toMatch(/q=boeing/);
    expect(
      await page.locator(".lob-fbar-sort-off").count(),
      "search replaces the sort segment with the disabled variant",
    ).toBeGreaterThan(0);
    await expect(
      page.locator('.lob-fbar-sort-off [aria-disabled="true"]'),
      "VOLUME is inert while searching (HO 547 search-forces-RECENT)",
    ).toBeVisible();

    // clear returns to the bare feed
    await page.locator(".lob-fbar-search-clear").click();
    await page.waitForURL((u) => !u.searchParams.has("q"), { timeout: 8_000 });
    expect(page.url(), "clear removes ?q=").not.toMatch(/[?&]q=/);

    // scoped view: controls are unscoped-only
    await page.goto("/lobbying?issue=TAX", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    expect(
      await page.locator(".lob-fbar-controls").count(),
      "scoped ?issue= renders the fbar controls zero times",
    ).toBe(0);
    logClean("lobbying-fbar", c);
    assertClean(c, "/lobbying fbar");
  });
});

// E. FilingDescription (HO 545) — SHOW MORE toggle + bounded growth + independence.
test.describe("FilingDescription (545)", () => {
  test("SHOW MORE toggles, the 24k monster stays bounded, toggles are independent", async ({ page }) => {
    const c = attachCollectors(page);
    // ?sort=volume so the top-volume seed filing is on page 1 (the ?expanded=
    // constraint: the uuid must be in the rendered rows to attach its panel).
    await page.goto(`/lobbying?sort=volume&expanded=${FILING_UUID}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await settle(page);
    const more = page.locator(".lob-exp-desc-more");
    const n = await more.count();
    expect(n, "the top-volume filing should render ≥1 SHOW MORE").toBeGreaterThan(0);

    // Open the TALLEST (24k-char monster) box specifically — that's the box whose
    // unbounded growth HO 545 exists to cap, so the bound must be tested on it.
    const boxes = page.locator(".lob-exp-desc");
    const monsterIdx = await boxes.evaluateAll((els) => {
      let mi = 0;
      let mx = -1;
      els.forEach((e, i) => {
        if (e.scrollHeight > mx) {
          mx = e.scrollHeight;
          mi = i;
        }
      });
      return mi;
    });
    const monsterBtn = boxes.nth(monsterIdx).locator("xpath=following-sibling::button[1]");
    await expect(monsterBtn, "the monster description carries a SHOW MORE").toHaveCount(1);
    await expect(monsterBtn).toHaveAttribute("aria-expanded", "false");

    const h0 = await page.evaluate(() => document.documentElement.scrollHeight);
    await monsterBtn.click();
    await expect(monsterBtn, "SHOW MORE flips aria-expanded").toHaveAttribute("aria-expanded", "true");
    const h1 = await page.evaluate(() => document.documentElement.scrollHeight);
    // The regression that matters: without the 420px scroll cap the monster would
    // add thousands of px. A numeric bound is the only assertion that catches that.
    expect(h1 - h0, "opening the 24k monster grows the page <600px (the 420px scroll bound)").toBeLessThan(600);

    // restore
    await monsterBtn.click();
    await expect(monsterBtn).toHaveAttribute("aria-expanded", "false");

    // per-activity independence: toggling one leaves the others closed
    if (n >= 2) {
      const a = more.nth(0);
      const b = more.nth(1);
      await a.click();
      await expect(a).toHaveAttribute("aria-expanded", "true");
      await expect(b, "toggling one description leaves the others' aria-expanded false").toHaveAttribute(
        "aria-expanded",
        "false",
      );
    } else {
      test.info().annotations.push({
        type: "note",
        description: "only one SHOW MORE rendered — independence not exercised (not a skip of the whole test)",
      });
    }
    await page.screenshot({ path: `${SHOT_DIR}/filing-desc.png`, fullPage: true });
    logClean("filing-desc", c);
    assertClean(c, "FilingDescription");
  });
});

// F. /news rails (HO 515/517) — single selection across the topic + member groups.
test.describe("/news rails (515/517)", () => {
  test("single-selection spans the topic + member rail groups", async ({ page }) => {
    const c = attachCollectors(page);
    await page.goto("/news", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    expect(await page.locator(".mc-crow").count(), "/news renders rail rows").toBeGreaterThan(0);
    expect(
      await page.locator(".mc-crow.is-sel").count(),
      "bare /news has zero selected rows",
    ).toBe(0);

    // topic row (not .nw-mrow) → ?topic=, exactly one selected
    await page.locator(".mc-crow:not(.nw-mrow)").first().click();
    await page.waitForURL(/topic=/, { timeout: 8_000 });
    expect(page.url(), "topic row scopes ?topic=").toMatch(/topic=/);
    expect(
      await page.locator(".mc-crow.is-sel").count(),
      "exactly one selected after topic click",
    ).toBe(1);

    // member row (.nw-mrow) → ?member=, topic cleared, still exactly one selected
    const memberRow = page.locator(".mc-crow.nw-mrow").first();
    if (!(await memberRow.count())) {
      // SKIP (named in the ship report): IN THE NEWS group empty on this run.
      test.skip(true, "no .nw-mrow member rail rows (IN THE NEWS group empty)");
      return;
    }
    await memberRow.click();
    await page.waitForURL(/member=/, { timeout: 8_000 });
    expect(page.url(), "member row scopes ?member=").toMatch(/member=/);
    expect(page.url(), "topic cleared when a member is selected").not.toMatch(/topic=/);
    expect(
      await page.locator(".mc-crow.is-sel").count(),
      "still exactly one selected across BOTH rail groups (HO 517 invariant)",
    ).toBe(1);
    logClean("news-rails", c);
    assertClean(c, "/news rails");
  });
});
