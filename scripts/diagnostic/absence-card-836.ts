// HO 836 § 2 Leg A, the absence band: the BUILT band (C2's card read and C8's chambers together)
// against the base's, every member's card included.
//
// Two trees, as in race-pool-836.ts:
//   - the base: queryAbsenceWatch at 9b457fa (the chamber loop, then getMemberCardExpansion per
//     member, projected), run from a worktree of the base with this file copied into it;
//   - the tip: the built band (both chambers together, then readAbsenceCards' three SELECTs).
// Each side writes getAbsenceWatch()'s whole result ({ members, window }, every member's card) to a
// JSON file, with the guard's count of its store requests, statements and serial waves. The base
// side also reads, per member, which bills the bills tiebreak the tip's card read carries would put
// first (`is_ceremonial, stage, congress, rowid` after the date, as ruled in 836-ff-go.md); a tie it
// would reorder is named, not hidden.
// `--compare` deep-equals (node:util isDeepStrictEqual) and byte-equals (the JSON text, which holds key
// order) the tip against the base, and two base runs against each other (the drift control). Its own
// controls: the tip unmutated must PASS; one mutated field (a member's card.stats.total) must FAIL
// both; a null card (the per-band degradation's shape) must FAIL both; one reordered key must FAIL the
// byte check and PASS the deep one.
//
// --emit is read-only, under home-cold-plan-835-preload.cjs (HO 824's read rules, five controls at
// load) and the next/cache stub; it refuses without either and fails on any guard refusal.
//   set -a; . ./.env; set +a; HOME_PROBE_LOG=<repo>/docs/handoffs/836-artifacts/leg-a-guard.jsonl \
//     node --require <repo>/scripts/diagnostic/home-cold-plan-835-preload.cjs --import tsx \
//       --import <repo>/scripts/diagnostic/next-cache-stub-754.mjs \
//       scripts/diagnostic/absence-card-836.ts --emit <out.json> --side base|tip
//   node --import tsx scripts/diagnostic/absence-card-836.ts --compare <tip.json> <base1.json> <base2.json>
// Exit: 0 PASS; 3 a FAIL; 2 a refusal, a failed control, or a band read that threw (window null).
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";

