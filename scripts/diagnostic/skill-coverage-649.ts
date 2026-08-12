// HO 649 — what shipped and never reached the docs that record it.
// Read-only. BUILDS NOTHING, WRITES NOTHING. Filesystem + `git log` only:
// no DB, no network, so there is no read-budget question to price.
//
//   npx tsx scripts/diagnostic/skill-coverage-649.ts
//
// WHY THIS IS A SCRIPT AND NOT A SESSION OF GREPS. The absence band shipped at
// HO 622 and reached SKILL at 646 — twenty-three HOs later; the passage it got
// was falsified inside one HO by 647, and its figures corrected at 648. Both
// were found because a handoff happened to ask. Neither was found by looking.
// This replaces "a handoff happened to ask" with something re-runnable.
//
// THE FAILURE MODE THIS IS DESIGNED AGAINST IS A TIDY ANSWER. A report reading
// "SKILL covers the significant surfaces, with a handful of minor gaps" is a
// characterization, not a finding. So this emits counts and lists; the
// classification criteria live in the handoff and were fixed before any output
// existed. Nothing here re-measures a figure — the finding is which figures are
// STRUCTURALLY EXPOSED to going stale, not which ones have.
//
// ── WHAT THIS INSTRUMENT CANNOT SEE, stated up front so no reader infers more ──
// 1. COVERED != CORRECT. A passage that exists but describes a SUPERSEDED
//    version reads as covered here. HO 646's absence-band passage would have
//    passed M1 cleanly the day before HO 647 falsified it. This measures
//    presence of prose, never its truth.
// 2. Reachability is FILE-level. An intra-file dead branch is invisible — the
//    live example is `V2FeedList`'s non-v2 renderer arm (backlog, HO 627),
//    unreachable because its only caller always passes variant="v2", while the
//    file itself is legitimately reachable and rendering.
// 3. A component reached only through a `layout.tsx` is reported separately
//    rather than as reachable, because the handoff fixed roots at
//    `app/**/page.tsx`. The count is printed so the choice is visible.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";

const ROOT = process.cwd();
const SKILL = join(ROOT, ".claude", "skills", "cbt", "SKILL.md");
const skillLines = readFileSync(SKILL, "utf8").split(/\r?\n/);
const backlogText = readFileSync(join(ROOT, "docs", "backlog.md"), "utf8");
const odditiesText = readFileSync(join(ROOT, "docs", "oddities.md"), "utf8");
const roadmapText = readFileSync(join(ROOT, "docs", "roadmap.md"), "utf8");

const pad = (v: string | number, n: number) => String(v).padStart(n);
const rule = (n = 92) => "  " + "-".repeat(n);

// ── literal, anchored matching. NEVER a regex on an identifier: HO 648 lost
// time to `78.2` matching `78` + any + `2`, and the SKILL's own rule is that an
// unanchored grep collides through substrings.
function hitLines(needle: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < skillLines.length; i++) {
    const l = skillLines[i];
    if (l !== undefined && l.includes(needle)) out.push(i + 1);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// file walk
// ────────────────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e)) out.push(p);
  }
  return out;
}

