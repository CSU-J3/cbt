// HO 751 — repair members' Ballotpedia titles once, from the ballot, with every
// tie printed for a human to read before anything is written.
//
//   npm run repair:ballotpedia-titles -- --plan-out <file>          # dry: find, confirm, print, and save the confirmed rows as a plan
//   npm run repair:ballotpedia-titles -- --record <dir> ...         # dry, keeping every fetched page (gzipped) + an index
//   npm run repair:ballotpedia-titles -- --replay <dir> ...         # dry, serving a --record run's pages (no network)
//   npm run repair:ballotpedia-titles -- --control "<title>" ...    # add a control stale title, fetched and never written
//   npm run repair:ballotpedia-titles -- --write --plan <file>      # write EXACTLY the plan a human read
//
// What it does (lib/ballotpedia-title-repair.ts): every stored 2026 incumbent
// printed on a ballot but untied by identity (the rule found them by underline
// and surname, or they moved and are underlined, untied, in another district)
// gets a learned title from the printed row's person_key. It is confirmed by one
// of three signals (the HO 751 ruling): the stale title's redirect (one GET per
// stale title, at the reader's 6s pacing and user agent, one attempt, stopping
// at the first unreadable page); a Ballotpedia disambiguation page, at the stale
// title, that links the learned title; or the name check, for a missing title
// and as the fallback for a stale title whose page confirms neither way.
//
// THE WRITE IS BOUND TO WHAT WAS READ (the HO 751 review). A dry run prints every
// case and saves its confirmed rows with --plan-out; --write takes that plan,
// fetches nothing, re-derives the cases from the database, refuses unless every
// planned row is still a current case with the same learned key (or already
// resolved to it), and writes exactly those rows: ONLY
// member_ids.ballotpedia_title_resolved / _at / _from, which the crosswalk never
// writes (a member with no member_ids row gets a minimal one).
//
// After a --write, re-read the races it prints, in ONE paced process
// (`npm run sync:general-ballot -- --race A,B,... --write`: 6s start to start, the
// first UNREAD ends it), then run the harvest once (the handoff's FF go names
// both). A second --write after the re-read counts the tied members as done.
// Requires `npm run migrate` first (the three columns).
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { getDb } from "../lib/db";
import { liveIO, MIN_START_GAP_MS, pacedIO, titleKey, type IO } from "../lib/general-ballot";
import { confirmCases, findStaleTitles, resolvedWriteStatements, type Confirmation, type Signal, type TitleCase } from "../lib/ballotpedia-title-repair";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string): string | null => {
  const i = argv.indexOf(f);
  return i < 0 ? null : (argv[i + 1] ?? null);
};
const WRITE = has("--write");
const PLAN = val("--plan");
const PLAN_OUT = val("--plan-out");
const RECORD = val("--record");
const REPLAY = val("--replay");
const CONTROL = val("--control");
if (RECORD && REPLAY) throw new Error("--record and --replay are exclusive");
if (WRITE && !PLAN) throw new Error("--write needs --plan <file>: the confirmed rows a dry run saved with --plan-out and a human read");
if (WRITE && (RECORD || REPLAY || CONTROL || PLAN_OUT)) throw new Error("--write fetches nothing and takes only --plan");

type PlanRow = { bioguide: string; member: string; race: string; key: string; learned: string; signal: Signal; evidence: string };

function printTable(title: string, rows: Confirmation[]) {
  console.log(title);
  console.log(`| # | member | bioguide | kind | printed in | stored title | learned title | signal | evidence | verdict |`);
  console.log(`|---|---|---|---|---|---|---|---|---|---|`);
  rows.forEach((c, i) =>
    console.log(`| ${i + 1} | ${c.member} | ${c.bioguide} | ${c.kind} | ${c.race} | ${c.stored ?? "—"} | ${c.learned} | ${c.signal ?? "—"} | ${c.evidence.replace(/\|/g, "/")} | ${c.verdict}${c.reason ? ` (${c.reason})` : ""} |`),
  );
}

