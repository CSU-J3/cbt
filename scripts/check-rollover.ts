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
// HO 839 added (838-ff-go.md rulings 2 and 5):
//   6. the tail's window as an argument: previousCongressTail(now, 21), the
//      bills sync's, is { 119, 2 } through 2027-01-23T23:59:59.999Z and null
//      from 2027-01-24T00:00:00Z; with 7 days it reads as case 2;
//   7. the lobbying sync's filing years (lobbyingFilingYears): [2025, 2026]
//      today and through 2027-01-02, [2026, 2027, 2028] from
//      2027-01-03T00:00:00Z through 2027-02-15T23:59:59Z (Feb 15 inclusive, to
//      the end of the day UTC), and [2027, 2028] from 2027-02-16T00:00:00Z;
//   8. the bills tail's start frontier (billsTailStart): the lower of the
//      stored frontier and the switch less 48 hours, for a frontier before the
//      switch, one stuck days before it, and one already past it;
//   9. the label helpers for scope-table rows 5 to 9 (polarizationAxis,
//      productivityHeading): scores' Congress 119 gives GAP · 119TH, a line
//      ending at 118, a dot at 2025 and "the 118th"; 120 gives GAP · 120TH,
//      119, 2027 and "the 119th".
// HO 840 added:
//  10. the lobbying request (lib/lda-sync.ts, ldaPostedAfter): a frontier of
//      2026-10-20T14:32:07Z gives filing_dt_posted_after 2026-10-20T14:31:07Z,
//      with its Z, since lda.gov reads a timestamp without one as Eastern time
//      (HO 840 STEP 0, claim 5); the stored frontier's −04:00 form gives the
//      same instant in UTC; nothing stored gives no filter. And its dedup
//      (ldaAlreadyStored): a filing at the frontier's own second is new unless
//      its uuid is stored there (STEP 0's 11:23:18 pair);
//  11. the bills tail's daily look-back (lib/congress.ts,
//      billsTailLookBackDue): due once a UTC day inside the 21 days, not again
//      the same day, and never before the switch or from
//      2027-01-24T00:00:00Z;
//  12. the amendments tail (lib/amendments-sync.ts, amendmentsTail):
//      { 119, 2 } from 2027-01-03T00:00:00Z through 2027-01-09T23:59:59.999Z,
//      null from 2027-01-10T00:00:00Z and before the switch.
//
// THE CONTROLS (HO 838, guard 5: a clock-set case proves a boundary only if
// the old code fails it). Each case is also run against the code it replaces,
// copied below from 0aec365 (HO 837's head): case 1 against the laws reader's
// shape (the `118 | 119` pair, CONGRESS_START, the two literal tables), case 2
// against no helper (the route synced only the current Congress), case 3
// against houseTermEnd, case 4 against the hub's calendar-year comparison, and
// case 5 against the unfiltered queries; and (HO 839) case 6 against HO 838's
// fixed 7-day helper, case 7 against the years derived from the congress
// alone, case 8 against no tail (the bills sync listed the current Congress
// only), and case 9 against the constants (GAP · 119TH, 118, 2025 and the
// 118th heading); and (HO 840) case 10 against 4a5c283's day-before date and
// its `dtMs <= skipMs`, case 11 against no look-back (the tail kept only its
// own frontier), and case 12 against no tail (the amendments sync listed the
// current Congress only). The check is red unless every case
// holds on the code AND fails on its old counterpart, so a control that stops
// firing turns CI red too.
//
//   npm run check:rollover
import { createClient } from "@libsql/client";
import { amendmentsTail } from "../lib/amendments-sync";
import {
  billsTailLookBackDue,
  billsTailStart,
  congressTermDates,
  cycleYear,
  electionCellFor,
  enactedLawsSource,
  getCurrentCongress,
  lawsComparisonPair,
  lobbyingFilingYears,
  ordinal,
  polarizationAxis,
  previousCongressTail,
  productivityHeading,
  SCORES_CONGRESS_SQL,
  weekOfSession,
} from "../lib/congress";
import { houseNextElection, houseTermEnd, houseTermEndForState } from "../lib/derive-term";
import { daysToElection } from "../lib/format";
import { ldaAlreadyStored, ldaPostedAfter } from "../lib/lda-sync";

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

