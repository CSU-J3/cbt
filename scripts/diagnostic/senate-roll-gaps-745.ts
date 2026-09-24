// HO 745 — has the Senate vote watermark stranded a roll call? A read-only probe,
// with senate.gov's roll-call MENU as the authority and our `votes` table as the
// thing under test.
//
// The mechanism (docs/backlog.md, "The Senate vote sync strands a roll call…",
// HO 744): `runSenateVotesSync` reads `MAX(roll_call)` once per session and skips
// every menu roll at or below it (lib/senate-votes-sync.ts, `getMaxRollCall`,
// `if (rollInt <= lastNum)`). A roll that fails BEFORE its `votes` row is written
// is only counted (`votesFailed++`); once a later roll in the same session is
// written, MAX passes it and nothing fetches it again. The HO 567 heal pass
// cannot see it, because it selects existing `votes` rows.
//
//   npx tsx scripts/diagnostic/senate-roll-gaps-745.ts
//       the prod reading. TURSO_DATABASE_URL from .env; SELECTs only.
//   npx tsx scripts/diagnostic/senate-roll-gaps-745.ts --db file:<path>
//       the same reading against a copy (no cron_runs there, so no history).
//   npx tsx scripts/diagnostic/senate-roll-gaps-745.ts --self-test
//       the parse control's own control: malformed menus must stop it.
//   npx tsx scripts/diagnostic/senate-roll-gaps-745.ts --control <path> [--session 2] [--n <roll>]
//       THE CONTROL. Seeds a `file:` copy of prod's Senate `votes` + their
//       `member_votes` (prod read with SELECTs only), classifies it, then deletes
//       one mid-session roll N and the session's top roll M (member_votes first,
//       the FK), classifies again, and requires: stranded gains exactly N,
//       pending gains exactly M, that session's gap query reads baseline + 1,
//       and nothing else moves. The copy's URL is `file:` by construction (built
//       from a path that must end in -745-control.db), and the run prints the
//       scheme it wrote to.
//
// Classification of a menu roll with no stored row, per the handoff:
//   never reached — below the stored MIN (a backfill boundary, not the failure);
//   stranded      — between MIN and MAX (the line's failure);
//   pending       — above MAX (the next 10:00 UTC tick fetches it).
// With nothing stored, MAX is 0 to the sync, so every menu roll is pending.
//
// It never imports the sync's write path. The menu is fetched from the sync's
// URL shape with the sync's parser options, and each read carries a PARSE
// CONTROL at the value level: the `<vote_number>` values read off the raw bytes
// must equal, as a multiset, the rolls the parser produced — no duplicates, none
// <= 0 — or the probe stops (`parseMenu`, exported so the control can be shown
// failing on malformed bytes).
import { config } from "dotenv";
import { XMLParser } from "fast-xml-parser";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { createClient, type Client, type InArgs, type ResultSet } from "@libsql/client";
import { getCurrentCongress } from "../../lib/congress";

config({ path: ".env", quiet: true });

const SESSIONS = [1, 2]; // lib/senate-votes-sync.ts: `opts.sessions ?? [1, 2]`
const ROUTE = "/api/sync-votes";

const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

// ── read-only access ────────────────────────────────────────────────────────
// SELECT only. WITH is refused too: `WITH x AS (…) DELETE …` is a write that
// starts with WITH, and nothing here needs a CTE (HO 745 review).
function reader(db: Client) {
  return (sql: string, args?: InArgs): Promise<ResultSet> => {
    const kw = sql.trim().split(/\s+/)[0]!.toUpperCase();
    if (kw !== "SELECT") throw new Error(`read-only: refused ${kw}`);
    return db.execute({ sql, args: args ?? [] });
  };
}
type Read = ReturnType<typeof reader>;

// ── the authority ──────────────────────────────────────────────────────────
type MenuRoll = { roll: number; date: string; question: string; issue: string; result: string; title: string };
type Menu = { session: number; absent: boolean; raw: number; parsed: number; nonPositive: number; contiguous: boolean; rolls: MenuRoll[] };

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).replace(/\s+/g, " ").trim();
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    const o = v as Record<string, unknown>;
    const rest = Object.entries(o)
      .filter(([k]) => k !== "#text")
      .map(([, x]) => text(x))
      .join(" ");
    return `${text(o["#text"])} ${rest}`.trim();
  }
  return JSON.stringify(v);
};
// lib/senate-votes-sync.ts `toInt`, verbatim in behaviour.
const toInt = (v: unknown): number => {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : 0;
};

