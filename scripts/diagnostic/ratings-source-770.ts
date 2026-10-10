// HO 770 legs B and D: the sync on a copy of prod, and the MOVED guard read per rater.
//
//   npx tsx scripts/diagnostic/ratings-source-770.ts
//
// B, the sync. The route's handler as shipped (wrapCronRoute around runRaceRatingsSync; only the
//    route's auth and its cache flush left out), run as a child against a `file:` copy seeded from
//    prod by SELECT through the real scripts/migrate.ts, with Sabato's page served from the copy
//    saved at STEP 0 by ratings-hang-shim-744.cjs in serve mode, so the run reads what S2 read:
//    - both legs read `ok`; per chamber, Sabato's upserts, changes, new pairs and departures, every
//      change with its date and the label its chain moved it from; each S2 class's count matches
//      S2 under the S1 ruling, and the sync's own counts match the classes; the rated-race set
//      before and after, with the ids that moved; every `cook` and `inside_elections` row the same;
//      a second run changes 0 and deletes 0;
//    - the chain check's red: two rows planted with labels their chains never read, one on a race
//      whose newest label is competitive and one whose newest is Safe, stay unwritten and are
//      counted as conflicts, where the predicates alone would rewrite the first and delete the
//      second;
//    - prod's fingerprint the same before and after;
//    - and, report only, one live read of the page through scrapeChamber (the shipped fetch, one
//      request), set beside the saved page's reading.
// D, the guard, on planted runs and on the copy:
//    - a pre-770 run with the chamber ok counts for cook, inside_elections and sabato, and so does
//      the pre-HO 744 House shape;
//    - leg B's own first run, a post-770 `success` row whose legs carry only sabato, counts for
//      sabato and not for cook or inside_elections, and still for the chamber;
//    - cook wired after three sabato-only weeks: its first run's move reads not fresh while
//      sabato's move that day reads fresh, and the chamber reading would have passed both;
//    - an `error` run counts for no rater;
//    - electoral-legs-768.ts's leg E, unchanged: its own text, copied at run time into a harness
//      in the scratch folder (the file exports nothing), against the tree's guard and prod;
//    - on the copy, every move's verdict is the same with its source and without it.
//
// SAFETY. Prod is read through a SELECT guard and fingerprinted before and after. Children that
// write get `file:` only. The live read is one GET of Sabato's page with the shipped agent.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isFreshMove, syncLegOk, type GuardHorizons, type HistoryRunRow, type MoveChamber, type SyncRunRow } from "@/lib/move-freshness";
import {
  newScrapeRun,
  parseSabatoChanges,
  SABATO_CHANGES_URL,
  scrapeChamber,
  type Chamber,
  type SabatoChanges,
} from "@/lib/race-ratings-scrape";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/770-artifacts"); // repo-ignored
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const SHIM = path.resolve("scripts/diagnostic/ratings-hang-shim-744.cjs").replace(/\\/g, "/");
const PAGE = path.resolve("docs/handoffs/770-artifacts/m4/centerforpolitics.org_crystalball_2026-rating-changes_.html");
const COPY = path.join(DIR, `ratings-770-legB-${Date.now()}.db`);
const RUNNER = path.join(DIR, "ratings-route-runner-770.ts");
const HARNESS = path.join(DIR, "electoral-legE-768-harness-770.ts");
const SYNC_ROUTE = "/api/sync-race-ratings";
const HIST_ROUTE = "/api/cron/rating-history";
const SOURCES = ["cook", "inside_elections", "sabato"] as const;
const CHAMBERS: Chamber[] = ["house", "senate"];
type Klass = "current" | "behind" | "new pair" | "departure" | "conflict" | "no row, newest Safe";
const KLASSES: Klass[] = ["current", "behind", "new pair", "departure", "conflict", "no row, newest Safe"];
// S2 under the S1 ruling (docs/handoffs/770-artifacts/s1-s2-whatif-inherit.txt).
const S2: Record<Chamber, Record<Klass, number>> = {
  house: { current: 43, behind: 13, "new pair": 3, departure: 2, conflict: 0, "no row, newest Safe": 27 },
  senate: { current: 11, behind: 1, "new pair": 1, departure: 0, conflict: 0, "no row, newest Safe": 2 },
};
// The chain check's red: a stored sabato label each race's chain never reads.
const PLANTS = [
  { raceId: "AL-02-2026", label: "Toss Up", score: 0, otherwise: "rewritten to its newest label" },
  { raceId: "CA-01-2026", label: "Toss Up", score: 0, otherwise: "deleted as a departure" },
];

