// HO 836 § 2 Leg A, the race pool: the BUILT getMostCompetitiveRaces against HO 835's shape.
//
// HO 835's proof (race-pool-batch-835.ts) compared the shipped loop with a batched copy of it in
// one process. After HO 836 the shipped reader IS the batched one, so that comparison would read
// the build against itself. This proof reads the two readers from two trees instead:
//   - the base: the loop at 9b457fa, run from a worktree of the base (this file copied into it, so
//     `../../lib/queries` is the base's), with claim 10's tiebreak (`rowid ASC` on an updated_at tie)
//     applied to each race's ratings. Any race the tiebreak reorders is named in the output, not
//     hidden;
//   - the tip: the built reader, run from the build's tree.
// Each side writes its result for (2026, 30) and (2026, 12) to a JSON file, with the guard's count of
// its store requests, statements and serial waves. `--compare` then deep-equals (node:util
// isDeepStrictEqual) and byte-equals (the JSON text, which also holds key order) the tip against the
// base, and two base runs against each other (the drift control: the store didn't move between the
// runs). Its own controls: the tip's result unmutated must PASS; one mutated field (a rating's
// `rating`) must FAIL both checks; one reordered key must FAIL the byte check and PASS the deep one.
//
// --emit is read-only. Every store request goes through home-cold-plan-835-preload.cjs (HO 824's read
// rules: each statement a read, read-only batches only, executeMultiple refused; five controls at
// load). It refuses to run without this process's preload line or without the next/cache stub (the
// readers run uncached), and fails if the guard refused anything. --compare reads only the JSON files.
//
//   set -a; . ./.env; set +a; HOME_PROBE_LOG=<repo>/docs/handoffs/836-artifacts/leg-a-guard.jsonl \
//     node --require <repo>/scripts/diagnostic/home-cold-plan-835-preload.cjs --import tsx \
//       --import <repo>/scripts/diagnostic/next-cache-stub-754.mjs \
//       scripts/diagnostic/race-pool-836.ts --emit <out.json> --side base|tip
//   (from the base worktree for --side base, from the build's tree for --side tip)
//   node --import tsx scripts/diagnostic/race-pool-836.ts --compare <tip.json> <base1.json> <base2.json>
// Exit: 0 PASS; 3 a FAIL; 2 a refusal or a failed control.
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";

type Rating = { id: string; updatedAt: string; rating: string; [k: string]: unknown };
type Race = { raceId: string; ratings: Rating[]; [k: string]: unknown };
type Side = {
  side: string;
  sha: string;
  libDirty: number;
  at: string;
  results: Record<string, { text: string; tieReorders: string[]; stats: { requests: number; statements: number; waves: number; sql: string[] } }>;
};
const ARGS: [number, number][] = [[2026, 30], [2026, 12]];
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

