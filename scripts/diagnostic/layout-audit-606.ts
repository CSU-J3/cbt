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
//        ladder brackets it rather than measuring only at it. Overflow splits in
//        two: M5x DESIGN-CLIP (the element's own style declares text-overflow:
//        ellipsis or a line clamp — authored truncation, permanent, not
//        actionable) and bucket (b) REAL. The raw total is still printed.
//   M6 — dead routes: answered by static analysis, no browser. Printed as a fixed
//        note; the live question is whether the branch set is complete.
//
// Target is `npm run build && npm run start` on :3000. NOT `next dev` (the overlay
// and HMR alter the geometry being measured) and NOT prod (BotID withholds the
// markets tape from headless Chrome, e2e/smoke.spec.ts:17-20, and the tape is a C1
// row). Reads hit prod Turso, so each route is loaded twice and measured on hit 2.
//
// THE INSTRUMENT IS FALSIFIED BEFORE IT IS TRUSTED (arc §3 GO condition, §4 rule).
// A near-zero site-wide result from a detector that structurally cannot fire looks
// identical to a clean site, so three legs run before any crawl: A known-good
// clears, B exemptions stable, C the fixture. No full crawl on a failed leg — 80
// page loads of Turso reads against a broken instrument is spend with no
// information.
//
// HO 615 — INSTRUMENT v3, AND ITS ANCHOR LEFT THE PRODUCT.
//   (1) M1 bands by INK SPAN. One item per child node, extent = the union bbox of
//       its client rects, and a child belongs to every band its span overlaps — so
//       a gap can never be measured ACROSS it. v2 pushed every rect separately, so
//       a wrapped child's short last line got measured against the next cell with
//       its long first line sitting invisibly between them. C1 remediation
//       MANUFACTURES that geometry (packing a row left is what lets a long cell
//       wrap), so the artifact grew with every fix the phase shipped.
//   (2) M5 extra-wrap clusters by the same vertical overlap M1 has used since v2;
//       `round(centreY / 4px)` split a single baseline-aligned row whose children
//       differed in font size, position-dependently. Duplicate selector paths now
//       keep the MAX rather than v2's last-wins.
//   (3) M5 overflow splits into M5x design-clip and bucket (b) real.
//   (4) Leg C is a committed FIXTURE, not a route. Its product anchor expired
//       three times in four handoffs — a remediation phase is in the business of
//       ending the defects an anchor is pinned to. See the fixture's header.
// Every number produced before this change is v2 and does not compare to a v3 one.
//
// HO 620 — INSTRUMENT v4, AND WHY IT SHIPS AT THE ARC CLOSE RATHER THAN AFTER IT.
// The terminal crawl is the maintenance baseline every future layout HO reads, and
// v3 would have handed it two known lies. Four changes, NO THRESHOLD MOVED:
//   (1) M4 SPLITS into M4-true and M4f (furniture). M4's emitter (>=40px tall,
//       <=12 chars) cannot tell reserved emptiness from a short label doing its job
//       in a tall row, so ~96.7% of the site total was watch stars, bill-ID rails
//       and stat tiles — a headline number that was almost entirely not the thing
//       it is named after. The HO 617 hand-split becomes the instrument's output.
//   (2) M4w — WIDTH-reserved slots. M4 is keyed on HEIGHT, so a width-shaped
//       reservation is invisible to it by construction: /stale's 52px `.row-hslot`
//       was the whole of that route's M1 while M4 read nothing (HO 618).
//   (3) M5s — scroll-by-design, the third overflow category, per its backlog shape.
//       /'s bucket (b) of 86-88 was ONE marquee counted at SIX nesting levels.
//   (4) M3 samples EVERY repeated-sibling group with >=2 element children. v3
//       reused M1a's >=3-children gate, so 2-child feed rows never entered — the
//       796-chip convergence at HO 619 was invisible to the instrument built to
//       score it, and four routes' "M3 3.00" was in fact 10 nav items.
// M1/M1x/M2 are untouched and are the control: a v3-vs-v4 bridge run on the same
// DOM must show them identical. M3 and M4 are a DIFFERENT RULER — the era wall
// applies to them exactly as it did to M1 at v2 and v3.
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
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
// v1 only. v2 clusters by vertical overlap and no longer buckets on centre;
// kept in the record so a v1-vs-v2 comparison can name what changed.
const BAND_PX = 4;
// v2: an M1b candidate with a child taller than this is a layout container, not
// a row. Row children are text-scale (a 2560 masthead item is ~26px); the class
// this excludes had children 300-1000px tall.
const M1B_MAX_CHILD_H = 60;

const ARTIFACT_DIR = "docs/handoffs/606-artifacts";

// HO 615 — leg C's anchor, moved off the product and into the repo. Loaded over
// file://: no server, no DB read, no route, so nothing a remediation phase does
// can silence it. See the file's own header for why the anchor had to leave.
const FIXTURE_URL = pathToFileURL(
  resolve(process.cwd(), "scripts/diagnostic/fixtures/layout-legc.html"),
).href;

// Stamps the artifact filename so a re-run can never clobber the baseline it is
// scored against (v2). Falls back rather than failing the run — the measurement
// does not depend on git being reachable.
const SHORT_SHA = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "nosha";
  }
})();

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
const FALSIFY_ONLY = process.argv.includes("--falsify");
const ACTIVE_ROUTES: Route[] = ROUTE_FILTER
  ? ROUTES.filter((r) => r.slug === ROUTE_FILTER)
  : ROUTES;

// HO 615 leg A — the known-good routes, and what the v3 ink-span rule is required
// to remove on each.
//
// Every `v2*` figure is the v2 instrument's reading of THIS COMMIT'S DOM (cc1b32f,
// full crawl in docs/handoffs/606-artifacts/v2-audit-cc1b32f-2560.json) — two
// instruments over identical content, so a delta is the instrument and nothing
// else.
//
// THE HANDOFF'S PREMISE FOR /trades WAS FALSIFIED BY MEASURING IT, and the gate
// records the correction rather than the prediction. It expected ~52 rows to drop
// to ~0 as multi-rect artifacts. They are not artifacts: the row's second band
// held {date, amount} — the only two cells with a second line — and reported the
// 625px between them, while its FIRST band reads 129px, which is real column slack
// against the amounts axis and is over threshold either way. So on /trades the
// artifact inflates the MAGNITUDE and not the COUNT, and the gate is on the worst
// gap. Its count is expected to stay ~52 and that is a genuine C1 residual for a
// later phase, not something this instrument change can clear.
//
// /lobbying is the opposite shape: a real count drop, whose remainder (~48 rows)
// is axis-encoding and is commit 2's job. Gating its remainder would encode this
// HO's own half-finished state and fail at commit 1 by construction.
//
// Both also require that REAL under-threshold gaps are still reported. An
// instrument that had gone blind would satisfy every bound above and fail here.
const LEG_A: {
  path: string;
  v2Count: number;
  minCountDrop: number;
  v2Worst: number;
  maxWorst: number;
}[] = [
  // /trades: the two populations are cleanly separated, so the bound goes between
  // them rather than beside either. The continuation-band artifact read 625-1137px
  // (measured on the row dumped in docs/handoffs/615-artifacts); the row's real
  // band-1 column slack against the amounts axis reads 129-248px. 400 is in the
  // empty space between the two, so this gate asks "did any reading from the
  // artifact population survive", not "did the number get smaller". A first draft
  // put it at 200, sized off ONE sampled row's 129 — the same mistake as pricing a
  // query from the rows it returns.
  { path: "/trades", v2Count: 52, minCountDrop: 0, v2Worst: 1137, maxWorst: 400 },
  // /lobbying: no-regression only. Its worst row is a FirmsLeaderboard axis row,
  // which is commit 2's job and not the instrument's, so the count drop is the
  // real assertion here and the magnitude bound just has to not get worse.
  { path: "/lobbying", v2Count: 64, minCountDrop: 8, v2Worst: 1051, maxWorst: 1100 },
];

