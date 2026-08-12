// HO 651 — enumerate what SKILL NAMES that does not EXIST.
// Read-only. BUILDS NOTHING, WRITES NOTHING. Filesystem only.
//
//   npx tsx scripts/diagnostic/skill-phantoms-651.ts
//   PHANTOM_NAIVE=1 npx tsx …   <- falsification mode, see CONTROL 1
//
// The third direction, after HO 649's two. That probe measured
// exists-and-undocumented (M1) and documented-and-unreachable (its inverse), and
// BOTH start from a file that exists. A passage describing something already
// deleted from disk is invisible to both by construction — there is no file to
// look up — which is how `DistributionsTabs` survived being named 4x in SKILL
// with no file in the tree, including on the very line HO 650 was correcting.
//
// ── EXISTENCE MEANS A DEFINITION, NEVER A MENTION ───────────────────────────
// This is the design constraint, and it comes from a filter that failed during
// scoping. A string-presence test over repo source CLEARS `DistributionsTabs`,
// because its only occurrence anywhere is `app/globals.css:1563` — inside a
// COMMENT, describing the deleted treemap's pane. One stale artifact vouches for
// another, and the check reads two pieces of drift as one live component. So a
// name exists here only if it has a FILE or an EXPORT. Presence is reported as a
// separate column (paired-drift), never as an exclusion.
//
// ── THE `ls a b` PRECEDENT, and why this file tests paths separately ─────────
// Scoping's first definition-filter pass returned 145 and flagged `MarketsTape`,
// `HeaderBar` and `WeeklyBand` as nonexistent. The bug: `ls a b` exits non-zero
// when EITHER path is missing, so the file test never fired and everything fell
// through to the export regex. Caught by adding a control, not by reading the
// list. Third consecutive HO in which an identifier-matching check was wrong on
// first write — and that one was in the handoff for the probe designed against
// that class. Every path below is stat'd on its own; CONTROL 3 is the regression.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const ROOT = process.cwd();
const SKILL_PATH = join(ROOT, ".claude", "skills", "cbt", "SKILL.md");
const skill = readFileSync(SKILL_PATH, "utf8").split(/\r?\n/);
const NAIVE = process.env.PHANTOM_NAIVE === "1";
const NAIVE_WINDOW = 200;
const pad = (v: string | number, n: number) => String(v).padStart(n);
const rule = (n = 92) => "  " + "-".repeat(n);

// ────────────────────────────────────────────────────────────────────────────
// universe — every backtick-quoted identifier SKILL names
//
// DEVIATION FROM THE HANDOFF, STATED RATHER THAN ABSORBED: §1 reports 286
// backtick-quoted PascalCase identifiers on this same commit. That number is not
// reproducible from its description — the rule below yields 401, of which 9 are
// one- or two-character tokens (`R` `D` `I` `S` `H` `P` `K` `IN` `HR`: party
// letters, chamber letters, a SQL keyword, a bill type) that no component rule
// would keep. Dropping those gives the 392 used here. §1's own noise list
// (EXPLAIN, HAVING, BREAKING, CPIAUCSL) shows all-caps tokens were inside its
// 286, so the gap is not an all-caps filter either. A larger universe is the
// safe direction for an enumeration — it can only add candidates to read, never
// hide one — so this runs wide and reports the delta.
// ────────────────────────────────────────────────────────────────────────────
type Mention = { line: number; col: number; text: string };
const mentions = new Map<string, Mention[]>();
for (let i = 0; i < skill.length; i++) {
  const l = skill[i];
  if (l === undefined) continue;
  for (const m of l.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)) {
    const name = m[1];
    if (name === undefined) continue;
    if (name.length < 3) continue;
    if (!/^[A-Z]/.test(name)) continue;
    let arr = mentions.get(name);
    if (!arr) {
      arr = [];
      mentions.set(name, arr);
    }
    arr.push({ line: i + 1, col: m.index ?? 0, text: l });
  }
}
const universe = [...mentions.keys()].sort();

// ────────────────────────────────────────────────────────────────────────────
// definition index — files, and exported names
// ────────────────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next") continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const SRC_DIRS = ["app", "components", "lib", "scripts"].map((d) => join(ROOT, d));
const srcFiles = SRC_DIRS.flatMap((d) => walk(d));
const codeFiles = srcFiles.filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f));