// ── The old code HO 839 replaced, from 01e515c ──────────────────────────────
// lib/congress.ts: HO 838's previousCongressTail, the window fixed at 7 days.
const oldTail7 = (now: Date) => {
  const current = getCurrentCongress(now);
  if (getCurrentCongress(new Date(now.getTime() - 7 * 86_400_000)) === current) return null;
  return { congress: current - 1, session: 2 };
};
// lib/lda-sync.ts:427-430: the years from the congress alone.
const oldLobbyingYears = (now: Date) => {
  const firstYear = 2025 + (getCurrentCongress(now) - 119) * 2;
  return [firstYear, firstYear + 1];
};
// lib/sync.ts: no tail; the listing named getCurrentCongress() alone.
const oldBillsTailStart = (_frontier: string, _switchMs: number): string | null => null;
// components/PolarizationOverTime.tsx:30-37 and :258, app/reports/page.tsx:69: constants.
const oldAxis = (_scores: number) => ({ gapLabel: "GAP · 119TH", lineEndCongress: 118, dotYear: 2025 });
const oldHeading = (_previous: number) => "Productivity vs. the 118th";

// ── 6. The tail's window ────────────────────────────────────────────────────
// [2027-01-03T00:00:00Z, 2027-01-24T00:00:00Z) for 21 days; the 7-day window
// is case 2's.
{
  const T = { congress: 119, session: 2 };
  const checks: Check[] = [];
  for (const [iso, days, want] of [
    ["2027-01-02T23:59:59Z", 21, null],
    ["2027-01-03T00:00:00Z", 21, T],
    ["2027-01-10T00:00:00Z", 21, T],
    ["2027-01-23T23:59:00Z", 21, T],
    ["2027-01-23T23:59:59.999Z", 21, T],
    ["2027-01-24T00:00:00Z", 21, null],
    ["2027-01-09T23:59:59.999Z", 7, T],
    ["2027-01-10T00:00:00Z", 7, null],
  ] as const) {
    checks.push({ what: `the ${days}-day tail at ${iso}`, want, got: previousCongressTail(at(iso), days), old: oldTail7(at(iso)) });
  }
  cases.push({ name: "6. the tail's window is an argument: 21 days for the bills sync, 7 for the votes and nominations", checks });
}

// ── 7. The lobbying sync's filing years ─────────────────────────────────────
{
  const checks: Check[] = [];
  for (const [iso, want] of [
    ["2026-11-27T12:00:00Z", [2025, 2026]],
    ["2027-01-02T23:59:59Z", [2025, 2026]],
    ["2027-01-03T00:00:00Z", [2026, 2027, 2028]],
    ["2027-02-15T23:59:00Z", [2026, 2027, 2028]],
    ["2027-02-15T23:59:59.999Z", [2026, 2027, 2028]],
    ["2027-02-16T00:00:00Z", [2027, 2028]],
    ["2029-01-03T00:00:00Z", [2028, 2029, 2030]],
  ] as const) {
    checks.push({ what: `the filing years at ${iso}`, want, got: lobbyingFilingYears(at(iso)).years, old: oldLobbyingYears(at(iso)) });
  }
  cases.push({ name: "7. the lobbying sync keeps the previous filing year through Feb 15", checks });
}

// ── 8. The bills tail's start frontier ──────────────────────────────────────
{
  const sw = congressTermDates(120).start.getTime(); // 2027-01-03T00:00:00Z
  const checks: Check[] = [];
  for (const [what, frontier, want] of [
    ["a frontier six hours before the switch", "2027-01-02T18:00:00Z", "2027-01-01T00:00:00Z"],
    ["a frontier stuck three days before it", "2026-12-31T00:00:00Z", "2026-12-31T00:00:00Z"],
    ["a frontier already past it (the tail's first tick came late)", "2027-01-05T06:00:00Z", "2027-01-01T00:00:00Z"],
  ] as const) {
    checks.push({ what, want, got: billsTailStart(frontier, sw), old: oldBillsTailStart(frontier, sw) });
  }
  cases.push({ name: "8. the bills tail starts at the frontier or 48 hours before the switch, the lower", checks });
}

// ── 9. The label helpers, rows 5 to 9 ───────────────────────────────────────
{
  const checks: Check[] = [];
  for (const [n, gap, end, year] of [
    [119, "GAP · 119TH", 118, 2025],
    [120, "GAP · 120TH", 119, 2027],
  ] as const) {
    checks.push({ what: `the polarization axis for scores' Congress ${n}`, want: { gapLabel: gap, lineEndCongress: end, dotYear: year }, got: polarizationAxis(n), old: oldAxis(n) });
  }
  for (const [iso, want] of [
    ["2026-11-27T12:00:00Z", "Productivity vs. the 118th"],
    ["2027-01-03T00:00:00Z", "Productivity vs. the 119th"],
  ] as const) {
    const previous = lawsComparisonPair(at(iso)).previous;
    checks.push({ what: `/reports' heading at ${iso}`, want, got: productivityHeading(previous), old: oldHeading(previous) });
  }
  cases.push({ name: "9. the polarization chart's axis and /reports' heading follow their data's Congress", checks });
}

