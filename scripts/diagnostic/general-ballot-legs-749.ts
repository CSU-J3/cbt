// HO 749 — the legs for the general-ballot reader (lib/general-ballot.ts), on
// HO 747's saved pages and on `file:` copies, seen red before green where
// there is a red.
//
//   npx tsx scripts/diagnostic/general-ballot-legs-749.ts            # all five legs
//   npx tsx scripts/diagnostic/general-ballot-legs-749.ts --leg 3    # one leg
//
//   Leg 1, parser equivalence. On all 470 saved pages the lib's page model is
//     held to the census's own `readPageModel` run on the same bytes, and the
//     lib's verdict and chosen box to the census's per-race JSON, field by
//     field. The one exception is the architect's ruling on the fixed
//     withdrawn-entry regex: the four predicted stored-box tokens (moving two
//     stored rows, Edwards and Golden), and in boxes the reader never stores any
//     withdrawn-entry token that was NULL in the census and reads now, every
//     one listed. Anything else is a stop. A comparator control first shows
//     the comparison can fail.
//   Leg 1 also checks the STORED columns: what pageResult writes, against the
//     same columns derived from the census JSON (with a mutation control), and
//     primary_marked against the ingest's own parser, parseCandidatesPage.
//   Leg 2, parser controls, on AK-AL-2026's saved page and stubs: the general box
//     deleted, its <h5> renamed, a second one pasted in, a 202, a 404, and a
//     Senate 404 / 503 / network error (only a 404 falls back).
//   Leg 3, writes, on a copy: READ writes and stamps; a changed ballot replaces;
//     a no-box READ clears; UNREAD and NO_PAGE leave rows, status and read_at
//     alone. Atomicity: an insert forced to throw after the delete leaves the old
//     rows, and the same statements run outside a transaction lose them (red).
//   Leg 4, the run, on a copy with an IO shim serving saved pages and a fake
//     clock: never-attempted first, then the oldest attempts; a 202 on the fifth
//     request ends the run there (red: the --all rule runs past it); the --all
//     rule as HO 747 ruled it (a pause, then the next UNREAD stops); the cap, the
//     budget and a first UNREAD each end a tick inside the soft timeout with a
//     `success` cron_runs row (through wrapCronRoute, the route's own wrapper,
//     around the route's own generalBallotTick), the UNREAD in chronicErr. Then one
//     short run on the REAL clock through liveIO() with globalThis.fetch shimmed
//     (the HO 744 seam), measuring the 6s spacing and the user agent.
//   Leg 5, identity, from the saved pages: FL-20's Wasserman Schultz carries
//     W000797; S-AK's namesake Dan Sullivan carries NULL (red: the ingest stored
//     both Sullivans with the senator's S001198, read from prod). The handoff
//     expected the senator himself at S001198; by identity he is NULL, because
//     his stored title is stale (HO 747's `title-mismatch`), and that is the
//     rule working. Then the whole census: the lib's identity reproduces the
//     census's 325 own-ballot and 15 other-ballot identity matches, race for
//     race, and the incumbents identity leaves untied are measured and listed.
//
// SAFETY. Prod is read through a reader that refuses anything but SELECT, to
// seed the copies (races, member_ids, S-AK's two Sullivans) and to fingerprint
// prod's general_ballot tables and cron_runs rows for the route before and
// after: equal readings mean nothing here reached prod. Every copy is `file:${abs}` from a path that must
// end in -749-control.db; `copyClient` refuses any other scheme and prints the
// one it ran against, and every perturbation goes through `copyWrite`. Leg 4's
// wrapCronRoute writes cron_runs through getDb(), which is pointed at a copy by
// setting TURSO_DATABASE_URL to its `file:` URL before getDb() is first called;
// the leg reads a marker table only that copy carries through getDb(), and
// throws before running anything if it is not there.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement, type ResultSet } from "@libsql/client";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  MIN_START_GAP_MS,
  TICK_BUDGET_MS,
  TICK_CAP,
  generalBallotTick,
  liveIO,
  loadIdentity,
  pageResult,
  raceWriteStatements,
  readPageModel,
  readRacePage,
  runGeneralBallot,
  selectQueue,
  titleKey,
  writeRace,
  type Box,
  type IO,
  type WithdrawnEntry,
  type PageModel,
  type Raw,
} from "@/lib/general-ballot";
import { USER_AGENT, decodeEntities, parseCandidatesPage, partyLetter } from "@/lib/primary-candidates-scrape";
import { readPageModel as censusReadPageModel } from "./general-box-census-747";

config({ path: ".env", quiet: true });

const ART = "docs/handoffs/749-artifacts";
const RUN747 = "docs/handoffs/747-artifacts/run-2026-09-25T19-56-59-291Z";
const MANIFEST = `${RUN747}/manifest-union.json`;
// The census's final per-race JSON: --reclassify on its final revision
// (docs/probes/747-general-box-findings.md), 463 compared + 7 no-general-box.
const CENSUS_JSON = `${RUN747}/races-reclassify-2026-09-25T21-08-41-563Z.json`;
// Ballotpedia's real 202, saved by HO 747's pass 1 at CA-17 (2,023 bytes).
const CHALLENGE_FILE = "docs/handoffs/747-artifacts/pages/2026-09-25T19-16-25-420Z/CA-17-2026.1.html.gz";

// Captured before anything can repoint the env (leg 4 does, for getDb()).
const PROD_URL = process.env.TURSO_DATABASE_URL ?? "";
const PROD_TOKEN = process.env.TURSO_AUTH_TOKEN;

type Man = { raceId: string; verdict: string; url: string; file: string | null };
type CensusRace = { id: string; status: string; chosen: Box | null; identityPairs?: { key: string; general: string; primary: string }[] };

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
  if (!ok) failures++;
}
const loadPage = (file: string) => gunzipSync(readFileSync(file)).toString("utf8");
const manifest = (): Man[] => JSON.parse(readFileSync(MANIFEST, "utf8")) as Man[];
const pageOf = (id: string) => {
  const p = manifest().find((m) => m.raceId === id);
  if (!p?.file) throw new Error(`no saved page for ${id}`);
  return { url: p.url, html: loadPage(p.file) };
};

