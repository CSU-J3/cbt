// HO 789 legs: Sabato's ratings from a page a person saved (§ 1), with the page's Oct 20 House entry, an image,
// read through the board two readers transcribed (docs/handoffs/789-step0-ruling.md, 789-board-amendment.md).
//
//   npx tsx scripts/diagnostic/ratings-from-file-789.ts [--template <an earlier run's copy>]
//
// THE COPY. scripts/migrate.ts builds a fresh `file:` database and a child of this script (`--copy`) fills it from
// prod by SELECT, a guard refusing anything else: members, races, race_ratings and rating_history, members because
// a board's silence reads the incumbent's party. Every leg runs on its own copy of that file. This process installs
// the fetch tripwire before anything else and never opens prod, so nothing beyond 127.0.0.1 is reachable from it,
// and the CLI's runs carry the same tripwire as a preload written to the scratch folder at run time.
// `--template <file>` runs the legs on a copy an earlier run took instead, and nothing opens prod: HO 789's review
// re-ran them on run 4's (Oct 23, 18:05Z), taken before § 3 wrote prod, so they read the store § 3 read.
//
// THE FILE. The legs read the saved page with node:fs and hand its text to fileScrapeRun, as the CLI does, since
// lib/race-ratings-scrape.ts imports no `node:` module (the review's amend).
//
// A, the Oct 22 file:
//   red       the file without the board, by the CLI with --flush: the House fails by name on its Oct 20 image entry,
//             the Senate writes, the flush fires for the Senate's writes (ruling b), and the CLI exits 1.
//   control   the board with a row dropped, and with one doubled, by the CLI: refused before anything else, exit 1,
//             the copy unchanged, no flush.
//   green     runRaceRatingsSync({ run: fileScrapeRun(the file), supplements: [the board] }): both legs ok, every
//             CHANGED line with its chain, the departures with their stored labels, skippedNoRaceRow by district,
//             the conflicts, and the diff as a table; then the HALT check: more than 15 departures, or a departure of
//             a race the text tables moved on Oct 8 or later, stops before § 3.
//   the CLI   § 3's command on a copy: exit 0, the same counts, the flush.
//   planted   the board's silence: stored rows the board leaves off, on a D-held seat, an R-held seat and an
//             independent's. The first two retire as Safe D and Safe R as of Oct 20 with their history rows; the
//             third is kept and named.
// B, the challenge page: both legs fail at the floors, the message names the file, nothing is written, and the
//   CLI exits 1 without flushing.
// C, the offline guarantee: a fileScrapeRun asked for any other URL throws `offline run`, and the tripwire counts
//   its control (a request to example.invalid) and nothing else across every file run.
// D, the control: the network path, on a copy against a local 403 with the challenge's shape, reads as HO 771's
//   legs did: both legs refused, the message carrying cf-mitigated, server, cf-ray, the size and the title.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client, type InArgs } from "@libsql/client";
import { parse as parseEnv } from "dotenv";
import {
  fetchSource,
  fileScrapeRun,
  parseSabatoChanges,
  parseSupplementCsv,
  SABATO_CHANGES_URL,
  type RatingChange,
} from "@/lib/race-ratings-scrape";
import { RaceRatingsSyncError, runRaceRatingsSync, type RaceRatingsSyncResult } from "@/lib/race-ratings-sync";

const PAGE = "docs/handoffs/sabato-rating-changes-2026-10-22.html";
const BOARD = "docs/handoffs/sabato-house-2026-10-20.csv";
const CHALLENGE = "docs/handoffs/770-artifacts/ff/origin-check-retry-page.html";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored, and outside tsc
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const SELF = path.resolve("scripts/diagnostic/ratings-from-file-789.ts");
const CLI = "scripts/sync-race-ratings.ts";
const DUMMY = "legs-789-dummy-not-a-secret"; // the children's CRON_SECRET; never the real one
const BOARD_DATE = "2026-10-20";
const CF_HEADERS = { "cf-mitigated": "challenge", server: "cloudflare", "cf-ray": "a487939fd8215380-SEA" };

let passes = 0;
let fails = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
  if (ok) passes++;
  else fails++;
};
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A saved page as the CLI serves it: read here, labelled by its name.
const fileRun = (p: string) => fileScrapeRun({ html: readFileSync(p, "utf8"), label: `file:${path.basename(p)}` });