async function fetchMenu(congress: number, session: number): Promise<Menu> {
  // lib/senate-votes-sync.ts `menuUrl`, same shape.
  const url = `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.xml`;
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(url, { headers: { Accept: "application/xml" } });
    if (res.status !== 502 && res.status !== 503) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  // The sync logs a failed menu fetch and moves on (a session with no votes yet
  // 404s); so does this, rather than abandoning the whole reading.
  if (res && res.status === 404) {
    return { session, absent: true, raw: 0, parsed: 0, nonPositive: 0, contiguous: true, rolls: [] };
  }
  if (!res || !res.ok) throw new Error(`menu ${congress}/${session}: HTTP ${res?.status}`);
  return parseMenu(await res.text(), congress, session);
}

export function parseMenu(bytes: string, congress: number, session: number): Menu {
  // lib/senate-votes-sync.ts `fetchXml`, same options.
  const doc = new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(bytes);
  const votesRaw = doc?.vote_summary?.votes?.vote ?? [];
  const list: Record<string, unknown>[] = Array.isArray(votesRaw) ? votesRaw : [votesRaw];
  const parsed = list.length;
  // PARSE CONTROL, at the value level. A count match alone is not enough: two
  // malformations can cancel and drop a roll with the counts still equal
  // (HO 745 review built one). So every `<vote_number …>` opening tag is
  // counted in any form, every value is read off the raw bytes, and the
  // multiset of raw values must equal the multiset the parser produced.
  const raw = (bytes.match(/<vote_number\b/g) ?? []).length;
  const rawStrings = [...bytes.matchAll(/<vote_number\b[^>]*>([^<]*)<\/vote_number>/g)].map((m) => m[1] ?? "");
  // `toInt` would read "241-A" or "1,234" as a clean number on both sides, so a
  // lossy value must be caught on the raw string, before it is converted.
  const lossy = rawStrings.filter((s) => !/^\s*\d+\s*$/.test(s));
  if (lossy.length) {
    throw new Error(`PARSE CONTROL FAILED for ${congress}/${session}: non-numeric vote_number value(s) ${JSON.stringify(lossy.slice(0, 5))}`);
  }
  const rawValues = rawStrings.map(toInt);
  const parsedValues = list.map((v) => toInt(v.vote_number));
  const key = (xs: number[]) => [...xs].sort((a, b) => a - b).join(",");
  if (parsed !== raw || rawValues.length !== raw || key(rawValues) !== key(parsedValues)) {
    throw new Error(
      `PARSE CONTROL FAILED for ${congress}/${session}: parsed ${parsed} votes, raw <vote_number> tags ${raw}, ` +
        `raw values ${rawValues.length}, value multisets ${key(rawValues) === key(parsedValues) ? "equal" : "DIFFER"}`,
    );
  }
  if (new Set(parsedValues).size !== parsedValues.length) {
    throw new Error(`PARSE CONTROL FAILED for ${congress}/${session}: duplicate vote_number values on the menu`);
  }
  let nonPositive = 0;
  const rolls: MenuRoll[] = [];
  for (const v of list) {
    const roll = toInt(v.vote_number);
    if (roll <= 0) {
      nonPositive++; // the sync's `if (rollInt <= 0) continue;`
      continue;
    }
    rolls.push({
      roll,
      date: text(v.vote_date),
      question: text(v.question),
      issue: text(v.issue),
      result: text(v.result),
      title: text(v.title),
    });
  }
  if (nonPositive > 0) {
    throw new Error(`PARSE CONTROL FAILED for ${congress}/${session}: ${nonPositive} vote_number value(s) read as <= 0`);
  }
  const nums = rolls.map((r) => r.roll).sort((a, b) => a - b);
  const contiguous = nums.length === 0 || (nums[0] === 1 && nums[nums.length - 1] === nums.length);
  return { session, absent: false, raw, parsed, nonPositive, contiguous, rolls };
}

// ── the classification, shared by the prod reading and the control ─────────
type SessionReading = {
  session: number;
  menu: number;
  stored: number;
  min: number | null;
  max: number | null;
  neverReached: number[];
  stranded: number[];
  pending: number[];
  storedNotInMenu: number[];
  gap: number | null;
};