const appFiles = walk(join(ROOT, "app"));
const componentFiles = readdirSync(join(ROOT, "components"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => join(ROOT, "components", f));
const libFiles = walk(join(ROOT, "lib"));
const allFiles = [...appFiles, ...componentFiles, ...libFiles];

// ────────────────────────────────────────────────────────────────────────────
// import graph — VALUE edges only.
//
// `import type { X } from "y"` is erased at compile time and does NOT make y
// reachable. This is not a nicety: `DashboardTopicTreemap`'s only remaining
// importers are `import type { TopicDatum }`, so a graph that counts type edges
// reports a known display orphan as live — the exact direction that reads as a
// clean bill of health.
// ────────────────────────────────────────────────────────────────────────────
function valueImports(src: string): string[] {
  const specs: string[] = [];
  const add = (s: string | undefined) => {
    if (s) specs.push(s);
  };

  // side-effect import
  for (const m of src.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) add(m[1]);
  // dynamic import
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) add(m[1]);
  // re-export (a value re-export keeps the target live)
  for (const m of src.matchAll(/^\s*export\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/gm)) add(m[1]);

  for (const m of src.matchAll(/^\s*import\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/gm)) {
    const clause = m[1] ?? "";
    const spec = m[2];
    if (/^type\b/.test(clause.trim())) continue; // whole-clause type import
    const braced = clause.match(/\{([\s\S]*)\}/);
    const outside = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
    if (outside.length > 0) {
      add(spec); // default or namespace binding — a value edge
      continue;
    }
    if (braced) {
      const names = (braced[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      // inline `{ type X }` specifiers are erased too; a value edge needs one
      // binding that is not type-prefixed.
      if (names.some((n) => !/^type\s/.test(n))) add(spec);
      continue;
    }
    add(spec);
  }
  return specs;
}

function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; // node_modules
  for (const cand of [base, base + ".tsx", base + ".ts", join(base, "index.tsx"), join(base, "index.ts")]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

const edges = new Map<string, string[]>();
for (const f of allFiles) {
  let src: string;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const targets: string[] = [];
  for (const spec of valueImports(src)) {
    const r = resolveSpec(spec, f);
    if (r) targets.push(r);
  }
  edges.set(f, targets);
}

const pageRoots = appFiles.filter((f) => f.endsWith(`${sep}page.tsx`));
const layoutRoots = appFiles.filter((f) => f.endsWith(`${sep}layout.tsx`));

function routeOf(pageFile: string): string {
  const rel = relative(join(ROOT, "app"), dirname(pageFile)).split(sep).join("/");
  return rel === "" || rel === "." ? "/" : "/" + rel;
}

/** roots that transitively reach each file, over value edges only */
function reachFrom(roots: string[]): Map<string, Set<string>> {
  const reached = new Map<string, Set<string>>();
  for (const root of roots) {
    const seen = new Set<string>([root]);
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === undefined) break;
      for (const nxt of edges.get(cur) ?? []) {
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        stack.push(nxt);
      }
    }
    for (const f of seen) {
      let s = reached.get(f);
      if (!s) {
        s = new Set<string>();
        reached.set(f, s);
      }
      s.add(root);
    }
  }
  return reached;
}

const reachedByPages = reachFrom(pageRoots);
const reachedByLayouts = reachFrom(layoutRoots);

// ────────────────────────────────────────────────────────────────────────────
// CONTROLS — run and printed FIRST. The instrument reports absence, so it has
// to prove it can report presence, and that a zero is a reading rather than a
// default.
//
// HANDOFF PREMISE CORRECTED (§5 control 3): the handoff names
// `DashboardTopicTreemap` AND `V2FeedList` as display orphans that must land in
// the not-reachable split. The backlog entry it draws on (HO 627) says
// something narrower — the orphan is `V2FeedList`'s NON-V2 RENDERER ARM, not
// the file, which is value-imported by ActivityTicker / TopStalls / NewThisWeek
// and rendered on `/`. A file-level instrument SHOULD report it reachable, so
// asserting otherwise would have had us "fix" correct logic until it lied.
// V2FeedList is therefore inverted into a TRANSITIVE POSITIVE control
// (page -> ActivityTicker -> V2FeedList), which tests multi-hop edges — a
// dimension the original control set never covered.
// ────────────────────────────────────────────────────────────────────────────
type Control = { name: string; expect: string; got: string; pass: boolean };
const controls: Control[] = [];

{
  const h = hitLines("AbsenceCardBack");
  controls.push({
    name: "C1 presence · AbsenceCardBack has a SKILL passage",
    expect: "hits > 0",
    got: `${h.length} hit(s) @ ${h.join(",") || "-"}`,
    pass: h.length > 0,
  });
}
{
  const token = "ZzQxNonsenseTokenNotInSkill649";
  const h = hitLines(token);
  controls.push({
    name: "C2 absence · nonsense token",
    expect: "hits == 0",
    got: `${h.length} hit(s)`,
    pass: h.length === 0,
  });
}
{
  const f = join(ROOT, "components", "DashboardTopicTreemap.tsx");
  const reached = reachedByPages.has(f);
  controls.push({
    name: "C3a negative · DashboardTopicTreemap NOT reachable (type-only importers)",
    expect: "not reachable",
    got: reached ? "REACHABLE" : "not reachable",
    pass: !reached,
  });
}
{
  const f = join(ROOT, "components", "V2FeedList.tsx");
  const roots = reachedByPages.get(f);
  controls.push({
    name: "C3b positive (CORRECTED) · V2FeedList reachable transitively",
    expect: "reachable, >= 2 hops",
    got: roots ? `reachable from ${[...roots].map(routeOf).join(",")}` : "NOT reachable",
    pass: !!roots && roots.size > 0,
  });
}

console.log("\n  HO 649 — SKILL coverage probe (read-only)");
console.log(rule());
console.log("  CONTROLS (before any finding)");
for (const c of controls)
  console.log(`    ${c.pass ? "PASS" : "**FAIL**"}  ${c.name}\n            expect ${c.expect} · got ${c.got}`);
if (controls.some((c) => !c.pass))
  console.log("\n    A FAILING CONTROL VOIDS THE TABLE BELOW — every zero in it is meaningless.");

// ────────────────────────────────────────────────────────────────────────────
// M1 — surfaces with no SKILL passage
// ────────────────────────────────────────────────────────────────────────────
const names = componentFiles.map((f) => f.split(sep).pop()!.replace(/\.tsx$/, ""));

// COLLISIONS: component names nest (`BillRow` matches every `BillRowGrid` line),
// so a bare count reports the shorter name covered when it may not be. Emitted
// before the table; a hit on a colliding name has to be READ, not counted.
const collisions: Array<{ short: string; long: string }> = [];
for (const a of names)
  for (const b of names)
    if (a !== b && b.includes(a)) collisions.push({ short: a, long: b });
const collidingShort = new Set(collisions.map((c) => c.short));

console.log("\n" + rule());
console.log(`  M1 — SKILL coverage of ${names.length} components / ${pageRoots.length} routes`);
console.log(rule());
console.log(`\n  substring collisions among component names: ${collisions.length} pair(s), ${collidingShort.size} contaminated name(s)`);
for (const c of collisions.slice(0, 40)) console.log(`    ${c.short.padEnd(28)} ⊂ ${c.long}`);
if (collisions.length > 40) console.log(`    … ${collisions.length - 40} more`);

type Row = { name: string; hits: number[]; reachable: boolean; routes: string[]; layoutOnly: boolean };
const rows: Row[] = [];
for (let i = 0; i < componentFiles.length; i++) {
  const f = componentFiles[i]!;
  const name = names[i]!;
  const roots = reachedByPages.get(f);
  const lroots = reachedByLayouts.get(f);
  rows.push({
    name,
    hits: hitLines(name),
    reachable: !!roots && roots.size > 0,
    routes: roots ? [...roots].map(routeOf).sort() : [],
    layoutOnly: (!roots || roots.size === 0) && !!lroots && lroots.size > 0,
  });
}

const zero = rows.filter((r) => r.hits.length === 0);
const zeroReachable = zero.filter((r) => r.reachable);
const zeroOrphan = zero.filter((r) => !r.reachable);
const zeroLayoutOnly = zeroOrphan.filter((r) => r.layoutOnly);

console.log("\n  COUNTS");
console.log(`    components total ......................... ${pad(rows.length, 4)}`);
console.log(`    zero SKILL hits .......................... ${pad(zero.length, 4)}`);
console.log(`      · reachable from an app/**/page.tsx .... ${pad(zeroReachable.length, 4)}   <- coverage work`);
console.log(`      · NOT reachable (display orphans) ...... ${pad(zeroOrphan.length, 4)}   <- orphan work, a different defect`);
console.log(`        (of which reachable only via layout) . ${pad(zeroLayoutOnly.length, 4)}`);
console.log(`    covered (>=1 hit) ........................ ${pad(rows.length - zero.length, 4)}`);
console.log(`      · of those, name collides w/ a longer .. ${pad(rows.filter((r) => r.hits.length > 0 && collidingShort.has(r.name)).length, 4)}   <- hits must be READ, not counted`);

console.log("\n  ZERO-HIT AND REACHABLE — in full, with routes (NOT classified here: deciding");
console.log("  what owes a passage needs criteria written before the list is read)");
if (zeroReachable.length === 0) console.log("    (none)");
for (const r of zeroReachable.sort((a, b) => a.name.localeCompare(b.name)))
  console.log(`    ${r.name.padEnd(34)} ${r.routes.slice(0, 6).join(" ")}${r.routes.length > 6 ? ` +${r.routes.length - 6}` : ""}`);

console.log("\n  ZERO-HIT AND NOT REACHABLE (display-orphan candidates, not coverage)");
if (zeroOrphan.length === 0) console.log("    (none)");
for (const r of zeroOrphan.sort((a, b) => a.name.localeCompare(b.name)))
  console.log(`    ${r.name}${r.layoutOnly ? "   (reached via layout only)" : ""}`);

// THE INVERSE READING, and it is the one closest to this probe's purpose.
// The split above only applies to zero-hit components, so a component that IS
// documented but no longer renders never appears in it — SKILL describing a
// surface that is gone is the same drift class as SKILL describing a superseded
// version of one. `DashboardTopicTreemap` is exactly this: heavily documented,
// zero value-importers. Not a coverage gap; a documentation-of-the-dead gap.
const coveredOrphans = rows.filter((r) => r.hits.length > 0 && !r.reachable);
console.log(`\n  COVERED BUT NOT REACHABLE — SKILL documents it, nothing renders it: ${coveredOrphans.length}`);
for (const r of coveredOrphans.sort((a, b) => a.name.localeCompare(b.name)))
  console.log(`    ${r.name.padEnd(34)} ${r.hits.length} hit(s) @ ${r.hits.slice(0, 8).join(",")}${r.hits.length > 8 ? "…" : ""}`);

// routes
const routeRows = pageRoots
  .map((f) => ({ route: routeOf(f), hits: hitLines(routeOf(f)) }))
  .sort((a, b) => a.route.localeCompare(b.route));
const zeroRoutes = routeRows.filter((r) => r.hits.length === 0);
console.log(`\n  ROUTES with zero SKILL hits: ${zeroRoutes.length} of ${routeRows.length}`);
for (const r of zeroRoutes) console.log(`    ${r.route}`);

// ────────────────────────────────────────────────────────────────────────────
// M2 — figures structurally exposed to going stale.
// NOTHING IS RE-MEASURED. Re-measuring turns a bounded classification into an
// unbounded audit.
// ────────────────────────────────────────────────────────────────────────────
const MEASURE = /(\d{1,3}(?:,\d{3})+|\d+\.\d+\s*%?|\d+\s*%|\b\d+(?:\.\d+)?\s*(?:ms|s|B|KB|MB|GB|bytes|rows|px)\b)/g;
const DATED = /(\b\d{4}-\d{2}-\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b|\bHO\s?\d{2,4}\b)/;

// A HANDOFF SUB-NUMBER IS NOT A MEASUREMENT. `HO 112.2` / `HO 154.1` / `HO 93.5`
// match a bare decimal pattern and are identifiers, not figures — left in, they
// manufactured ~14 false residue lines on the first run. This is the same
// too-loose-pattern failure the probe exists to catch, and it appeared in the
// probe. Drop any token whose immediately preceding text is `HO ` or `handoff `.
function measurementTokens(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(MEASURE)) {
    const tok = (m[0] ?? "").trim();
    const before = line.slice(Math.max(0, (m.index ?? 0) - 9), m.index ?? 0);
    if (/\b(?:HO|handoff)\s*$/i.test(before)) continue;
    out.push(tok);
  }
  return [...new Set(out)];
}