// The live DISTRIBUTION panel's marking and its curve.
//
// HO 629 — THE COUNT BELOW IS NO LONGER ASSERTED, and the reason is recorded
// because the number stays useful as the registry figure. It counts CANDIDATES,
// and candidacy is width-gated (m1bMinWidth), so it moves when the panel resizes
// even though the marking has not. HO 629 widened the bills column to 45%, the
// left region narrowed, the widest marked node went 659px -> 518px against a
// 600px gate, and this fell 30 -> 0 with [data-viz-row] reaching exactly the same
// nodes. Leg B now asserts the marking's REACH instead; see it for the
// measurement. The curve below is unchanged and still the exemption's licence.
//
// HO 627: 13 -> 30. The panel un-tabbed, so BY STAGE (StageFunnel, 6 rows) and BY
// TOPIC (TopicDistributionList, 8 rows) are now BOTH mounted instead of one being
// hidden behind a tab. The topic list is a NEW data-viz-row marking and it ships
// with its curve, as the exemption rule requires. Measured on the live page:
//
//   void = bar-end -> value, per row
//   2560: TOPIC 8-395px (median 353) · STAGE 8-488px (median 454)   [row 659px]
//   1440: TOPIC 8-155px (median 140) · STAGE 8-166px (median 155)   [row 330px]
//
// NO CAP REACHES IT, and this is the strongest form of the exemption rather than
// the FirmsLeaderboard kind: the bar is scaled to the track, so the void is
// PROPORTIONAL TO THE VALUE BEING ENCODED — a topic at 1/8 of the max MUST leave
// ~7/8 of its track empty. Capping the row shrinks track and bar together and
// leaves the same proportional void while making the small topics unreadable.
// The shape is identical to the StageFunnel marking directly above it in the same
// panel, at slightly smaller magnitude, which is the calibration.
//
// Counts CANDIDATES, not visual rows: wrappers and tracks that clear a
// width-based gate are counted too. Registry form was M1x 30 / 14 rows at the
// 31% column; at 45% it reads M1x 0 / 14 rows, the marking dormant because no row
// under it is wide enough to be an M1 candidate. The 14 is the width-invariant
// half of that pair and the one worth reading.

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
  m1bMaxChildH: number;
};

