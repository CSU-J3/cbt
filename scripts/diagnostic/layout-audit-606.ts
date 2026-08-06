// HO 606 — cross-route layout audit: read-only. BUILDS NOTHING, FIXES NOTHING.
//
// Prices the C1-C8 layout conventions (docs/design/layout-conventions-arc.md) across
// the whole site so the P3-P6 remediation phases have a ranked worklist instead of
// "look at everything". Five measurements, four of them geometry:
//
//   M1 — C1, far-right anchors. TWO modes, because one missed half the offenders:
//        M1a repeated rows (>=3 element children, >=3 siblings sharing tag+class),
//        M1b singleton wide rows (>=600px, >=2 children on one line, no siblings).
//        Reports largest INTERIOR gap and, separately, the TRAILING gap. The
//        trailing gap is measured and is NOT a defect — it is the target state.
//        Reporting both means "M1 = 0" cannot be reached by deleting rows.
//   M2 — C7, stretched panels. Grid/flex children that READ AS A PANEL (non-zero
//        border, or a background differing from the parent), measured as
//        panelRect.bottom - max(child rect.bottom). An invisible stretched wrapper
//        costs nothing and is not a finding.
//   M3 — C3, row noise. Per repeated-row group, descendants whose OWN computed
//        style differs from their parent's (own-vs-parent, so a pass-through
//        wrapper and its child don't both score). Resolved rgb, not authored
//        tokens — var(--text-dim) and #6b7280 must not read as two colors.
//   M4 — C4, reserved empty space. Every >=40px element with <=12 chars of text is
//        EMITTED as a candidate, so the vocabulary closes on measurement rather
//        than on the NO MEETINGS / — / NO DATA / NONE seed guess.
//   M5 — narrow-width baseline at 1024/900/720. 900 is a BREAKPOINT, not a neutral
//        width (.dv2-grid collapses at max-width:900, globals.css:646), so the
//        ladder brackets it rather than measuring only at it.
//   M6 — dead routes: answered by static analysis, no browser. Printed as a fixed
//        note; the live question is whether the branch set is complete.
//
// Target is `npm run build && npm run start` on :3000. NOT `next dev` (the overlay
// and HMR alter the geometry being measured) and NOT prod (BotID withholds the
// markets tape from headless Chrome, e2e/smoke.spec.ts:17-20, and the tape is a C1
// row). Reads hit prod Turso, so each route is loaded twice and measured on hit 2.
//
// THE INSTRUMENT IS FALSIFIED BEFORE IT IS TRUSTED (arc §3 GO condition, §4 rule).
// A first leg points M1/M2 at `/` and must name the known offenders by selector
// path; a near-zero site-wide result from a detector that structurally cannot fire
// looks identical to a clean site. No full crawl on a failed falsification leg —
// 78 page loads of Turso reads against a broken instrument is spend with no
// information.
//
// Cross-run warning (HO 604 keyed-diff oddity): this audit is re-run after P3-P6,
// and remediation RENAMES CLASSES. `selectorPath` is a human pointer, NOT a join
// key — the per-route counts are the cross-run currency. A comparison keyed on
// class names goes blind exactly where the fix landed.
//
// Read-only: no DB writes, no page interaction beyond navigation, no fixes.
//
//   npx tsx scripts/diagnostic/layout-audit-606.ts
//   npx tsx scripts/diagnostic/layout-audit-606.ts --route home   (or AUDIT_ROUTE=home)
//
// HO 608 — two changes the 606 run queued for "next run":
//   (1) The three redirect ALIASES are gone from the route list (`/races` and
//       `/primaries` 308 → /electoral, `/members/pass-rate` 307 → /members?sort=
//       passrate). 606 crawled them and measured the same page twice more,
//       inflating the site-wide M1 total 1,329 → 1,902. 27 distinct pages is the
//       real denominator; the 607 block already corrected the arithmetic and this
//       makes the script agree with it.
//   (2) `--route <slug>` (or AUDIT_ROUTE) measures ONE route, so a P3 slice can be
//       scored before/after for ~4 page loads instead of ~80. Under a filter the
//       M5 narrow ladder is SKIPPED and says so — a slice score is a wide-viewport
//       delta, and a silently-dropped ladder would read like a clean narrow result.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const BASE_URL = process.env.AUDIT_BASE_URL ?? "http://localhost:3000";

// Seeds reused verbatim from e2e/smoke.spec.ts (HO 379 recon), same env overrides.
const BILL = process.env.SEED_BILL ?? "119-s-2";
const MEMBER = process.env.SEED_MEMBER ?? "A000055";
const RACE = process.env.SEED_RACE ?? "AL-01-2026";
const COMMITTEE = process.env.SEED_COMMITTEE ?? "hlig00";
const REPORT = process.env.SEED_REPORT ?? "2026-06-15";
const VOTE = process.env.SEED_VOTE ?? "senate-119-2-207";

// `/` redirects anonymous visitors without ct_seen to /welcome (app/page.tsx:74).
// Set context-wide or the audit reports a clean dashboard it never visited.
const GATE_COOKIE = { name: "ct_seen", value: "1", url: BASE_URL };

const WIDE_W = 2560;
const WIDE_H = 1440;
const NARROW_WIDTHS = [1024, 900, 720] as const;
const ROUTE_TIMEOUT_MS = 30_000;
const SETTLE_MS = 1200;

