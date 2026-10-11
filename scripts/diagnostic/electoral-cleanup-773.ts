// HO 773: the electoral cleanup's measurements, its one scoped write, and its legs. Prod is READ through a
// SELECT-only client (a non-SELECT statement or a non-"read" batch throws before it is sent) in every mode
// but --w1 --write. The base side of each red is 889c737's own module, read with `git cat-file` into the
// gitignored scratch directory (relative imports pointed at @/lib, each such import checked unchanged since
// 889c737), so it stays 889c737's after the build.
//   node <tsx> --tsconfig tsconfig.json scripts/diagnostic/electoral-cleanup-773.ts <mode>
//   --m1             the three cards today, and the cycle's readings at 889c737, saved whole (leg D's base)
//   --m4             SC's fourteen House first rounds
//   --m2             § 1's classes, dry: findStaleTitles at 889c737 and in the tree (no fetch)
//   --m3             the rows the new lost_primary clause reads that the old one didn't
//   --m5             rung 1b over the live PAC targets, at 889c737 and in the tree; with
//                    --import ./scripts/diagnostic/next-cache-stub-757.mjs it also checks getPacIeSpending itself
//   --w1 [--write]   W1: SC's runoff dates (dry prints the statement and the rows it would touch)
//   --leg A|B|C      planted rows: the title classes, the qualifier, rung 1b
//   --leg D          the cards on prod after the writes, against M1's saved base
//   --leg E          one GET of each of the four district pages at the reader's pacing and agent, the first
//                    UNREAD ending the read; --saved reads HO 747's copies instead, with no fetch
// Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InStatement, type InArgs } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const BASE_SHA = "889c737";
const DIR = path.resolve("scripts/diagnostic/scratch/base-773"); // gitignored
const ART = path.resolve("docs/handoffs/773-artifacts"); // repo-ignored
const CYCLE = 2026;
const THREE = ["AL-01-2026", "GA-13-2026", "TN-05-2026"] as const;
const SC_IDS = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => (["D", "R"] as const).map((p) => `house-SC-0${d}-2026-${p}`));

const has = (f: string) => process.argv.includes(f);
const argAt = (f: string) => {
  const i = process.argv.indexOf(f);
  return i === -1 ? undefined : process.argv[i + 1];
};
const say = (s: string) => console.log(redactSecrets(s));
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
let fails = 0;
let passes = 0;
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [${leg}] ${label}: ${detail}`);
  if (ok) passes++;
  else fails++;
};
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 32 * 1024 * 1024 });

// ── prod ────────────────────────────────────────────────────────────────────
function prodUrl(): string {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env");
  return url;
}
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX)\b/i;
const readable = (sql: string) => /^\s*(SELECT|WITH)\b/i.test(sql) && !WRITE_WORD.test(sql);
const sqlOf = (s: InStatement) => (typeof s === "string" ? s : s.sql);
// The SELECT-only client: the modules under test take a Client and only ever read through it.
function readOnly(db: Client): Client {
  return new Proxy(db, {
    get(target, prop, recv) {
      if (prop === "execute") {
        return (stmt: InStatement) => {
          if (!readable(sqlOf(stmt))) throw new Error(`refused, prod is read-only here: ${sqlOf(stmt).slice(0, 80)}`);
          return target.execute(stmt);
        };
      }
      if (prop === "batch") {
        return (stmts: InStatement[], mode?: string) => {
          if (mode !== "read" || !stmts.every((s) => readable(sqlOf(s)))) throw new Error(`refused, prod is read-only here: a ${mode ?? "default"} batch`);
          return target.batch(stmts, "read");
        };
      }
      if (prop === "executeMultiple" || prop === "transaction" || prop === "migrate" || prop === "sync") {
        return () => {
          throw new Error(`refused, prod is read-only here: ${String(prop)}`);
        };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
const prodReader = () => readOnly(createClient({ url: prodUrl(), authToken: process.env.TURSO_AUTH_TOKEN }));
const rowsOf = async (db: Client, sql: string, args: InArgs = []) => (await db.execute({ sql, args })).rows.map((r) => ({ ...r }) as Record<string, unknown>);

// ── 889c737's modules ───────────────────────────────────────────────────────
// One module at BASE_SHA, its relative imports pointed at @/lib. Each import so pointed must be a file
// the tree carries unchanged since BASE_SHA, or the base would run against new code.
function baseFile(repoPath: string): string {
  mkdirSync(DIR, { recursive: true });
  const src = git(["cat-file", "-p", `${BASE_SHA}:${repoPath}`]);
  const deps: string[] = [];
  const out = src.replace(/from "\.\/([^"]+)"/g, (_, m: string) => {
    deps.push(`lib/${m}.ts`);
    return `from "@/lib/${m}"`;
  });
  for (const m of src.matchAll(/from "@\/lib\/([^"]+)"/g)) deps.push(`lib/${m[1]}.ts`);
  for (const d of deps) {
    const atBase = git(["rev-parse", `${BASE_SHA}:${d}`]).trim();
    const inTree = git(["hash-object", d]).trim();
    if (atBase !== inTree) throw new Error(`${repoPath} at ${BASE_SHA} imports ${d}, which the tree has changed (${atBase.slice(0, 10)} → ${inTree.slice(0, 10)})`);
  }
  const dst = path.join(DIR, path.basename(repoPath));
  writeFileSync(dst, out);
  say(`  base: ${repoPath} at ${BASE_SHA} (blob ${git(["rev-parse", `${BASE_SHA}:${repoPath}`]).trim().slice(0, 10)}) · imports unchanged: ${deps.join(", ") || "none"}`);
  return pathToFileURL(dst).href;
}
const treeBlob = (f: string) => git(["hash-object", f]).trim().slice(0, 10);

type Reading = { onOwnBallot: boolean; moved: string[]; senate: string[]; reasons: string[]; qualifier: unknown };
const readingsJson = (m: Map<string, Reading>) => Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)));
const show = (r: Reading | undefined) => (r ? `${JSON.stringify(r.qualifier)} · reasons [${r.reasons.join(", ")}] · moved [${r.moved.join(", ")}] · senate [${r.senate.join(", ")}] · onOwnBallot ${r.onOwnBallot}` : "no reading");

// ── M1 ──────────────────────────────────────────────────────────────────────
async function m1() {
  say(`=== HO 773 M1 · the three cards today · ${new Date().toISOString()} · tree ${git(["rev-parse", "--short", "HEAD"]).trim()} ===`);
  const db = prodReader();
  const races = await rowsOf(
    db,
    `SELECT r.id, r.incumbent_bioguide_id, r.incumbent_running, m.name, m.first_name, m.last_name, m.state, m.district, m.chamber, m.is_current, rd.status AS read_status
       FROM races r LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id LEFT JOIN general_ballot_reads rd ON rd.race_id = r.id
      WHERE r.id IN (?, ?, ?) ORDER BY r.id`,
    [...THREE],
  );
  for (const r of races) say(`  ${r.id}: incumbent ${r.incumbent_bioguide_id} · members.name "${r.name}" · first_name "${r.first_name}" · last_name "${r.last_name}" · ${r.chamber} ${r.state}-${r.district} · is_current ${r.is_current} · incumbent_running ${r.incumbent_running} · read ${r.read_status}`);
  const bios = races.map((r) => String(r.incumbent_bioguide_id));
  const mids = await rowsOf(db, `SELECT bioguide_id, ballotpedia_title, ballotpedia_title_resolved, ballotpedia_title_resolved_at, ballotpedia_title_resolved_from FROM member_ids WHERE bioguide_id IN (?, ?, ?)`, bios);
  for (const b of bios) {
    const m = mids.find((x) => x.bioguide_id === b);
    say(`  member_ids ${b}: ${m ? `stored ${JSON.stringify(m.ballotpedia_title)} · resolved ${JSON.stringify(m.ballotpedia_title_resolved)} (${m.ballotpedia_title_resolved_from ?? "—"}, ${m.ballotpedia_title_resolved_at ?? "—"})` : "NO ROW"}`);
  }
  const moore = races.find((r) => r.id === "AL-01-2026")!;
  say(`\n  S-AL-2026's ballot (every row; the read: ${JSON.stringify((await rowsOf(db, `SELECT status, read_at FROM general_ballot_reads WHERE race_id = 'S-AL-2026'`))[0] ?? null)}):`);
  for (const g of await rowsOf(db, `SELECT person_key, name, party, bioguide_id, on_ballot, incumbent_marked, withdrawn, write_in FROM general_ballot WHERE race_id = 'S-AL-2026' ORDER BY on_ballot DESC, name`)) {
    say(`    ${JSON.stringify(g)}`);
  }
  const prim = async (label: string, where: string, args: InArgs) => {
    say(`\n  ${label}:`);
    for (const p of await rowsOf(
      db,
      `SELECT pc.id, pc.primary_id, p.election_round, p.primary_date, pc.name, pc.person_key, pc.bioguide_id, pc.incumbent, pc.status, pc.vote_pct,
              EXISTS (SELECT 1 FROM primary_candidates w WHERE w.primary_id = pc.primary_id AND w.status = 'winner') AS decided
         FROM primary_candidates pc JOIN primaries p ON p.id = pc.primary_id
        WHERE ${where} ORDER BY pc.primary_id, pc.name`,
      args,
    )) say(`    ${JSON.stringify(p)}`);
  };
  await prim(`Moore's S-AL primary rows (name LIKE %Moore%, any round)`, `p.chamber = 'senate' AND p.state = 'AL' AND pc.name LIKE '%Moore%'`, []);
  await prim(`every primary row carrying Moore's bioguide (${moore.incumbent_bioguide_id})`, `pc.bioguide_id = ?`, [String(moore.incumbent_bioguide_id)]);
  await prim(`GA-13's primaries, every row`, `p.id LIKE 'house-GA-13-2026-%'`, []);
  await prim(`every primary row carrying B001328`, `pc.bioguide_id = 'B001328'`, []);
  await prim(`TN-05's R primaries, every row`, `p.id LIKE 'house-TN-05-2026-R%'`, []);
  const ogles = races.find((r) => r.id === "TN-05-2026")!;
  await prim(`every primary row carrying Ogles's bioguide (${ogles.incumbent_bioguide_id})`, `pc.bioguide_id = ?`, [String(ogles.incumbent_bioguide_id)]);
  // The route that tied TN-05's row: identity (its person_key is his title's key) or the incumbent gate (underlined).
  const { titleKey } = await import("@/lib/primary-candidates-scrape");
  const om = mids.find((x) => x.bioguide_id === ogles.incumbent_bioguide_id);
  const oTitle = om ? String(om.ballotpedia_title_resolved ?? "").trim() || String(om.ballotpedia_title ?? "").trim() : "";
  const oKey = oTitle ? titleKey(oTitle) : null;
  for (const p of await rowsOf(db, `SELECT pc.primary_id, pc.name, pc.person_key, pc.incumbent FROM primary_candidates pc WHERE pc.bioguide_id = ? AND pc.primary_id LIKE 'house-TN-05-2026-R%'`, [String(ogles.incumbent_bioguide_id)])) {
    say(`  TN-05 route: ${p.primary_id} "${p.name}" · person_key ${JSON.stringify(p.person_key)} · his title's key ${JSON.stringify(oKey)} · identity ${p.person_key != null && p.person_key === oKey} · underlined ${Number(p.incumbent) === 1}`);
  }

  say(`\n  readIncumbentQualifierReadings(db, ${CYCLE}) at ${BASE_SHA}:`);
  const q = (await import(baseFile("lib/incumbent-qualifier.ts"))) as { readIncumbentQualifierReadings: (db: Client, c: number) => Promise<Map<string, Reading>> };
  const readings = await q.readIncumbentQualifierReadings(db, CYCLE);
  mkdirSync(ART, { recursive: true });
  const file = path.join(ART, "m1-readings-889c737.json");
  const body = JSON.stringify({ at: new Date().toISOString(), sha: BASE_SHA, readings: readingsJson(readings) }, null, 1);
  writeFileSync(file, body);
  say(`  ${readings.size} readings saved whole to ${path.relative(process.cwd(), file)} (sha256 ${sha(body)})`);
  const qual = [...readings.values()].filter((r) => r.qualifier != null).length;
  say(`  with a qualifier ${qual} · on own ballot ${[...readings.values()].filter((r) => r.onOwnBallot).length}`);
  for (const id of THREE) {
    const r = readings.get(id);
    const absent = JSON.stringify(r?.qualifier) === JSON.stringify({ kind: "none", reason: "absent" });
    check("M1", id, absent, show(r));
  }
  db.close();
}