const THRESHOLDS: Thresholds = {
  gapThreshold: GAP_THRESHOLD_PX,
  m2Slack: M2_SLACK_PX,
  m4MinH: M4_MIN_H,
  m4MaxChars: M4_MAX_CHARS,
  m1bMinWidth: M1B_MIN_WIDTH,
  bandPx: BAND_PX,
  m1bMaxChildH: M1B_MAX_CHILD_H,
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
  let vizExempt = 0;
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

    // v2 CONTAINER CUT (M1b only) — a ROW's children are text-scale; a layout
    // container's children are panels. M1b's ">=600px wide with >=2 items on a
    // line" predicate admitted .home-shell / .dash-page / .dash-left, whose
    // "interior gap" is the two-region column gutter (up to 1,682px) — C8's
    // intent, not a defect in any row. Anything with a child taller than
    // m1bMaxChildH is a container and is not a C1 candidate.
    if (!isM1a) {
      let tallest = 0;
      for (const c of kids) {
        const h = c.getBoundingClientRect().height;
        if (h > tallest) tallest = h;
      }
      if (tallest > t.m1bMaxChildH) continue;
    }

    // v2 VIZ EXEMPTION, COUNTED — a chart row is label · bar · value-on-a-shared-
    // axis, so the space between a short bar and its number is the ENCODING. Rows
    // under [data-viz-row] are excluded from M1 and reported on their own line, so
    // the exemption can never grow silently the way an uncounted skip would.
    if (el.closest("[data-viz-row]")) {
      vizExempt++;
      continue;
    }

    // Items = element children AND text nodes (a bare `·` between two spans
    // manufactures a false gap otherwise).
    //
    // v3 — ONE ITEM PER CHILD, and its extent is its INK SPAN: the union bbox of
    // its client rects. v2 pushed every rect separately, so a child that wrapped
    // onto two lines became two independent items and its short last line could be
    // measured against a neighbour while its long first line sat between them,
    // invisibly. A union span cannot be straddled: the child is present in every
    // band it overlaps, so no gap is ever measured ACROSS it. See the
    // legc-neg-wrap case in the fixture for the geometry, and note that C1
    // remediation is what manufactures it — packing a row left is precisely what
    // lets a long cell wrap instead of being pushed out of view.
    type Item = { l: number; r: number; top: number; bottom: number };
    const items: Item[] = [];
    const rawRects: { top: number; bottom: number }[] = [];
    const pushSpan = (rects: ArrayLike<DOMRect>) => {
      let l = Infinity;
      let r = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (const rc of Array.from(rects)) {
        if (rc.width <= 0 || rc.height <= 0) continue;
        if (rc.left < l) l = rc.left;
        if (rc.right > r) r = rc.right;
        if (rc.top < top) top = rc.top;
        if (rc.bottom > bottom) bottom = rc.bottom;
        rawRects.push({ top: rc.top, bottom: rc.bottom });
      }
      if (r > -Infinity) items.push({ l, r, top, bottom });
    };
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const txt = node.textContent ?? "";
        if (!txt.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        pushSpan(range.getClientRects());
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const c = node as Element;
        if (!visible(c)) continue;
        pushSpan(inkRects(c));
      }
    }
    if (items.length < 2) continue;

    // v2 BANDING — vertical-interval clustering. Items whose rects overlap by at
    // least half the smaller one's height share a band. The v1 rule bucketed on
    // round(centreY / 4px), which split a baseline-aligned row across two buckets
    // the moment its items differed in size: on a packed breaking row the 13px id
    // and 13px age landed in one bucket and the 17px headline in another, so the
    // gap measured was id→age with the headline sitting invisibly between them —
    // 873px of "gap" on a row with none. Under a type ladder that scales six
    // tokens, mixed sizes on one baseline are the NORM, so v1 could not read any
    // real row correctly.
    //
    // v3 keeps bands themselves LINE-level — clustered from the individual rects,
    // so a row with content on two lines still has two bands — and then assigns
    // MEMBERSHIP by ink span. A wrapped child therefore belongs to both of its
    // lines' bands. Merging bands on the tall child instead would be equivalent
    // here but wrong in general (a tall child beside two stacked short ones would
    // fuse two unrelated lines into one gap measurement).
    const clusters: { top: number; bottom: number }[] = [];
    for (const rc of rawRects.slice().sort((a, b) => a.top - b.top)) {
      const h = rc.bottom - rc.top;
      let placed = false;
      for (const c of clusters) {
        const overlap = Math.min(c.bottom, rc.bottom) - Math.max(c.top, rc.top);
        if (overlap >= 0.5 * Math.min(h, c.bottom - c.top)) {
          c.top = Math.min(c.top, rc.top);
          c.bottom = Math.max(c.bottom, rc.bottom);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push({ top: rc.top, bottom: rc.bottom });
    }

    // Band membership, then the CONTINUATION-BAND cut.
    //
    // A band whose member set is a subset of another band's is not a distinct
    // line — it is the tail of cells that happen to run taller than their
    // neighbours, and it contains no item that isn't already being measured
    // together somewhere richer. Measuring it separately can therefore only ever
    // produce a gap ACROSS items that are present in the fuller band, which is the
    // same defect ink spans exist to remove, arriving by a second route.
    //
    // The live case is a /trades row: the date and the amount each carry a second
    // line, their single-line neighbours do not, so the second line's band held
    // exactly {date, amount} and reported the 625px of nothing between them — an
    // area sitting under five cells that the reader sees as occupied. Its band-1
    // reading is 129px, which is the real column slack and stays reported.
    //
    // Note what this does NOT do: a genuine two-line row (a wrapping filter bar)
    // has a second band with its own distinct items, so it is not a subset and is
    // measured. The cut is by membership, never by position or by count.
    const bandMembers = clusters.map((band) => {
      const bandH = band.bottom - band.top;
      const idx: number[] = [];
      items.forEach((it, i) => {
        const overlap = Math.min(band.bottom, it.bottom) - Math.max(band.top, it.top);
        if (overlap >= 0.5 * Math.min(it.bottom - it.top, bandH)) idx.push(i);
      });
      return idx;
    });
    const keptBands = bandMembers.filter((mine, i) =>
      !bandMembers.some((other, j) => {
        if (i === j) return false;
        if (other.length < mine.length) return false;
        // equal sets: keep the first, drop the later duplicate
        if (other.length === mine.length && j > i) return false;
        const set = new Set(other);
        return mine.every((m) => set.has(m));
      }),
    );

    let maxBandItems = 0;
    let interior = 0;
    for (const memberIdx of keptBands) {
      const arr = memberIdx.map((i) => items[i]!);
      if (arr.length > maxBandItems) maxBandItems = arr.length;
      if (arr.length < 2) continue;
      // Interval sweep: a running max of the right edges, so an item that
      // horizontally contains or overlaps its neighbours can never produce a gap.
      const sorted = arr.slice().sort((a, b) => a.l - b.l);
      let runMaxRight = sorted[0]!.r;
      for (let i = 1; i < sorted.length; i++) {
        const cur = sorted[i]!;
        const gap = cur.l - runMaxRight;
        if (gap > interior) interior = gap;
        if (gap > 0) allGaps.push(gap);
        if (cur.r > runMaxRight) runMaxRight = cur.r;
      }
    }

    const qualifies = isM1a ? true : wideEnough && maxBandItems >= 2;
    if (!qualifies) continue;

    const cs = getComputedStyle(el);
    const innerRight =
      rect.right - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0);
    let rightMost = -Infinity;
    for (const it of items) if (it.r > rightMost) rightMost = it.r;
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

  // --- repeated-row context, shared by M3 / M4f / M4w (v4) -------------------
  // A "repeated row" is an element with >=3 visible siblings sharing its tag+class
  // signature. Deliberately independent of M1a's predicate, which additionally
  // requires >=3 element children — that extra clause is what made M3 blind (see
  // below) and it has no business deciding whether a star in a feed row is
  // furniture.
  const isRepeatedRow = (el: Element): boolean => (sibCount.get(el) ?? 1) >= 3 && visible(el);
  const inRepeatedRow = (el: Element): boolean => {
    let cur: Element | null = el;
    let hops = 0;
    while (cur && hops < 12) {
      if (isRepeatedRow(cur)) return true;
      cur = cur.parentElement;
      hops++;
    }
    return false;
  };

  // --- M3 -------------------------------------------------------------------
  // Own-vs-parent, resolved rgb. Counts a descendant once however many properties
  // differ.
  //
  // v4 — SAMPLES EVERY REPEATED-SIBLING GROUP WITH >=2 ELEMENT CHILDREN. v3 reused
  // M1a's groups, whose gate is `kids >= 3 && siblings >= 3`, so a feed row with
  // TWO element children never entered the sample at all: /changes' 132 chip-bearing
  // rows and /bills' 25 carry exactly two, and the 796-chip convergence at HO 619
  // was invisible to the instrument built to score it. Worse, the numbers those
  // routes did report were measuring something else entirely — /changes' "M3 3.00"
  // was 10 nav items at 3.00 apiece, and four routes read exactly 3.00 for that
  // reason. A shared-chrome mean wearing a route's name is worse than no reading.
  //
  // M1a is UNTOUCHED (M1 must not move), so this is a second, wider group pass.
  // Every v4 M3 number is a different ruler from every v3 one — era wall.
  const m3Groups: Element[][] = [];
  const seenM3Key = new Set<string>();
  for (const el of allEls) {
    if (!visible(el)) continue;
    if ((sibCount.get(el) ?? 1) < 3) continue;
    if (Array.from(el.children).filter((c) => visible(c)).length < 2) continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const key = `${pathOf(parent)}##${sigOf(el)}`;
    if (seenM3Key.has(key)) continue;
    seenM3Key.add(key);
    const group = Array.from(parent.children).filter((c) => sigOf(c) === sigOf(el) && visible(c));
    if (group.length >= 3) m3Groups.push(group);
  }

  let noiseRowCount = 0;
  let noiseTotal = 0;
  let worstRowNoise = 0;
  for (const group of m3Groups) {
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
  const keptEls: Element[] = [];
  for (const c of candidates) {
    const nestedInAnother = candidates.some((o) => o.el !== c.el && o.el.contains(c.el));
    if (!nestedInAnother) {
      kept.push(c.rec);
      keptEls.push(c.el);
    }
  }

  // v4 — M4 SPLITS: M4-true vs M4f (FURNITURE). C4 is about space RESERVED FOR
  // NOTHING, and M4's emitter (>=40px tall, <=12 chars) cannot tell that from a
  // short label doing its job inside a tall row: a watch star, a two-line bill-ID
  // rail, a stat tile reading "12". HO 617 hand-split /member-detail's 27 and found
  // 20 were feed-row parts; at HO 618 the site total was ~96.7% furniture, i.e. the
  // headline number was almost entirely not the thing it is named after.
  //
  // Furniture = inside a repeated-sibling row context AND carrying non-empty text.
  // Both clauses matter: the repeated-row context is what makes it a component
  // rather than a reservation, and non-empty text is what makes it a label rather
  // than a void. A genuinely empty box inside a repeated row is NOT furniture — it
  // is exactly the /stale .row-hslot defect — so it stays in M4-true.
  //
  // The 617 hand-split becomes the instrument's own output; M4f is reported on its
  // own line, the M1x pattern, so the exclusion cannot grow silently.
  const m4True: Empty[] = [];
  const m4Furniture: Empty[] = [];
  for (let i = 0; i < kept.length; i++) {
    const rec = kept[i]!;
    const el = keptEls[i]!;
    if (rec.text.length > 0 && inRepeatedRow(el)) m4Furniture.push(rec);
    else m4True.push(rec);
  }

  // v4 — M4w: WIDTH-RESERVED SLOTS. M4 is keyed on HEIGHT (>=40px), so a defect
  // shaped in WIDTH is invisible to it by construction: /stale's `.row-hslot` was a
  // 52px-wide empty box on 45 of 50 rows, opened a uniform 121px gap on every one,
  // and was the whole of that route's M1 — while M4, the instrument for reserved
  // empty space, read nothing (HO 618). A height-keyed instrument cannot see a
  // width-shaped reservation.
  //
  // Predicate: no ink at all (no text, no visible element descendant), NO PAINT OF
  // ITS OWN, rect width >= the M4 height floor, inside a repeated row. The live
  // instance is fixed, so the fixture carries the only positive.
  //
  // THE UNPAINTED CLAUSE IS LOAD-BEARING AND WAS FOUND BY MEASUREMENT, NOT REASON.
  // Without it this fired 359 times on /members — 201 committee activity bars, 153
  // topic-mix segments, 4 bar tracks — because a BAR is also an empty element whose
  // width was chosen. It is the exact opposite of a reservation: its width IS the
  // datum. A reserved slot is invisible by definition, so if it paints, it is a
  // mark and not a void. Same distinction `data-viz-row` draws for M1, drawn here
  // by a property of the element rather than by an attribute someone must remember
  // to add. The fixture carries the negative (a painted segment of identical size).
  type WidthSlot = { selectorPath: string; widthPx: number };
  const m4wRaw: { el: Element; rec: WidthSlot }[] = [];
  for (const el of allEls) {
    if (!visible(el)) continue;
    if ((el.textContent ?? "").trim().length > 0) continue;
    if (Array.from(el.querySelectorAll("*")).some((d) => visible(d))) continue;
    if (hasBoxPaint(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < t.m4MinH) continue;
    if (!inRepeatedRow(el)) continue;
    m4wRaw.push({ el, rec: { selectorPath: pathOf(el), widthPx: Math.round(r.width) } });
  }
  const m4w: WidthSlot[] = m4wRaw
    .filter((c) => !m4wRaw.some((o) => o.el !== c.el && o.el.contains(c.el)))
    .map((c) => c.rec);

  // --- M5 inputs ------------------------------------------------------------
  // v3 — the overflow population splits in two. An element whose OWN computed
  // style declares `text-overflow: ellipsis` or a line clamp is a DESIGN CLIP: it
  // was authored to truncate, it reports scrollWidth > clientWidth forever, and no
  // narrow-width work will ever change that. v2 counted it beside real overflow,
  // so bucket (b) carried a large permanent non-actionable population and the real
  // failures could not be seen inside it. The raw total is still emitted for
  // continuity with the (a)/(b) bucket tables the P4 handoffs reported by hand.
  // v4 — the THIRD category, per the backlog shape (P3 · M5 scroll-by-design).
  // M5x captures authored TRUNCATION; it says nothing about authored SCROLLING, so
  // a marquee and a raw-JSON block landed in bucket (b) and read as narrow-width
  // breakage. `/`'s 86-88 was ONE marquee counted at SIX nesting levels — the whole
  // distortion — plus the three ancestors carrying its real +85px document overflow.
  //
  // A scroll-by-design ROOT is an overflowing element that is either:
  //   (a) self-scrollable — own computed overflow-x `auto`/`scroll`; the reader can
  //       reach the content (`pre.bdp-rawpre`, the raw-JSON block), or
  //   (b) overflow-x `hidden` WITH an animated descendant — the content is brought
  //       into view by animation rather than by scrolling (the markets marquee).
  //
  // DEVIATION FROM THE BACKLOG PHRASING, stated because it is a definition change:
  // that entry reads "overflow-x auto/scroll/hidden with an animated or explicitly-
  // scrollable child", which taken literally MISSES `pre.bdp-rawpre` — one of its
  // own two worked examples — because a <pre>'s only child is a text node. Clause
  // (a) reads the element itself as the scrollable thing; clause (b) keeps plain
  // clipping-`hidden` out, which is what the child requirement was protecting
  // against. Both worked examples land, and ordinary `overflow:hidden` does not.
  //
  // ABSORPTION, not just dedup: anything overflowing INSIDE a root belongs to that
  // root's chain and is counted once, at the root. Six levels of one marquee is the
  // distortion this exists to remove, and only the outermost is a thing a reader
  // could act on.
  type Over = { selectorPath: string; scrollWidth: number; clientWidth: number };
  const overflow: Over[] = [];
  const overflowClip: Over[] = [];
  const overflowReal: Over[] = [];
  const overflowScroll: Over[] = [];
  const overflowing: Element[] = [];
  for (const el of allEls) {
    if (!visible(el)) continue;
    if (el.clientWidth <= 0) continue;
    if (el.scrollWidth > el.clientWidth + 1) overflowing.push(el);
  }
  // ANIMATION IS READ FROM THE STYLESHEET, NOT FROM COMPUTED STYLE, AND THAT IS
  // NOT A REFINEMENT — the first draft could not fire at all. This audit runs its
  // context with `reducedMotion: "reduce"` (deliberately: a moving marquee would
  // perturb the geometry every other measurement depends on), and globals.css
  // carries `@media (prefers-reduced-motion: reduce) { .markets-tape-track {
  // animation: none } }`. So under the audit's own viewing conditions the computed
  // animation-name of the site's one marquee is `none`, and a predicate keyed on it
  // is blind to exactly the element it was written for. Measured both ways:
  // no-preference reads `markets-marquee`, reduce reads `none`.
  //
  // An instrument must not key on a property it suppresses. So: an element is
  // ANIMATED-BY-AUTHORSHIP if any CSS rule that matches it declares a non-none
  // animation-name, whatever the active media query says about playing it. The
  // reduced-motion override itself declares `none` and is correctly ignored.
  const authoredAnimated = new Set<Element>();
  {
    const selectors: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        const r = rule as CSSStyleRule & { cssRules?: CSSRuleList };
        if (r.cssRules) walk(r.cssRules); // @media / @supports / @layer
        if (!r.selectorText || !r.style) continue;
        const name = r.style.animationName || r.style.getPropertyValue("animation-name");
        if (name && name.trim() !== "" && name.trim() !== "none") selectors.push(r.selectorText);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules);
      } catch {
        /* cross-origin sheet — unreadable, and none of ours are */
      }
    }
    for (const sel of selectors) {
      for (const part of sel.split(",")) {
        const s = part.trim();
        if (!s || s.includes("::")) continue;
        try {
          for (const el of Array.from(document.querySelectorAll(s))) authoredAnimated.add(el);
        } catch {
          /* unsupported selector */
        }
      }
    }
  }
  const hasAnimatedDescendant = (el: Element): boolean => {
    for (const a of authoredAnimated) if (a !== el && el.contains(a)) return true;
    return false;
  };
  const scrollRoots = overflowing.filter((el) => {
    const ox = getComputedStyle(el).overflowX;
    if (ox === "auto" || ox === "scroll") return true;
    // `clip` and `hidden` are one family — clipped, not scrollable. The markets
    // tape computes to `clip`, so checking only `hidden` missed it (measured).
    return (ox === "hidden" || ox === "clip") && hasAnimatedDescendant(el);
  });
  const outermostRoots = scrollRoots.filter((el) => !scrollRoots.some((o) => o !== el && o.contains(el)));

  for (const el of overflowing) {
    const rec: Over = {
      selectorPath: pathOf(el),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    };
    overflow.push(rec);
    const cs = getComputedStyle(el);
    const clamp =
      (cs as unknown as { webkitLineClamp?: string }).webkitLineClamp ??
      cs.getPropertyValue("-webkit-line-clamp");
    const designClip =
      cs.textOverflow === "ellipsis" || (!!clamp && clamp !== "none" && clamp !== "");
    if (outermostRoots.includes(el)) {
      overflowScroll.push(rec);
      continue;
    }
    // absorbed into a scroll-by-design chain — counted once, at its root
    if (outermostRoots.some((r) => r.contains(el))) continue;
    (designClip ? overflowClip : overflowReal).push(rec);
  }
  // Flex containers → rendered line count, so a narrow width can be compared to
  // 2560. v3 clusters by vertical OVERLAP, the same rule M1 has used since v2:
  // `round(centreY / 4px)` split a single baseline-aligned row the moment its
  // children differed in font size, and whether it did so depended on the row's
  // absolute y. Under a six-token type ladder mixed sizes on one baseline are the
  // norm, so that was a false extra-wrap wherever it landed (HO 611's
  // `.hcal-agenda-head` is the worked example; the fixture samples all four 1px
  // residues of the bucket cycle so the defect is reproducible rather than lucky).
  //
  // The key is a selector path, which repeated rows share, so instances collide.
  // v3 keeps the MAX rather than v2's last-wins: with duplicates, "whichever
  // happened to be last in the DOM" is not a measurement of anything.
  const flexLines: Record<string, number> = {};
  for (const el of allEls) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (!/flex/.test(cs.display)) continue;
    const kids = Array.from(el.children).filter((c) => visible(c));
    if (kids.length < 2) continue;
    const lines: { top: number; bottom: number }[] = [];
    const kidRects = kids
      .map((k) => k.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .sort((a, b) => a.top - b.top);
    for (const r of kidRects) {
      const h = r.bottom - r.top;
      let placed = false;
      for (const c of lines) {
        const overlapPx = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
        if (overlapPx >= 0.5 * Math.min(h, c.bottom - c.top)) {
          c.top = Math.min(c.top, r.top);
          c.bottom = Math.max(c.bottom, r.bottom);
          placed = true;
          break;
        }
      }
      if (!placed) lines.push({ top: r.top, bottom: r.bottom });
    }
    const key = pathOf(el);
    const prev = flexLines[key] ?? 0;
    flexLines[key] = Math.max(prev, lines.length);
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
      vizExempt,
      // HO 629 — the STRUCTURAL half of the exemption, beside the counted one.
      // vizExempt counts CANDIDATES, so it is width-dependent by construction: a
      // marked row that falls under m1bMinWidth stops being a candidate and drops
      // out of the count without the attribute moving at all. That is not a
      // property leg B can assert on. These two are width-invariant — they say
      // what the attribute REACHES, which is the thing that can actually rot.
      vizMarkedCount: document.querySelectorAll("[data-viz-row]").length,
      vizMarkedKeys: Array.from(document.querySelectorAll("[data-viz-row]"))
        .map((m) => `${m.tagName.toLowerCase()}.${(m.className || "").toString().trim().split(/\s+/)[0] ?? ""}`)
        .sort(),
      gaps: allGaps.map((g) => Math.round(g)),
    },
    m2: { panels, count: panels.length },
    m3: {
      rowsScored: noiseRowCount,
      meanPerRow: noiseRowCount ? Math.round((noiseTotal / noiseRowCount) * 100) / 100 : 0,
      worstRow: worstRowNoise,
      groupsSampled: m3Groups.length,
    },
    m4: {
      items: kept,
      count: kept.length,
      reservedPx: kept.reduce((a, b) => a + b.heightPx, 0),
      seededHits: kept.filter((k) => k.seeded).length,
      // v4 — the split. `items`/`count`/`reservedPx` stay the UNION so a v3 column
      // can still be read off a v4 run for the bridge; the split is additive.
      trueItems: m4True,
      trueCount: m4True.length,
      truePx: m4True.reduce((a, b) => a + b.heightPx, 0),
      furnitureItems: m4Furniture,
      furnitureCount: m4Furniture.length,
      furniturePx: m4Furniture.reduce((a, b) => a + b.heightPx, 0),
    },
    m4w: {
      items: m4w,
      count: m4w.length,
      reservedPx: m4w.reduce((a, b) => a + b.widthPx, 0),
    },
    m5: {
      overflow,
      overflowClip,
      overflowReal,
      overflowScroll,
      clipCount: overflowClip.length,
      realCount: overflowReal.length,
      scrollCount: overflowScroll.length,
      flexLines,
    },
  };
}

