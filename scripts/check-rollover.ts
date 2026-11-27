// HO 838 — the 120th-Congress rollover, the parts built before Jan 3, 2027,
// proven by setting the clock. Runs in CI with the other static checks: no
// network, no store and no secret. Case 5 runs SQL against an in-memory SQLite
// fixture.
//
// The rollover checklist (docs/backlog.md, HO 712) is dated 2027-01-03, when
// getCurrentCongress() (lib/congress.ts) returns 120 from 00:00Z. Each case
// calls the code the product runs, at set instants, and asserts:
//   1. the laws chart's pair: 119 against 118 at 2027-01-02T23:59:59Z, 120
//      against 119 at 2027-01-03T00:00:00Z and 121 against 120 at
//      2029-01-03T00:00:00Z; the table each Congress's laws come from; and the
//      week of session for a fixed enacted date in each (lib/congress.ts,
//      lawsComparisonPair, enactedLawsSource, weekOfSession);
//   2. the vote syncs' tail (backlog line 71): previousCongressTail is null at
//      2027-01-02T23:59:00Z, { 119, 2 } from 2027-01-03T00:00:00Z through
//      2027-01-09T23:59:59.999Z, and null from 2027-01-10T00:00:00Z;
//   3. Puerto Rico's resident commissioner (the HO 838 ruling 1): a 2025 start
//      gives 2029 / 2028, and so does a 2027 start, as a per-Congress split
//      would read it; a delegate and a state's representative are unchanged
//      (lib/derive-term.ts, houseTermEndForState);
//   4. the hub's election cell (the HO 838 ruling 2): the cycle year is 2026 at
//      2027-01-02T23:59:59Z and 2027 at 2027-01-03T00:00:00Z; a current member
//      with 2026 doesn't read Former member at 2027-01-01 or at 2027-01-03, and
//      a member who isn't current does at 2027-01-03 (lib/congress.ts,
//      cycleYear, electionCellFor);
//   5. the ideology strip and the polarization band (the HO 838 ruling 4): over
//      rows at 119 and 120 they read the 120 rows, and over rows all at 119
//      they read all of them (lib/congress.ts, SCORES_CONGRESS_SQL).
//
// THE CONTROLS (HO 838, guard 5: a clock-set case proves a boundary only if
// the old code fails it). Each case is also run against the code it replaces,
// copied below from 0aec365 (HO 837's head): case 1 against the laws reader's
// shape (the `118 | 119` pair, CONGRESS_START, the two literal tables), case 2
// against no helper (the route synced only the current Congress), case 3
// against houseTermEnd, case 4 against the hub's calendar-year comparison, and
// case 5 against the unfiltered queries. The check is red unless every case
// holds on the code AND fails on its old counterpart, so a control that stops
// firing turns CI red too.
//
//   npm run check:rollover
import { createClient } from "@libsql/client";
import {
  cycleYear,
  electionCellFor,
  enactedLawsSource,
  getCurrentCongress,
  lawsComparisonPair,
  ordinal,
  previousCongressTail,
  SCORES_CONGRESS_SQL,
  weekOfSession,
} from "../lib/congress";
import { houseNextElection, houseTermEnd, houseTermEndForState } from "../lib/derive-term";
import { daysToElection } from "../lib/format";

const at = (iso: string) => new Date(iso);
const show = (v: unknown) => (v === undefined ? "undefined" : JSON.stringify(v));
type Check = { what: string; want: unknown; got: unknown; old: unknown };
type Case = { name: string; checks: Check[] };
const cases: Case[] = [];

// ── The old code, from 0aec365 ──────────────────────────────────────────────
// lib/queries.ts:1053-1123: the pair was the type `118 | 119`, each start came
// from CONGRESS_START, and the two reads named their tables literally.
const OLD_CONGRESS_START: Record<number, string> = { 118: "2023-01-03", 119: "2025-01-03" };
const OLD_SOURCE: Record<number, string> = { 118: "historical_laws", 119: "bills" };
const oldPair = (_now: Date) => ({ current: 119, previous: 118 });
const oldWeek = (day: string, congress: number) => {
  const start = Date.parse(`${OLD_CONGRESS_START[congress]}T00:00:00Z`);
  const t = Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
  const w = Math.max(0, Math.floor((t - start) / (7 * 86_400_000)));
  return Number.isNaN(w) ? null : w;
};
// app/api/sync-votes/route.ts: no tail; each chamber synced getCurrentCongress() alone.
const oldTail = (_now: Date) => null;
// app/members/[bioguideId]/page.tsx:241-246 and :427: the calendar year.
const oldCycleYear = (d: Date) => d.getUTCFullYear();
const oldElectionCell = (year: number, _isCurrent: boolean, nowMs: number) => {
  const currentYear = new Date(nowMs).getUTCFullYear();
  if (year === currentYear && daysToElection(year, nowMs) < 0) return "result";
  return year >= currentYear ? "next" : "former";
};