async function classify(read: Read, congress: number, menu: Menu): Promise<SessionReading> {
  const rs = await read(
    `SELECT roll_call FROM votes WHERE chamber = 'senate' AND congress = ? AND session = ?`,
    [congress, menu.session],
  );
  const stored = new Set(rs.rows.map((r) => Number(r.roll_call)));
  const sorted = [...stored].sort((a, b) => a - b);
  const min = sorted.length ? sorted[0]! : null;
  const max = sorted.length ? sorted[sorted.length - 1]! : null;
  const menuSet = new Set(menu.rolls.map((r) => r.roll));
  const neverReached: number[] = [];
  const stranded: number[] = [];
  const pending: number[] = [];
  for (const { roll } of menu.rolls) {
    if (stored.has(roll)) continue;
    if (max === null || roll > max) pending.push(roll);
    else if (roll < min!) neverReached.push(roll);
    else stranded.push(roll);
  }
  const storedNotInMenu = sorted.filter((r) => !menuSet.has(r));
  const g = await read(
    `SELECT MAX(roll_call) - COUNT(*) AS missing FROM votes WHERE chamber = 'senate' AND congress = ? AND session = ?`,
    [congress, menu.session],
  );
  const asc = (a: number, b: number) => a - b;
  return {
    session: menu.session,
    menu: menu.rolls.length,
    stored: stored.size,
    min,
    max,
    neverReached: neverReached.sort(asc),
    stranded: stranded.sort(asc),
    pending: pending.sort(asc),
    storedNotInMenu,
    gap: g.rows[0]?.missing == null ? null : Number(g.rows[0].missing),
  };
}

const fmt = (xs: number[]) => (xs.length ? `${xs.length} [${xs.length > 12 ? `${xs.slice(0, 12).join(",")},…` : xs.join(",")}]` : "0");

function printTable(congress: number, rows: SessionReading[]) {
  console.log("\ncongress · session · menu · stored · MIN · MAX · never reached · stranded · pending · stored-not-in-menu · gap query");
  for (const r of rows) {
    console.log(
      `${congress} · ${r.session} · ${r.menu} · ${r.stored} · ${r.min ?? "—"} · ${r.max ?? "—"} · ${fmt(r.neverReached)} · ${fmt(r.stranded)} · ${fmt(r.pending)} · ${fmt(r.storedNotInMenu)} · ${r.gap ?? "—"}`,
    );
  }
}

async function hasTable(read: Read, name: string): Promise<boolean> {
  const rs = await read(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]);
  return rs.rows.length > 0;
}

async function newestSyncVotesRow(read: Read): Promise<string> {
  const rs = await read(
    `SELECT id, started_at, status FROM cron_runs WHERE route = ? ORDER BY started_at DESC LIMIT 1`,
    [ROUTE],
  );
  const r = rs.rows[0];
  return r ? `#${r.id} ${r.started_at} ${r.status}` : "(none)";
}

