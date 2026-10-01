// HO 764 legs: the primary ingest assigns a bioguide by identity (the row's Ballotpedia link against a
// member's title), or behind the incumbent gate (an underlined row, by surname), never by surname alone.
// On `file:` copies seeded whole from prod, with HO 747's saved pages, red first against HEAD (e91339a).
//   npx tsx scripts/diagnostic/primary-identity-legs-764.ts --seed --label L    the copies
//   npx tsx scripts/diagnostic/primary-identity-legs-764.ts --legs --label L    legs 1-5
//
// The copies, one template (the tree's migrate, 13 tables read whole from prod):
//   main   untouched: legs 1 and 2, and leg 3's and leg 5's "before"
//   rep    the repair, dry then --write, saved pages only: legs 3, 4 and 5's "after"
//   live   the repair with S-AK's and IL-04's saved pages withheld, so the live phase reads them (through
//          the shim, from the same saved files): leg 4
//   synch, synct  HEAD's and the tree's House sync over GA-01 and IL-04, both contests made unsettled
//          (their primary_date moved to 2026-12-01) and GA-01's R box given a planted namesake of its
//          member, Earl Carter (running for the Senate, so no row of his own): leg 3
//   harvb, harva  the challenger harvest on the copy before and after the repair: leg 5
//
//   1 the parser    red: HEAD's rows carry no key. The tree's S-AK rows: the two Dan Sullivans, two keys;
//                   IL-04's Patty Garcia's key is not García's title key; every kept row on the saved
//                   pages carries a key; every other field of every row equals HEAD's
//   2 the rule      HEAD's matcher and the tree's over every kept row of the saved pages, plus two planted
//                   rows: the senator ties by identity, the second Dan Sullivan and Patty Garcia read NULL
//                   (HEAD: the members'); an underlined untied title still ties by surname (TX-18's Al
//                   Green, CT-01's John Larson); an un-underlined namesake of Larson reads NULL (HEAD: his);
//                   every difference is a namesake cleared or an identity tie
//   3 the review    the whole-table list on main and on rep after the repair: García, Webster and Nehls
//                   join it and Wahab leaves it, nothing else; the sync's list over GA-01 and IL-04: HEAD's
//                   loses Carter to the planted namesake and García to Patty Garcia, the tree's names both
//   4 the repair    the dry run writes nothing (content hash); --write fills person_key and changes
//                   exactly STEP 0's 28 bioguides; a second dry run and --rematch change nothing; the live
//                   phase on the withheld copy ends where the saved phase does
//   5 the readers   the runoff block's rows follow the corrected bioguides (S-GA, S-LA, S-SC), TX-18's and
//                   TX-33's unchanged; the qualifier's and the harvest's outputs before and after, every
//                   difference named
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed and a fingerprint before and after every
// mode. Copies are `file:${abs}` from paths ending -764-legs.db; children get that URL with
// TURSO_AUTH_TOKEN="" and refuse any other. Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { redactSecrets } from "@/lib/redact";
import { houseDistrictUrl, senatePageUrl, titleKey } from "@/lib/primary-candidates-scrape";
import { stateName } from "@/lib/states";

config({ path: ".env", quiet: true });

const HEAD_SHA = "e91339a";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const CWD = path.join(DIR, "cwd-764");
const ART = path.resolve("docs/handoffs/764-artifacts");
const PAGES = path.resolve("docs/handoffs/747-artifacts/pages");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const TSCONFIG = path.resolve("tsconfig.json");
const CHILD = path.resolve("scripts/diagnostic/primary-identity-child-764.ts");
const STUB = pathToFileURL(path.resolve("scripts/diagnostic/next-cache-stub-757.mjs")).href;
const SHIM = path.resolve("scripts/diagnostic/runoff-pages-shim-761.cjs").replace(/\\/g, "/");
const TABLES = ["races", "members", "member_ids", "race_ratings", "race_candidates", "kalshi_odds", "polymarket_odds", "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads"];
const UNSETTLE = ["house-GA-01-2026-R", "house-GA-01-2026-D", "house-IL-04-2026-D", "house-IL-04-2026-R"];
const WITHHELD = ["S-AK-2026", "IL-04-2026"];
const PLANT_GA01 = { href: "https://ballotpedia.org/Pam_Carter_(planted_764)", name: "Pam Carter" };
// STEP 0 (docs/handoffs/764-artifacts/step0-764.txt), variant B: the 28 bioguides the rule changes, as
// "primary_id|name|old|new".
const EXPECTED = [
  "house-CA-14-2026-open|Aisha Wahab|NULL|W000832", "house-CA-38-2026-open|Monica Sanchez|S001156|NULL", "house-FL-11-2026-D|Royal Webster|W000806|NULL",
  "house-IL-04-2026-D|Patty Garcia|G000586|NULL", "house-TX-22-2026-R|Trever Nehls|N000026|NULL", "senate-AK-2026-open|Dan Sullivan|S001198|NULL",
  "senate-GA-2026-R|Earl Carter|NULL|C001103", "senate-GA-2026-R|Mike Collins|NULL|C001129", "senate-GA-2026-R-runoff|Mike Collins|NULL|C001129",
  "senate-IA-2026-R|Ashley Hinson|NULL|H001091", "senate-IL-2026-D|Raja Krishnamoorthi|NULL|K000391", "senate-IL-2026-D|Robin Kelly|NULL|K000385",
  "senate-KY-2026-R|Andy Barr|NULL|B001282", "senate-LA-2026-R|Julia Letlow|NULL|L000595", "senate-LA-2026-R-runoff|Julia Letlow|NULL|L000595",
  "senate-MA-2026-D|Seth Moulton|NULL|M001196", "senate-MI-2026-D|Haley Stevens|NULL|S001215", "senate-MN-2026-D|Angie Craig|NULL|C001119",
  "senate-NH-2026-D|Chris Pappas|NULL|P000614", "senate-OK-2026-R|Kevin Hern|NULL|H001082", "senate-SC-2026-special-R|Darline Graham|NULL|G000608",
  "senate-SC-2026-special-R|Ralph Norman|NULL|N000190", "senate-SC-2026-special-R|Russell Fry|NULL|F000478", "senate-SC-2026-special-R-runoff|Darline Graham|NULL|G000608",
  "senate-SC-2026-special-R-runoff|Ralph Norman|NULL|N000190", "senate-TX-2026-D|Jasmine Crockett|NULL|C001130", "senate-TX-2026-R|Wesley Hunt|NULL|H001095",
  "senate-WY-2026-R|Harriet Hageman|NULL|H001096",
];

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