// ── M4 ──────────────────────────────────────────────────────────────────────
async function m4() {
  say(`=== HO 773 M4 · SC's House first rounds · ${new Date().toISOString()} ===`);
  const db = prodReader();
  const rows = await rowsOf(db, `SELECT id, election_round, primary_date, runoff_date, updated_at FROM primaries WHERE id LIKE 'house-SC-%' OR id LIKE 'senate-SC-%' ORDER BY id`);
  for (const r of rows) say(`  ${JSON.stringify(r)}`);
  const firsts = rows.filter((r) => String(r.id).startsWith("house-SC-") && r.election_round === "primary");
  const ids = firsts.map((r) => String(r.id)).sort();
  check("M4", "the first rounds are exactly the fourteen", JSON.stringify(ids) === JSON.stringify([...SC_IDS].sort()), `${ids.length} rows: ${ids.join(", ")}`);
  check("M4", "each carries runoff_date 2026-08-25", firsts.every((r) => r.runoff_date === "2026-08-25"), JSON.stringify([...new Set(firsts.map((r) => r.runoff_date))]));
  db.close();
}

// ── M2 ──────────────────────────────────────────────────────────────────────
type Case = { bioguide: string; member: string; kind: string; race: string; key: string; stored: string | null; resolved: string | null; hasRow: boolean };
type BaseFinding = { cases: Case[]; ambiguousMoved: { race: string; row: string; candidates: string[] }[] };
type TreeFinding = { cases: Case[]; ambiguous: { kind: string; race: string; row: string; candidates: string[] }[] };
const caseLine = (c: Case) => `${c.kind} · ${c.member} (${c.bioguide}) · ${c.race} · key ${c.key} · stored ${JSON.stringify(c.stored)} · resolved ${JSON.stringify(c.resolved)} · member_ids row ${c.hasRow}`;
async function m2() {
  say(`=== HO 773 M2 · the title classes, dry (no fetch) · ${new Date().toISOString()} · tree ${git(["rev-parse", "--short", "HEAD"]).trim()} + worktree (repair module ${treeBlob("lib/ballotpedia-title-repair.ts")}) ===`);
  const db = prodReader();
  const base = (await import(baseFile("lib/ballotpedia-title-repair.ts"))) as { findStaleTitles: (db: Client) => Promise<BaseFinding> };
  const tree = (await import("@/lib/ballotpedia-title-repair")) as unknown as { findStaleTitles: (db: Client) => Promise<TreeFinding> };
  const b = await base.findStaleTitles(db);
  const t = await tree.findStaleTitles(db);
  say(`\n  ${BASE_SHA}'s finder: ${b.cases.length} cases`);
  for (const c of b.cases) say(`    ${caseLine(c)}`);
  say(`  ${BASE_SHA}'s ambiguous moved rows (${b.ambiguousMoved.length}): ${b.ambiguousMoved.map((a) => `${a.race} ${a.row} [${a.candidates.join(", ")}]`).join("; ") || "none"}`);
  say(`\n  the tree's finder: ${t.cases.length} cases`);
  for (const c of t.cases) say(`    ${caseLine(c)}`);
  say(`  the tree's ambiguous rows (${t.ambiguous.length}): ${t.ambiguous.map((a) => `${a.kind} ${a.race} ${a.row} [${a.candidates.join(", ")}]`).join("; ") || "none"}`);

  // Each case printed with its row.
  say(`\n  each tree case with its row:`);
  for (const c of t.cases) {
    if (c.kind === "primary") {
      for (const p of await rowsOf(db, `SELECT pc.primary_id, pc.name, pc.person_key, pc.bioguide_id, pc.incumbent, pc.status FROM primary_candidates pc WHERE pc.person_key = ? ORDER BY pc.primary_id`, [c.key])) say(`    ${c.member}: ${JSON.stringify(p)}`);
    } else {
      for (const g of await rowsOf(db, `SELECT race_id, person_key, name, bioguide_id, on_ballot, incumbent_marked FROM general_ballot WHERE race_id = ? AND person_key = ?`, [c.race, c.key])) say(`    ${c.member}: ${JSON.stringify(g)}`);
    }
  }

  const isMoore = (c: Case) => c.member === "Barry Moore" || c.bioguide === "M001212";
  const isBlair = (c: Case) => c.bioguide === "B001328";
  check("A red", `${BASE_SHA}'s finder lists neither Moore nor Blair`, !b.cases.some((c) => isMoore(c) || isBlair(c)), `${b.cases.filter((c) => isMoore(c) || isBlair(c)).length} of them`);
  const tm = t.cases.filter(isMoore);
  check("M2", "Moore is a `senate` case on S-AL-2026 with S-AL's key", tm.length === 1 && tm[0]!.kind === "senate" && tm[0]!.race === "S-AL-2026" && tm[0]!.key === "Barry_Moore_(Alabama_U.S._representative)", tm.map(caseLine).join(" | ") || "absent");
  const tb = t.cases.filter(isBlair);
  check("M2", "Blair is a `primary` case on GA-13-2026 with his row's key", tb.length === 1 && tb[0]!.kind === "primary" && tb[0]!.race === "GA-13-2026" && tb[0]!.key === "Everton_Blair_Jr.", tb.map(caseLine).join(" | ") || "absent");
  const old = (cs: Case[]) => JSON.stringify(cs.filter((c) => ["stale", "missing", "moved"].includes(c.kind)));
  check("M2 control", "the three old classes find what they found at 889c737", old(t.cases) === old(b.cases), `${t.cases.filter((c) => ["stale", "missing", "moved"].includes(c.kind)).length} = ${b.cases.length}`);
  const oldAmb = JSON.stringify(b.ambiguousMoved);
  const newAmb = JSON.stringify(t.ambiguous.filter((a) => a.kind === "moved").map(({ race, row, candidates }) => ({ race, row, candidates })));
  check("M2 control", "the moved class's ambiguous rows are 889c737's", oldAmb === newAmb, `${b.ambiguousMoved.length} = ${t.ambiguous.filter((a) => a.kind === "moved").length}`);
  const byKind = Object.fromEntries(["stale", "missing", "moved", "senate", "primary"].map((k) => [k, t.cases.filter((c) => c.kind === k).length]));
  check("M2 bound", "at most six cases across the five classes", t.cases.length <= 6, `${t.cases.length} · ${JSON.stringify(byKind)}`);
  mkdirSync(ART, { recursive: true });
  writeFileSync(path.join(ART, "m2-finding.json"), JSON.stringify({ at: new Date().toISOString(), base: b, tree: t }, null, 1));
  db.close();
}