const GAP_THRESHOLD_PX = 120;
const M2_SLACK_PX = 40;
const M4_MIN_H = 40;
const M4_MAX_CHARS = 12;
const M1B_MIN_WIDTH = 600;
const BAND_PX = 4;

const ARTIFACT_DIR = "docs/handoffs/606-artifacts";

type Route = { slug: string; path: string };

// smoke.spec.ts ROUTES (37 = 31 literal + the 6-entry STAGES spread) minus five of
// the six ?stage= variants (same shell, different feed; ?stage=committee is kept —
// a known pageErr site whose filter strip adds a row) and minus EVERY redirect
// alias: /dashboard-v2 and /committees (excluded since 606), plus /races,
// /primaries and /members/pass-rate (HO 608 — same reason, dropped after the 606
// run measured them as duplicate pages). 37-5-5 = 27, less /dashboard-classic,
// removed as a route at HO 608 = 26. The printed count below is the record.
const ROUTES: Route[] = [
  { slug: "home", path: "/" },
  { slug: "home-stage-committee", path: "/?stage=committee" },
  { slug: "welcome", path: "/welcome" },
  { slug: "bills", path: "/bills" },
  { slug: "members", path: "/members" },
  { slug: "electoral", path: "/electoral" },
  { slug: "reports", path: "/reports" },
  { slug: "hearings", path: "/hearings" },
  { slug: "news", path: "/news" },
  { slug: "changes", path: "/changes" },
  { slug: "stale", path: "/stale" },
  { slug: "trends", path: "/trends" },
  { slug: "patterns", path: "/patterns" },
  { slug: "search", path: "/search" },
  { slug: "president", path: "/president" },
  { slug: "amendments", path: "/amendments" },
  { slug: "nominations", path: "/nominations" },
  { slug: "lobbying", path: "/lobbying" },
  { slug: "trades", path: "/trades" },
  { slug: "watchlist", path: "/watchlist" },
  { slug: "bill-detail", path: `/bill/${BILL}` },
  { slug: "member-detail", path: `/members/${MEMBER}` },
  { slug: "race-detail", path: `/race/${RACE}` },
  { slug: "committee-detail", path: `/committee/${COMMITTEE}` },
  { slug: "report-detail", path: `/reports/${REPORT}` },
  { slug: "vote", path: `/vote/${VOTE}` },
];

// --route <slug> / AUDIT_ROUTE — measure ONE route. Slice scoring for the P3
// handoffs (608-610) runs `--route home` before and after each slice.
function argFlag(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}
const ROUTE_FILTER = argFlag("--route") ?? process.env.AUDIT_ROUTE;
const ACTIVE_ROUTES: Route[] = ROUTE_FILTER
  ? ROUTES.filter((r) => r.slug === ROUTE_FILTER)
  : ROUTES;

// HO 610 — routes the M2 falsification leg falls back to when `/` reads zero.
// Ordered cheapest-first; the leg stops at the first that fires.
const M2_FALLBACK_ROUTES: Route[] = [
  { slug: "bills", path: "/bills" },
  { slug: "members", path: "/members" },
  { slug: "electoral", path: "/electoral" },
];

const SUBSET_SLUGS = new Set([
  "home",
  "bills",
  "members",
  "bill-detail",
  "reports",
  "hearings",
]);

type Thresholds = {
  gapThreshold: number;
  m2Slack: number;
  m4MinH: number;
  m4MaxChars: number;
  m1bMinWidth: number;
  bandPx: number;
};

const THRESHOLDS: Thresholds = {
  gapThreshold: GAP_THRESHOLD_PX,
  m2Slack: M2_SLACK_PX,
  m4MinH: M4_MIN_H,
  m4MaxChars: M4_MAX_CHARS,
  m1bMinWidth: M1B_MIN_WIDTH,
  bandPx: BAND_PX,
};

