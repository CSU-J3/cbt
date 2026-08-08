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

/**
 * Scroll the feed so we are testing a row that is NOT the first one at rest.
 *
 * THE SCROLL CONTAINER IS `.v2f` ITSELF, and finding that empirically mattered.
 * The HO 627 handoff describes it as "`.bills` is max-height: calc(100vh - 32px)
 * with `.feed { overflow-y: auto }`" — NEITHER CLASS EXISTS in the shipped DOM
 * (measured at HEAD fcf6009: the column is `.dash-bills`, the scroller is
 * `.v2f`). A harness that scrolls a missing selector silently scrolls nothing
 * and then reports "feed too short to scroll", which is the same-as-success
 * shape. So this discovers the scroller by WALKING UP from a row and taking the
 * first ancestor that actually overflows, rather than trusting a class name.
 *
 * A row must also be clipped-tested against the CONTAINER's rect, not the
 * viewport: inside an overflow:auto box a row can be inside the window and still
 * be scrolled out of its own container, and clicking its reported centre then
 * lands on whatever is painted there instead.
 */
async function scrollFeedAndPickRow(
  page: Page,
): Promise<{ index: number; total: number; scrolled: number; scroller: string } | null> {
  return page.evaluate(() => {
    const groups = Array.from(document.querySelectorAll(".v2f-group"));
    if (groups.length === 0) return null;

    // Walk up from the first row to the nearest genuinely-overflowing ancestor.
    let scroller: HTMLElement | null = null;
    let e: HTMLElement | null = groups[0] as HTMLElement;
    while (e && e !== document.body) {
      const cs = getComputedStyle(e);
      if (
        (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
        e.scrollHeight > e.clientHeight + 8
      ) {
        scroller = e;
        break;
      }
      e = e.parentElement;
    }

    let scrolled = 0;
    if (scroller) {
      scroller.scrollTop = Math.floor(
        (scroller.scrollHeight - scroller.clientHeight) * 0.5,
      );
      scrolled = scroller.scrollTop;
    }

    const bounds = scroller
      ? scroller.getBoundingClientRect()
      : ({ top: 0, bottom: window.innerHeight } as DOMRect);
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(window.innerHeight, bounds.bottom);

    // Last row fully inside BOTH the scroller and the viewport.
    let pick = -1;
    groups.forEach((g, i) => {
      const row = g.querySelector(".v2f-row") as HTMLElement | null;
      if (!row) return;
      const r = row.getBoundingClientRect();
      if (r.top >= top && r.bottom <= bottom && r.width > 0) pick = i;
    });
    if (pick < 0) pick = 0;
    return {
      index: pick,
      total: groups.length,
      scrolled,
      scroller: scroller ? `${scroller.tagName}.${scroller.className}`.slice(0, 40) : "NONE",
    };
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

// Collapse via the disclosure glyph: it is always present, leading, carries no
// href, and is a stable target. (Clicking the row's right edge worked but is
// fragile — after HO 609's left-packing that space is empty by construction, and
// an empty region is exactly what a future layout change reclaims.)
async function collapseAll(page: Page, groupIndex: number) {
  if (await isOpen(page, groupIndex)) {
    const d = await rectOf(page, groupIndex, ".v2f-disc");
    const r = d ?? (await rectOf(page, groupIndex, ".v2f-row"));
    if (r) await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    await page.waitForTimeout(200);
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
    `   feed: ${picked.total} rows · scroller ${picked.scroller} · scrolled ${picked.scrolled}px · testing row index ${gi} (last fully visible)`,
  );
  record(
    `${label} tested from a scrolled position`,
    picked.scrolled > 0,
    picked.scrolled > 0
      ? `scrollTop=${picked.scrolled} in ${picked.scroller}`
      : `NOT SCROLLED — scroller=${picked.scroller}, ${picked.total} rows (the column is not overflowing: commit 1's premise)`,
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
  // The panel opens BELOW a row that is deliberately near the scroller's bottom
  // edge, so the drill can be scrolled out of the overflow box. getBoundingClientRect
  // still returns coordinates for a clipped element — they are simply not where
  // anything is painted — so measuring without bringing it into view is how a
  // harness ends up clicking the page background and calling it a product failure.
  // A user scrolls; so do we. `block: "nearest"` scrolls the container, not the window.
  await page.evaluate((i) => {
    const g = document.querySelectorAll(".v2f-group")[i];
    (g?.querySelector(".bxp-head-drill") as HTMLElement | null)?.scrollIntoView({
      block: "nearest",
    });
  }, gi);
  await page.waitForTimeout(250);
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

/**
 * HO 630 — the Absence Watch band, which now expands in place instead of
 * navigating. Same discipline as the feed legs above: real mouse clicks at each
 * target's own rect centre, never a selector click, because the defect class this
 * gate exists for is a child that swallows the event at exactly the pixels a user
 * aims at.
 *
 * NO SCROLL LEG HERE, and it is dropped deliberately rather than silently: the
 * band sits directly under the nav at the top of the page, so the coordinate
 * divergence the feed legs exist to catch (client rect vs page position inside an
 * overflowing scroller) cannot arise. The feed legs still carry it.
 */
async function runAbsenceWidth(
  ctx: BrowserContext,
  label: string,
  w: number,
  h: number,
) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: h });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(SETTLE_MS);

  const rowCount = await page.locator(".abw-row").count();
  if (rowCount === 0) {
    // Zero absent members is the GOOD-NEWS state (C4) and renders nothing, so an
    // empty band is not a failure — but it is also not a pass, and saying so is
    // the point: a skip-on-empty guard here would go green while measuring
    // nothing (the HO 503 false-green).
    record(`${label} absence band present`, true, "band empty (0 absent) — legs N/A, nothing exercised");
    await page.close();
    return;
  }
  record(`${label} absence band present`, true, `${rowCount} row(s)`);

  const rowRect = async (): Promise<Rect | null> =>
    page.evaluate(() => {
      const el = document.querySelector(".abw-row");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  const nameRect = async (): Promise<Rect | null> =>
    page.evaluate(() => {
      const el = document.querySelector(".abw-row .abw-name");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  const cardOpen = async () => (await page.locator(".abw-card-wrap").count()) > 0;
  // Close whichever row is actually open — NOT row 0. HO 631's switch leg (8) can
  // leave row B open, and clicking row A then SWITCHES to A rather than closing,
  // so the old row-0 cleanup silently left a card open and the next leg failed
  // looking for content it had just re-opened. The cleanup has to follow the
  // single-open state rather than assume where it is.
  const collapse = async () => {
    if (!(await cardOpen())) return;
    const r = await page.evaluate(() => {
      const lis = Array.from(document.querySelectorAll(".abw-li"));
      const openLi = lis.find((li) => li.classList.contains("is-open"));
      const el = (openLi ?? lis[0])?.querySelector(".abw-row");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    if (r) await clickCentre(page, r);
    await page.waitForTimeout(250);
  };

  // HO 631 — the zero-reflow probe. The element AFTER the band, resolved from the
  // DOM rather than named, so it stays correct when the dashboard order changes.
  await page.evaluate(() => {
    const band = document.querySelector(".abw");
    let n = band?.nextElementSibling ?? null;
    if (!n && band?.parentElement) n = band.parentElement.nextElementSibling;
    n?.setAttribute("data-reflow-probe", "1");
  });
  const probeTop = async (): Promise<number | null> =>
    page.evaluate(() => {
      const e = document.querySelector("[data-reflow-probe]");
      if (!e) return null;
      return Math.round(e.getBoundingClientRect().top * 100) / 100;
    });

  // 1 — plain click at the ROW CENTRE expands, does not navigate, and — HO 631 —
  // opens as an OVERLAY: the page below the band does not move. The delta is the
  // discriminating half. Before this HO the card expanded in flow and the same
  // measurement read ~523px at 2560, so a leg that only asserted "open" was
  // equally green either side of the change and proved nothing about the overlay.
  const urlBefore = page.url();
  const topClosed = await probeTop();
  const r1 = await rowRect();
  if (r1) {
    await clickCentre(page, r1);
    await page.waitForTimeout(400);
    const opened = await cardOpen();
    const stayed = page.url() === urlBefore;
    const topOpen = await probeTop();
    const delta =
      topClosed !== null && topOpen !== null
        ? Math.round((topOpen - topClosed) * 100) / 100
        : null;
    record(
      `${label} absence row click OPENS AS OVERLAY (no reflow)`,
      opened && stayed && delta === 0,
      `open=${opened} url-unchanged=${stayed} page-shift=${delta === null ? "unmeasurable" : `${delta}px`}`,
    );
  } else record(`${label} absence row click OPENS AS OVERLAY (no reflow)`, false, ".abw-row rect not measurable");
  await collapse();

  // 2 — plain click on the NAME expands too (the name is an <a>; the plain case
  // must reach the row's toggle rather than navigating).
  const rn = await nameRect();
  if (rn) {
    await clickCentre(page, rn);
    await page.waitForTimeout(400);
    const opened = await cardOpen();
    record(
      `${label} absence NAME plain-click expands`,
      opened && page.url() === urlBefore,
      `open=${opened} url-unchanged=${page.url() === urlBefore}`,
    );
  } else record(`${label} absence NAME plain-click expands`, false, ".abw-name rect not measurable");
  await collapse();

  // 3 — ctrl-click the NAME navigates in a background tab and must NOT expand.
  // This is the HO 627 MIRRORED defect: letting the default happen is not enough,
  // because the event still bubbles to the row's toggle.
  const rn2 = await nameRect();
  if (rn2) {
    const before = ctx.pages().length;
    await page.mouse.move(rn2.x + rn2.w / 2, rn2.y + rn2.h / 2);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up("Control");
    await page.waitForTimeout(800);
    const after = ctx.pages().length;
    const opened = await cardOpen();
    // The background tab can still be about:blank when we look — a first pass
    // asserted only "a tab opened" and reported "no /members tab" while passing,
    // which is a leg that proves less than it prints. Wait for the destination.
    const newTab = ctx.pages().find((p) => p !== page);
    let dest = "no new tab";
    if (newTab) {
      await newTab.waitForURL(/\/members\//, { timeout: 4000 }).catch(() => {});
      dest = newTab.url().replace(BASE_URL, "") || "about:blank";
    }
    record(
      `${label} absence ctrl-click NAME does NOT expand`,
      !opened && after > before && /\/members\//.test(dest),
      `open=${opened} · tabs ${before}->${after} · ${dest}`,
    );
    for (const p of ctx.pages()) if (p !== page) await p.close();
  } else record(`${label} absence ctrl-click NAME does NOT expand`, false, ".abw-name rect not measurable");
  await collapse();

  // 4 — Enter opens, Space closes.
  await page.locator(".abw-row").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(350);
  const enterOpen = await cardOpen();
  record(`${label} absence Enter expands`, enterOpen, `open=${enterOpen}`);
  await page.keyboard.press(" ");
  await page.waitForTimeout(350);
  const spaceClosed = !(await cardOpen());
  record(`${label} absence Space toggles`, spaceClosed, `closed-again=${spaceClosed}`);

  // 6 — HO 631: Esc closes AND focus returns to the row that opened the card.
  // Both halves are asserted: a card that closes while focus stays on the pop (or
  // worse, resets to <body>) strands a keyboard reader at the top of the document,
  // which is a different defect from "Esc does nothing" and reads identically if
  // you only check that the card went away.
  const r6 = await rowRect();
  if (r6) {
    await clickCentre(page, r6);
    await page.waitForTimeout(350);
    const openedFirst = await cardOpen();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const closed = !(await cardOpen());
    const focusBack = await page.evaluate(() => {
      const rows = document.querySelectorAll(".abw-row");
      return document.activeElement === rows[0];
    });
    record(
      `${label} absence Esc closes AND returns focus to row`,
      openedFirst && closed && focusBack,
      `opened=${openedFirst} closed=${closed} focus-on-row=${focusBack}`,
    );
  } else record(`${label} absence Esc closes AND returns focus to row`, false, ".abw-row rect not measurable");
  await collapse();

  // 7 — HO 631: an outside click closes the card AND the thing that was clicked
  // does its own job. ONE click, not two. Both halves are asserted deliberately:
  // a leg that only checks the close passes just as well against an implementation
  // that swallows the first click with preventDefault, which is precisely the
  // behaviour the ruling forbids. So this clicks a FEED BILL ROW — a real target
  // with its own click behaviour, in the other column — and requires the card to
  // be gone and that bill to be expanded after the single click.
  await collapseAll(page, 0);
  const r7 = await rowRect();
  const feedTitle = await rectOf(page, 0, ".v2f-title");
  if (r7 && feedTitle) {
    await clickCentre(page, r7);
    await page.waitForTimeout(350);
    const cardWasOpen = await cardOpen();
    await clickCentre(page, feedTitle);
    await page.waitForTimeout(450);
    const cardClosed = !(await cardOpen());
    const billExpanded = await isOpen(page, 0);
    record(
      `${label} absence outside click CLOSES + target still acts`,
      cardWasOpen && cardClosed && billExpanded,
      `card-was-open=${cardWasOpen} card-closed=${cardClosed} clicked-bill-expanded=${billExpanded}`,
    );
  } else {
    record(
      `${label} absence outside click CLOSES + target still acts`,
      false,
      `rects not measurable (row=${!!r7} feedTitle=${!!feedTitle})`,
    );
  }
  await collapseAll(page, 0);
  await collapse();

  // 8 — HO 631: opening A then clicking B SWITCHES rather than stacking. Needs a
  // second row; with one absent member there is nothing to switch to, and saying
  // so beats a silent skip.
  if (rowCount >= 2) {
    const rects = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".abw-row")).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    const a = rects[0];
    const b = rects[1];
    if (a && b) {
      await clickCentre(page, a);
      await page.waitForTimeout(350);
      await clickCentre(page, b);
      await page.waitForTimeout(400);
      const state = await page.evaluate(() => {
        const lis = Array.from(document.querySelectorAll(".abw-li"));
        const openIdx = lis.findIndex((li) => li.classList.contains("is-open"));
        return {
          openCount: lis.filter((li) => li.classList.contains("is-open")).length,
          openIdx,
          pops: document.querySelectorAll(".abw-card-pop").length,
          popLabel:
            document.querySelector(".abw-card-pop")?.getAttribute("aria-label") ?? "",
          expandedAttrs: Array.from(document.querySelectorAll(".abw-row"))
            .map((r) => r.getAttribute("aria-expanded"))
            .join(","),
        };
      });
      record(
        `${label} absence open A -> click B SWITCHES (single-open)`,
        state.openCount === 1 && state.openIdx === 1 && state.pops === 1,
        `open-rows=${state.openCount} open-index=${state.openIdx} pops=${state.pops} aria=[${state.expandedAttrs}] · ${state.popLabel}`,
      );
    } else record(`${label} absence open A -> click B SWITCHES (single-open)`, false, "row rects not measurable");
  } else {
    record(
      `${label} absence open A -> click B SWITCHES (single-open)`,
      true,
      `only ${rowCount} row — nothing to switch to, leg not exercised`,
    );
  }
  await collapse();

  // 5 — the card's head-drill navigates, and it LEADS the card (HO 630 measured
  // the panel's own buttons ~85% of the way down, which is why it exists).
  const r5 = await rowRect();
  if (r5) {
    await clickCentre(page, r5);
    await page.waitForTimeout(400);
  }
  const drill = await page.evaluate(() => {
    const wrap = document.querySelector(".abw-card-wrap");
    const a = wrap?.querySelector(".abw-drill");
    if (!wrap || !a) return null;
    const wr = wrap.getBoundingClientRect();
    const r = a.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, dy: Math.round(r.top - wr.top) };
  });
  if (drill) {
    await clickCentre(page, { x: drill.x, y: drill.y, w: drill.w, h: drill.h });
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(600);
    const ok = /\/members\//.test(page.url());
    record(
      `${label} absence card -> FULL PAGE navigates`,
      ok && drill.dy < 40,
      `${drill.dy}px from card top · url=${page.url().replace(BASE_URL, "")}`,
    );
  } else record(`${label} absence card -> FULL PAGE navigates`, false, ".abw-drill not found in the open card");

  await page.close();
}

async function main(): Promise<number> {
  console.log("=== HO 627 COMMIT 0 GATE — clicking the pixels users click ===");
  console.log("    (HO 630 extends it to the Absence Watch band's expand-in-place)");
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
    try {
      await runAbsenceWidth(ctx, label, w, h);
    } catch (e) {
      record(`${label} absence harness`, false, String(e).slice(0, 160));
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