// ── M3 ──────────────────────────────────────────────────────────────────────
// The rows: the tree's primary read (lib/incumbent-qualifier.ts), joined to the race whose stored incumbent
// the row's bioguide is, each judged by the old clause and the new. The races: 889c737's readings against
// the tree's, both on the same prod read, whose `reasons` must differ exactly where the rows say.
async function m3() {
  say(`=== HO 773 M3 · the ties the name check rejects · ${new Date().toISOString()} · qualifier ${treeBlob("lib/incumbent-qualifier.ts")} ===`);
  const db = prodReader();
  const { tokenCheck } = await import("@/lib/ballot-incumbent");
  const { titleKey } = await import("@/lib/primary-candidates-scrape");
  const rows = await rowsOf(
    db,
    `SELECT r.id AS race_id, m.name AS member, m.first_name, m.last_name, c.primary_id, c.bioguide_id, c.name, c.status, c.person_key, c.incumbent,
            COALESCE(NULLIF(TRIM(mi.ballotpedia_title_resolved), ''), mi.ballotpedia_title) AS title,
            EXISTS (SELECT 1 FROM primary_candidates w WHERE w.primary_id = c.primary_id AND w.status = 'winner') AS decided
       FROM primary_candidates c JOIN primaries p ON p.id = c.primary_id
       LEFT JOIN member_ids mi ON mi.bioguide_id = c.bioguide_id
       JOIN races r ON r.incumbent_bioguide_id = c.bioguide_id AND r.cycle = ?
       LEFT JOIN members m ON m.bioguide_id = c.bioguide_id
      WHERE substr(p.primary_date, 1, 4) = ?
      ORDER BY r.id, c.primary_id`,
    [CYCLE, String(CYCLE)],
  );
  let trustedN = 0;
  const moved: { race: string; line: string }[] = [];
  for (const p of rows) {
    const title = p.title == null ? "" : String(p.title).trim();
    const identity = p.person_key != null && title !== "" && String(p.person_key) === titleKey(title);
    const underlined = Number(p.incumbent) === 1;
    const trusted = identity || underlined;
    if (trusted) trustedN++;
    const tc = tokenCheck(String(p.name), { firstName: p.first_name == null ? null : String(p.first_name), lastName: p.last_name == null ? null : String(p.last_name), member: String(p.member ?? "") });
    const lost = Number(p.decided) === 1 && p.status !== "winner";
    const oldClause = lost && tc.ok;
    const newClause = lost && (trusted || tc.ok);
    if (newClause && !oldClause) {
      moved.push({ race: String(p.race_id), line: `${p.race_id} · ${p.primary_id} "${p.name}" (${p.bioguide_id}, ${p.member}) · ${p.status} · route ${identity && underlined ? "identity and the underline" : identity ? "identity" : "the underline"} · person_key ${p.person_key} · title key ${title ? titleKey(title) : "—"} · name check: ${tc.detail}` });
    }
  }
  say(`  ${rows.length} primary rows carry a stored incumbent's bioguide · ${trustedN} trusted · the new clause reads ${moved.length} the old one didn't:`);
  for (const m of moved) say(`    ${m.line}`);
  const base = (await import(baseFile("lib/incumbent-qualifier.ts"))) as { readIncumbentQualifierReadings: (db: Client, c: number) => Promise<Map<string, Reading>> };
  const tree = (await import("@/lib/incumbent-qualifier")) as unknown as { readIncumbentQualifierReadings: (db: Client, c: number) => Promise<Map<string, Reading>> };
  const b = await base.readIncumbentQualifierReadings(db, CYCLE);
  const t = await tree.readIncumbentQualifierReadings(db, CYCLE);
  const diff: string[] = [];
  for (const id of new Set([...b.keys(), ...t.keys()])) {
    if (JSON.stringify(b.get(id)) !== JSON.stringify(t.get(id))) diff.push(id);
  }
  say(`  readings, 889c737 against the tree on one read: ${b.size} / ${t.size} · differ on ${diff.length}:`);
  for (const id of diff.sort()) say(`    ${id}: ${show(b.get(id))}  →  ${show(t.get(id))}`);
  const rowRaces = [...new Set(moved.map((m) => m.race))].sort();
  check("M3", "the races whose readings move are exactly the rows' races", JSON.stringify(diff.sort()) === JSON.stringify(rowRaces), `${diff.join(", ") || "none"} | ${rowRaces.join(", ") || "none"}`);
  check("M3", "TN-05's Ogles row alone", moved.length === 1 && moved[0]!.race === "TN-05-2026", `${moved.length} rows`);
  check("M3 bound", "at most three", moved.length <= 3, String(moved.length));
  db.close();
}

