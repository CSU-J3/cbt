// HO 684 — capture + measure the RACES-tab chips at the mandated viewports.
//
// LOCAL ONLY, and it wants a PRODUCTION build (`npm run build && next start`),
// not `next dev`. Refuses a non-localhost target: the prod tape and card are
// withheld from headless Chrome under BotID, so a prod run would measure an
// absence and call it a layout (SKILL, "Prod UI verification under BotID").
//
// What it evidences, per HO 684 STEP 2.4:
//   - the RACES panel OPEN with chips in frame at 1440 / 2560 / 430;
//   - a separate prefers-reduced-motion pass (a different layout, not a dimmer
//     one — docs/method.md § Gates);
//   - the long-headline case: the live-max 95-character headline resolving in
//     the 2-line clamp at the tightest box, with no horizontal document scroll.
//
// The document scroll pair is read at EVERY viewport including 430, which the
// fit-finish invariant does not cover (it asserts 1440 and 2560) — 430 is where
// the grid bottoms out to a single column and the chips are at their narrowest.
//
//   npm run build && (set -a; . ./.env; set +a; npx next start -p 3000)
//   npx tsx scripts/diagnostic/races-chips-captures-684.ts
import fs from "node:fs";
import { chromium, type Browser } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
// NOT under test-results/. That is playwright.config.ts's `outputDir`, and
// Playwright CLEANS IT AT RUN START — so any later `npx playwright test` in the
// same session silently deletes these captures. Caught the hard way at HO 684:
// the mandated evidence was written here, then erased by the pre-paste gate
// re-run, minutes before it was due to be handed over. It is the same mechanism
// HO 683 relied on deliberately for the overflow alarm's evidence path (a stale
// row cannot ping because the folder is cleaned at start) — the property that
// makes that path correct is the property that makes this one wrong, and which
// one you want depends entirely on whether the file is meant to outlive the run.
// docs/handoffs/ is repo-ignored, which is where handed-forward artifacts belong
// (SKILL, "Pre-flight verification" — build-input parity).
const OUT = process.env.HO684_OUT ?? "docs/handoffs/684-artifacts";

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
  console.error(
    `refusing non-localhost target ${BASE} — BotID withholds these cards from ` +
      `headless prod, so a prod capture would measure an absence.`,
  );
  process.exit(1);
}

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 1400 },
  { name: "2560", width: 2560, height: 1400 },
  { name: "430", width: 430, height: 1600 },
];

type Reading = {
  viewport: string;
  motion: string;
  docScrollWidth: number;
  docClientWidth: number;
  overflow: number;
  moved: number;
  news: number;
  movedTexts: string[];
  newsTexts: string[];
  longest: {
    chars: number;
    text: string;
    clamped: boolean;
    lines: number;
    boxWidth: number;
  } | null;
  cardWidth: number;
};