// ── the reading ────────────────────────────────────────────────────────────
async function probe(dbUrl: string, authToken: string | undefined): Promise<number> {
  const db = createClient({ url: dbUrl, authToken });
  const read = reader(db);
  const scheme = dbUrl.split(":")[0];
  const congress = getCurrentCongress();
  console.log(`=== HO 745 probe · database scheme ${scheme}: · congress ${congress} · sessions ${SESSIONS.join(",")} ===`);
  const withRuns = await hasTable(read, "cron_runs");
  const before = withRuns ? await newestSyncVotesRow(read) : "n/a (no cron_runs on this database)";
  console.log(`newest ${ROUTE} cron_runs row BEFORE: ${before}`);

  const menus: Menu[] = [];
  for (const s of SESSIONS) {
    const m = await fetchMenu(congress, s);
    if (m.absent) {
      console.log(`menu ${congress}/${s}: 404 — absent (the sync logs and continues too); nothing to classify`);
      continue;
    }
    console.log(
      `parse control ${congress}/${s}: raw <vote_number> tags ${m.raw} = parsed ${m.parsed}, value multisets equal, no duplicates, none <= 0 ✓ · ` +
        `menu ${m.contiguous ? `is exactly 1..${m.rolls.length}` : "is NOT contiguous 1..N"}`,
    );
    menus.push(m);
  }
  const rows: SessionReading[] = [];
  for (const m of menus) rows.push(await classify(read, congress, m));
  printTable(congress, rows);
  // "never reached" is the handoff's category for holes below the stored MIN
  // (a backfill boundary). The sync skips those by the same `rollInt <= lastNum`
  // as a strand, so a hole there is benign only if the store began above roll 1;
  // with MIN = 1 the category is empty by construction (HO 745 review).
  for (const r of rows) {
    if (r.neverReached.length && r.min !== null && r.min > 1) {
      console.log(`  session ${r.session}: ${r.neverReached.length} below MIN ${r.min} — skipped by the same watermark as a strand; benign only if the store was seeded above roll 1`);
    }
  }

  // The reconciliation the gap query should satisfy when the menu is 1..N:
  // MAX - COUNT = (MIN - 1) + stranded - stored-not-in-menu-below-MAX.
  for (const r of rows) {
    if (r.max === null) continue;
    const expected = r.neverReached.length + r.stranded.length;
    console.log(
      `  session ${r.session}: gap query ${r.gap} vs never-reached + stranded ${expected}` +
        (r.gap === expected ? " — agree" : " — DIFFER (menu not 1..N, or stored rolls absent from it)"),
    );
  }

  console.log("\nstranded, with the menu's own words:");
  let anyStranded = false;
  for (const r of rows) {
    const m = menus.find((x) => x.session === r.session)!;
    for (const roll of r.stranded) {
      anyStranded = true;
      const v = m.rolls.find((x) => x.roll === roll)!;
      console.log(`  ${congress}/${r.session} roll ${roll} · ${v.date} · ${v.question} · ${v.issue} · ${v.result} · ${v.title}`);
    }
  }
  if (!anyStranded) console.log("  (none)");

  console.log("\nthe gap query over the whole table (the line's own query; sessions the sync no longer reaches are context only):");
  const gq = await read(
    `SELECT congress, session, MAX(roll_call) - COUNT(*) AS missing, COUNT(*) AS n, MIN(roll_call) AS mn, MAX(roll_call) AS mx
       FROM votes WHERE chamber = 'senate' GROUP BY congress, session ORDER BY congress, session`,
  );
  for (const r of gq.rows) {
    const reached = Number(r.congress) === congress && SESSIONS.includes(Number(r.session));
    console.log(`  ${r.congress}/${r.session}: missing ${r.missing} (count ${r.n}, min ${r.mn}, max ${r.mx})${reached ? "" : " — not reached by the sync, context only"}`);
  }

  console.log("\nthe heal pass's own set (nonzero tally, no member_votes), the complement it does cover:");
  const heal = await read(
    `SELECT congress, session, COUNT(*) AS n, GROUP_CONCAT(roll_call) AS rolls FROM votes
      WHERE chamber = 'senate'
        AND (yea_count + nay_count + COALESCE(present_count, 0) + COALESCE(not_voting_count, 0)) > 0
        AND NOT EXISTS (SELECT 1 FROM member_votes mv WHERE mv.vote_id = votes.id)
      GROUP BY congress, session ORDER BY congress, session`,
  );
  if (heal.rows.length === 0) console.log("  (none, in any session)");
  for (const r of heal.rows) console.log(`  ${r.congress}/${r.session}: ${r.n} · rolls ${r.rolls}`);

  if (withRuns) {
    console.log(`\nhistory: every ${ROUTE} cron_runs row, read for $.payload.senate.votesFailed:`);
    // TWO payload shapes. Before HO 139's wrapCronRoute (rows #4-#33) the route
    // stored `{ ok, house, senate }` at the top level; after it, `{ ok,
    // elapsedMs, payload: { house, senate, … } }`. Reading only the second
    // misfiled the first six rows as having no Senate leg (HO 745 review) —
    // the leg predates cron_runs itself. Both are read here.
    const h = await read(
      `SELECT id, started_at, status,
              COALESCE(json_type(payload, '$.payload.senate'), json_type(payload, '$.senate')) AS st,
              COALESCE(json_extract(payload, '$.payload.senate.votesFailed'), json_extract(payload, '$.senate.votesFailed')) AS vf,
              COALESCE(json_extract(payload, '$.payload.senate.votesInserted'), json_extract(payload, '$.senate.votesInserted')) AS vi,
              (SELECT group_concat(key) FROM json_each(cron_runs.payload)) AS keys
         FROM cron_runs WHERE route = ? ORDER BY started_at`,
      [ROUTE],
    );
    const all = h.rows;
    const withSenate = all.filter((r) => r.st === "object");
    const failing = withSenate.filter((r) => Number(r.vf) > 0);
    const byStatus = new Map<string, number>();
    for (const r of all) byStatus.set(String(r.status), (byStatus.get(String(r.status)) ?? 0) + 1);
    const byShape = new Map<string, number>();
    for (const r of all) byShape.set(String(r.keys), (byShape.get(String(r.keys)) ?? 0) + 1);
    console.log(
      `  scanned ${all.length} rows · earliest ${all[0]?.started_at} (#${all[0]?.id}) · status ${[...byStatus].map(([k, v]) => `${k} ${v}`).join(" · ")}`,
    );
    console.log(`  payload shapes (top-level keys): ${[...byShape].map(([k, v]) => `{${k}} ×${v}`).join(" · ")}`);
    console.log(`  ${withSenate.length} carry senate stats, in either shape (earliest ${withSenate[0]?.started_at}, #${withSenate[0]?.id})`);
    // What is left cannot be read: a timeout/error row stores only
    // {ok, elapsedMs, error, status} with no sync stats, and a success row whose
    // senate is JSON null would mean the leg threw. Either way, whether that
    // tick failed a roll is UNKNOWABLE from cron_runs.
    const blind = all.filter((r) => r.st !== "object");
    console.log(`  ${blind.length} rows carry no senate stats — their Senate votesFailed is unknowable:`);
    for (const r of blind) console.log(`    #${r.id} ${r.started_at} ${r.status} · senate ${r.st ?? "absent"} · keys {${r.keys}}`);
    console.log(`  rows with senate votesFailed > 0: ${failing.length}`);
    for (const r of failing) console.log(`    #${r.id} ${r.started_at} ${r.status} · votesFailed ${r.vf} · votesInserted ${r.vi}`);
    console.log(
      "  coverage: route ticks from the first cron_runs row only. The pre-cron_runs backfill and any manual `npm run sync:senate-votes` " +
        "write the store with no row here, so the store reading above, not this history, is the verdict on whether a roll is stranded.",
    );
    const after = await newestSyncVotesRow(read);
    console.log(`\nnewest ${ROUTE} cron_runs row AFTER:  ${after}`);
    if (after !== before) {
      console.log("THE STORE MOVED UNDER THE READ — run again.");
      db.close();
      return 3;
    }
  }
  db.close();
  return 0;
}