type M2Row = { line: number; tokens: string[]; homed: string[]; text: string };
const m2: M2Row[] = [];
for (let i = 0; i < skillLines.length; i++) {
  const l = skillLines[i];
  if (l === undefined || !DATED.test(l)) continue;
  const toks = measurementTokens(l);
  if (toks.length === 0) continue;
  const homed = toks.filter((t) => backlogText.includes(t) || odditiesText.includes(t));
  m2.push({ line: i + 1, tokens: toks, homed, text: l });
}
// Class 1 = every measurement token on the line also lives in backlog/oddities
// (SKILL should point, not carry). Class 2 vs 3 is a JUDGMENT the script does
// not make — it emits the residue for a human read, which is what keeps the
// criteria from being fitted to the output.
const class1 = m2.filter((r) => r.homed.length === r.tokens.length);
const residue = m2.filter((r) => r.homed.length !== r.tokens.length);

console.log("\n" + rule());
console.log("  M2 — dated/HO-tagged lines carrying a measurement");
console.log(rule());
console.log(`    candidate lines .......................... ${pad(m2.length, 4)}`);
console.log(`    CLASS 1 (every token has a canonical home) ${pad(class1.length, 4)}   <- priced: replace with a pointer`);
console.log(`    residue for class 2/3 judgment ........... ${pad(residue.length, 4)}   <- read below`);
console.log("\n  RESIDUE (line · un-homed tokens · text head) — classify 2 vs 3 by reading:");
for (const r of residue) {
  const un = r.tokens.filter((t) => !r.homed.includes(t));
  console.log(`    ${pad(r.line, 5)}  [${un.join(" | ")}]`);
  console.log(`           ${r.text.trim().slice(0, 150)}`);
}