const log: string[] = [];
const say = (s: string) => {
  const line = redactSecrets(s);
  console.log(line);
  log.push(line);
};
let passes = 0;
let fails = 0;
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [${leg}] ${label}: ${detail}`);
  if (ok) passes++;
  else fails++;
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chamberOf = (raceId: string): Chamber => (raceId.startsWith("S-") ? "senate" : "house");

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
async function prodFingerprint(): Promise<Record<string, string>> {
  const db = prodClient();
  const read = reader(db);
  const rows = async (sql: string, args: InArgs = []) => JSON.stringify((await read(sql, args)).rows.map((r) => Object.values(r)));
  const fp = {
    race_ratings: sha(await rows(`SELECT * FROM race_ratings ORDER BY id`)),
    rating_history: await rows(`SELECT COUNT(*) n, MAX(id) mx FROM rating_history`),
    ratings_runs: await rows(`SELECT COUNT(*) n, MAX(id) mx FROM cron_runs WHERE route = ?`, [SYNC_ROUTE]),
  };
  db.close();
  return fp;
}

// ── the copy ────────────────────────────────────────────────────────────────
function childEnv(url: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: children that may write get file: only");
  return { ...process.env, ...extra, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "" };
}
async function withCopy<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = createClient({ url: `file:${COPY}` });
  try {
    return await fn(db);
  } finally {
    db.close();
    await sleep(400); // a libsql file handle stays locked briefly after close() on this box (HO 724)
  }
}
async function copyRows(read: ReturnType<typeof reader>, db: Client, table: string, where = "", args: InArgs = []): Promise<number> {
  const cols = new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)));
  await db.execute(`DELETE FROM ${table}`);
  const rs = await read(`SELECT * FROM ${table} ${where}`, args);
  if (rs.rows.length === 0) return 0;
  const use = Object.keys(rs.rows[0]!).filter((c) => cols.has(c));
  const stmts: InStatement[] = rs.rows.map((r) => ({
    sql: `INSERT INTO ${table} (${use.join(",")}) VALUES (${use.map(() => "?").join(",")})`,
    args: use.map((c) => (r as Record<string, unknown>)[c] as never),
  }));
  for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500), "write");
  return rs.rows.length;
}

type Row = { id: string; raceId: string; source: string; rating: string; score: number; date: string | null; url: string | null; updated: string };
type Snap = { rows: Map<string, Row>; rated: Record<Chamber, Set<string>>; fp: Record<string, string>; history: number };
async function snapshot(): Promise<Snap> {
  return withCopy(async (db) => {
    const rows = new Map<string, Row>();
    for (const r of (await db.execute("SELECT * FROM race_ratings")).rows) {
      rows.set(String(r.id), {
        id: String(r.id),
        raceId: String(r.race_id),
        source: String(r.source),
        rating: String(r.rating),
        score: Number(r.rating_score),
        date: r.rating_date == null ? null : String(r.rating_date),
        url: r.source_url == null ? null : String(r.source_url),
        updated: String(r.updated_at),
      });
    }
    const rated: Record<Chamber, Set<string>> = { house: new Set(), senate: new Set() };
    for (const r of (await db.execute("SELECT DISTINCT race_id FROM race_ratings WHERE cycle = 2026")).rows) rated[chamberOf(String(r.race_id))].add(String(r.race_id));
    const fp: Record<string, string> = {};
    for (const s of SOURCES) {
      const rs = await db.execute({ sql: "SELECT * FROM race_ratings WHERE source = ? ORDER BY id", args: [s] });
      fp[s] = `${rs.rows.length} rows ${sha(JSON.stringify(rs.rows.map((r) => Object.values(r))))}`;
    }
    const history = Number((await db.execute("SELECT COUNT(*) n FROM rating_history")).rows[0]!.n);
    return { rows, rated, fp, history };
  });
}

// ── the route's handler, as a child ─────────────────────────────────────────
const RUNNER_SRC = `// Generated by scripts/diagnostic/ratings-source-770.ts (HO 770 leg B). The route's handler as
// shipped (app/api/sync-race-ratings/route.ts) less its auth and its cache flush: wrapCronRoute
// around runRaceRatingsSync, on whatever TURSO_DATABASE_URL names (the leg passes file: only).
import { wrapCronRoute } from "../../../lib/cron-log";
import { runRaceRatingsSync } from "../../../lib/race-ratings-sync";

