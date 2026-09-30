// HO 758 legs: a decided race shows its result (ruled C), on `file:` copies seeded whole from prod,
// with marks planted by hand (no prod row is marked) and the clock set to Nov 4, each leg red first.
//
//   npx tsx scripts/diagnostic/election-night-legs-758.ts --seed --label L    # template, four copies, leg 6's harvest
//   (HEAD build)  npx tsx scripts/diagnostic/election-night-legs-758.ts --phase before --label L
//   (tree build)  npx tsx scripts/diagnostic/election-night-legs-758.ts --phase after --label L
//
// Four copies of one seed:
//   head   HEAD's harvest (lib/harvest-challengers.ts at f021528, loaded with git cat-file), no marks
//   new    the tree's harvest, no marks (dormancy)
//   marks  the tree's harvest after Louisiana's winners are planted, then general-ballot marks planted:
//          MI-04 Huizenga (re-elected), IA-02 Joe Mitchell (open seat, the incumbent off the ballot),
//          FL-14 Mike Beltran (defeated), CO-08 none (not called), LA-01 Scalise + Jewett (a runoff),
//          LA-02 Renada Collins (one winner)
//   hmarks HEAD's harvest with the same plants, so HEAD's reds read HEAD's own roster
//   band   the tree's harvest, then 61 of the rated index's seats marked (Senate among them), planted
//          House totals, and one Louisiana winner
// Each server run gets its copy's own sentinel on /api/health, a cleared .next/cache/fetch-cache, and
// for "Nov 4" CBT_CLOCK_NOW (lib/clock.ts honours it only against a file: database). HEAD's code has
// no seam, so HEAD reads today whatever the variable says: that is the red for legs 2-7.
//   1 dormant      clock today, no marks: every race page's <main> and the band's markup equal HEAD's
//                  (head copy, HEAD build) except Louisiana's six, which the jungle rule gives a roster
//   2 re-elected   header Decided, chips dimmed and "final call ·", re-elected, no Elected row (the
//                  incumbent is no roster row), the provenance line with the read time
//   3 open seat    Elected on Joe Mitchell's row, "not on the ballot" on the card
//   4 defeated     Elected on Mike Beltran's row, "defeated" on the card
//   5 not called   Not yet called, chips dimmed, the "No call" provenance line
//   6 Louisiana    the harvest: LA-01's Jewett `advanced`, the rest on_ballot, LA-02 all on_ballot; the
//                  pages: LA-01 Runoff Dec 12 + "runoff Dec 12" on Scalise's card; LA-02 Elected on
//                  Collins, Decided, "defeated" on Carter's card
//   7 the band     Nov 4: the RESULTS line reads the planted numbers; today: HEAD's ELECTION DAY line
//   8 captures     legs 2, 3, 5, 6 and the band at 1440, 2560 and reduced motion, HEAD's before beside
//  10 the review's shapes  AR-02 with two marks (a general runoff): Runoff, runoff on the card, no
//                  Elected; S-ME's curated "Troy Jackson" with the ballot's "Troy Dale Jackson" marked:
//                  Elected on the curated row, defeated on Collins's card; FL-10 (no_box): the no-box line
//   9 the reader   on HO 747's 388 saved pages: a ranked-choice general box marks its "Won (N)" row
//                  and nothing else (AK-AL 2024 Begich, ME-02 Golden, ME-01 Pingree), every other box
//                  marks exactly as HEAD's reader does, and a marked row goes through the reader's
//                  own write path into a copy's general_ballot.marked
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed and a fingerprint before and after
// every mode. Copies are `file:${abs}` from paths ending -758-legs.db; children get that URL with
// TURSO_AUTH_TOKEN="" (not deleted: dotenv and Next's loader refill a missing key). Every printed
// line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "f021528";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/758-artifacts");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const PORT = 3758;
const ROUTE = "/api/cron/race-challengers";
const NOV4 = "2026-11-04T15:00:00.000Z"; // 8am MT the morning after
const SENTINEL: Record<string, string> = { head: "2026-09-29T23:58:01.758Z", new: "2026-09-29T23:58:02.758Z", marks: "2026-09-29T23:58:03.758Z", band: "2026-09-29T23:58:04.758Z", hmarks: "2026-09-29T23:58:05.758Z", reader: "2026-09-29T23:58:06.758Z" };
const TABLES = ["races", "members", "member_ids", "race_ratings", "race_candidates", "kalshi_odds", "polymarket_odds", "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads"];
// The planted scenarios (names as the ballot prints them; STEP 0's plant check read them).
const PLANT = {
  reelected: { race: "MI-04-2026", mark: ["Bill Huizenga"] },
  open: { race: "IA-02-2026", mark: ["Joe Mitchell"] },
  defeated: { race: "FL-14-2026", mark: ["Mike Beltran"] },
  notCalled: { race: "CO-08-2026", mark: [] as string[] },
  laRunoff: { race: "LA-01-2026", winners: ["Steve Scalise", "Lauren Jewett"] },
  laOne: { race: "LA-02-2026", winners: ["Renada Collins"] },
  // leg 10, the review's shapes
  boxRunoff: { race: "AR-02-2026", mark: ["French Hill", "Chris Jones"] },
  curated: { race: "S-ME-2026", mark: ["Troy Dale Jackson"] },
  noBox: { race: "FL-10-2026", mark: [] as string[] },
};
const BAND_CALLED = 61;
const CAPTURE = [PLANT.reelected.race, PLANT.open.race, PLANT.notCalled.race, PLANT.laRunoff.race, PLANT.laOne.race];

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
const reader = (db: Client) => (sql: string, args: InArgs = []) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("prod is read-only here");
  return db.execute({ sql, args });
};
// A difference between two fingerprints passes only when each changed component is explained by a
// prod cron's OWN run that started inside the window (the legs write file: copies only, so a prod
// change can only be a cron's): race_candidates by the race-challengers cron, general_ballot and its
// reads by the general-ballot cron, primary_candidates by the primaries cron. The schema is never
// explainable. The first before phase ran across the primaries cron's 00:00Z tick and read a bare
// "differ", which is what this reports now.
async function prodUntouched(label: string, fp0: string, t0: string) {
  const fp1 = await prodFingerprint();
  if (fp0 === fp1) { check("*", `prod untouched (${label})`, true, "fingerprints equal"); return; }
  const a = JSON.parse(fp0) as Record<string, unknown>, b = JSON.parse(fp1) as Record<string, unknown>;
  const changed = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const db = prodClient();
  const runs = (await reader(db)(`SELECT id, route, started_at, status FROM cron_runs WHERE started_at >= ? ORDER BY id`, [t0])).rows.map((r) => ({ route: String(r.route), at: String(r.started_at), id: Number(r.id), status: String(r.status) }));
  db.close();
  const by = (route: string) => runs.some((r) => r.route === route);
  const explained: Record<string, boolean> = { rc: by(ROUTE), gb: by("/api/cron/general-ballot"), reads: by("/api/cron/general-ballot"), pc: by("/api/cron/primaries"), runs: runs.length > 0, schema: false };
  const unexplained = changed.filter((k) => !explained[k]);
  check("*", `prod untouched (${label}): every difference is a prod cron's own run in the window`, unexplained.length === 0, `changed ${changed.join(", ")} · runs in the window: ${runs.map((r) => `${r.route}#${r.id} ${r.at} ${r.status}`).join("; ") || "none"}${unexplained.length ? ` · UNEXPLAINED ${unexplained.join(", ")}` : ""}`);
}
async function prodFingerprint(): Promise<string> {
  const db = prodClient();
  const read = reader(db);
  const hash = async (q: string) => sha(JSON.stringify((await read(q)).rows.map((r) => Object.values(r))));
  const fp = {
    rc: await hash(`SELECT * FROM race_candidates ORDER BY race_id, name`),
    gb: await hash(`SELECT * FROM general_ballot ORDER BY race_id, person_key`),
    reads: await hash(`SELECT * FROM general_ballot_reads ORDER BY race_id`),
    pc: await hash(`SELECT * FROM primary_candidates ORDER BY id`),
    schema: await hash(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`),
    runs: (await read(`SELECT route, MAX(id) AS id FROM cron_runs WHERE route IN (?, '/api/cron/general-ballot', '/api/cron/primaries') GROUP BY route ORDER BY route`, [ROUTE])).rows.map((r) => `${r.route}#${r.id}`),
  };
  db.close();
  return JSON.stringify(fp);
}

// ── copies ──────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-758-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-758-legs.db")) throw new Error(`refused: a copy must be a *-758-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
function childEnv(url: string, clock: string | null): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: children get file: only");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url };
  env.TURSO_AUTH_TOKEN = "";
  if (clock) env.CBT_CLOCK_NOW = clock;
  else delete env.CBT_CLOCK_NOW;
  return env;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
function headHarvestFile(): string {
  const src = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:lib/harvest-challengers.ts`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const out = path.join(DIR, "head-harvest-758.ts");
  writeFileSync(out, src.replace(/from "\.\/([^"]+)"/g, 'from "@/lib/$1"').replace(/from "\.\.\/([^"]+)"/g, 'from "@/$1"'));
  return out;
}
type Harvest = { harvestChallengers: (db: Client) => Promise<Record<string, unknown>> };

async function seed() {
  mkdirSync(DIR, { recursive: true });
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  say(`prod before: ${fp0}`);
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
  });
  prod.close();
  say(`template: the real scripts/migrate.ts against file:, seeded whole from prod · ${counts.join(" · ")}`);
  const head = (await import(pathToFileURL(headHarvestFile()).href)) as Harvest;
  const tree = (await import("@/lib/harvest-challengers")) as Harvest;
  const sentinel = (kind: string) => ({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 758, 'success', ?)`, args: [ROUTE, SENTINEL[kind]!, SENTINEL[kind]!, JSON.stringify({ sentinel: `HO 758 legs, the ${kind} copy only` })] });
  const planted: Record<string, unknown> = {};
  for (const kind of ["head", "new", "marks", "hmarks", "band"] as const) {
    const abs = copyPath(kind);
    copyFileSync(tpl, abs);
    const url = copyUrl(abs);
    await withDb(url, (db) => db.execute(sentinel(kind)));
    if (kind === "marks" || kind === "hmarks") {
      // Louisiana's winners first, so the harvest publishes the runoff's two as `advanced`.
      await withDb(url, async (db) => {
        for (const [race, names] of [[PLANT.laRunoff.race, PLANT.laRunoff.winners], [PLANT.laOne.race, PLANT.laOne.winners]] as const) {
          const d = race.split("-")[1]!;
          for (const n of names) {
            const r = await db.execute({ sql: `UPDATE primary_candidates SET status = 'winner' WHERE name = ? AND primary_id IN (SELECT id FROM primaries WHERE state = 'LA' AND chamber = 'house' AND primary_type = 'jungle' AND CAST(district AS INTEGER) = ?)`, args: [n, Number(d)] });
            if (r.rowsAffected !== 1) throw new Error(`plant ${race} ${n}: ${r.rowsAffected} rows`);
          }
        }
      });
    }
    const h = kind === "head" || kind === "hmarks" ? head : tree;
    const result = await withDb(url, (db) => h.harvestChallengers(db));
    writeFileSync(path.join(ART, `harvest-${kind}-${LABEL}.json`), JSON.stringify(result, null, 1));
    if (kind === "marks" || kind === "hmarks") {
      await withDb(url, async (db) => {
        for (const p of [PLANT.reelected, PLANT.open, PLANT.defeated, PLANT.boxRunoff, PLANT.curated]) for (const n of p.mark) {
          const r = await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = ? AND name = ? AND on_ballot = 1`, args: [p.race, n] });
          if (r.rowsAffected !== 1) throw new Error(`plant ${p.race} ${n}: ${r.rowsAffected} rows`);
        }
      });
      planted.marks = PLANT;
    }
    if (kind === "band") planted.band = await plantBand(url);
    say(`copy ${path.basename(abs)} · harvested by ${kind === "head" || kind === "hmarks" ? `HEAD's harvest (${HEAD_SHA})` : "the tree's"}${kind === "marks" || kind === "hmarks" ? " after LA's winners were planted; general-ballot marks planted after" : kind === "band" ? "; the band's marks planted after" : ""}`);
  }
  writeFileSync(path.join(ART, `planted-${LABEL}.json`), JSON.stringify(planted, null, 1));
  await prodUntouched("the seed", fp0, t0);
}
// The band's plant: 61 rated seats get one marked row each, alternating R and D by id order, taking
// the rated Senate seats first so the Senate is exercised (a Senate mark counts toward N, never the
// House totals); 40 unrated House seats get planted totals (20 R, 19 D and one other, an I/L/G/O row);
// and one Louisiana seat (LA-03) gets one jungle winner, which counts in the House totals and the
// called seats. The expectation is computed here, from the plant, not from getElectionResults.
async function plantBand(url: string) {
  return withDb(url, async (db) => {
    const rated = (await db.execute(`SELECT r.id, r.chamber FROM races r WHERE r.cycle = 2026 AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026) AND r.id IN (SELECT race_id FROM general_ballot_reads WHERE status = 'box') ORDER BY r.chamber = 'house', r.id`)).rows.map((r) => ({ id: String(r.id), chamber: String(r.chamber) }));
    const ratedAll = Number((await db.execute(`SELECT COUNT(*) n FROM races r WHERE r.cycle = 2026 AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026)`)).rows[0]!.n);
    const pickRow = async (race: string, want: string[]) => {
      const rs = await db.execute({ sql: `SELECT person_key, name, party FROM general_ballot WHERE race_id = ? AND on_ballot = 1 AND write_in = 0 ORDER BY name`, args: [race] });
      for (const w of want) { const r = rs.rows.find((x) => (w === "other" ? !["D", "R"].includes(String(x.party)) : String(x.party) === w)); if (r) return { key: String(r.person_key), name: String(r.name), party: String(r.party) }; }
      return null;
    };
    const marks: { race: string; chamber: string; name: string; party: string }[] = [];
    let i = 0;
    for (const r of rated) {
      if (marks.filter((m) => rated.some((x) => x.id === m.race)).length >= BAND_CALLED) break;
      const row = await pickRow(r.id, i % 2 === 0 ? ["R", "D"] : ["D", "R"]);
      if (!row) continue;
      await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = ? AND person_key = ?`, args: [r.id, row.key] });
      marks.push({ race: r.id, chamber: r.chamber, name: row.name, party: row.party });
      i++;
    }
    const unrated = (await db.execute(`SELECT r.id FROM races r WHERE r.cycle = 2026 AND r.chamber = 'house' AND NOT EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026) AND r.id IN (SELECT race_id FROM general_ballot_reads WHERE status = 'box') ORDER BY r.id`)).rows.map((r) => String(r.id));
    let r = 0, d = 0, o = 0;
    for (const id of unrated) {
      if (r >= 20 && d >= 19 && o >= 1) break;
      const want = o < 1 ? ["other"] : r < 20 && (d >= 19 || r <= d) ? ["R"] : ["D"];
      const row = await pickRow(id, want);
      if (!row) continue;
      await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = ? AND person_key = ?`, args: [id, row.key] });
      marks.push({ race: id, chamber: "house", name: row.name, party: row.party });
      if (want[0] === "other") o++; else if (want[0] === "R") r++; else d++;
    }
    // One Louisiana winner (LA-03, unrated): a jungle row marked, counted as a House call.
    const la = (await db.execute(`SELECT pc.id, pc.name, pc.party FROM primary_candidates pc JOIN primaries p ON p.id = pc.primary_id WHERE p.state = 'LA' AND p.chamber = 'house' AND p.primary_type = 'jungle' AND CAST(p.district AS INTEGER) = 3 ORDER BY pc.name LIMIT 1`)).rows[0]!;
    await db.execute({ sql: `UPDATE primary_candidates SET status = 'winner' WHERE id = ?`, args: [la.id as number] });
    marks.push({ race: "LA-03-2026", chamber: "house", name: String(la.name), party: String(la.party) });
    const house = marks.filter((m) => m.chamber === "house");
    const senate = marks.filter((m) => m.chamber === "senate").length;
    const houseSeats = Number((await db.execute(`SELECT COUNT(*) n FROM races WHERE cycle = 2026 AND chamber = 'house'`)).rows[0]!.n);
    const latest = String((await db.execute(`SELECT MAX(read_at) t FROM general_ballot_reads WHERE status = 'box'`)).rows[0]!.t);
    const latestJungle = (await db.execute(`SELECT MAX(updated_at) t FROM primaries WHERE primary_type = 'jungle'`)).rows[0]!.t;
    const expect = {
      ratedCalled: new Set(marks.filter((m) => rated.some((x) => x.id === m.race)).map((m) => m.race)).size,
      rated: ratedAll,
      R: house.filter((m) => m.party === "R").length,
      D: house.filter((m) => m.party === "D").length,
      other: house.filter((m) => m.party !== "R" && m.party !== "D").length,
      open: houseSeats - new Set(house.map((m) => m.race)).size,
      latestReadAt: [latest, latestJungle == null ? "" : String(latestJungle)].sort().pop(),
    };
    say(`  band plant: ${marks.length} marked rows (${senate} Senate, one Louisiana winner) · expected ${JSON.stringify(expect)}`);
    return { marks, expect };
  });
}

// ── leg 9: the reader on HO 747's saved pages, in process ──────────────────
const PAGES = "docs/handoffs/747-artifacts/pages/2026-09-25T19-56-59-291Z";
type Reader = { readPageModel: (html: string) => { general: { rows: { name: string; winner: boolean }[] }[]; outsideGeneral: { h5: string; rows: { name: string; winner: boolean; key: string | null }[]; marked: number }[]; primaries: { rows: { winner: boolean }[] }[] }; pageResult: (...a: unknown[]) => { status: string; rows: Record<string, unknown>[] }; raceWriteStatements: (...a: unknown[]) => InStatement[] };
async function leg9() {
  say(`\n── leg 9, the reader (HO 747's saved pages)`);
  const { gunzipSync } = await import("node:zlib");
  const headSrc = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:lib/general-ballot.ts`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const headFile = path.join(DIR, "head-general-ballot-758.ts");
  writeFileSync(headFile, headSrc.replace(/from "\.\/([^"]+)"/g, 'from "@/lib/$1"').replace(/from "\.\.\/([^"]+)"/g, 'from "@/$1"'));
  const HEADR = (await import(pathToFileURL(headFile).href)) as Reader;
  const TREE = (await import("@/lib/general-ballot")) as unknown as Reader;
  const page = (f: string) => gunzipSync(readFileSync(path.join(PAGES, f))).toString("utf8");
  const files = readdirSync(PAGES).filter((f) => f.endsWith(".html.gz"));
  const rcvWinners = (m: ReturnType<Reader["readPageModel"]>) => m.outsideGeneral.filter((b) => b.rows.length && /Round eliminated/i.test(JSON.stringify(b))).map((b) => b.rows.filter((r) => r.winner).map((r) => r.name));
  // (a) the ranked-choice pages: each past RCV general box marks exactly its "Won (N)" row
  for (const [f, want] of [["AK-AL-2026.1.html.gz", "Begich"], ["ME-02-2026.1.html.gz", "Golden"], ["ME-01-2026.1.html.gz", "Pingree"]] as const) {
    const html = page(f);
    for (const [tag, R] of [["red: HEAD's reader", HEADR], ["green: the tree's reader", TREE]] as const) {
      const m = R.readPageModel(html);
      const rcv = m.outsideGeneral.filter((b) => /Round eliminated/i.test(html.slice(0)) && b.rows.length > 0);
      const firstGeneralPast = m.outsideGeneral.find((b) => b.rows.length > 1 && b.rows.some((r) => r.name.includes(want)));
      const winners = firstGeneralPast ? firstGeneralPast.rows.filter((r) => r.winner).map((r) => r.name) : [];
      check("9", `${tag} · ${f.split(".")[0]}: the latest past general box marks ${want} alone`, winners.length === 1 && winners[0]!.includes(want), `marked ${JSON.stringify(winners)} of ${firstGeneralPast?.rows.map((r) => r.name).join(", ") ?? "no box"} · ${rcv.length} past general boxes`);
    }
  }
  // (b) every other box on every saved page marks exactly as HEAD's reader does
  let boxes = 0, differ = 0, rcvBoxes = 0, preElection = 0;
  const diffs: string[] = [];
  for (const f of files) {
    const html = page(f);
    const a = HEADR.readPageModel(html), b = TREE.readPageModel(html);
    const flat = (m: ReturnType<Reader["readPageModel"]>) => [...m.general, ...m.outsideGeneral, ...m.primaries].map((x) => x.rows.map((r) => r.winner ? 1 : 0).join(""));
    const fa = flat(a), fb = flat(b);
    const rcvIdx = new Set(b.outsideGeneral.map((x, i) => (JSON.stringify(x).includes("Won (") || /Round eliminated/.test(JSON.stringify(x)) ? i + b.general.length : -1)).filter((i) => i >= 0));
    for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
      boxes++;
      if (fa[i] !== fb[i]) { differ++; if (diffs.length < 12) diffs.push(`${f.split(".")[0]}#${i}: ${fa[i]} → ${fb[i]}`); }
    }
    preElection += b.general.reduce((n, x) => n + x.rows.filter((r) => r.winner).length, 0);
    rcvBoxes += rcvIdx.size;
  }
  const onlyRcv = diffs.every((d) => /^(AK-AL|ME-01|ME-02|S-ME|S-AK)-2026/.test(d));
  check("9", "every box on the 388 saved pages marks as HEAD's reader does, but the ranked-choice general boxes of Alaska and Maine", onlyRcv, `${boxes} boxes read · ${differ} differ, all on AK/ME pages: ${onlyRcv} · ${diffs.join(" · ")}`);
  check("9", "no 2026 general box is marked on the saved pages (the dormancy premise, by the reader)", preElection === 0, `${preElection} marks in 2026 general boxes`);
  // (c) the write path: AK-AL's 2024 RCV box stood in for the 2026 box, through pageResult and the
  // reader's own write statements, into a copy
  const abs = copyPath("reader");
  if (existsSync(abs)) rmSync(abs);
  copyFileSync(copyPath("template"), abs);
  const html = page("AK-AL-2026.1.html.gz");
  for (const [tag, R] of [["red: HEAD's reader", HEADR], ["green: the tree's reader", TREE]] as const) {
    const m = R.readPageModel(html);
    const past = m.outsideGeneral.find((b) => b.rows.some((r) => r.name.includes("Begich")) && b.rows.length > 1)!;
    const res = R.pageResult("AK-AL-2026", { ...m, general: [past] }, new Map(), "2026-11-04T15:00:00.000Z");
    const stmts = R.raceWriteStatements("AK-AL-2026", { verdict: "READ", status: res.status, rows: res.rows, marked: past.marked, url: "file:saved-page" }, "2026-11-04T15:00:00.000Z");
    const got = await withDb(copyUrl(abs), async (db) => { await db.batch(stmts, "write"); return (await db.execute(`SELECT name, marked FROM general_ballot WHERE race_id = 'AK-AL-2026' ORDER BY name`)).rows.map((r) => `${r.name}:${r.marked}`); });
    const marked = got.filter((x) => x.endsWith(":1"));
    check("9", `${tag} · the write path: the marked row reaches general_ballot.marked, and only it`, marked.length === 1 && marked[0]!.includes("Begich"), got.join(", "));
  }
}

