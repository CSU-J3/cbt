// HO 751 — the legs for the Ballotpedia title repair, on `file:` copies seeded
// from prod, each seen red first.
//
//   npx tsx scripts/diagnostic/repair-titles-legs-751.ts            # all five legs
//   npx tsx scripts/diagnostic/repair-titles-legs-751.ts --leg 4    # one leg
//
//   Leg 1, the confirmation signals, as ruled (redirect, disambiguation, and the
//     name check whole or by prefix), on the pages the dry run recorded
//     (docs/handoffs/751-artifacts/recorded, replayed, no network): S-AK's senator
//     by disambiguation, a redirect case, CA-14 by name, NJ-04 by prefix, WA-09 by
//     the fallback; the "Nobody Here (Nowhere)" control and a surname-swapped
//     control fail and are written nowhere.
//   Leg 2, the map prefers resolved: one member's resolved title on a copy, the
//     identity map rebuilt, pageResult re-run on the saved page, and the row
//     carries the bioguide, the rule's route moving underline-surname → identity.
//   Leg 3, the crosswalk can't clobber: the crosswalk's own upsert (its SQL text,
//     read from scripts/sync-crosswalk.ts) with the old upstream title leaves the
//     resolved columns untouched; red: a repair written into ballotpedia_title is
//     lost to the same upsert.
//   Leg 4, the whole effect: every confirmed title written on a copy, the 45
//     races re-read from HO 747's saved pages through the reader's own
//     pageResult and raceWriteStatements, and the harvest run: underline-surname
//     0 over its races, Casar, Moore and Kennedy published with their bioguides,
//     S-ME's Collins tied by identity; red: the unrepaired copy reads 41 and NULL.
//   Leg 5, dry means dry: the script itself, spawned against a copy, changes no
//     byte of member_ids (a content hash), and its --write writes exactly the
//     confirmed members.
//
// SAFETY. Prod is read through a reader that refuses anything but SELECT, to
// seed the copies and to fingerprint (a sha256 of every row of member_ids,
// general_ballot and race_candidates, and of the schema) before and after.
// Every copy is `file:${abs}` from a path that must end in -751-control.db.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement, type ResultSet } from "@libsql/client";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { findIncumbentOnBallot, type BallotPerson } from "@/lib/ballot-incumbent";
import { canonicalKeyOf, confirmCases, findStaleTitles, isDisambiguation, linkedKeys, resolvedWriteStatements, tokenCheck, type TitleCase } from "@/lib/ballotpedia-title-repair";
import { loadIdentity, pageResult, raceWriteStatements, readPageModel, titleKey, type IO } from "@/lib/general-ballot";
import { harvestChallengers } from "@/lib/harvest-challengers";

config({ path: ".env", quiet: true });
const ART = "docs/handoffs/751-artifacts";
const RECORDED = `${ART}/recorded`;
const RUN747 = "docs/handoffs/747-artifacts/run-2026-09-25T19-56-59-291Z";
const PROD_URL = process.env.TURSO_DATABASE_URL ?? "";
const PROD_TOKEN = process.env.TURSO_AUTH_TOKEN;
const S = (v: unknown) => (v == null ? null : String(v));

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
  if (!ok) failures++;
}