// The tripwire: every fetch in this process goes through here, and only 127.0.0.1 is let through.
const realFetch = globalThis.fetch;
const refused: string[] = [];
function installTripwire() {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(href).hostname !== "127.0.0.1") {
      refused.push(href);
      return Promise.reject(new Error(`tripwire: no fetch beyond 127.0.0.1 (${href})`));
    }
    return realFetch(input, init);
  }) as typeof fetch;
}
const trips = () => `(the tripwire: ${refused.length} refused)`;

// The same tripwire for the CLI's runs, preloaded into every child through NODE_OPTIONS.
const PRELOAD = path.join(DIR, "tripwire-789.mjs");
const PRELOAD_SRC = `const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (new URL(href).hostname !== "127.0.0.1") {
    process.stderr.write("TRIPWIRE refused " + href + "\\n");
    return Promise.reject(new Error("tripwire: no fetch beyond 127.0.0.1 (" + href + ")"));
  }
  return real(input, init);
};
`;

// ── the copy ────────────────────────────────────────────────────────────────
const TABLES = ["members", "races", "race_ratings", "rating_history"] as const;

/** `--copy <file>`: prod read by SELECT only, the rows written into the migrated file. The only process that opens prod. */
async function copyFromProd(target: string) {
  const env = parseEnv(readFileSync(".env"));
  const url = env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("--copy reads prod's libsql:// URL from .env");
  const prod = createClient({ url, authToken: env.TURSO_AUTH_TOKEN });
  const select = async (sql: string, args: InArgs = []) => {
    if (!/^\s*SELECT\b/i.test(sql)) throw new Error("prod is read-only here");
    return prod.execute({ sql, args });
  };
  const file = createClient({ url: `file:${target}` });
  const counts: string[] = [];
  for (const table of TABLES) {
    const rs = await select(`SELECT * FROM ${table}`);
    const cols = rs.columns;
    const sql = `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    for (let i = 0; i < rs.rows.length; i += 200) {
      await file.batch(rs.rows.slice(i, i + 200).map((row) => ({ sql, args: cols.map((c) => row[c] ?? null) as InArgs })), "write");
    }
    counts.push(`${table} ${rs.rows.length}`);
  }
  const sab = (await select(`SELECT COUNT(*) AS n, MAX(rating_date) AS hi FROM race_ratings WHERE source = 'sabato'`)).rows[0]!;
  const refusal = (
    await select(`SELECT id, error_message FROM cron_runs WHERE route = '/api/sync-race-ratings' AND status = 'error' ORDER BY started_at DESC LIMIT 1`)
  ).rows[0];
  const size = /(\d[\d,]*) bytes/.exec(String(refusal?.error_message ?? ""))?.[1] ?? "?";
  console.log(
    `copied from prod at ${new Date().toISOString()}: ${counts.join(" · ")} · sabato ${sab.n} rows, MAX(rating_date) ${sab.hi} · ` +
      `the newest refusal #${refusal?.id} read a ${size}-byte body`,
  );
  prod.close();
  file.close();
}

function buildTemplate(): string {
  mkdirSync(DIR, { recursive: true });
  const db = path.join(DIR, `legs-789-template-${Date.now()}.db`);
  const env = { ...process.env, TURSO_DATABASE_URL: `file:${db}`, TURSO_AUTH_TOKEN: "" };
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env, encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the copy failed: ${(mig.stderr || mig.stdout).slice(-600)}`);
  const cp = spawnSync(process.execPath, [TSX, SELF, "--copy", db], { encoding: "utf8" });
  if (cp.status !== 0) throw new Error(`the copy failed: ${(cp.stderr || cp.stdout).slice(-800)}`);
  console.log(`  ${cp.stdout.trim()}`);
  return db;
}

/** `--template <file>`: an earlier run's copy becomes this run's template, read on a client of its own. */
async function reuseTemplate(from: string): Promise<string> {
  mkdirSync(DIR, { recursive: true });
  const db = path.join(DIR, `legs-789-template-${Date.now()}.db`);
  copyFileSync(from, db);
  const c = createClient({ url: `file:${db}` });
  const counts: string[] = [];
  for (const table of TABLES) counts.push(`${table} ${(await c.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0]!.n}`);
  const sab = (await c.execute(`SELECT COUNT(*) AS n, MAX(rating_date) AS hi FROM race_ratings WHERE source = 'sabato'`)).rows[0]!;
  c.close();
  console.log(
    `  read from ${path.basename(from)}, an earlier run's copy (prod not opened): ${counts.join(" · ")} · ` +
      `sabato ${sab.n} rows, MAX(rating_date) ${sab.hi}`,
  );
  return db;
}

