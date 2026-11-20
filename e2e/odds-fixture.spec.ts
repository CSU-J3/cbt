// HO 825 — site 12 on /electoral (the open row's Kalshi line), asserted on a
// row that can't run out.
//
// WHY THIS FILE EXISTS. Until HO 825, odds-off.spec.ts opened /electoral's LIST
// rows one at a time until one showed a Kalshi line, and asserted that line ON
// and OFF. HO 824's probe (docs/probes/824-electoral-kalshi.md) read why those
// three tests went red on every Production run from Nov 18: every Senate row
// had been called, a called seat's open row renders no line (R6,
// components/RaceOpenRow.tsx), and the hunt walked only the default tab. The
// two uncalled rows left were House rows 39 and 82. A hunt for a live market
// goes red again the day the last one is called, so the chat ruled (Nov 19)
// that the line is asserted on a FIXTURE row instead: a constant, which reads
// the same after the last market closes.
//
// THE FIXTURE. `/electoral?fixture=max` behind `fixtureRequested`
// (lib/fixtures/max-content.ts, HO 740's seam): on a server with
// `CBT_FIXTURES=1`, the first Senate row is swapped for a copy that isn't
// called and carries a live market, `electoralRowsWithLiveMarket`. Its line
// reads "KALSHI Fixture 61%", which no real market can. Its <li> carries
// `data-fixture="max"`, the marker the narrow gate's leak control counts.
//
// WHAT THE SERVER UNDER TEST CARRIES IS DECLARED, NOT GUESSED, the way
// narrow.spec.ts declares NARROW_FIXTURES:
//   - `ODDS_FIXTURES=1` (the Preview job, whose Preview carries CBT_FIXTURES):
//     four tests, the marker first, then ON at 1440 and OFF at 1440 and 430;
//   - unset (every Production run): one test, which reds if the fixture
//     renders at all. A Production that renders it is a leak.
// Both directions are hard assertions and nothing skips: a guard that skips
// when the fixture is missing would make "missing" read like "passing".
//
// WHAT PRODUCTION GIVES UP: it no longer asserts site 12 on /electoral (the ◆
// cells, site 10, are still asserted there by odds-off.spec.ts). A regression
// in the line lands at review, where this file asserts it before the FF.
//
// HO 826 — `/?fixture=max`, `/`'s K/P line (site 3) on three fixture cards. A
// called seat's card and a card whose price the sync hasn't written in 24 hours
// now carry no odds: the index rows are stripped on the server before
// `/`'s cards render (lib/electoral-rows.ts, withoutStaleOdds and
// withoutCalledOdds), and a card with no price on either venue draws no K/P
// line. So Production's `/` can go a whole season with no price on any card,
// and the line is asserted on fixture cards, as site 12 is. The fixture
// (`featuredWithMarketCases`) gives the three featured Senate seats one case
// each, and the shipped rules decide what each draws:
//   - `live`: not called, both venues written now: the line renders;
//   - `called`: in the called set: the rule takes both prices;
//   - `stale`: not called, both venues written 25 hours ago: the rule takes
//     both prices.
// Each card carries `data-fixture-case`, not `data-fixture`: the narrow gate
// counts `[data-fixture]` on this route and holds it at 2. Set, four tests here
// (the markers, ON at 1440, OFF at 1440 and 430); unset, one, which reds if a
// fixture card renders.
import { expect, type Locator, type Page, test } from "@playwright/test";

const BASE_URL =
  process.env.BASE_URL ?? "https://congressional-terminal-chi-silk.vercel.app";
const GATE_COOKIE = { name: "ct_seen", value: "1", url: BASE_URL };
const PATH = "/electoral?fixture=max";
const HOME_PATH = "/?fixture=max";

// The fixture's favorite, as the line prints it (`surname("Fixture")`), and its
// percentage. Case-sensitive on purpose: no real Kalshi label reads "Fixture".
// HO 826: the `/` cards' Polymarket constant names the same favorite (58%), so
// the K/P line prints the name once, on its K half.
const FAVORITE = "Fixture";
const LINE_TEXT = /Fixture\s+61%/;
const KP_TEXT = /Fixture\s*61%/;
const CASES = ["called", "live", "stale"] as const;

// narrow.spec.ts's idiom, copied: `||` not `??`, because the workflow passes the
// env through bare and on a trigger that sets nothing it arrives as the EMPTY
// STRING. Empty reads as unset, "1" as present, and anything else THROWS, so a
// mistyped value can't quietly become "absent" and run the wrong direction.
const ODDS_FIXTURES: "present" | "absent" = (() => {
  const raw = process.env.ODDS_FIXTURES || "";
  if (raw === "") return "absent";
  if (raw === "1") return "present";
  throw new Error(
    `ODDS_FIXTURES is malformed: ${JSON.stringify(raw)} — it is "1" or unset, and nothing else`,
  );
})();