// First differing path between two JSON-shaped values, or null.
function firstDiff(a: unknown, b: unknown, at: string): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    return `${at}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array vs object`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    const d = firstDiff(ao[k], bo[k], `${at}.${k}`);
    if (d) return d;
  }
  return null;
}
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// THE ONE EXCEPTION TO THE CENSUS IDENTITY (the architect's ruling, HO 749): the
// withdrawn-entry regex was fixed, so the promoted parser now reads a token the
// census missed on exactly these four entries (behind </u></b>, or over 40
// characters), and every entry gains `underlined`, a field the census never
// had. Predicted here from the saved pages, before the fix ran.
const PREDICTED: Record<string, { key: string; token: string }> = {
  "NC-11-2026": { key: "Chuck_Edwards", token: "R" },
  "ME-02-2026": { key: "Jared_Golden", token: "D" },
  "NY-26-2026": { key: "Tim_Kennedy_(New_York)", token: "Working Families Party" },
  "NY-07-2026": { key: "Melvin_Rivera_(New_York)", token: "No Kings Party / Arts &amp; Culture Party" },
};
// Every difference, not only the first: for the proposed exception below.
function allDiffs(a: unknown, b: unknown, at: string, out: { path: string; a: unknown; b: unknown }[]): void {
  if (a === b) return;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    out.push({ path: at, a, b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push({ path: `${at}.length`, a: a.length, b: b.length });
    else a.forEach((x, i) => allDiffs(x, b[i], `${at}[${i}]`, out));
    return;
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) allDiffs(ao[k], bo[k], `${at}.${k}`, out);
}
// Map a plain copy of the lib's model (or one box) back to the census's shape:
// drop `underlined` from every withdrawn entry, and put the census's null back
// on a predicted entry once its fixed token is checked. Returns what it undid;
// anything it does not undo must deep-equal the census.
function unfix(raceId: string, x: unknown, seen: Set<string>, wrong: string[]): void {
  const boxes: Box[] = [];
  const m = x as Partial<PageModel> & Partial<Box>;
  if (Array.isArray(m.sectionBoxes)) boxes.push(...m.sectionBoxes, ...(m.general ?? []), ...(m.primaries ?? []), ...(m.outsideGeneral ?? []));
  else boxes.push(x as Box);
  for (const b of boxes) {
    for (const e of b.withdrawn?.entries ?? []) {
      delete (e as Partial<WithdrawnEntry>).underlined;
      const p = PREDICTED[raceId];
      if (p && e.key === p.key) {
        if (e.token !== p.token) wrong.push(`${raceId} ${e.key}: read ${JSON.stringify(e.token)}, predicted ${JSON.stringify(p.token)}`);
        seen.add(`${raceId} ${e.key} (${e.token})`);
        e.token = null;
      }
    }
  }
}
const verdictOf = (m: PageModel) => (m.general.length === 0 ? "no_box" : m.general.length > 1 ? "ambiguous" : "box");

// ── copies ─────────────────────────────────────────────────────────────────
function reader(db: Client) {
  return (sql: string, args?: InArgs): Promise<ResultSet> => {
    const kw = sql.trim().split(/\s+/)[0]!.toUpperCase();
    if (kw !== "SELECT") throw new Error(`read-only: refused ${kw}`);
    return db.execute({ sql, args: args ?? [] });
  };
}
function schemeOf(url: string, what: string): string {
  const scheme = url.split(":")[0]!;
  if (scheme !== "file") throw new Error(`refused: ${what} runs against file: only (got ${scheme}:)`);
  return scheme;
}
function copyClient(url: string, what: string): Client {
  console.log(`    [${what}] scheme ${schemeOf(url, what)}:`);
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
// The DDL under test is migrate.ts's own, cut from its source rather than
// retyped, so the legs exercise the tables the migration will create.
function ddlFromMigrate(table: string): string {
  const src = readFileSync("scripts/migrate.ts", "utf8").replace(/\r\n/g, "\n");
  const m = src.match(new RegExp("`(CREATE TABLE IF NOT EXISTS " + table + " \\([\\s\\S]*?\\n  \\))`"));
  if (!m?.[1]) throw new Error(`migrate.ts has no CREATE TABLE for ${table}`);
  return m[1];
}
type Seed = { races: Record<string, unknown>[]; members: Record<string, unknown>[]; akSullivans: Record<string, unknown>[] };
async function readSeed(): Promise<Seed> {
  if (!PROD_URL.startsWith("libsql://")) throw new Error("the seed reads prod; TURSO_DATABASE_URL must be the prod libsql:// URL");
  const prod = createClient({ url: PROD_URL, authToken: PROD_TOKEN });
  const read = reader(prod);
  const races = (await read(`SELECT id, cycle, chamber, state, district, incumbent_bioguide_id FROM races`)).rows.map((r) => ({ ...r }));
  const members = (await read(`SELECT bioguide_id, ballotpedia_title FROM member_ids`)).rows.map((r) => ({ ...r }));
  // What the ingest actually stored for S-AK's two Sullivans: the red of leg 5.
  const akSullivans = (await read(
    `SELECT pc.name, pc.bioguide_id, pc.incumbent, pc.status, p.id AS primary_id FROM primary_candidates pc
       JOIN primaries p ON p.id = pc.primary_id
      WHERE p.state = 'AK' AND p.chamber = 'senate' AND pc.name LIKE '%Sullivan%' ORDER BY pc.name`,
  )).rows.map((r) => ({ ...r }));
  prod.close();
  return { races, members, akSullivans };
}
// Prod's side of everything this driver could have written: the two new tables'
// row counts where they exist, and the newest cron_runs row for the route. Read
// before and after; equal readings mean nothing here reached prod. Unlike an
// "the tables do not exist" test, this stays meaningful after the migration.
async function prodFingerprint(): Promise<string> {
  const prod = createClient({ url: PROD_URL, authToken: PROD_TOKEN });
  const read = reader(prod);
  const tables = (await read(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('general_ballot', 'general_ballot_reads') ORDER BY name`)).rows.map((r) => String(r.name));
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = Number((await read(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0]?.n);
  const cron = (await read(`SELECT MAX(id) AS id, COUNT(*) AS n FROM cron_runs WHERE route = '/api/cron/general-ballot'`)).rows[0];
  prod.close();
  return JSON.stringify({ tables: counts, cronRuns: { n: Number(cron?.n), maxId: cron?.id ?? null } });
}
async function seedCopy(name: string, seed: Seed): Promise<string> {
  const abs = path.resolve(ART, name);
  if (!abs.endsWith("-749-control.db")) throw new Error(`refused: a copy must be a *-749-control.db file (got ${abs})`);
  if (existsSync(abs)) rmSync(abs);
  const url = `file:${abs}`;
  await copyWrite(
    url,
    [
      { sql: `CREATE TABLE races (id TEXT PRIMARY KEY, cycle INTEGER NOT NULL, chamber TEXT NOT NULL, state TEXT NOT NULL, district INTEGER, incumbent_bioguide_id TEXT)`, args: [] },
      { sql: `CREATE TABLE member_ids (bioguide_id TEXT PRIMARY KEY, ballotpedia_title TEXT)`, args: [] },
      { sql: ddlFromMigrate("general_ballot"), args: [] },
      { sql: ddlFromMigrate("general_ballot_reads"), args: [] },
      { sql: ddlFromMigrate("cron_runs"), args: [] },
      ...seed.races.map((r) => ({
        sql: `INSERT INTO races (id, cycle, chamber, state, district, incumbent_bioguide_id) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [r.id, r.cycle, r.chamber, r.state, r.district, r.incumbent_bioguide_id] as InArgs,
      })),
      ...seed.members.map((r) => ({
        sql: `INSERT INTO member_ids (bioguide_id, ballotpedia_title) VALUES (?, ?)`,
        args: [r.bioguide_id, r.ballotpedia_title] as InArgs,
      })),
    ],
    `seed ${name}`,
  );
  return url;
}

