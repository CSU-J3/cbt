// HO 776 — Alabama's four rerun districts. AL-01, 02, 06 and 07 store their
// August 11 primaries, the contests that chose their nominees.
//
//   npx tsx scripts/repair-al-special-primaries-776.ts --plan-out <file>       # dry: read, compare, print and save the plan
//   npx tsx scripts/repair-al-special-primaries-776.ts --write --plan <file>   # back up to <plan's dir>/before.json, then write exactly the plan
//
// WHY. Alabama voided four districts' May 19 primaries, and the special
// primaries on August 11 chose their nominees. Each page says so: "The winners
// of the special primary on August 11, 2026, advanced to the general election
// on November 3, 2026. The winners of the primaries originally scheduled for
// May 19, 2026, did not advance as those results were voided." The pages don't
// mark the reruns special. A rerun's box reads like any primary's ("Republican
// primary for U.S. House Alabama District 1"), and only its results line's date
// ("… on August 11, 2026.") tells it from the voided round's, which the page
// prints under "Primary held May 19". So the House cursor can't tell a rerun
// from the round it replaces: parseCandidatesPage's dedup folds a party's two
// boxes by name (lib/primary-candidates-scrape.ts:436), and the sync takes the
// party's rows whole (lib/primaries-sync.ts:1873). This picks each party's
// rerun by its date, once. Every row it writes is dated 2026-08-11, past-dated
// and past the settle window, so isSettled (lib/primaries-sync.ts:1842) freezes
// it and no later tick rewrites it.
//
// WHAT (HO 776's STEP 0 ruling). Every base row house-AL-{01,02,06,07}-2026-{D,R}
// takes primary_date 2026-08-11 and runoff_date NULL, since no runoff was
// scheduled for the reruns. AL-01-R and AL-06-R held the voided round and take
// their August boxes' rosters, bioguide_id NULL (repair:primary-identity ties
// them). AL-02-R, AL-06-D and AL-07-R already held August's rosters and keep
// them; the dry run proves each equals its box (names, marks, shares, person
// keys). AL-01, 02 and 07's D primaries were uncontested: no box in either
// round, and no roster. Any other shape is refused, and no plan is saved.
//
// It reads only HO 747's saved pages and the store; nothing is fetched. --write
// refuses a plan whose rows have changed since it was read, by updated_at (the
// row's, and its candidates' latest), and writes in one batch whose every
// statement is guarded by the row's planned updated_at.
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db";
import { isoFromLongDate, parseCandidatesPage, stripTags, type CandidateContest, type ScrapedCandidate } from "../lib/primary-candidates-scrape";
import { readSaved, SAVED_PAGES_DIR, savedPageIndex } from "../lib/primary-identity-repair";

const RERUN_DATE = "2026-08-11";
const STATE = "AL";
const DISTRICTS = ["01", "02", "06", "07"];
const PARTIES = ["D", "R"] as const;
type Action = "replace" | "keep" | "none";
// The ruling's shape: "replace" (the store held the voided round), "keep" (it
// already held the rerun's roster), "none" (an uncontested primary). The plan is
// derived from the pages and the store, then held to this.
const EXPECTED: Record<string, Action> = {
  "house-AL-01-2026-D": "none",
  "house-AL-01-2026-R": "replace",
  "house-AL-02-2026-D": "none",
  "house-AL-02-2026-R": "keep",
  "house-AL-06-2026-D": "keep",
  "house-AL-06-2026-R": "replace",
  "house-AL-07-2026-D": "none",
  "house-AL-07-2026-R": "keep",
};

const argv = process.argv.slice(2);
const val = (f: string): string | null => {
  const i = argv.indexOf(f);
  return i < 0 ? null : (argv[i + 1] ?? null);
};
const WRITE = argv.includes("--write");
const PLAN = val("--plan");
const PLAN_OUT = val("--plan-out");
if (WRITE && !PLAN) throw new Error("--write needs --plan <file>: the plan a dry run saved with --plan-out");
if (!WRITE && !PLAN_OUT) throw new Error("a dry run needs --plan-out <file>");
if (WRITE && PLAN_OUT) throw new Error("--write takes only --plan");

type PlanCandidate = { name: string; party: string; incumbent: number; status: "winner" | "running"; vote_pct: number | null; person_key: string | null };
type PlanRow = {
  id: string;
  action: Action;
  box: { h5: string; date: string } | null;
  from: { primary_date: string | null; runoff_date: string | null; updated_at: string; candidates: number; candidates_updated_at: string | null };
  to: { primary_date: string; runoff_date: null };
  roster: PlanCandidate[] | null; // the replacement roster, for "replace" only
};
type Plan = { at: string; pages: Record<string, string>; rows: PlanRow[] };