async function capture(
  browser: Browser,
  vp: (typeof VIEWPORTS)[number],
  reduced: boolean,
): Promise<Reading> {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  // The gate cookie, or `/` bounces to /welcome and there is no races box.
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1200);

  await page
    .locator("button.dv2-racesbox-tab")
    .filter({ hasText: "Races" })
    .first()
    .click();
  await page.waitForTimeout(700);

  // NOTE: no named inner functions inside this evaluate body. tsx/esbuild runs
  // with keepNames, which rewrites a NAMED function (including a const-assigned
  // arrow, whose name is inferred) into a call to an injected `__name` helper —
  // and that helper does not exist in the page context, so the whole evaluate
  // dies with "ReferenceError: __name is not defined". Arrows passed directly as
  // arguments are anonymous and cross the boundary fine.
  const r = await page.evaluate(() => {
    const moved = [...document.querySelectorAll(".rc-moved")].filter(
      (el) => (el as HTMLElement).offsetParent !== null,
    );
    const news = [...document.querySelectorAll(".rc-new")].filter(
      (el) => (el as HTMLElement).offsetParent !== null,
    );

    // The longest NEWS headline on screen — the clamp's worst live load.
    let longest: Reading["longest"] = null;
    for (const el of news) {
      const b = el.querySelector(".rc-chip-body") as HTMLElement | null;
      if (!b) continue;
      const text = (b.textContent ?? "").trim();
      if (longest && text.length <= longest.chars) continue;
      const lh = parseFloat(getComputedStyle(b).lineHeight) || 1;
      longest = {
        chars: text.length,
        text,
        // scrollHeight > clientHeight means the 2-line clamp actually bit.
        clamped: b.scrollHeight > b.clientHeight + 1,
        lines: Math.round(b.clientHeight / lh),
        boxWidth: Math.round(b.getBoundingClientRect().width),
      };
    }

    const card = document.querySelector(".race-card") as HTMLElement | null;
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      moved: moved.length,
      news: news.length,
      movedTexts: moved.map((el) =>
        (el.querySelector(".rc-chip-body")?.textContent ?? "").trim(),
      ),
      newsTexts: news.map((el) =>
        (el.querySelector(".rc-chip-body")?.textContent ?? "").trim(),
      ),
      longest,
      cardWidth: card ? Math.round(card.getBoundingClientRect().width) : 0,
    };
  });

  const tag = `${vp.name}${reduced ? "-reduced" : ""}`;
  fs.mkdirSync(OUT, { recursive: true });
  // Full-page, so the chips are provably in frame rather than cropped to a
  // region chosen to contain them.
  await page.screenshot({ path: `${OUT}/races-chips-${tag}.png`, fullPage: true });
  // …and an element-scoped crop of the box itself. The full-page shot proves the
  // chips are in frame rather than cropped to a region chosen to contain them;
  // this one is the readable evidence a human actually looks at, and producing
  // both from the SAME run means they cannot disagree.
  await page
    .locator(".dv2-racesbox")
    .screenshot({ path: `${OUT}/racesbox-${tag}.png` });
  await ctx.close();

  return {
    viewport: vp.name,
    motion: reduced ? "reduce" : "no-preference",
    overflow: r.docScrollWidth - r.docClientWidth,
    ...r,
  };
}

(async () => {
  const browser = await chromium.launch();
  const rows: Reading[] = [];
  for (const vp of VIEWPORTS) {
    rows.push(await capture(browser, vp, false));
    rows.push(await capture(browser, vp, true));
  }
  await browser.close();

  console.log(
    "\nvp     motion          docScroll/client  overflow  moved news  card  longest-headline",
  );
  for (const r of rows) {
    const l = r.longest;
    console.log(
      `${r.viewport.padEnd(6)} ${r.motion.padEnd(15)} ` +
        `${String(r.docScrollWidth).padStart(5)}/${String(r.docClientWidth).padEnd(5)} ` +
        `${String(r.overflow).padStart(8)}  ${String(r.moved).padStart(5)} ${String(r.news).padStart(4)}  ` +
        `${String(r.cardWidth).padStart(4)}  ` +
        (l
          ? `${l.chars}ch in ${l.lines} line(s), clamped=${l.clamped}, box=${l.boxWidth}px`
          : "(none)"),
    );
  }

  const sample = rows[0];
  if (sample) {
    console.log("\nMOVED chip bodies (1440):");
    for (const t of sample.movedTexts) console.log("   ", t);
    console.log("NEWS chip bodies (1440):");
    for (const t of sample.newsTexts) console.log("   ", t);
  }

  const bad = rows.filter((r) => r.overflow > 1);
  console.log(
    `\noverflow verdict: ${bad.length === 0 ? "CLEAN at every viewport (1px subpixel tolerance)" : "OVERFLOW at " + bad.map((b) => `${b.viewport}/${b.motion}`).join(", ")}`,
  );
  console.log(`captures → ${OUT}/`);
  process.exit(bad.length === 0 ? 0 : 1);
})();