// ── M5 ──────────────────────────────────────────────────────────────────────
// lib/queries.ts getPacIeSpending's four reads, verbatim (the pac_ie_spending read, then the contest, roster
// and ballot reads over its seats), with the clock and election day it passes; classifyTarget at 889c737 and
// in the tree over each target, so a change prints both `why`s. Run with --import
// ./scripts/diagnostic/next-cache-stub-757.mjs, and the tree's statuses are checked against
// getPacIeSpending itself (its unstable_cache a passthrough).
type Classify = (fec: string, contests: unknown[], roster: unknown[], today: string, ballot: unknown[] | null, electionDate: string | null) => { status: string; why: string };
async function m5() {
  say(`=== HO 773 M5 · rung 1b over the live PAC targets · ${new Date().toISOString()} · pac-target-status ${treeBlob("lib/pac-target-status.ts")} ===`);
  const db = prodReader();
  const base = (await import(baseFile("lib/pac-target-status.ts"))) as { classifyTarget: Classify };
  const tree = (await import("@/lib/pac-target-status")) as unknown as { classifyTarget: Classify };
  const { clockNowMs } = await import("@/lib/clock");
  const { electionDay } = await import("@/lib/format");
  const rs = await rowsOf(
    db,
    `SELECT race_id, committee_id, candidate_id, candidate_name,
                   support_oppose, earliest_date
            FROM pac_ie_spending
            WHERE cycle = ?
            ORDER BY race_id, support_oppose DESC, earliest_date ASC`,
    [CYCLE],
  );
  const seatIds = [...new Set(rs.map((r) => String(r.race_id)))];
  const marks = seatIds.map(() => "?").join(",");
  const contestRs = await rowsOf(
    db,
    `WITH seat AS (
              SELECT id, state, chamber, district FROM races WHERE id IN (${marks})
            )
            SELECT r.id AS race_id, p.id AS primary_id, p.primary_date,
                   p.runoff_date, p.election_round, pc.name, pc.status, pc.vote_pct
            FROM seat r
            CROSS JOIN primaries p
              ON p.state = r.state AND p.chamber = r.chamber
             AND ((p.district IS NULL AND r.district IS NULL)
                  OR CAST(p.district AS INTEGER) = r.district)
            CROSS JOIN primary_candidates pc ON pc.primary_id = p.id`,
    seatIds,
  );
  const rosterRs = await rowsOf(
    db,
    `SELECT race_id, name, status FROM race_candidates
            WHERE race_id IN (${marks}) AND status IS NOT 'on_ballot'`,
    seatIds,
  );
  const ballotRs = await rowsOf(
    db,
    `SELECT r.race_id, g.name, g.on_ballot, g.withdrawn, g.write_in, g.marked
            FROM general_ballot_reads r
            LEFT JOIN general_ballot g ON g.race_id = r.race_id
            WHERE r.race_id IN (${marks}) AND r.status = 'box'`,
    seatIds,
  );
  const contestsBySeat: Record<string, unknown[]> = {};
  for (const c of contestRs)
    (contestsBySeat[String(c.race_id)] ??= []).push({
      primaryId: c.primary_id as string,
      primaryDate: (c.primary_date as string | null) ?? null,
      runoffDate: (c.runoff_date as string | null) ?? null,
      round: c.election_round as string,
      name: c.name as string,
      status: (c.status as string | null) ?? null,
      votePct: (c.vote_pct as number | null) ?? null,
    });
  const rosterBySeat: Record<string, unknown[]> = {};
  for (const c of rosterRs) (rosterBySeat[String(c.race_id)] ??= []).push({ name: c.name as string, status: (c.status as string | null) ?? null });
  const ballotBySeat: Record<string, unknown[]> = {};
  for (const b of ballotRs) {
    const rows = (ballotBySeat[String(b.race_id)] ??= []);
    if (b.name == null) continue;
    rows.push({ name: b.name as string, onBallot: Number(b.on_ballot) === 1, withdrawn: Number(b.withdrawn) === 1, writeIn: Number(b.write_in) === 1, marked: Number(b.marked) === 1 });
  }
  const today = new Date(clockNowMs()).toISOString().slice(0, 10);
  const electionDate = electionDay(CYCLE).toISOString().slice(0, 10);
  say(`  ${rs.length} PAC rows on ${seatIds.length} seats · ${contestRs.length} contest rows · today ${today} · election day ${electionDate}`);
  const treeStatus: string[] = [];
  let changed = 0;
  for (const row of rs) {
    const raceId = String(row.race_id), name = String(row.candidate_name);
    const args = [name, contestsBySeat[raceId] ?? [], rosterBySeat[raceId] ?? [], today, ballotBySeat[raceId] ?? null, electionDate] as const;
    const b = base.classifyTarget(...args);
    const t = tree.classifyTarget(...args);
    treeStatus.push(t.status);
    const same = b.status === t.status && b.why === t.why;
    if (!same) changed++;
    say(`  ${same ? "  " : "≠ "}${raceId} · ${row.support_oppose} · ${name} · ${BASE_SHA}: ${b.status} (${b.why})${same ? "" : `  →  tree: ${t.status} (${t.why})`}`);
  }
  check("M5", "rung 1b's live set does not change", changed === 0, `${changed} of ${rs.length} change`);
  try {
    const { getPacIeSpending } = (await import("@/lib/queries")) as unknown as { getPacIeSpending: (c: number) => Promise<Record<string, { targetStatus: string }[]>> };
    const page = await getPacIeSpending(CYCLE);
    const pageStatus = Object.keys(page).sort().flatMap((k) => page[k]!.map((r) => r.targetStatus));
    check("M5 control", "these reads are getPacIeSpending's: the tree's statuses equal its targetStatus, row for row", JSON.stringify(pageStatus) === JSON.stringify(treeStatus), `${pageStatus.length} rows`);
  } catch (e) {
    say(`  (getPacIeSpending not run: ${String((e as Error)?.message ?? e).slice(0, 160)}; run with the next/cache stub)`);
  }
  db.close();
}