wrapCronRoute("${SYNC_ROUTE}", async () => ({ payload: { chambers: await runRaceRatingsSync() } })).then(
  (r) => console.log("RESULT " + JSON.stringify(r)),
  (e) => {
    console.log("THREW " + String(e && e.stack ? e.stack : e));
    process.exitCode = 1;
  },
);
`;
type RaterStats = { ok: boolean; scraped: number; upserted: number; changed: number; unchanged: number; skippedNoRaceRow: number; deleted: number; asOf: string | null; sourceUrl: string; dataUrl: string; conflicts?: string[]; pageAsOf?: string | null; unparsed?: string[] };
type Leg = { ok: boolean; error?: string; stats?: { scraped: number; upserted: number; changed: number; unchanged: number; deleted: number; raters: Record<string, RaterStats> } };
type RunOut = { status: number | null; out: string; err: string; httpStatus?: number; body?: { ok: boolean; elapsedMs: number; payload?: { chambers: Record<Chamber, Leg> }; error?: string } };
function runSync(label: string): RunOut {
  const env = childEnv(`file:${COPY}`, {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${SHIM}`.trim(),
    HANG_770_MODE: "serve",
    HANG_770_FILE: PAGE,
  });
  const r = spawnSync(process.execPath, [TSX, RUNNER], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = redactSecrets(r.stdout ?? "");
  const err = redactSecrets(r.stderr ?? "");
  writeFileSync(path.join(ART, `legB-${label}.txt`), `$ tsx ${path.relative(process.cwd(), RUNNER)} (file: copy, page served from the saved copy)\n${out}${err ? `\n--- stderr\n${err}` : ""}`);
  const m = /^RESULT (.+)$/m.exec(out);
  const res = m ? (JSON.parse(m[1]!) as { body: RunOut["body"]; httpStatus: number }) : null;
  return { status: r.status, out, err, httpStatus: res?.httpStatus, body: res?.body };
}
const sab = (run: RunOut, c: Chamber) => run.body?.payload?.chambers[c]?.stats?.raters.sabato;