type Measured = Awaited<ReturnType<typeof measureInPage>>;

// ---------------------------------------------------------------------------
// LEG C — the fixture. Both directions, in one place.
//
// Every case in scripts/diagnostic/fixtures/layout-legc.html has exactly one
// assertion here, and every assertion prints the number it read whether it passed
// or failed — a leg that only speaks up on failure cannot itself be audited for
// whether it was measuring anything.
// ---------------------------------------------------------------------------
type LegCase = { id: string; ok: boolean; read: string; want: string };

function assertLegC(d: Measured): { cases: LegCase[]; ok: boolean } {
  const cases: LegCase[] = [];
  const rowsMatching = (re: RegExp) => d.m1.rows.filter((r) => re.test(r.selectorPath));
  const worstGap = (re: RegExp) => {
    const rs = rowsMatching(re);
    return rs.length ? Math.max(...rs.map((r) => r.interiorGapPx)) : null;
  };
  const push = (id: string, ok: boolean, read: string, want: string) =>
    cases.push({ id, ok, read, want });

  // --- positives: the instrument must still detect real defects --------------
  const posGap = worstGap(/legc-pos-gap/);
  push(
    "POS-1 M1 far-right anchor",
    posGap !== null && posGap >= 300,
    posGap === null ? "row not seen at all" : `interior ${posGap}px`,
    ">= 300px",
  );

  const posPanel = d.m2.panels.filter((p) => /legc-pos-panel(?![a-z-])/.test(p.selectorPath));
  push(
    "POS-2 M2 stretched panel",
    posPanel.length > 0,
    posPanel.length ? `slack ${posPanel[0]!.slackPx}px` : "panel not reported",
    `slack > ${M2_SLACK_PX}px`,
  );

  // The M2 control. Same border, same grid, same taller sibling — but sized to its
  // own content. Without it, "M2 fires" is satisfied by a predicate that fires on
  // every bordered grid child, which is exactly what the original M2 spec did.
  const negMate = d.m2.panels.filter((p) => /legc-neg-panelmate/.test(p.selectorPath));
  push(
    "NEG-4 content-sized panel not reported",
    negMate.length === 0,
    negMate.length ? `reported, slack ${negMate[0]!.slackPx}px` : "not reported",
    "not reported",
  );

  const posEmpty = d.m4.items.filter((i) => /legc-pos-empty/.test(i.selectorPath));
  push(
    "POS-3 M4 reserved empty box",
    posEmpty.length > 0,
    posEmpty.length ? `${posEmpty[0]!.heightPx}px "${posEmpty[0]!.text}"` : "box not reported",
    `>= ${M4_MIN_H}px`,
  );

  const realOverflow = d.m5.overflowReal;
  const clipOverflow = d.m5.overflowClip;
  const posOverflowSeen = realOverflow.some((o) => /legc-pos-overflow/.test(o.selectorPath));
  push(
    "POS-4 M5 real overflow in bucket (b)",
    posOverflowSeen,
    posOverflowSeen ? "in bucket (b)" : "absent from bucket (b)",
    "bucket (b) real",
  );

  // --- negatives: each one is a known false positive of an earlier version ---
  const baselineEntries = Object.entries(d.m5.flexLines).filter(([sel]) =>
    /legc-neg-baseline(?!-stack)/.test(sel),
  );
  const negBaselineLines = baselineEntries.length ? Math.max(...baselineEntries.map(([, n]) => n)) : undefined;
  push(
    "NEG-1 mixed-size baseline reads one line",
    negBaselineLines === 1,
    negBaselineLines === undefined ? "row not seen at all" : `${negBaselineLines} line(s) worst of 4 offsets`,
    "exactly 1",
  );
  const negBaselineGap = worstGap(/legc-neg-baseline(?!-stack)/);
  push(
    "NEG-1b mixed-size baseline scores no M1",
    negBaselineGap !== null && negBaselineGap <= GAP_THRESHOLD_PX,
    negBaselineGap === null ? "row not seen at all" : `interior ${negBaselineGap}px`,
    `<= ${GAP_THRESHOLD_PX}px, and seen`,
  );

  const negWrapGap = worstGap(/legc-neg-wrap/);
  push(
    "NEG-2 wrapped cell scores no phantom gap",
    negWrapGap !== null && negWrapGap <= GAP_THRESHOLD_PX,
    negWrapGap === null ? "row not seen at all" : `interior ${negWrapGap}px`,
    `<= ${GAP_THRESHOLD_PX}px, and seen`,
  );

  const clipInClip = clipOverflow.some((o) => /legc-neg-clip/.test(o.selectorPath));
  const clipInReal = realOverflow.some((o) => /legc-neg-clip/.test(o.selectorPath));
  push(
    "NEG-3 design-clip lands in M5x, not (b)",
    clipInClip && !clipInReal,
    `M5x ${clipInClip ? "yes" : "no"} · bucket (b) ${clipInReal ? "yes" : "no"}`,
    "M5x yes · (b) no",
  );

  // --- calibration: the counted exemption, exactly --------------------------
  const calScored = rowsMatching(/legc-cal/).length;
  push(
    "CAL M1x counts the viz block exactly",
    d.m1.vizExempt === 3 && calScored === 0,
    `M1x ${d.m1.vizExempt} · viz rows scored as M1 ${calScored}`,
    "M1x 3 · scored 0",
  );

  // --- v4 (HO 620): four measurement changes, four assertions --------------
  // Each demands an EXACT reading and each denies one way the change could be
  // wrong. "The new column is non-zero" would be satisfied by an instrument that
  // put everything in it, so every one of these has a paired control.
  const m4fCells = d.m4.furnitureItems.filter((i) => /legc-m4f-cell/.test(i.selectorPath)).length;
  const m4fInTrue = d.m4.trueItems.filter((i) => /legc-m4f-cell/.test(i.selectorPath)).length;
  push(
    "v4-A M4f takes the furniture, M4-true keeps none of it",
    m4fCells === 6 && m4fInTrue === 0,
    `M4f ${m4fCells} · M4-true ${m4fInTrue}`,
    "M4f 6 · M4-true 0",
  );
  // The control: an EMPTY box in the same repeated-row context must NOT be
  // furniture, or the split re-hides the /stale reservation this commit adds.
  const voidInTrue = d.m4.trueItems.some((i) => /legc-m4f-void/.test(i.selectorPath));
  const voidInFurniture = d.m4.furnitureItems.some((i) => /legc-m4f-void/.test(i.selectorPath));
  push(
    "v4-A control: an EMPTY box in a repeated row stays M4-true",
    voidInTrue && !voidInFurniture,
    `M4-true ${voidInTrue ? "yes" : "no"} · M4f ${voidInFurniture ? "yes" : "no"}`,
    "M4-true yes · M4f no",
  );

  const slots = d.m4w.items.filter((i) => /legc-m4w-slot/.test(i.selectorPath)).length;
  push(
    "v4-B M4w sees the width-reserved slot",
    slots === 3,
    `${slots} slot(s)`,
    "exactly 3, one per row",
  );
  // The control that the first draft of this predicate did not have, and paid for:
  // unguarded it fired 359 times on /members, all of them BARS. A bar and a
  // reservation are the same DOM shape; paint is what separates them.
  const bars = d.m4w.items.filter((i) => /legc-m4w-bar/.test(i.selectorPath)).length;
  push(
    "v4-B control: a painted BAR of identical size is not a reservation",
    bars === 0,
    `${bars} bar(s) counted as M4w`,
    "exactly 0",
  );

  const m5sRoots = d.m5.overflowScroll.filter((o) => /legc-m5s-frame|legc-m5s-track/.test(o.selectorPath));
  const m5sInReal = d.m5.overflowReal.filter((o) => /legc-m5s-frame|legc-m5s-track/.test(o.selectorPath));
  push(
    "v4-C M5s counts the marquee ONCE, absorbing the inner level",
    m5sRoots.length === 1 && /legc-m5s-frame/.test(m5sRoots[0]?.selectorPath ?? "") && m5sInReal.length === 0,
    `M5s ${m5sRoots.length} · same chain in (b) ${m5sInReal.length}`,
    "M5s 1 (the frame) · (b) 0",
  );
  // The one the first draft could not catch: a marquee whose animation the audit's
  // OWN reducedMotion context switches off, exactly as the markets tape's does. It
  // must still read M5s, which is only possible if animation is read from the
  // stylesheet rather than from computed style.
  const m5sRm = d.m5.overflowScroll.filter((o) => /legc-m5s-rm-frame/.test(o.selectorPath));
  const m5sRmInReal = d.m5.overflowReal.some((o) => /legc-m5s-rm/.test(o.selectorPath));
  push(
    "v4-C2 a reduced-motion-suppressed marquee still reads M5s",
    m5sRm.length === 1 && !m5sRmInReal,
    `M5s ${m5sRm.length} · chain in (b) ${m5sRmInReal ? "yes" : "no"}`,
    "M5s 1 · (b) no",
  );

  // The control: identical geometry, no animation. `overflow: hidden` on its own
  // must never buy the exemption, or every clipped box leaves bucket (b).
  const negFrameInReal = d.m5.overflowReal.some((o) => /legc-m5s-neg-frame/.test(o.selectorPath));
  const negFrameInScroll = d.m5.overflowScroll.some((o) => /legc-m5s-neg-frame/.test(o.selectorPath));
  push(
    "v4-C control: un-animated overflow:hidden stays in bucket (b)",
    negFrameInReal && !negFrameInScroll,
    `(b) ${negFrameInReal ? "yes" : "no"} · M5s ${negFrameInScroll ? "yes" : "no"}`,
    "(b) yes · M5s no",
  );

  // v4-D — the 2-child rows must now be INSIDE M3's sample. The fixture's own
  // group is not separable from the page mean, so the assertion is the one thing
  // that is decisive and stable: a non-zero mean over a sample that grew.
  push(
    "v4-D M3 samples 2-child rows (mean non-zero, groups grew)",
    d.m3.meanPerRow > 0 && d.m3.groupsSampled >= 4,
    `mean ${d.m3.meanPerRow} over ${d.m3.groupsSampled} group(s), ${d.m3.rowsScored} rows`,
    "mean > 0 · >= 4 groups",
  );

  return { cases, ok: cases.every((c) => c.ok) };
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
  // FALSIFICATION — v3.  Three legs, before the crawl, printed whole.
  //
  // Leg A asserts v3 reports LESS than v2 did on rows v2 was wrong about.
  // Leg B asserts the counted exemption is stable in both directions.
  // BOTH ARE SATISFIED BY AN INSTRUMENT THAT REPORTS NOTHING AT ALL — which is
  // the same-as-success shape this arc keeps re-learning. Leg C is the only leg
  // that separates a correction from a silencing, and at v3 it is no longer a
  // product route: see scripts/diagnostic/fixtures/layout-legc.html.
  //
  // v2 also ran an M2 fallback probe across product routes to prove the panel
  // detector fired. The fixture's POS-2 / NEG-4 pair proves it directly and
  // cannot expire, so that probe is retired with its three page loads.
  // =========================================================================
  const openFixture = async (): Promise<Measured> => {
    const page = await ctx.newPage();
    await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded", timeout: ROUTE_TIMEOUT_MS });
    await page.waitForTimeout(400);
    const data = (await page.evaluate(measureInPage, THRESHOLDS)) as Measured;
    await page.close();
    return data;
  };

  console.log("-".repeat(100));
  console.log("FALSIFICATION — instrument v4.  A: known-good clears · B: exemptions stable · C: the fixture.");
  console.log("-".repeat(100));

  let falsificationOk = true;

  // ── LEG A — known-good clears. ---------------------------------------------
  // v2's residual on these two routes was decomposed by hand at HO 613/614 and
  // found to be the wrap-caused multi-rect artifact: C1 packing let long cells
  // wrap, and v2 then measured a short last line against the next cell with the
  // long first line sitting invisibly between them. Under ink spans that class
  // must go to ~0. The bound is what the decomposition left, not a round number.
  //
  // The second half is what stops this being a silencing test: the REAL gaps on
  // the same routes — the ones the P4 handoffs measured at ~47px and declined to
  // chase — must still be REPORTED, under threshold. An instrument that stopped
  // seeing them entirely would pass the first half and fail here.
  console.log("");
  console.log("LEG A — known-good clears (the wrap artifact goes; the real under-threshold gaps stay).");
  for (const leg of LEG_A) {
    const r = await openMeasured(leg.path, 2);
    const over = r.data.m1.overThreshold;
    const drop = leg.v2Count - over;
    const sorted = r.data.m1.rows.slice().sort((a, b) => b.interiorGapPx - a.interiorGapPx);
    const worst = sorted[0]?.interiorGapPx ?? 0;
    const under = r.data.m1.rows
      .filter((x) => x.interiorGapPx <= GAP_THRESHOLD_PX && x.interiorGapPx > 0)
      .sort((a, b) => b.interiorGapPx - a.interiorGapPx);
    const countOk = drop >= leg.minCountDrop;
    const worstOk = worst <= leg.maxWorst;
    const blindOk = under.length > 0;
    console.log(
      `  ${leg.path.padEnd(10)} count over ${GAP_THRESHOLD_PX}px: v2 ${String(leg.v2Count).padStart(3)} -> v3 ${String(over).padStart(3)} (drop ${drop}, need >= ${leg.minCountDrop})` +
        `   worst gap: v2 ${String(leg.v2Worst).padStart(4)}px -> v3 ${String(worst).padStart(4)}px (need <= ${leg.maxWorst})`,
    );
    console.log(
      `             real under-threshold gaps still reported: ${under.length}` +
        (under[0] ? `, largest ${under[0].interiorGapPx}px` : ""),
    );
    for (const x of sorted.filter((x) => x.interiorGapPx > GAP_THRESHOLD_PX).slice(0, 3)) {
      console.log(`      residual ${String(x.interiorGapPx).padStart(5)}px  ${x.selectorPath}`);
    }
    if (!countOk)
      console.log(`      ** count dropped only ${drop} of a required ${leg.minCountDrop}. **`);
    if (!worstOk)
      console.log(`      ** worst gap ${worst}px > ${leg.maxWorst}px — the artifact class did not clear. **`);
    if (!blindOk)
      console.log("      ** zero under-threshold gaps reported — the detector has gone blind, not correct. **");
    if (!countOk || !worstOk || !blindOk) falsificationOk = false;
    await r.close();
  }

  // ── LEG B — exemptions stable, in both directions. -------------------------
  // The fixture's calibration block is an off-product anchor for the counted
  // exemption, so leg B survives the day the live funnel changes shape. The live
  // funnel is asserted beside it because the two together catch the two ways the
  // exemption can rot: an attribute that stops reaching its rows, and an
  // attribute that spreads.
  //
  // HO 629 RE-ANCHORED THE LIVE HALF, and the re-anchor rides the commit that
  // invalidated it (the HO 612 discipline). The old assertion was `live M1x ===
  // 30` — a CANDIDATE count, and candidacy is width-gated (m1bMinWidth). Widening
  // the bills column to 45% narrowed the left region until the widest marked node
  // read 518px against a 600px gate, so M1x went 30 -> 0 with the attribute
  // completely untouched: measured at 2560 on one build, [data-viz-row] reaches
  // the same 2 nodes (ul.stage-funnel, ul.topic-dist) and the same 86 visible
  // nodes under them at 45% and at an injected 31%; only the widest node moved,
  // 659px -> 518px. The instrument was right and the ANCHOR was wrong — a
  // product number that a legitimate layout change moves, which is the shelf-life
  // failure the fixture exists to avoid.
  //
  // So the live half now asserts what the attribute REACHES, which is
  // width-invariant: the marked-node count and their identities. Deleting the
  // attribute from a list fails it; adding it to a third list fails it; a column
  // resize does not. M1x is still PRINTED beside it — it is the registry figure —
  // but it is an observation, not a gate, and it reads 0 whenever the panel is
  // too narrow for its rows to be candidates at all.
  const HOME_VIZ_MARKED = ["ul.stage-funnel", "ul.topic-dist"];
  console.log("");
  console.log("LEG B — exemptions stable (the fixture's calibration block AND the live funnel).");
  const fixtureForB = await openFixture();
  const home = await openMeasured("/", 2);
  const homeFunnelScored = home.data.m1.rows.filter((r) => /funnel/i.test(r.selectorPath)).length;
  const homeMarked = home.data.m1.vizMarkedKeys ?? [];
  const markedOk =
    homeMarked.length === HOME_VIZ_MARKED.length &&
    HOME_VIZ_MARKED.every((k, i) => homeMarked[i] === k);
  console.log(`  fixture calibration block M1x : ${fixtureForB.m1.vizExempt}  (must be exactly 3)`);
  console.log(
    `  live / [data-viz-row] reaches : ${homeMarked.length ? homeMarked.join(", ") : "(nothing)"}  ` +
      `(must be exactly ${HOME_VIZ_MARKED.join(", ")}; funnel rows scored as M1: ${homeFunnelScored}, must be 0)`,
  );
  console.log(
    `  live / M1x (observed, not a gate): ${home.data.m1.vizExempt}  ` +
      `— candidates under the marking; width-gated, so 0 means "too narrow to be a candidate", not "unmarked"`,
  );
  if (fixtureForB.m1.vizExempt !== 3) {
    console.log("      ** the fixture's own exemption count moved — the attribute is not reaching its rows. **");
    falsificationOk = false;
  }
  if (!markedOk || homeFunnelScored > 0) {
    console.log("      ** the live funnel's marking moved or leaked into M1. **");
    falsificationOk = false;
  }
  await home.close();

  // ── LEG C — the fixture. Both directions. ----------------------------------
  console.log("");
  console.log("LEG C — the fixture (scripts/diagnostic/fixtures/layout-legc.html, loaded over file://).");
  console.log("        Positives must fire, negatives must stay silent, the calibration must be exact.");
  const legC = assertLegC(fixtureForB);
  for (const c of legC.cases) {
    console.log(
      `  ${c.ok ? "PASS" : "FAIL"}  ${c.id.padEnd(42)} read ${c.read.padEnd(34)} want ${c.want}`,
    );
  }
  if (!legC.ok) {
    console.log("      ** leg C failed — the fixture is versioned with the instrument, so this is an");
    console.log("         instrument defect, never a product one. Do not edit the fixture to pass. **");
    falsificationOk = false;
  }

  console.log("");
  if (!falsificationOk) {
    console.log("FALSIFICATION: FAIL — halting before the crawl. 80 page loads against a broken");
    console.log("instrument is spend with no information.");
    await browser.close();
    process.exitCode = 1;
    return;
  }
  console.log("FALSIFICATION: PASS");
  console.log("");

  // --falsify runs the three legs and stops. The legs are what a code commit in
  // this arc has to re-prove; the crawl is a separate, much more expensive act.
  if (FALSIFY_ONLY) {
    console.log("--falsify — stopping after the legs; no crawl requested.");
    await browser.close();
    return;
  }

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
          `M4 ${String(d.m4.trueCount).padStart(3)}/${String(d.m4.truePx).padStart(5)}px  ` +
          `M4f ${String(d.m4.furnitureCount).padStart(3)}  M4w ${String(d.m4w.count).padStart(2)}  ` +
          `M1x ${String(d.m1.vizExempt).padStart(3)}`,
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

  type NarrowRow = {
    slug: string;
    width: number;
    overflowCount: number;
    clipCount: number;
    realCount: number;
    scrollCount: number;
    extraWrapCount: number;
    samples: string[];
  };
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
          clipCount: d.m5.clipCount,
          realCount: d.m5.realCount,
          scrollCount: d.m5.scrollCount,
          extraWrapCount: extraWrap,
          samples,
        });
        console.log(
          `  ${route.slug.padEnd(14)} @${String(w).padStart(4)}  overflow ${String(d.m5.overflow.length).padStart(4)}  = M5x ${String(d.m5.clipCount).padStart(4)} + M5s ${String(d.m5.scrollCount).padStart(3)} + (b) ${String(d.m5.realCount).padStart(4)}  extra-wrap ${String(extraWrap).padStart(4)}` +
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
      m4px: r.data.m4.truePx,
      m4n: r.data.m4.trueCount,
      m4f: r.data.m4.furnitureCount,
      m4w: r.data.m4w.count,
      m1x: r.data.m1.vizExempt,
    }))
    .sort((a, b) => b.m1 - a.m1);
  console.log(`  ${"route".padEnd(22)} ${"M1a".padStart(5)} ${"M1b".padStart(5)} ${"M1".padStart(5)} ${"M2".padStart(5)} ${"M3mean".padStart(7)} ${"M4n".padStart(5)} ${"M4px".padStart(7)} ${"M4f".padStart(5)} ${"M4w".padStart(4)} ${"M1x".padStart(5)}`);
  for (const t of table) {
    console.log(
      `  ${t.slug.padEnd(22)} ${String(t.m1a).padStart(5)} ${String(t.m1b).padStart(5)} ${String(t.m1).padStart(5)} ${String(t.m2).padStart(5)} ${String(t.m3).padStart(7)} ${String(t.m4n).padStart(5)} ${String(t.m4px).padStart(7)} ${String(t.m4f).padStart(5)} ${String(t.m4w).padStart(4)} ${String(t.m1x).padStart(5)}`,
    );
  }
  console.log("  M1x = rows under [data-viz-row], EXEMPTED from M1 and counted here.");
  console.log("  M4n/M4px = M4-TRUE (reserved emptiness). M4f = furniture, EXCLUDED from M4-true and");
  console.log("  counted here. M4w = width-reserved empty slots, invisible to height-keyed M4.");
  console.log("  v4 (HO 620): M3 and M4 are a DIFFERENT RULER from v3 — see the era wall.");

  console.log("");
  console.log("=".repeat(100));
  console.log("ARTIFACT 2 — SITE-WIDE BASELINE TOTALS (M1, M4) + the gap distribution");
  console.log("=".repeat(100));
  const allGaps = results.flatMap((r) => r.data.m1.gaps);
  const totM1a = results.reduce((a, r) => a + r.data.m1.m1aCount, 0);
  const totM1b = results.reduce((a, r) => a + r.data.m1.m1bCount, 0);
  const totCandidates = results.reduce((a, r) => a + r.data.m1.candidateRows, 0);
  const totM2 = results.reduce((a, r) => a + r.data.m2.count, 0);
  const totM4 = results.reduce((a, r) => a + r.data.m4.trueCount, 0);
  const totM4px = results.reduce((a, r) => a + r.data.m4.truePx, 0);
  const totM4f = results.reduce((a, r) => a + r.data.m4.furnitureCount, 0);
  const totM4fpx = results.reduce((a, r) => a + r.data.m4.furniturePx, 0);
  const totM4w = results.reduce((a, r) => a + r.data.m4w.count, 0);
  const totM4wpx = results.reduce((a, r) => a + r.data.m4w.reservedPx, 0);
  const totSeeded = results.reduce((a, r) => a + r.data.m4.seededHits, 0);
  const totVizExempt = results.reduce((a, r) => a + r.data.m1.vizExempt, 0);
  console.log(`  M1 candidate rows examined : ${totCandidates}`);
  console.log(`  M1 rows over ${GAP_THRESHOLD_PX}px          : ${totM1a + totM1b}   (M1a ${totM1a} · M1b ${totM1b})`);
  console.log(`  M1x viz-exempted rows      : ${totVizExempt}   (chart rows under [data-viz-row]; excluded from M1 above)`);
  console.log(`  M2 stretched panels        : ${totM2}`);
  console.log(`  M4-true reserved-empty     : ${totM4}  totalling ${totM4px}px of vertical space  (seed-vocabulary hits ${totSeeded})`);
  console.log(`  M4f furniture (excluded)   : ${totM4f}  totalling ${totM4fpx}px  (short labels in repeated rows — not reserved space)`);
  console.log(`  M4w width-reserved slots   : ${totM4w}  totalling ${totM4wpx}px of horizontal space`);
  console.log("");
  console.log(`  Interior-gap distribution across ${allGaps.length} measured gaps — the threshold is defensible from this, not assumed:`);
  for (const line of histogram(allGaps)) console.log(line);

  console.log("");
  console.log("=".repeat(100));
  console.log("ARTIFACT 3 — M5 NARROW-WIDTH BASELINE");
  console.log("=".repeat(100));
  console.log("  900px is a BREAKPOINT (.dv2-grid collapses at max-width:900, globals.css:646) — 1024 and 720 bracket it.");
  console.log("  overflow splits THREE ways (v4). M5x = authored TRUNCATION (own text-overflow:ellipsis or a");
  console.log("  line clamp). M5s = authored SCROLLING (self-scrollable, or overflow:hidden moved by animation),");
  console.log("  counted ONCE at the outermost of its chain. (b) = real overflow, the number narrow work owns.");
  console.log(`  ${"route".padEnd(16)} ${"width".padStart(6)} ${"overflow".padStart(9)} ${"M5x".padStart(7)} ${"M5s".padStart(5)} ${"(b) real".padStart(9)} ${"extra-wrap".padStart(11)}`);
  for (const n of narrow) {
    console.log(`  ${n.slug.padEnd(16)} ${String(n.width).padStart(6)} ${String(n.overflowCount).padStart(9)} ${String(n.clipCount).padStart(7)} ${String(n.scrollCount).padStart(5)} ${String(n.realCount).padStart(9)} ${String(n.extraWrapCount).padStart(11)}`);
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
    // v2 — SHA-stamped and NEVER overwritten. v1 wrote a fixed `audit-2560.json`,
    // so the HO 610 re-run destroyed the 606 full-crawl baseline it was supposed
    // to be compared against; the baseline had to be rebuilt by checking out the
    // prior commit and crawling again. A file whose whole purpose is cross-run
    // comparison must not be clobbered by the next run.
    let stem = `audit-${SHORT_SHA}-${WIDE_W}${ROUTE_FILTER ? `-${ROUTE_FILTER}` : ""}`;
    let path = `${ARTIFACT_DIR}/${stem}.json`;
    for (let n = 2; existsSync(path); n++) path = `${ARTIFACT_DIR}/${stem}.${n}.json`;
    writeFileSync(
      path,
      JSON.stringify(
        {
          instrument: "v2",
          sha: SHORT_SHA,
          width: WIDE_W,
          thresholds: THRESHOLDS,
          routeFilter: ROUTE_FILTER ?? null,
          results,
          narrow,
          cantMeasure,
        },
        null,
        1,
      ),
    );
    console.log("");
    console.log(`  full per-route detail → ${path} (repo-ignored)`);
  } catch (e) {
    console.log(`  (could not write artifacts: ${String(e).slice(0, 80)})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