// ── legs A and B: planted rows in a fixture database ────────────────────────
// Only the columns the finder and the qualifier read, so every planted row is visible in this file.
const FIXTURE_SCHEMA = [
  `CREATE TABLE races (id TEXT PRIMARY KEY, cycle INTEGER, state TEXT, chamber TEXT, district INTEGER, incumbent_bioguide_id TEXT, incumbent_running INTEGER)`,
  `CREATE TABLE members (bioguide_id TEXT PRIMARY KEY, name TEXT, first_name TEXT, last_name TEXT, state TEXT, district INTEGER, chamber TEXT, is_current INTEGER)`,
  `CREATE TABLE member_ids (bioguide_id TEXT PRIMARY KEY, ballotpedia_title TEXT, ballotpedia_title_resolved TEXT)`,
  `CREATE TABLE general_ballot_reads (race_id TEXT PRIMARY KEY, status TEXT)`,
  `CREATE TABLE general_ballot (race_id TEXT, person_key TEXT, name TEXT, bioguide_id TEXT, incumbent_marked INTEGER, on_ballot INTEGER, withdrawn INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (race_id, person_key))`,
  `CREATE TABLE primaries (id TEXT PRIMARY KEY, state TEXT, district TEXT, chamber TEXT, primary_date TEXT, election_round TEXT)`,
  `CREATE TABLE primary_candidates (id INTEGER PRIMARY KEY, primary_id TEXT, name TEXT, person_key TEXT, bioguide_id TEXT, incumbent INTEGER NOT NULL DEFAULT 0, status TEXT)`,
];
// A libsql file stays locked on Windows a while after close(), so a fixture is only closed here, each run
// names its own files, and the files of earlier runs (their processes gone) are swept at the start.
let fixtureN = 0;
const RUN = Date.now().toString(36);
function sweepFixtures() {
  if (!existsSync(DIR)) return;
  for (const f of readdirSync(DIR)) {
    if (!f.startsWith("fixture-773-")) continue;
    try {
      rmSync(path.join(DIR, f), { force: true });
    } catch {
      // still locked by a process that hasn't exited; the next run sweeps it
    }
  }
}
async function fixture(label: string, plant: string[]): Promise<{ db: Client; done: () => Promise<void> }> {
  mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `fixture-773-${RUN}-${++fixtureN}-${label}.db`);
  const db = createClient({ url: `file:${file}` });
  for (const s of [...FIXTURE_SCHEMA, ...plant]) await db.execute(s);
  return { db, done: async () => db.close() };
}
// Leg A's state: Moore printed on S-AL, untied, not underlined; Everett Wess beside him, whom no member's
// name fits; Blair keyed and untied in GA-13's D primary, with no member_ids row.
const LEG_A_PLANT = [
  `INSERT INTO races VALUES ('AL-01-2026', 2026, 'AL', 'house', 1, 'M001212', NULL), ('S-AL-2026', 2026, 'AL', 'senate', NULL, 'T000278', NULL), ('GA-13-2026', 2026, 'GA', 'house', 13, 'B001328', NULL)`,
  `INSERT INTO members VALUES ('M001212', 'Barry Moore', 'Barry', 'Moore', 'AL', 1, 'house', 1), ('R000575', 'Mike Rogers', 'Mike', 'Rogers', 'AL', 3, 'house', 1), ('T000278', 'Tommy Tuberville', 'Tommy', 'Tuberville', 'AL', NULL, 'senate', 1), ('B001328', 'Everton Blair Jr.', 'Everton', 'Blair', 'GA', 13, 'house', 1)`,
  `INSERT INTO member_ids VALUES ('M001212', 'Barry Moore (Alabama)', NULL), ('R000575', 'Mike Rogers (Alabama)', NULL), ('T000278', 'Tommy Tuberville', NULL)`,
  `INSERT INTO general_ballot_reads VALUES ('S-AL-2026', 'box'), ('AL-01-2026', 'box'), ('GA-13-2026', 'box')`,
  `INSERT INTO general_ballot (race_id, person_key, name, bioguide_id, incumbent_marked, on_ballot) VALUES
     ('S-AL-2026', 'Barry_Moore_(Alabama_U.S._representative)', 'Barry Moore', NULL, 0, 1),
     ('S-AL-2026', 'Everett_Wess', 'Everett Wess', NULL, 0, 1),
     ('AL-01-2026', 'Shomari_Figures', 'Shomari Figures', NULL, 0, 1),
     ('GA-13-2026', 'Jasmine_Clark', 'Jasmine Clark', NULL, 0, 1)`,
  `INSERT INTO primaries VALUES ('house-GA-13-2026-D', 'GA', '13', 'house', '2026-05-19', 'primary'), ('senate-AL-2026-R', 'AL', NULL, 'senate', '2026-05-19', 'primary')`,
  `INSERT INTO primary_candidates (id, primary_id, name, person_key, bioguide_id, incumbent, status) VALUES
     (1, 'house-GA-13-2026-D', 'Everton Blair Jr.', 'Everton_Blair_Jr.', NULL, 0, 'running'),
     (2, 'house-GA-13-2026-D', 'Jasmine Clark', 'Jasmine_Clark', NULL, 0, 'winner'),
     (3, 'senate-AL-2026-R', 'Barry Moore', 'Barry_Moore_(Alabama_U.S._representative)', NULL, 0, 'winner')`,
];
async function legA() {
  say(`=== HO 773 leg A · the classes · ${new Date().toISOString()} · repair module ${treeBlob("lib/ballotpedia-title-repair.ts")} ===`);
  const base = (await import(baseFile("lib/ballotpedia-title-repair.ts"))) as { findStaleTitles: (db: Client) => Promise<BaseFinding> };
  const tree = (await import("@/lib/ballotpedia-title-repair")) as unknown as { findStaleTitles: (db: Client) => Promise<TreeFinding> };
  const summary = (f: TreeFinding) => `cases [${f.cases.map((c) => `${c.kind} ${c.member} ${c.race} ${c.key}`).join("; ")}] · ambiguous [${f.ambiguous.map((a) => `${a.kind} ${a.race} ${a.row} {${a.candidates.join(", ")}}`).join("; ")}]`;

  say(`\n  the planted state: Moore printed, untied and not underlined on S-AL; Everett Wess beside him; Blair keyed and untied in GA-13's D primary`);
  const f1 = await fixture("a1", LEG_A_PLANT);
  const b1 = await base.findStaleTitles(f1.db);
  const t1 = await tree.findStaleTitles(f1.db);
  await f1.done();
  say(`    ${BASE_SHA}: ${b1.cases.length} cases, ${b1.ambiguousMoved.length} ambiguous`);
  say(`    tree: ${summary(t1)}`);
  check("A red", `${BASE_SHA}'s finder: no case on the planted state`, b1.cases.length === 0, String(b1.cases.length));
  check("A", "the tree: Moore `senate` on S-AL-2026, Blair `primary` on GA-13-2026, and nothing else", JSON.stringify(t1.cases.map((c) => [c.kind, c.bioguide, c.race, c.key])) === JSON.stringify([["senate", "M001212", "S-AL-2026", "Barry_Moore_(Alabama_U.S._representative)"], ["primary", "B001328", "GA-13-2026", "Everton_Blair_Jr."]]), summary(t1));
  check("A control", "Everett Wess, untied and not underlined on S-AL, fits no House member: no case and not listed", !t1.cases.some((c) => c.key === "Everett_Wess") && !t1.ambiguous.some((a) => a.row === "Everett Wess"), summary(t1));

  say(`\n  the same state, plus a second sitting AL House member whose name fits the same row (Barry L. Moore, AL-02)`);
  const f2 = await fixture("a2", [...LEG_A_PLANT, `INSERT INTO members VALUES ('Z900002', 'Barry L. Moore', 'Barry', 'Moore', 'AL', 2, 'house', 1)`]);
  const t2 = await tree.findStaleTitles(f2.db);
  await f2.done();
  say(`    tree: ${summary(t2)}`);
  check("A control", "two members fit Moore's row: ambiguous (kind senate), no case for either", !t2.cases.some((c) => c.kind === "senate") && t2.ambiguous.some((a) => a.kind === "senate" && a.race === "S-AL-2026" && a.row === "Barry Moore" && a.candidates.length === 2), summary(t2));

  say(`\n  the same state, plus a second keyed, untied row in GA-13's primaries that fits Blair under another key (added: the primary class's own ambiguity)`);
  const f3 = await fixture("a3", [
    ...LEG_A_PLANT,
    `INSERT INTO primaries VALUES ('house-GA-13-2026-D-runoff', 'GA', '13', 'house', '2026-06-16', 'runoff')`,
    `INSERT INTO primary_candidates (id, primary_id, name, person_key, bioguide_id, incumbent, status) VALUES (4, 'house-GA-13-2026-D-runoff', 'Everton Blair', 'Everton_Blair_(Georgia)', NULL, 0, 'running')`,
  ]);
  const t3 = await tree.findStaleTitles(f3.db);
  await f3.done();
  say(`    tree: ${summary(t3)}`);
  check("A control", "two keys fit Blair: ambiguous (kind primary), no case", !t3.cases.some((c) => c.kind === "primary") && t3.ambiguous.some((a) => a.kind === "primary" && a.race === "GA-13-2026" && a.candidates.length === 2), summary(t3));

  say(`\n  the same state, with Blair tied on another primary row of the cycle (added: the class takes only a member tied to no row)`);
  const f4 = await fixture("a4", [
    ...LEG_A_PLANT,
    `INSERT INTO primaries VALUES ('house-GA-13-2026-D-runoff', 'GA', '13', 'house', '2026-06-16', 'runoff')`,
    `INSERT INTO primary_candidates (id, primary_id, name, person_key, bioguide_id, incumbent, status) VALUES (4, 'house-GA-13-2026-D-runoff', 'Everton Blair Jr.', 'Everton_Blair_Jr.', 'B001328', 0, 'running')`,
  ]);
  const t4 = await tree.findStaleTitles(f4.db);
  await f4.done();
  say(`    tree: ${summary(t4)}`);
  check("A control", "a member tied on any primary row of the cycle is no `primary` case", !t4.cases.some((c) => c.kind === "primary"), summary(t4));
}