// A page's first-round primary boxes, split the way parseCandidatesPage splits
// them (lib/primary-candidates-scrape.ts:328-377: the candidates section to the
// next <h2>, one box per race_header, its contest from the class, a primary's
// <h5>), each with its own date, read the way the runoff branch reads a box's
// (:413-415: the results_text line, then isoFromLongDate).
type Box = { contest: CandidateContest; h5: string; date: string | null; slice: string };
function primaryBoxes(html: string): Box[] {
  const anchor = html.indexOf('id="Candidates_and_election_results"');
  if (anchor === -1) return [];
  const nextH2 = html.indexOf("<h2", anchor + 10);
  const section = html.slice(anchor, nextH2 === -1 ? anchor + 80000 : nextH2);
  const headers = [...section.matchAll(/<div class="race_header([^"]*)">/g)];
  const out: Box[] = [];
  headers.forEach((h, i) => {
    const cls = h[1] ?? "";
    const start = h.index ?? 0;
    const end = i + 1 < headers.length ? (headers[i + 1]!.index ?? section.length) : section.length;
    const slice = section.slice(start, end);
    const h5 = stripTags(slice.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] ?? "");
    let contest: CandidateContest | null = cls.includes("democratic") ? "D" : cls.includes("republican") ? "R" : cls.includes("nonpartisan") ? "open" : null;
    if (!contest && /nonpartisan/i.test(h5)) contest = "open";
    if (!contest || !/primary/i.test(h5) || /runoff/i.test(h5)) return;
    const line = stripTags(slice.match(/<p class="results_text">([\s\S]*?)<\/p>/)?.[1] ?? "");
    const on = line.match(/\bon ([A-Z][a-z]+) (\d{1,2}), (\d{4})\b/);
    const date = on ? isoFromLongDate(on[1]!, on[2]!, on[3]!) : null;
    out.push({ contest, h5, date, slice });
  });
  return out;
}

// One box parsed alone, by parseCandidatesPage itself, so its marks, shares and
// person keys are its own and not folded into another box's.
function parseBox(box: Box, file: string): ScrapedCandidate[] {
  if (box.slice.length >= 80000) throw new Error(`${file}: a box of ${box.slice.length} chars would be cut at parseCandidatesPage's 80,000`);
  const one = parseCandidatesPage(`<span id="Candidates_and_election_results"></span>${box.slice}`, STATE, file);
  if (one.status !== "ok" || one.candidates.some((c) => c.contest !== box.contest)) throw new Error(`${file}: "${box.h5}" parsed alone reads ${one.status}`);
  return one.candidates;
}

type StoredCandidate = { name: string; party: string | null; incumbent: number; status: string; vote_pct: number | null; person_key: string | null; bioguide_id: string | null; updated_at: string | null };
// Rows as plain objects keyed by column name, for the comparison and the backup.
const objects = (rs: { columns: string[]; rows: ArrayLike<unknown>[] }) =>
  rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i] ?? null])));
async function readStored(db: ReturnType<typeof getDb>, id: string) {
  const row = objects(await db.execute({ sql: "SELECT * FROM primaries WHERE id = ?", args: [id] }))[0] ?? null;
  const cands = objects(
    await db.execute({ sql: "SELECT * FROM primary_candidates WHERE primary_id = ? ORDER BY id", args: [id] }),
  ) as unknown as (StoredCandidate & { id: number; primary_id: string })[];
  return { row, cands };
}
const maxAt = (cs: { updated_at: string | null }[]) => cs.reduce<string | null>((m, c) => (c.updated_at && (!m || c.updated_at > m) ? c.updated_at : m), null);
const fmt = (c: { name: string; status: string; vote_pct: number | null; person_key: string | null }) =>
  `${c.name} ${c.status === "winner" ? "✔" : "·"} ${c.vote_pct == null ? "—" : c.vote_pct} [${c.person_key ?? "no key"}]`;