// ── leg 1 ──────────────────────────────────────────────────────────────────
function leg1() {
  console.log("\n── Leg 1 · parser equivalence on HO 747's 470 saved pages");
  const man = manifest();
  const census = new Map((JSON.parse(readFileSync(CENSUS_JSON, "utf8")) as CensusRace[]).map((r) => [r.id, r]));
  const statusMap: Record<string, string> = { compared: "box", "no-general-box": "no_box", "ambiguous-general": "ambiguous" };

  // The comparator's control: one flipped field must be found, at its path.
  const akModel = readPageModel(pageOf("AK-AL-2026").html);
  const flipped = plain(akModel.general[0]!);
  flipped.rows[0]!.underlined = !flipped.rows[0]!.underlined;
  const cd = firstDiff(plain(akModel.general[0]!), flipped, "chosen");
  check("control: a flipped `underlined` is found by the comparator", cd === `chosen.rows[0].underlined: ${JSON.stringify(akModel.general[0]!.rows[0]!.underlined)} vs ${JSON.stringify(!akModel.general[0]!.rows[0]!.underlined)}`, cd ?? "no difference found");

  let modelSame = 0, jsonSame = 0;
  const predictedSeen = new Set<string>(), predictedWrong: string[] = [], underlinedEntries: string[] = [];
  const unstoredTokens: { race: string; kind: string; key: string; token: string }[] = [], otherDiffs: string[] = [];
  const both: string[] = [];
  const cross: Record<string, number> = {};
  const modelDiffs: string[] = [], jsonDiffs: string[] = [];
  const t = { box: 0, no_box: 0, ambiguous: 0, rows: 0, writeIns: 0, wdBlocks: 0, wdNames: 0, noLink: 0, special: 0, tableRows: 0, merged: 0, repeated: 0, noKey: 0 };
  const routes: Record<string, number> = {}, cls: Record<string, number> = {}, prefixes: Record<string, number> = {};
  const noBox: string[] = [];
  for (const p of man) {
    const html = loadPage(p.file!);
    const lib = readPageModel(html);
    const libModel = plain(lib);
    unfix(p.raceId, libModel, predictedSeen, predictedWrong);
    for (const b of lib.general) for (const e of b.withdrawn?.entries ?? []) if (e.underlined) underlinedEntries.push(`${p.raceId} ${e.name}`);
    const cen = plain(censusReadPageModel(html));
    // THE RULED EXCEPTION (the architect, HO 749). After the four predicted
    // stored-box tokens are put back (unfix, above), every remaining difference
    // must be a withdrawn-entry token that was NULL in the census and reads now,
    // in a box the reader never stores: a kept-primary box, or a general box
    // outside the section. Nothing else in those entries may change, and any
    // other difference anywhere in the model, or any in the stored box, is a stop.
    const rest: { path: string; a: unknown; b: unknown }[] = [];
    allDiffs({ title: libModel.title, specialPage: libModel.specialPage, section: libModel.section }, { title: cen.title, specialPage: cen.specialPage, section: cen.section }, "model", rest);
    allDiffs(libModel.sectionBoxes, cen.sectionBoxes, "sectionBoxes", rest);
    allDiffs(libModel.outsideGeneral, cen.outsideGeneral, "outsideGeneral", rest);
    for (const d of rest) {
      const m = d.path.match(/^(sectionBoxes|outsideGeneral)\[(\d+)\]\.withdrawn\.entries\[(\d+)\]\.token$/);
      const box = m ? (m[1] === "sectionBoxes" ? lib.sectionBoxes : lib.outsideGeneral)[Number(m[2])] : undefined;
      const storedBox = m?.[1] === "sectionBoxes" && box?.kind === "general";
      if (m && d.b === null && typeof d.a === "string" && !storedBox) {
        const e = box?.withdrawn?.entries[Number(m[3])];
        unstoredTokens.push({ race: p.raceId, kind: `${m[1] === "outsideGeneral" ? "outside-section " : ""}${box?.kind}`, key: String(e?.key), token: d.a });
      } else otherDiffs.push(`${p.raceId} ${d.path}: ${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}`);
    }
    if (rest.length === 0) modelSame++;
    const j = census.get(p.raceId);
    const v = verdictOf(lib);
    let d2: string | null = !j ? "missing from the census JSON" : statusMap[j.status] !== v ? `verdict ${v} vs census ${j.status}` : null;
    if (!d2 && v === "box") {
      const box = plain(lib.general[0]!);
      unfix(p.raceId, box, new Set(), predictedWrong);
      d2 = firstDiff(box, j!.chosen, "chosen");
    }
    if (d2) jsonDiffs.push(`${p.raceId} ${d2}`);
    else jsonSame++;
    t[v]++;
    if (v === "no_box") noBox.push(p.raceId);
    if (v !== "box") continue;
    const b = lib.general[0]!;
    t.rows += b.rows.length;
    t.writeIns += b.rows.filter((r) => r.writeIn).length;
    t.noLink += b.noLinkRows.length;
    if (b.special) t.special++;
    if (b.withdrawn) {
      t.wdBlocks++;
      t.wdNames += b.withdrawn.entries.length;
    }
    for (const r of b.rows) routes[r.route] = (routes[r.route] ?? 0) + 1;
    cls[b.cls] = (cls[b.cls] ?? 0) + 1;
    prefixes[b.prefix] = (prefixes[b.prefix] ?? 0) + 1;
    const pr = pageResult(p.raceId, lib, new Map(), "t");
    t.tableRows += pr.rows.length;
    if (pr.folded) {
      t.merged += pr.folded.merged;
      t.repeated += pr.folded.repeated;
      t.noKey += pr.folded.noKey;
    }
    for (const r of pr.rows) cross[`on_ballot ${r.on_ballot} · withdrawn ${r.withdrawn}`] = (cross[`on_ballot ${r.on_ballot} · withdrawn ${r.withdrawn}`] ?? 0) + 1;
    for (const r of pr.rows) if (r.on_ballot && r.withdrawn) both.push(`${p.raceId} ${r.name} (printed ${JSON.stringify(r.printed_party)})`);
  }
  for (const d of [...modelDiffs, ...jsonDiffs].slice(0, 10)) console.log(`    DIFF ${d}`);
  check("the regex fix's predicted differences, and only those: a token on exactly the four predicted entries, each the predicted value",
    predictedSeen.size === 4 && predictedWrong.length === 0, `${[...predictedSeen].join(" · ")}${predictedWrong.length ? ` · WRONG ${predictedWrong.join("; ")}` : ""}`);
  console.log(`    withdrawn entries carrying <u> (read since the fix): ${underlinedEntries.length} (${underlinedEntries.join(", ")})`);
  const unstoredPages = new Set(unstoredTokens.map((x) => x.race));
  const unstoredKinds: Record<string, number> = {};
  for (const x of unstoredTokens) unstoredKinds[x.kind] = (unstoredKinds[x.kind] ?? 0) + 1;
  console.log(`    the difference list, beyond the four predicted (the ruled exception; ${unstoredTokens.length} tokens on ${unstoredPages.size} pages):`);
  for (const x of unstoredTokens) console.log(`      ${x.race} · ${x.kind} box · ${x.key} · census null → ${JSON.stringify(x.token)}`);
  for (const d of otherDiffs.slice(0, 5)) console.log(`    OTHER DIFF ${d}`);
  console.log(`    pages whose model equals the census's with nothing to name: ${modelSame}/470`);
  check("the ruled exception: beyond the four predicted stored-box tokens, every difference is a withdrawn-entry token that was NULL in the census, in a box the reader never stores; nothing else",
    otherDiffs.length === 0 && unstoredTokens.length > 0,
    `${unstoredTokens.length} tokens on ${unstoredPages.size} pages ${JSON.stringify(unstoredKinds)} · ${otherDiffs.length} other differences`);
  check("apart from them, the lib's verdict and chosen box equal the census's per-race JSON, field by field", jsonDiffs.length === 0 && jsonSame === 470, `${jsonSame}/470 identical, ${jsonDiffs.length} differ`);
  console.log(`    verdicts: box ${t.box} · no_box ${t.no_box} [${noBox.join(", ")}] · ambiguous ${t.ambiguous}`);
  console.log(`    boxes by class ${JSON.stringify(cls)} · by prefix ${JSON.stringify(prefixes)}`);
  console.log(`    ballot rows ${t.rows} · write-ins ${t.writeIns} · no-link rows ${t.noLink} · party routes ${JSON.stringify(routes)}`);
  console.log(`    withdrawn blocks ${t.wdBlocks}, names ${t.wdNames}`);
  console.log(`    table rows ${t.tableRows} = ${t.rows} ballot + ${t.wdNames} withdrawn − ${t.merged} merged into their ballot row − ${t.repeated} repeated − ${t.noKey} without a key · ${JSON.stringify(cross)}`);
  check("the census's totals reproduce (463 box, 7 no_box, 1,341 rows, 82 write-ins, 181 blocks / 289 names, 0 no-link)",
    t.box === 463 && t.no_box === 7 && t.ambiguous === 0 && t.rows === 1341 && t.writeIns === 82 && t.wdBlocks === 181 && t.wdNames === 289 && t.noLink === 0,
    `${t.box}/${t.no_box}/${t.ambiguous} · ${t.rows} · ${t.writeIns} · ${t.wdBlocks}/${t.wdNames} · ${t.noLink}`);
  console.log(`    the five printed AND withdrawn (on_ballot 1 · withdrawn 1): ${both.join(" · ")}`);
  check("the key's two measured shapes: 5 people printed AND withdrawn read on_ballot 1 · withdrawn 1, 2 repeated entries fold, 0 without a key",
    t.merged === 5 && t.repeated === 2 && t.noKey === 0 && t.tableRows === 1623 && cross["on_ballot 1 · withdrawn 1"] === 5 && cross["on_ballot 0 · withdrawn 1"] === 282 && cross["on_ballot 1 · withdrawn 0"] === 1336,
    `${t.merged} / ${t.repeated} / ${t.noKey} · ${t.tableRows} table rows · ${JSON.stringify(cross)}`);
  return modelDiffs.length === 0 && jsonDiffs.length === 0;
}