if (argv.includes("--compare")) {
  const [tipF, b1F, b2F] = argv.slice(argv.indexOf("--compare") + 1);
  if (!tipF || !b1F || !b2F) { console.log("usage: --compare <tip.json> <base1.json> <base2.json>"); process.exit(2); }
  const load = (f: string) => JSON.parse(readFileSync(f, "utf8")) as Side;
  const tip = load(tipF), b1 = load(b1F), b2 = load(b2F);
  console.log(`tip ${tip.sha.slice(0, 7)} (${tip.side}, lib dirty ${tip.libDirty}) at ${tip.at}; base ${b1.sha.slice(0, 7)} at ${b1.at} and ${b2.sha.slice(0, 7)} at ${b2.at}`);
  if (tip.side !== "tip" || b1.side !== "base" || b2.side !== "base") { console.log("STOP: the files' sides aren't tip, base, base"); process.exit(2); }
  const diffs = (a: unknown, b: unknown, path: string, out: string[]) => {
    if (isDeepStrictEqual(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) out.push(`${path}.length: ${a.length} | ${b.length}`);
      for (let i = 0; i < Math.max(a.length, b.length); i++) diffs(a[i], b[i], `${path}[${i}]`, out);
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffs((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
      return;
    }
    out.push(`${path}: ${JSON.stringify(a)} | ${JSON.stringify(b)}`);
  };
  const judge = (label: string, aText: string, bText: string) => {
    const deep = isDeepStrictEqual(JSON.parse(aText), JSON.parse(bText));
    const bytes = aText === bText;
    const out: string[] = [];
    if (!deep) diffs(JSON.parse(aText), JSON.parse(bText), "$", out);
    return { label, deep, bytes, pass: deep && bytes, out };
  };
  let fail = false;
  // Controls first: the comparator must see a mutated field and a reordered key.
  const t30 = tip.results["2026,30"]!.text;
  const parsed = JSON.parse(t30) as Race[];
  const c0 = judge("control: the tip unmutated vs itself", JSON.stringify(parsed), t30);
  const mut = structuredClone(parsed);
  mut[0]!.ratings[0]!.rating = mut[0]!.ratings[0]!.rating + "x";
  const c1 = judge("control: one mutated field (race 0, rating 0's `rating`)", JSON.stringify(mut), t30);
  const reorder = structuredClone(parsed);
  const { raceId, ...rest } = reorder[0]!;
  reorder[0] = { ...rest, raceId } as Race;
  const c2 = judge("control: race 0's raceId key moved last", JSON.stringify(reorder), t30);
  const controlsOk = c0.pass && !c1.deep && !c1.bytes && c2.deep && !c2.bytes;
  console.log(`controls: unmutated deep ${c0.deep} bytes ${c0.bytes} (want true, true); mutated deep ${c1.deep} bytes ${c1.bytes} (want false, false); key moved deep ${c2.deep} bytes ${c2.bytes} (want true, false) → ${controlsOk ? "OK" : "FAILED"}`);
  if (!controlsOk) process.exit(2);
  for (const [c, l] of ARGS) {
    const k = `${c},${l}`;
    const drift = judge(`base vs base (${k})`, b1.results[k]!.text, b2.results[k]!.text);
    const main = judge(`tip vs base (${k})`, tip.results[k]!.text, b1.results[k]!.text);
    for (const r of [drift, main]) {
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.label}: deep ${r.deep}, bytes ${r.bytes}${r.out.length ? "\n      " + r.out.slice(0, 20).join("\n      ") : ""}`);
      if (!r.pass) fail = true;
    }
    console.log(`      races ${(JSON.parse(tip.results[k]!.text) as Race[]).length}; base tie reorders (claim 10's tiebreak applied): ${b1.results[k]!.tieReorders.length ? b1.results[k]!.tieReorders.join("; ") : "none"}`);
    for (const [name, s] of [["base", b1], ["tip", tip]] as const) {
      const st = s.results[k]!.stats;
      console.log(`      ${name}: ${st.requests} store requests, ${st.statements} statements, ${st.waves} serial waves`);
    }
  }
  console.log(`\ntip statements for (2026, 30), in full:\n  ${tip.results["2026,30"]!.stats.sql.join("\n  ")}`);
  console.log(fail ? "\nRESULT: FAIL" : "\nRESULT: PASS");
  process.exit(fail ? 3 : 0);
}

// ── --emit ────────────────────────────────────────────────────────────────────────────────────
const out = flag("--emit");
const side = flag("--side");
if (!out || (side !== "base" && side !== "tip")) { console.log("usage: --emit <out.json> --side base|tip"); process.exit(2); }
const LOG = process.env.HOME_PROBE_LOG ?? "";
if (!LOG) { console.log("refused: HOME_PROBE_LOG is not set, so the read-only guard isn't loaded"); process.exit(2); }
type LogLine = { kind: string; t: string; pid?: number; n?: number; ms?: number; sql?: string[] };
const logLines = (): LogLine[] => readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LogLine);
const startedAt = Date.now() - process.uptime() * 1000 - 1000;
if (!logLines().some((l) => l.kind === "preload" && l.pid === process.pid && Date.parse(l.t) >= startedAt)) {
  console.log(`refused: the guard's log has no preload line for this process (pid ${process.pid})`); process.exit(2);
}
const { unstable_cache } = await import("next/cache");
{
  const probe = () => 0;
  if ((unstable_cache as unknown as (f: unknown, k?: unknown, o?: unknown) => unknown)(probe, ["x"], {}) !== probe) {
    console.log("refused: next/cache isn't the stub (the reader would be cached)"); process.exit(2);
  }
}
const { getDb } = await import("../../lib/db");
const { getMostCompetitiveRaces } = await import("../../lib/queries");
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
const sha = git("rev-parse", "HEAD");
const libDirty = git("status", "--porcelain", "--", "lib", "components", "app").split("\n").filter(Boolean).length;

// Serial waves: a request that starts after every request before it has ended opens a new wave.
function stats(lines: LogLine[]) {
  const st = lines.filter((l) => l.kind === "store").map((l) => ({ t0: Date.parse(l.t), t1: Date.parse(l.t) + (l.ms ?? 0), n: l.n ?? 0, sql: l.sql ?? [] })).sort((a, b) => a.t0 - b.t0);
  let waves = 0, end = -Infinity;
  for (const r of st) { if (r.t0 >= end) waves++; end = Math.max(end, r.t1); }
  return { requests: st.length, statements: st.reduce((s, r) => s + r.n, 0), waves, sql: st.flatMap((r) => r.sql) };
}

const side_: Side = { side, sha, libDirty, at: new Date().toISOString(), results: {} };
for (const [c, l] of ARGS) {
  const m0 = logLines().length;
  const result = (await getMostCompetitiveRaces(c, l)) as unknown as Race[];
  const st = stats(logLines().slice(m0));
  const tieReorders: string[] = [];
  if (side === "base") {
    // Claim 10's tiebreak applied to the base's per-race order: rowid ASC within an updated_at tie.
    const ids = result.flatMap((r) => r.ratings.map((x) => x.id));
    const rowid = new Map<string, number>();
    if (ids.length) {
      const rs = await getDb().execute({ sql: `SELECT id, rowid AS rr FROM race_ratings WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids });
      for (const r of rs.rows) rowid.set(String(r.id), Number(r.rr));
    }
    for (const race of result) {
      const before = race.ratings.map((x) => x.id).join(",");
      race.ratings = [...race.ratings].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : rowid.get(a.id)! - rowid.get(b.id)!));
      const after = race.ratings.map((x) => x.id).join(",");
      if (before !== after) tieReorders.push(`${race.raceId}: ${before} -> ${after}`);
    }
  }
  side_.results[`${c},${l}`] = { text: JSON.stringify(result), tieReorders, stats: st };
  console.log(`${side} ${sha.slice(0, 7)} (${c}, ${l}): ${result.length} races, ${result.reduce((s, r) => s + r.ratings.length, 0)} ratings; ${st.requests} store requests, ${st.statements} statements, ${st.waves} serial waves; tie reorders ${tieReorders.length}`);
}
const mine = logLines().filter((l) => Date.parse(l.t) >= startedAt);
const refused = mine.filter((l) => l.kind === "refused").length;
writeFileSync(out, JSON.stringify(side_, null, 1));
console.log(`wrote ${out}; guard refusals in this run: ${refused}`);
process.exit(refused ? 2 : 0);