type Viewport = { w: number; h: number; tag: string };
const DESKTOP: Viewport = { w: 1440, h: 1200, tag: "1440" };
const PHONE: Viewport = { w: 430, h: 932, tag: "430" };

async function load(page: Page, path: string = PATH): Promise<void> {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(2_500);
}

// HO 826: `/`'s race cards sit in the races box's RACES panel, `display: none`
// until that tab opens (the box opens on Hearings). Opened as odds-off.spec.ts's
// ON control opened it: the click is retried until the tab reports itself
// current, so a click that lands before hydration can't read a shut panel. Then
// the cards must have rendered before an absence means anything.
async function openRaces(page: Page): Promise<void> {
  const racesTab = page.locator(".dv2-racesbox-tab", { hasText: "Races" }).first();
  await expect(async () => {
    if ((await racesTab.getAttribute("aria-current")) !== "page") await racesTab.click();
    await expect(racesTab).toHaveAttribute("aria-current", "page", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  expect(
    await page.locator("a.race-card:visible").count(),
    `${HOME_PATH} drew no race card with RACES open — the page under test isn't /'s races panel, so no reading here means anything`,
  ).toBeGreaterThan(0);
}

// The list must have rendered rows before an absence means anything: an SSO
// wall or an empty page has no marker either.
async function expectListRendered(page: Page): Promise<void> {
  expect(
    await page.locator("li.race-list-item").count(),
    `${PATH} rendered no LIST rows — the page under test isn't /electoral's list, so no marker reading here means anything`,
  ).toBeGreaterThan(0);
}

// Opens a row by its seat cell (a row's centre can be its NEWS link). Re-clicks
// only while the row is still shut, so a click that lands before hydration is
// retried and a row that opened is never toggled shut again.
async function openRow(row: Locator): Promise<Locator> {
  const expand = row.locator(".race-list-expand");
  await expect(async () => {
    if ((await expand.count()) === 0) await row.locator(".race-list-seat").click();
    await expect(expand).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return expand;
}

async function newPage(
  browser: import("@playwright/test").Browser,
  vp: Viewport,
  oddsOff: boolean,
): Promise<{ page: Page; close: () => Promise<void> }> {
  // A hand-made context, as odds-off.spec.ts makes its own. HO 825 STEP 0
  // (claim 7) read that under Playwright 1.61.1 it inherits the config's
  // `use.extraHTTPHeaders`, which carry the Preview's protection bypass.
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  await context.addCookies([GATE_COOKIE]);
  if (oddsOff) {
    // Set BEFORE navigation, as the OFF pass does: the pre-paint script reads
    // localStorage and stamps <html> before anything renders.
    await context.addInitScript(() => {
      try {
        localStorage.setItem("cbt:pref:odds", "off");
      } catch {}
    });
  }
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

if (ODDS_FIXTURES === "present") {
  test.describe("odds fixture — the Preview direction (ODDS_FIXTURES=1)", () => {
    // 1. THE MARKER, FIRST. Its absence means the fixture didn't render at all
    // (the env or the seam), which is not a fault in the line; a line that
    // stops rendering on a marked row reds the ON and OFF tests below instead.
    test("marker — /electoral?fixture=max carries one marked row, first on the default tab", async ({ browser }) => {
      const { page, close } = await newPage(browser, DESKTOP, false);
      await load(page);
      await expectListRendered(page);
      const marked = page.locator("li.race-list-item[data-fixture]");
      const n = await marked.count();
      const first = page.locator("li.race-list-item").first();
      const firstRace = await first.getAttribute("data-race");
      const firstFixture = await first.getAttribute("data-fixture");
      console.log(`[odds-fixture marker] marked=${n} firstRow=${firstRace} firstRowFixture=${firstFixture}`);
      expect(
        n,
        `${PATH} requested a fixture and rendered no marked row — the server's CBT_FIXTURES is missing, ` +
          `or the env landed AFTER the build being read, or the seam (fixtureRequested -> ` +
          `electoralRowsWithLiveMarket -> RaceListView's data-fixture) is broken. This is not a market regression`,
      ).toBe(1);
      expect(firstFixture, "the marked row is the first row of the default (Senate) tab").toBe("max");
      await close();
    });

    // 2. ON, at 1440: the open row shows the line.
    test("ON — the fixture row's open panel shows its Kalshi line @ 1440", async ({ browser }) => {
      const { page, close } = await newPage(browser, DESKTOP, false);
      await load(page);
      expect(
        await page.evaluate(() => document.documentElement.dataset.odds ?? null),
        "no preference set means the attribute is ABSENT (the default is its absence)",
      ).toBeNull();
      const row = page.locator("li.race-list-item[data-fixture]");
      await expect(row, "the fixture row must exist (see the marker test)").toHaveCount(1);
      const expand = await openRow(row);
      const line = expand.locator(".racecard-kalshi[data-market]");
      await expect(line, "the fixture row's open panel carries one Kalshi line").toHaveCount(1);
      await expect(line, "the line is visible with odds on").toBeVisible();
      const text = (await line.innerText()).replace(/\s+/g, " ").trim();
      console.log(`[odds-fixture ON@1440] race=${await row.getAttribute("data-race")} line="${text}"`);
      expect(text, `the line holds the fixture's favorite, ${FAVORITE}`).toMatch(LINE_TEXT);
      await close();
    });

    // 3. OFF, at 1440 and 430: the line is in the DOM and hidden.
    for (const vp of [DESKTOP, PHONE]) {
      test(`OFF — the fixture row's Kalshi line is in the DOM and hidden @ ${vp.tag}`, async ({ browser }) => {
        const { page, close } = await newPage(browser, vp, true);
        await load(page);
        expect(
          await page.evaluate(() => document.documentElement.dataset.odds),
          "the odds-off preference is applied (data-odds=off) before the row is read",
        ).toBe("off");
        const row = page.locator("li.race-list-item[data-fixture]");
        await expect(row, "the fixture row must exist (see the marker test)").toHaveCount(1);
        const expand = await openRow(row);
        const inDom = await expand.locator(".racecard-kalshi[data-market]").count();
        const visible = page.locator("[data-market]:visible");
        const n = await visible.count();
        if (n > 0) {
          const names = await visible.evaluateAll((els) =>
            els.slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${e.className}`),
          );
          console.log(`[odds-fixture OFF@${vp.tag}] VISIBLE: ${names.join(" | ")}`);
        }
        const scroll = await page.evaluate(() => ({
          s: document.documentElement.scrollWidth,
          c: document.documentElement.clientWidth,
        }));
        console.log(`[odds-fixture OFF@${vp.tag}] lineInDom=${inDom} visibleMarkers=${n} scroll=${scroll.s}/${scroll.c}`);
        expect(inDom, "the line is in the DOM with odds off (the gate hides it, it doesn't unmount it)").toBe(1);
        expect(n, "no market element may be visible with odds off").toBe(0);
        expect(
          scroll.s,
          `doc must not scroll horizontally in the OFF state (${scroll.s}/${scroll.c})`,
        ).toBeLessThanOrEqual(scroll.c);
        await close();
      });
    }
  });

  test.describe("odds fixture on / — the Preview direction (ODDS_FIXTURES=1)", () => {
    const card = (page: Page, c: (typeof CASES)[number]) => page.locator(`a.race-card[data-fixture-case="${c}"]`);

    // 1. THE MARKERS, FIRST. On a build that carries the seam, their absence
    // has one cause, the server's CBT_FIXTURES not reaching the build being
    // read, and the message names it. A build without the seam reds here the
    // same way, with the same message (HO 826's Leg A, marked 0 on its base).
    test("markers — /?fixture=max carries three fixture cards, one per case", async ({ browser }) => {
      const { page, close } = await newPage(browser, DESKTOP, false);
      await load(page, HOME_PATH);
      await openRaces(page);
      const marked = await page
        .locator("a.race-card[data-fixture-case]")
        .evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.seat}=${(e as HTMLElement).dataset.fixtureCase}`));
      console.log(`[odds-fixture home markers] marked=${marked.length} ${marked.join(" ")}`);
      expect(
        marked.length,
        `${HOME_PATH} requested a fixture and drew ${marked.length} fixture cards, not 3 — the server's CBT_FIXTURES ` +
          `didn't reach the build being read (Preview scope only). This is not a market regression`,
      ).toBe(3);
      expect(
        marked.map((m) => m.split("=")[1]).sort(),
        "one card for each case: live, called, stale",
      ).toEqual([...CASES]);
      await close();
    });

    // 2. ON, at 1440: the live card draws its line; the rules took the other two.
    test("ON — the live card shows its K/P line, the called and stale cards show none @ 1440", async ({ browser }) => {
      const { page, close } = await newPage(browser, DESKTOP, false);
      await load(page, HOME_PATH);
      expect(
        await page.evaluate(() => document.documentElement.dataset.odds ?? null),
        "no preference set means the attribute is ABSENT (the default is its absence)",
      ).toBeNull();
      await openRaces(page);
      for (const c of CASES) await expect(card(page, c), `the ${c} card must exist (see the markers test)`).toHaveCount(1);
      const line = card(page, "live").locator(".rc-kpline[data-market]");
      await expect(line, "the live card carries one K/P line").toHaveCount(1);
      await expect(line, "the line is visible with odds on").toBeVisible();
      const text = (await line.innerText()).replace(/\s+/g, " ").trim();
      const called = await card(page, "called").locator("[data-market]").count();
      const stale = await card(page, "stale").locator("[data-market]").count();
      console.log(
        `[odds-fixture home ON@1440] live=${await card(page, "live").getAttribute("data-seat")} line="${text}" ` +
          `calledMarkets=${called} staleMarkets=${stale}`,
      );
      expect(text, `the line holds the fixture's favorite, ${FAVORITE}`).toMatch(KP_TEXT);
      expect(called, "a called seat's card carries no market element: the called rule took its prices").toBe(0);
      expect(stale, "a card whose prices are 25 hours old carries no market element: the stale rule took them").toBe(0);
      await close();
    });

    // 3. OFF, at 1440 and 430: the live card's line is in the DOM and hidden.
    for (const vp of [DESKTOP, PHONE]) {
      test(`OFF — the live card's K/P line is in the DOM and hidden @ ${vp.tag}`, async ({ browser }) => {
        const { page, close } = await newPage(browser, vp, true);
        await load(page, HOME_PATH);
        expect(
          await page.evaluate(() => document.documentElement.dataset.odds),
          "the odds-off preference is applied (data-odds=off) before the cards are read",
        ).toBe("off");
        await openRaces(page);
        await expect(card(page, "live"), "the live card must exist (see the markers test)").toHaveCount(1);
        const inDom = await card(page, "live").locator(".rc-kpline[data-market]").count();
        const visible = page.locator("[data-market]:visible");
        const n = await visible.count();
        if (n > 0) {
          const names = await visible.evaluateAll((els) =>
            els.slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${e.className}`),
          );
          console.log(`[odds-fixture home OFF@${vp.tag}] VISIBLE: ${names.join(" | ")}`);
        }
        const scroll = await page.evaluate(() => ({
          s: document.documentElement.scrollWidth,
          c: document.documentElement.clientWidth,
        }));
        console.log(`[odds-fixture home OFF@${vp.tag}] lineInDom=${inDom} visibleMarkers=${n} scroll=${scroll.s}/${scroll.c}`);
        expect(inDom, "the line is in the DOM with odds off (the gate hides it, it doesn't unmount it)").toBe(1);
        expect(n, "no market element may be visible with odds off").toBe(0);
        expect(
          scroll.s,
          `doc must not scroll horizontally in the OFF state (${scroll.s}/${scroll.c})`,
        ).toBeLessThanOrEqual(scroll.c);
        await close();
      });
    }
  });
} else {
  test.describe("odds fixture — the Production direction (ODDS_FIXTURES unset)", () => {
    // The seam's control: dead where it must be. Green before HO 825's seam and
    // after it; a red here means a Production build renders the fixture.
    test("Production — /electoral?fixture=max renders no fixture", async ({ browser }) => {
      const { page, close } = await newPage(browser, DESKTOP, false);
      await load(page);
      await expectListRendered(page);
      const markers = await page.locator("[data-fixture]").count();
      const first = page.locator("li.race-list-item").first();
      await openRow(first);
      const anyFavorite = await page.locator(".racecard-kalshi").filter({ hasText: new RegExp(FAVORITE) }).count();
      console.log(
        `[odds-fixture production] firstRow=${await first.getAttribute("data-race")} markers=${markers} favoriteLines=${anyFavorite}`,
      );
      expect(
        markers,
        `${PATH} RENDERED A FIXTURE MARKER on a run that declared none — the server carries CBT_FIXTURES where it must not (Preview scope only)`,
      ).toBe(0);
      expect(anyFavorite, `no Kalshi line on the page may hold the fixture's favorite, ${FAVORITE}`).toBe(0);
      await close();
    });

    // HO 826: the same control for `/`'s cards. Green before the seam and after.
    test("Production — /?fixture=max renders no fixture card", async ({ browser }) => {
      const { page, close } = await newPage(browser, DESKTOP, false);
      await load(page, HOME_PATH);
      await openRaces(page);
      const markers = await page.locator("[data-fixture-case]").count();
      const anyFavorite = await page.locator("a.race-card").filter({ hasText: new RegExp(FAVORITE) }).count();
      const seats = await page.locator("a.race-card").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.seat));
      console.log(`[odds-fixture home production] cards=${seats.join(",")} markers=${markers} favoriteCards=${anyFavorite}`);
      expect(
        markers,
        `${HOME_PATH} RENDERED A FIXTURE CARD on a run that declared none — the server carries CBT_FIXTURES where it must not (Preview scope only)`,
      ).toBe(0);
      expect(anyFavorite, `no race card on the page may hold the fixture's favorite, ${FAVORITE}`).toBe(0);
      await close();
    });
  });
}