type Card = { stats: { total: number }; recentBills: { bill_type: string; bill_number: number }[]; committees: { name: string }[] };
type Member = { bioguideId: string; name: string; card: Card | null; [k: string]: unknown };
type Watch = { members: Member[]; window: { house: string | null; senate: string | null } | null };
type Side = {
  side: string;
  sha: string;
  libDirty: number;
  at: string;
  text: string;
  tieNotes: string[];
  stats: { requests: number; statements: number; waves: number; sql: string[] };
};
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
  const judge = (aText: string, bText: string) => {
    const deep = isDeepStrictEqual(JSON.parse(aText), JSON.parse(bText));
    const bytes = aText === bText;
    const out: string[] = [];
    if (!deep) diffs(JSON.parse(aText), JSON.parse(bText), "$", out);
    return { deep, bytes, pass: deep && bytes, out };
  };
  const parsed = JSON.parse(tip.text) as Watch;
  const withCard = parsed.members.findIndex((m) => m.card !== null);
  if (withCard < 0) { console.log("STOP: no tip member has a card, so the controls can't be planted"); process.exit(2); }
  const c0 = judge(JSON.stringify(parsed), tip.text);
  const mut = structuredClone(parsed);
  mut.members[withCard]!.card!.stats.total += 1;
  const c1 = judge(JSON.stringify(mut), tip.text);
  const nul = structuredClone(parsed);
  nul.members[withCard]!.card = null;
  const c2 = judge(JSON.stringify(nul), tip.text);
  const reorder = structuredClone(parsed);
  const { bioguideId, ...rest } = reorder.members[withCard]!;
  reorder.members[withCard] = { ...rest, bioguideId } as Member;
  const c3 = judge(JSON.stringify(reorder), tip.text);
  const ok = c0.pass && !c1.deep && !c1.bytes && !c2.deep && !c2.bytes && c3.deep && !c3.bytes;
  console.log(`controls (member ${withCard}): unmutated deep ${c0.deep} bytes ${c0.bytes} (want true, true); stats.total + 1 deep ${c1.deep} bytes ${c1.bytes} (want false, false); card null deep ${c2.deep} bytes ${c2.bytes} (want false, false); bioguideId key moved last deep ${c3.deep} bytes ${c3.bytes} (want true, false) → ${ok ? "OK" : "FAILED"}`);
  if (!ok) process.exit(2);
  let fail = false;
  for (const [label, a, b] of [["base vs base", b1.text, b2.text], ["tip vs base", tip.text, b1.text]] as const) {
    const r = judge(a, b);
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${label}: deep ${r.deep}, bytes ${r.bytes}${r.out.length ? "\n      " + r.out.slice(0, 30).join("\n      ") : ""}`);
    if (!r.pass) fail = true;
  }
  const w = parsed;
  console.log(`      members ${w.members.length} (cards ${w.members.filter((m) => m.card).length}, null cards ${w.members.filter((m) => !m.card).length}); window house ${w.window?.house}, senate ${w.window?.senate}`);
  console.log(`      base tie notes (the tip's bills tiebreak against the base's first ${3}): ${b1.tieNotes.length ? b1.tieNotes.join("; ") : "none"}`);
  for (const [name, s] of [["base", b1], ["tip", tip]] as const) console.log(`      ${name}: ${s.stats.requests} store requests, ${s.stats.statements} statements, ${s.stats.waves} serial waves`);
  console.log(`\ntip statements, in full:\n  ${tip.stats.sql.join("\n  ")}`);
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
    console.log("refused: next/cache isn't the stub (the band would be cached)"); process.exit(2);
  }
}
const { getDb } = await import("../../lib/db");
const { getAbsenceWatch, ABSENCE_BACK_BILLS_CAP } = await import("../../lib/queries");
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
const sha = git("rev-parse", "HEAD");
const libDirty = git("status", "--porcelain", "--", "lib", "components", "app").split("\n").filter(Boolean).length;
function stats(lines: LogLine[]) {
  const st = lines.filter((l) => l.kind === "store").map((l) => ({ t0: Date.parse(l.t), t1: Date.parse(l.t) + (l.ms ?? 0), n: l.n ?? 0, sql: l.sql ?? [] })).sort((a, b) => a.t0 - b.t0);
  let waves = 0, end = -Infinity;
  for (const r of st) { if (r.t0 >= end) waves++; end = Math.max(end, r.t1); }
  return { requests: st.length, statements: st.reduce((s, r) => s + r.n, 0), waves, sql: st.flatMap((r) => r.sql) };
}

const m0 = logLines().length;
const watch = (await getAbsenceWatch()) as unknown as Watch;
const st = stats(logLines().slice(m0));
if (watch.window === null) { console.log("STOP: getAbsenceWatch returned window: null (its read threw)"); process.exit(2); }
const tieNotes: string[] = [];
if (side === "base") {
  // The tip's bills tiebreak against the base's card: which first CAP bills it would pick per member.
  for (const m of watch.members) {
    if (!m.card) continue;
    const rs = await getDb().execute({
      sql: `SELECT bill_type, bill_number FROM bills INDEXED BY idx_bills_sponsor_agg
             WHERE sponsor_bioguide_id = ? AND summary IS NOT NULL AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
             ORDER BY latest_action_date DESC NULLS LAST, is_ceremonial ASC, stage ASC, congress ASC, rowid ASC LIMIT ?`,
      args: [m.bioguideId, ABSENCE_BACK_BILLS_CAP],
    });
    const want = rs.rows.map((r) => `${r.bill_type}-${r.bill_number}`).join(",");
    const have = m.card.recentBills.map((b) => `${b.bill_type}-${b.bill_number}`).join(",");
    if (want !== have) tieNotes.push(`${m.bioguideId}: base ${have} | the tiebreak ${want}`);
  }
}
const side_: Side = { side, sha, libDirty, at: new Date().toISOString(), text: JSON.stringify(watch), tieNotes, stats: st };
writeFileSync(out, JSON.stringify(side_, null, 1));
const refused = logLines().filter((l) => Date.parse(l.t) >= startedAt && l.kind === "refused").length;
console.log(`${side} ${sha.slice(0, 7)}: ${watch.members.length} members (${watch.members.filter((m) => m.card).length} with cards); ${st.requests} store requests, ${st.statements} statements, ${st.waves} serial waves; tie notes ${tieNotes.length}; wrote ${out}; guard refusals ${refused}`);
process.exit(refused ? 2 : 0);