// ── leg 6's harvest half, in process ────────────────────────────────────────
async function leg6harvest() {
  say(`\n── leg 6, Louisiana's jungle rule (the harvest)`);
  const rows = async (kind: string, race: string) => withDb(copyUrl(copyPath(kind)), async (db) => (await db.execute({ sql: `SELECT name, party, status, source_url FROM race_candidates WHERE race_id = ? ORDER BY name`, args: [race] })).rows.map((r) => ({ name: String(r.name), party: String(r.party), status: String(r.status), src: String(r.source_url) })));
  for (const kind of ["head", "new", "marks"] as const) {
    const tag = kind === "head" ? "red: head copy (HEAD's harvest)" : kind === "new" ? "green: new copy (no mark)" : "green: marks copy (winners planted)";
    const la1 = await rows(kind, PLANT.laRunoff.race);
    const la2 = await rows(kind, PLANT.laOne.race);
    const all = (await withDb(copyUrl(copyPath(kind)), async (db) => (await db.execute(`SELECT COUNT(*) n, COUNT(DISTINCT race_id) races FROM race_candidates WHERE race_id LIKE 'LA-%'`)).rows[0]!));
    if (kind !== "marks") {
      // The expectation, per seat, from primary_candidates less the stored incumbent's bioguide.
      const perSeat = await withDb(copyUrl(copyPath(kind)), async (db) => (await db.execute(`SELECT r.id, (SELECT COUNT(*) FROM primary_candidates pc JOIN primaries p ON p.id = pc.primary_id WHERE p.state = r.state AND p.chamber = 'house' AND p.primary_type = 'jungle' AND CAST(p.district AS INTEGER) = r.district AND (pc.bioguide_id IS NULL OR pc.bioguide_id IS NOT r.incumbent_bioguide_id)) AS want, (SELECT COUNT(*) FROM race_candidates rc WHERE rc.race_id = r.id AND rc.status = 'on_ballot') AS got, (SELECT COUNT(*) FROM race_candidates rc WHERE rc.race_id = r.id) AS alln FROM races r WHERE r.state = 'LA' AND r.chamber = 'house' AND r.cycle = 2026 ORDER BY r.id`)).rows);
      const ok = perSeat.length === 6 && perSeat.every((x) => Number(x.want) > 0 && Number(x.got) === Number(x.want) && Number(x.alln) === Number(x.want));
      check("6", `${tag} · every candidate in each Nov-3 box but the incumbent publishes on_ballot, and nothing else`, ok && !la1.some((r) => r.name === "Steve Scalise"), `${perSeat.map((x) => `${x.id} ${x.got}/${x.want}`).join(" · ")}`);
    } else {
      check("6", `${tag} · LA-01's two winners: the non-incumbent advanced, the rest on_ballot, Scalise (the incumbent) no row`, la1.find((r) => r.name === "Lauren Jewett")?.status === "advanced" && la1.filter((r) => r.name !== "Lauren Jewett").every((r) => r.status === "on_ballot") && !la1.some((r) => r.name === "Steve Scalise"), la1.map((r) => `${r.name}/${r.status}`).join(", "));
      check("6", `${tag} · LA-02's one winner: every row on_ballot (the mark is read by the page, not a status)`, la2.length > 0 && la2.every((r) => r.status === "on_ballot") && !la2.some((r) => r.name === "Troy Carter"), la2.map((r) => `${r.name}/${r.status}`).join(", "));
      const pay = JSON.parse(readFileSync(path.join(ART, `harvest-marks-${LABEL}.json`), "utf8")) as { jungle?: { races: number; decided: number; runoff: number } };
      check("6", `${tag} · the payload's jungle census`, pay.jungle?.races === 6 && pay.jungle?.decided === 1 && pay.jungle?.runoff === 1, JSON.stringify(pay.jungle ?? null));
    }
  }
}