async function copyOf(template: string, leg: string): Promise<string> {
  const db = template.replace(/template-(\d+)\.db$/, `${leg}-$1.db`);
  for (let tries = 0; ; tries++) {
    try {
      copyFileSync(template, db);
      return db;
    } catch (e) {
      if (tries > 10) throw e;
      await delay(300); // libsql holds the file a moment after close (EPERM)
    }
  }
}

// A copy's sabato rows, its history count and its newest history id, read on a client of its own.
type Snapshot = { rows: Map<string, { rating: string; date: string; url: string }>; hist: number; maxHist: number; maxDate: string | null };
async function snapshot(db: string, client?: Client): Promise<Snapshot> {
  const c = client ?? createClient({ url: `file:${db}` });
  const rs = await c.execute(`SELECT race_id, rating, rating_date, source_url FROM race_ratings WHERE source = 'sabato'`);
  const h = (await c.execute(`SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS hi FROM rating_history`)).rows[0]!;
  if (!client) c.close();
  const rows = new Map(rs.rows.map((r) => [String(r.race_id), { rating: String(r.rating), date: String(r.rating_date), url: String(r.source_url) }]));
  const maxDate = [...rows.values()].map((r) => r.date).sort().at(-1) ?? null;
  return { rows, hist: Number(h.n), maxHist: Number(h.hi), maxDate };
}
const same = (a: Snapshot, b: Snapshot) =>
  a.rows.size === b.rows.size && a.hist === b.hist && [...a.rows].every(([k, v]) => JSON.stringify(b.rows.get(k)) === JSON.stringify(v));
const shown = (s: Snapshot) => `${s.rows.size} sabato rows, MAX(rating_date) ${s.maxDate}, ${s.hist} history rows`;

// ── local servers ───────────────────────────────────────────────────────────
async function serve(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => { server.closeAllConnections(); server.close(); } };
}

// The revalidate stand-in: it records every POST, and whether its Bearer is the children's dummy.
const posts: { url: string; method: string; bearerIsDummy: boolean }[] = [];

// ── the CLI, as a child ─────────────────────────────────────────────────────
type CliRun = { code: number | null; out: string; err: string; trips: number; posts: typeof posts };
async function cli(db: string, args: string[], revalidate: string): Promise<CliRun> {
  const before = posts.length;
  const env = {
    ...process.env,
    TURSO_DATABASE_URL: `file:${db}`,
    TURSO_AUTH_TOKEN: "",
    CRON_SECRET: DUMMY,
    REVALIDATE_URL: revalidate,
    NODE_OPTIONS: `--import=${pathToFileURL(PRELOAD).href}`,
  };
  const child = spawn(process.execPath, [TSX, CLI, ...args], { env });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const code = await new Promise<number | null>((r) => child.on("close", r));
  return { code, out, err, trips: (err.match(/^TRIPWIRE refused /gm) ?? []).length, posts: posts.slice(before) };
}
const indent = (s: string, keep: RegExp) =>
  s
    .split(/\r?\n/)
    .filter((l) => keep.test(l))
    .map((l) => `      | ${l.length > 260 ? `${l.slice(0, 260)}…` : l}`)
    .join("\n");

// In-process runs print through console; the lines are kept for the reading and still shown.
async function captured<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; lines: string[] }> {
  const lines: string[] = [];
  const [log, warn, error] = [console.log, console.warn, console.error];
  const keep = (...a: unknown[]) => lines.push(a.map(String).join(" "));
  console.log = keep;
  console.warn = keep;
  console.error = keep;
  try {
    return { value: await fn(), lines };
  } catch (e) {
    return { error: e, lines };
  } finally {
    [console.log, console.warn, console.error] = [log, warn, error];
  }
}

const fmtChain = (c: readonly RatingChange[] | undefined) =>
  (c ?? []).map((x) => `${x.date} ${x.board ? "board" : (x.from ?? "?")} → ${x.to ?? "?"}`).join("; ") || "(none)";