async function main() {
  const db = getDb();
  const cols = (await db.execute(`SELECT name FROM pragma_table_info('member_ids')`)).rows.map((r) => String(r.name));
  const hasResolved = cols.includes("ballotpedia_title_resolved");
  if (WRITE && !hasResolved) throw new Error("member_ids has no ballotpedia_title_resolved column: run `npm run migrate` first");

  // The identity map as the reader keys it (resolved over stored, when the column exists).
  const idRs = await db.execute(
    hasResolved
      ? `SELECT bioguide_id, COALESCE(NULLIF(TRIM(ballotpedia_title_resolved), ''), ballotpedia_title) AS t FROM member_ids`
      : `SELECT bioguide_id, ballotpedia_title AS t FROM member_ids`,
  );
  const identity = new Map<string, string | null>();
  for (const r of idRs.rows) {
    const t = r.t == null ? "" : String(r.t).trim();
    const k = t ? titleKey(t) : null;
    if (!k) continue;
    const b = String(r.bioguide_id);
    identity.set(k, identity.has(k) && identity.get(k) !== b ? null : b);
  }
  const { cases, ambiguousMoved } = await findStaleTitles(db);

  if (WRITE) {
    const plan = JSON.parse(readFileSync(PLAN!, "utf8")) as PlanRow[];
    const rows: Confirmation[] = [];
    const refused: string[] = [];
    let alreadyDone = 0;
    for (const p of plan) {
      const c = cases.find((x) => x.bioguide === p.bioguide && x.key === p.key);
      if (!c) {
        // Not a case any more: fine only if this plan's own write has landed and
        // the race's re-read tied the member (the identity map ties the key to
        // them); anything else means the database moved under the plan.
        if (identity.get(p.key) === p.bioguide) {
          alreadyDone++;
          continue;
        }
        refused.push(`${p.race} ${p.member} (${p.bioguide} → ${p.key}) is no longer a current case`);
        continue;
      }
      if (c.resolved && titleKey(c.resolved) === p.key && identity.get(p.key) === p.bioguide) {
        alreadyDone++;
        continue;
      }
      rows.push({ ...c, signal: p.signal, evidence: `planned: ${p.evidence}`, verdict: "confirmed", reason: null });
    }
    if (refused.length) throw new Error(`refused: the plan no longer matches the database; nothing was written:\n  ${refused.join("\n  ")}`);
    printTable(`=== repair:ballotpedia-titles · WRITE from ${PLAN} · ${new Date().toISOString()} · ${plan.length} planned · ${alreadyDone} already resolved ===`, rows);
    const stmts = resolvedWriteStatements(rows, new Date().toISOString());
    await db.batch(stmts, "write");
    console.log(`\nwrote ${stmts.length} resolved titles.`);
    const races = [...new Set(plan.map((p) => p.race))].sort();
    console.log(`re-read now, in one paced process (${races.length} races): npm run sync:general-ballot -- --race ${races.join(",")} --write`);
    return;
  }

  const control: TitleCase[] = CONTROL
    ? [{ bioguide: "CONTROL", member: "control", firstName: null, lastName: null, stored: CONTROL, resolved: null, hasRow: false, kind: "stale", race: "—", key: "__control_never_matches__", learned: "(control)" }]
    : [];

  // --replay <dir>: serve the pages a --record run kept, from inside that
  // directory, with no network and no pacing (a URL it never fetched reads as a
  // network failure, never a page).
  const replayed = REPLAY ? (JSON.parse(readFileSync(path.join(REPLAY, "index.json"), "utf8")) as { url: string; status: number | null; kind: string; file: string | null }[]) : null;
  const replayIO: IO | null = replayed
    ? {
        now: () => 0,
        sleep: async () => {},
        get: async (url) => {
          const e = replayed.find((x) => x.url === url);
          if (!e) return { kind: "network", error: `not recorded: ${url}` };
          if (e.kind !== "response" || !e.file) return e.kind === "timeout" ? { kind: "timeout" } : { kind: "network", error: "recorded without a response" };
          return { kind: "response", status: e.status ?? 0, body: gunzipSync(readFileSync(path.join(REPLAY!, path.basename(e.file)))).toString("utf8") };
        },
      }
    : null;
  const paced = pacedIO(replayIO ?? liveIO(), replayIO ? 0 : MIN_START_GAP_MS);
  let io: IO = paced.io;
  const recorded: { url: string; status: number | null; kind: string; file: string | null }[] = [];
  if (RECORD) {
    mkdirSync(RECORD, { recursive: true });
    io = {
      ...paced.io,
      get: async (url) => {
        const raw = await paced.io.get(url);
        let file: string | null = null;
        if (raw.kind === "response") {
          file = `${String(recorded.length + 1).padStart(2, "0")}.html.gz`;
          writeFileSync(path.join(RECORD, file), gzipSync(raw.body));
        }
        recorded.push({ url, status: raw.kind === "response" ? raw.status : null, kind: raw.kind, file });
        return raw;
      },
    };
  }
  const { confirmations, fetched } = await confirmCases([...cases, ...control], io, identity);
  if (RECORD) writeFileSync(path.join(RECORD, "index.json"), JSON.stringify(recorded, null, 1));

  printTable(`=== repair:ballotpedia-titles · dry${REPLAY ? ` · replaying ${REPLAY}` : ""} · ${new Date().toISOString()} · ${cases.length} cases${CONTROL ? " + 1 control" : ""} ===`, confirmations);
  const tally: Record<string, number> = {};
  for (const c of confirmations) tally[`${c.verdict}${c.signal ? `/${c.signal}` : ""}`] = (tally[`${c.verdict}${c.signal ? `/${c.signal}` : ""}`] ?? 0) + 1;
  console.log(`\nverdicts ${JSON.stringify(tally)} · requests ${paced.requests()} · minGapMs ${paced.minGapMs()} · pages ${fetched.length}`);
  if (ambiguousMoved.length) console.log(`moved rows with no unique member (not repaired): ${ambiguousMoved.map((a) => `${a.race} ${a.row} [${a.candidates.join(", ")}]`).join("; ")}`);
  const confirmed = confirmations.filter((c) => c.verdict === "confirmed" && c.signal && c.bioguide !== "CONTROL");
  const noRow = confirmed.filter((c) => !c.hasRow);
  if (noRow.length) console.log(`confirmed with no member_ids row (a minimal row is created on --write): ${noRow.map((c) => `${c.member} ${c.bioguide}`).join(", ")}`);
  if (PLAN_OUT) {
    const plan: PlanRow[] = confirmed.map((c) => ({ bioguide: c.bioguide, member: c.member, race: c.race, key: c.key, learned: c.learned, signal: c.signal!, evidence: c.evidence }));
    writeFileSync(PLAN_OUT, JSON.stringify(plan, null, 1));
    console.log(`plan: ${plan.length} confirmed rows saved to ${PLAN_OUT}`);
  }
  console.log(`\ndry: ${confirmed.length} members would be written; nothing was.`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
