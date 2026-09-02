// HO 682 — captures + readings for the dashboard HEARINGS day-schedule blowout.
//
// Run it twice: once at the RED sha and once on the change, into different out
// dirs. The two readings are the proof; the PNGs are the check (docs/method.md
// § Gates — "a visual check with no capture is not a check").
//
//   npm run build && (set -a; . ./.env; set +a; npm run start)
//   npx tsx scripts/diagnostic/hsch-shots-682.ts http://localhost:3000 docs/handoffs/682-artifacts/red
//
// LOCAL ONLY, and the reason is not convenience: BotID withholds the markets
// tape from headless prod, so the ODDS parity leg cannot run there at all.
//
// PERISHABLE. The exhibit is a markup whose published Congress.gov title is the
// full semicolon-joined ten-measure list, on the shown day of 2026-09-02. It
// leaves the shown day at midnight and the readings below go quiet — `rows`
// stays 16 but `longestTitle.chars` drops to ~130. That is exactly why the
// DURABLE form of this gate is the fit-finish invariant and the layout audit's
// M0, not this harness: a capture is about the data on the table that day.
//
// THREE READINGS, and each one denies a different way the fix could be fake:
//   1. docScrollWidth vs clientWidth       — the page stops scrolling.
//   2. longestTitle.boxW vs contentW       — the title is ELLIPSIZED rather than
//                                            the panel being clipped or the row
//                                            dropped. boxW == contentW is the
//                                            defect; boxW << contentW is the fix.
//   3. colRects + birthright.visible       — column B is SEATED beside column A
//                                            and on-screen. A page that stops
//                                            scrolling because column B moved
//                                            somewhere unreadable would pass (1)
//                                            and fail here.
//
// Plus the ODDS strip parity leg (HO 681's live read must still hold) and, per
// the HO 682 ruling on backlog `:488`, a 430 reading WITH A FEED ROW EXPANDED —
// reported beside the others, claiming no closure. That entry is a different
// element (169px, pre-existing) and this HO does not fix it; the reading is here
// so the report cannot over-claim that `/` is clean at every width.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? "docs/handoffs/682-artifacts/green";

// The landing redirect is not what is under test.
const COOKIE = {
  name: "ct_seen", value: "1", domain: "localhost", path: "/",
  expires: -1, httpOnly: false, secure: false, sameSite: "Lax" as const,
};

// The method's named set, plus 1700 (the two-column breakpoint) and 2560 (the
// handoff's mandated wide capture). The reduced-motion passes are a DIFFERENT
// layout, not a dimmer one, so they are their own contexts.
const VIEWS: { w: number; h: number; tag: string; reduced?: boolean }[] = [
  { w: 2560, h: 1400, tag: "2560" },
  { w: 1920, h: 1400, tag: "1920" },
  { w: 1700, h: 1400, tag: "1700" },
  { w: 1440, h: 1200, tag: "1440" },
  { w: 1100, h: 1200, tag: "1100" },
  { w: 430, h: 1000, tag: "430" },
  { w: 2560, h: 1400, tag: "2560-reduced", reduced: true },
  { w: 1440, h: 1200, tag: "1440-reduced", reduced: true },
];

