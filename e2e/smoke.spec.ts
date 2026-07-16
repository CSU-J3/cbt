import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

// HO 379 — single smoke crawler. Per route: assert the document returns 200,
// zero failed subrequests (the stylesheet-404 / unstyled-page tell), zero console
// errors, zero uncaught page errors; then screenshot for eyeballing. Plus a
// handful of targeted interactions on the surfaces that actually regress here.
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

// Real seeds pulled from Turso (HO 379 recon), env-overridable for other data.
const BILL = process.env.SEED_BILL ?? "119-s-2";
const MEMBER = process.env.SEED_MEMBER ?? "A000055";
const RACE = process.env.SEED_RACE ?? "AL-01-2026";
const COMMITTEE = process.env.SEED_COMMITTEE ?? "hlig00";
const REPORT = process.env.SEED_REPORT ?? "2026-06-15";

// The gate cookie (`/` redirects anonymous → /welcome; the landing's "Enter
// terminal" sets this). Only `/` gates — every other route is ungated — but we
// set it context-wide so the home renders the terminal, not the landing.
const GATE_COOKIE = { name: "ct_seen", value: "1", url: BASE_URL };

type Route = { slug: string; path: string };

// Enumerated from the live app/ tree (every page.tsx), not the handoff seed list.
// The six stage-filtered home variants exercise the `?stage=` deep links that the
// gate is known to drop. other_chamber (not "other") is the real OTHER bar value.
const STAGES = [
  "introduced",
  "committee",
  "floor",
  "other_chamber",
  "president",
  "enacted",
] as const;

const ROUTES: Route[] = [
  { slug: "home", path: "/" },
  ...STAGES.map((s) => ({ slug: `home-stage-${s}`, path: `/?stage=${s}` })),
  { slug: "welcome", path: "/welcome" },
  { slug: "bills", path: "/bills" },
  { slug: "members", path: "/members" },
  { slug: "members-pass-rate", path: "/members/pass-rate" },
  { slug: "races", path: "/races" },
  { slug: "electoral", path: "/electoral" },
  { slug: "primaries", path: "/primaries" },
  { slug: "reports", path: "/reports" },
  { slug: "hearings", path: "/hearings" },
  { slug: "news", path: "/news" },
  { slug: "changes", path: "/changes" },
  { slug: "stale", path: "/stale" },
  { slug: "trends", path: "/trends" },
  { slug: "patterns", path: "/patterns" },
  { slug: "search", path: "/search" },
  { slug: "president", path: "/president" },
  // HO 461/456/437/389 aggregate surfaces — shipped after the HO 379 crawler was
  // written, never before in the console/failed-request sweep (HO 472).
  { slug: "amendments", path: "/amendments" },
  { slug: "nominations", path: "/nominations" },
  { slug: "lobbying", path: "/lobbying" },
  { slug: "trades", path: "/trades" },
  { slug: "committees-redirect", path: "/committees" }, // redirects → /members
  { slug: "watchlist", path: "/watchlist" }, // anonymous: empty/sign-in, not a 500
  { slug: "dashboard-classic", path: "/dashboard-classic" },
  { slug: "dashboard-v2", path: "/dashboard-v2" },
  // dynamic detail routes (real IDs)
  { slug: "bill-detail", path: `/bill/${BILL}` },
  { slug: "member-detail", path: `/members/${MEMBER}` },
  { slug: "race-detail", path: `/race/${RACE}` },
  { slug: "committee-detail", path: `/committee/${COMMITTEE}` },
  { slug: "report-detail", path: `/reports/${REPORT}` },
];

type Collected = {
  failed: string[]; // requestfailed (network-level), excl. client aborts
  bad: string[]; // any response with status >= 400
  consoleErr: string[];
  pageErr: string[];
};

// favicon/manifest 404s are cosmetic and noisy; record them in the run log but
// don't fail the network assertion on them.
function isIgnorableBad(url: string, status: number): boolean {
  return /\/favicon\.ico|\/manifest\.webmanifest|\/apple-touch-icon/.test(url) && status === 404;
}

function attachCollectors(page: Page): Collected {
  const c: Collected = { failed: [], bad: [], consoleErr: [], pageErr: [] };
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
    if (msg.type() === "error") c.consoleErr.push(msg.text());
  });
  page.on("pageerror", (err) => {
    c.pageErr.push(err.message);
  });
  return c;
}

test.beforeAll(() => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});

test.describe("route crawl", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of ROUTES) {
    test(`${route.slug} (${route.path})`, async ({ page, context }) => {
      await context.addCookies([GATE_COOKIE]);
      const c = attachCollectors(page);

      const resp = await page.goto(route.path, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      // Let the load event + late XHR/console settle. The markets tape polls, so
      // networkidle never fires here — a fixed settle is the pragmatic choice.
      await page.waitForLoadState("load").catch(() => {});
      await page.waitForTimeout(2_500);

      // Screenshot BEFORE assertions so failures still leave an image to eyeball.
      await page.screenshot({ path: `${SHOT_DIR}/${route.slug}.png`, fullPage: true });

      const status = resp?.status() ?? 0;
      const finalUrl = page.url();
      const ignored = c.bad.filter((b) => {
        const [s, ...rest] = b.split(" ");
        return isIgnorableBad(rest.join(" "), Number(s));
      });
      const badReal = c.bad.filter((b) => !ignored.includes(b));

      // eslint-disable-next-line no-console
      console.log(
        `[${route.slug}] ${status} url=${finalUrl} ` +
          `failed=${c.failed.length} bad=${badReal.length} console=${c.consoleErr.length} pageErr=${c.pageErr.length}` +
          (ignored.length ? ` (ignored ${ignored.length}: ${ignored.join(", ")})` : ""),
      );

      // Document must be 200 (redirects resolve to their 200 target).
      expect(status, `${route.path} document status`).toBe(200);
      // Soft so one route's noise doesn't mask the rest; all still surface as fails.
      expect.soft(c.failed, `${route.path} failed requests`).toEqual([]);
      expect.soft(badReal, `${route.path} 4xx/5xx subrequests`).toEqual([]);
      expect.soft(c.consoleErr, `${route.path} console errors`).toEqual([]);
      expect.soft(c.pageErr, `${route.path} uncaught page errors`).toEqual([]);
    });
  }
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
    const firstRow = page.locator(".v2f-row").first();
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
    await page.goto("/races", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1_500);
    const cell = page.locator(".us-map-state").first();
    const found = await cell.count();
    if (!found) {
      test.info().annotations.push({
        type: "skip-reason",
        description: "no clickable .us-map-state cell on /races (map view not default?)",
      });
      test.skip(true, "race map cell not found");
      return;
    }
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

  test("B2 markets hover → hover card appears (flagged if tape empty on headless prod)", async ({
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
    await page.waitForLoadState("load").catch(() => {});
    await page.waitForTimeout(1_500);
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