// ── leg B ───────────────────────────────────────────────────────────────────
async function legB(): Promise<{ run1: RunOut }> {
  say(`\n── leg B, the sync on a file: copy`);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: childEnv(`file:${COPY}`), encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the copy failed: ${redactSecrets((mig.stderr || mig.stdout).slice(-600))}`);
  const prod = prodClient();
  const read = reader(prod);
  const seeded = await withCopy(async (db) => {
    await db.execute("PRAGMA foreign_keys = OFF");
    const n: string[] = [];
    for (const t of ["races", "race_ratings", "rating_history"]) n.push(`${t} ${await copyRows(read, db, t)}`);
    n.push(`cron_runs ${await copyRows(read, db, "cron_runs", "WHERE route IN (?, ?)", [SYNC_ROUTE, HIST_ROUTE])} (the guard's two routes, whole)`);
    return n.join(" · ");
  });
  prod.close();
  say(`  copy: ${path.relative(process.cwd(), COPY)}, the real scripts/migrate.ts, seeded from prod · ${seeded}`);
  writeFileSync(RUNNER, RUNNER_SRC);

  const parsed: Record<Chamber, SabatoChanges> = {
    house: parseSabatoChanges(readFileSync(PAGE, "utf8"), "house"),
    senate: parseSabatoChanges(readFileSync(PAGE, "utf8"), "senate"),
  };
  const before = await snapshot();

  // The classes, read off the copy before the run as S2 read them off prod.
  const klass = new Map<string, Klass>();
  const chainOf = new Map<string, string>();
  const newestOf = new Map<string, { label: string; date: string | null }>();
  for (const c of CHAMBERS) {
    for (const x of [...parsed[c].ratings, ...parsed[c].locked]) {
      const stored = before.rows.get(`${x.raceId}-sabato`)?.rating ?? null;
      const newest = "rating" in x ? x.rating : x.label;
      const safe = !("rating" in x);
      const inChain = stored !== null && (x.chain ?? []).some((s) => s.from === stored || s.to === stored);
      klass.set(x.raceId, stored === null ? (safe ? "no row, newest Safe" : "new pair") : !inChain ? "conflict" : safe ? "departure" : stored === newest ? "current" : "behind");
      chainOf.set(x.raceId, (x.chain ?? []).map((s) => `${s.date} ${s.from}→${s.to}`).join(" ; "));
      newestOf.set(x.raceId, { label: newest, date: x.asOfDate });
    }
  }

  const run1 = runSync("run1");
  const after = await snapshot();
  check("B", "run 1: the handler records success, HTTP 200, both legs ok", run1.status === 0 && run1.httpStatus === 200 && run1.body?.ok === true && CHAMBERS.every((c) => run1.body?.payload?.chambers[c]?.ok === true), `exit ${run1.status} · HTTP ${run1.httpStatus} · ${CHAMBERS.map((c) => `${c} ok=${run1.body?.payload?.chambers[c]?.ok}`).join(" · ")} · ${run1.body?.elapsedMs} ms`);
  const shimLines = run1.out.split(/\r?\n/).filter((l) => l.includes("[hang-770] page fetch #"));
  check("B", "run 1 fetched the page once, with the shipped agent and Accept: text/html", shimLines.length === 1 && shimLines[0]!.includes('User-Agent "CBT-ratings-sync/1.0 (+https://github.com/CSU-J3/cbt)"') && shimLines[0]!.includes('Accept "text/html"'), shimLines.join(" | ") || "(none)");

  for (const c of CHAMBERS) {
    const s = sab(run1, c);
    const ids = [...klass].filter(([id]) => chamberOf(id) === c);
    const count = (k: Klass) => ids.filter(([, v]) => v === k).length;
    say(`\n  ${c}: ${ids.length} races on the page · ${KLASSES.map((k) => `${k} ${count(k)}`).join(" · ")}`);
    say(`  ${c} stats.raters.sabato: ${JSON.stringify(s)}`);
    check("B", `${c}: the copy's classes are S2's, under the S1 ruling`, KLASSES.every((k) => count(k) === S2[c][k]), KLASSES.map((k) => `${k} ${count(k)}/${S2[c][k]}`).join(" · "));
    check(
      "B",
      `${c}: the sync's counts are the classes: unchanged = current, changed = behind, upserted − changed = new pair, deleted = departure, conflicts = conflict`,
      !!s && s.ok && s.unchanged === count("current") && s.changed === count("behind") && s.upserted - s.changed === count("new pair") && s.deleted === count("departure") && (s.conflicts ?? []).length === count("conflict") && s.skippedNoRaceRow === 0,
      s ? `unchanged ${s.unchanged} · changed ${s.changed} · new ${s.upserted - s.changed} · deleted ${s.deleted} · conflicts ${JSON.stringify(s.conflicts)} · skipped (no races row) ${s.skippedNoRaceRow}` : "(no sabato stats)",
    );
    check("B", `${c}: pageAsOf, asOf and unparsed`, !!s && s.pageAsOf === parsed[c].pageAsOf && s.asOf === "2026-10-08T16:16:16+00:00" && (s.unparsed ?? []).length === 0 && s.sourceUrl === SABATO_CHANGES_URL && s.dataUrl === SABATO_CHANGES_URL, s ? `pageAsOf ${s.pageAsOf} · asOf ${s.asOf} · unparsed ${JSON.stringify(s.unparsed)} · sourceUrl ${s.sourceUrl}` : "-");
    // Every change, with its date and the label its chain moved it from.
    const mine = (r: Row) => r.source === "sabato" && chamberOf(r.raceId) === c;
    const changed = [...after.rows.values()].filter((r) => mine(r) && before.rows.has(r.id) && before.rows.get(r.id)!.rating !== r.rating);
    const added = [...after.rows.values()].filter((r) => mine(r) && !before.rows.has(r.id));
    const gone = [...before.rows.values()].filter((r) => mine(r) && !after.rows.has(r.id));
    for (const r of changed) say(`    changed  ${r.raceId}: ${before.rows.get(r.id)!.rating} (rating_date ${before.rows.get(r.id)!.date}) → ${r.rating} (rating_date ${r.date}) · chain ${chainOf.get(r.raceId)}`);
    for (const r of added) say(`    new pair ${r.raceId}: ${r.rating} (rating_date ${r.date}) · chain ${chainOf.get(r.raceId)}`);
    for (const r of gone) say(`    departed ${r.raceId}: ${r.rating} (rating_date ${r.date}) → ${newestOf.get(r.raceId)?.label} on ${newestOf.get(r.raceId)?.date} · chain ${chainOf.get(r.raceId)}`);
    const right = (r: Row) => r.rating === newestOf.get(r.raceId)?.label && r.date === newestOf.get(r.raceId)?.date && r.url === SABATO_CHANGES_URL;
    check(
      "B",
      `${c}: every change and new pair is its race's class (behind / new pair), now reading the newest change's label, its date as rating_date, and Sabato's page as source_url`,
      changed.length === count("behind") && changed.every((r) => klass.get(r.raceId) === "behind" && right(r)) && added.length === count("new pair") && added.every((r) => klass.get(r.raceId) === "new pair" && right(r)),
      `${changed.length} changed · ${added.length} new`,
    );
    check("B", `${c}: every departure is a departure-class race`, gone.length === count("departure") && gone.every((r) => klass.get(r.raceId) === "departure"), gone.map((r) => r.raceId).join(", ") || "none");
    const untouched = ids.filter(([, v]) => v === "current" || v === "no row, newest Safe").map(([id]) => id);
    check("B", `${c}: current races untouched, and no row written for a race whose newest label is Safe`, untouched.every((id) => (before.rows.get(`${id}-sabato`)?.updated ?? null) === (after.rows.get(`${id}-sabato`)?.updated ?? null)), `${untouched.length} races`);
    const entered = [...after.rated[c]].filter((id) => !before.rated[c].has(id));
    const left = [...before.rated[c]].filter((id) => !after.rated[c].has(id));
    say(`    rated races (cycle 2026, the index's join): ${before.rated[c].size} → ${after.rated[c].size} · entered ${entered.join(", ") || "none"} · left ${left.join(", ") || "none"}`);
  }
  const histNew = await withCopy(async (db) =>
    (await db.execute({ sql: "SELECT race_id, source, rating, rating_score, rating_date, observed_at FROM rating_history WHERE observed_at = ? ORDER BY race_id", args: [new Date().toISOString().slice(0, 10)] })).rows.map((r) => `${r.race_id} ${r.source} ${r.rating} (${r.rating_score}) rating_date ${r.rating_date}`),
  );
  check("B", "each departure logged its own history row at ±3, today", histNew.length === after.history - before.history && histNew.length === S2.house.departure + S2.senate.departure, `${before.history} → ${after.history} · ${histNew.join(" · ")}`);
  for (const s of ["cook", "inside_elections"] as const) check("B", `every ${s} row the same`, before.fp[s] === after.fp[s], `${before.fp[s]} → ${after.fp[s]}`);

  const run2 = runSync("run2");
  const again = await snapshot();
  const zero = CHAMBERS.every((c) => run2.body?.payload?.chambers[c]?.ok === true && sab(run2, c)?.changed === 0 && sab(run2, c)?.upserted === 0 && sab(run2, c)?.deleted === 0);
  check("B", "a second run changes 0 rows and deletes 0", run2.status === 0 && zero && again.fp.sabato === after.fp.sabato && again.history === after.history, CHAMBERS.map((c) => `${c} changed ${sab(run2, c)?.changed} upserted ${sab(run2, c)?.upserted} deleted ${sab(run2, c)?.deleted}`).join(" · ") + ` · sabato ${after.fp.sabato} → ${again.fp.sabato}`);

  // The chain check's red.
  say(`\n  the chain check, two planted rows`);
  await withCopy(async (db) => {
    for (const p of PLANTS) {
      await db.execute({
        sql: `INSERT INTO race_ratings (id, race_id, source, rating, rating_score, rating_date, source_url, cycle, updated_at)
              VALUES (?, ?, 'sabato', ?, ?, '2026-01-01', 'planted', 2026, '2000-01-01T00:00:00.000Z')
              ON CONFLICT(id) DO UPDATE SET rating = excluded.rating, rating_score = excluded.rating_score,
                rating_date = excluded.rating_date, source_url = excluded.source_url, updated_at = excluded.updated_at`,
        args: [`${p.raceId}-sabato`, p.raceId, p.label, p.score],
      });
    }
  });
  for (const p of PLANTS) say(`    ${p.raceId}-sabato planted at ${p.label}; its chain ${chainOf.get(p.raceId)}; its class without the check: ${klass.get(p.raceId)} → would be ${p.otherwise}`);
  const run3 = runSync("run3-planted-conflicts");
  const planted = await snapshot();
  const s3 = sab(run3, "house");
  const conflictLines = `${run3.out}\n${run3.err}`.split(/\r?\n/).filter((l) => l.includes("CONFLICT:"));
  check(
    "B",
    "red: both planted rows are conflicts, counted with their ids, warned, and left as planted",
    run3.status === 0 &&
      JSON.stringify([...(s3?.conflicts ?? [])].sort()) === JSON.stringify(PLANTS.map((p) => p.raceId).sort()) &&
      conflictLines.length === 2 &&
      PLANTS.every((p) => planted.rows.get(`${p.raceId}-sabato`)?.rating === p.label && planted.rows.get(`${p.raceId}-sabato`)?.updated === "2000-01-01T00:00:00.000Z"),
    `conflicts ${JSON.stringify(s3?.conflicts)} · ${conflictLines.map((l) => l.trim()).join(" | ")} · ${PLANTS.map((p) => `${p.raceId} ${planted.rows.get(`${p.raceId}-sabato`)?.rating}`).join(" · ")}`,
  );
  check("B", "…and the run wrote nothing else", s3?.changed === 0 && s3?.upserted === 0 && s3?.deleted === 0 && sab(run3, "senate")?.upserted === 0 && planted.history === again.history, `house changed ${s3?.changed} upserted ${s3?.upserted} deleted ${s3?.deleted} · senate upserted ${sab(run3, "senate")?.upserted} · history ${again.history} → ${planted.history}`);
  return { run1 };
}

