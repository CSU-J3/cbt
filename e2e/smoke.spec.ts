import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { isKnownNoise } from "./console-noise";

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
// Counted per worker, reported in afterAll. With `workers: 2` in CI this prints
// once PER WORKER, so two lines whose counts sum to the route total is correct
// and not a missing line.
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

// Real seeds pulled from Turso (HO 379 recon), env-overridable for other data.
const BILL = process.env.SEED_BILL ?? "119-s-2";
const MEMBER = process.env.SEED_MEMBER ?? "A000055";
const RACE = process.env.SEED_RACE ?? "AL-01-2026";
const COMMITTEE = process.env.SEED_COMMITTEE ?? "hlig00";
const REPORT = process.env.SEED_REPORT ?? "2026-06-15";
// HO 548 — a Senate roll call with member positions AND a bill link (119-sjres-180),
// so the /vote/[id] page renders both the positions list and the bill back-link.
const VOTE = process.env.SEED_VOTE ?? "senate-119-2-207";

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
  { slug: "dashboard-v2", path: "/dashboard-v2" },
  // dynamic detail routes (real IDs)
  { slug: "bill-detail", path: `/bill/${BILL}` },
  { slug: "member-detail", path: `/members/${MEMBER}` },
  { slug: "race-detail", path: `/race/${RACE}` },
  { slug: "committee-detail", path: `/committee/${COMMITTEE}` },
  { slug: "report-detail", path: `/reports/${REPORT}` },
  // HO 548 — the newest route (HO 540), not previously in ROUTES; inherits the
  // double-hit + lands in the daily prod crawl.
  { slug: "vote", path: `/vote/${VOTE}` },
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
    // HO 504: share the HO 472 noise allowlist (MissingSecret + friends) so an
    // unattended prod run doesn't red on known-benign console output.
    if (msg.type() !== "error") return;
    const t = msg.text();
    if (!isKnownNoise(t)) c.consoleErr.push(t);
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
          ` | hit2=${status2} failed=${failed2.length} bad=${bad2.length} console=${console2.length} pageErr=${pageErr2.length}`,
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

      // HIT 2 — the assertion this commit exists for: the cache-hit path must also
      // be 200 (hard), with the same soft posture on the hit-2 slice.
      expect(status2, `${route.path} hit-2 (cache-hit) document status`).toBe(200);
      expect.soft(failed2, `${route.path} hit-2 failed requests`).toEqual([]);
      expect.soft(bad2, `${route.path} hit-2 4xx/5xx subrequests`).toEqual([]);
      expect.soft(console2, `${route.path} hit-2 console errors`).toEqual([]);
      expect.soft(pageErr2, `${route.path} hit-2 uncaught page errors`).toEqual([]);
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

test.describe("targeted interactions", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ context }) => {
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
    // HO 504: target /electoral directly. /races 308-redirects here (HO 333); the
    // redirect itself is covered by the route crawl (ROUTES carries /races). A
    // drawer test shouldn't silently ride a 308 to get to the map.
    await page.goto("/electoral", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1_500);
    const cells = page.locator(".us-map-state");
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
