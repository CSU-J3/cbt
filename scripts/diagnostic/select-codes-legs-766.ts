// HO 766 legs: the members step maps the YAML's House select bodies (HSZS, HSQJ) to Congress.gov's `hl…`
// codes, and the daily-comment chore. On `file:` copies seeded from prod, red first against HEAD (5b03c9d).
//   npx tsx scripts/diagnostic/select-codes-legs-766.ts --seed --label L    the copies
//   npx tsx scripts/diagnostic/select-codes-legs-766.ts --legs --label L    legs 1-3
//
// The copies, one template (the tree's migrate; `committees`, `committee_members`, `members` read whole
// from prod), four writes: head and tree (leg 1, the saved YAML), guardh and guardt (leg 2: the saved YAML
// plus a planted HSXX with one member, and a planted `hlag00` row in `committees` beside the real hsag00).
// The YAML is HO 766's STEP 0 copy (docs/handoffs/766-artifacts/committee-membership-current.yaml), served
// by committee-yaml-shim-766.cjs: no leg fetches.
//
//   1 the mapping  red: HEAD writes 0 rows under hlzs00 and hlqj00 and names four unknowns; the tree writes
//                  24 and 7, names SSCM39 and SSJU27 only, maps the two; every other committee's rows equal
//   2 the guard    the planted HSXX (no hlxx00) stays unknown; HSAG, known as hsag00, is written as HEAD
//                  writes it and the planted hlag00 gets nothing
//   3 the comments red: the line's own grep reads 19 lines at HEAD; it reads 0 lines on the tree, beside a
//                  control that plants one phrase in an untracked file and reads 1
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed and a fingerprint before and after every
// mode. Copies are `file:${abs}` from paths ending -766-legs.db; children get that URL with
// TURSO_AUTH_TOKEN="" and refuse any other. Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "5b03c9d";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const CWD = path.join(DIR, "cwd-766");
const ART = path.resolve("docs/handoffs/766-artifacts");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const TSCONFIG = path.resolve("tsconfig.json");
const CHILD = path.resolve("scripts/diagnostic/select-codes-child-766.ts");
const STUB = pathToFileURL(path.resolve("scripts/diagnostic/next-cache-stub-757.mjs")).href;
const SHIM = path.resolve("scripts/diagnostic/committee-yaml-shim-766.cjs").replace(/\\/g, "/");
const YAML = path.join(ART, "committee-membership-current.yaml");
const TABLES = ["committees", "committee_members", "members"];
// The backlog line's own close-criterion grep (HO 755's fact check).
const LINE_PATTERN = "once daily|kept fresh by the daily cron|from the daily sync|the daily sync|daily cron cadence|The cron runs daily|per daily tick|while /api/sync is daily|09:00 UTC cron tick|daily route re-checks|next day.s (run|catch-up)|single daily tick|^// Daily sync cron|Weekly-report daily catch-up|so the daily refresh|the daily run touches|the daily cadence makes";

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const say = (s: string) => console.log(redactSecrets(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [leg ${leg}] ${label}: ${detail}`);
  if (ok) passes++; else fails++;
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function prodClient(): Client {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env");
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}
const reader = (db: Client) => (sql: string) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("prod is read-only here");
  return db.execute(sql);
};
async function prodFingerprint(): Promise<string> {
  const db = prodClient();
  const read = reader(db);
  const hash = async (q: string) => sha(JSON.stringify((await read(q)).rows.map((r) => Object.values(r))));
  const fp = { committees: await hash(`SELECT * FROM committees ORDER BY system_code`), members: await hash(`SELECT committee_system_code, bioguide_id, role, party_side, rank FROM committee_members ORDER BY committee_system_code, bioguide_id`), schema: await hash(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`) };
  db.close();
  return JSON.stringify(fp);
}
async function prodUntouched(what: string, fp0: string) {
  // One logged retry: a pooled connection can be closed by the server over a long mode (HO 765).
  const fp1 = await prodFingerprint().catch(async (e) => {
    say(`  (prod fingerprint read failed once: ${String(e?.message ?? e)}; retrying)`);
    await sleep(2000);
    return prodFingerprint();
  });
  check("*", `prod untouched (${what})`, fp0 === fp1, fp0 === fp1 ? "fingerprints equal" : `${fp0} → ${fp1}`);
}
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-766-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-766-legs.db")) throw new Error(`refused: a copy must be a *-766-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
function child(code: "head" | "tree", url: string, yamlFile: string) {
  if (!url.startsWith("file:")) throw new Error("refused: children get file: only");
  rmSync(CWD, { recursive: true, force: true });
  mkdirSync(CWD, { recursive: true });
  const log = path.join(DIR, `shim-log-${code}-${LABEL}-766.txt`);
  if (existsSync(log)) rmSync(log);
  const e: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url, LEGS_766_HEAD_DIR: DIR, NODE_OPTIONS: `--require ${SHIM}`, SHIM_766_YAML: yamlFile, SHIM_766_LOG: log };
  e.TURSO_AUTH_TOKEN = "";
  const r = spawnSync(process.execPath, [TSX, "--tsconfig", TSCONFIG, "--import", STUB, CHILD, "members", "--code", code], { cwd: CWD, env: e, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = redactSecrets(`${r.stdout}\n${r.stderr}`);
  const line = (r.stdout ?? "").split(/\r?\n/).reverse().find((l) => l.startsWith("RESULT "));
  if (r.status !== 0 || !line) throw new Error(`child ${code} failed: ${out.slice(-2000)}`);
  const shimmed = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0;
  return { result: JSON.parse(line.slice(7)) as { committeesSeen: number; membersUpserted: number; unknownCommittees: string[]; mappedCommittees?: string[]; rosterDeletesRefused: string[] }, shimmed };
}
const rosterCounts = (url: string) => withDb(url, async (db) => new Map((await db.execute(`SELECT committee_system_code c, COUNT(*) n FROM committee_members GROUP BY c`)).rows.map((r) => [String(r.c), Number(r.n)])));
const rosterRows = (url: string, code: string) => withDb(url, async (db) => (await db.execute({ sql: `SELECT bioguide_id, role, party_side, rank FROM committee_members WHERE committee_system_code = ? ORDER BY bioguide_id`, args: [code] })).rows.map((r) => Object.values(r).join("|")));

async function seed() {
  mkdirSync(DIR, { recursive: true });
  const fp0 = await prodFingerprint();
  const tpl = copyPath("template");
  if (existsSync(tpl)) rmSync(tpl);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: { ...process.env, TURSO_DATABASE_URL: copyUrl(tpl), TURSO_AUTH_TOKEN: "" }, encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the template failed: ${redactSecrets((mig.stderr || mig.stdout).slice(-600))}`);
  const prod = prodClient();
  const read = reader(prod);
  const counts: string[] = [];
  await withDb(copyUrl(tpl), async (db) => {
    await db.execute("PRAGMA foreign_keys = OFF");
    for (const t of TABLES) {
      const cols = new Set((await db.execute(`PRAGMA table_info(${t})`)).rows.map((r) => String(r.name)));
      const rows = (await read(`SELECT * FROM ${t}`)).rows;
      const use = rows.length ? Object.keys(rows[0]!).filter((c) => cols.has(c)) : [];
      const stmts: InStatement[] = [{ sql: `DELETE FROM ${t}`, args: [] }];
      for (const r of rows) stmts.push({ sql: `INSERT INTO ${t} (${use.join(",")}) VALUES (${use.map(() => "?").join(",")})`, args: use.map((c) => (r as Record<string, unknown>)[c] as never) });
      for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500), "write");
      counts.push(`${t} ${rows.length}`);
    }
  });
  prod.close();
  for (const k of ["head", "tree", "guardh", "guardt"]) copyFileSync(tpl, copyPath(k));
  for (const k of ["guardh", "guardt"]) {
    await withDb(copyUrl(copyPath(k)), async (db) => {
      const hsag = (await db.execute(`SELECT name, chamber, committee_type FROM committees WHERE system_code = 'hsag00'`)).rows[0];
      if (!hsag) throw new Error("hsag00 not in committees");
      await db.execute({ sql: `INSERT INTO committees (system_code, name, chamber, committee_type, updated_at) VALUES ('hlag00', ?, ?, 'Select', ?)`, args: [`Planted (HO 766 legs): ${hsag.name}`, String(hsag.chamber), new Date().toISOString()] });
    });
  }
  const planted = readFileSync(YAML, "utf8").replace(/\s*$/, "\n") + "HSXX:\n- name: Planted Member\n  party: majority\n  rank: 1\n  bioguide: A000055\n";
  writeFileSync(path.join(DIR, `yaml-guard-${LABEL}-766.yaml`), planted);
  say(`template: the tree's migrate against file:, seeded whole from prod · ${counts.join(" · ")} · copies head, tree, guardh, guardt (the guard pair with hlag00 planted in committees, and a YAML with HSXX appended)`);
  await prodUntouched("the seed", fp0);
}

async function legs() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim().slice(0, 10);
  say(`=== HO 766 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} · committees-sync ${blob("lib/committees-sync.ts")} route ${blob("app/api/cron/committees/route.ts")} · driver ${blob("scripts/diagnostic/select-codes-legs-766.ts")} child ${blob(CHILD)} shim ${blob(SHIM)} · YAML sha ${sha(readFileSync(YAML, "utf8"))} ===`);
  const fp0 = await prodFingerprint();
  const src = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:lib/committees-sync.ts`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  writeFileSync(path.join(DIR, "head-committees-sync-766.ts"), src.replace(/from "\.\/([^"]+)"/g, (_, m: string) => `from "@/lib/${m}"`));

  say(`\n── leg 1: the mapping (the saved YAML)`);
  const H = copyUrl(copyPath("head")), T = copyUrl(copyPath("tree"));
  const h = child("head", H, YAML), t = child("tree", T, YAML);
  const [ch, ct] = [await rosterCounts(H), await rosterCounts(T)];
  check("1", "red: HEAD writes nothing under hlzs00 and hlqj00 and names four unknowns", (ch.get("hlzs00") ?? 0) === 0 && (ch.get("hlqj00") ?? 0) === 0 && h.result.unknownCommittees.length === 4 && h.shimmed === 1, `hlzs00 ${ch.get("hlzs00") ?? 0} · hlqj00 ${ch.get("hlqj00") ?? 0} · unknown ${JSON.stringify(h.result.unknownCommittees)} · shim answers ${h.shimmed}`);
  check("1", "the tree writes 24 and 7, maps the two, and names only the Senate pair", t.shimmed === 1 && (ct.get("hlzs00") ?? 0) === 24 && (ct.get("hlqj00") ?? 0) === 7 && JSON.stringify(t.result.unknownCommittees) === JSON.stringify(["SSCM39→sscm39", "SSJU27→ssju27"]) && JSON.stringify(t.result.mappedCommittees) === JSON.stringify(["HSZS→hlzs00", "HSQJ→hlqj00"]), `hlzs00 ${ct.get("hlzs00") ?? 0} · hlqj00 ${ct.get("hlqj00") ?? 0} · unknown ${JSON.stringify(t.result.unknownCommittees)} · mapped ${JSON.stringify(t.result.mappedCommittees)} · shim answers ${t.shimmed}`);
  const codes = new Set([...ch.keys(), ...ct.keys()]);
  const differ: string[] = [];
  for (const c of codes) if (c !== "hlzs00" && c !== "hlqj00" && JSON.stringify(await rosterRows(H, c)) !== JSON.stringify(await rosterRows(T, c))) differ.push(c);
  check("1", "every other committee's rows are the same as HEAD writes them", differ.length === 0, `${codes.size} codes compared · differing ${differ.join(", ") || "none"} · committeesSeen HEAD ${h.result.committeesSeen} → tree ${t.result.committeesSeen} · upserted ${h.result.membersUpserted} → ${t.result.membersUpserted}`);

  say(`\n── leg 2: the guard (HSXX planted with no hlxx00; hlag00 planted beside the real hsag00)`);
  const GY = path.join(DIR, `yaml-guard-${LABEL}-766.yaml`);
  const GH = copyUrl(copyPath("guardh")), GT = copyUrl(copyPath("guardt"));
  const gh = child("head", GH, GY), gt = child("tree", GT, GY);
  check("2", "the planted HSXX stays unknown on the tree (no hlxx00)", gt.result.unknownCommittees.includes("HSXX→hsxx00") && !(gt.result.mappedCommittees ?? []).some((m) => m.startsWith("HSXX")), `unknown ${JSON.stringify(gt.result.unknownCommittees)} · mapped ${JSON.stringify(gt.result.mappedCommittees)}`);
  const [hagH, hagT, hlagT] = [await rosterRows(GH, "hsag00"), await rosterRows(GT, "hsag00"), await rosterRows(GT, "hlag00")];
  check("2", "HSAG, known as hsag00, is written exactly as HEAD writes it, and the planted hlag00 gets nothing", hagT.length > 0 && JSON.stringify(hagH) === JSON.stringify(hagT) && hlagT.length === 0, `hsag00 HEAD ${hagH.length} rows · tree ${hagT.length} rows, equal ${JSON.stringify(hagH) === JSON.stringify(hagT)} · hlag00 ${hlagT.length} rows`);

  say(`\n── leg 3: the comments`);
  const grep = (untracked: boolean) => {
    const r = spawnSync("git", ["grep", ...(untracked ? ["--untracked"] : []), "-nE", LINE_PATTERN, "--", "app", "lib", "scripts", ":!scripts/diagnostic"], { encoding: "utf8" });
    return (r.stdout ?? "").split("\n").filter(Boolean);
  };
  const atHead = spawnSync("git", ["grep", "-nE", LINE_PATTERN, HEAD_SHA, "--", "app", "lib", "scripts", ":!scripts/diagnostic"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  check("3", `red: the line's own grep reads STEP 0's 19 lines at HEAD (${HEAD_SHA})`, atHead.length === 19, `${atHead.length} lines over ${new Set(atHead.map((l) => l.split(":")[1])).size} files`);
  const atTree = grep(false);
  const plant = path.resolve("lib/__planted-766-control.ts");
  let control: string[] = [];
  try {
    writeFileSync(plant, "// the daily sync (HO 766 legs: a planted control line, removed at once)\n");
    control = grep(true);
  } finally {
    rmSync(plant, { force: true });
  }
  check("3", "the line's own grep reads 0 lines on the tree", atTree.length === 0, atTree.join(" | ") || "0 lines");
  check("3", "the control: one planted phrase reads 1 line, and the plant is gone after", control.length === 1 && control[0]!.includes("__planted-766-control") && !existsSync(plant), `${control.length} line(s): ${control.join(" | ")}`);

  await prodUntouched("the legs", fp0);
  say(`\n${passes} pass, ${fails} fail`);
}

async function main() {
  if (process.argv.includes("--seed")) await seed();
  else if (process.argv.includes("--legs")) await legs();
  else throw new Error("--seed | --legs");
}
main().catch((e) => {
  console.error(redactSecrets(String(e?.stack ?? e)));
  process.exit(1);
});