// ---------------------------------------------------------------------------
// The in-page measurement. Everything below runs in the browser; it may not close
// over Node scope, so thresholds arrive as an argument.
// ---------------------------------------------------------------------------
function measureInPage(t: Thresholds) {
  const TRANSPARENT = "rgba(0, 0, 0, 0)";

  const pathOf = (el: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    let depth = 0;
    while (cur && depth < 4) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) s += `#${cur.id}`;
      else {
        const cls = Array.from(cur.classList).slice(0, 3).join(".");
        if (cls) s += `.${cls}`;
      }
      parts.unshift(s);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(" > ");
  };

  const sigOf = (el: Element): string =>
    `${el.tagName.toLowerCase()}|${Array.from(el.classList).sort().join(".")}`;

  const visible = (el: Element): boolean => {
    if (el.closest("svg")) return false;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed") return false;
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const borderPx = (cs: CSSStyleDeclaration): number =>
    Math.max(
      parseFloat(cs.borderTopWidth) || 0,
      parseFloat(cs.borderRightWidth) || 0,
      parseFloat(cs.borderBottomWidth) || 0,
      parseFloat(cs.borderLeftWidth) || 0,
    );

  // "Reads as a panel": non-zero border, or a background differing from the parent.
  const panelLike = (el: Element): boolean => {
    const cs = getComputedStyle(el);
    if (borderPx(cs) > 0) return true;
    const parent = el.parentElement;
    if (!parent) return false;
    const pcs = getComputedStyle(parent);
    if (cs.backgroundColor === TRANSPARENT) return false;
    return cs.backgroundColor !== pcs.backgroundColor;
  };

  // INK, not layout box. The whole point of C1 is VISIBLE whitespace, and a child
  // with `flex: 1` stretches its box across the gap the eye sees — so a box-edge
  // measurement reads ~10px on the breaking row whose headline visibly ends 800px
  // from its timestamp. An element's ink is its painted box if it has one
  // (border/background = a chip, whose box IS what you see), otherwise the rects of
  // its text plus any painted descendants. Falsification caught this; see header.
  const hasBoxPaint = (el: Element): boolean => {
    const cs = getComputedStyle(el);
    if (borderPx(cs) > 0) return true;
    if (cs.backgroundImage !== "none") return true;
    return cs.backgroundColor !== TRANSPARENT;
  };

  const inkRects = (el: Element): DOMRect[] => {
    if (hasBoxPaint(el)) return Array.from(el.getClientRects());
    const out: DOMRect[] = [];
    const range = document.createRange();
    range.selectNodeContents(el);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width > 0 && r.height > 0) out.push(r);
    }
    for (const d of Array.from(el.querySelectorAll("*"))) {
      if (!visible(d)) continue;
      if (!hasBoxPaint(d)) continue;
      for (const r of Array.from(d.getClientRects())) {
        if (r.width > 0 && r.height > 0) out.push(r);
      }
    }
    return out.length ? out : Array.from(el.getClientRects());
  };

  const allEls = Array.from(document.querySelectorAll("body *"));

  // --- sibling signature counts, for M1a ------------------------------------
  const sibCount = new WeakMap<Element, number>();
  const parents = new Set<Element>();
  for (const el of allEls) if (el.parentElement) parents.add(el.parentElement);
  for (const p of parents) {
    const counts = new Map<string, number>();
    for (const c of Array.from(p.children)) {
      const s = sigOf(c);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    for (const c of Array.from(p.children)) sibCount.set(c, counts.get(sigOf(c)) ?? 1);
  }

  // --- M1 -------------------------------------------------------------------
  type Row = {
    selectorPath: string;
    mode: "M1a" | "M1b";
    interiorGapPx: number;
    trailingGapPx: number;
    gapAsPctOfRowWidth: number;
    rowWidth: number;
  };
  const rows: Row[] = [];
  const allGaps: number[] = [];
  const m1aGroups: Element[][] = [];
  const seenGroupKey = new Set<string>();

  for (const el of allEls) {
    if (!visible(el)) continue;
    const kids = Array.from(el.children).filter((c) => visible(c));
    const rect = el.getBoundingClientRect();
    const siblings = sibCount.get(el) ?? 1;

    const isM1a = kids.length >= 3 && siblings >= 3;
    const wideEnough = rect.width >= t.m1bMinWidth;
    if (!isM1a && !wideEnough) continue;

    // Items = element children AND text nodes (a bare `·` between two spans
    // manufactures a false gap otherwise), unioned per (node, band).
    type Item = { l: number; r: number; band: number };
    const raw: Item[] = [];
    const pushRects = (rects: ArrayLike<DOMRect>) => {
      for (const rc of Array.from(rects)) {
        if (rc.width <= 0 || rc.height <= 0) continue;
        raw.push({ l: rc.left, r: rc.right, band: Math.round((rc.top + rc.bottom) / 2 / t.bandPx) });
      }
    };
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const txt = node.textContent ?? "";
        if (!txt.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        pushRects(range.getClientRects());
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const c = node as Element;
        if (!visible(c)) continue;
        pushRects(inkRects(c));
      }
    }
    if (raw.length < 2) continue;

    const bands = new Map<number, Item[]>();
    for (const it of raw) {
      const arr = bands.get(it.band);
      if (arr) arr.push(it);
      else bands.set(it.band, [it]);
    }

    let maxBandItems = 0;
    let interior = 0;
    for (const arr of Array.from(bands.values())) {
      if (arr.length > maxBandItems) maxBandItems = arr.length;
      if (arr.length < 2) continue;
      const sorted = arr.slice().sort((a, b) => a.l - b.l);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (!prev || !cur) continue;
        const gap = cur.l - prev.r;
        if (gap > interior) interior = gap;
        if (gap > 0) allGaps.push(gap);
      }
    }

    const qualifies = isM1a ? true : wideEnough && maxBandItems >= 2;
    if (!qualifies) continue;

    const cs = getComputedStyle(el);
    const innerRight =
      rect.right - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0);
    let rightMost = -Infinity;
    for (const it of raw) if (it.r > rightMost) rightMost = it.r;
    const trailing = Number.isFinite(rightMost) ? innerRight - rightMost : 0;

    rows.push({
      selectorPath: pathOf(el),
      mode: isM1a ? "M1a" : "M1b",
      interiorGapPx: Math.round(interior),
      trailingGapPx: Math.round(trailing),
      gapAsPctOfRowWidth: rect.width > 0 ? Math.round((interior / rect.width) * 1000) / 10 : 0,
      rowWidth: Math.round(rect.width),
    });

    if (isM1a) {
      const parent = el.parentElement;
      if (parent) {
        const key = `${pathOf(parent)}##${sigOf(el)}`;
        if (!seenGroupKey.has(key)) {
          seenGroupKey.add(key);
          const group = Array.from(parent.children).filter(
            (c) => sigOf(c) === sigOf(el) && visible(c),
          );
          if (group.length >= 3) m1aGroups.push(group);
        }
      }
    }
  }

  // --- M2 -------------------------------------------------------------------
  type Panel = { selectorPath: string; slackPx: number; panelHeight: number };
  const panels: Panel[] = [];
  for (const el of allEls) {
    if (!visible(el)) continue;
    const d = getComputedStyle(el).display;
    if (!/grid|flex/.test(d)) continue;
    for (const child of Array.from(el.children)) {
      if (!visible(child)) continue;
      if (!panelLike(child)) continue;
      const cr = child.getBoundingClientRect();
      // Deepest INK, not the deepest direct child: a stretched panel whose own last
      // child also stretches hides its slack one level down, so measuring direct
      // children reads zero on exactly the panels C7 is about.
      let maxBottom = -Infinity;
      for (const d of Array.from(child.querySelectorAll("*"))) {
        if (!visible(d)) continue;
        if (!hasBoxPaint(d) && !(d.textContent ?? "").trim()) continue;
        for (const r of inkRects(d)) {
          if (r.height <= 0) continue;
          if (r.bottom > maxBottom) maxBottom = r.bottom;
        }
      }
      if (!Number.isFinite(maxBottom)) continue;
      const slack = cr.bottom - maxBottom;
      if (slack > t.m2Slack) {
        panels.push({
          selectorPath: pathOf(child),
          slackPx: Math.round(slack),
          panelHeight: Math.round(cr.height),
        });
      }
    }
  }

  // --- M3 -------------------------------------------------------------------
  // Own-vs-parent, resolved rgb. Counts a descendant once however many properties
  // differ. Only over M1a groups — "per repeated-row group".
  let noiseRowCount = 0;
  let noiseTotal = 0;
  let worstRowNoise = 0;
  for (const group of m1aGroups) {
    for (const row of group) {
      let n = 0;
      for (const d of Array.from(row.querySelectorAll("*"))) {
        if (!visible(d)) continue;
        const parent = d.parentElement;
        if (!parent) continue;
        const cs = getComputedStyle(d);
        const pcs = getComputedStyle(parent);
        const colorDiff = cs.color !== pcs.color;
        const borderDiff = borderPx(cs) > 0;
        const bgDiff = cs.backgroundColor !== TRANSPARENT && cs.backgroundColor !== pcs.backgroundColor;
        if (colorDiff || borderDiff || bgDiff) n++;
      }
      noiseRowCount++;
      noiseTotal += n;
      if (n > worstRowNoise) worstRowNoise = n;
    }
  }

  // --- M4 -------------------------------------------------------------------
  const SEED_VOCAB = ["NO MEETINGS", "—", "NO DATA", "NONE"];
  type Empty = { selectorPath: string; text: string; heightPx: number; seeded: boolean };
  const candidates: { el: Element; rec: Empty }[] = [];
  for (const el of allEls) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < t.m4MinH) continue;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length > t.m4MaxChars) continue;
    const parent = el.parentElement;
    const parentDisplay = parent ? getComputedStyle(parent).display : "";
    const isTrackChild = /grid|flex/.test(parentDisplay);
    if (!panelLike(el) && !isTrackChild) continue;
    candidates.push({
      el,
      rec: {
        selectorPath: pathOf(el),
        text,
        heightPx: Math.round(r.height),
        seeded: SEED_VOCAB.includes(text.toUpperCase()),
      },
    });
  }
  // Keep only the outermost of any nested run, or one reserved box counts N times.
  const kept: Empty[] = [];
  for (const c of candidates) {
    const nestedInAnother = candidates.some((o) => o.el !== c.el && o.el.contains(c.el));
    if (!nestedInAnother) kept.push(c.rec);
  }

  // --- M5 inputs ------------------------------------------------------------
  const overflow: { selectorPath: string; scrollWidth: number; clientWidth: number }[] = [];
  for (const el of allEls) {
    if (!visible(el)) continue;
    if (el.clientWidth <= 0) continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      overflow.push({
        selectorPath: pathOf(el),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      });
    }
  }
  // Flex containers → rendered line count, so a narrow width can be compared to 2560.
  const flexLines: Record<string, number> = {};
  for (const el of allEls) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (!/flex/.test(cs.display)) continue;
    const kids = Array.from(el.children).filter((c) => visible(c));
    if (kids.length < 2) continue;
    const bandSet = new Set<number>();
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      bandSet.add(Math.round((r.top + r.bottom) / 2 / t.bandPx));
    }
    flexLines[pathOf(el)] = bandSet.size;
  }

  return {
    elementCount: allEls.length,
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
    m1: {
      rows,
      overThreshold: rows.filter((r) => r.interiorGapPx > t.gapThreshold).length,
      m1aCount: rows.filter((r) => r.mode === "M1a" && r.interiorGapPx > t.gapThreshold).length,
      m1bCount: rows.filter((r) => r.mode === "M1b" && r.interiorGapPx > t.gapThreshold).length,
      candidateRows: rows.length,
      gaps: allGaps.map((g) => Math.round(g)),
    },
    m2: { panels, count: panels.length },
    m3: {
      rowsScored: noiseRowCount,
      meanPerRow: noiseRowCount ? Math.round((noiseTotal / noiseRowCount) * 100) / 100 : 0,
      worstRow: worstRowNoise,
    },
    m4: {
      items: kept,
      count: kept.length,
      reservedPx: kept.reduce((a, b) => a + b.heightPx, 0),
      seededHits: kept.filter((k) => k.seeded).length,
    },
    m5: { overflow, flexLines },
  };
}