// ── the servers ─────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
function buildState(phase: string): string {
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim();
  const headBlob = (f: string) => execFileSync("git", ["rev-parse", `${HEAD_SHA}:${f}`], { encoding: "utf8" }).trim();
  const files = ["components/RaceHubBody.tsx", "components/Battlefield.tsx", "lib/queries.ts"];
  const atHead = files.filter((f) => blob(f) === headBlob(f));
  const want = phase === "before" ? files.length : 0;
  if (atHead.length !== want) throw new Error(`phase ${phase} needs ${want} of ${files.length} files at HEAD, found ${atHead.length}`);
  const built = statSync(".next/BUILD_ID").mtime;
  if (built.getTime() < Math.max(...files.map((f) => statSync(f).mtime.getTime()))) throw new Error("the build is older than the tree's files; rebuild first");
  return `build ${readFileSync(".next/BUILD_ID", "utf8").trim()} @ ${built.toISOString()} · ${atHead.length} of ${files.length} files at ${HEAD_SHA} · hub ${blob(files[0]!).slice(0, 10)} band ${blob(files[1]!).slice(0, 10)} queries ${blob(files[2]!).slice(0, 10)}`;
}
async function startServer(kind: string, clock: string | null) {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  const cache = path.resolve(".next/cache/fetch-cache");
  const n = existsSync(cache) ? readdirSync(cache).length : 0;
  rmSync(cache, { recursive: true, force: true });
  const log = path.join(DIR, `server758-${kind}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(log);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env: childEnv(copyUrl(copyPath(kind)), clock), stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => out.write(b));
  server.stderr.on("data", (b: Buffer) => out.write(b));
  const kill = async () => { try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } out.end(); await sleep(900); };
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).status > 0; } catch { /* not yet */ } }
  if (!up) { await kill(); throw new Error("the server never answered /api/health"); }
  const h = (await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json()) as { routes?: { path?: string; lastRunAt?: string }[] };
  const mine = h.routes?.find((r) => r.path === ROUTE);
  if (mine?.lastRunAt !== SENTINEL[kind]) { await kill(); throw new Error(`transport check failed: lastRunAt ${String(mine?.lastRunAt)} is not the ${kind} copy's sentinel`); }
  say(`  server :${PORT} (pid ${server.pid}) · ${kind} copy (own sentinel) · clock ${clock ?? "real"} · fetch-cache cleared (${n})`);
  return { kill };
}

// Page scripts are strings (tsx's keepNames wrapper), with no regex escapes (HO 736).
const READ_MAIN = `(() => { const m = document.querySelector('main'); return m ? m.innerHTML : ''; })()`;
const READ_BAND = `(() => { const b = document.querySelector('section.battlefield'); return b ? b.outerHTML : ''; })()`;
const READ_RACE = `(() => {
  const norm = (s) => (s || '').split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ');
  const header = document.querySelector('.race-header');
  const sub = header ? header.children[1] : null;
  const chips = header ? header.children[2] : null;
  const qual = document.querySelector('[data-incumbent-qualifier]');
  const h2 = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.trim().toLowerCase().startsWith('candidates ('));
  const section = h2 ? h2.closest('section') : null;
  const block = section ? section.querySelector('[data-roster-others]') : null;
  const lis = section ? Array.from(section.querySelectorAll('li')) : [];
  const prov = Array.from(document.querySelectorAll('[data-result-provenance]')).map((p) => norm(p.textContent));
  return {
    sub: sub ? norm(sub.textContent) : null,
    chipsOpacity: chips ? getComputedStyle(chips).opacity : null,
    chipsText: chips ? norm(chips.textContent) : null,
    qualifier: qual ? norm(qual.textContent) : null,
    majors: lis.filter((li) => !(block && block.contains(li))).map((li) => ({ text: norm(li.textContent), elected: !!li.querySelector('[data-elected]') })),
    others: lis.filter((li) => block && block.contains(li)).map((li) => ({ text: norm(li.textContent), elected: !!li.querySelector('[data-elected]') })),
    provenance: prov,
  };
})()`;
type RaceReading = { sub: string | null; chipsOpacity: string | null; chipsText: string | null; qualifier: string | null; majors: { text: string; elected: boolean }[]; others: { text: string; elected: boolean }[]; provenance: string[] };

async function phaseRun() {
  const phase = argAt("--phase");
  if (phase !== "before" && phase !== "after") throw new Error("--phase before|after");
  say(`\n── phase ${phase} · ${buildState(phase)}`);
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const out: Record<string, unknown> = {};
  const raceIds = await withDb(copyUrl(copyPath("new")), async (db) => (await db.execute(`SELECT id FROM races WHERE cycle = 2026 ORDER BY id`)).rows.map((r) => String(r.id)));
  const shots = path.join(ART, "captures");
  mkdirSync(shots, { recursive: true });
  const newPage = async (w = 1440, h = 1200, rm: "reduce" | "no-preference" = "reduce") => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: rm });
    await ctx.addCookies([{ name: "ct_seen", value: "1", domain: "127.0.0.1", path: "/" }]);
    return { ctx, page: await ctx.newPage() };
  };
  try {
    // leg 1: dormant, every race page's <main> and the band. HEAD reads its own copy.
    {
      const srv = await startServer(phase === "before" ? "head" : "new", null);
      const { ctx, page } = await newPage();
      const mains: Record<string, string> = {};
      for (const id of raceIds) {
        await page.goto(`http://127.0.0.1:${PORT}/race/${id}`, { waitUntil: "load" });
        mains[id] = (await page.evaluate(READ_MAIN)) as string;
      }
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
      const band = (await page.evaluate(READ_BAND)) as string;
      await ctx.close();
      await srv.kill();
      writeFileSync(path.join(DIR, `dormant-${phase}-${LABEL}.json`), JSON.stringify({ mains, band }));
      out.dormant = { pages: raceIds.length, band: sha(band), bandLen: band.length };
      say(`    leg 1 ${phase}: ${raceIds.length} race pages read · band ${band.length} bytes`);
    }
    // legs 2-6 and 8: the marks copy, clock Nov 4 (HEAD ignores the clock).
    {
      const srv = await startServer(phase === "before" ? "hmarks" : "marks", NOV4);
      const readings: Record<string, RaceReading> = {};
      for (const id of [PLANT.reelected.race, PLANT.open.race, PLANT.defeated.race, PLANT.notCalled.race, PLANT.laRunoff.race, PLANT.laOne.race, PLANT.boxRunoff.race, PLANT.curated.race, PLANT.noBox.race]) {
        const { ctx, page } = await newPage();
        await page.goto(`http://127.0.0.1:${PORT}/race/${id}`, { waitUntil: "networkidle" });
        readings[id] = (await page.evaluate(READ_RACE)) as RaceReading;
        await ctx.close();
      }
      for (const id of CAPTURE) for (const m of [{ tag: "1440", w: 1440, h: 1200, rm: "no-preference" as const }, { tag: "2560", w: 2560, h: 1440, rm: "no-preference" as const }, { tag: "1440-reduced", w: 1440, h: 1200, rm: "reduce" as const }]) {
        const { ctx, page } = await newPage(m.w, m.h, m.rm);
        await page.goto(`http://127.0.0.1:${PORT}/race/${id}`, { waitUntil: "networkidle" });
        await page.screenshot({ path: path.join(shots, `${phase}-${id}-${m.tag}.png`), fullPage: true });
        await ctx.close();
      }
      await srv.kill();
      out.races = readings;
      for (const [id, r] of Object.entries(readings)) say(`    ${phase} ${id} (Nov 4): ${r.sub} · chips ${r.chipsText ?? "none"} (opacity ${r.chipsOpacity}) · qualifier ${r.qualifier ?? "none"} · majors ${r.majors.map((x) => `${x.text}${x.elected ? " [E]" : ""}`).join(" | ")} · others ${r.others.length} · provenance ${JSON.stringify(r.provenance)}`);
    }
    // leg 7 and 8: the band copy, Nov 4 and today.
    for (const clock of [NOV4, null]) {
      const srv = await startServer("band", clock);
      try {
      const { ctx, page } = await newPage();
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
      const text = (await page.evaluate(`(() => { const e = document.querySelector('section.battlefield .ctl-eday'); return e ? e.textContent.split(' ').filter(Boolean).join(' ') : null; })()`)) as string | null;
      if (clock) for (const m of [{ tag: "1440", w: 1440, h: 1200, rm: "no-preference" as const }, { tag: "2560", w: 2560, h: 1440, rm: "no-preference" as const }, { tag: "1440-reduced", w: 1440, h: 1200, rm: "reduce" as const }]) {
        const p2 = await newPage(m.w, m.h, m.rm);
        await p2.page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
        // The band sits in the dashboard's Races panel, hidden until its tab is opened.
        const tab = p2.page.locator("button.dv2-racesbox-tab", { hasText: "Races" }).first();
        if (await tab.count()) { await tab.click(); await sleep(600); }
        const band = p2.page.locator("section.battlefield").first();
        if (await band.count()) await band.screenshot({ path: path.join(shots, `${phase}-band-${m.tag}.png`) });
        await p2.ctx.close();
      }
      await ctx.close();
      out[clock ? "bandNov4" : "bandToday"] = text;
      } finally { await srv.kill(); }
      say(`    ${phase} band (${clock ? "Nov 4" : "today"}): ${out[clock ? "bandNov4" : "bandToday"]}`);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(ART, `phase-${phase}-${LABEL}.json`), JSON.stringify(out, null, 1));
  await prodUntouched(phase, fp0, t0);
  evaluate(phase, out);
}

