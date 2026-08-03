// HO 592 STEP 0 — the static nesting parser diff. COMMITTED, READ-ONLY. Not a fix.
//
// Targets H5: a data-dependent INVALID HTML NESTING structural mismatch, the
// surviving hypothesis after HO 590 C5 killed the clock for prod. The browser runs
// the spec's tree-construction algorithm over the server markup BEFORE React
// hydrates — a <div> inside a <p> closes the paragraph and reparents, a <tr> without
// a <tbody> gets one synthesised, an <a> inside an <a> is restructured. React's
// client render then produces the AUTHORED tree, which no longer matches the PARSED
// DOM → args[]=HTML.
//
// The instrument is the point (handoff §0): invalid nesting is detectable STATICALLY.
// You never have to catch the intermittent firing. Fetch prod's HTML, parse it with a
// spec-compliant parser, and any node the parser MOVES, DROPS or SYNTHESISES is a
// latent mismatch.
//
// Why parse5 and not the browser: parse5 implements the same tree-construction
// algorithm AND exposes sourceCodeLocation, which is what makes the diff possible.
// A browser gives you the parsed tree but no source offsets, so you cannot tell a
// reparented node from a correctly-placed one. A lenient parser (cheerio's default,
// regex scrapers) silently agrees with the source and reports nothing — useless here.
//
// METHOD. Two independent trees over the same bytes:
//   AUTHORED — a stack scanner that nests tags exactly as written. Valid because
//     React SSR serialises its own tree: start/end tags are always matched, attrs
//     always quoted. This is what React will re-render on the client.
//   PARSED   — parse5, i.e. what the browser actually builds.
// Match the two by start-tag source offset, then compare ancestor paths:
//   path differs        → REPARENTED (the mismatch)
//   in AUTHORED only    → DROPPED
//   no source location  → SYNTHESISED by the parser
//
// Noise handled explicitly (handoff M1):
//   1. React SSR comment markers and <!--$--> / <!--/$--> Suspense boundaries are
//      comments; the scanner skips comments and parse5 elements only are compared.
//   2. Attribute order, quoting and self-closing form are parser normalisations —
//      never compared. Tree shape and node identity only.
//   3. Row counts are recorded per route so an EMPTY pass (no rows → pattern absent)
//      is distinguishable from a CLEAN pass (rows present → pattern genuinely absent).
//
//   npx tsx scripts/diagnostic/nesting-parser-diff-592.ts
//   BASE_URL=http://localhost:3000 npx tsx scripts/diagnostic/nesting-parser-diff-592.ts
import "dotenv/config";
import { parse } from "parse5";

const BASE = process.env.BASE_URL ?? "https://congressional-terminal-chi-silk.vercel.app";

const STAGES = ["introduced", "committee", "floor", "other_chamber", "president", "enacted"];

// Mirrors e2e/smoke.spec.ts ROUTES at HEAD — ALL of them, not the observed firing
// set (HO 574's scoping guard: the set is explained by mechanism, not by having
// stopped growing).
const BILL = "119-s-2";
const MEMBER = "A000055";
const RACE = "AL-01-2026";
const COMMITTEE = "hlig00";
const REPORT = "2026-06-15";
const VOTE = "senate-119-2-207";

const ROUTES: Array<{ slug: string; path: string }> = [
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
  { slug: "amendments", path: "/amendments" },
  { slug: "nominations", path: "/nominations" },
  { slug: "lobbying", path: "/lobbying" },
  { slug: "trades", path: "/trades" },
  { slug: "committees-redirect", path: "/committees" },
  { slug: "watchlist", path: "/watchlist" },
  { slug: "dashboard-classic", path: "/dashboard-classic" },
  { slug: "dashboard-v2", path: "/dashboard-v2" },
  { slug: "bill-detail", path: `/bill/${BILL}` },
  { slug: "member-detail", path: `/members/${MEMBER}` },
  { slug: "race-detail", path: `/race/${RACE}` },
  { slug: "committee-detail", path: `/committee/${COMMITTEE}` },
  { slug: "report-detail", path: `/reports/${REPORT}` },
  { slug: "vote", path: `/vote/${VOTE}` },
];

// The prod firing set (HO 574 + 591): used by M4 only, never to scope M1.
const FIRING = new Set([
  "home",
  ...STAGES.map((s) => `home-stage-${s}`),
  "president",
  "members",
]);

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "source", "track", "wbr",
]);
// Elements whose content is raw text, so `<` inside them is not markup. `title` is
// rawtext ONLY in the HTML namespace — inside <svg> it is a normal element (which is
// exactly the HO 473 multi-child case), so the scanner tracks foreign content.
const RAWTEXT = new Set(["script", "style", "textarea"]);