// ── the control ────────────────────────────────────────────────────────────
const VOTES_DDL = `CREATE TABLE votes (
    id TEXT PRIMARY KEY, chamber TEXT NOT NULL, congress INTEGER NOT NULL,
    session INTEGER NOT NULL, roll_call INTEGER NOT NULL, vote_date TEXT NOT NULL,
    question TEXT, description TEXT, result TEXT,
    bill_id TEXT, amendment_designation TEXT,
    yea_count INTEGER NOT NULL, nay_count INTEGER NOT NULL,
    present_count INTEGER, not_voting_count INTEGER,
    raw_json TEXT NOT NULL, update_date TEXT NOT NULL)`; // migrate.ts shape; bill_id's FK to bills dropped (no bills table in the copy)
const MEMBER_VOTES_DDL = `CREATE TABLE member_votes (
    vote_id TEXT NOT NULL REFERENCES votes(id), bioguide_id TEXT NOT NULL,
    position TEXT NOT NULL, PRIMARY KEY (vote_id, bioguide_id))`; // migrate.ts shape, FK kept
const VOTE_COLS = ["id", "chamber", "congress", "session", "roll_call", "vote_date", "question", "description", "result", "bill_id", "amendment_designation", "yea_count", "nay_count", "present_count", "not_voting_count", "raw_json", "update_date"];