// ── 1. The laws pair ────────────────────────────────────────────────────────
{
  const checks: Check[] = [];
  for (const [iso, cur, prev] of [
    ["2027-01-02T23:59:59Z", 119, 118],
    ["2027-01-03T00:00:00Z", 120, 119],
    ["2029-01-03T00:00:00Z", 121, 120],
  ] as const) {
    checks.push({ what: `getCurrentCongress at ${iso}`, want: cur, got: getCurrentCongress(at(iso)), old: getCurrentCongress(at(iso)) });
    checks.push({ what: `the pair at ${iso}`, want: { current: cur, previous: prev }, got: lawsComparisonPair(at(iso)), old: oldPair(at(iso)) });
  }
  for (const [c, src] of [[118, "historical_laws"], [119, "bills"], [120, "bills"], [121, "bills"]] as const) {
    checks.push({ what: `the source for the ${ordinal(c)}`, want: src, got: enactedLawsSource(c), old: OLD_SOURCE[c] ?? null });
  }
  for (const [day, c, w] of [
    ["2023-01-10", 118, 1],
    ["2025-03-14", 119, 10],
    ["2027-01-17", 120, 2],
    ["2029-02-01", 121, 4],
  ] as const) {
    checks.push({ what: `the week of ${day} in the ${ordinal(c)}`, want: w, got: weekOfSession(day, c), old: oldWeek(day, c) });
  }
  cases.push({ name: "1. the laws chart's pair, source and week of session", checks });
}

// ── 2. The vote syncs' tail ─────────────────────────────────────────────────
// The window is [2027-01-03T00:00:00Z, 2027-01-10T00:00:00Z): it opens at the
// switch and closes at the instant seven days on, when getCurrentCongress of
// the instant seven days back is the 120th's too.
{
  const T = { congress: 119, session: 2 };
  const checks: Check[] = [];
  for (const [iso, want] of [
    ["2027-01-02T23:59:00Z", null],
    ["2027-01-03T00:00:00Z", T],
    ["2027-01-09T23:59:00Z", T],
    ["2027-01-09T23:59:59.999Z", T],
    ["2027-01-10T00:00:00Z", null],
  ] as const) {
    checks.push({ what: `the tail at ${iso}`, want, got: previousCongressTail(at(iso)), old: oldTail(at(iso)) });
  }
  cases.push({ name: "2. the vote syncs' tail of 119/2, seven days after the switch", checks });
}

// ── 3. The resident commissioner ────────────────────────────────────────────
// The old code is houseTermEnd for every state. It reads a 2027 start right
// (2029, the coincidence that the 120th is the four-year term's second
// Congress) and the 2025 and 2029 starts wrong.
{
  const pair = (end: number) => ({ end, next: houseNextElection(end) });
  const checks: Check[] = [];
  for (const [who, state, start, end] of [
    ["PR (the resident commissioner), 2025 start", "PR", 2025, 2029],
    ["PR, 2027 start (a per-Congress split)", "PR", 2027, 2029],
    ["PR, 2029 start", "PR", 2029, 2033],
    ["GU (a delegate), 2025 start", "GU", 2025, 2027],
    ["DC (a delegate), 2025 start", "DC", 2025, 2027],
    ["TX (a state's representative), 2025 start", "TX", 2025, 2027],
    ["TX, 2026 start (a special election)", "TX", 2026, 2027],
  ] as const) {
    checks.push({ what: who, want: pair(end), got: pair(houseTermEndForState(state, start)), old: pair(houseTermEnd(start)) });
  }
  cases.push({ name: "3. Puerto Rico's resident commissioner serves four years; nobody else moves", checks });
}

// ── 4. The hub's election cell ──────────────────────────────────────────────
{
  const ms = (iso: string) => Date.parse(iso);
  const checks: Check[] = [];
  for (const [iso, y] of [["2027-01-02T23:59:59Z", 2026], ["2027-01-03T00:00:00Z", 2027]] as const) {
    checks.push({ what: `the cycle year at ${iso}`, want: y, got: cycleYear(at(iso)), old: oldCycleYear(at(iso)) });
  }
  for (const [what, year, cur, iso, want] of [
    ["a current member with 2026, at 2027-01-01T12:00Z", 2026, true, "2027-01-01T12:00:00Z", "result"],
    ["a current member with 2026, at 2027-01-03T00:00Z", 2026, true, "2027-01-03T00:00:00Z", "result"],
    ["a member who isn't current, with 2026, at 2027-01-03T00:00Z", 2026, false, "2027-01-03T00:00:00Z", "former"],
    ["today: a current member with 2026, at 2026-11-27", 2026, true, "2026-11-27T12:00:00Z", "result"],
    ["today: a current member with 2028, at 2026-11-27", 2028, true, "2026-11-27T12:00:00Z", "next"],
    ["a current member with 2028, at 2027-01-03T00:00Z", 2028, true, "2027-01-03T00:00:00Z", "next"],
  ] as const) {
    checks.push({ what, want, got: electionCellFor(year, cur, ms(iso)), old: oldElectionCell(year, cur, ms(iso)) });
  }
  cases.push({ name: "4. the hub's election cell reads the cycle year, and Former member only off the roster", checks });
}