// Derive the plan from the pages and the store; every refusal is collected and
// none of it is saved or written while one stands.
async function derive(db: ReturnType<typeof getDb>): Promise<{ plan: Plan; refusals: string[] }> {
  const refusals: string[] = [];
  const index = savedPageIndex(SAVED_PAGES_DIR);
  const pages: Record<string, string> = {};
  const rows: PlanRow[] = [];
  // Every stored row of the four districts must be one of the eight base rows:
  // no runoff row and no special row, so the plan writes and deletes nothing else.
  for (const dd of DISTRICTS) {
    const ids = (await db.execute({ sql: "SELECT id FROM primaries WHERE id LIKE ? ORDER BY id", args: [`house-${STATE}-${dd}-2026%`] })).rows.map((r) => String(r.id));
    const extra = ids.filter((id) => !(id in EXPECTED));
    if (extra.length) refusals.push(`${STATE}-${dd}: stored rows beyond the base two: ${extra.join(", ")}`);
  }
  for (const dd of DISTRICTS) {
    const raceId = `${STATE}-${dd}-2026`;
    const file = index.get(raceId);
    if (!file) {
      refusals.push(`${raceId}: no saved page`);
      continue;
    }
    pages[raceId] = file;
    const boxes = primaryBoxes(readSaved(file));
    console.log(`\n${raceId} · ${file}`);
    for (const b of boxes) console.log(`  box ${b.contest} · ${b.date ?? "(no date)"} · "${b.h5}"`);
    for (const party of PARTIES) {
      const id = `house-${STATE}-${dd}-2026-${party}`;
      const want = EXPECTED[id]!;
      const mine = boxes.filter((b) => b.contest === party);
      const rerun = mine.filter((b) => b.date === RERUN_DATE);
      const { row, cands } = await readStored(db, id);
      if (!row) {
        refusals.push(`${id}: no stored row`);
        continue;
      }
      const from = {
        primary_date: (row.primary_date as string | null) ?? null,
        runoff_date: (row.runoff_date as string | null) ?? null,
        updated_at: String(row.updated_at),
        candidates: cands.length,
        candidates_updated_at: maxAt(cands),
      };
      const base = { id, from, to: { primary_date: RERUN_DATE, runoff_date: null } as const };
      if (want === "none") {
        // Uncontested: no box for this party in either round, and no roster.
        if (mine.length) refusals.push(`${id}: an uncontested primary shows ${mine.length} box(es): ${mine.map((b) => b.date ?? "?").join(", ")}`);
        if (cands.length) refusals.push(`${id}: an uncontested primary stores ${cands.length} candidates`);
        console.log(`  ${id}: none · no box in either round, no roster · ${from.primary_date} → ${RERUN_DATE}, runoff ${from.runoff_date} → NULL`);
        rows.push({ ...base, action: "none", box: null, roster: null });
        continue;
      }
      if (rerun.length !== 1) {
        refusals.push(`${id}: ${rerun.length} boxes dated ${RERUN_DATE} (of ${mine.length} for ${party})`);
        continue;
      }
      const box = rerun[0]!;
      const parsed = parseBox(box, file).map((c) => ({
        name: c.name,
        party: c.party,
        incumbent: c.incumbent ? 1 : 0,
        status: (c.isWinner ? "winner" : "running") as PlanCandidate["status"],
        vote_pct: c.votePct,
        person_key: c.personKey,
      }));
      // The stored roster against the box: names, marks, shares and person keys.
      const byName = new Map(cands.map((c) => [c.name, c]));
      const diffs: string[] = [];
      if (cands.length !== parsed.length) diffs.push(`${cands.length} stored vs ${parsed.length} printed`);
      for (const p of parsed) {
        const s = byName.get(p.name);
        if (!s) {
          diffs.push(`${p.name} not stored`);
          continue;
        }
        if (s.status !== p.status) diffs.push(`${p.name} ${s.status} vs ${p.status}`);
        if ((s.vote_pct ?? null) !== p.vote_pct) diffs.push(`${p.name} ${s.vote_pct} vs ${p.vote_pct}`);
        if ((s.person_key ?? null) !== p.person_key) diffs.push(`${p.name} key ${s.person_key} vs ${p.person_key}`);
      }
      const action: Action = diffs.length ? "replace" : "keep";
      console.log(`  ${id}: ${action} · the ${RERUN_DATE} box: ${parsed.map(fmt).join(", ")}`);
      if (diffs.length) console.log(`      stored (${cands.length}): ${cands.map(fmt).join(", ")}`);
      if (diffs.length) console.log(`      differs: ${diffs.join("; ")}`);
      const others = mine.filter((b) => b !== box);
      for (const o of others) console.log(`      also printed for ${party}: a box dated ${o.date ?? "(none)"}: ${parseBox(o, file).map((c) => `${c.name} ${c.isWinner ? "✔" : "·"} ${c.votePct ?? "—"}`).join(", ")}`);
      if (action !== want) refusals.push(`${id}: the ruling has it ${want}, the pages and the store make it ${action}${diffs.length ? ` (${diffs.join("; ")})` : ""}`);
      rows.push({ ...base, action, box: { h5: box.h5, date: box.date! }, roster: action === "replace" ? parsed : null });
    }
  }
  return { plan: { at: new Date().toISOString(), pages, rows }, refusals };
}