// ── C, the offline guarantee ────────────────────────────────────────────────
async function legC() {
  console.log(`\n── C, the offline guarantee`);
  const run = fileRun(PAGE);
  const other = "https://example.com/not-sabato";
  let message = "(no throw)";
  try {
    await run.get(other, "text/html");
  } catch (e) {
    message = messageOf(e);
  }
  check(
    "a fileScrapeRun asked for any URL but Sabato's throws offline run, and fetches nothing",
    message === `fetch ${other} -> 0: offline run: nothing is fetched` && refused.length === 0,
    `${JSON.stringify(message)} ${trips()}`,
  );
  const page = await run.get(SABATO_CHANGES_URL, "text/html");
  check("…and Sabato's URL reads the file, labelled by its name", page.length > 400_000 && run.label === "file:sabato-rating-changes-2026-10-22.html", `${page.length.toLocaleString("en-US")} chars · label ${run.label}`);
  // The control: the tripwire counts a request it refuses. example.invalid resolves nowhere, by RFC 2606.
  await fetch("https://example.invalid/tripwire-control").catch(() => undefined);
  check("the tripwire's control: a request to example.invalid is refused and counted", refused.length === 1 && refused[0] === "https://example.invalid/tripwire-control", trips());
  refused.length = 0;
}

// ── B, the challenge page ───────────────────────────────────────────────────
async function legB(inproc: string, cliDb: string, revalidate: string) {
  console.log(`\n── B, a saved challenge page (red by design)`);
  const size = readFileSync(CHALLENGE).byteLength;
  const before = await snapshot(inproc);
  const r = await captured(() => runRaceRatingsSync({ run: fileRun(CHALLENGE) }));
  const after = await snapshot(inproc);
  const e = r.error;
  const result = e instanceof RaceRatingsSyncError ? e.result : null;
  const legs = result ? Object.entries(result).map(([c, l]) => `${c} ${l.ok ? "ok" : "failed"}`).join(", ") : "(no result)";
  check(
    "both legs fail at the parser's floors on the challenge page",
    !!result && !result.house.ok && !result.senate.ok &&
      /\(house\): 0 rows minted a race id \(floor 100\)/.test(messageOf(e)) && /\(senate\): 0 rows minted a race id \(floor 20\)/.test(messageOf(e)),
    `${legs} · ${size.toLocaleString("en-US")}-byte file, title "Just a moment..." ${trips()}`,
  );
  check("…the thrown message names the file", (messageOf(e).match(/\(read from file:origin-check-retry-page\.html\)/g) ?? []).length === 2, JSON.stringify(messageOf(e).slice(0, 300)) + "…");
  check("…and nothing is written", same(before, after), `before ${shown(before)} · after ${shown(after)}`);
  const c = await cli(cliDb, ["--html", CHALLENGE, "--flush"], revalidate);
  const cAfter = await snapshot(cliDb);
  check(
    "the CLI path exits 1 without flushing",
    c.code === 1 && c.posts.length === 0 && /No leg wrote, so there is nothing to flush\./.test(c.out) && same(before, cAfter),
    `exit ${c.code} · ${c.posts.length} POST(s) · the copy ${shown(cAfter)} · the child's tripwire: ${c.trips} refused`,
  );
  console.log(indent(c.out + c.err, /FAILED|nothing to flush/));
}

// ── D, the control: the network path ────────────────────────────────────────
async function legD(inproc: string) {
  console.log(`\n── D, the control: the network path, unchanged`);
  const page = readFileSync(CHALLENGE);
  const s = await serve((_req, res) => {
    res.writeHead(403, { "content-type": "text/html; charset=UTF-8", "content-length": page.byteLength, ...CF_HEADERS }).end(page);
  });
  const url = `${s.base}/crystalball/2026-rating-changes/`;
  const before = await snapshot(inproc);
  const r = await captured(() => runRaceRatingsSync({ run: { get: (_u, accept) => fetchSource(url, accept) } }));
  const after = await snapshot(inproc);
  s.close();
  const want = `fetch ${url} -> 403: cf-mitigated challenge, server cloudflare, cf-ray a487939fd8215380-SEA, ${page.byteLength.toLocaleString("en-US")} bytes, "Just a moment..."`;
  const result = r.error instanceof RaceRatingsSyncError ? r.error.result : null;
  const errs = result ? [result.house, result.senate].map((l) => (l.ok ? "(ok)" : l.error)) : [];
  check(
    "both legs refused, each message carrying cf-mitigated, server, cf-ray, the size and the title",
    errs.length === 2 && errs.every((x) => x === `sabato did not read: ${want}. Nothing was written in this leg`),
    `${JSON.stringify(errs[0])} ${trips()}`,
  );
  check("…and nothing is written", same(before, after), `before ${shown(before)} · after ${shown(after)}`);
}