function fileExists(p: string): boolean {
  // stat'd ALONE. See the `ls a b` precedent in the header.
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

const exported = new Set<string>();
for (const f of codeFiles) {
  let src: string;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const m of src.matchAll(
    /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  ))
    if (m[1]) exported.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const piece of (m[1] ?? "").split(",")) {
      const t = piece.trim();
      if (!t) continue;
      const parts = t.replace(/^type\s+/, "").split(/\s+as\s+/);
      for (const p of parts) if (/^[A-Za-z_$][\w$]*$/.test(p.trim())) exported.add(p.trim());
    }
  }
}

// token presence across ALL source file types (css included — globals.css is the
// known vouching artifact). One tokenizing pass, then O(1) lookup.
const firstToken = new Map<string, { file: string; line: number }>();
for (const f of srcFiles) {
  // SELF-EXCLUSION, and it is not pedantry: this file NAMES components in its own
  // comments (DashboardBubbleChart, DistributionsTabs, MarketsTape…), so without
  // it the probe VOUCHES FOR THE VERY PHANTOMS IT IS ENUMERATING — the same
  // one-artifact-vouches-for-another shape that made the tight string filter
  // wrong, re-entered through the instrument. Measured: 1 candidate
  // (`DashboardBubbleChart`) was vouched solely by this file before the exclusion.
  if (f.endsWith("skill-phantoms-651.ts")) continue;
  if (!/\.(ts|tsx|js|mjs|cjs|css|json)$/.test(f)) continue;
  let src: string;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const rel = f.slice(ROOT.length + 1).split(sep).join("/");
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    for (const m of line.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const t = m[0];
      if (!firstToken.has(t)) firstToken.set(t, { file: rel, line: i + 1 });
    }
  }
}

type Row = {
  name: string;
  hasFile: boolean;
  hasExport: boolean;
  pairedDrift: boolean;
  voucher: { file: string; line: number } | null;
};
const rows: Row[] = universe.map((name) => {
  const hasFile =
    fileExists(join(ROOT, "components", `${name}.tsx`)) ||
    fileExists(join(ROOT, "components", "svg", `${name}.tsx`));
  const hasExport = exported.has(name);
  const voucher = firstToken.get(name) ?? null;
  return { name, hasFile, hasExport, pairedDrift: !hasFile && !hasExport && !!voucher, voucher };
});
const candidates = rows.filter((r) => !r.hasFile && !r.hasExport);

// ────────────────────────────────────────────────────────────────────────────
// M2 — classification is PER MENTION, not per name. A name can be RECORD at one
// line and PHANTOM at another; `DashboardTopicTreemap` was exactly that before
// HO 650 — correctly recorded as replaced at one site, listed as a live island
// at three others.
// ────────────────────────────────────────────────────────────────────────────
// `replac(ed|es|ing)` IS a deletion marker, and its absence was a REAL BUG that
// CONTROL 2 caught: §3 lists it, this regex omitted it, so L1715's “replaced
// `DashboardBubbleChart`” had no marker in its own scope and read PHANTOM —
// inverting the canonical recorded deletion. The positive control exists exactly
// to catch a classifier that under-detects, and it did so before any count was
// reported. The polarity rule below keeps “replaced BY X” from marking X.
const MARKER =
  /\b(deleted|delete|deletion|removed|remove|superseded|supersedes|supersede|replaced|replaces|replacing|retired|retire|dropped|drop|deprecated|gone|orphan|orphaned|no longer exists?|unused)\b/i;

/** OWNERSHIP SCOPE — the whole point, see CONTROL 1.
 *  A mention owns the text between its neighbouring backticked tokens. Proximity
 *  does not work here: on L2043 a deletion marker about a DIFFERENT component
 *  sits four characters from a phantom, and any ±N window clears it. */