type Authored = {
  tag: string;
  startOffset: number;
  path: string[]; // ancestor tagNames, outermost first
};

// ---------------------------------------------------------------------------
// AUTHORED tree — nests tags exactly as written.
// ---------------------------------------------------------------------------
function scanAuthored(html: string): Authored[] {
  const out: Authored[] = [];
  const stack: string[] = [];
  let foreignDepth = 0; // >0 while inside <svg>/<math>
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = html.indexOf(">", lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    // end tag
    if (html[lt + 1] === "/") {
      const end = html.indexOf(">", lt);
      if (end === -1) break;
      const name = html.slice(lt + 2, end).trim().toLowerCase();
      const idx = stack.lastIndexOf(name);
      if (idx !== -1) {
        if (foreignDepth > 0 && (name === "svg" || name === "math")) foreignDepth--;
        stack.length = idx;
      }
      i = end + 1;
      continue;
    }

    // start tag — walk to the closing '>' respecting quoted attribute values
    let j = lt + 1;
    let quote: string | null = null;
    while (j < html.length) {
      const ch = html[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      j++;
    }
    if (j >= html.length) break;

    const inner = html.slice(lt + 1, j);
    const nameMatch = /^[A-Za-z][^\s/>]*/.exec(inner);
    if (!nameMatch) {
      i = j + 1;
      continue;
    }
    const tag = nameMatch[0].toLowerCase();
    const selfClosing = inner.trimEnd().endsWith("/");

    out.push({ tag, startOffset: lt, path: [...stack] });

    const isForeignRoot = tag === "svg" || tag === "math";
    // Self-closing syntax is honoured for void elements and inside foreign content —
    // the only places React emits it.
    const closesImmediately = VOID.has(tag) || (selfClosing && (foreignDepth > 0 || isForeignRoot));

    if (!closesImmediately) {
      stack.push(tag);
      if (isForeignRoot) foreignDepth++;
      const raw = RAWTEXT.has(tag) || (tag === "title" && foreignDepth === 0);
      if (raw) {
        const close = html.toLowerCase().indexOf(`</${tag}`, j);
        if (close === -1) {
          i = html.length;
          continue;
        }
        i = close;
        continue;
      }
    }
    i = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// PARSED tree — parse5, i.e. what the browser builds.
// ---------------------------------------------------------------------------
type Parsed = {
  tag: string;
  startOffset: number | null; // null ⇒ synthesised by the parser
  path: string[];
  childCount: number;
  textChildren: number;
  elementChildren: number;
};

function walkParsed(html: string): Parsed[] {
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const out: Parsed[] = [];

  const visit = (node: any, path: string[]) => {
    const kids: any[] = node.childNodes ?? [];
    for (const child of kids) {
      const name: string = child.nodeName;
      if (name.startsWith("#")) continue; // #text, #comment, #documentType
      const loc = child.sourceCodeLocation;
      const childNodes: any[] = child.childNodes ?? [];
      out.push({
        tag: name.toLowerCase(),
        startOffset: loc?.startTag?.startOffset ?? null,
        path: [...path],
        childCount: childNodes.length,
        textChildren: childNodes.filter((c) => c.nodeName === "#text").length,
        elementChildren: childNodes.filter((c) => !String(c.nodeName).startsWith("#")).length,
      });
      visit(child, [...path, name.toLowerCase()]);
    }
  };
  visit(doc, []);
  return out;
}

// ---------------------------------------------------------------------------
// Known parser-restructuring patterns, read off the AUTHORED tree. Supplementary to
// the diff — these are the shapes the spec algorithm is guaranteed to restructure.
// ---------------------------------------------------------------------------
const BLOCK = new Set([
  "div", "p", "ul", "ol", "li", "table", "form", "section", "article", "header",
  "footer", "nav", "aside", "main", "h1", "h2", "h3", "h4", "h5", "h6", "pre",
  "blockquote", "hr", "figure", "dl",
]);

// TWO BUCKETS, and the distinction is the whole point — only the first can produce
// a #418:
//   restructuring — the tree-construction algorithm MOVES/ADDS/DROPS nodes, so the
//     parsed DOM differs from React's authored tree → structural mismatch.
//   contentModel  — invalid per the spec's content model, but the parser leaves the
//     tree ALONE. React re-renders the same shape, hydration matches, no #418. A
//     lint concern, never a mismatch source. Reported separately so it can never be
//     mistaken for a finding.
// Not flagged at all: <div> inside <a>. That is VALID HTML5 — <a> has a transparent
// content model, so a flow-content child is legal and the parser keeps it. An earlier
// pass of this script flagged it and produced 20 phantom "findings" on `/`.
function knownPatterns(authored: Authored[]): { restructuring: string[]; contentModel: string[] } {
  const restructuring: string[] = [];
  const contentModel: string[] = [];

  for (const el of authored) {
    const parent = el.path[el.path.length - 1];
    if (!parent) continue;
    if (el.path.includes("svg") || el.path.includes("math")) continue; // foreign content → M2

    // <p> auto-closes on a block start tag: the child is reparented out.
    if (parent === "p" && BLOCK.has(el.tag)) restructuring.push(`<${el.tag}> inside <p>`);
    if (el.tag === "p" && el.path.includes("p")) restructuring.push("<p> inside <p>");
    // Adoption agency / auto-close rules.
    if (el.tag === "a" && el.path.includes("a")) restructuring.push("<a> inside <a>");
    if (el.tag === "button" && el.path.includes("button")) restructuring.push("<button> inside <button>");
    if (el.tag === "form" && el.path.includes("form")) restructuring.push("<form> inside <form>");
    // Table fixup: missing tbody is synthesised, stray cells are relocated.
    if (el.tag === "tr" && !["tbody", "thead", "tfoot"].includes(parent)) {
      restructuring.push(`<tr> directly inside <${parent}>`);
    }
    if ((el.tag === "td" || el.tag === "th") && parent !== "tr") {
      restructuring.push(`<${el.tag}> directly inside <${parent}>`);
    }

    // Parser-stable content-model violations — informational only.
    if (parent === "button" && BLOCK.has(el.tag)) contentModel.push(`<${el.tag}> inside <button>`);
    if (el.tag === "li" && !["ul", "ol", "menu"].includes(parent)) {
      contentModel.push(`<li> directly inside <${parent}>`);
    }
  }
  return { restructuring, contentModel };
}

// SVG <title> with more than one child node — the HO 473 mechanism (M2's live class).
function svgTitleMultiChild(parsed: Parsed[]): Parsed[] {
  return parsed.filter((p) => p.tag === "title" && p.path.includes("svg") && p.childCount > 1);
}

type RouteResult = {
  slug: string;
  path: string;
  status: number;
  finalPath: string;
  bytes: number;
  elements: number;
  rows: number;
  reparented: Array<{ tag: string; authored: string; parsed: string; snippet: string }>;
  dropped: Array<{ tag: string; authored: string; snippet: string }>;
  synthesised: Array<{ tag: string; parsed: string }>;
  patterns: Record<string, number>;        // parser-RESTRUCTURING only (can cause #418)
  contentModel: Record<string, number>;    // parser-stable violations (cannot cause #418)
  svgTitle: number;
  error?: string;
};

// The diff itself, factored out so --selftest can drive it over a known-bad fixture.
// A "no findings" run is only worth anything if the detector is known to fire.
function diffHtml(html: string, base: RouteResult): RouteResult {
  const authored = scanAuthored(html);
  const parsed = walkParsed(html);
  base.elements = authored.length;

  // Row-volume proxy, so an empty pass is distinguishable from a clean one.
  base.rows = parsed.filter((p) => p.tag === "tr" || p.tag === "li").length +
    (html.match(/class="[^"]*\b(v2f-row|bxp|markets-tape-item|lob-row|row)\b/g) ?? []).length;

  const byOffset = new Map<number, Parsed>();
  for (const p of parsed) if (p.startOffset !== null) byOffset.set(p.startOffset, p);

  for (const a of authored) {
    const p = byOffset.get(a.startOffset);
    if (!p) {
      base.dropped.push({
        tag: a.tag,
        authored: a.path.join(">"),
        snippet: html.slice(a.startOffset, a.startOffset + 100).replace(/\s+/g, " "),
      });
      continue;
    }
    if (a.path.join(">") !== p.path.join(">")) {
      base.reparented.push({
        tag: a.tag,
        authored: a.path.join(">"),
        parsed: p.path.join(">"),
        snippet: html.slice(a.startOffset, a.startOffset + 100).replace(/\s+/g, " "),
      });
    }
  }

  for (const p of parsed) {
    if (p.startOffset === null && !["html", "head", "body"].includes(p.tag)) {
      base.synthesised.push({ tag: p.tag, parsed: p.path.join(">") });
    }
  }

  const pat = knownPatterns(authored);
  for (const hit of pat.restructuring) base.patterns[hit] = (base.patterns[hit] ?? 0) + 1;
  for (const hit of pat.contentModel) base.contentModel[hit] = (base.contentModel[hit] ?? 0) + 1;
  base.svgTitle = svgTitleMultiChild(parsed).length;
  return base;
}

function emptyResult(slug: string, path: string): RouteResult {
  return {
    slug, path, status: 0, finalPath: path, bytes: 0, elements: 0, rows: 0,
    reparented: [], dropped: [], synthesised: [], patterns: {}, contentModel: {}, svgTitle: 0,
  };
}

// Proves the instrument fires. Each fixture is a shape the spec's tree-construction
// algorithm is guaranteed to restructure; if any of these comes back clean the diff
// is broken and a clean prod run means nothing.
function selftest(): boolean {
  const cases: Array<{ name: string; html: string; want: (r: RouteResult) => boolean }> = [
    {
      name: "<div> inside <p> → reparented + <p> synthesised",
      html: `<html><body><p>alpha<div id="moved">beta</div></p></body></html>`,
      want: (r) => r.reparented.some((x) => x.tag === "div") && r.patterns["<div> inside <p>"] === 1,
    },
    {
      name: "<a> inside <a> → reparented",
      html: `<html><body><a href="/x">one<a href="/y">two</a></a></body></html>`,
      want: (r) => r.reparented.some((x) => x.tag === "a") && r.patterns["<a> inside <a>"] === 1,
    },
    {
      name: "<tr> without <tbody> → tbody synthesised + tr reparented",
      html: `<html><body><table><tr><td>cell</td></tr></table></body></html>`,
      want: (r) => r.synthesised.some((x) => x.tag === "tbody") && r.reparented.some((x) => x.tag === "tr"),
    },
    {
      name: "<div> inside <button> → content-model bucket, NOT a restructure",
      html: `<html><body><button><div>x</div></button></body></html>`,
      want: (r) => r.contentModel["<div> inside <button>"] === 1 && Object.keys(r.patterns).length === 0,
    },
    {
      name: "multi-child SVG <title> (HO 473) → flagged",
      html: `<html><body><svg><title>a<tspan>b</tspan></title></svg></body></html>`,
      want: (r) => r.svgTitle === 1,
    },
    {
      name: "<div> inside <a> → NOT flagged (valid HTML5, transparent content model)",
      html: `<html><body><a href="/x"><div>card</div></a></body></html>`,
      want: (r) =>
        r.reparented.length === 0 && Object.keys(r.patterns).length === 0 &&
        Object.keys(r.contentModel).length === 0,
    },
    {
      name: "valid markup → clean (no false positives)",
      html: `<html><body><div><p>ok</p><ul><li>a</li></ul><table><tbody><tr><td>c</td></tr></tbody></table></div></body></html>`,
      want: (r) =>
        r.reparented.length === 0 && r.dropped.length === 0 &&
        r.synthesised.length === 0 && Object.keys(r.patterns).length === 0,
    },
  ];

  console.log("=== SELFTEST — does the detector actually fire? ===");
  let ok = true;
  for (const c of cases) {
    const r = diffHtml(c.html, emptyResult("selftest", "-"));
    const pass = c.want(r);
    if (!pass) ok = false;
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${c.name}`);
    if (!pass) {
      console.log(`        reparented=${JSON.stringify(r.reparented.map((x) => x.tag))} synth=${JSON.stringify(r.synthesised.map((x) => x.tag))} patterns=${JSON.stringify(r.patterns)} svgTitle=${r.svgTitle}`);
    }
  }
  console.log(`  → ${ok ? "instrument VALID" : "instrument BROKEN — a clean prod run proves nothing"}\n`);
  return ok;
}

async function probe(slug: string, path: string): Promise<RouteResult> {
  const base: RouteResult = emptyResult(slug, path);
  let html = "";
  try {
    // ct_seen: `/` 307s anonymous → /welcome (app/page.tsx). Without it we would diff
    // the landing page instead of the dashboard — confirmed a false lead in HO 591.
    const res = await fetch(BASE + path, {
      headers: { cookie: "ct_seen=1", "user-agent": "cbt-diagnostic/592" },
      redirect: "follow",
    });
    base.status = res.status;
    base.finalPath = new URL(res.url).pathname + new URL(res.url).search;
    html = await res.text();
    base.bytes = html.length;
  } catch (e) {
    base.error = String(e);
    return base;
  }

  return diffHtml(html, base);
}

async function main() {
  const valid = selftest();
  if (process.argv.includes("--selftest")) return;
  if (!valid) {
    console.error("[592] refusing to report a prod result on a broken instrument");
    process.exit(1);
  }
  console.log(`[592] static nesting parser diff — BASE=${BASE}`);
  console.log(`[592] ${ROUTES.length} routes (ALL of smoke.spec.ts ROUTES, not the firing set)\n`);

  const results: RouteResult[] = [];
  for (const r of ROUTES) {
    const res = await probe(r.slug, r.path);
    results.push(res);
    const flags: string[] = [];
    if (res.reparented.length) flags.push(`REPARENTED=${res.reparented.length}`);
    if (res.dropped.length) flags.push(`DROPPED=${res.dropped.length}`);
    if (res.synthesised.length) flags.push(`SYNTH=${res.synthesised.length}`);
    if (res.svgTitle) flags.push(`SVG-TITLE=${res.svgTitle}`);
    const pat = Object.entries(res.patterns);
    if (pat.length) flags.push("RESTRUCTURE: " + pat.map(([k, v]) => `${k}×${v}`).join(", "));
    const cm = Object.entries(res.contentModel);
    if (cm.length) flags.push("content-model(no #418): " + cm.map(([k, v]) => `${k}×${v}`).join(", "));
    console.log(
      `  ${res.slug.padEnd(22)} ${String(res.status).padEnd(4)} el=${String(res.elements).padEnd(6)} rows=${String(res.rows).padEnd(5)} ${flags.length ? flags.join(" | ") : "clean"}${res.error ? " ERR " + res.error : ""}`,
    );
  }

  // ---- M1 detail -------------------------------------------------------------
  console.log(`\n=== M1 — parser diff detail ===`);
  let anyFinding = false;
  for (const r of results) {
    const total = r.reparented.length + r.dropped.length + r.synthesised.length;
    if (!total) continue;
    anyFinding = true;
    console.log(`\n-- ${r.slug} (${r.finalPath}) --`);
    for (const x of r.reparented.slice(0, 12)) {
      console.log(`   REPARENTED <${x.tag}>`);
      console.log(`     authored: ${x.authored}`);
      console.log(`     parsed:   ${x.parsed}`);
      console.log(`     src:      ${x.snippet}`);
    }
    if (r.reparented.length > 12) console.log(`   … +${r.reparented.length - 12} more reparented`);
    for (const x of r.dropped.slice(0, 8)) {
      console.log(`   DROPPED <${x.tag}> authored under ${x.authored}\n     src: ${x.snippet}`);
    }
    const synthTags = r.synthesised.reduce<Record<string, number>>((m, s) => {
      m[s.tag] = (m[s.tag] ?? 0) + 1;
      return m;
    }, {});
    if (Object.keys(synthTags).length) {
      console.log(`   SYNTHESISED: ${Object.entries(synthTags).map(([t, n]) => `<${t}>×${n}`).join(", ")}`);
    }
  }
  if (!anyFinding) console.log("  (no reparented / dropped / synthesised nodes on any route)");

  // ---- M4 cross ---------------------------------------------------------------
  console.log(`\n=== M4 — findings vs the prod firing set ===`);
  const withFindings = results.filter(
    (r) => r.reparented.length + r.dropped.length + r.synthesised.length + r.svgTitle > 0,
  );
  const firingHits = withFindings.filter((r) => FIRING.has(r.slug));
  const nonFiringHits = withFindings.filter((r) => !FIRING.has(r.slug));
  console.log(`  routes with findings: ${withFindings.length}/${results.length}`);
  console.log(`  on the firing set:    ${firingHits.length} (${firingHits.map((r) => r.slug).join(", ") || "none"})`);
  console.log(`  on never-fired:       ${nonFiringHits.length} (${nonFiringHits.map((r) => r.slug).join(", ") || "none"})`);
  const emptyRoutes = results.filter((r) => r.rows === 0).map((r) => r.slug);
  console.log(`  zero-row routes (an empty pass, NOT a clean one): ${emptyRoutes.join(", ") || "none"}`);
  const bad = results.filter((r) => r.status !== 200);
  console.log(`  non-200: ${bad.map((r) => `${r.slug}=${r.status}`).join(", ") || "none"}`);

  console.log(`\n=== VERDICT (H5) ===`);
  if (withFindings.length === 0) {
    console.log("  FALSIFIED — no route's server HTML contains nesting the parser restructures.");
  } else if (nonFiringHits.length === 0) {
    console.log("  STRONG SUPPORT — findings land only on routes known to fire.");
  } else {
    console.log("  WEAK — the pattern is present on never-fired routes too; something else gates the mismatch.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