// The stored columns, derived a second way: from the census's per-race JSON
// (its chosen box, not the lib's model), by the rules the handoff states, and
// compared field by field with what pageResult stores. primary_marked is
// checked against the INGEST's own parser, parseCandidatesPage, by name; the
// only differences allowed are the census's identity pairs (one href carrying
// a different anchor text in the general box than in the primary box).
type Expected = { person_key: string; name: string; printed_party: string | null; party: string | null; incumbent_marked: number; write_in: number; on_ballot: number; withdrawn: number };
// What the regex fix changes in STORED rows, predicted: the two withdrawn-only
// incumbents gain their printed token, its letter, and their <u>. (NY-07 and
// NY-26's fixed tokens belong to people who are also ballot rows, whose printed
// party is the ballot's, so their stored rows do not move.)
const STORED_OVERRIDES: Record<string, Partial<Expected>> = {
  "NC-11-2026|Chuck_Edwards": { printed_party: "R", party: "R", incumbent_marked: 1 },
  "ME-02-2026|Jared_Golden": { printed_party: "D", party: "D", incumbent_marked: 1 },
};
function expectedRows(raceId: string, chosen: Box, applied: string[]): Expected[] {
  const out: Expected[] = [];
  const seen = new Set<string>();
  const listed = new Set((chosen.withdrawn?.entries ?? []).filter((w) => w.key).map((w) => w.key as string));
  for (const r of chosen.rows) {
    if (!r.key || seen.has(r.key)) continue;
    seen.add(r.key);
    out.push({ person_key: r.key, name: r.name, printed_party: r.printed ? decodeEntities(r.printed) : null, party: r.printedParty ?? r.party, incumbent_marked: r.underlined ? 1 : 0, write_in: r.writeIn ? 1 : 0, on_ballot: 1, withdrawn: listed.has(r.key) ? 1 : 0 });
  }
  for (const w of chosen.withdrawn?.entries ?? []) {
    if (!w.key || seen.has(w.key)) continue;
    seen.add(w.key);
    const tok = w.token ? decodeEntities(w.token) : null;
    const row: Expected = { person_key: w.key, name: w.name, printed_party: tok, party: tok ? partyLetter(tok.split("/")[0]!) : null, incumbent_marked: 0, write_in: 0, on_ballot: 0, withdrawn: 1 };
    const o = STORED_OVERRIDES[`${raceId}|${w.key}`];
    if (o) {
      const changed = Object.entries(o).filter(([k, v]) => (row as Record<string, unknown>)[k] !== v).map(([k]) => k);
      applied.push(`${raceId} ${w.name}: ${changed.join(", ") || "NOTHING"}`);
      Object.assign(row, o);
    }
    out.push(row);
  }
  return out;
}
function leg1Stored() {
  console.log("\n── Leg 1 (stored columns) · what pageResult stores, against the census JSON and the ingest's parser");
  const census = new Map((JSON.parse(readFileSync(CENSUS_JSON, "utf8")) as CensusRace[]).map((r) => [r.id, r]));
  const pick = (r: Record<string, unknown>) => ({ person_key: r.person_key, name: r.name, printed_party: r.printed_party, party: r.party, incumbent_marked: r.incumbent_marked, write_in: r.write_in, on_ballot: r.on_ballot, withdrawn: r.withdrawn });
  const applied: string[] = [];
  let races = 0, rowsN = 0, fusion = 0, same = 0;
  const diffs: string[] = [], pmDiffs: string[] = [], pmPairs: string[] = [];
  let pmMarked = 0;
  let mutantCaught = false;
  for (const p of manifest()) {
    const html = loadPage(p.file!);
    const pr = pageResult(p.raceId, readPageModel(html), new Map(), "t");
    const j = census.get(p.raceId);
    if (pr.status !== "box" || !j?.chosen) continue;
    races++;
    const exp = expectedRows(p.raceId, j.chosen, applied);
    const got = pr.rows.map((r) => pick(r as unknown as Record<string, unknown>));
    const d = firstDiff(got, exp, p.raceId);
    if (d) diffs.push(d);
    else same++;
    rowsN += got.length;
    fusion += j.chosen.rows.filter((r) => r.printedParty && r.printedParty !== r.party).length;
    // Mutation control, once: the stored party taken from the ingest's letter
    // instead of the printed party must be caught by this comparison.
    if (!mutantCaught) {
      const i = j.chosen.rows.findIndex((r) => r.printedParty && r.printedParty !== r.party);
      if (i >= 0) {
        const mutant = got.map((g, k) => (k === i ? { ...g, party: j.chosen!.rows[i]!.party } : g));
        mutantCaught = firstDiff(mutant, exp, p.raceId) !== null;
      }
    }
    // primary_marked against parseCandidatesPage's winners, by name.
    const winners = new Set(parseCandidatesPage(html, "XX", p.url).candidates.filter((c) => c.isWinner).map((c) => c.name.toLowerCase()));
    const pairs = new Set((j.identityPairs ?? []).map((x) => x.key));
    for (const r of pr.rows) {
      pmMarked += r.primary_marked;
      const byName = winners.has(r.name.toLowerCase()) ? 1 : 0;
      if (byName === r.primary_marked) continue;
      if (pairs.has(r.person_key)) pmPairs.push(`${p.raceId} ${r.name}`);
      else pmDiffs.push(`${p.raceId} ${r.name} [${r.person_key}] stored ${r.primary_marked}, ingest by name ${byName}`);
    }
  }
  for (const d of diffs.slice(0, 5)) console.log(`    DIFF ${d}`);
  for (const d of pmDiffs.slice(0, 10)) console.log(`    PRIMARY_MARKED ${d}`);
  check("control: the stored party taken from the ingest's letter instead of the printed party is caught", mutantCaught, mutantCaught ? "caught" : "NOT caught");
  check("the regex fix's stored differences are the two predicted rows, and each moved (the census JSON alone derives the old values)",
    applied.length === 2 && applied.every((a) => !a.endsWith("NOTHING")), applied.join(" · "));
  check("the stored columns equal their derivation from the census JSON on every box", diffs.length === 0 && same === races && races === 463,
    `${same}/${races} boxes identical · ${rowsN} rows · ${fusion} ballot rows whose printed party's letter differs from the ingest's (fusion lines)`);
  check("primary_marked agrees with the ingest's own parser on every stored row, apart from the census's identity pairs",
    pmDiffs.length === 0, `${pmMarked} rows primary_marked · ${pmDiffs.length} unexplained differences · ${pmPairs.length} identity-pair rows (${pmPairs.join(", ") || "none"})`);
}

// ── leg 2 ──────────────────────────────────────────────────────────────────
function stubIO(answer: (url: string, n: number) => Raw): IO & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    get: async (url) => {
      urls.push(url);
      return answer(url, urls.length);
    },
    sleep: async () => {},
    now: () => 0,
  };
}
async function leg2() {
  console.log("\n── Leg 2 · parser controls on AK-AL-2026's saved page and stubs");
  const { html } = pageOf("AK-AL-2026");
  const m0 = readPageModel(html);
  const g = m0.general[0]!;
  console.log(`    unperturbed: ${verdictOf(m0)} · prefix "${g.prefix}" · ${g.rows.length} rows · ${m0.sectionBoxes.length} section boxes`);
  check("red side: the unperturbed page reads box", verdictOf(m0) === "box", verdictOf(m0));
  const next = [...m0.sectionBoxes.map((b) => b.offset).filter((o) => o > g.offset), m0.section!.end].sort((a, b) => a - b)[0]!;
  const slice = html.slice(g.offset, next);

  const mA = readPageModel(html.slice(0, g.offset) + html.slice(next));
  check("the general box deleted reads no_box", verdictOf(mA) === "no_box", `${verdictOf(mA)} (${mA.sectionBoxes.length} section boxes)`);

  const renamed = slice.replace(/(<h5[^>]*>)([\s\S]*?)(<\/h5>)/, (_all, a: string, text: string, c: string) => a + text.replace(/General election/i, "Canvass") + c);
  if (renamed === slice) throw new Error("the <h5> rename did not apply");
  const mB = readPageModel(html.slice(0, g.offset) + renamed + html.slice(next));
  const rb = mB.sectionBoxes.find((b) => b.offset === g.offset);
  check("its <h5> renamed reads no_box, with the prefix recorded", verdictOf(mB) === "no_box" && rb?.prefix === "Canvass", `${verdictOf(mB)} · the box now reads kind ${rb?.kind}, prefix "${rb?.prefix}", h5 "${rb?.h5}"`);

  const mC = readPageModel(html.slice(0, next) + slice + html.slice(next));
  const prC = pageResult("AK-AL-2026", mC, new Map(), "t");
  check("a second general box pasted in reads ambiguous, and stores nothing", verdictOf(mC) === "ambiguous" && prC.status === "ambiguous" && prC.rows.length === 0, `${mC.general.length} general boxes · ${prC.status} · ${prC.rows.length} rows`);

  const house = { id: "AK-AL-2026", chamber: "house", state: "AK", district: 0 };
  const challenge = loadPage(CHALLENGE_FILE);
  const r202 = await readRacePage(house, stubIO(() => ({ kind: "response", status: 202, body: challenge })));
  check("a 202 (Ballotpedia's own challenge, 2,023 bytes) reads UNREAD", r202.verdict === "UNREAD", `${r202.verdict} (${r202.cause}) · body ${Buffer.byteLength(challenge)} bytes · ${r202.attempts.length} attempt`);
  const r404 = await readRacePage(house, stubIO(() => ({ kind: "response", status: 404, body: "not found" })));
  check("a 404 reads NO_PAGE", r404.verdict === "NO_PAGE", `${r404.verdict} (${r404.cause})`);
  const sen = { id: "S-AK-2026", chamber: "senate", state: "AK", district: null };
  const s404io = stubIO(() => ({ kind: "response", status: 404, body: "not found" }));
  const s404 = await readRacePage(sen, s404io);
  check("a Senate 404 falls back to the special URL, then reads NO_PAGE", s404.verdict === "NO_PAGE" && s404.fallback && s404io.urls.length === 2, `${s404.verdict} · fallback ${s404.fallback} · ${s404io.urls.join(" → ")}`);
  // The one fetch departure from the census: only a 404 falls back. A 503 or a
  // network error on the regular URL is UNREAD, and the special URL is not read.
  for (const [what, raw] of [["503", { kind: "response", status: 503, body: "unavailable" }], ["network error", { kind: "network", error: "ECONNRESET" }]] as const) {
    const io = stubIO((u) => (u.includes("special") ? { kind: "response", status: 404, body: "not found" } : (raw as Raw)));
    const rr = await readRacePage(sen, io);
    check(`a Senate ${what} reads UNREAD and does not fall back`, rr.verdict === "UNREAD" && !rr.fallback && io.urls.length === 1, `${rr.verdict} (${rr.cause}) · fallback ${rr.fallback} · ${io.urls.length} request`);
  }
}