// Leg B's state: TN-05's Ogles on no row of his ballot, his "Andy Ogles" row unmarked in the decided R primary.
const legBPlant = (row: { name: string; key: string; incumbent: number; status: string }) => [
  `INSERT INTO races VALUES ('TN-05-2026', 2026, 'TN', 'house', 5, 'O000175', NULL)`,
  `INSERT INTO members VALUES ('O000175', 'Andrew Ogles', 'Andrew', 'Ogles', 'TN', 5, 'house', 1)`,
  `INSERT INTO member_ids VALUES ('O000175', 'Andy Ogles', NULL)`,
  `INSERT INTO general_ballot_reads VALUES ('TN-05-2026', 'box')`,
  `INSERT INTO general_ballot (race_id, person_key, name, bioguide_id, incumbent_marked, on_ballot) VALUES ('TN-05-2026', 'Charlie_Hatcher', 'Charlie Hatcher', NULL, 0, 1)`,
  `INSERT INTO primaries VALUES ('house-TN-05-2026-R', 'TN', '05', 'house', '2026-08-06', 'primary')`,
  `INSERT INTO primary_candidates (id, primary_id, name, person_key, bioguide_id, incumbent, status) VALUES
     (1, 'house-TN-05-2026-R', 'Charlie Hatcher', 'Charlie_Hatcher', NULL, 0, '${row.status === "winner" ? "running" : "winner"}'),
     (2, 'house-TN-05-2026-R', '${row.name}', '${row.key}', 'O000175', ${row.incumbent}, '${row.status}')`,
];
async function legB() {
  say(`=== HO 773 leg B · the qualifier · ${new Date().toISOString()} · qualifier ${treeBlob("lib/incumbent-qualifier.ts")} ===`);
  const base = (await import(baseFile("lib/incumbent-qualifier.ts"))) as { readIncumbentQualifierReadings: (db: Client, c: number) => Promise<Map<string, Reading>> };
  const tree = (await import("@/lib/incumbent-qualifier")) as unknown as { readIncumbentQualifierReadings: (db: Client, c: number) => Promise<Map<string, Reading>> };
  const cases: { label: string; row: { name: string; key: string; incumbent: number; status: string }; tree: string; base: string }[] = [
    { label: "B1 · \"Andy Ogles\", decided, not the winner, tied by identity (person_key Andy_Ogles, his title's key), not underlined", row: { name: "Andy Ogles", key: "Andy_Ogles", incumbent: 0, status: "running" }, tree: "lost_primary", base: "absent" },
    { label: "B2 · the same row, not keyed to him (Andrew_Ogles_(Tennessee)) but underlined", row: { name: "Andy Ogles", key: "Andrew_Ogles_(Tennessee)", incumbent: 1, status: "running" }, tree: "lost_primary", base: "absent" },
    { label: "B3 · the guard: the same row, neither keyed to him nor underlined", row: { name: "Andy Ogles", key: "Andrew_Ogles_(Tennessee)", incumbent: 0, status: "running" }, tree: "absent", base: "absent" },
    { label: "B4 · the control: a winner row tied by identity", row: { name: "Andy Ogles", key: "Andy_Ogles", incumbent: 0, status: "winner" }, tree: "absent", base: "absent" },
    { label: "B5 · added: neither keyed nor underlined, but the name check passes (\"Andrew Ogles\")", row: { name: "Andrew Ogles", key: "Andrew_Ogles_(Tennessee)", incumbent: 0, status: "running" }, tree: "lost_primary", base: "lost_primary" },
  ];
  for (const c of cases) {
    const f = await fixture("b", legBPlant(c.row));
    const b = (await base.readIncumbentQualifierReadings(f.db, CYCLE)).get("TN-05-2026");
    const t = (await tree.readIncumbentQualifierReadings(f.db, CYCLE)).get("TN-05-2026");
    await f.done();
    const reason = (r: Reading | undefined) => ((r?.qualifier as { reason?: string } | null)?.reason ?? JSON.stringify(r?.qualifier));
    say(`\n  ${c.label}`);
    say(`    ${BASE_SHA}: ${show(b)}`);
    say(`    tree:    ${show(t)}`);
    check("B", `${c.label.split(" · ")[0]} tree reads ${c.tree}`, reason(t) === c.tree && (c.tree === "lost_primary") === !!t?.reasons.includes("lost_primary"), reason(t));
    check(c.base !== c.tree ? "B red" : "B", `${c.label.split(" · ")[0]} ${BASE_SHA} reads ${c.base}`, reason(b) === c.base, reason(b));
  }
}

// ── leg C: rung 1b on planted contests ──────────────────────────────────────
async function legC() {
  say(`=== HO 773 leg C · rung 1b · ${new Date().toISOString()} · pac-target-status ${treeBlob("lib/pac-target-status.ts")} ===`);
  const base = (await import(baseFile("lib/pac-target-status.ts"))) as { classifyTarget: Classify };
  const tree = (await import("@/lib/pac-target-status")) as unknown as { classifyTarget: Classify };
  const TODAY = "2026-10-11";
  const row = (primaryId: string, round: string, primaryDate: string, runoffDate: string | null, name: string, status: string, votePct: number | null) => ({ primaryId, primaryDate, runoffDate, round, name, status, votePct });
  const rFirst = [row("house-TX-23-2026-R", "primary", "2026-03-03", "2026-05-26", "Brandon Herrera", "winner", 43.2), row("house-TX-23-2026-R", "primary", "2026-03-03", "2026-05-26", "Tony Gonzales", "winner", 42.6), row("house-TX-23-2026-R", "primary", "2026-03-03", "2026-05-26", "Third Person", "running", 14.2)];
  const dFirst = [row("house-TX-23-2026-D", "primary", "2026-03-03", "2026-05-26", "Dem One", "winner", 40.1), row("house-TX-23-2026-D", "primary", "2026-03-03", "2026-05-26", "Dem Two", "winner", 35.0)];
  const dRunoff = [row("house-TX-23-2026-D-runoff", "runoff", "2026-05-26", null, "Dem One", "winner", 55.0), row("house-TX-23-2026-D-runoff", "runoff", "2026-05-26", null, "Dem Two", "running", 45.0)];
  const rRunoff = [row("house-TX-23-2026-R-runoff", "runoff", "2026-05-26", null, "Brandon Herrera", "winner", 52.0), row("house-TX-23-2026-R-runoff", "runoff", "2026-05-26", null, "Tony Gonzales", "running", 48.0)];
  const legs: { label: string; contests: unknown[]; tree: string; base: string }[] = [
    { label: "C1 · an R first-round winner, its runoff date past, no R runoff row; the seat's D runoff resulted", contests: [...rFirst, ...dFirst, ...dRunoff], tree: "unknown", base: "active" },
    { label: "C2 · the control: the target in its own resulted runoff, as its winner", contests: [...rFirst, ...dFirst, ...dRunoff, ...rRunoff], tree: "active", base: "active" },
    { label: "C3 · the control: no runoff row anywhere, the date past", contests: [...rFirst, ...dFirst], tree: "unknown", base: "unknown" },
  ];
  for (const l of legs) {
    const b = base.classifyTarget("HERRERA, BRANDON", l.contests, [], TODAY, null, "2026-11-03");
    const t = tree.classifyTarget("HERRERA, BRANDON", l.contests, [], TODAY, null, "2026-11-03");
    say(`\n  ${l.label}`);
    say(`    ${BASE_SHA}: ${b.status} (${b.why})`);
    say(`    tree:    ${t.status} (${t.why})`);
    check("C", `${l.label.split(" · ")[0]} tree reads ${l.tree}`, t.status === l.tree, t.status);
    check(l.base !== l.tree ? "C red" : "C", `${l.label.split(" · ")[0]} ${BASE_SHA} reads ${l.base}`, b.status === l.base, b.status);
  }
}