async function control(filePath: string): Promise<number> {
  const abs = path.resolve(filePath);
  // The control only ever writes a file: database. That holds by CONSTRUCTION —
  // the URL is built as `file:${abs}` from a path, never read from the
  // environment — and the scheme is printed so the run shows it. The path must
  // be the control's own kind of file, so the delete below can never take out
  // something else (`--control .env`, a dev DB).
  if (!abs.endsWith("-745-control.db")) {
    throw new Error(`refused: --control must name a *-745-control.db file (got ${abs})`);
  }
  const url = `file:${abs}`;
  const scheme = url.split(":")[0];
  console.log(`=== HO 745 CONTROL · perturbation target scheme ${scheme}: · ${abs} ===`);

  const prodUrl = process.env.TURSO_DATABASE_URL ?? "";
  if (!prodUrl.startsWith("libsql://")) throw new Error("the seed reads prod; TURSO_DATABASE_URL must be the prod libsql:// URL");
  const prod = createClient({ url: prodUrl, authToken: process.env.TURSO_AUTH_TOKEN });
  const prodRead = reader(prod);
  const votes = await prodRead(`SELECT * FROM votes WHERE chamber = 'senate'`);
  const mvs = await prodRead(
    `SELECT mv.vote_id, mv.bioguide_id, mv.position FROM member_votes mv JOIN votes v ON v.id = mv.vote_id WHERE v.chamber = 'senate'`,
  );
  prod.close();

  if (existsSync(abs)) rmSync(abs);
  const local = createClient({ url });
  await local.execute("PRAGMA foreign_keys = ON");
  await local.execute(VOTES_DDL);
  await local.execute(MEMBER_VOTES_DDL);
  const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  for (const part of chunk(votes.rows, 400)) {
    await local.batch(
      part.map((r) => ({
        sql: `INSERT INTO votes (${VOTE_COLS.join(",")}) VALUES (${VOTE_COLS.map(() => "?").join(",")})`,
        args: VOTE_COLS.map((c) => (r as unknown as Record<string, never>)[c] ?? null),
      })),
      "write",
    );
  }
  for (const part of chunk(mvs.rows, 2000)) {
    await local.batch(
      part.map((r) => ({
        sql: "INSERT INTO member_votes (vote_id, bioguide_id, position) VALUES (?, ?, ?)",
        args: [r.vote_id, r.bioguide_id, r.position] as InArgs,
      })),
      "write",
    );
  }
  console.log(`  seeded ${votes.rows.length} Senate votes · ${mvs.rows.length} member_votes (prod read with SELECTs only)`);

  const read = reader(local);
  const congress = getCurrentCongress();
  const session = Number(argAt("--session") ?? 2);
  const menu = await fetchMenu(congress, session);
  if (menu.absent) throw new Error(`control needs a menu for ${congress}/${session}; it 404s`);
  console.log(`  parse control ${congress}/${session}: raw ${menu.raw} = parsed ${menu.parsed}, values equal ✓ (one fetch, reused for both readings)`);

  const base = await classify(read, congress, menu);
  const storedRs = await read(
    `SELECT roll_call FROM votes WHERE chamber = 'senate' AND congress = ? AND session = ? ORDER BY roll_call`,
    [congress, session],
  );
  const storedRolls = storedRs.rows.map((r) => Number(r.roll_call));
  const M = storedRolls[storedRolls.length - 1]!;
  const N = Number(argAt("--n") ?? storedRolls[Math.floor(storedRolls.length / 2)]);
  // N strictly inside the run: N-1, N+1 and M-1 all stored, and N below M-1,
  // so deleting N and M leaves MAX = M-1 above N (otherwise N reads pending
  // and the control fails for the wrong reason).
  if (![N - 1, N, N + 1, M - 1].every((r) => storedRolls.includes(r)) || N >= M - 1) {
    throw new Error(`control needs a stored mid-session N with N-1, N+1 stored and N < M-1 (got N=${N}, M=${M})`);
  }
  const ids = [N, M].map((r) => `senate-${congress}-${session}-${r}`);
  const mvBefore = await read(`SELECT vote_id, COUNT(*) n FROM member_votes WHERE vote_id IN (?, ?) GROUP BY vote_id`, ids);
  console.log(`  perturbing ${scheme}: session ${session}: N=${N} (mid-session), M=${M} (top) · member_votes ${JSON.stringify(mvBefore.rows.map((r) => ({ ...r })))}`);
  // With the seed above, the only writes in this file, and all of them to the
  // `local` client built from `file:${abs}`.
  await local.batch(
    [
      { sql: "DELETE FROM member_votes WHERE vote_id IN (?, ?)", args: ids },
      { sql: "DELETE FROM votes WHERE id IN (?, ?)", args: ids },
    ],
    "write",
  );
  const after = await classify(read, congress, menu);
  local.close();
  console.log("\nbaseline (the unperturbed copy, i.e. prod's snapshot):");
  printTable(congress, [base]);
  console.log("\nperturbed (N and M deleted):");
  printTable(congress, [after]);

  const gained = (a: number[], b: number[]) => b.filter((x) => !a.includes(x));
  const lost = (a: number[], b: number[]) => a.filter((x) => !b.includes(x));
  let failures = 0;
  const check = (label: string, ok: boolean, detail: string) => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
    if (!ok) failures++;
  };
  check("stranded gains exactly N", JSON.stringify(gained(base.stranded, after.stranded)) === JSON.stringify([N]) && lost(base.stranded, after.stranded).length === 0, `gained ${JSON.stringify(gained(base.stranded, after.stranded))}, lost ${JSON.stringify(lost(base.stranded, after.stranded))}`);
  check("pending gains exactly M", JSON.stringify(gained(base.pending, after.pending)) === JSON.stringify([M]) && lost(base.pending, after.pending).length === 0, `gained ${JSON.stringify(gained(base.pending, after.pending))}, lost ${JSON.stringify(lost(base.pending, after.pending))}`);
  check("M is NOT filed as stranded", !after.stranded.includes(M), `stranded ${fmt(after.stranded)}`);
  check("never-reached unmoved", JSON.stringify(base.neverReached) === JSON.stringify(after.neverReached), `${fmt(base.neverReached)} → ${fmt(after.neverReached)}`);
  check("stored-not-in-menu unmoved", JSON.stringify(base.storedNotInMenu) === JSON.stringify(after.storedNotInMenu), `${fmt(base.storedNotInMenu)} → ${fmt(after.storedNotInMenu)}`);
  check("gap query reads baseline + 1", after.gap === (base.gap ?? 0) + 1, `${base.gap} → ${after.gap}`);
  console.log(`\nCONTROL: ${failures === 0 ? "ALL HELD — the instrument sees a planted strand and does not mistake the top for one" : `${failures} FAILED — the instrument is wrong; stop`}`);
  return failures === 0 ? 0 : 1;
}