// ── the live page, report only ──────────────────────────────────────────────
async function livePage() {
  say(`\n── leg B, report: one live read of Sabato's page through scrapeChamber (the shipped fetch)`);
  const run = newScrapeRun();
  const t0 = Date.now();
  const live = await Promise.all(CHAMBERS.map((c) => scrapeChamber(c, run)));
  const ms = Date.now() - t0;
  let html: string | null = null;
  try {
    html = await run.get(SABATO_CHANGES_URL, "text/html"); // the same answer, memoized: no second request
  } catch (e) {
    say(`  the fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (html) {
    writeFileSync(path.join(ART, "legB-live-page.html"), html);
    say(`  ${SABATO_CHANGES_URL}: ${Buffer.byteLength(html).toLocaleString("en-US")} bytes in ${ms} ms · sha256 ${sha(html)} · saved as legB-live-page.html`);
  }
  const saved = readFileSync(PAGE, "utf8");
  for (const [i, c] of CHAMBERS.entries()) {
    const l = live[i]!;
    if (l.failures.length) {
      say(`  ${c}: did not read: ${l.failures.map((f) => f.error).join(" | ")}`);
      continue;
    }
    const p = parseSabatoChanges(saved, c);
    const key = (x: { raceId: string; asOfDate: string | null; rating?: string; label?: string }) => `${x.raceId} ${x.rating ?? x.label} ${x.asOfDate}`;
    const a = new Set([...p.ratings, ...p.locked].map(key));
    const b = new Set([...l.scrape.ratings, ...l.scrape.locked].map(key));
    const onlyLive = [...b].filter((k) => !a.has(k));
    const onlySaved = [...a].filter((k) => !b.has(k));
    say(`  ${c}: live ${l.scrape.ratings.length} competitive and ${l.scrape.locked.length} Safe current · newest table ${l.reads[0]?.pageAsOf} · page modified ${l.reads[0]?.asOf} · unparsed ${JSON.stringify(l.reads[0]?.unparsed)} · against the saved page: ${onlyLive.length || onlySaved.length ? `live only ${onlyLive.join(", ") || "none"} · saved only ${onlySaved.join(", ") || "none"}` : "the same races, labels and dates"}`);
  }
}

// ── leg D ───────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const iso = (s: string) => new Date(s).toISOString();
type LegShape = { ok: boolean; stats: { scraped: number; raters?: Record<string, { ok: boolean; scraped: number }> } };
const run = (startedAt: string, chambers: Partial<Record<Chamber, LegShape>>, status = "success"): SyncRunRow => ({
  startedAt: iso(startedAt),
  status,
  payload: JSON.stringify(status === "success" ? { ok: true, elapsedMs: 1, payload: { chambers } } : { ok: false, elapsedMs: 1, error: "planted", status }),
});
const pre770 = (n: number): LegShape => ({ ok: true, stats: { scraped: n } });
const post770 = (raters: Record<string, number>): LegShape => ({
  ok: true,
  stats: { scraped: Object.values(raters).reduce((a, b) => a + b, 0), raters: Object.fromEntries(Object.entries(raters).map(([k, v]) => [k, { ok: true, scraped: v }])) },
});
function ticks(from: string, to: string): HistoryRunRow[] {
  const out: HistoryRunRow[] = [];
  for (let t = Date.parse(`${from}T15:00:00Z`); t <= Date.parse(`${to}T15:00:00Z`); t += DAY) out.push({ startedAt: new Date(t).toISOString(), status: "success" });
  return out;
}
const hz = (sync: SyncRunRow[], hist: HistoryRunRow[]): GuardHorizons => ({
  sync: sync.map((r) => r.startedAt).sort()[0] ?? null,
  history: hist.map((r) => r.startedAt).sort()[0] ?? null,
});

async function legD(run1: RunOut) {
  say(`\n── leg D, the guard per rater`);
  const oldShape: SyncRunRow = { startedAt: iso("2026-09-02T11:00:00Z"), status: "success", payload: JSON.stringify({ ok: true, elapsedMs: 1, payload: { stats: { scraped: 218 } } }) };
  const pre = run("2026-09-30T11:00:00Z", { house: pre770(218), senate: pre770(30) });
  const prodRuns = await withCopy(async (db) =>
    (await db.execute({ sql: "SELECT id, started_at, status, payload FROM cron_runs WHERE route = ? ORDER BY started_at, id", args: [SYNC_ROUTE] })).rows.map((r) => ({
      id: Number(r.id),
      row: { startedAt: String(r.started_at), status: String(r.status), payload: r.payload == null ? null : String(r.payload) } as SyncRunRow,
    })),
  );
  const real = prodRuns.filter((r) => r.row.startedAt < "2026-10-01" && r.row.status === "success").at(-1);
  const each = (r: SyncRunRow, c: MoveChamber) => SOURCES.map((s) => `${s} ${syncLegOk(r, c, s)}`).join(" · ");
  check("D", "a pre-770 run (planted) with both legs ok counts for cook, inside_elections and sabato in each chamber", CHAMBERS.every((c) => SOURCES.every((s) => syncLegOk(pre, c, s))), `house: ${each(pre, "house")} · senate: ${each(pre, "senate")}`);
  check("D", `…and so does prod's last pre-770 success, #${real?.id} (${real?.row.startedAt})`, !!real && CHAMBERS.every((c) => SOURCES.every((s) => syncLegOk(real.row, c, s))), real ? `house: ${each(real.row, "house")} · senate: ${each(real.row, "senate")}` : "(none on the copy)");
  check("D", "the pre-HO 744 House shape counts for every rater in the House and none in the Senate", SOURCES.every((s) => syncLegOk(oldShape, "house", s) && !syncLegOk(oldShape, "senate", s)), `house: ${each(oldShape, "house")} · senate: ${each(oldShape, "senate")}`);
  // Leg B's own run 1: the shipped payload, from the copy's cron_runs.
  const mine = prodRuns.filter((r) => r.row.startedAt >= new Date(Date.now() - DAY).toISOString() && r.row.status === "success");
  const first = mine[0];
  check(
    "D",
    `a post-770 success run, leg B's run 1 as cron_runs stored it (#${first?.id}), counts for sabato and not for cook or inside_elections, and still for the chamber`,
    !!first && CHAMBERS.every((c) => syncLegOk(first.row, c, "sabato") && !syncLegOk(first.row, c, "cook") && !syncLegOk(first.row, c, "inside_elections") && syncLegOk(first.row, c)),
    first ? `house: ${each(first.row, "house")} · chamber ${syncLegOk(first.row, "house")} · senate: ${each(first.row, "senate")} · chamber ${syncLegOk(first.row, "senate")} · run 1's body ok ${run1.body?.ok}` : "(no post-770 row on the copy)",
  );
  // Cook wired after three sabato-only weeks.
  const sync = [
    ...["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30"].map((d) => run(`${d}T11:00:00Z`, { house: pre770(218), senate: pre770(30) })),
    ...["2026-10-14", "2026-10-21", "2026-10-28"].map((d) => run(`${d}T11:00:00Z`, { house: post770({ sabato: 59 }), senate: post770({ sabato: 13 }) })),
    run("2026-11-04T11:00:00Z", { house: post770({ sabato: 59, cook: 40 }), senate: post770({ sabato: 13, cook: 9 }) }),
  ];
  const hist = ticks("2026-08-01", "2026-11-10");
  const T = "2026-11-04";
  const cook = isFreshMove(T, "house", sync, hist, hz(sync, hist), "cook");
  const sabato = isFreshMove(T, "house", sync, hist, hz(sync, hist), "sabato");
  const chamber = isFreshMove(T, "house", sync, hist, hz(sync, hist));
  check("D", "cook wired after three sabato-only weeks: cook's first move (11-04) reads not fresh, sabato's that day fresh", !cook && sabato, `cook ${cook ? "fresh" : "not fresh"} (its S′ is 09-30, 35 days back) · sabato ${sabato ? "fresh" : "not fresh"} (S′ 10-28)`);
  check("D", "…where the chamber reading alone would have passed cook's catch-up (the red § 2 removes)", chamber, `chamber reading ${chamber ? "fresh" : "not fresh"}`);
  const err = run("2026-10-14T11:00:00Z", {}, "error");
  check("D", "an error run counts for no rater, in either chamber, nor for the chamber", CHAMBERS.every((c) => SOURCES.every((s) => !syncLegOk(err, c, s)) && !syncLegOk(err, c)), `house: ${each(err, "house")} · senate: ${each(err, "senate")}`);

  // electoral-legs-768.ts's leg E, unchanged.
  say(`\n── leg D, electoral-legs-768.ts's leg E, unchanged (its own text, run from a harness)`);
  const src = readFileSync("scripts/diagnostic/electoral-legs-768.ts", "utf8").replace(/\r\n/g, "\n");
  const pick = (re: RegExp, what: string) => {
    const m = re.exec(src);
    if (!m) throw new Error(`leg E harness: ${what} not found in electoral-legs-768.ts`);
    return m[0];
  };
  const harness = [
    "// Generated by scripts/diagnostic/ratings-source-770.ts (HO 770 leg D): electoral-legs-768.ts's leg E,",
    "// copied verbatim with the definitions it reads (each block below is the file's own text), and run.",
    'import { config } from "dotenv";',
    'import { createClient, type Client, type InArgs } from "@libsql/client";',
    'import { readRecentRaceMoves } from "@/lib/electoral-general";',
    'import { isFreshMove, syncLegOk, type GuardHorizons, type HistoryRunRow, type MoveChamber, type SyncRunRow } from "@/lib/move-freshness";',
    'import { redactSecrets } from "@/lib/redact";',
    'config({ path: ".env", quiet: true });',
    pick(/^const SYNC_ROUTE = .*\n^const HIST_ROUTE = .*$/m, "the two routes"),
    pick(/^const M1_EXPECTED = .*$/m, "M1_EXPECTED"),
    pick(/^const say = .*$/m, "say"),
    pick(/^let fails = 0, passes = 0;\n^const check = [\s\S]*?^};$/m, "check"),
    pick(/^function prodClient\(\): Client \{[\s\S]*?^};$/m, "prodClient and reader"),
    pick(/^\/\/ ── leg E: the MOVED guard[\s\S]*?(?=^async function movedRows)/m, "leg E"),
    "const out: Record<string, unknown> = {};",
    "legEPlanted(out);",
    "legEProd(out).then(",
    "  () => { say(`leg E: ${passes} PASS · ${fails} FAIL`); process.exitCode = fails ? 1 : 0; },",
    "  (e) => { say(`ERROR ${(e as Error).stack ?? e}`); process.exitCode = 1; },",
    ");",
    "",
  ].join("\n");
  writeFileSync(HARNESS, harness);
  const e = spawnSync(process.execPath, [TSX, HARNESS], { env: { ...process.env }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const eOut = redactSecrets(e.stdout ?? "") + (e.stderr ? `\n--- stderr\n${redactSecrets(e.stderr)}` : "");
  writeFileSync(path.join(ART, "legD-legE-768-unchanged.txt"), eOut);
  for (const l of eOut.split(/\r?\n/).filter((x) => /PASS|FAIL|ERROR|newest sync row/.test(x))) say(`    ${l.trim()}`);
  const tally = /leg E: (\d+) PASS · (\d+) FAIL/.exec(eOut);
  check("D", "electoral-legs-768.ts's leg E, unchanged, still passes (no source, so the chamber reading)", e.status === 0 && !!tally && Number(tally[2]) === 0 && Number(tally[1]) > 0, tally ? `${tally[1]} PASS · ${tally[2]} FAIL` : `exit ${e.status}, no tally`);

  // Every move on the copy, with its source and without.
  const { moves, syncRows, histRows, horizons } = await withCopy(async (db) => {
    const m = (await db.execute(`SELECT race_id, source, observed_at FROM (
        SELECT race_id, source, observed_at, MIN(observed_at) OVER (PARTITION BY race_id, source) AS base FROM rating_history
      ) WHERE observed_at > base`)).rows.map((r) => ({ raceId: String(r.race_id), source: String(r.source), date: String(r.observed_at) }));
    const s = (await db.execute({ sql: "SELECT started_at, status, payload FROM cron_runs WHERE route = ? ORDER BY started_at, id", args: [SYNC_ROUTE] })).rows.map((r) => ({ startedAt: String(r.started_at), status: String(r.status), payload: r.payload == null ? null : String(r.payload) }));
    const h = (await db.execute({ sql: "SELECT started_at, status FROM cron_runs WHERE route = ? AND status = 'success' ORDER BY started_at, id", args: [HIST_ROUTE] })).rows.map((r) => ({ startedAt: String(r.started_at), status: String(r.status) }));
    const first = (await db.execute({ sql: "SELECT route, MIN(started_at) AS f FROM cron_runs WHERE route IN (?, ?) GROUP BY route", args: [SYNC_ROUTE, HIST_ROUTE] })).rows;
    const f = (route: string) => (first.find((r) => r.route === route)?.f == null ? null : String(first.find((r) => r.route === route)!.f));
    return { moves: m, syncRows: s, histRows: h, horizons: { sync: f(SYNC_ROUTE), history: f(HIST_ROUTE) } as GuardHorizons };
  });
  const differ: string[] = [];
  let fresh = 0;
  for (const mv of moves) {
    const c: MoveChamber = chamberOf(mv.raceId);
    const a = isFreshMove(mv.date, c, syncRows, histRows, horizons, mv.source);
    const b = isFreshMove(mv.date, c, syncRows, histRows, horizons);
    if (a) fresh++;
    if (a !== b) differ.push(`${mv.raceId} ${mv.source} ${mv.date}: with ${a} · without ${b}`);
  }
  const post = syncRows.filter((r) => r.payload?.includes('"raters"')).length;
  check("D", "on the copy, every move's verdict is the same with its source and without it", differ.length === 0 && moves.length > 0, `${moves.length} moves (${fresh} fresh) over ${syncRows.length} ratings runs, ${post} of them post-770 (leg B's) · differ ${differ.length ? differ.join(" | ") : "none"}`);
}

async function main() {
  mkdirSync(ART, { recursive: true });
  say(`HO 770 legs B and D · ${new Date().toISOString()} · node ${process.version} · the tree at ${execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()} (working tree)`);
  const fp0 = await prodFingerprint();
  const { run1 } = await legB();
  await livePage();
  await legD(run1);
  const fp1 = await prodFingerprint();
  const moved = Object.keys(fp0).filter((k) => fp0[k as keyof typeof fp0] !== fp1[k as keyof typeof fp1]);
  check("*", "prod's race_ratings, rating_history and ratings runs untouched", moved.length === 0, moved.length ? `changed: ${moved.join(", ")}` : JSON.stringify(fp1));
  say(`\nlegs B and D: ${passes} PASS · ${fails} FAIL`);
  writeFileSync(path.join(ART, "legBD.txt"), log.join("\n") + "\n");
  if (fails) process.exitCode = 1;
}

main().catch((e) => {
  console.error(redactSecrets(String(e?.stack ?? e)));
  writeFileSync(path.join(ART, "legBD.txt"), log.join("\n") + `\nERROR ${redactSecrets(String(e?.stack ?? e))}\n`);
  process.exitCode = 1;
});