type Measured = Awaited<ReturnType<typeof measureInPage>>;

// The M2 falsification diagnostic: dump the panel predicate's intermediates for the
// stage funnel, so a zero is diagnosable rather than merely disappointing.
function funnelDiagnosticInPage() {
  const out: Record<string, unknown>[] = [];
  const targets = Array.from(document.querySelectorAll("[class*='funnel'], [class*='dist']"));
  for (const el of targets.slice(0, 8)) {
    const cs = getComputedStyle(el);
    const parent = el.parentElement;
    const pcs = parent ? getComputedStyle(parent) : null;
    out.push({
      selector: `${el.tagName.toLowerCase()}.${Array.from(el.classList).join(".")}`,
      display: cs.display,
      parentDisplay: pcs?.display ?? null,
      borderWidths: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
      background: cs.backgroundColor,
      parentBackground: pcs?.backgroundColor ?? null,
      backgroundsDiffer: pcs ? cs.backgroundColor !== pcs.backgroundColor : null,
      height: Math.round(el.getBoundingClientRect().height),
    });
  }
  return out;
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "—");

function histogram(gaps: number[]): string[] {
  const buckets = [0, 20, 40, 60, 80, 100, 120, 160, 200, 300, 500];
  const counts = new Array<number>(buckets.length).fill(0);
  for (const g of gaps) {
    let i = buckets.length - 1;
    for (let b = 0; b < buckets.length; b++) {
      const lo = buckets[b];
      const nxt = buckets[b + 1];
      if (lo === undefined) continue;
      if (nxt === undefined || (g >= lo && g < nxt)) {
        i = b;
        break;
      }
    }
    const cur = counts[i];
    if (cur !== undefined) counts[i] = cur + 1;
  }
  const total = gaps.length || 1;
  return buckets.map((lo, i) => {
    const hi = buckets[i + 1];
    const label = hi === undefined ? `${lo}+` : `${lo}-${hi}`;
    const c = counts[i] ?? 0;
    const bar = "#".repeat(Math.round((c / total) * 60));
    return `    ${label.padStart(8)}px  ${String(c).padStart(6)}  ${pct(c, total).padStart(6)}  ${bar}`;
  });
}