// ────────────────────────────────────────────────────────────────────────────
// M3 — the roadmap gap
// ────────────────────────────────────────────────────────────────────────────
console.log("\n" + rule());
console.log("  M3 — HO numbers in commit subjects vs docs/roadmap.md");
console.log(rule());
let subjects: string[] = [];
try {
  subjects = execFileSync("git", ["log", "--format=%s"], { cwd: ROOT, encoding: "utf8" }).split("\n");
} catch {
  console.log("    git log unavailable");
}
const inCommits = new Map<number, string>();
for (const s of subjects) {
  const m = s.match(/\bHO\s?(\d{2,4})\b/);
  if (!m) continue;
  const n = Number(m[1]);
  if (!inCommits.has(n)) inCommits.set(n, s);
}
const inRoadmap = new Set<number>();
for (const m of roadmapText.matchAll(/\bHO\s?(\d{2,4})\b/g)) inRoadmap.add(Number(m[1]));

const missing = [...inCommits.keys()].filter((n) => !inRoadmap.has(n)).sort((a, b) => a - b);
const maxCommit = Math.max(...inCommits.keys());
const maxRoadmap = Math.max(...inRoadmap);
const alsoBlocks = (roadmapText.match(/^\*\*Also \(HO/gm) ?? []).length;

// THE RAW COUNT IS AN UPPER BOUND, NOT A FINDING, and saying so is the point.
// This subtraction assumes the roadmap is a PER-HO INDEX. It is not: it carries
// themes plus `Also (HO N)` blocks, so an HO covered by theme prose without a
// numeric tag reads as "missing" here while being perfectly well recorded. A
// bare 204 would be exactly the tidy-looking number that survives until someone
// measures it. Bucketed instead, so the era where the per-HO ledger convention
// actually holds can be read on its own.
console.log(`    highest HO in commit subjects ............ ${maxCommit}`);
console.log(`    highest HO in roadmap .................... ${maxRoadmap}`);
console.log(`    roadmap 'Also (HO N)' blocks ............. ${alsoBlocks}`);
console.log(`    distinct HO tokens: roadmap ${inRoadmap.size} · commits ${inCommits.size}`);
console.log(`    RAW missing (upper bound, see caveat) .... ${missing.length}`);
const buckets: Array<[string, number, number]> = [
  ["< 300", 0, 299],
  ["300-499", 300, 499],
  ["500-599", 500, 599],
  [">= 600", 600, 9999],
];
for (const [label, lo, hi] of buckets) {
  const inB = missing.filter((n) => n >= lo && n <= hi);
  console.log(`      ${label.padEnd(9)} ${pad(inB.length, 4)}${inB.length && lo >= 500 ? "   " + inB.join(", ") : ""}`);
}
const modern = missing.filter((n) => n >= 500);
console.log(
  `\n    READ THIS ONE: within the era the per-HO ledger convention actually holds\n` +
    `    (HO >= 500), missing = ${modern.length} — ${modern.length ? modern.join(", ") : "none"}.\n` +
    `    Everything below that is pre-convention or theme-covered, and the raw count\n` +
    `    should NOT be reported as ${missing.length} deferred sweeps.`,
);
console.log("\n    full raw list (for audit, not for the headline):");
for (const n of missing) console.log(`      HO ${n}  ${(inCommits.get(n) ?? "").slice(0, 100)}`);
console.log(
  `\n    NEXT HO = max(roadmap ${maxRoadmap}, commits ${maxCommit}) + 1 = ${Math.max(maxCommit, maxRoadmap) + 1}` +
    "\n    The roadmap is authoritative only while it is CURRENT, and it is current only\n" +
    "    after a sweep — so a deferred sweep degrades the one instrument that was\n" +
    "    supposed to be safe against on-disk filenames.",
);

console.log("\n" + rule());
console.log("  LIMITS — covered != correct (a superseded passage passes M1); reachability is");
console.log("  FILE-level (an intra-file dead branch is invisible); layout-only reach is split out.");
console.log(rule() + "\n");