// ── A, the Oct 22 file ──────────────────────────────────────────────────────
async function legA(template: string, inproc: string, revalidate: string) {
  console.log(`\n── A, the Oct 22 file`);
  const html = readFileSync(PAGE, "utf8");
  const csv = readFileSync(BOARD, "utf8");
  const board = parseSupplementCsv(csv, BOARD);
  const house = parseSabatoChanges(html, "house", [board]);
  const senate = parseSabatoChanges(html, "senate");
  const chainOf = new Map<string, readonly RatingChange[]>();
  for (const x of [...house.ratings, ...house.locked, ...senate.ratings, ...senate.locked]) chainOf.set(x.raceId, x.chain ?? []);
  for (const o of house.board?.offBoard ?? []) chainOf.set(o.raceId, o.chain);
  const onBoard = new Set(house.board?.raceIds ?? []);

  // red: the file without the board, by the CLI.
  console.log(`\n   red: the file without the board, by the CLI with --flush`);
  const redDb = await copyOf(template, "a-red");
  const redBefore = await snapshot(redDb);
  const red = await cli(redDb, ["--html", PAGE, "--flush"], revalidate);
  const redAfter = await snapshot(redDb);
  const houseSame = [...redBefore.rows].filter(([k]) => !k.startsWith("S-")).every(([k, v]) => JSON.stringify(redAfter.rows.get(k)) === JSON.stringify(v));
  const senateMoved = [...redAfter.rows].filter(([k, v]) => k.startsWith("S-") && JSON.stringify(redBefore.rows.get(k)) !== JSON.stringify(v)).map(([k]) => k);
  check(
    "the House fails by name on its Oct 20 image entry",
    /house: FAILED · sabato did not read: Sabato rating changes \(house\): the Oct\. 20, 2026 entry is an image \(102026houseratings\.png\), no text rows; supply a supplement or hold the chamber \(read from file:sabato-rating-changes-2026-10-22\.html\)/.test(red.out),
    indent(red.out, /^house: /).trim(),
  );
  check(
    "…the Senate writes, and the House is untouched",
    /senate: ok · upserted 7 \(changed 5, new 2\)/.test(red.out) && houseSame && senateMoved.length === 7,
    `Senate rows moved: ${senateMoved.join(", ")}`,
  );
  check(
    "…the flush fires for the Senate's writes (ruling b), and the CLI exits 1",
    red.code === 1 && red.posts.length === 1 && red.posts[0]!.method === "POST" && red.posts[0]!.url === "/api/revalidate?tag=race-ratings" && red.posts[0]!.bearerIsDummy && /Flush of `race-ratings`: 200/.test(red.out),
    `exit ${red.code} · ${red.posts.map((p) => `${p.method} ${p.url}, Bearer is the dummy: ${p.bearerIsDummy}`).join(" · ") || "no POST"} · the child's tripwire: ${red.trips} refused`,
  );

  // control: the board's counts.
  console.log(`\n   control: the board's own counts, by the CLI`);
  const lines = csv.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith("Rob Wittman (VA-1),"));
  for (const [label, text] of [
    ["a row dropped (VA-1)", [...lines.slice(0, at), ...lines.slice(at + 1)].join("\n")],
    ["a row doubled (VA-1)", [...lines.slice(0, at + 1), lines[at]!, ...lines.slice(at + 1)].join("\n")],
  ] as const) {
    const bad = path.join(DIR, `board-789-${label.startsWith("a row dropped") ? "dropped" : "doubled"}.csv`);
    writeFileSync(bad, text);
    const db = await copyOf(template, `a-control-${label.startsWith("a row dropped") ? "dropped" : "doubled"}`);
    const before = await snapshot(db);
    const c = await cli(db, ["--html", PAGE, "--supplement", bad, "--flush"], revalidate);
    const after = await snapshot(db);
    check(
      `${label}: refused before anything else, nothing written, no flush`,
      c.code === 1 && /refused, every section must hold the count its header prints \(R TOSS-UP \(8\): (7|9) rows/.test(c.err) &&
        !/scraped \d+ competitive/.test(c.out + c.err) && c.posts.length === 0 && same(before, after),
      `exit ${c.code} · ${(/refused, [^\n]*/.exec(c.err)?.[0] ?? "(no refusal)").slice(0, 120)}… · ${c.posts.length} POST(s) · the child's tripwire: ${c.trips} refused`,
    );
  }

  // green: in-process, on the copy the reds above never touched.
  console.log(`\n   green: runRaceRatingsSync({ run: fileScrapeRun(the file), supplements: [the board] }) on a copy`);
  const rc = createClient({ url: `file:${inproc}` });
  const races = new Set((await rc.execute("SELECT id FROM races")).rows.map((r) => String(r.id)));
  rc.close();
  const before = await snapshot(inproc);
  const g = await captured(() => runRaceRatingsSync({ run: fileRun(PAGE), supplements: [board] }));
  const after = await snapshot(inproc);
  const result = g.value as RaceRatingsSyncResult | undefined;
  for (const l of g.lines) console.log(`      | ${l.length > 260 ? `${l.slice(0, 260)}…` : l}`);
  check("both legs ok", !!result && result.house.ok && result.senate.ok, g.error ? messageOf(g.error) : `house ok · senate ok ${trips()}`);
  if (!result || !result.house.ok || !result.senate.ok) return;
  const hs = result.house.stats.raters.sabato!;
  const ss = result.senate.stats.raters.sabato!;
  check(
    "the House's sabato stats: dataUrl the file and the board's image, sourceUrl the page, pageAsOf the board's date, asOf the page's stamp",
    hs.dataUrl === `file:sabato-rating-changes-2026-10-22.html + ${board.source}` && hs.sourceUrl === SABATO_CHANGES_URL && hs.pageAsOf === BOARD_DATE && hs.asOf === "2026-10-22T10:37:28+00:00",
    `dataUrl ${hs.dataUrl} · pageAsOf ${hs.pageAsOf} · asOf ${hs.asOf}`,
  );
  check(
    "the Senate's: dataUrl the file alone, pageAsOf its newest table",
    ss.dataUrl === "file:sabato-rating-changes-2026-10-22.html" && ss.sourceUrl === SABATO_CHANGES_URL && ss.pageAsOf === "2026-10-14" && ss.asOf === "2026-10-22T10:37:28+00:00",
    `dataUrl ${ss.dataUrl} · pageAsOf ${ss.pageAsOf}`,
  );
  check("no conflicts, either chamber (a board can raise none)", (hs.conflicts ?? []).length === 0 && (ss.conflicts ?? []).length === 0, `house ${JSON.stringify(hs.conflicts)} · senate ${JSON.stringify(ss.conflicts)}`);
  const skipped = [...house.ratings, ...senate.ratings].filter((r) => !races.has(r.raceId)).map((r) => r.raceId);
  check(
    "skippedNoRaceRow, by district",
    result.house.stats.skippedNoRaceRow + result.senate.stats.skippedNoRaceRow === skipped.length,
    `house ${result.house.stats.skippedNoRaceRow} · senate ${result.senate.stats.skippedNoRaceRow} · ${skipped.join(", ") || "none: every rated race has a races row, the board's eight New districts included (" +
      ["FL-22", "TX-09", "TX-35", "LA-06", "TX-32", "CA-01", "CA-41", "UT-01"].map((d) => `${d} ${races.has(`${d}-2026`) ? "has one" : "HAS NONE"}`).join(", ") + ")"}`,
  );

  // The diff, race by race.
  const ids = [...new Set([...before.rows.keys(), ...after.rows.keys()])].sort();
  const diff = ids.filter((id) => JSON.stringify(before.rows.get(id)) !== JSON.stringify(after.rows.get(id)));
  const departed = diff.filter((id) => !after.rows.has(id));
  const added = diff.filter((id) => !before.rows.has(id));
  const changed = diff.filter((id) => before.rows.has(id) && after.rows.has(id));
  // A row came from the board when the board's entry decided it: the newest, and not agreeing with a move before it.
  const decidedByBoard = (id: string) => {
    const chain = chainOf.get(id);
    return !!chain?.at(-1)?.board && !(chain.length > 1 && chain.at(-2)!.to === chain.at(-1)!.to);
  };
  const fromBoardRows = diff.filter((id) => after.rows.has(id) && decidedByBoard(id));
  console.log(`\n   the diff: ${changed.length} changed · ${added.length} new · ${departed.length} departed (of ${before.rows.size} sabato rows before, ${after.rows.size} after)`);
  console.log(`   written from the board (its entry decided them, dated ${BOARD_DATE}): ${fromBoardRows.length} · ${fromBoardRows.join(", ")}`);
  console.log(`      race         before                 after                  from the  chain`);
  for (const id of diff) {
    const b = before.rows.get(id);
    const a = after.rows.get(id);
    const chain = chainOf.get(id);
    const fromBoard = decidedByBoard(id);
    console.log(
      `      ${id.padEnd(12)} ${(b ? `${b.rating} (${b.date})` : "-").padEnd(22)} ${(a ? `${a.rating} (${a.date})` : "departed").padEnd(22)} ${(fromBoard ? "board" : "table").padEnd(9)} ${fmtChain(chain)}`,
    );
  }
  const hc = createClient({ url: `file:${inproc}` });
  const hist = await hc.execute({ sql: `SELECT race_id, rating, rating_score, rating_date, observed_at FROM rating_history WHERE id > ? ORDER BY race_id`, args: [before.maxHist] });
  hc.close();
  console.log(`   history rows written: ${hist.rows.map((r) => `${r.race_id} ${r.rating} (${r.rating_score}) dated ${r.rating_date}, observed ${r.observed_at}`).join(" · ") || "none"}`);
  check(
    "every departure has its history row",
    departed.length === hist.rows.length && departed.every((id) => hist.rows.some((r) => String(r.race_id) === id)),
    departed.map((id) => `${id}: stored ${before.rows.get(id)!.rating}, ${onBoard.has(id) ? "ON the board" : "not on the board"}, chain ${fmtChain(chainOf.get(id))}`).join(" · ") || "none",
  );
  const late = departed.filter((id) => (chainOf.get(id) ?? []).some((c) => !c.board && c.date >= "2026-10-08"));
  check(
    "the HALT check: at most 15 departures, none of a race the text tables moved on Oct 8 or later",
    departed.length <= 15 && late.length === 0,
    `${departed.length} departure(s) · moved on Oct 8 or later: ${late.join(", ") || "none"}`,
  );
  check(
    "the copy's sabato AS OF reads the board's date",
    after.maxDate === BOARD_DATE,
    `MAX(rating_date) ${before.maxDate} → ${after.maxDate} ${trips()}`,
  );

  // the CLI: § 3's command, on its own copy.
  console.log(`\n   the CLI: § 3's command on a copy`);
  const cliDb = await copyOf(template, "a-cli");
  const cBefore = await snapshot(cliDb);
  const c = await cli(cliDb, ["--html", PAGE, "--supplement", BOARD, "--flush"], revalidate);
  const cAfter = await snapshot(cliDb);
  const cDiff = [...new Set([...cBefore.rows.keys(), ...cAfter.rows.keys()])]
    .filter((id) => JSON.stringify(cBefore.rows.get(id)) !== JSON.stringify(cAfter.rows.get(id)))
    .sort();
  const rowsAgree = cDiff.every((id) => cAfter.rows.get(id)?.rating === after.rows.get(id)?.rating && cAfter.rows.get(id)?.date === after.rows.get(id)?.date);
  check(
    "exit 0, both legs ok, the same rows moved to the same labels and dates as in-process, and the flush",
    c.code === 0 && /house: ok · /.test(c.out) && /senate: ok · /.test(c.out) && cDiff.join() === diff.join() && rowsAgree &&
      c.posts.length === 1 && c.posts[0]!.url === "/api/revalidate?tag=race-ratings" && c.posts[0]!.bearerIsDummy,
    `exit ${c.code} · ${cDiff.length} rows moved (in-process ${diff.length}), labels and dates agree: ${rowsAgree} · ${c.posts.length} POST · the child's tripwire: ${c.trips} refused`,
  );
  console.log(indent(c.out, /^(supplement |house: |senate: |  sabato|Flush )/));

  // planted: the board's silence on stored rows it leaves off.
  console.log(`\n   planted: the board's silence`);
  const plantedDb = await copyOf(template, "a-planted");
  const p = createClient({ url: `file:${plantedDb}` });
  const pick = async (party: string) =>
    String(
      (
        await p.execute({
          sql: `SELECT r.id FROM races r JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
                 WHERE m.party = ? AND r.id GLOB '[A-Z][A-Z]-[0-9][0-9]-2026' AND r.id NOT IN (SELECT race_id FROM race_ratings) ORDER BY r.id`,
          args: [party],
        })
      ).rows.find((r) => !onBoard.has(String(r.id)) && !chainOf.has(String(r.id)))?.id,
    );
  const dSeat = await pick("D");
  const rSeat = await pick("R");
  const iSeat = "CA-03-2026"; // Kiley's, an independent's: the tables carry it (Likely D), the board leaves it off
  const plant = [
    [dSeat, "Likely D", -2],
    [rSeat, "Lean R", 1],
    [iSeat, "Likely D", -2],
  ] as const;
  for (const [id, rating, score] of plant) {
    await p.execute({
      sql: `INSERT INTO race_ratings (id, race_id, source, rating, rating_score, rating_date, source_url, cycle, updated_at)
            VALUES (?, ?, 'sabato', ?, ?, '2026-09-30', 'planted by the HO 789 legs', 2026, '2026-09-30T11:00:45Z')`,
      args: [`${id}-sabato`, id, rating, score],
    });
  }
  const iParty = (await p.execute({ sql: `SELECT m.party FROM races r JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id WHERE r.id = ?`, args: [iSeat] })).rows[0]?.party;
  const pBefore = await snapshot(plantedDb, p);
  p.close();
  await delay(500);
  const pc = await cli(plantedDb, ["--html", PAGE, "--supplement", BOARD], revalidate);
  const q = createClient({ url: `file:${plantedDb}` });
  const pAfter = await snapshot(plantedDb, q);
  const pHist = await q.execute({ sql: `SELECT race_id, rating, rating_score, rating_date FROM rating_history WHERE id > ? ORDER BY race_id`, args: [pBefore.maxHist] });
  q.close();
  const histOf = (id: string) => pHist.rows.find((r) => String(r.race_id) === id);
  const dH = histOf(dSeat);
  const rH = histOf(rSeat);
  check(
    `a D-held seat the board leaves off (${dSeat}, planted Likely D) retires as Safe D as of ${BOARD_DATE}, with its history row`,
    !pAfter.rows.has(dSeat) && dH?.rating === "Safe D" && Number(dH?.rating_score) === -3 && dH?.rating_date === BOARD_DATE,
    `${dH ? `${dH.rating} (${dH.rating_score}) dated ${dH.rating_date}` : "no history row"} · ${indent(pc.out, new RegExp(`DEPARTED: ${dSeat}`)).trim()}`,
  );
  check(
    `an R-held seat (${rSeat}, planted Lean R) retires as Safe R as of ${BOARD_DATE}, with its history row`,
    !pAfter.rows.has(rSeat) && rH?.rating === "Safe R" && Number(rH?.rating_score) === 3 && rH?.rating_date === BOARD_DATE,
    `${rH ? `${rH.rating} (${rH.rating_score}) dated ${rH.rating_date}` : "no history row"}`,
  );
  check(
    `an independent's seat (${iSeat}, incumbent party ${iParty}, planted Likely D) is kept and named in offBoard`,
    pAfter.rows.get(iSeat)?.rating === "Likely D" && !histOf(iSeat) && /offBoard \["CA-03-2026"\]/.test(pc.out) && /OFF-BOARD: CA-03-2026-sabato/.test(pc.out + pc.err),
    `${indent(pc.out + pc.err, /OFF-BOARD/).trim()} · exit ${pc.code} · the child's tripwire: ${pc.trips} refused`,
  );
}