// ── leg D: the cards on prod, after the writes ──────────────────────────────
// Three readings of one moment against M1's base: the tree's (what the cards now say), 889c737's on today's
// data (what the writes alone moved), and the tree against 889c737 on today's data (what the code alone moves).
// A card is expected to move only if its case was written: AL-01 needs Moore's title resolved and S-AL re-read,
// GA-13 Blair's title resolved and his row tied; TN-05 needs neither.
async function legD() {
  say(`=== HO 773 leg D · the cards on prod · ${new Date().toISOString()} · tree ${git(["rev-parse", "--short", "HEAD"]).trim()} · qualifier ${treeBlob("lib/incumbent-qualifier.ts")} ===`);
  const db = prodReader();
  const m1 = JSON.parse(readFileSync(path.join(ART, "m1-readings-889c737.json"), "utf8")) as { at: string; readings: Record<string, Reading> };
  const base = (await import(baseFile("lib/incumbent-qualifier.ts"))) as { readIncumbentQualifierReadings: (db: Client, c: number) => Promise<Map<string, Reading>> };
  const tree = (await import("@/lib/incumbent-qualifier")) as unknown as { readIncumbentQualifierReadings: (db: Client, c: number) => Promise<Map<string, Reading>> };
  const t = await tree.readIncumbentQualifierReadings(db, CYCLE);
  const b = await base.readIncumbentQualifierReadings(db, CYCLE);
  const m = new Map(Object.entries(m1.readings));
  const diff = (x: Map<string, Reading>, y: Map<string, Reading>) => [...new Set([...x.keys(), ...y.keys()])].filter((id) => JSON.stringify(x.get(id)) !== JSON.stringify(y.get(id))).sort();
  const written = await rowsOf(db, `SELECT bioguide_id, ballotpedia_title_resolved, ballotpedia_title_resolved_from, ballotpedia_title_resolved_at FROM member_ids WHERE ballotpedia_title_resolved_at > ? ORDER BY bioguide_id`, [m1.at]);
  say(`  M1's base: ${m.size} readings at ${m1.at} · titles resolved since: ${written.map((w) => `${w.bioguide_id} → ${JSON.stringify(w.ballotpedia_title_resolved)} (${w.ballotpedia_title_resolved_from}, ${w.ballotpedia_title_resolved_at})`).join("; ") || "none"}`);
  const sections: [string, string[], Map<string, Reading>, Map<string, Reading>][] = [
    ["the tree today against M1's base (what the cards now say)", diff(m, t), m, t],
    [`${BASE_SHA}'s code today against M1's base (what the data alone moved)`, diff(m, b), m, b],
    [`the tree against ${BASE_SHA}'s code, both today (what the code alone moves)`, diff(b, t), b, t],
  ];
  for (const [label, ids, x, y] of sections) {
    say(`\n  ${label}: ${ids.length} change${ids.length === 1 ? "" : "s"}`);
    for (const id of ids) say(`    ${id}: ${show(x.get(id))}  →  ${show(y.get(id))}`);
  }
  const wroteMoore = written.some((w) => w.bioguide_id === "M001212");
  const wroteBlair = written.some((w) => w.bioguide_id === "B001328");
  const expected: Record<string, unknown> = { "TN-05-2026": { kind: "none", reason: "lost_primary" } };
  if (wroteMoore) expected["AL-01-2026"] = { kind: "senate", raceId: "S-AL-2026" };
  if (wroteBlair) expected["GA-13-2026"] = { kind: "none", reason: "lost_primary" };
  for (const [id, q] of Object.entries(expected)) check("D", `${id} reads ${JSON.stringify(q)}`, JSON.stringify(t.get(id)?.qualifier) === JSON.stringify(q), show(t.get(id)));
  for (const id of THREE.filter((x) => !(x in expected))) check("D", `${id}, its case not written, still reads absent`, JSON.stringify(t.get(id)?.qualifier) === JSON.stringify({ kind: "none", reason: "absent" }), show(t.get(id)));
  const others = diff(m, t).filter((id) => !(id in expected));
  check("D", "no other card changes (any other change HALTs)", others.length === 0, others.join(", ") || "none");
  mkdirSync(ART, { recursive: true });
  writeFileSync(path.join(ART, "legD-readings-tree.json"), JSON.stringify({ at: new Date().toISOString(), readings: readingsJson(t) }, null, 1));
  db.close();
}