// ── the checks, on either phase's readings (HEAD's are the red) ────────────
function evaluate(phase: string, o: Record<string, unknown>) {
  const tag = phase === "before" ? "red: HEAD" : "green: the tree";
  const r = o.races as Record<string, RaceReading>;
  const planted = JSON.parse(readFileSync(path.join(ART, `planted-${LABEL}.json`), "utf8")) as { band: { expect: Record<string, number | string> } };
  // leg 1: dormant
  if (phase === "after") {
    const before = JSON.parse(readFileSync(path.join(DIR, `dormant-before-${LABEL}.json`), "utf8")) as { mains: Record<string, string>; band: string };
    const after = JSON.parse(readFileSync(path.join(DIR, `dormant-after-${LABEL}.json`), "utf8")) as { mains: Record<string, string>; band: string };
    const differ = Object.keys(after.mains).filter((id) => after.mains[id] !== before.mains[id]);
    const laOnly = differ.every((id) => id.startsWith("LA-") && id !== "LA-AL-2026");
    const la = differ.filter((id) => id.startsWith("LA-"));
    check("1", `${tag} · clock today, no marks: every race page's <main> equals HEAD's but Louisiana's six`, differ.length === 6 && laOnly, `${Object.keys(after.mains).length - differ.length} of ${Object.keys(after.mains).length} identical · differing: ${differ.join(", ") || "none"}`);
    const laGainedRoster = la.every((id) => /Also on the ballot/i.test(after.mains[id]!) && !/Also on the ballot/i.test(before.mains[id]!));
    check("1", `${tag} · Louisiana's six each gain the Nov-3 field as "Also on the ballot" (their other markup is not compared)`, la.length === 6 && laGainedRoster, `${la.filter((id) => /Also on the ballot/i.test(after.mains[id]!)).length} of ${la.length} gained the block`);
    check("1", `${tag} · clock today: the band's markup equals HEAD's`, after.band === before.band && after.band.length > 0, `${after.band.length} against ${before.band.length} bytes`);
  }
  const R = (id: string) => r[id]!;
  const decidedHdr = "Decided · Nov 3, 2026";
  const dimmed = (x: RaceReading) => x.chipsOpacity === "0.55" && /final call/i.test(x.chipsText ?? "");
  const called = (x: RaceReading) => x.provenance.length > 0 && x.provenance.every((p) => p.startsWith("Called by Ballotpedia · read ") && / MT$/.test(p));
  // leg 2
  { const x = R(PLANT.reelected.race);
    check("2", `${tag} · re-elected (MI-04, Huizenga marked): Decided, chips final call, "re-elected" on the incumbent card (the incumbent is never a roster row, so no row reads Elected; the page has no odds chip), the Called line`, (x.sub ?? "").includes(decidedHdr) && dimmed(x) && x.qualifier?.toLowerCase() === "re-elected" && !x.majors.some((m) => m.elected) && called(x), `${x.sub} · chips ${x.chipsText} (${x.chipsOpacity}) · ${x.qualifier} · ${JSON.stringify(x.provenance)}`); }
  // leg 3
  { const x = R(PLANT.open.race);
    check("3", `${tag} · open seat (IA-02, Joe Mitchell marked): Elected on his row and it leads, not on the ballot on the card`, (x.sub ?? "").includes(decidedHdr) && x.majors[0]?.elected === true && /Joe Mitchell/.test(x.majors[0]?.text ?? "") && /elected/i.test(x.majors[0]?.text ?? "") && x.qualifier?.toLowerCase() === "not on the ballot" && called(x), `${x.sub} · majors ${x.majors.map((m) => `${m.text}${m.elected ? " [E]" : ""}`).join(" | ")} · ${x.qualifier}`); }
  // leg 4
  { const x = R(PLANT.defeated.race);
    check("4", `${tag} · defeated (FL-14, Beltran marked, Castor on the ballot): Elected on Beltran, defeated on the card`, (x.sub ?? "").includes(decidedHdr) && x.majors.some((m) => m.elected && /Mike Beltran/.test(m.text)) && x.qualifier?.toLowerCase() === "defeated", `${x.sub} · majors ${x.majors.map((m) => `${m.text}${m.elected ? " [E]" : ""}`).join(" | ")} · ${x.qualifier}`); }
  // leg 5
  { const x = R(PLANT.notCalled.race);
    check("5", `${tag} · not called (CO-08, no mark, Nov 4): Not yet called, chips final call, the No call line`, (x.sub ?? "").includes("Not yet called") && dimmed(x) && !x.majors.some((m) => m.elected) && x.provenance.length > 0 && x.provenance.every((p) => p.startsWith("No call on Ballotpedia · read ")), `${x.sub} · chips ${x.chipsText} (${x.chipsOpacity}) · ${x.qualifier ?? "no qualifier"} · ${JSON.stringify(x.provenance)}`); }
  // leg 6 (pages)
  { const a = R(PLANT.laRunoff.race), b = R(PLANT.laOne.race);
    check("6", `${tag} · LA-01 (two winners): Runoff Dec 12, Jewett advanced among the majors, runoff Dec 12 on Scalise's card`, (a.sub ?? "").includes("Runoff Dec 12") && a.majors.some((m) => /Lauren Jewett/.test(m.text) && /advanced/i.test(m.text) && !m.elected) && a.qualifier?.toLowerCase() === "runoff dec 12", `${a.sub} · majors ${a.majors.map((m) => m.text).join(" | ")} · ${a.qualifier}`);
    check("6", `${tag} · LA-02 (one winner): Decided, Elected on Collins and she leads, defeated on Carter's card`, (b.sub ?? "").includes(decidedHdr) && b.majors[0]?.elected === true && /Renada Collins/.test(b.majors[0]?.text ?? "") && b.qualifier?.toLowerCase() === "defeated", `${b.sub} · majors ${b.majors.map((m) => `${m.text}${m.elected ? " [E]" : ""}`).join(" | ")} · ${b.qualifier}`); }
  // leg 10
  { const x = R(PLANT.boxRunoff.race);
    check("10", `${tag} · a general box with two marks (AR-02, Hill and Jones): Runoff, runoff on Hill's card, no row Elected, the No call line`, (x.sub ?? "").endsWith("Runoff") && x.qualifier?.toLowerCase() === "runoff" && !x.majors.some((m) => m.elected) && !x.others.some((m) => m.elected) && x.provenance.every((p) => p.startsWith("No call on Ballotpedia")), `${x.sub} · ${x.qualifier} · majors ${x.majors.map((m) => `${m.text}${m.elected ? " [E]" : ""}`).join(" | ")} · ${JSON.stringify(x.provenance)}`); }
  { const x = R(PLANT.curated.race);
    check("10", `${tag} · a curated name printed differently (S-ME: "Troy Jackson", the ballot's "Troy Dale Jackson" marked): Elected on the curated row, defeated on Collins's card`, (x.sub ?? "").includes(decidedHdr) && x.majors[0]?.elected === true && /Troy Jackson/.test(x.majors[0]?.text ?? "") && x.qualifier?.toLowerCase() === "defeated", `${x.sub} · majors ${x.majors.map((m) => `${m.text}${m.elected ? " [E]" : ""}`).join(" | ")} · ${x.qualifier}`); }
  { const x = R(PLANT.noBox.race);
    check("10", `${tag} · a race read no_box (FL-10): Not yet called, and the no-box line with its read time`, (x.sub ?? "").includes("Not yet called") && x.provenance.length > 0 && x.provenance.every((p) => p.startsWith("No general-election box on Ballotpedia · read ") && / MT$/.test(p)), `${x.sub} · ${JSON.stringify(x.provenance)}`); }
  // leg 7
  { const e = planted.band.expect;
    const mt = new Date(String(e.latestReadAt)).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Denver" });
    const want = `RESULTS · NOV 3 · ${e.ratedCalled} of ${e.rated} competitive seats called · House R ${e.R} · D ${e.D}${Number(e.other) > 0 ? ` · other ${e.other}` : ""} · ${e.open} open · Ballotpedia, read ${mt} MT`;
    const got = String(o.bandNov4 ?? "");
    check("7", `${tag} · Nov 4: the RESULTS line reads the planted numbers (${e.ratedCalled} of ${e.rated} rated seats)`, got === want, `got "${got}" · want "${want}"`);
    const today = String(o.bandToday ?? "");
    const headToday = phase === "after" ? String((JSON.parse(readFileSync(path.join(ART, `phase-before-${LABEL}.json`), "utf8")) as { bandToday?: string }).bandToday ?? "") : today;
    check("7", `${tag} · today: the band reads HEAD's ELECTION DAY line exactly`, /^ELECTION DAY · NOV 3 · \d+ DAYS · ~\d+ competitive seats$/.test(today) && today === headToday, `"${today}"${phase === "after" ? ` · HEAD's "${headToday}"` : ""}`); }
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim().slice(0, 10);
  say(`=== HO 758 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} · result ${existsSync("lib/race-result.ts") ? blob("lib/race-result.ts") : "absent"} queries ${blob("lib/queries.ts")} hub ${blob("components/RaceHubBody.tsx")} band ${blob("components/Battlefield.tsx")} · driver ${blob("scripts/diagnostic/election-night-legs-758.ts")} ===`);
  if (process.argv.includes("--seed")) { await seed(); await leg6harvest(); await leg9(); }
  if (process.argv.includes("--reader")) await leg9();
  if (argAt("--phase")) await phaseRun();
  say(`${LABEL}: ${passes} PASS · ${fails} FAIL`);
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