async function main() {
  installTripwire();
  const at = process.argv.indexOf("--template");
  const reuse = at > 1 ? process.argv[at + 1] : undefined;
  if (at > 1 && !reuse) throw new Error("--template needs a file");
  console.log(`HO 789 legs · ${new Date().toISOString()}`);
  writeFileSync(PRELOAD, PRELOAD_SRC);
  console.log(`\n── the copy`);
  const template = reuse ? await reuseTemplate(reuse) : buildTemplate();
  const inproc = await copyOf(template, "inproc");
  // getDb() is lazy and reads the env on its first call, which is below: this process's client is file: too.
  process.env.TURSO_DATABASE_URL = `file:${inproc}`;
  process.env.TURSO_AUTH_TOKEN = "";
  const revalidate = await serve((req, res) => {
    posts.push({ url: req.url ?? "", method: req.method ?? "", bearerIsDummy: req.headers.authorization === `Bearer ${DUMMY}` });
    res.writeHead(200, { "content-type": "application/json" }).end(`{"revalidated":true}`);
  });
  const revalidateUrl = `${revalidate.base}/api/revalidate`;

  await legC();
  await legB(inproc, await copyOf(template, "b-cli"), revalidateUrl);
  await legD(inproc);
  await legA(template, inproc, revalidateUrl);
  revalidate.close();

  console.log(`\n── C, closing`);
  check("the tripwire: nothing was fetched beyond 127.0.0.1 by any file run in this process", refused.length === 0, refused.length ? refused.join(" · ") : "0 refused");
  console.log(`\n${passes} PASS · ${fails} FAIL`);
  process.exitCode = fails ? 1 : 0;
}

if (process.argv[2] === "--copy") {
  copyFromProd(process.argv[3] ?? "").catch((e) => {
    console.error(e);
    process.exitCode = 2;
  });
} else {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 2;
  });
}