// ── prod, read-only ─────────────────────────────────────────────────────────
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
  const fp = { primaries: await hash(`SELECT * FROM primaries ORDER BY id`), pc: await hash(`SELECT * FROM primary_candidates ORDER BY id`), rc: await hash(`SELECT * FROM race_candidates ORDER BY race_id, name`), schema: await hash(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`) };
  db.close();
  return JSON.stringify(fp);
}
async function prodUntouched(what: string, fp0: string) {
  const fp1 = await prodFingerprint();
  check("*", `prod untouched (${what})`, fp0 === fp1, fp0 === fp1 ? "fingerprints equal" : `${fp0} → ${fp1}`);
}

// ── copies ──────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-764-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-764-legs.db")) throw new Error(`refused: a copy must be a *-764-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
function childEnv(url: string, shim: { log: string; map: string } | null): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: children get file: only");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url, LEGS_764_HEAD_DIR: DIR };
  env.TURSO_AUTH_TOKEN = "";
  if (shim) { env.NODE_OPTIONS = `--require ${SHIM}`; env.SHIM_761_MAP = shim.map; env.SHIM_761_LOG = shim.log; }
  return env;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
function headFile(repoPath: string, out: string, append = ""): string {
  const src = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:${repoPath}`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 16 * 1024 * 1024 });
  const dst = path.join(DIR, out);
  writeFileSync(dst, src.replace(/from "\.\/([^"]+)"/g, (_, m: string) => `from "@/lib/${m}"`).replace(/from "\.\.\/([^"]+)"/g, (_, m: string) => `from "@/${m}"`) + append);
  return dst;
}
function child(args: string[], url: string, shim: { log: string; map: string } | null = null) {
  rmSync(CWD, { recursive: true, force: true }); // no .cache/ballotpedia: every page comes from the shim
  mkdirSync(CWD, { recursive: true });
  const r = spawnSync(process.execPath, [TSX, "--tsconfig", TSCONFIG, "--import", STUB, CHILD, ...args], { cwd: CWD, env: childEnv(url, shim), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const out = redactSecrets(`${r.stdout}\n${r.stderr}`);
  const line = (r.stdout ?? "").split(/\r?\n/).reverse().find((l) => l.startsWith("RESULT "));
  if (r.status !== 0 || !line) throw new Error(`child ${args.join(" ")} failed: ${out.slice(-2000)}`);
  return JSON.parse(line.slice(7));
}
const pcHash = (url: string) => withDb(url, async (db) => sha(JSON.stringify((await db.execute(`SELECT * FROM primary_candidates ORDER BY id`)).rows.map((r) => Object.values(r)))));

// The saved page of each race (the repair's own index), and a shim map: every race's URL → its file.
function savedIndex(): Map<string, string> {
  const out = new Map<string, string>();
  const runs = readdirSync(PAGES).filter((d) => /^\d{4}-\d\d-\d\dT/.test(d)).sort().reverse();
  for (const run of runs) for (const f of readdirSync(path.join(PAGES, run)).filter((f) => f.endsWith(".html.gz")).sort()) {
    const raceId = f.slice(0, f.indexOf("."));
    if (out.has(raceId)) continue;
    const file = path.join(PAGES, run, f);
    if (gunzipSync(readFileSync(file)).toString("utf8").includes('id="Candidates_and_election_results"')) out.set(raceId, file);
  }
  return out;
}
function raceUrl(raceId: string): string {
  const p = raceId.split("-");
  if (p[0] === "S") return senatePageUrl(stateName(p[1]!).replace(/ /g, "_"));
  return houseDistrictUrl(stateName(p[0]!).replace(/ /g, "_"), p[1] === "AL" ? 0 : Number(p[1]));
}
function shimFor(name: string, files: Map<string, string>): { log: string; map: string } {
  const map = Object.fromEntries([...files].map(([id, f]) => [raceUrl(id), f.replace(/\\/g, "/")]));
  const mapFile = path.join(DIR, `shim-map-${name}-${LABEL}-764.json`);
  const log = path.join(DIR, `shim-log-${name}-${LABEL}-764.txt`);
  writeFileSync(mapFile, JSON.stringify(map));
  if (existsSync(log)) rmSync(log);
  return { map: mapFile, log };
}
const shimLines = (s: { log: string }) => (existsSync(s.log) ? readFileSync(s.log, "utf8").trim().split("\n").filter(Boolean) : []);

// GA-01's page with a planted un-underlined namesake of Earl Carter in its Republican primary box.
function plantGa01(file: string): string {
  const html = gunzipSync(readFileSync(file)).toString("utf8");
  const a = html.indexOf('id="Candidates_and_election_results"');
  const h5 = html.indexOf("Republican primary for U.S. House Georgia District 1", a);
  const row0 = html.indexOf('<tr class="results_row', h5);
  const row1 = html.indexOf("</tr>", row0) + 5;
  const row = html.slice(row0, row1);
  const planted = row
    .replace(/class="results_row[^"]*"/, 'class="results_row "')
    .replace(/<\/?u>/g, "")
    .replace(/<a href="https:\/\/ballotpedia\.org\/[^"]*">[\s\S]*?<\/a>/, `<a href="${PLANT_GA01.href}">${PLANT_GA01.name}</a>`);
  if (h5 < 0 || row0 < 0 || !planted.includes(PLANT_GA01.href)) throw new Error("plant: GA-01's R box not found");
  const out = path.join(DIR, `GA-01-2026.planted-${LABEL}-764.html.gz`);
  writeFileSync(out, gzipSync(html.slice(0, row1) + planted + html.slice(row1)));
  return out;
}

// ── seed ────────────────────────────────────────────────────────────────────
async function seed() {
  mkdirSync(DIR, { recursive: true });
  mkdirSync(ART, { recursive: true });
  const fp0 = await prodFingerprint();
  const tpl = copyPath("template");
  if (existsSync(tpl)) rmSync(tpl);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: childEnv(copyUrl(tpl), null), encoding: "utf8" });
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
    const pk = (await db.execute(`SELECT COUNT(*) n, SUM(person_key IS NOT NULL) k FROM primary_candidates`)).rows[0]!;
    counts.push(`(primary_candidates.person_key: the column by the tree's migrate, ${pk.k ?? 0} of ${pk.n} set)`);
  });
  prod.close();
  for (const k of ["main", "rep", "live", "synch", "synct", "harvb"]) copyFileSync(tpl, copyPath(k));
  for (const k of ["synch", "synct"]) {
    const n = await withDb(copyUrl(copyPath(k)), async (db) => (await db.execute({ sql: `UPDATE primaries SET primary_date = '2026-12-01' WHERE id IN (${UNSETTLE.map(() => "?").join(",")})`, args: UNSETTLE })).rowsAffected);
    say(`  ${k}: ${n} contests unsettled (${UNSETTLE.join(", ")})`);
  }
  say(`template: the tree's migrate against file:, seeded whole from prod · ${counts.join(" · ")} · copies main, rep, live, synch, synct, harvb`);
  await prodUntouched("the seed", fp0);
}

// ── legs ────────────────────────────────────────────────────────────────────
type PRow = { raceId: string; round: string; contest: string; special: boolean; name: string; incumbent: boolean; winner: boolean; votePct: number | null; party: string; personKey: string | null };
async function legs() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim().slice(0, 10);
  say(`=== HO 764 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} · scrape ${blob("lib/primary-candidates-scrape.ts")} sync ${blob("lib/primaries-sync.ts")} repair ${blob("lib/primary-identity-repair.ts")} ballot ${blob("lib/general-ballot.ts")} · driver ${blob("scripts/diagnostic/primary-identity-legs-764.ts")} child ${blob(CHILD)} ===`);
  const fp0 = await prodFingerprint();
  headFile("lib/primary-candidates-scrape.ts", "head-scrape-764.ts");
  headFile("lib/primaries-sync.ts", "head-primaries-sync-764.ts", "\nexport { matchHouseCandidate, buildSenateMatcher, loadHouseMembers };\n");
  const M = copyUrl(copyPath("main"));
  const saved = savedIndex();
  const ident = await withDb(M, async (db) => {
    const rs = await db.execute(`SELECT bioguide_id, COALESCE(NULLIF(TRIM(ballotpedia_title_resolved), ''), ballotpedia_title) t FROM member_ids WHERE COALESCE(NULLIF(TRIM(ballotpedia_title_resolved), ''), NULLIF(TRIM(ballotpedia_title), '')) IS NOT NULL`);
    return new Map(rs.rows.map((r) => [titleKey(String(r.t).trim()), String(r.bioguide_id)]));
  });

  // ── leg 1
  say(`\n── leg 1: the parser keeps the href`);
  const ak = saved.get("S-AK-2026")!, il = saved.get("IL-04-2026")!;
  const akH = child(["parse", "--code", "head", "--file", ak], M).rows as Record<string, unknown>[];
  const akT = child(["parse", "--code", "tree", "--file", ak], M).rows as Record<string, unknown>[];
  const ilT = child(["parse", "--code", "tree", "--file", il], M).rows as Record<string, unknown>[];
  const sulH = akH.filter((r) => /Sullivan/.test(String(r.name)));
  const sulT = akT.filter((r) => /Sullivan/.test(String(r.name)));
  check("1", "red: HEAD's S-AK rows carry no key", sulH.length === 2 && sulH.every((r) => r.hasKeyField === false), JSON.stringify(sulH.map((r) => [r.name, r.hasKeyField])));
  check("1", "S-AK's two Dan Sullivans have different keys", sulT.length === 2 && new Set(sulT.map((r) => r.personKey)).size === 2 && sulT.every((r) => r.personKey), JSON.stringify(sulT.map((r) => [r.name, r.incumbent, r.personKey])));
  check("1", "the senator's key is his title's", sulT.some((r) => r.personKey === titleKey("Daniel S. Sullivan (United States Senator from Alaska)") && ident.get(String(r.personKey)) === "S001198"), `title key ${[...ident].find(([, b]) => b === "S001198")?.[0]}`);
  const patty = ilT.find((r) => r.name === "Patty Garcia");
  const garciaTitle = [...ident].find(([, b]) => b === "G000586")?.[0];
  check("1", "IL-04's Patty Garcia's key is not García's title key", !!patty?.personKey && patty.personKey !== garciaTitle, `Patty ${patty?.personKey} · García's ${garciaTitle}`);
  const allH = child(["parseall", "--code", "head", "--saved", PAGES], M) as { pages: number; rows: PRow[] };
  const allT = child(["parseall", "--code", "tree", "--saved", PAGES], M) as { pages: number; rows: PRow[] };
  const strip = (r: PRow) => JSON.stringify({ ...r, personKey: undefined });
  const same = allH.rows.length === allT.rows.length && allH.rows.every((r, i) => strip(r) === strip(allT.rows[i]!));
  check("1", "every saved page's kept rows equal HEAD's in every other field", same && allT.pages === allH.pages, `${allT.pages} pages · ${allT.rows.length} rows (HEAD ${allH.rows.length})`);
  const keyed = allT.rows.filter((r) => r.personKey).length;
  check("1", "every kept row carries a key", keyed === allT.rows.length, `${keyed} of ${allT.rows.length}`);
  writeFileSync(path.join(ART, `leg1-rows-${LABEL}.json`), JSON.stringify(allT.rows));

  // ── leg 2
  say(`\n── leg 2: the rule`);
  const races = await withDb(M, async (db) => new Map((await db.execute(`SELECT id, chamber, state, district FROM races`)).rows.map((r) => [String(r.id), { chamber: String(r.chamber), state: String(r.state), district: Number(r.district ?? 0) }])));
  const list = allT.rows.map((r) => {
    const rc = races.get(r.raceId);
    const st = r.raceId.split("-")[r.raceId.startsWith("S-") ? 1 : 0]!;
    return { k: `${r.raceId}|${r.round}|${r.contest}|${r.special ? "S" : ""}|${r.name}`, chamber: r.raceId.startsWith("S-") ? "senate" : "house", state: rc?.state ?? st, district: rc?.district ?? 0, name: r.name, incumbent: r.incumbent, personKey: r.personKey };
  });
  const planted = [
    { k: "PLANT|CT-01 un-underlined namesake of Larson", chamber: "house", state: "CT", district: 1, name: "Amy Larson", incumbent: false, personKey: "Amy_Larson_(planted_764)" },
    { k: "PLANT|S-AK senator's row, not underlined", chamber: "senate", state: "AK", district: 0, name: "Daniel S. Sullivan", incumbent: false, personKey: titleKey("Daniel S. Sullivan (United States Senator from Alaska)") },
  ];
  const listFile = path.join(DIR, `rule-list-${LABEL}-764.json`);
  writeFileSync(listFile, JSON.stringify([...list, ...planted]));
  const rH = child(["rule", "--code", "head", "--list", listFile], M) as Record<string, string | null>;
  const rT = child(["rule", "--code", "tree", "--list", listFile], M) as Record<string, string | null>;
  const pick = (re: RegExp) => list.filter((r) => re.test(r.k));
  const one = (k: string | undefined) => (k ? [rH[k] ?? null, rT[k] ?? null] : [undefined, undefined]);
  const senK = pick(/^S-AK-2026\|primary\|open\|\|Daniel S\. Sullivan$/)[0]?.k;
  const dan2 = pick(/^S-AK-2026\|primary\|open\|\|Dan Sullivan$/)[0]?.k;
  const pat = pick(/^IL-04-2026\|primary\|D\|\|Patty Garcia$/)[0]?.k;
  const green = pick(/^TX-18-2026\|primary\|D\|\|Al Green$/)[0]?.k;
  const larson = pick(/^CT-01-2026\|primary\|D\|\|John Larson$/)[0]?.k;
  check("2", "the senator's row ties to S001198, and by identity (not underlined, it still ties)", one(senK)[1] === "S001198" && rT["PLANT|S-AK senator's row, not underlined"] === "S001198", `tree ${one(senK)[1]} · un-underlined ${rT["PLANT|S-AK senator's row, not underlined"]} · HEAD ${one(senK)[0]}`);
  check("2", "red→green: the second Dan Sullivan", one(dan2)[0] === "S001198" && one(dan2)[1] === null, `HEAD ${one(dan2)[0]} → tree ${one(dan2)[1]}`);
  check("2", "red→green: Patty Garcia", one(pat)[0] === "G000586" && one(pat)[1] === null, `HEAD ${one(pat)[0]} → tree ${one(pat)[1]}`);
  check("2", "a gated fallback: TX-18's Al Green (underlined, title untied, moved by the redraw) ties by surname", one(green)[1] === "G000553" && !ident.has(String(list.find((r) => r.k === green)?.personKey)), `tree ${one(green)[1]} · key ${list.find((r) => r.k === green)?.personKey}`);
  check("2", "a gated fallback: CT-01's John Larson (underlined, title untied) ties to his seat by surname", one(larson)[1] === "L000557", `tree ${one(larson)[1]} · HEAD ${one(larson)[0]}`);
  check("2", "red→green: an un-underlined namesake of Larson reads NULL", rH["PLANT|CT-01 un-underlined namesake of Larson"] === "L000557" && rT["PLANT|CT-01 un-underlined namesake of Larson"] === null, `HEAD ${rH["PLANT|CT-01 un-underlined namesake of Larson"]} → tree ${rT["PLANT|CT-01 un-underlined namesake of Larson"]}`);
  const diffs = list.filter((r) => (rH[r.k] ?? null) !== (rT[r.k] ?? null));
  const cleared = diffs.filter((r) => rH[r.k] && rT[r.k] === null && !r.incumbent && ident.get(String(r.personKey)) !== rH[r.k]);
  const tiedNew = diffs.filter((r) => rT[r.k] && ident.get(String(r.personKey)) === rT[r.k]);
  const other = diffs.filter((r) => !cleared.includes(r) && !tiedNew.includes(r));
  check("2", "every difference from HEAD is a row cleared (not underlined, its link not the member's) or an identity tie", other.length === 0, `${diffs.length} differ: ${cleared.length} cleared, ${tiedNew.length} tied by identity, other ${other.length}${other.length ? ` (${other.map((r) => `${r.k} ${rH[r.k]}→${rT[r.k]}`).join("; ")})` : ""}`);
  // The cleared rows: STEP 0's five namesakes, and GA-13's Everton Blair Jr., who IS the member (B001328, the
  // seat's special-election winner): not underlined (the primary came first) and no member_ids title, so the
  // gate gives NULL where HEAD's ungated first test gave him. His stored row is NULL and stays NULL (leg 4).
  const CLEARED = ["CA-38-2026|primary|open||Monica Sanchez", "FL-11-2026|primary|D||Royal Webster", "GA-13-2026|primary|D||Everton Blair Jr.", "IL-04-2026|primary|D||Patty Garcia", "S-AK-2026|primary|open||Dan Sullivan", "TX-22-2026|primary|R||Trever Nehls"];
  check("2", "the cleared rows are STEP 0's five namesakes and GA-13's untitled member", JSON.stringify(cleared.map((r) => r.k).sort()) === JSON.stringify(CLEARED), cleared.map((r) => r.k).sort().join("; "));
  say(`    cleared: ${cleared.map((r) => `${r.k} (was ${rH[r.k]})`).join("; ")}`);
  say(`    tied by identity: ${tiedNew.map((r) => `${r.k} → ${rT[r.k]}${rH[r.k] ? ` (was ${rH[r.k]})` : ""}`).join("; ")}`);
  const uDiff = list.filter((r) => r.incumbent && (rH[r.k] ?? null) !== (rT[r.k] ?? null) && !tiedNew.includes(r));
  check("2", "every underlined row the title does not tie reads as HEAD read it", uDiff.length === 0, uDiff.map((r) => r.k).join("; ") || "none differ");

  // ── leg 4 (before leg 3: leg 3's "after" is the repaired copy)
  say(`\n── leg 4: the repair`);
  const R = copyUrl(copyPath("rep"));
  const h0 = await pcHash(R);
  const dry = child(["repair", "--saved", PAGES], R);
  const h1 = await pcHash(R);
  check("4", "the dry run writes nothing (content hash)", h0 === h1, `${h0} → ${h1} · it would set ${dry.keysFilled} keys and change ${dry.bioguideChanges.length} bioguides`);
  const wr = child(["repair", "--write", "--saved", PAGES], R);
  const got = (wr.bioguideChanges as { primaryId: string; name: string; oldBioguide: string | null; newBioguide: string | null }[]).map((c) => `${c.primaryId}|${c.name}|${c.oldBioguide ?? "NULL"}|${c.newBioguide ?? "NULL"}`).sort();
  const exp = [...EXPECTED].sort();
  check("4", "--write changes exactly STEP 0's 28 bioguides", JSON.stringify(got) === JSON.stringify(exp), got.length === exp.length ? `${got.length}` : `got ${got.length}: extra ${got.filter((g) => !exp.includes(g)).join("; ")} · missing ${exp.filter((e) => !got.includes(e)).join("; ")}`);
  for (const c of wr.bioguideChanges as { primaryId: string; name: string; oldBioguide: string | null; newBioguide: string | null; oldMember: string | null; newMember: string | null; newKey: string | null }[]) say(`    ${c.primaryId} "${c.name}" [${c.newKey}]: ${c.oldBioguide ? `${c.oldBioguide} (${c.oldMember})` : "NULL"} → ${c.newBioguide ? `${c.newBioguide} (${c.newMember})` : "NULL"}`);
  const stored = await withDb(R, async (db) => (await db.execute(`SELECT COUNT(*) n, SUM(person_key IS NOT NULL) k FROM primary_candidates`)).rows[0]!);
  check("4", "--write fills person_key for every row the saved pages tie, STEP 0's 2,470", Number(stored.k) === wr.tiedSaved && wr.keysFilled === wr.tiedSaved && wr.tiedSaved === 2470 && wr.untied.length === 126, `${stored.k} of ${stored.n} rows keyed · tied from saved pages ${wr.tiedSaved} · untied ${wr.untied.length} · ambiguous ${wr.ambiguous.length}`);
  say(`    untied: ${(wr.untied as string[]).length} rows on ${new Set((wr.untied as string[]).map((u) => u.split(" ")[0]!.replace(/-(D|R|open)(-runoff)?$/, ""))).size} contests; first 12: ${(wr.untied as string[]).slice(0, 12).join("; ")}`);
  writeFileSync(path.join(ART, `leg4-repair-${LABEL}.json`), JSON.stringify({ dry, write: wr }, null, 1));
  const again = child(["repair", "--saved", PAGES], R);
  const rem = child(["rematch"], R) as { lines: string[]; exitCode: number };
  const remChanged = rem.lines.find((l) => /^Linkage changed:/.test(l));
  check("4", "a second dry run and --rematch change nothing", again.changes.length === 0 && again.keptStored === 2470 && remChanged === "Linkage changed: 0", `second dry run ${again.changes.length} changes, ${again.keptStored} rows keeping their key · rematch "${remChanged}" · ${rem.lines.find((l) => /^rows scanned/.test(l))}`);
  const neMain = await withDb(M, async (db) => Number((await db.execute(`SELECT COUNT(DISTINCT m.bioguide_id) n FROM members m WHERE m.chamber = 'house' AND m.is_current = 1 AND m.state IN ('CT','ME','MA','NH','NJ','NY','PA','RI','VT') AND EXISTS (SELECT 1 FROM primary_candidates pc WHERE pc.bioguide_id = m.bioguide_id AND pc.primary_id LIKE 'house-%')`)).rows[0]!.n));
  say(`    --rematch's HO 94 spot-checks (exit ${rem.exitCode}): ${rem.lines.filter((l) => /^  (PASS|FAIL) — /.test(l)).map((l) => l.trim()).join(" | ")} · the Northeast count on the unrepaired copy is ${neMain}`);
  // The live phase: S-AK's and IL-04's saved pages withheld, read live through the shim from the same files.
  const L = copyUrl(copyPath("live"));
  const withheld = path.join(DIR, `saved-withheld-${LABEL}-764`);
  rmSync(withheld, { recursive: true, force: true });
  for (const [id, f] of saved) {
    if (WITHHELD.includes(id)) continue;
    const run = path.basename(path.dirname(f));
    mkdirSync(path.join(withheld, run), { recursive: true });
    copyFileSync(f, path.join(withheld, run, path.basename(f)));
  }
  const shimLive = shimFor("live", saved);
  const lv = child(["repair", "--write", "--saved", withheld, "--live"], L, shimLive);
  const liveRead = (lv.livePages as { raceId: string; verdict: string }[]);
  const [a, b] = await Promise.all([R, L].map((u) => withDb(u, async (db) => (await db.execute(`SELECT id, person_key, bioguide_id FROM primary_candidates ORDER BY id`)).rows.map((r) => `${r.id}|${r.person_key}|${r.bioguide_id}`))));
  const differ = a!.filter((x, i) => x !== b![i]);
  check("4", "the live phase reads the withheld pages and ends where the saved phase does", WITHHELD.every((id) => liveRead.some((p) => p.raceId === id && p.verdict === "READ")) && differ.length === 0 && lv.stoppedAt === null, `live pages ${liveRead.length} (READ ${liveRead.filter((p) => p.verdict === "READ").length}) · tied live ${lv.tiedLive} · shim answers ${shimLines(shimLive).length} · rows differing from the saved-only copy ${differ.length}`);
  const FRESH = "Dan_Sullivan_(a_later_live_key_764)";
  await withDb(L, (db) => db.execute({ sql: `UPDATE primary_candidates SET person_key = ? WHERE primary_id = 'senate-AK-2026-open' AND name = 'Dan Sullivan'`, args: [FRESH] }));
  const kept = child(["repair", "--saved", PAGES], L);
  const dan = (kept.changes as { name: string; primaryId: string }[]).filter((c) => c.primaryId === "senate-AK-2026-open");
  check("4", "a saved page never replaces a key the row carries (a planted later key on the second Dan Sullivan)", kept.changes.length === 0 && dan.length === 0, `dry run on the live copy: ${kept.changes.length} changes · ${kept.keptStored} rows keeping their key`);

  // ── leg 3
  say(`\n── leg 3: the review list`);
  const list3 = (u: string) => withDb(u, async (db) => (await db.execute(`SELECT m.bioguide_id FROM members m WHERE m.chamber = 'house' AND m.is_current = 1 AND NOT EXISTS (SELECT 1 FROM primary_candidates pc WHERE pc.bioguide_id = m.bioguide_id AND pc.primary_id LIKE 'house-%')`)).rows.map((r) => String(r.bioguide_id)));
  const before = new Set(await list3(M)), after = new Set(await list3(R));
  const joined = [...after].filter((x) => !before.has(x)).sort(), left = [...before].filter((x) => !after.has(x)).sort();
  check("3", "red: García, Webster and Nehls are off the whole-table list before the repair (their namesakes' rows carry them)", !before.has("G000586") && !before.has("W000806") && !before.has("N000026"), `before: ${before.size} on the list`);
  check("3", "after the repair García, Webster and Nehls join it and Wahab leaves it, nothing else", JSON.stringify(joined) === JSON.stringify(["G000586", "N000026", "W000806"]) && JSON.stringify(left) === JSON.stringify(["W000832"]), `joined ${joined.join(", ")} · left ${left.join(", ")} · ${before.size} → ${after.size}`);
  const syncFiles = new Map([["IL-04-2026", saved.get("IL-04-2026")!], ["GA-01-2026", plantGa01(saved.get("GA-01-2026")!)]]);
  const sH = shimFor("synch", syncFiles), sT = shimFor("synct", syncFiles);
  const syH = child(["sync", "--code", "head", "--districts", "GA-1,IL-4"], copyUrl(copyPath("synch")), sH) as { matchesLine: string; notFound: string[] };
  const syT = child(["sync", "--code", "tree", "--districts", "GA-1,IL-4"], copyUrl(copyPath("synct")), sT) as { matchesLine: string; notFound: string[] };
  const on = (s: { notFound: string[] }, b: string) => s.notFound.some((l) => l.includes(`(${b})`));
  check("3", "red: HEAD's list loses Carter to the planted namesake and García to Patty Garcia", !on(syH, "C001103") && !on(syH, "G000586"), `${syH.matchesLine} · not found: ${syH.notFound.join(" | ") || "none"} · shim ${shimLines(sH).length} answers`);
  check("3", "the tree's list names Carter and García", on(syT, "C001103") && on(syT, "G000586"), `${syT.matchesLine} · not found: ${syT.notFound.join(" | ") || "none"} · shim ${shimLines(sT).length} answers`);
  const planted3 = await withDb(copyUrl(copyPath("synct")), async (db) => (await db.execute(`SELECT primary_id, name, incumbent, bioguide_id, person_key FROM primary_candidates WHERE name IN ('Pam Carter', 'Patty Garcia') ORDER BY name`)).rows.map((r) => `${r.primary_id} "${r.name}" u=${r.incumbent} ${r.bioguide_id ?? "NULL"} [${r.person_key}]`));
  const planted3h = await withDb(copyUrl(copyPath("synch")), async (db) => (await db.execute(`SELECT primary_id, name, bioguide_id FROM primary_candidates WHERE name IN ('Pam Carter', 'Patty Garcia') ORDER BY name`)).rows.map((r) => `${r.primary_id} "${r.name}" ${r.bioguide_id ?? "NULL"}`));
  say(`    stored by the tree's sync: ${planted3.join(" · ")} · by HEAD's: ${planted3h.join(" · ")}`);

  // ── leg 5
  say(`\n── leg 5: the readers`);
  const RUNOFF_RACES = ["S-GA-2026", "S-LA-2026", "S-SC-2026", "TX-18-2026", "TX-33-2026"];
  const roB = child(["runoffs", "--races", RUNOFF_RACES.join(",")], M) as Record<string, { id: string; candidates: string }[]>;
  const roA = child(["runoffs", "--races", RUNOFF_RACES.join(",")], R) as Record<string, { id: string; candidates: string }[]>;
  const bios = (x: Record<string, { candidates?: unknown }[]>, id: string) => JSON.stringify(x[id] ?? []).match(/[A-Z]\d{6}/g)?.join(",") ?? "";
  for (const id of RUNOFF_RACES) say(`    ${id}: before ${bios(roB, id) || "(none)"} · after ${bios(roA, id) || "(none)"}`);
  check("5", "the runoff block's rows follow the corrected bioguides", bios(roA, "S-GA-2026").includes("C001129") && bios(roA, "S-LA-2026").includes("L000595") && bios(roA, "S-SC-2026").includes("G000608") && bios(roA, "S-SC-2026").includes("N000190") && !bios(roB, "S-GA-2026").includes("C001129"), "S-GA Collins, S-LA Letlow, S-SC Graham and Norman linked after, not before");
  check("5", "TX-18's and TX-33's runoff rows unchanged", bios(roB, "TX-18-2026") === bios(roA, "TX-18-2026") && bios(roB, "TX-33-2026") === bios(roA, "TX-33-2026"), `TX-18 ${bios(roA, "TX-18-2026")} · TX-33 ${bios(roA, "TX-33-2026")}`);
  writeFileSync(path.join(ART, `leg5-runoffs-${LABEL}.json`), JSON.stringify({ before: roB, after: roA }, null, 1));
  const qB = child(["qualifier"], M) as Record<string, unknown>;
  const qA = child(["qualifier"], R) as Record<string, unknown>;
  const qDiff = Object.keys({ ...qB, ...qA }).filter((k) => JSON.stringify(qB[k]) !== JSON.stringify(qA[k])).sort();
  say(`    qualifier: ${Object.keys(qB).length} races read · ${qDiff.length} differ`);
  for (const k of qDiff) say(`      ${k}: ${JSON.stringify(qB[k])} → ${JSON.stringify(qA[k])}`);
  writeFileSync(path.join(ART, `leg5-qualifier-${LABEL}.json`), JSON.stringify({ before: qB, after: qA, differ: qDiff }, null, 1));
  copyFileSync(copyPath("rep"), copyPath("harva"));
  const hb = child(["harvest"], copyUrl(copyPath("harvb")));
  const ha = child(["harvest"], copyUrl(copyPath("harva")));
  const rc = (k: string) => withDb(copyUrl(copyPath(k)), async (db) => (await db.execute(`SELECT race_id, name, party, bioguide_id, status, source_url FROM race_candidates ORDER BY race_id, name`)).rows.map((r) => `${r.race_id}|${r.name}|${r.party}|${r.bioguide_id ?? "NULL"}|${r.status}|${r.source_url}`));
  const [rb, ra] = [await rc("harvb"), await rc("harva")];
  const hOnlyB = rb.filter((x) => !ra.includes(x)), hOnlyA = ra.filter((x) => !rb.includes(x));
  say(`    harvest: before ${hb.rows} rows on ${hb.races} races · after ${ha.rows} on ${ha.races} · only before: ${hOnlyB.join("; ") || "none"} · only after: ${hOnlyA.join("; ") || "none"}`);
  writeFileSync(path.join(ART, `leg5-harvest-${LABEL}.json`), JSON.stringify({ before: hb, after: ha, onlyBefore: hOnlyB, onlyAfter: hOnlyA }, null, 1));
  const changedBios = new Set(EXPECTED.flatMap((e) => e.split("|").slice(2)).filter((b) => b !== "NULL"));
  const hUnexplained = [...hOnlyB, ...hOnlyA].filter((x) => { const [race, name, , bio] = x.split("|"); return !changedBios.has(bio!) && !EXPECTED.some((e) => e.split("|")[1] === name) && !rb.concat(ra).some((y) => y.startsWith(`${race}|${name}|`) && changedBios.has(y.split("|")[3]!)); });
  check("5", "the harvest publishes the same rows before and after, except where a corrected bioguide reaches it", hUnexplained.length === 0, `${hOnlyB.length + hOnlyA.length} rows differ · unexplained ${hUnexplained.join("; ") || "none"}`);

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