// ── 5. The ideology strip and the band ──────────────────────────────────────
// The two statements' FROM, JOIN and WHERE as lib/queries.ts runs them, each
// selecting only the bioguide id, with and without the shared condition
// (without it, they're 0aec365's). This proves the condition's rows in SQLite.
// It doesn't read lib/queries.ts, so it can't see the condition dropped from
// there: HO 838's guarded read compared the product statements on prod
// (store-838d.log), base against tip, the same rows in the same order.
const STRIP = `SELECT mi.bioguide_id AS bioguideId
                 FROM member_ideology mi
                 JOIN members m ON m.bioguide_id = mi.bioguide_id
                WHERE mi.nominate_dim1 IS NOT NULL`;
const BAND = `SELECT mi.bioguide_id AS bioguideId
                FROM member_ideology mi
                JOIN members m ON m.bioguide_id = mi.bioguide_id`;
{
  const db = createClient({ url: ":memory:" });
  await db.batch(
    [
      "CREATE TABLE members (bioguide_id TEXT PRIMARY KEY, name TEXT, party TEXT, chamber TEXT, is_current INTEGER)",
      "CREATE TABLE member_ideology (bioguide_id TEXT PRIMARY KEY, congress INTEGER NOT NULL, chamber TEXT, nominate_dim1 REAL)",
    ],
    "write",
  );
  const ids = async (sql: string) =>
    (await db.execute(`${sql} ORDER BY mi.bioguide_id`)).rows.map((r) => String(r.bioguideId));
  const load = async (rows: Array<[string, number, number]>) => {
    await db.batch(["DELETE FROM member_ideology", "DELETE FROM members"], "write");
    for (const [id, congress, cur] of rows) {
      await db.execute({ sql: "INSERT INTO members VALUES (?, ?, 'D', 'house', ?)", args: [id, id, cur] });
      await db.execute({ sql: "INSERT INTO member_ideology VALUES (?, ?, 'House', -0.4)", args: [id, congress] });
    }
  };
  const checks: Check[] = [];
  // After HS120 lands: two sitting members moved to 120, one departed member left at 119.
  await load([["A000001", 120, 1], ["B000002", 120, 1], ["C000003", 119, 0]]);
  for (const [name, sql] of [["strip", STRIP], ["band", BAND]] as const) {
    const filtered = name === "strip" ? `${sql} AND ${SCORES_CONGRESS_SQL}` : `${sql} WHERE ${SCORES_CONGRESS_SQL}`;
    checks.push({ what: `the ${name} over rows at 119 and 120`, want: ["A000001", "B000002"], got: await ids(filtered), old: await ids(sql) });
  }
  // Today: every row the 119th's, one of them departed.
  await load([["A000001", 119, 1], ["B000002", 119, 1], ["C000003", 119, 0]]);
  for (const [name, sql] of [["strip", STRIP], ["band", BAND]] as const) {
    const filtered = name === "strip" ? `${sql} AND ${SCORES_CONGRESS_SQL}` : `${sql} WHERE ${SCORES_CONGRESS_SQL}`;
    checks.push({ what: `the ${name} over rows all at 119`, want: ["A000001", "B000002", "C000003"], got: await ids(filtered), old: await ids(sql) });
  }
  db.close();
  cases.push({ name: "5. the strip and the band read the scores' Congress only", checks });
}

// ── Report ──────────────────────────────────────────────────────────────────
let red = 0;
const eq = (a: unknown, b: unknown) => show(a) === show(b);
for (const c of cases) {
  const failing = c.checks.filter((k) => !eq(k.got, k.want));
  const oldFailing = c.checks.filter((k) => !eq(k.old, k.want));
  const holds = failing.length === 0;
  const controlFires = oldFailing.length > 0;
  if (!holds || !controlFires) red++;
  console.log(`${holds && controlFires ? "ok  " : "RED "} ${c.name}`);
  for (const k of c.checks) {
    const mark = eq(k.got, k.want) ? "ok " : "RED";
    const oldMark = eq(k.old, k.want) ? "old reads it too" : `old reads ${show(k.old)}`;
    console.log(`       ${mark} ${k.what}: ${show(k.got)}${eq(k.got, k.want) ? "" : ` (want ${show(k.want)})`} · ${oldMark}`);
  }
  console.log(`       control: the old code fails ${oldFailing.length} of ${c.checks.length}${controlFires ? "" : " — RED, the case can't tell the old code from the new"}`);
}
console.log(red ? `${red} of ${cases.length} red` : `OK, ${cases.length} cases, every control firing`);
process.exit(red ? 1 : 0);