// ── leg E: the four rounds, read on their pages ─────────────────────────────
const LEG_E = [
  { id: "AL-01-2026", state: "AL", district: 1 },
  { id: "OK-01-2026", state: "OK", district: 1 },
  { id: "TX-23-2026", state: "TX", district: 23 },
  { id: "TX-32-2026", state: "TX", district: 32 },
];
type PageText = { stripTags: (s: string) => string; decodeEntities: (s: string) => string };
function rSections(html: string, start: number, end: number, t: PageText) {
  // The section's h3/h4 headings in order; an R primary section is an h4 naming the Republican primary (or
  // its runoff), with the "Withdrawn or disqualified candidates" h4 that follows it folded in. Its date is the
  // h3 above it ("Primary held May 19"), where the page groups by date.
  const seg = html.slice(start, end);
  const heads = [...seg.matchAll(/<h([34])[^>]*>([\s\S]*?)<\/h\1>/g)].map((h) => ({ level: h[1]!, text: t.stripTags(h[2]!).trim(), at: h.index ?? 0, endTag: (h.index ?? 0) + h[0].length }));
  const out: { heading: string; under: string | null; text: string; withdrawn: string | null }[] = [];
  let h3: string | null = null;
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]!;
    if (h.level === "3") {
      h3 = h.text;
      continue;
    }
    if (!/republican primary/i.test(h.text)) continue;
    const bodyEnd = i + 1 < heads.length ? heads[i + 1]!.at : seg.length;
    // The box's own header (its <h5>) is dropped, so it can't run into the results line after it.
    const clean = (s: string) =>
      t
        .decodeEntities(t.stripTags(s.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<table[\s\S]*?<\/table>/g, " ").replace(/<div class="race_header[^"]*">[\s\S]*?<\/div>/g, " ")))
        .replace(/\s+/g, " ")
        .trim();
    let withdrawn: string | null = null;
    const next = heads[i + 1];
    if (next && next.level === "4" && /withdrawn or disqualified/i.test(next.text)) {
      const wEnd = i + 2 < heads.length ? heads[i + 2]!.at : seg.length;
      withdrawn = clean(seg.slice(next.endTag, wEnd));
    }
    out.push({ heading: h.text, under: h3, text: clean(seg.slice(h.endTag, bodyEnd)), withdrawn });
  }
  return out;
}
async function legE() {
  say(`=== HO 773 leg E · the four rounds · ${new Date().toISOString()} ===`);
  const gb = await import("@/lib/general-ballot");
  const t = (await import("@/lib/primary-candidates-scrape")) as unknown as PageText;
  const { houseDistrictUrl } = await import("@/lib/primary-candidates-scrape");
  const dir = path.join(ART, "legE-pages");
  mkdirSync(dir, { recursive: true });
  const { gzipSync } = await import("node:zlib");
  // --saved: HO 747's copies of the four pages (2026-09-25), read from disk with no fetch, to check this
  // leg's reading of a page before the live read spends a request on it.
  const SAVED = has("--saved") ? path.resolve("docs/handoffs/747-artifacts/pages") : null;
  const savedIO: import("@/lib/general-ballot").IO | null = SAVED
    ? {
        now: () => Date.now(),
        sleep: async () => {},
        get: async (url) => {
          const slug: Record<string, string> = { AL: "Alabama", OK: "Oklahoma", TX: "Texas" };
          const r = LEG_E.find((x) => url === houseDistrictUrl(slug[x.state]!, x.district));
          const run = r ? readdirSync(SAVED).find((d) => existsSync(path.join(SAVED, d, `${r.id}.1.html.gz`))) : undefined;
          if (!r || !run) return { kind: "network", error: `not saved: ${url}` };
          const { gunzipSync } = await import("node:zlib");
          return { kind: "response", status: 200, body: gunzipSync(readFileSync(path.join(SAVED, run, `${r.id}.1.html.gz`))).toString("utf8") };
        },
      }
    : null;
  if (SAVED) say(`  (--saved: HO 747's saved pages, no fetch; nothing is saved from this run)`);
  const paced = gb.pacedIO(savedIO ?? gb.liveIO(), savedIO ? 0 : gb.MIN_START_GAP_MS);
  let stopped: string | null = null;
  const report: Record<string, unknown>[] = [];
  for (const r of LEG_E) {
    if (stopped) {
      say(`\n  ${r.id}: not read (the read stopped at ${stopped})`);
      report.push({ race: r.id, verdict: "not read" });
      continue;
    }
    const page = await gb.readRacePage({ id: r.id, chamber: "house", state: r.state, district: r.district }, paced.io);
    const a = page.attempts.at(-1);
    say(`\n  ${r.id}: ${page.verdict}${page.cause ? ` (${page.cause})` : ""} · ${page.url} · ${a?.result} · ${a?.bytes ?? 0} bytes · ${a?.at ?? ""}`);
    if (page.verdict !== "READ" || !page.html) {
      stopped = `${r.id} (${page.verdict}${page.cause ? `, ${page.cause}` : ""})`;
      report.push({ race: r.id, verdict: page.verdict, cause: page.cause });
      continue;
    }
    if (!SAVED) {
      writeFileSync(path.join(dir, `${r.id}.html.gz`), gzipSync(page.html));
      say(`    saved ${path.relative(process.cwd(), path.join(dir, `${r.id}.html.gz`))} · sha256 ${sha(page.html)}`);
    }
    const model = gb.readPageModel(page.html);
    const rBoxes = model.sectionBoxes.filter((b) => b.contest === "R");
    const dateOf = (b: (typeof rBoxes)[number]) => {
      const line = t.stripTags(page.html!.slice(b.offset).match(/<p class="results_text">([\s\S]*?)<\/p>/)?.[1] ?? "");
      return { line: t.decodeEntities(line).replace(/\s+/g, " ").trim(), date: line.match(/\bon ([A-Z][a-z]+ \d{1,2}, \d{4})\./)?.[1] ?? null };
    };
    for (const b of rBoxes) {
      const d = dateOf(b);
      say(`    R box · ${b.kind}${b.special ? " (special)" : ""} · "${b.h5}" · ${d.date ?? "no date printed"} · marked ${b.marked} · ${b.rows.map((x) => `${x.name}${x.winner ? " ✓" : ""}${x.underlined ? " (incumbent)" : ""}`).join(", ")}`);
      say(`      results line: "${d.line}"`);
    }
    const runoffBox = rBoxes.filter((b) => b.kind === "runoff");
    say(`    an R runoff box: ${runoffBox.length ? `YES (${runoffBox.length})` : "none"}`);
    const secs = rSections(page.html, model.section!.start, model.section!.end, t);
    for (const s of secs) {
      // "U.S." doesn't end a sentence.
      const sentences = (s.text.replace(/U\.S\./g, "U․S․").match(/[^.!?]+[.!?]+/g) ?? []).map((x) => x.trim().replace(/․/g, ".")).filter((x) => /runoff|withdr/i.test(x));
      say(`    section "${s.heading}"${s.under ? ` under "${s.under}"` : ""}: ${sentences.length ? sentences.map((x) => `"${x}"`).join(" ") : "no sentence mentions a runoff or a withdrawal"}`);
      if (s.withdrawn !== null) say(`      its "Withdrawn or disqualified candidates": "${s.withdrawn}"`);
    }
    const general = model.general.flatMap((g) => g.rows.filter((x) => (x.printedParty ?? x.party) === "R").map((x) => `${x.name}${x.underlined ? " (incumbent)" : ""}`));
    say(`    the general box's R candidate: ${general.join(", ") || "none"}`);
    check("E", `${r.id} prints no R runoff box`, runoffBox.length === 0, runoffBox.map((b) => b.h5).join("; ") || "none");
    report.push({ race: r.id, verdict: page.verdict, url: page.url, rBoxes: rBoxes.map((b) => ({ kind: b.kind, h5: b.h5, ...dateOf(b), marked: b.marked, rows: b.rows.map((x) => ({ name: x.name, winner: x.winner, underlined: x.underlined })) })), runoffBoxes: runoffBox.length, sections: secs, generalR: general });
  }
  say(`\n  requests ${paced.requests()} · minGapMs ${paced.minGapMs()}${stopped ? ` · STOPPED at the first UNREAD page: ${stopped}` : ""}`);
  writeFileSync(path.join(ART, SAVED ? "legE-report-saved-747.json" : "legE-report.json"), JSON.stringify({ at: new Date().toISOString(), saved: !!SAVED, report }, null, 1));
}

// ── W1 ──────────────────────────────────────────────────────────────────────
const W1_SQL = `UPDATE primaries SET runoff_date = '2026-06-23', updated_at = ?
 WHERE election_round = 'primary' AND runoff_date = '2026-08-25'
   AND id IN (${SC_IDS.map((id) => `'${id}'`).join(", ")})`;
async function w1() {
  const write = has("--write");
  say(`=== HO 773 W1 · SC's runoff dates · ${write ? "WRITE" : "dry"} · ${new Date().toISOString()} ===`);
  say(W1_SQL.replace(/^/gm, "  "));
  const reader = prodReader();
  const before = await rowsOf(reader, `SELECT id, runoff_date, updated_at FROM primaries WHERE id IN (${SC_IDS.map(() => "?").join(", ")}) AND election_round = 'primary' ORDER BY id`, SC_IDS);
  say(`  before: ${before.length} rows · runoff_date ${JSON.stringify([...new Set(before.map((r) => r.runoff_date))])}`);
  if (!write) {
    say("  dry: nothing was written.");
    reader.close();
    return;
  }
  const at = new Date().toISOString();
  const db = createClient({ url: prodUrl(), authToken: process.env.TURSO_AUTH_TOKEN });
  const rs = await db.execute({ sql: W1_SQL, args: [at] });
  db.close();
  say(`  at ${at} · rowsAffected ${rs.rowsAffected}`);
  check("W1", "rowsAffected", rs.rowsAffected === 14, String(rs.rowsAffected));
  const after = await rowsOf(reader, `SELECT id, runoff_date, updated_at FROM primaries WHERE id IN (${SC_IDS.map(() => "?").join(", ")}) ORDER BY id`, SC_IDS);
  for (const r of after) say(`  read back: ${JSON.stringify(r)}`);
  check("W1", "the fourteen read 2026-06-23 at the write's time", after.length === 14 && after.every((r) => r.runoff_date === "2026-06-23" && r.updated_at === at), `${after.length} rows`);
  reader.close();
}

async function main() {
  sweepFixtures();
  if (has("--m1")) await m1();
  else if (has("--m4")) await m4();
  else if (has("--m2")) await m2();
  else if (has("--m3")) await m3();
  else if (has("--m5")) await m5();
  else if (argAt("--leg") === "A") await legA();
  else if (argAt("--leg") === "B") await legB();
  else if (argAt("--leg") === "C") await legC();
  else if (argAt("--leg") === "D") await legD();
  else if (argAt("--leg") === "E") await legE();
  else if (has("--w1")) await w1();
  else throw new Error("a mode: --m1 | --m4 | --w1 [--write]");
  say(`\n${passes} passed, ${fails} failed`);
  if (fails) process.exitCode = 1;
}
main().catch((e) => {
  console.error(redactSecrets(String(e?.stack ?? e)));
  process.exit(1);
});