// ── The old code HO 840 replaced, from 4a5c283 ──────────────────────────────
// lib/lda-sync.ts:505-508: the day before the frontier, a date (HO 434 read the filter as date-granular).
const oldMs = (dt: string | null) => { const t = dt ? Date.parse(dt) : Number.NaN; return Number.isNaN(t) ? 0 : t; };
const oldPostedAfter = (maxDt: string | null) =>
  maxDt != null ? new Date(oldMs(maxDt) - 86_400_000).toISOString().slice(0, 10) : null;
// :546: a filing at or before the frontier's second read as stored, whatever its uuid.
const oldAlreadyStored = (dtMs: number, skipMs: number, _uuid: string, _at: ReadonlySet<string>) => dtMs <= skipMs;
// lib/sync.ts: no look-back; the tail kept only its own frontier.
const oldLookBackDue = (_now: Date, _stampedAt: string | null) => false;
// lib/amendments-sync.ts:258: no tail; the listing named getCurrentCongress() alone.
const oldAmendmentsTail = (_now: Date) => null;

// ── 10. The lobbying request and its dedup ──────────────────────────────────
{
  const checks: Check[] = [];
  for (const [what, frontier, want] of [
    ["a frontier of 2026-10-20T14:32:07Z", "2026-10-20T14:32:07Z", "2026-10-20T14:31:07Z"],
    ["2026 Q3's stored frontier, in its −04:00 form", "2026-10-20T11:23:18-04:00", "2026-10-20T15:22:18Z"],
    ["nothing stored", null, null],
  ] as const) {
    checks.push({ what: `filing_dt_posted_after for ${what}`, want, got: ldaPostedAfter(frontier), old: oldPostedAfter(frontier) });
  }
  // The frontier's own second holds two filings in the API, one of them stored (HO 840 STEP 0, #6).
  const skip = Date.parse("2026-10-20T11:23:18-04:00");
  const stored = new Set(["25ab6811-stored"]);
  for (const [what, dt, uuid, want] of [
    ["the stored filing at the frontier's second", skip, "25ab6811-stored", true],
    ["the second filing at that second, not stored", skip, "0b5a4a3b-not-stored", false],
    ["a filing one second before the frontier", skip - 1000, "earlier", true],
    ["a filing one second after it", skip + 1000, "later", false],
  ] as const) {
    checks.push({ what: `already stored: ${what}`, want, got: ldaAlreadyStored(dt, skip, uuid, stored), old: oldAlreadyStored(dt, skip, uuid, stored) });
  }
  cases.push({ name: "10. the lobbying request starts a minute before the frontier, to the second, and keeps a filing sharing its second", checks });
}

// ── 11. The bills tail's daily look-back ────────────────────────────────────
{
  const checks: Check[] = [];
  for (const [what, iso, stamp, want] of [
    ["today, before any switch", "2026-11-27T12:00:00Z", null, false],
    ["the last instant before the switch", "2027-01-02T23:59:59Z", null, false],
    ["the window's first tick, never stamped", "2027-01-03T06:00:00Z", null, true],
    ["the same UTC day, stamped at 06:05Z", "2027-01-03T18:00:00Z", "2027-01-03T06:05:00.000Z", false],
    ["the next UTC day", "2027-01-04T00:00:00Z", "2027-01-03T06:05:00.000Z", true],
    ["the window's last instant, stamped the day before", "2027-01-23T23:59:59.999Z", "2027-01-22T06:00:00.000Z", true],
    ["the window closed, stamped the day before", "2027-01-24T00:00:00Z", "2027-01-23T06:00:00.000Z", false],
  ] as const) {
    checks.push({ what: `look-back due: ${what} (${iso})`, want, got: billsTailLookBackDue(at(iso), stamp), old: oldLookBackDue(at(iso), stamp) });
  }
  cases.push({ name: "11. the bills tail's look-back runs once a UTC day inside the 21 days, never outside them", checks });
}

// ── 12. The amendments tail ─────────────────────────────────────────────────
{
  const T = { congress: 119, session: 2 };
  const checks: Check[] = [];
  for (const [iso, want] of [
    ["2026-11-27T12:00:00Z", null],
    ["2027-01-02T23:59:59Z", null],
    ["2027-01-03T00:00:00Z", T],
    ["2027-01-09T23:59:59.999Z", T],
    ["2027-01-10T00:00:00Z", null],
  ] as const) {
    checks.push({ what: `the amendments tail at ${iso}`, want, got: amendmentsTail(at(iso)), old: oldAmendmentsTail(at(iso)) });
  }
  cases.push({ name: "12. the amendments sync keeps the previous Congress's tail for seven days", checks });
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