// ── leg 3 ──────────────────────────────────────────────────────────────────
type DbRow = Record<string, unknown>;
const rowsOf = async (c: Client, race: string): Promise<DbRow[]> =>
  (await c.execute({ sql: `SELECT * FROM general_ballot WHERE race_id = ? ORDER BY person_key`, args: [race] })).rows.map((r) => ({ ...r }));
const readsOf = async (c: Client, race: string): Promise<DbRow | null> => {
  const r = (await c.execute({ sql: `SELECT * FROM general_ballot_reads WHERE race_id = ?`, args: [race] })).rows[0];
  return r ? { ...r } : null;
};
async function leg3(seed: Seed) {
  console.log("\n── Leg 3 · writes, on a file: copy");
  const url = await seedCopy("writes-749-control.db", seed);
  const db = copyClient(url, "leg 3 lib writes");
  const identity = await loadIdentity(db);
  const race = "AK-AL-2026";
  const { url: src, html } = pageOf(race);
  const m0 = readPageModel(html);
  const T = (n: number) => `2026-09-26T00:00:0${n}.000Z`;
  const pr = pageResult(race, m0, identity, T(1));
  if (pr.status !== "box") throw new Error("AK-AL-2026 should read box");
  const n = pr.rows.length;

  await writeRace(db, race, { verdict: "READ", status: "box", rows: pr.rows, marked: pr.box.marked, url: src }, T(1));
  let rows = await rowsOf(db, race), rd = await readsOf(db, race);
  check("a READ writes the rows and stamps the race", rows.length === n && rd?.status === "box" && Number(rd?.rows) === n && rd?.read_at === T(1) && rd?.last_attempt === "READ" && rd?.source_url === src,
    `${rows.length} rows · reads ${JSON.stringify(rd)}`);

  // A changed ballot: the box's last results row taken out of the page.
  const g = m0.general[0]!;
  const next = [...m0.sectionBoxes.map((b) => b.offset).filter((o) => o > g.offset), m0.section!.end].sort((a, b) => a - b)[0]!;
  const slice = html.slice(g.offset, next);
  const trs = slice.match(/<tr class="results_row[^"]*">[\s\S]*?<\/tr>/g) ?? [];
  const gone = trs.at(-1)!;
  const mD = readPageModel(html.slice(0, g.offset) + slice.replace(gone, "") + html.slice(next));
  const prD = pageResult(race, mD, identity, T(2));
  if (prD.status !== "box") throw new Error("the changed page should still read box");
  const goneKey = g.rows.at(-1)!.key;
  await writeRace(db, race, { verdict: "READ", status: "box", rows: prD.rows, marked: prD.box.marked, url: src }, T(2));
  rows = await rowsOf(db, race);
  rd = await readsOf(db, race);
  check("a changed ballot replaces the rows", rows.length === n - 1 && !rows.some((r) => r.person_key === goneKey) && rd?.read_at === T(2) && Number(rd?.rows) === n - 1,
    `${n} → ${rows.length} rows · ${goneKey} ${rows.some((r) => r.person_key === goneKey) ? "still there" : "gone"} · read_at ${rd?.read_at}`);

  await writeRace(db, race, { verdict: "READ", status: "no_box", rows: [], marked: 0, url: src }, T(3));
  rows = await rowsOf(db, race);
  rd = await readsOf(db, race);
  check("a no-box READ clears the rows and stamps no_box", rows.length === 0 && rd?.status === "no_box" && Number(rd?.rows) === 0 && rd?.read_at === T(3), `${rows.length} rows · status ${rd?.status} · read_at ${rd?.read_at}`);

  await writeRace(db, race, { verdict: "READ", status: "box", rows: pr.rows.map((r) => ({ ...r, read_at: T(4) })), marked: pr.box.marked, url: src }, T(4));
  const before = JSON.stringify(await rowsOf(db, race));
  for (const [k, v] of [[5, "UNREAD"], [6, "NO_PAGE"]] as const) {
    await writeRace(db, race, { verdict: v }, T(k));
    const after = await rowsOf(db, race);
    rd = await readsOf(db, race);
    check(`${v} leaves the rows, status and read_at untouched, and stamps only the attempt`,
      JSON.stringify(after) === before && rd?.status === "box" && rd?.read_at === T(4) && Number(rd?.rows) === n && rd?.last_attempt === v && rd?.last_attempt_at === T(k),
      `${after.length} rows (${JSON.stringify(after) === before ? "identical" : "CHANGED"}) · status ${rd?.status} · read_at ${rd?.read_at} · last ${rd?.last_attempt} @ ${rd?.last_attempt_at}`);
  }

  // Atomicity: the second INSERT repeats the first row's key and throws after
  // the DELETE has run.
  const dup = [pr.rows[0]!, ...pr.rows].map((r) => ({ ...r, read_at: T(7) }));
  const stmts = raceWriteStatements(race, { verdict: "READ", status: "box", rows: dup, marked: 0, url: src }, T(7));
  let thrown = "";
  try {
    await writeRace(db, race, { verdict: "READ", status: "box", rows: dup, marked: 0, url: src }, T(7));
  } catch (e) {
    thrown = String(e).slice(0, 120);
  }
  const afterDup = await rowsOf(db, race);
  rd = await readsOf(db, race);
  check("green: the insert throws after the delete, and the batch leaves the old rows", thrown !== "" && JSON.stringify(afterDup) === before && rd?.read_at === T(4) && rd?.last_attempt === "NO_PAGE",
    `threw ${JSON.stringify(thrown)} · ${afterDup.length} rows (${JSON.stringify(afterDup) === before ? "identical to before" : "CHANGED"}) · read_at ${rd?.read_at} · last ${rd?.last_attempt}`);

  // The five printed AND withdrawn, through the table: each of their races
  // written by the lib, then read back from general_ballot by the two flags.
  const fiveRaces = ["NE-03-2026", "NY-06-2026", "NY-07-2026", "NY-21-2026", "NY-26-2026"];
  for (const id of fiveRaces) {
    const pg = pageOf(id);
    const pf = pageResult(id, readPageModel(pg.html), identity, T(8));
    if (pf.status !== "box") throw new Error(`${id} should read box`);
    await writeRace(db, id, { verdict: "READ", status: "box", rows: pf.rows, marked: pf.box.marked, url: pg.url }, T(8));
  }
  const fiveRows = (await db.execute(
    `SELECT race_id, name, printed_party, on_ballot, withdrawn FROM general_ballot WHERE on_ballot = 1 AND withdrawn = 1 ORDER BY race_id`,
  )).rows.map((r) => ({ ...r }));
  check("the five printed AND withdrawn are stored as one row each, on_ballot 1 · withdrawn 1",
    fiveRows.length === 5 && fiveRows.every((r, i) => r.race_id === fiveRaces[i]),
    fiveRows.map((r) => `${r.race_id} ${r.name} (printed ${JSON.stringify(r.printed_party)})`).join(" · "));
  db.close();

  // Red: the same statements, one at a time, outside a transaction.
  const redUrl = await seedCopy("writes-red-749-control.db", seed);
  await copyWrite(redUrl, raceWriteStatements(race, { verdict: "READ", status: "box", rows: pr.rows, marked: 0, url: src }, T(4)), "leg 3 red setup");
  const red = copyClient(redUrl, "leg 3 red, no transaction");
  let redThrown = "";
  try {
    for (const s of stmts) await red.execute(s);
  } catch (e) {
    redThrown = String(e).slice(0, 120);
  }
  const redRows = await rowsOf(red, race);
  check("red: the same statements outside a transaction lose the race's rows", redThrown !== "" && redRows.length < n, `threw ${JSON.stringify(redThrown)} · ${n} → ${redRows.length} rows`);
  red.close();
}