function scopeFor(text: string, col: number, nameLen: number): { before: string; after: string } {
  if (NAIVE) {
    // FALSIFICATION MODE (CONTROL 1). Naive proximity, the obvious mechanization
    // and the wrong one. WINDOW = 200 and the number is not arbitrary: on L2043
    // the marker sits 162 chars before the phantom (measured — the handoff's §4
    // says "four characters", which is the distance inside its own ELIDED quote,
    // where the ellipsis hides 145 chars of clause). A ±120 window cannot reach
    // it, so a narrower naive mode would let C1 pass for the wrong reason and
    // the control would discriminate nothing.
    return {
      before: text.slice(Math.max(0, col - NAIVE_WINDOW), col),
      after: text.slice(col + nameLen, col + nameLen + NAIVE_WINDOW),
    };
  }
  const spans = [...text.matchAll(/`[^`]*`/g)].map((m) => ({
    s: m.index ?? 0,
    e: (m.index ?? 0) + m[0].length,
  }));
  let start = 0;
  let end = text.length;
  for (const sp of spans) {
    if (sp.e <= col) start = Math.max(start, sp.e);
    if (sp.s >= col + nameLen) {
      end = Math.min(end, sp.s);
      break;
    }
  }
  return { before: text.slice(start, col), after: text.slice(col + nameLen, end) };
}

type Cls = "PHANTOM" | "RECORD" | "NOT-A-COMPONENT";
function classify(name: string, m: Mention): { cls: Cls; why: string } {
  // Mechanical vocabulary rule, NOT a hand-curated list: a React component
  // identifier is PascalCase and therefore contains a lowercase letter. Tokens
  // with none are SQL keywords, tickers, env vars, bioguide/FEC ids and UI
  // labels — §1's noise classes, all correctly present in SKILL.
  // Three MECHANICAL vocabulary rules, each emitting the rule that fired. These
  // narrow the class without hand-pruning the list: §2's point is that a list
  // already tidied to look sensible cannot be checked, so anything these do not
  // catch stays visible in the PHANTOM output rather than being quietly dropped.
  if (!/[a-z]/.test(name))
    return { cls: "NOT-A-COMPONENT", why: "no lowercase — SQL/ticker/env/id/label shape" };
  if (name.includes("_"))
    return { cls: "NOT-A-COMPONENT", why: "underscore — HTML anchor or identifier, not a component" };
  if (typeof (globalThis as unknown as Record<string, unknown>)[name] !== "undefined")
    return { cls: "NOT-A-COMPONENT", why: "resolves as a JS/DOM global at runtime" };

  const { before, after } = scopeFor(m.text, m.col - 1, name.length + 2);
  const scope = before + " ⟨" + name + "⟩ " + after;

  // POLARITY. "replaced by X" / "replaced with X" says X is the REPLACEMENT, so
  // it does not record X as deleted. Without this the classifier reads a live
  // component's introduction as its obituary.
  const replacedByThis = /\breplac(?:ed|ing|es)\s+(?:by|with)\s*$/i.test(before.trimEnd() + " ");

  const hitBefore = MARKER.exec(before);
  const hitAfter = MARKER.exec(after);
  if (replacedByThis && !hitAfter) return { cls: "PHANTOM", why: "named as a replacement (live claim)" };
  const hit = hitBefore ?? hitAfter;
  if (hit) return { cls: "RECORD", why: `marker "${hit[0]}" in own scope` };
  return { cls: "PHANTOM", why: "no deletion marker in own scope" };
}

type M2Row = { name: string; line: number; cls: Cls; why: string; excerpt: string };
const m2: M2Row[] = [];
for (const c of candidates) {
  for (const m of mentions.get(c.name) ?? []) {
    const { cls, why } = classify(c.name, m);
    const at = Math.max(0, m.col - 60);
    m2.push({ name: c.name, line: m.line, cls, why, excerpt: m.text.slice(at, m.col + 130) });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CONTROLS — all four, before any finding.
//
// CONTROL 1 ANCHORS ON A PRODUCT LINE THAT HO 652 WILL FIX (HO 610 rule, named
// at write time rather than discovered later — the C3a expiry at HO 650 is the
// precedent). When SKILL L2043's `DistributionsTabs` mention is repaired, this
// control stops testing anything and starts passing vacuously, exactly as C3a
// did when its anchor file was deleted. RE-ANCHORING COST: low, and it should be
// done in the commit that repairs the line — either point it at another PHANTOM
// from this run's list, or move it to an inline fixture string carrying the same
// shape (a deletion marker about one name sitting adjacent to a second name).
// The fixture is preferable: no product edit can expire it.
// ────────────────────────────────────────────────────────────────────────────
type Control = { name: string; expect: string; got: string; pass: boolean };
const controls: Control[] = [];
{
  // RE-ANCHORED AT HO 652, in the commit that expired it — and the expiry came
  // through a mechanism C4 did NOT anticipate, which is the whole lesson.
  //
  // C1 used to look up SKILL **line 2043**. HO 652 deleted one line 300+ lines
  // ABOVE it (the /dashboard-classic bullet), every later line shifted up by one,
  // and the control silently began testing a DIFFERENT mention of the same name —
  // one with a marker 1039 chars away, which classifies RECORD. It failed loudly
  // here, but the general form is worse: **a line-number anchor is invalidated by
  // ANY edit above it, not merely by a repair of its subject.** C4 predicted
  // expiry-on-repair and prescribed a fixture; it expired on an unrelated deletion
  // instead, which is the stronger argument for the fixture.
  //
  // The anchor is now an INLINE FIXTURE reproducing the exact shape: a deletion
  // marker about name A, an intervening backticked token that BOUNDS the ownership
  // scope, then name B carrying no marker of its own. No product edit can reach it,
  // and it still fails under PHANTOM_NAIVE=1.
  const FIX =
    "`Alpha` (the live thing; **HO 627** replaced the `Gamma` treemap with it, and the treemap file was **deleted at HO 650** after the probe found it surviving on `import type` edges alone — erased at compile time, so it read as live while rendering nowhere), `Beta` (**HO 244**, tab state — merges the two former panels)";
  const bcol = FIX.indexOf("`Beta`");
  const { cls } = classify("Beta", { line: 0, col: bcol, text: FIX });
  const near = FIX.slice(Math.max(0, bcol - NAIVE_WINDOW), bcol);
  const trapReal = MARKER.test(near);
  const dist = bcol - FIX.lastIndexOf("deleted", bcol);
  controls.push({
    name: "C1 negative · FIXTURE: marker about ANOTHER name, inside the window",
    expect: "PHANTOM, and the adjacent-marker trap demonstrably present",
    got: `${cls} · marker within ${NAIVE_WINDOW} chars: ${trapReal ? "yes" : "NO"} (nearest at ${dist})`,
    pass: cls === "PHANTOM" && trapReal,
  });
}
{
  const hits = m2.filter((r) => r.name === "DashboardBubbleChart");
  const got = hits.length ? [...new Set(hits.map((h) => h.cls))].join(",") : "not a candidate";
  controls.push({
    name: "C2 positive · DashboardBubbleChart — the canonical recorded deletion",
    expect: "RECORD at every mention",
    got: `${hits.length} mention(s): ${got}`,
    pass: hits.length > 0 && hits.every((h) => h.cls === "RECORD"),
  });
}
{
  const must = ["MarketsTape", "HeaderBar", "WeeklyBand", "TopStalls", "TopicDistributionList"];
  const leaked = must.filter((n) => candidates.some((c) => c.name === n));
  controls.push({
    name: "C3 filter · the five the broken `ls a b` test wrongly flagged",
    expect: "all excluded at M1",
    got: leaked.length ? `LEAKED: ${leaked.join(", ")}` : "all excluded",
    pass: leaked.length === 0,
  });
}
controls.push({
  // UPDATED AT HO 652. This used to read “C1's anchor is a product line HO 652
  // will repair” — true when written, false the moment C1 became a fixture. A
  // control that misdescribes itself is the same defect this probe measures.
  name: "C4 anchor · C1 is anchored to a FIXTURE, not to a product line",
  expect: "no product edit can expire C1",
  got: "inline fixture (HO 652; the line-2043 anchor expired on an unrelated deletion above it)",
  pass: true,
});

console.log("\n  HO 651 — SKILL phantom enumeration (read-only)" + (NAIVE ? "   ** PHANTOM_NAIVE=1 **" : ""));
console.log(rule());
console.log("  CONTROLS (before any finding)");
for (const c of controls)
  console.log(`    ${c.pass ? "PASS" : "**FAIL**"}  ${c.name}\n            expect ${c.expect} · got ${c.got}`);
if (controls.some((c) => !c.pass))
  console.log("\n    A FAILING CONTROL VOIDS EVERY COUNT BELOW.");

// ── M1 ──
console.log("\n" + rule());
console.log("  M1 — names SKILL uses, against definitions");
console.log(rule());
console.log(`    backticked identifiers (len>=3, initial cap) ... ${pad(universe.length, 4)}   (handoff §1 says 286 — see header)`);
console.log(`    excluded: components/<N>.tsx or svg/<N>.tsx .... ${pad(rows.filter((r) => r.hasFile).length, 4)}`);
console.log(`    excluded: exported somewhere in source ......... ${pad(rows.filter((r) => !r.hasFile && r.hasExport).length, 4)}`);
console.log(`    CANDIDATES (no file, no export) ............... ${pad(candidates.length, 4)}`);
console.log(`      · of those, PAIRED-DRIFT (token present) ..... ${pad(candidates.filter((c) => c.pairedDrift).length, 4)}   <- a tight string-presence filter would CLEAR these`);
console.log(`      · no occurrence anywhere in source ........... ${pad(candidates.filter((c) => !c.pairedDrift).length, 4)}`);

// ── M2 ──
const ph = m2.filter((r) => r.cls === "PHANTOM");
const rec = m2.filter((r) => r.cls === "RECORD");
const nac = m2.filter((r) => r.cls === "NOT-A-COMPONENT");
console.log("\n" + rule());
console.log("  M2 — per MENTION, not per name");
console.log(rule());
console.log(`    mentions of candidates ........................ ${pad(m2.length, 4)}`);
console.log(`    NOT-A-COMPONENT (vocabulary) .................. ${pad(nac.length, 4)}  over ${new Set(nac.map((r) => r.name)).size} name(s)`);
console.log(`    RECORD (states it was deleted/replaced) ....... ${pad(rec.length, 4)}  over ${new Set(rec.map((r) => r.name)).size} name(s)`);
console.log(`    PHANTOM (presented as live) ................... ${pad(ph.length, 4)}  over ${new Set(ph.map((r) => r.name)).size} name(s)   <- work`);

console.log("\n  PHANTOM MENTIONS, in full:");
if (ph.length === 0) console.log("    (none)");
for (const r of ph.sort((a, b) => a.name.localeCompare(b.name) || a.line - b.line)) {
  console.log(`\n    ${r.name}  L${r.line}   [${r.why}]`);
  console.log(`      …${r.excerpt.replace(/\s+/g, " ").trim()}…`);
}

// ── OPT-IN CORROBORATION (PHANTOM_GITCHECK=1) ──────────────────────────────
// Independent of every heuristic above: did this name EVER exist as a
// components/*.tsx that git records being DELETED? A hit means the name is a
// genuine phantom on evidence owing nothing to the marker regex, the ownership
// scope, or the vocabulary rules — the strongest signal in the run, and the one
// a reader can check by hand. Opt-in: one `git log` per phantom name.
if (process.env.PHANTOM_GITCHECK === "1") {
  console.log("");
  console.log(rule());
  console.log("  GIT CORROBORATION — phantom names with a recorded components/ deletion");
  console.log(rule());
  const gnames = [...new Set(ph.map((r) => r.name))].sort();
  let hits = 0;
  for (const n of gnames) {
    let out = "";
    try {
      out = execFileSync(
        "git",
        ["log", "--oneline", "--diff-filter=D", "--name-only", "--", `components/${n}.tsx`],
        { cwd: ROOT, encoding: "utf8" },
      );
    } catch {
      out = "";
    }
    if (out.includes(`components/${n}.tsx`)) {
      hits++;
      const firstLine = out.split(/\r?\n/)[0] ?? "";
      console.log(`    ${n.padEnd(30)} deleted in  ${firstLine.slice(0, 58)}`);
    }
  }
  console.log("");
  console.log(`    ${hits} of ${gnames.length} phantom names have a recorded components/ deletion.`);
  console.log("    The rest are either never-components (vocabulary these rules miss) or symbols");
  console.log("    that lived inside another file rather than owning one.");
}

console.log("\n" + rule());
console.log("  PAIRED-DRIFT PARTNERS — the non-SKILL artifact that vouched for each");
console.log(rule());
const pd = candidates.filter((c) => c.pairedDrift && /[a-z]/.test(c.name));
if (pd.length === 0) console.log("    (none among component-shaped names)");
for (const c of pd)
  console.log(`    ${c.name.padEnd(30)} ${c.voucher?.file}:${c.voucher?.line}`);

console.log("\n  CANDIDATE LIST IN FULL, unpruned, with survival reason:");
for (const c of candidates)
  console.log(
    `    ${c.name.padEnd(32)} ${c.pairedDrift ? "token-present" : "absent-everywhere"}` +
      `${/[a-z]/.test(c.name) ? "" : "  (no lowercase → vocabulary)"}`,
  );

console.log("\n" + rule());
console.log("  WHAT THIS CANNOT SEE");
console.log("   · SKILL ONLY. The same class in docs/*.md (backlog, oddities, roadmap) is unmeasured.");
console.log("   · A mention naming a LIVE component while describing behaviour it no longer has reads");
console.log("     clean here. That is the HO 646 absence-band passage's defect — a FOURTH direction,");
console.log("     and nobody has instrumented it.");
console.log("   · Existence is file-or-export. A component defined inline in another file, or exported");
console.log("     under an alias, would read as a phantom; the candidate list is emitted unpruned so");
console.log("     that shows up as a readable entry rather than a silent count.");
console.log(rule() + "\n");