async function main() {
  const startedAt = Date.now();
  console.log("=".repeat(100));
  console.log("HO 606 — CROSS-ROUTE LAYOUT AUDIT (M1–M5).  Read-only.");
  console.log("=".repeat(100));
  console.log(`target            : ${BASE_URL}  (local production build; not dev, not prod)`);
  if (ROUTE_FILTER && ACTIVE_ROUTES.length === 0) {
    console.log(`route filter      : --route ${ROUTE_FILTER}  ** NO SUCH SLUG — nothing to measure. **`);
    console.log(`known slugs       : ${ROUTES.map((r) => r.slug).join(" ")}`);
    process.exitCode = 1;
    return;
  }
  const narrowLoads = ROUTE_FILTER ? 0 : SUBSET_SLUGS.size * NARROW_WIDTHS.length;
  console.log(
    `routes            : ${ACTIVE_ROUTES.length}${ROUTE_FILTER ? ` (--route ${ROUTE_FILTER}; full list is ${ROUTES.length})` : ""}`,
  );
  console.log(
    `page loads planned: ${ACTIVE_ROUTES.length * 2} (wide, 2 hits each) + ${narrowLoads} (narrow subset) = ${ACTIVE_ROUTES.length * 2 + narrowLoads}` +
      (ROUTE_FILTER ? "   [M5 narrow ladder SKIPPED under --route — a slice score is a wide-viewport delta]" : ""),
  );
  console.log(`wide viewport     : ${WIDE_W}x${WIDE_H}   narrow ladder: ${NARROW_WIDTHS.join(" · ")}`);
  console.log(
    `thresholds        : M1 gap >${GAP_THRESHOLD_PX}px · M1b width >=${M1B_MIN_WIDTH}px · M2 slack >${M2_SLACK_PX}px · M4 >=${M4_MIN_H}px & <=${M4_MAX_CHARS} chars · band ${BAND_PX}px`,
  );
  console.log(`seeds             : bill=${BILL} member=${MEMBER} race=${RACE} committee=${COMMITTEE} report=${REPORT} vote=${VOTE}`);
  console.log("");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: WIDE_W, height: WIDE_H },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await ctx.addCookies([GATE_COOKIE]);
  // tsx/esbuild compiles with keepNames, which wraps every function declaration in a
  // `__name(fn, "fn")` helper. That helper exists in the Node module scope but NOT in
  // the page, so a serialized page.evaluate function dies on arrival with
  // "ReferenceError: __name is not defined". Define an identity shim on every new
  // document. (Node-side only workaround; it changes nothing about the measurement.)
  await ctx.addInitScript(() => {
    const g = globalThis as unknown as { __name?: (fn: unknown, name?: string) => unknown };
    if (!g.__name) g.__name = (fn: unknown) => fn;
  });

  const cantMeasure: { slug: string; reason: string }[] = [];

  const openMeasured = async (
    path: string,
    hits: number,
  ): Promise<{ status: number; data: Measured; page: Page; close: () => Promise<void> }> => {
    const page = await ctx.newPage();
    let status = 0;
    for (let i = 0; i < hits; i++) {
      const resp = await page.goto(`${BASE_URL}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: ROUTE_TIMEOUT_MS,
      });
      status = resp?.status() ?? 0;
    }
    await page.waitForTimeout(SETTLE_MS);
    const data = (await page.evaluate(measureInPage, THRESHOLDS)) as Measured;
    return { status, data, page, close: () => page.close() };
  };

  // =========================================================================
  // FALSIFICATION LEG — before the crawl, not after.
  // =========================================================================
  console.log("-".repeat(100));
  console.log("FALSIFICATION LEG — prove M1/M2 fire on `/` at 2560 before trusting any zero");
  console.log("-".repeat(100));

  let falsificationOk = true;
  const fal = await openMeasured("/", 2);
  const fm = fal.data;

  const m1aHits = fm.m1.rows.filter((r) => r.mode === "M1a");
  const m1bHits = fm.m1.rows.filter((r) => r.mode === "M1b");
  const breaking = m1aHits
    .concat(m1bHits)
    .filter((r) => /breaking/i.test(r.selectorPath))
    .sort((a, b) => b.interiorGapPx - a.interiorGapPx);
  const wideTop = m1bHits.slice().sort((a, b) => b.interiorGapPx - a.interiorGapPx);

  console.log(`  M1 candidate rows on /      : ${fm.m1.candidateRows}  (M1a ${m1aHits.length} · M1b ${m1bHits.length})`);
  console.log(`  M1 rows over ${GAP_THRESHOLD_PX}px           : ${fm.m1.overThreshold}`);
  console.log("");
  console.log(`  [known offender] breaking-headline rows matched: ${breaking.length}`);
  for (const b of breaking.slice(0, 4)) {
    console.log(`      interior ${String(b.interiorGapPx).padStart(4)}px  trailing ${String(b.trailingGapPx).padStart(4)}px  ${b.selectorPath}`);
  }
  if (breaking.length === 0) {
    console.log("      ** NONE — M1 cannot see the breaking strip it was written to catch. **");
    falsificationOk = false;
  }

  console.log("");
  console.log(`  [M1b existence proof] singleton wide rows: ${m1bHits.length}`);
  for (const w of wideTop.slice(0, 4)) {
    console.log(`      interior ${String(w.interiorGapPx).padStart(4)}px  trailing ${String(w.trailingGapPx).padStart(4)}px  width ${String(w.rowWidth).padStart(5)}  ${w.selectorPath}`);
  }
  if (m1bHits.length === 0) {
    console.log("      ** NONE — M1b is broken whatever M1a says (the masthead is a singleton offender). **");
    falsificationOk = false;
  }

  console.log("");
  console.log(`  [M2] stretched panels on /  : ${fm.m2.count}`);
  for (const p of fm.m2.panels.slice(0, 5)) {
    console.log(`      slack ${String(p.slackPx).padStart(4)}px of ${String(p.panelHeight).padStart(4)}px  ${p.selectorPath}`);
  }
  // HO 610 — the M2 leg no longer keys its proof to `/` ALONE. It did at 606,
  // when `/` carried three stretched panels (the hearings week grid's empty day
  // columns); P3 slice 3 removed them, and a zero on `/` then read as "M2 is
  // broken" and halted the crawl. That is the same-as-success shape inverted: a
  // SUCCESSFUL remediation became indistinguishable from a dead detector, and the
  // instrument refused to score the very fix that silenced it. What has to be
  // proven is that the DETECTOR fires, not that a particular route is defective —
  // so on a zero here it re-probes fallback routes and passes if any fires,
  // naming which one. Only zero EVERYWHERE is a fail, and it still dumps the
  // panel-predicate intermediates before halting.
  if (fm.m2.count === 0) {
    console.log("      ZERO on / — `/` no longer carries a stretched panel (HO 610 removed");
    console.log("      the last three). Re-probing fallback routes to prove the DETECTOR fires:");
    let provenOn: string | null = null;
    for (const fb of M2_FALLBACK_ROUTES) {
      const probe = await openMeasured(fb.path, 2);
      console.log(`        ${fb.slug.padEnd(14)} M2 ${probe.data.m2.count}`);
      if (probe.data.m2.count > 0 && !provenOn) {
        provenOn = fb.slug;
        for (const p of probe.data.m2.panels.slice(0, 3)) {
          console.log(`          slack ${String(p.slackPx).padStart(4)}px of ${String(p.panelHeight).padStart(4)}px  ${p.selectorPath}`);
        }
      }
      await probe.close();
      if (provenOn) break;
    }
    if (provenOn) {
      console.log(`      M2 PROVEN on /${provenOn} — the zero on / is a result, not a broken detector.`);
    } else {
      console.log("      ** ZERO EVERYWHERE PROBED — dumping the panel predicate's intermediates: **");
      // On the measured page, not a fresh blank one — a diagnostic that runs
      // against about:blank returns [] and reads exactly like "no such element".
      const diag = await fal.page.evaluate(funnelDiagnosticInPage);
      console.log(JSON.stringify(diag, null, 2));
      falsificationOk = false;
    }
  }

  console.log("");
  console.log(`  [M4 emitter] candidates on / : ${fm.m4.count}  (seed-vocabulary hits ${fm.m4.seededHits})`);
  console.log("      M4's seed vocabulary inverts by calendar — an empty hearings week is");
  console.log("      plausible, not proof of breakage. The emitter existing is the check;");
  console.log("      it is asserted across the crawl, not on / alone.");
  await fal.close();

  console.log("");
  if (!falsificationOk) {
    console.log("FALSIFICATION: FAIL — halting before the crawl. 78 page loads against a broken");
    console.log("instrument is spend with no information.");
    await browser.close();
    process.exitCode = 1;
    return;
  }
  console.log("FALSIFICATION: PASS");
  console.log("");

  // =========================================================================
  // FULL CRAWL
  // =========================================================================
  console.log("-".repeat(100));
  console.log("CRAWL — every route twice at 2560x1440, measured on hit 2");
  console.log("-".repeat(100));

  type RouteResult = { slug: string; path: string; status: number; data: Measured };
  const results: RouteResult[] = [];
  let pageLoads = 0;

  for (const route of ACTIVE_ROUTES) {
    try {
      const r = await openMeasured(route.path, 2);
      pageLoads += 2;
      results.push({ slug: route.slug, path: route.path, status: r.status, data: r.data });
      const d = r.data;
      console.log(
        `  ${route.slug.padEnd(22)} ${String(r.status).padStart(3)}  els ${String(d.elementCount).padStart(6)}  ` +
          `M1a ${String(d.m1.m1aCount).padStart(3)}  M1b ${String(d.m1.m1bCount).padStart(3)}  ` +
          `M2 ${String(d.m2.count).padStart(3)}  M3 ${String(d.m3.meanPerRow).padStart(5)}  ` +
          `M4 ${String(d.m4.count).padStart(3)}/${String(d.m4.reservedPx).padStart(5)}px`,
      );
      await r.close();
    } catch (e) {
      pageLoads += 1;
      const reason = String(e).split("\n")[0]?.slice(0, 120) ?? "unknown";
      cantMeasure.push({ slug: route.slug, reason });
      console.log(`  ${route.slug.padEnd(22)} ** CANNOT MEASURE — ${reason}`);
    }
  }

  // =========================================================================
  // M5 — narrow-width baseline
  // =========================================================================
  console.log("");
  console.log("-".repeat(100));
  console.log(`M5 — narrow-width baseline (${NARROW_WIDTHS.join(" · ")}), 6-route subset, one hit each`);
  console.log("-".repeat(100));

  type NarrowRow = { slug: string; width: number; overflowCount: number; extraWrapCount: number; samples: string[] };
  const narrow: NarrowRow[] = [];

  if (ROUTE_FILTER) {
    console.log(`  SKIPPED — --route ${ROUTE_FILTER} is a slice score (wide-viewport delta). Run without`);
    console.log("  --route for the narrow ladder; the 606 M5 baseline stands until then.");
  }
  for (const route of ROUTE_FILTER ? [] : ROUTES) {
    if (!SUBSET_SLUGS.has(route.slug)) continue;
    const wide = results.find((r) => r.slug === route.slug);
    for (const w of NARROW_WIDTHS) {
      const page = await ctx.newPage();
      try {
        await page.setViewportSize({ width: w, height: 1000 });
        await page.goto(`${BASE_URL}${route.path}`, {
          waitUntil: "domcontentloaded",
          timeout: ROUTE_TIMEOUT_MS,
        });
        pageLoads += 1;
        await page.waitForTimeout(SETTLE_MS);
        const d = (await page.evaluate(measureInPage, THRESHOLDS)) as Measured;
        let extraWrap = 0;
        const samples: string[] = [];
        if (wide) {
          for (const [sel, lines] of Object.entries(d.m5.flexLines)) {
            const wideLines = wide.data.m5.flexLines[sel];
            if (wideLines !== undefined && lines > wideLines) {
              extraWrap++;
              if (samples.length < 3) samples.push(`${sel} ${wideLines}→${lines}`);
            }
          }
        }
        narrow.push({
          slug: route.slug,
          width: w,
          overflowCount: d.m5.overflow.length,
          extraWrapCount: extraWrap,
          samples,
        });
        console.log(
          `  ${route.slug.padEnd(14)} @${String(w).padStart(4)}  overflow ${String(d.m5.overflow.length).padStart(4)}  extra-wrap ${String(extraWrap).padStart(4)}` +
            (samples.length ? `   e.g. ${samples[0]}` : ""),
        );
      } catch (e) {
        const reason = String(e).split("\n")[0]?.slice(0, 100) ?? "unknown";
        cantMeasure.push({ slug: `${route.slug}@${w}`, reason });
        console.log(`  ${route.slug.padEnd(14)} @${String(w).padStart(4)}  ** CANNOT MEASURE — ${reason}`);
      } finally {
        await page.close();
      }
    }
  }

  await browser.close();

  // =========================================================================
  // OUTPUT
  // =========================================================================
  const elapsedS = Math.round((Date.now() - startedAt) / 100) / 10;

  console.log("");
  console.log("=".repeat(100));
  console.log("ARTIFACT 1 — PER-ROUTE DEFECT TABLE (sorted M1a+M1b descending). This table is the phase plan.");
  console.log("=".repeat(100));
  const table = results
    .map((r) => ({
      slug: r.slug,
      m1a: r.data.m1.m1aCount,
      m1b: r.data.m1.m1bCount,
      m1: r.data.m1.m1aCount + r.data.m1.m1bCount,
      m2: r.data.m2.count,
      m3: r.data.m3.meanPerRow,
      m4px: r.data.m4.reservedPx,
      m4n: r.data.m4.count,
    }))
    .sort((a, b) => b.m1 - a.m1);
  console.log(`  ${"route".padEnd(22)} ${"M1a".padStart(5)} ${"M1b".padStart(5)} ${"M1".padStart(5)} ${"M2".padStart(5)} ${"M3mean".padStart(7)} ${"M4n".padStart(5)} ${"M4px".padStart(7)}`);
  for (const t of table) {
    console.log(
      `  ${t.slug.padEnd(22)} ${String(t.m1a).padStart(5)} ${String(t.m1b).padStart(5)} ${String(t.m1).padStart(5)} ${String(t.m2).padStart(5)} ${String(t.m3).padStart(7)} ${String(t.m4n).padStart(5)} ${String(t.m4px).padStart(7)}`,
    );
  }

  console.log("");
  console.log("=".repeat(100));
  console.log("ARTIFACT 2 — SITE-WIDE BASELINE TOTALS (M1, M4) + the gap distribution");
  console.log("=".repeat(100));
  const allGaps = results.flatMap((r) => r.data.m1.gaps);
  const totM1a = results.reduce((a, r) => a + r.data.m1.m1aCount, 0);
  const totM1b = results.reduce((a, r) => a + r.data.m1.m1bCount, 0);
  const totCandidates = results.reduce((a, r) => a + r.data.m1.candidateRows, 0);
  const totM2 = results.reduce((a, r) => a + r.data.m2.count, 0);
  const totM4 = results.reduce((a, r) => a + r.data.m4.count, 0);
  const totM4px = results.reduce((a, r) => a + r.data.m4.reservedPx, 0);
  const totSeeded = results.reduce((a, r) => a + r.data.m4.seededHits, 0);
  console.log(`  M1 candidate rows examined : ${totCandidates}`);
  console.log(`  M1 rows over ${GAP_THRESHOLD_PX}px          : ${totM1a + totM1b}   (M1a ${totM1a} · M1b ${totM1b})`);
  console.log(`  M2 stretched panels        : ${totM2}`);
  console.log(`  M4 reserved-empty elements : ${totM4}  totalling ${totM4px}px of vertical space  (seed-vocabulary hits ${totSeeded})`);
  console.log("");
  console.log(`  Interior-gap distribution across ${allGaps.length} measured gaps — the threshold is defensible from this, not assumed:`);
  for (const line of histogram(allGaps)) console.log(line);

  console.log("");
  console.log("=".repeat(100));
  console.log("ARTIFACT 3 — M5 NARROW-WIDTH BASELINE");
  console.log("=".repeat(100));
  console.log("  900px is a BREAKPOINT (.dv2-grid collapses at max-width:900, globals.css:646) — 1024 and 720 bracket it.");
  console.log(`  ${"route".padEnd(16)} ${"width".padStart(6)} ${"overflow".padStart(9)} ${"extra-wrap".padStart(11)}`);
  for (const n of narrow) {
    console.log(`  ${n.slug.padEnd(16)} ${String(n.width).padStart(6)} ${String(n.overflowCount).padStart(9)} ${String(n.extraWrapCount).padStart(11)}`);
  }

  console.log("");
  console.log("=".repeat(100));
  console.log("ARTIFACT 4 — ROUTES THAT COULD NOT BE MEASURED (named, not silently skipped)");
  console.log("=".repeat(100));
  if (cantMeasure.length === 0) console.log("  none — every route measured.");
  for (const c of cantMeasure) console.log(`  ${c.slug.padEnd(24)} ${c.reason}`);

  console.log("");
  console.log("=".repeat(100));
  console.log("M6 — DEAD ROUTES (static, no browser needed)");
  console.log("=".repeat(100));
  console.log("  app/dashboard-v2/page.tsx    — a 9-line permanentRedirect(\"/\") (HO 311), kept so");
  console.log("                                 bookmarks survive the swap. NOT dead; deleting it 404s them.");
  console.log("  app/dashboard-classic/page.tsx — REMOVED at HO 608. The 606 run falsified the claim");
  console.log("                                 that it branched across five components: every one of");
  console.log("                                 those references was a COMMENT, and the only executable");
  console.log("                                 coupling was its own FILTER_BASE constant. Route file,");
  console.log("                                 smoke-crawl entry and comment sweep, and it was gone.");
  console.log("  Completeness is answered by:  git grep -n \"dashboard-classic\" -- app/ components/ lib/");

  console.log("");
  console.log("=".repeat(100));
  console.log("BURN LEDGER");
  console.log("=".repeat(100));
  console.log(`  routes crawled     : ${results.length} of ${ACTIVE_ROUTES.length}${ROUTE_FILTER ? ` (--route ${ROUTE_FILTER})` : ""}`);
  console.log(`  page loads (actual): ${pageLoads + 2}   (incl. the 2-hit falsification leg)`);
  console.log(`  wall time          : ${elapsedS}s`);
  console.log(`  retries            : 0 — a failing route is recorded and skipped, never retry-looped`);

  // Full detail to a repo-ignored artifact dir (SKILL build-input parity rule:
  // these JSONs contain literal utility-class strings in their selector paths).
  try {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    // A filtered run writes its OWN file — a slice score must not overwrite the
    // full-crawl baseline it is scored against.
    const artifact = ROUTE_FILTER ? `audit-2560-${ROUTE_FILTER}.json` : "audit-2560.json";
    writeFileSync(
      `${ARTIFACT_DIR}/${artifact}`,
      JSON.stringify({ thresholds: THRESHOLDS, routeFilter: ROUTE_FILTER ?? null, results, narrow, cantMeasure }, null, 1),
    );
    console.log("");
    console.log(`  full per-route detail → ${ARTIFACT_DIR}/${artifact} (repo-ignored)`);
  } catch (e) {
    console.log(`  (could not write artifacts: ${String(e).slice(0, 80)})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