// ── leg 4 ──────────────────────────────────────────────────────────────────
// The IO shim: saved pages by the URL HO 747 read them at, Ballotpedia's own
// 202 on a chosen request, a 404 for any URL with no saved page (which is how a
// Senate race's regular URL falls through to its special one), and a fake clock
// that each request advances by `latencyMs`.
function shimIO(opts: { latencyMs: number; failAt?: number; failFrom?: number; failTo?: number; walls?: [number, number][]; startAt?: string }): IO & { log: { url: string; at: number; status: number }[]; clock: { t: number } } {
  const byUrl = new Map(manifest().map((m) => [m.url, m.file!]));
  const challenge = loadPage(CHALLENGE_FILE);
  const clock = { t: Date.parse(opts.startAt ?? "2026-09-26T12:20:00.000Z") };
  const log: { url: string; at: number; status: number }[] = [];
  return {
    log,
    clock,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
    get: async (url) => {
      const at = clock.t;
      clock.t += opts.latencyMs;
      const n = log.length + 1;
      const file = byUrl.get(url);
      const walled = n === opts.failAt || (opts.failFrom !== undefined && n >= opts.failFrom && (opts.failTo === undefined || n <= opts.failTo)) || (opts.walls ?? []).some(([a, b]) => n >= a && n <= b);
      const status = walled ? 202 : file ? 200 : 404;
      log.push({ url, at, status });
      if (status === 202) return { kind: "response", status, body: challenge };
      return file ? { kind: "response", status: 200, body: loadPage(file) } : { kind: "response", status: 404, body: "not found" };
    },
  };
}
async function leg4(seed: Seed) {
  console.log("\n── Leg 4 · the run, on a file: copy, with an IO shim serving saved pages");
  const url = await seedCopy("run-749-control.db", seed);
  const db = copyClient(url, "leg 4 runs");
  const ids = seed.races.filter((r) => Number(r.cycle) === 2026).map((r) => String(r.id)).sort();
  // Every race attempted before, oldest last by id, except three never attempted.
  const never = ["NY-10-2026", "OH-09-2026", "TX-28-2026"];
  const stamped = ids.filter((id) => !never.includes(id));
  await copyWrite(
    url,
    stamped.map((id, i) => ({
      sql: `INSERT INTO general_ballot_reads (race_id, last_attempt_at, last_attempt) VALUES (?, ?, 'UNREAD')`,
      args: [id, new Date(Date.parse("2026-09-20T00:00:00.000Z") + (stamped.length - i) * 60_000).toISOString()],
    })),
    "leg 4 perturb: stamp all but three",
  );
  const expected = [...never.sort(), ...stamped.slice().reverse().slice(0, 3)];
  const ioA = shimIO({ latencyMs: 700 });
  const order: string[] = [];
  const rA = await runGeneralBallot(db, { write: true, cap: 6, io: ioA, onRace: (l) => order.push(l.race) });
  check("never-attempted races go first (race_id order), then the oldest attempts", JSON.stringify(order) === JSON.stringify(expected), `${order.join(", ")} (expected ${expected.join(", ")}) · stop ${rA.stop}`);

  // A 202 on the fifth request.
  const head = (await selectQueue(db)).slice(0, 7).map((r) => r.id);
  const snapshot = async (id: string) => JSON.stringify(await readsOf(db, id));
  const beforeSixth = await snapshot(head[5]!);
  // A later clock than run A's, so this run's stamps are the newest.
  const ioB = shimIO({ latencyMs: 700, failAt: 5, startAt: "2026-09-26T14:20:00.000Z" });
  const tried: string[] = [];
  const rB = await runGeneralBallot(db, { write: true, cap: TICK_CAP, io: ioB, stopRule: "first-unread", onRace: (l) => tried.push(`${l.race}:${l.verdict}`) });
  const fifth = await readsOf(db, head[4]!);
  const tail = (await selectQueue(db)).at(-1)?.id;
  check("a 202 on the fifth request ends the run there, that race stamped UNREAD, nothing after it attempted",
    rB.stop === "unread" && rB.attempted === 5 && ioB.log.length === 5 && fifth?.last_attempt === "UNREAD" && (await snapshot(head[5]!)) === beforeSixth && tail === head[4],
    `stop ${rB.stop} · attempted ${rB.attempted} · requests ${ioB.log.length} · ${tried.join(" ")} · ${head[4]} last_attempt ${fifth?.last_attempt} · ${head[5]} ${(await snapshot(head[5]!)) === beforeSixth ? "untouched" : "CHANGED"} · back of the queue now ${tail}`);
  // Red for the stop: the same shim under the CLI's --all rule runs past it,
  // so it is the cron's rule, not the shim, that ended the run above.
  const ioR = shimIO({ latencyMs: 700, failAt: 5, startAt: "2026-09-26T16:20:00.000Z" });
  const rR = await runGeneralBallot(db, { write: false, cap: 8, io: ioR, stopRule: "streak" });
  check("red: under the --all rule the same 202 on the fifth request does not end the run",
    rR.stop === "cap" && rR.attempted === 8 && rR.verdicts.UNREAD === 1, `stop ${rR.stop} · attempted ${rR.attempted} · UNREAD ${rR.verdicts.UNREAD}`);
  // The --all rule, as HO 747 ruled it (findings D1; the census's streak =
  // UNREAD_STREAK - 1): five UNREAD in a row pause the pass for 15 minutes,
  // once, and the NEXT UNREAD stops it. The expected numbers are HO 747's
  // stub control B's shape, not read off this code: walled from request 3,
  // requests 3-7 pause the pass and request 8 stops it.
  const ioS = shimIO({ latencyMs: 700, failFrom: 3, startAt: "2026-09-26T18:20:00.000Z" });
  const s0 = ioS.clock.t;
  const rS = await runGeneralBallot(db, { write: false, io: ioS, stopRule: "streak" });
  const gap = ioS.log.slice(1).map((l, i) => l.at - ioS.log[i]!.at);
  check("the --all rule: five UNREAD in a row pause once for 15 minutes, and the next UNREAD stops the pass",
    rS.stop === "unread" && rS.pauses === 1 && rS.attempted === 8 && rS.verdicts.UNREAD === 6 && ioS.log.length === 8 && Math.max(...gap) >= 15 * 60_000,
    `stop ${rS.stop} · pauses ${rS.pauses} · attempted ${rS.attempted} (READ ${rS.verdicts.READ}, UNREAD ${rS.verdicts.UNREAD}) · requests ${ioS.log.length} · longest gap ${(Math.max(...gap) / 60_000).toFixed(1)} min · pass clock ${((ioS.clock.t - s0) / 60_000).toFixed(1)} min`);
  // And a READ after the pause resets the count. HO 747's own discriminating
  // shape: five 202s (requests 3-7, the pause), a READ (8), five more 202s
  // (9-13). With the reset the second five are a fresh streak, and the pass
  // stops at request 13 (10 UNREAD); without it the armed count survives the
  // READ and request 9 stops the pass (6 UNREAD).
  const ioT = shimIO({ latencyMs: 700, walls: [[3, 7], [9, 13]], startAt: "2026-09-26T20:20:00.000Z" });
  const rT = await runGeneralBallot(db, { write: false, cap: 20, io: ioT, stopRule: "streak" });
  check("the --all rule: a READ after the pause resets the count (five 202s, a READ, five 202s stop at the thirteenth request)",
    rT.stop === "unread" && rT.pauses === 1 && rT.attempted === 13 && rT.verdicts.UNREAD === 10 && ioT.log.length === 13,
    `stop ${rT.stop} · pauses ${rT.pauses} · attempted ${rT.attempted} (READ ${rT.verdicts.READ}, UNREAD ${rT.verdicts.UNREAD}) · requests ${ioT.log.length} (without the reset: 9 and 6)`);
  db.close();

  // The cap and the budget, through the route's own wrapper and tick function,
  // with getDb() pointed at a copy.
  const cronUrl = await seedCopy("cron-749-control.db", seed);
  schemeOf(cronUrl, "leg 4 getDb");
  // A marker only this copy carries, so where getDb() points is proved by the
  // copy's own content, whatever prod's schema is.
  await copyWrite(cronUrl, [{ sql: `CREATE TABLE leg749_marker (x INTEGER)`, args: [] }], "leg 4 marker");
  process.env.TURSO_DATABASE_URL = cronUrl;
  delete process.env.TURSO_AUTH_TOKEN;
  const { getDb } = await import("@/lib/db");
  const { wrapCronRoute } = await import("@/lib/cron-log");
  const where = await getDb().execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'leg749_marker'`);
  const onCopy = Number(where.rows[0]?.n) === 1;
  check("getDb() points at the copy (it sees the copy's own marker table)", onCopy, `leg749_marker seen through getDb(): ${where.rows[0]?.n}`);
  // A hard stop, not a count: nothing below may run unless getDb() is the copy.
  if (!onCopy) throw new Error("refused: getDb() does not point at the leg 4 copy; not running wrapCronRoute");
  // HO 750: a tick that wrote a READ now expires the `general-ballot` tag, and
  // the default flush (revalidateTag) throws outside a Next request, which would
  // turn every tick below into an `error` row. The flush is HO 750's leg 6's to
  // read; here it is a no-op.
  const noFlush = (_tag: string) => {};
  for (const [label, latencyMs, want] of [["cap", 700, "cap"], ["budget", 7_000, "budget"]] as const) {
    const io = shimIO({ latencyMs });
    const t0 = io.clock.t;
    const real0 = Date.now();
    const out = await wrapCronRoute("/api/cron/general-ballot", () => generalBallotTick(getDb(), io, noFlush), { softTimeoutMs: 290_000 });
    const fakeMs = io.clock.t - t0;
    const row = (await getDb().execute(`SELECT id, status, payload FROM cron_runs ORDER BY id DESC LIMIT 1`)).rows[0];
    const pl = JSON.parse(String(row?.payload ?? "{}")) as { payload?: { stop: string; attempted: number; minGapMs: number; requests: number } };
    check(`the ${label} stops a tick inside the soft timeout with a success row`,
      out.httpStatus === 200 && row?.status === "success" && pl.payload?.stop === want && fakeMs < 290_000 && (want !== "cap" || pl.payload?.attempted === TICK_CAP),
      `http ${out.httpStatus} · cron_runs #${row?.id} ${row?.status} · stop ${pl.payload?.stop} · attempted ${pl.payload?.attempted} · requests ${pl.payload?.requests} · smallest gap ${pl.payload?.minGapMs}ms · tick clock ${(fakeMs / 1000).toFixed(1)}s of ${TICK_BUDGET_MS / 1000}s budget / 290s soft timeout · real ${Date.now() - real0}ms`);
  }

  // The tick's own UNREAD stop, through the route's wrapper: a 202 on the third
  // request ends the tick there, the row is still `success`, and the UNREAD is
  // named in the row's error_message (chronicErr).
  {
    const io = shimIO({ latencyMs: 700, failAt: 3, startAt: "2026-09-26T22:20:00.000Z" });
    const out = await wrapCronRoute("/api/cron/general-ballot", () => generalBallotTick(getDb(), io, noFlush), { softTimeoutMs: 290_000 });
    const row = (await getDb().execute(`SELECT id, status, payload, error_message FROM cron_runs ORDER BY id DESC LIMIT 1`)).rows[0];
    const pl = JSON.parse(String(row?.payload ?? "{}")) as { payload?: { stop: string; attempted: number; unread: { race: string; cause: string }[] } };
    const u = pl.payload?.unread?.[0];
    check("the tick's first UNREAD ends it with a success row, the UNREAD named in chronicErr",
      out.httpStatus === 200 && row?.status === "success" && pl.payload?.stop === "unread" && pl.payload?.attempted === 3 && u !== undefined && String(row?.error_message ?? "").includes(`general-ballot UNREAD ${u.race} (no-anchor-202)`),
      `http ${out.httpStatus} · cron_runs #${row?.id} ${row?.status} · stop ${pl.payload?.stop} · attempted ${pl.payload?.attempted} · error_message ${JSON.stringify(row?.error_message)}`);
  }

  // A timer that wakes early. HO 749's Preview POST (cron_runs #20320) measured
  // minGapMs 5999 on Vercel: a setTimeout can fire a millisecond before the
  // clock reads its target. The pacer must re-check the clock rather than
  // trust one sleep. This IO's sleep undershoots every wait by 1ms.
  {
    const early = shimIO({ latencyMs: 700, startAt: "2026-09-27T00:20:00.000Z" });
    const sleepExact = early.sleep;
    // 1ms short on any wait over 1ms; a 1ms wait still advances 1ms, as a
    // real timer does, so the pacer's re-check can finish.
    early.sleep = (ms) => sleepExact(ms > 1 ? ms - 1 : ms);
    const ec = copyClient(cronUrl, "leg 4 early timer");
    const rE = await runGeneralBallot(ec, { write: false, cap: 4, io: early });
    ec.close();
    check("an early-waking timer (1ms short) still leaves every start-to-start gap at least 6s",
      (rE.minGapMs ?? 0) >= MIN_START_GAP_MS, `minGapMs ${rE.minGapMs} over ${rE.requests} requests`);
  }

  // The 6s spacing on the real clock: liveIO() itself, globalThis.fetch shimmed.
  const byUrl = new Map(manifest().map((m) => [m.url, m.file!]));
  const realFetch = globalThis.fetch;
  const starts: number[] = [];
  const agents = new Set<string>();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    starts.push(Date.now());
    agents.add(new Headers(init?.headers).get("user-agent") ?? "(none)");
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const file = byUrl.get(u);
    return new Response(file ? loadPage(file) : "not found", { status: file ? 200 : 404 });
  }) as typeof fetch;
  try {
    const live = copyClient(cronUrl, "leg 4 real clock");
    const rR = await runGeneralBallot(live, { write: false, raceIds: ["AK-AL-2026", "FL-20-2026", "NY-10-2026"], io: liveIO() });
    live.close();
    const gaps = starts.slice(1).map((s, i) => s - starts[i]!);
    check("real clock: every start-to-start gap is at least 6s, and the scraper's user agent is sent",
      gaps.length === 2 && gaps.every((g) => g >= MIN_START_GAP_MS) && (rR.minGapMs ?? 0) >= MIN_START_GAP_MS && agents.size === 1 && agents.has(USER_AGENT),
      `gaps ${gaps.join("ms, ")}ms (fetch-side) · minGapMs ${rR.minGapMs} (pacer-side) · READ ${rR.verdicts.READ}/${rR.attempted} · user agent ${agents.has(USER_AGENT) ? "the scraper's" : [...agents].join("|")}`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── leg 5 ──────────────────────────────────────────────────────────────────
type CensusInc = { race: string; bioguide: string; bucket: string; route: string | null; where: string[] };
async function leg5(seed: Seed) {
  console.log("\n── Leg 5 · identity, from the saved pages");
  const url = await seedCopy("identity-749-control.db", seed);
  const db = copyClient(url, "leg 5 identity");
  const identity = await loadIdentity(db);
  db.close();
  const fl = pageResult("FL-20-2026", readPageModel(pageOf("FL-20-2026").html), identity, "t");
  const dws = fl.rows.filter((r) => /Wasserman Schultz/.test(r.name));
  check("FL-20's Wasserman Schultz carries W000797", dws.length === 1 && dws[0]!.bioguide_id === "W000797", JSON.stringify(dws.map((r) => [r.name, r.person_key, r.bioguide_id])));

  const ak = pageResult("S-AK-2026", readPageModel(pageOf("S-AK-2026").html), identity, "t");
  const sullivans = ak.rows.filter((r) => /\bSullivan$/.test(r.name));
  const senator = sullivans.find((r) => r.person_key === "Daniel_S._Sullivan_(United_States_Senator_from_Alaska)");
  const namesake = sullivans.find((r) => r.person_key === "Dan_Sullivan_(Alaska_U.S._Senate_candidate)");
  const title = String(seed.members.find((m) => m.bioguide_id === "S001198")?.ballotpedia_title);
  // The red is what the ingest actually stored, read from prod: its surname
  // matcher (buildSenateMatcher, lib/primaries-sync.ts) gave both the senator's.
  const ingest = seed.akSullivans;
  check("red: the ingest stored both of S-AK's Sullivans with the senator's S001198 (primary_candidates, read from prod)",
    sullivans.length === 2 && senator !== undefined && namesake !== undefined && ingest.length === 2 && ingest.every((r) => r.bioguide_id === "S001198"),
    `ballot: ${sullivans.map((r) => `"${r.name}" [${r.person_key}]`).join(" · ")} · ingest: ${ingest.map((r) => `"${r.name}" ${r.bioguide_id} incumbent=${r.incumbent} ${r.status}`).join(" · ")}`);
  check("by identity the namesake carries NULL", namesake?.bioguide_id === null, `${namesake?.person_key} → ${namesake?.bioguide_id}`);
  check("by identity the senator carries NULL too: his stored title is stale (HO 747 title-mismatch), and no name route is taken",
    senator?.bioguide_id === null && titleKey(title) !== senator?.person_key,
    `stored title ${JSON.stringify(title)} → key ${titleKey(title)} · his ballot href ${senator?.person_key} → ${senator?.bioguide_id} (the handoff expected S001198)`);

  // The whole census. For every 2026 race, the lib's rows carrying a stored
  // incumbent's bioguide, against the census's per-incumbent reading.
  const incs = (JSON.parse(readFileSync(CENSUS_JSON, "utf8")) as { incumbent: CensusInc | null }[]).map((r) => r.incumbent).filter((i): i is CensusInc => i !== null);
  const stored = new Map(seed.races.filter((r) => Number(r.cycle) === 2026 && r.incumbent_bioguide_id).map((r) => [String(r.id), String(r.incumbent_bioguide_id)]));
  const raceOf = new Map([...stored].map(([race, b]) => [b, race]));
  // The census looked for incumbents among BALLOT rows only; the lib also stores
  // the withdrawn block, so the comparison is on withdrawn = 0, and a stored
  // incumbent found in their own withdrawn block is named on its own.
  const ownByLib = new Set<string>(), otherByLib = new Set<string>(), ownWithdrawn: string[] = [];
  for (const p of manifest()) {
    const pr = pageResult(p.raceId, readPageModel(loadPage(p.file!)), identity, "t");
    for (const r of pr.rows) {
      if (!r.bioguide_id) continue;
      if (!r.on_ballot) {
        if (stored.get(p.raceId) === r.bioguide_id) ownWithdrawn.push(`${p.raceId} ${r.name} (${r.bioguide_id}, printed ${JSON.stringify(r.printed_party)})`);
        continue;
      }
      if (stored.get(p.raceId) === r.bioguide_id) ownByLib.add(p.raceId);
      else if (raceOf.has(r.bioguide_id)) otherByLib.add(`${raceOf.get(r.bioguide_id)}→${p.raceId}`);
    }
  }
  const ownByCensus = new Set(incs.filter((i) => i.bucket === "on-own-ballot" && i.route === "identity").map((i) => i.race));
  const otherByCensus = new Set(incs.filter((i) => i.bucket === "on-other-ballot" && i.route === "identity").flatMap((i) => i.where.map((w) => `${i.race}→${w}`)));
  const mismatch = incs.filter((i) => i.bucket === "title-mismatch");
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
  const only = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).slice(0, 5).join(", ") || "none";
  check("the lib puts a stored incumbent's bioguide on their own ballot in exactly the census's identity races",
    same(ownByLib, ownByCensus), `lib ${ownByLib.size} · census ${ownByCensus.size} (on-own-ballot|identity) · only lib ${only(ownByLib, ownByCensus)} · only census ${only(ownByCensus, ownByLib)}`);
  check("and on another race's ballot in exactly the census's other-ballot identity pairs",
    same(otherByLib, otherByCensus), `lib ${otherByLib.size} · census ${otherByCensus.size} (on-other-ballot|identity) · only lib ${only(otherByLib, otherByCensus)} · only census ${only(otherByCensus, otherByLib)}`);
  console.log(`    stored incumbents found in their own box's withdrawn block, by identity: ${ownWithdrawn.length ? ownWithdrawn.join(" · ") : "none"}`);
  // Who identity cannot tie, measured rather than quoted: a stored incumbent
  // whose own box has no row carrying their bioguide but does carry an
  // underlined ballot row with none. The census's `title-mismatch` bucket is
  // NOT this set: it means "found by name anywhere in the state".
  const bucketOf = new Map(incs.map((i) => [i.race, i.bucket]));
  const untied: { race: string; bucket: string; row: string }[] = [];
  for (const p of manifest()) {
    const inc = stored.get(p.raceId);
    if (!inc) continue;
    const pr = pageResult(p.raceId, readPageModel(loadPage(p.file!)), identity, "t");
    const ballot = pr.rows.filter((r) => r.on_ballot);
    if (ballot.some((r) => r.bioguide_id === inc)) continue;
    const u = ballot.filter((r) => r.incumbent_marked && r.bioguide_id === null);
    if (u.length) untied.push({ race: p.raceId, bucket: bucketOf.get(p.raceId) ?? "?", row: u.map((r) => `${r.name} [${r.person_key}]`).join(" / ") });
  }
  const byBucket: Record<string, number> = {};
  for (const x of untied) byBucket[x.bucket] = (byBucket[x.bucket] ?? 0) + 1;
  console.log(`    stored incumbents underlined on their own box with no bioguide: ${untied.length} ${JSON.stringify(byBucket)}`);
  for (const x of untied) console.log(`      ${x.race} (${x.bucket}) ${x.row}`);
  const ids = new Set(untied.map((x) => x.race));
  // Whose underline is it? The census's name route says where each stored
  // incumbent stands (`where`). If it put the race's OWN incumbent here, the
  // underlined row is them. If it put ANOTHER race's incumbent here, the row is
  // a member who changed districts, not an own-challenger case. Neither: the
  // census missed the name (WA-09's "D. Adam Smith").
  const whereOf = new Map(incs.map((i) => [i.race, i.where]));
  const cls = (race: string) =>
    (whereOf.get(race) ?? []).includes(race)
      ? "own, found by name"
      : incs.some((i) => i.race !== race && i.where.includes(race))
        ? "another race's incumbent"
        : "own, census missed";
  const byCls: Record<string, string[]> = {};
  for (const x of untied) (byCls[cls(x.race)] ??= []).push(x.race);
  for (const [k, v] of Object.entries(byCls)) console.log(`    ${k}: ${v.length}${v.length <= 5 ? ` (${v.join(", ")})` : ""}`);
  const own = (byCls["own, found by name"]?.length ?? 0) + (byCls["own, census missed"]?.length ?? 0);
  const moved = byCls["another race's incumbent"] ?? [];
  const missed = byCls["own, census missed"] ?? [];
  check("identity leaves 42 stored incumbents untied on their own ballot (41 found by the census's name route, and WA-09 it missed); TX-37, UT-04 and UT-02 underline another race's incumbent; AL-01 and TX-22 are not among them",
    own === 42 && missed.length === 1 && missed[0] === "WA-09-2026" && moved.length === 3 && ["TX-37-2026", "UT-04-2026", "UT-02-2026"].every((r) => moved.includes(r)) && ids.has("S-AK-2026") && !ids.has("AL-01-2026") && !ids.has("TX-22-2026") && untied.every((x) => x.bucket !== "on-own-ballot"),
    `${untied.length} untied: ${own} own (${byCls["own, found by name"]?.length ?? 0} found by name, ${missed.length} missed) + ${moved.length} another race's incumbent · buckets ${JSON.stringify(byBucket)}`);
}

async function main(): Promise<number> {
  mkdirSync(ART, { recursive: true });
  const only = process.argv.includes("--leg") ? Number(process.argv[process.argv.indexOf("--leg") + 1]) : null;
  const run = (n: number) => only === null || only === n;
  console.log(`=== HO 749 legs · ${new Date().toISOString()} · lib/general-ballot.ts at the working tree ===`);
  const fp0 = await prodFingerprint();
  console.log(`prod fingerprint before: ${fp0}`);
  const seed = await readSeed();
  console.log(`seed read from prod (SELECT only): races ${seed.races.length} · member_ids ${seed.members.length}`);
  if (run(1)) {
    leg1();
    leg1Stored();
  }
  if (run(2)) await leg2();
  if (run(3)) await leg3(seed);
  if (run(5)) await leg5(seed);
  if (run(4)) await leg4(seed); // last: it repoints getDb() at a copy
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