// The plan's meaning, without its timestamp: two derivations agree on this.
const shape = (p: Plan) => JSON.stringify(p.rows.map((r) => ({ id: r.id, action: r.action, box: r.box, from: r.from, roster: r.roster })));

async function main() {
  const db = getDb();
  console.log(`=== repair-al-special-primaries-776 · ${WRITE ? `WRITE from ${PLAN}` : "dry"} · ${new Date().toISOString()} ===`);
  const { plan, refusals } = await derive(db);
  if (refusals.length) {
    console.log(`\nREFUSED, nothing ${WRITE ? "written" : "saved"}:\n  ${refusals.join("\n  ")}`);
    process.exitCode = 1;
    return;
  }
  const tally = (a: Action) => plan.rows.filter((r) => r.action === a).map((r) => r.id).join(", ");
  console.log(`\nplan: ${plan.rows.length} base rows to ${RERUN_DATE}, runoff_date NULL · replace ${tally("replace")} · keep ${tally("keep")} · none ${tally("none")} · no runoff row, no delete`);

  if (!WRITE) {
    writeFileSync(PLAN_OUT!, JSON.stringify(plan, null, 1));
    console.log(`plan saved to ${PLAN_OUT}\n\ndry: nothing was written.`);
    return;
  }

  const saved = JSON.parse(readFileSync(PLAN!, "utf8")) as Plan;
  if (shape(saved) !== shape(plan)) throw new Error("refused: the plan no longer matches the pages and the store (a row, its roster or its updated_at changed); nothing was written");
  const dir = path.dirname(PLAN!);
  const backup = path.join(dir, "before.json");
  if (existsSync(backup)) throw new Error(`refused: ${backup} exists; a backup is never overwritten`);
  const before = [];
  for (const r of saved.rows) before.push({ id: r.id, ...(await readStored(db, r.id)) });
  writeFileSync(backup, JSON.stringify({ at: new Date().toISOString(), rows: before }, null, 1));
  console.log(`backup: ${before.length} rows and ${before.reduce((n, b) => n + b.cands.length, 0)} candidates to ${backup}`);

  const now = new Date().toISOString();
  const guard = "EXISTS (SELECT 1 FROM primaries WHERE id = ? AND updated_at = ?)";
  const stmts: { sql: string; args: (string | number | null)[]; what: string; expect: number }[] = [];
  for (const r of saved.rows) {
    if (r.action === "replace") {
      stmts.push({
        sql: `DELETE FROM primary_candidates WHERE primary_id = ? AND ${guard}`,
        args: [r.id, r.id, r.from.updated_at],
        what: `${r.id} roster delete`,
        expect: r.from.candidates,
      });
      for (const c of r.roster!) {
        stmts.push({
          sql: `INSERT INTO primary_candidates (primary_id, name, party, incumbent, bioguide_id, status, vote_pct, updated_at, person_key)
                SELECT ?, ?, ?, ?, NULL, ?, ?, ?, ? WHERE ${guard}`,
          args: [r.id, c.name, c.party, c.incumbent, c.status, c.vote_pct, now, c.person_key, r.id, r.from.updated_at],
          what: `${r.id} + ${c.name}`,
          expect: 1,
        });
      }
    }
    // The row last, so the guards above read its planned updated_at.
    stmts.push({
      sql: "UPDATE primaries SET primary_date = ?, runoff_date = NULL, updated_at = ? WHERE id = ? AND updated_at = ?",
      args: [RERUN_DATE, now, r.id, r.from.updated_at],
      what: `${r.id} dates`,
      expect: 1,
    });
  }
  const results = await db.batch(stmts.map(({ sql, args }) => ({ sql, args })), "write");
  const off = stmts.map((s, i) => ({ s, n: results[i]?.rowsAffected ?? -1 })).filter(({ s, n }) => n !== s.expect);
  console.log(`\nwrote one batch of ${stmts.length} statements at ${now}${off.length ? ` · UNEXPECTED rowsAffected: ${off.map(({ s, n }) => `${s.what} ${n} (expected ${s.expect})`).join(", ")}` : " · every statement affected the rows it was planned to"}`);
  if (off.length) process.exitCode = 1;

  console.log("\nread back:");
  for (const r of saved.rows) {
    const { row, cands } = await readStored(db, r.id);
    console.log(`  ${r.id}: ${row?.primary_date} · runoff ${row?.runoff_date ?? "NULL"} · ${row?.updated_at} · ${cands.length} candidates${cands.length ? `: ${cands.map((c) => `${c.name} ${c.status === "winner" ? "✔" : "·"} ${c.vote_pct ?? "—"} [${c.person_key ?? "no key"}] ${c.bioguide_id ?? "NULL"}`).join(", ")}` : ""}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