// ── the parse control's own control ────────────────────────────────────────
// Each malformed menu must STOP `parseMenu`; the well-formed one must pass. The
// second case is the HO 745 review's: counts agree while a roll vanishes.
function selfTest(): number {
  const menu = (votes: string) => `<?xml version="1.0"?><vote_summary><votes>${votes}</votes></vote_summary>`;
  const v = (n: string) => `<vote><vote_number>${n}</vote_number><vote_date>1-Jan</vote_date><question>Q</question></vote>`;
  const cases: [string, string, boolean][] = [
    ["well-formed 1..3", menu(v("00001") + v("00002") + v("00003")), true],
    ["two numbers in one vote + a spaced tag (roll 4 vanishes under a count check)", menu(`<vote><vote_number>00003</vote_number><vote_number>00004</vote_number></vote><vote><vote_number >00005</vote_number></vote>`), false],
    ["a vote with no vote_number", menu(v("00001") + `<vote><vote_date>1-Jan</vote_date></vote>`), false],
    ["duplicate roll", menu(v("00001") + v("00001")), false],
    ["lossy value 241-A", menu(v("00240") + v("241-A")), false],
    ["zero roll", menu(v("00000") + v("00001")), false],
    ["vote_number inside a comment", menu(v("00001") + `<!-- <vote_number>00002</vote_number> -->`), false],
  ];
  let wrong = 0;
  for (const [name, bytes, shouldPass] of cases) {
    let passed = true;
    let msg = "";
    try {
      msg = `rolls [${parseMenu(bytes, 119, 9).rolls.map((r) => r.roll)}]`;
    } catch (e) {
      passed = false;
      msg = (e as Error).message.replace(/^PARSE CONTROL FAILED for 119\/9: /, "");
    }
    if (passed !== shouldPass) wrong++;
    console.log(`${passed === shouldPass ? "PASS" : "FAIL"}  ${name}: ${passed ? "control passed" : "control STOPPED"} · ${msg}`);
  }
  console.log(wrong === 0 ? "parse control: every malformed menu stopped it, the well-formed one passed" : `${wrong} WRONG`);
  return wrong === 0 ? 0 : 1;
}

// Run only when invoked as a script, so `parseMenu` can be imported by a test.
const invoked = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/diagnostic/senate-roll-gaps-745.ts");
if (invoked) void (async () => {
  const controlPath = argAt("--control");
  const code = process.argv.includes("--self-test")
    ? selfTest()
    : controlPath
    ? await control(controlPath)
    : await probe(argAt("--db") ?? process.env.TURSO_DATABASE_URL!, argAt("--db") ? undefined : process.env.TURSO_AUTH_TOKEN);
  process.exit(code);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