// ── copies ─────────────────────────────────────────────────────────────────
function reader(db: Client) {
  return (sql: string, args?: InArgs): Promise<ResultSet> => {
    if (sql.trim().split(/\s+/)[0]!.toUpperCase() !== "SELECT") throw new Error("read-only: refused");
    return db.execute({ sql, args: args ?? [] });
  };
}
function schemeOf(url: string, what: string) {
  if (url.split(":")[0] !== "file") throw new Error(`refused: ${what} runs against file: only`);
}
function copyClient(url: string, what: string): Client {
  schemeOf(url, what);
  return createClient({ url });
}
async function copyWrite(url: string, stmts: InStatement[], what: string): Promise<number[]> {
  const c = copyClient(url, what);
  try {
    return (await c.batch(stmts, "write")).map((r) => r.rowsAffected);
  } finally {
    c.close();
  }
}
function ddlFromMigrate(table: string): string {
  const src = readFileSync("scripts/migrate.ts", "utf8").replace(/\r\n/g, "\n");
  const m = src.match(new RegExp("`(CREATE TABLE IF NOT EXISTS " + table + " \\([\\s\\S]*?\\n  \\))`"));
  if (!m?.[1]) throw new Error(`migrate.ts has no CREATE TABLE for ${table}`);
  return m[1];
}
const MEMBER_IDS_COLS = ["bioguide_id", "icpsr", "govtrack", "lis", "thomas", "cspan", "votesmart", "wikidata", "wikipedia_title", "ballotpedia_title", "google_entity_id", "opensecrets", "maplight", "house_history", "pictorial", "raw_json", "fetched_at"];
const TABLES: { table: string; ddl: string; cols: string[] }[] = [
  { table: "races", ddl: `CREATE TABLE races (id TEXT PRIMARY KEY, cycle INTEGER NOT NULL, chamber TEXT NOT NULL, state TEXT NOT NULL, district INTEGER, rating TEXT, incumbent_bioguide_id TEXT, incumbent_running INTEGER)`, cols: ["id", "cycle", "chamber", "state", "district", "rating", "incumbent_bioguide_id", "incumbent_running"] },
  { table: "primaries", ddl: `CREATE TABLE primaries (id TEXT PRIMARY KEY, state TEXT NOT NULL, district TEXT, chamber TEXT NOT NULL, party TEXT NOT NULL, primary_date TEXT, primary_type TEXT, race_id TEXT, election_round TEXT)`, cols: ["id", "state", "district", "chamber", "party", "primary_date", "primary_type", "race_id", "election_round"] },
  { table: "primary_candidates", ddl: `CREATE TABLE primary_candidates (id INTEGER PRIMARY KEY, primary_id TEXT NOT NULL, name TEXT NOT NULL, party TEXT NOT NULL, incumbent INTEGER, bioguide_id TEXT, status TEXT)`, cols: ["id", "primary_id", "name", "party", "incumbent", "bioguide_id", "status"] },
  { table: "race_candidates", ddl: `CREATE TABLE race_candidates (race_id TEXT NOT NULL, name TEXT NOT NULL, party TEXT, bioguide_id TEXT, status TEXT, source_url TEXT, updated_at TEXT, PRIMARY KEY (race_id, name))`, cols: ["race_id", "name", "party", "bioguide_id", "status", "source_url", "updated_at"] },
  { table: "race_ratings", ddl: `CREATE TABLE race_ratings (id TEXT PRIMARY KEY, race_id TEXT NOT NULL, source TEXT, rating TEXT, cycle INTEGER NOT NULL)`, cols: ["id", "race_id", "source", "rating", "cycle"] },
  { table: "members", ddl: `CREATE TABLE members (bioguide_id TEXT PRIMARY KEY, name TEXT, first_name TEXT, last_name TEXT, state TEXT, chamber TEXT, district INTEGER, party TEXT, is_current INTEGER NOT NULL DEFAULT 1)`, cols: ["bioguide_id", "name", "first_name", "last_name", "state", "chamber", "district", "party", "is_current"] },
  { table: "member_ids", ddl: "", cols: MEMBER_IDS_COLS },
  { table: "general_ballot", ddl: "", cols: ["race_id", "person_key", "name", "printed_party", "party", "incumbent_marked", "write_in", "on_ballot", "withdrawn", "primary_marked", "bioguide_id", "box_prefix", "read_at"] },
  { table: "general_ballot_reads", ddl: "", cols: ["race_id", "status", "read_at", "rows", "marked", "source_url", "last_attempt_at", "last_attempt"] },
];
type Seed = Record<string, Record<string, unknown>[]>;
async function readSeed(): Promise<Seed> {
  if (!PROD_URL.startsWith("libsql://")) throw new Error("the seed reads prod; TURSO_DATABASE_URL must be the prod libsql:// URL");
  const prod = createClient({ url: PROD_URL, authToken: PROD_TOKEN });
  const read = reader(prod);
  const out: Seed = {};
  for (const t of TABLES) out[t.table] = (await read(`SELECT ${t.cols.join(", ")} FROM ${t.table}`)).rows.map((r) => ({ ...r }));
  prod.close();
  return out;
}
async function prodFingerprint(): Promise<string> {
  const prod = createClient({ url: PROD_URL, authToken: PROD_TOKEN });
  const read = reader(prod);
  const hash = async (sql: string) => createHash("sha256").update(JSON.stringify((await read(sql)).rows.map((r) => Object.values(r)))).digest("hex").slice(0, 16);
  const out = {
    member_ids: await hash(`SELECT * FROM member_ids ORDER BY bioguide_id`),
    general_ballot: await hash(`SELECT * FROM general_ballot ORDER BY race_id, person_key`),
    race_candidates: await hash(`SELECT * FROM race_candidates ORDER BY race_id, name`),
    schema: await hash(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`),
    cron: (await read(`SELECT route, MAX(id) AS id FROM cron_runs WHERE route IN ('/api/cron/race-challengers', '/api/cron/general-ballot') GROUP BY route ORDER BY route`)).rows.map((r) => `${r.route}#${r.id}`),
  };
  prod.close();
  return JSON.stringify(out);
}
async function seedCopy(name: string, seed: Seed): Promise<string> {
  const abs = path.resolve(ART, name);
  if (!abs.endsWith("-751-control.db")) throw new Error(`refused: a copy must be a *-751-control.db file (got ${abs})`);
  if (existsSync(abs)) rmSync(abs);
  const url = `file:${abs}`;
  await copyWrite(url, [
    ...TABLES.map((t) => ({ sql: t.ddl || ddlFromMigrate(t.table), args: [] })),
    // the three columns, exactly as migrate's ensureColumn adds them
    { sql: `ALTER TABLE member_ids ADD COLUMN ballotpedia_title_resolved TEXT`, args: [] },
    { sql: `ALTER TABLE member_ids ADD COLUMN ballotpedia_title_resolved_at TEXT`, args: [] },
    { sql: `ALTER TABLE member_ids ADD COLUMN ballotpedia_title_resolved_from TEXT`, args: [] },
  ], `ddl ${name}`);
  for (const t of TABLES) {
    const rows = seed[t.table]!;
    for (let i = 0; i < rows.length; i += 400) {
      await copyWrite(url, rows.slice(i, i + 400).map((r) => ({ sql: `INSERT INTO ${t.table} (${t.cols.join(",")}) VALUES (${t.cols.map(() => "?").join(",")})`, args: t.cols.map((c) => (r[c] ?? null) as never) })), `seed ${name} ${t.table}`);
    }
  }
  return url;
}
async function withCopy<T>(url: string, what: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = copyClient(url, what);
  try {
    return await fn(c);
  } finally {
    c.close();
  }
}

// ── the recorded pages and HO 747's saved race pages ───────────────────────
const recorded = JSON.parse(readFileSync(`${RECORDED}/index.json`, "utf8")) as { url: string; status: number | null; kind: string; file: string | null }[];
// Pages are read from inside the recorded directory (the index names each file).
const pageFile = (file: string) => path.join(RECORDED, path.basename(file));
const bodyOf = (url: string) => {
  const e = recorded.find((x) => x.url === url);
  return e?.file ? gunzipSync(readFileSync(pageFile(e.file))).toString("utf8") : null;
};
const replayIO = (): IO => ({
  now: () => 0,
  sleep: async () => {},
  get: async (url) => {
    const e = recorded.find((x) => x.url === url);
    if (!e) return { kind: "network", error: `not recorded: ${url}` };
    return e.file ? { kind: "response", status: e.status ?? 0, body: gunzipSync(readFileSync(pageFile(e.file))).toString("utf8") } : { kind: "network", error: "no body" };
  },
});
const man = JSON.parse(readFileSync(`${RUN747}/manifest-union.json`, "utf8")) as { raceId: string; url: string; file: string }[];
const savedPage = (race: string) => {
  const p = man.find((m) => m.raceId === race);
  if (!p?.file) throw new Error(`no saved page for ${race}`);
  return { url: p.url, html: gunzipSync(readFileSync(p.file)).toString("utf8") };
};
const asPerson = (r: { person_key: string; name: string; bioguide_id: string | null; incumbent_marked: number; on_ballot: number }): BallotPerson => ({ person_key: r.person_key, name: r.name, bioguide_id: r.bioguide_id, incumbent_marked: r.incumbent_marked, on_ballot: r.on_ballot });
const byRace = (cases: TitleCase[], race: string) => {
  const c = cases.find((x) => x.race === race);
  if (!c) throw new Error(`no case for ${race}`);
  return c;
};

// ── legs ───────────────────────────────────────────────────────────────────
async function leg1(seed: Seed) {
  console.log("\n── Leg 1 · the confirmation signals, on the dry run's recorded pages (replayed)");
  const url = await seedCopy("confirm-751-control.db", seed);
  const { cases, identity } = await withCopy(url, "leg 1 find", async (c) => ({ cases: (await findStaleTitles(c)).cases, identity: await loadIdentity(c) }));
  check("the copy finds STEP 0's 45", cases.length === 45, `${cases.length} cases (${cases.filter((c) => c.kind === "stale").length} stale · ${cases.filter((c) => c.kind === "missing").length} missing · ${cases.filter((c) => c.kind === "moved").length} moved)`);
  const sak = byRace(cases, "S-AK-2026"), al4 = byRace(cases, "AL-04-2026"), ca14 = byRace(cases, "CA-14-2026"), nj4 = byRace(cases, "NJ-04-2026"), wa9 = byRace(cases, "WA-09-2026");
  const control: TitleCase = { bioguide: "CONTROL", member: "control", firstName: null, lastName: null, stored: "Nobody Here (Nowhere)", resolved: null, hasRow: false, kind: "stale", race: "—", key: "__control_never_matches__", learned: "(control)" };
  const swapped: TitleCase = { ...ca14, lastName: "Graham" };
  const { confirmations } = await confirmCases([sak, al4, ca14, nj4, wa9, control], replayIO(), identity);
  const got = (race: string) => confirmations.find((c) => c.race === race)!;
  // Reds, each computed from the same evidence under the handoff's first rule.
  const sakBody = bodyOf("https://ballotpedia.org/Daniel_S._Sullivan")!;
  const sakLanding = canonicalKeyOf(sakBody);
  check("S-AK's senator confirms by disambiguation (red: the redirect alone lands elsewhere)",
    got("S-AK-2026").signal === "disambiguation" && got("S-AK-2026").verdict === "confirmed" && sakLanding !== sak.key,
    `redirect alone: ${sakLanding} ≠ ${sak.key} · ${got("S-AK-2026").evidence}`);
  check("a redirect case confirms by redirect (AL-04's Aderholt)", got("AL-04-2026").signal === "redirect" && got("AL-04-2026").verdict === "confirmed", got("AL-04-2026").evidence);
  check("CA-14's Wahab (no title) confirms by the name check, whole", got("CA-14-2026").signal === "ballot" && got("CA-14-2026").verdict === "confirmed", got("CA-14-2026").evidence);
  const nj4Whole = tokenCheck(nj4.learned, nj4).form === "whole";
  check("NJ-04's Chris Smith confirms by prefix (red: the whole-token check alone fails, 'chris' against 'christopher')",
    got("NJ-04-2026").signal === "ballot-prefix" && got("NJ-04-2026").verdict === "confirmed" && !nj4Whole,
    got("NJ-04-2026").evidence);
  check("WA-09's Adam Smith confirms by the fallback (his stale title is a disambiguation page that does not list him)",
    got("WA-09-2026").signal === "ballot" && got("WA-09-2026").verdict === "confirmed" && /does not link/.test(got("WA-09-2026").evidence), got("WA-09-2026").evidence);
  const ctl = confirmations.find((c) => c.bioguide === "CONTROL")!;
  check("the control stale title (Nobody Here (Nowhere)) has no page, fails, and is written nowhere",
    ctl.verdict === "unconfirmed" && /404/.test(ctl.evidence) && resolvedWriteStatements([ctl], "x").length === 0, `${ctl.evidence} · ${ctl.verdict}`);
  const sw = tokenCheck(swapped.learned, swapped);
  check("a surname-swapped control (CA-14 against 'Graham') fails the name check", !sw.ok, sw.detail);

  // The first-name half, which the controls above cannot reach (both fail on the
  // surname): the right surname with a different first name fails; a middle
  // initial is not a first name; and the title's parenthetical is not the name
  // (WI-05's Scott Fitzgerald must not confirm by "scot…" inside "(Scotland)").
  const gold = byRace(cases, "TX-12-2026"), fitz = byRace(cases, "WI-05-2026");
  const firstNameControls: [string, TitleCase, string][] = [
    ["a different first name (Aisha Wahab against 'Brian Wahab')", ca14, "Brian Wahab"],
    ["a middle initial is not a first name (Craig A. Goldman against 'Sarah A. Goldman')", gold, "Sarah A. Goldman"],
    ["the parenthetical is not the name (Scott Fitzgerald against 'Joe Fitzgerald (Scottsdale)')", fitz, "Joe Fitzgerald (Scottsdale)"],
  ];
  for (const [label, c, learned] of firstNameControls) {
    const r = tokenCheck(learned, c);
    check(`the name check's first-name half fails: ${label}`, !r.ok, r.detail);
  }
  // Its red: the same words outside a parenthetical DO confirm ("scott" begins
  // "scottsdale"), so the strip is what the green above rests on.
  const bare = tokenCheck("Joe Fitzgerald Scottsdale", fitz);
  check("red for the parenthetical control: the same words outside the parentheses confirm by prefix", bare.ok && bare.form === "prefix", bare.detail);
  // The disambiguation gate's category half: a page that links the learned key
  // but is NOT a disambiguation page (Aderholt's own page, which links many
  // pages) confirms nothing by disambiguation.
  const alBody = bodyOf("https://ballotpedia.org/Robert_B._Aderholt")!;
  // An ARTICLE the page provably links (the lib's own linkedKeys), so the link
  // half holds and only the category can stop a disambiguation confirmation.
  const linkedByAl = [...linkedKeys(alBody)].find((k) => /^[A-Z][A-Za-z]+(_[A-Za-z]+)+$/.test(k) && k !== "Robert_Aderholt")!;
  const fake: TitleCase = { ...al4, key: linkedByAl, learned: linkedByAl.replace(/_/g, " ") };
  const fk = (await confirmCases([fake], replayIO(), identity)).confirmations[0]!;
  check("the disambiguation gate needs the category: a non-disambiguation page that links the key confirms nothing by disambiguation",
    linkedKeys(alBody).has(linkedByAl) && !isDisambiguation(alBody) && fk.signal !== "disambiguation" && !/disambiguation page/.test(fk.evidence), `${linkedByAl}: ${fk.signal ?? "—"} · ${fk.evidence.slice(0, 160)}`);
  // A key two cases learn names no one person.
  const twice = (await confirmCases([ca14, { ...byRace(cases, "S-SC-2026"), key: ca14.key, learned: ca14.learned }], replayIO(), identity)).confirmations;
  check("a key two cases learn confirms neither", twice.every((c) => c.verdict === "unconfirmed" && /more than one case/.test(c.reason ?? "")), twice.map((c) => `${c.race} ${c.verdict}`).join(", "));
}

async function leg2(seed: Seed) {
  console.log("\n── Leg 2 · the identity map prefers the resolved title");
  const url = await seedCopy("map-751-control.db", seed);
  const page = savedPage("S-AK-2026");
  const model = readPageModel(page.html);
  const learnedKey = "Daniel_S._Sullivan_(United_States_Senator_from_Alaska)";
  const inc = { bioguideId: "S001198", lastName: "Sullivan" };
  const run = async () => withCopy(url, "leg 2 map", async (c) => {
    const pr = pageResult("S-AK-2026", model, await loadIdentity(c), "2026-09-27T00:00:00Z");
    const row = pr.rows.find((r) => r.person_key === learnedKey);
    const route = findIncumbentOnBallot(pr.rows.map(asPerson), inc).route;
    return { bioguide: row?.bioguide_id ?? null, route, rogers: pageResult("AL-03-2026", readPageModel(savedPage("AL-03-2026").html), await loadIdentity(c), "x").rows.find((r) => /Rogers/.test(r.name))?.bioguide_id ?? null };
  });
  const red = await run();
  check("red: the unrepaired map leaves the senator's row NULL, found by underline and surname", red.bioguide === null && red.route === "underline-surname", `bioguide ${red.bioguide ?? "NULL"} · route ${red.route}`);
  await copyWrite(url, [{ sql: `UPDATE member_ids SET ballotpedia_title_resolved = ?, ballotpedia_title_resolved_at = ?, ballotpedia_title_resolved_from = 'disambiguation' WHERE bioguide_id = 'S001198'`, args: [learnedKey.replace(/_/g, " "), "2026-09-27T00:00:00Z"] }], "leg 2 resolve");
  const stored = await withCopy(url, "leg 2 read", async (c) => S((await c.execute(`SELECT ballotpedia_title FROM member_ids WHERE bioguide_id = 'S001198'`)).rows[0]?.ballotpedia_title));
  const green = await run();
  check("green: with the resolved title set, the row carries S001198 and the route is identity; the stored title is untouched, and an unresolved member (AL-03's Rogers) ties as before",
    green.bioguide === "S001198" && green.route === "identity" && stored === "Daniel S. Sullivan" && green.rogers !== null && green.rogers === red.rogers,
    `bioguide ${green.bioguide} · route ${green.route} · ballotpedia_title still ${JSON.stringify(stored)} · Rogers ${green.rogers}`);
}

async function leg3(seed: Seed) {
  console.log("\n── Leg 3 · the crosswalk can't clobber the resolved title");
  const src = readFileSync("scripts/sync-crosswalk.ts", "utf8").replace(/\r\n/g, "\n");
  const upsert = src.match(/sql: `(INSERT INTO member_ids \([\s\S]*?fetched_at = excluded\.fetched_at)`/)?.[1];
  if (!upsert) throw new Error("the crosswalk's upsert was not found in scripts/sync-crosswalk.ts");
  const row = seed.member_ids!.find((r) => r.bioguide_id === "S001198")!;
  // The crosswalk's own args order, with upstream's (stale) title as today.
  const args = MEMBER_IDS_COLS.map((c) => (c === "ballotpedia_title" ? "Daniel S. Sullivan" : c === "fetched_at" ? "2026-09-28T00:00:00Z" : (row[c] ?? null))) as never[];
  const learned = "Daniel S. Sullivan (United States Senator from Alaska)";
  const learnedKey = titleKey(learned)!;
  const after = async (url: string) => withCopy(url, "leg 3 read", async (c) => {
    const r = (await c.execute(`SELECT ballotpedia_title, ballotpedia_title_resolved, ballotpedia_title_resolved_from FROM member_ids WHERE bioguide_id = 'S001198'`)).rows[0]!;
    return { title: S(r.ballotpedia_title), resolved: S(r.ballotpedia_title_resolved), from: S(r.ballotpedia_title_resolved_from), ties: (await loadIdentity(c)).get(learnedKey) ?? null };
  });
  // Red: the naive repair, the learned title written INTO ballotpedia_title.
  const urlR = await seedCopy("clobber-red-751-control.db", seed);
  await copyWrite(urlR, [{ sql: `UPDATE member_ids SET ballotpedia_title = ? WHERE bioguide_id = 'S001198'`, args: [learned] }], "leg 3 naive repair");
  await copyWrite(urlR, [{ sql: upsert, args }], "leg 3 the crosswalk's upsert");
  const red = await after(urlR);
  check("red: a repair written into ballotpedia_title is lost to the crosswalk's next upsert, and the learned key stops tying", red.title === "Daniel S. Sullivan" && red.ties === null, `ballotpedia_title ${JSON.stringify(red.title)} · key ties ${red.ties ?? "nobody"}`);
  // Green: the repair in the resolved columns.
  const urlG = await seedCopy("clobber-green-751-control.db", seed);
  await copyWrite(urlG, [{ sql: `UPDATE member_ids SET ballotpedia_title_resolved = ?, ballotpedia_title_resolved_at = '2026-09-27T00:00:00Z', ballotpedia_title_resolved_from = 'disambiguation' WHERE bioguide_id = 'S001198'`, args: [learned] }], "leg 3 repair");
  await copyWrite(urlG, [{ sql: upsert, args }], "leg 3 the crosswalk's upsert");
  const green = await after(urlG);
  check("green: the crosswalk's upsert with the old title leaves the resolved columns untouched, and the key still ties", green.resolved === learned && green.from === "disambiguation" && green.title === "Daniel S. Sullivan" && green.ties === "S001198",
    `resolved ${JSON.stringify(green.resolved)} (${green.from}) · ballotpedia_title ${JSON.stringify(green.title)} · key ties ${green.ties}`);
}

async function leg4(seed: Seed) {
  console.log("\n── Leg 4 · the whole effect: every confirmed title, the 45 races re-read, the harvest");
  const read = async (url: string) => withCopy(url, "leg 4 read", async (c) => {
    const rows = (await c.execute(`SELECT race_id, name, bioguide_id FROM race_candidates WHERE race_id IN ('TX-37-2026','UT-02-2026','UT-04-2026') ORDER BY race_id, name`)).rows;
    const collins = (await c.execute(`SELECT bioguide_id FROM general_ballot WHERE race_id = 'S-ME-2026' AND person_key = 'Susan_Collins_(Maine)'`)).rows[0];
    const wahab = (await c.execute(`SELECT ballotpedia_title_resolved, ballotpedia_title_resolved_from FROM member_ids WHERE bioguide_id = 'W000832'`)).rows[0];
    return { rows, collins: S(collins?.bioguide_id), wahab: wahab ? `${wahab.ballotpedia_title_resolved} (${wahab.ballotpedia_title_resolved_from})` : null };
  });
  const three = (r: { rows: ResultSet["rows"] }) => ["Greg Casar", "Blake Moore", "Mike Kennedy"].map((n) => `${n} ${S(r.rows.find((x) => x.name === n)?.bioguide_id) ?? "NULL"}`);
  // Red: the unrepaired copy.
  const urlR = await seedCopy("effect-red-751-control.db", seed);
  const redH = (await withCopy(urlR, "leg 4 red harvest", (c) => harvestChallengers(c))) as { incumbentRoutes: Record<string, number> };
  const red = await read(urlR);
  check("red: the unrepaired copy's harvest reads underline-surname 41, the three moved at NULL, S-ME's Collins untied",
    redH.incumbentRoutes["underline-surname"] === 41 && three(red).every((s) => s.endsWith("NULL")) && red.collins === null,
    `routes ${JSON.stringify(redH.incumbentRoutes)} · ${three(red).join(", ")} · Collins ${red.collins ?? "NULL"}`);
  // Green: confirm and write every title, re-read the 45 races, harvest.
  const urlG = await seedCopy("effect-green-751-control.db", seed);
  const { cases, identity } = await withCopy(urlG, "leg 4 find", async (c) => ({ cases: (await findStaleTitles(c)).cases, identity: await loadIdentity(c) }));
  const { confirmations } = await confirmCases(cases, replayIO(), identity);
  const stmts = resolvedWriteStatements(confirmations, "2026-09-27T00:00:00Z");
  await copyWrite(urlG, stmts, "leg 4 write the resolved titles");
  const races = [...new Set(cases.map((c) => c.race))].sort();
  const at = "2026-09-27T23:00:00Z";
  await withCopy(urlG, "leg 4 re-read", async (c) => {
    const idn = await loadIdentity(c);
    for (const race of races) {
      const page = savedPage(race);
      const pr = pageResult(race, readPageModel(page.html), idn, at);
      if (pr.status !== "box") throw new Error(`${race}: saved page reads ${pr.status}`);
      await c.batch(raceWriteStatements(race, { verdict: "READ", status: pr.status, rows: pr.rows, marked: pr.box?.marked ?? 0, url: page.url }, at), "write");
    }
  });
  const greenH = (await withCopy(urlG, "leg 4 green harvest", (c) => harvestChallengers(c))) as { incumbentRoutes: Record<string, number> };
  const green = await read(urlG);
  const confirmed = confirmations.filter((c) => c.verdict === "confirmed").length;
  check("green: all 45 confirmed and written (Wahab's row created), the 45 races re-read through the reader's own pageResult",
    confirmed === 45 && stmts.length === 45 && green.wahab !== null && /ballot/.test(green.wahab), `${confirmed} confirmed · ${stmts.length} writes · ${races.length} races re-read · Wahab ${green.wahab}`);
  check("green: the harvest reads underline-surname 0 over its races",
    greenH.incumbentRoutes["underline-surname"] === 0 && greenH.incumbentRoutes.identity === redH.incumbentRoutes.identity! + 41 && greenH.incumbentRoutes.none === redH.incumbentRoutes.none,
    `routes ${JSON.stringify(greenH.incumbentRoutes)}`);
  check("green: TX-37, UT-02 and UT-04 publish Casar, Moore and Kennedy with their bioguides",
    JSON.stringify(three(green)) === JSON.stringify(["Greg Casar C001131", "Blake Moore M001213", "Mike Kennedy K000403"]), three(green).join(", "));
  check("green: S-ME's Collins (a curated race, outside the harvest's count) is tied by identity in general_ballot", green.collins === "C001035", `Collins ${green.collins}`);
}

async function leg5(seed: Seed) {
  console.log("\n── Leg 5 · dry means dry: the script itself, spawned against a copy");
  const url = await seedCopy("dry-751-control.db", seed);
  schemeOf(url, "leg 5");
  // Two markers only the copy carries: Aderholt already resolved (the child's
  // table must read "already resolved" for him), and WA-09's ballot rows removed
  // (the child must find 44 cases, where prod finds 45 before the repair and 0
  // after it), so the proof holds on either side of the FF go.
  await copyWrite(url, [
    { sql: `UPDATE member_ids SET ballotpedia_title_resolved = 'Robert Aderholt', ballotpedia_title_resolved_at = '2026-09-27T00:00:00Z', ballotpedia_title_resolved_from = 'redirect' WHERE bioguide_id = 'A000055'`, args: [] },
    { sql: `DELETE FROM general_ballot WHERE race_id = 'WA-09-2026'`, args: [] },
  ], "leg 5 markers");
  const hash = async () => withCopy(url, "leg 5 hash", async (c) => createHash("sha256").update(JSON.stringify((await c.execute(`SELECT * FROM member_ids ORDER BY bioguide_id`)).rows.map((r) => Object.values(r)))).digest("hex").slice(0, 16));
  // The child's database is the copy by env precedence alone, so nothing that
  // could re-point it is passed through: dotenv's DOTENV_CONFIG_* options (an
  // override would load .env's prod URL) are stripped (the HO 751 review).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("DOTENV_"))) as NodeJS.ProcessEnv;
  Object.assign(env, { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "" });
  const plan = path.resolve(ART, "leg5-plan.json");
  const run = (args: string) => execSync(`npx tsx scripts/repair-ballotpedia-titles.ts ${args}`, { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 24 });
  const h0 = await hash();
  const dry = run(`--replay "${RECORDED}" --plan-out "${plan}"`);
  const h1 = await hash();
  const marker = /\| Robert B\. Aderholt \|[^\n]*already resolved/.test(dry) && / · 44 cases ===/.test(dry);
  check("the default run writes nothing: member_ids hashes the same before and after, and the child read the copy (its markers: Aderholt 'already resolved', 44 cases)",
    h0 === h1 && marker && /dry: 43 members would be written; nothing was\./.test(dry) && /plan: 43 confirmed rows saved/.test(dry), `${h0} → ${h1} · marker ${marker} · ${dry.match(/dry: .*/)?.[0]}`);
  // A HARD gate, not a count: no --write child runs unless the dry child
  // provably read the copy.
  if (!marker) throw new Error("refused: the dry child did not read the leg 5 copy; no --write child is spawned");
  let noPlanErr = "";
  try { run("--write"); } catch (e) { noPlanErr = String((e as { stderr?: string }).stderr ?? e).slice(0, 160); }
  const h2 = await hash();
  check("--write without a plan refuses and writes nothing", /needs --plan/.test(noPlanErr) && h2 === h0, `${noPlanErr.split("\n").find((l) => /needs --plan/.test(l)) ?? noPlanErr} · hash ${h2}`);
  const wrote = run(`--write --plan "${plan}"`);
  const h3 = await hash();
  const counts = await withCopy(url, "leg 5 counts", async (c) => (await c.execute(`SELECT ballotpedia_title_resolved_from AS f, COUNT(*) AS n FROM member_ids WHERE ballotpedia_title_resolved IS NOT NULL GROUP BY 1 ORDER BY 1`)).rows.map((r) => `${r.f}=${r.n}`));
  check("--write --plan writes exactly the planned members (43, plus the marker; WA-09 removed on this copy), by signal, and the same hash that held still now moves (the instrument can see a write)",
    /wrote 43 resolved titles\./.test(wrote) && counts.join(",") === "ballot=12,ballot-prefix=1,disambiguation=12,redirect=19" && h3 !== h0,
    `${wrote.match(/wrote .*/)?.[0]} · resolved by signal ${counts.join(", ")} · hash ${h0} → ${h3}`);
  // Idempotence: the same plan again writes nothing and moves nothing.
  const again = run(`--write --plan "${plan}"`);
  const h4 = await hash();
  check("a second --write --plan writes nothing (43 already resolved) and moves nothing", /wrote 0 resolved titles\./.test(again) && / 43 already resolved/.test(again) && h4 === h3, `${again.match(/wrote .*/)?.[0]} · hash ${h3} → ${h4}`);
}

async function main(): Promise<number> {
  const only = process.argv.includes("--leg") ? Number(process.argv[process.argv.indexOf("--leg") + 1]) : null;
  const run = (n: number) => only === null || only === n;
  console.log(`=== HO 751 legs · ${new Date().toISOString()} ===`);
  const fp0 = await prodFingerprint();
  console.log(`prod fingerprint before: ${fp0}`);
  const seed = await readSeed();
  console.log(`seed read from prod (SELECT only): ${Object.entries(seed).map(([k, v]) => `${k} ${v.length}`).join(" · ")}`);
  if (run(1)) await leg1(seed);
  if (run(2)) await leg2(seed);
  if (run(3)) await leg3(seed);
  if (run(4)) await leg4(seed);
  if (run(5)) await leg5(seed);
  const fp1 = await prodFingerprint();
  check("prod reads the same before and after (nothing here reached it)", fp0 === fp1, `before ${fp0} · after ${fp1}`);
  console.log(`\nLEGS: ${failures === 0 ? "ALL GREEN" : `${failures} FAILED`}`);
  return failures === 0 ? 0 : 1;
}
main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