// Kept as a STRING: tsx/esbuild's keepNames rewrites named functions with a
// `__name(...)` wrapper that does not exist inside the page (HO 670 oddity).
const READ = `(() => {
  const q = (s) => Array.from(document.querySelectorAll(s));
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), width: Math.round(r.width) }; };

  const wrap = document.querySelector(".hsch-wrap");
  const colRects = wrap ? Array.from(wrap.children).map(box) : [];

  const titles = q(".hsch-title").map((t) => ({
    chars: (t.textContent || "").length,
    boxW: Math.round(t.getBoundingClientRect().width),
    contentW: t.scrollWidth,
    ellipsized: t.scrollWidth > t.clientWidth + 1,
  }));
  const longestTitle = titles.slice().sort((a, b) => b.chars - a.chars)[0] || null;

  // Column B's landmarks: the NOW marker and the 2:00p birthright-citizenship
  // hearing. Which column they land in is data-dependent; that they are ON
  // SCREEN is not.
  const nowEl = document.querySelector(".hsch-now");
  let birthright = null;
  const cols = q(".hsch-wrap > div");
  for (let c = 0; c < cols.length; c++) {
    const hit = Array.from(cols[c].querySelectorAll(".hsch-row")).filter((r) => /Birthright/i.test(r.textContent || ""))[0];
    if (hit) { const b = box(hit); birthright = { col: c, left: b.left, top: b.top, onScreen: b.right <= window.innerWidth && b.left >= 0 }; break; }
  }

  // HO 681 parity: FED CUT appears once per marquee copy, so its count must
  // equal SHUTDOWN's and RECESSION's. The literal ORDER is unassertable on \`/\`
  // — HO 376 shuffles each scrolling strip on mount.
  const oddsTape = q(".markets-tape").filter((t) => /ODDS/i.test(((t.querySelector(".markets-tape-label") || {}).textContent) || ""))[0];
  const oddsText = oddsTape ? (oddsTape.textContent || "").replace(/\\s+/g, " ") : "";
  const n = (re) => (oddsText.match(re) || []).length;

  return {
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
    horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    activeTab: (((document.querySelector(".dv2-racesbox-tab.is-active") || {}).textContent) || "").trim(),
    rows: q(".hsch-row").length,
    colRects,
    colsSideBySide: colRects.length === 2 && colRects[1].left >= colRects[0].right - 2,
    nowMarker: nowEl ? box(nowEl) : null,
    longestTitle,
    titlesEllipsized: titles.filter((t) => t.ellipsized).length,
    titleCount: titles.length,
    birthright,
    odds: { shutdown: n(/SHUTDOWN/g), fedcut: n(/FED CUT/g), recession: n(/RECESSION/g) },
  };
})()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const readings: unknown[] = [];
  let overflowing = 0;

  for (const v of VIEWS) {
    const ctx = await browser.newContext({
      viewport: { width: v.w, height: v.h },
      reducedMotion: v.reduced ? "reduce" : "no-preference",
      storageState: { cookies: [COOKIE], origins: [] },
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    // Freeze the marquee so a still frame is deterministic (HO 375 pattern).
    await page.addStyleTag({ content: ".markets-tape-track { animation-play-state: paused !important; }" });
    await page.waitForTimeout(900);

    const r = (await page.evaluate(READ)) as Record<string, any>;
    if (r.horizontalScroll) overflowing++;
    const file = join(OUT, `hsch-${v.tag}.png`);
    await page.screenshot({ path: file, fullPage: false });
    await page.screenshot({ path: join(OUT, `hsch-${v.tag}-full.png`), fullPage: true });
    readings.push({ tag: v.tag, width: v.w, reduced: !!v.reduced, file, errors: [...errors], reading: r });

    console.log(
      `${v.tag.padEnd(14)} doc ${String(r.docScrollWidth).padStart(5)}/${String(r.docClientWidth).padStart(4)} ` +
        `${r.horizontalScroll ? "H-SCROLL" : "clean   "} rows=${r.rows} ` +
        `title chars=${r.longestTitle?.chars} box=${r.longestTitle?.boxW} content=${r.longestTitle?.contentW} ` +
        `ellipsized=${r.titlesEllipsized}/${r.titleCount} sideBySide=${r.colsSideBySide} ` +
        `birthright=${JSON.stringify(r.birthright)}`,
    );
    if (v.tag === "2560") console.log(`  ODDS parity ${JSON.stringify(r.odds)}`);
    if (errors.length) console.log(`  ** console/page errors: ${JSON.stringify(errors.slice(0, 3))}`);
    await ctx.close();
  }

  // backlog `:488` control — 430 WITH a feed row expanded. Reported, not closed.
  const ctx = await browser.newContext({ viewport: { width: 430, height: 1000 }, storageState: { cookies: [COOKIE], origins: [] } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const row = page.locator(".v2f-row").first();
  const expanded = await row.click({ timeout: 10_000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(900);
  const r430 = (await page.evaluate(READ)) as Record<string, any>;
  await page.screenshot({ path: join(OUT, "hsch-430-row-expanded.png"), fullPage: false });
  console.log(
    `430+expanded   doc ${r430.docScrollWidth}/${r430.docClientWidth} ` +
      `${r430.horizontalScroll ? "H-SCROLL" : "clean"} (rowExpanded=${expanded}) ` +
      `— backlog :488 control, NOT closed by this HO`,
  );
  readings.push({ tag: "430-row-expanded", width: 430, rowExpanded: expanded, reading: r430 });
  await ctx.close();

  await browser.close();
  const path = join(OUT, "readings.json");
  writeFileSync(path, JSON.stringify(readings, null, 2));
  console.log(`\nwrote ${readings.length} readings -> ${path}`);
  console.log(`viewports with a horizontal document scroll: ${overflowing} of ${VIEWS.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
