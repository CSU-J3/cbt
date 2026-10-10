// handoff 90 → HO 768: the Palestine Tracker (a public Google Sheet scored on
// USCPR's metric) into `palestine_scorecard`, BOTH tabs, by hand. The sheet is
// the authority; no LLM matching.
//
//   npm run sync:palestine              dry run (the default): reads both tabs
//                                       and the DB, writes nothing, prints what
//                                       a write would do
//   npm run sync:palestine -- --write   one batch of upserts per tab, then the
//                                       pools key; its last line names the flush
//
// - The header checks run first, both tabs, and a failure throws before any
//   write (HO 768 STEP 0, M2: the labels as read on 2026-10-07 and 10-08).
// - Senate tab (gid PALESTINE_TRACKER_SENATE_GID): matched as handoff 90 matched
//   it, the sheet's last name inside members.name with the state and chamber
//   'senate', now in memory. Votes at the 23 columns handoff 90 read (sheet
//   columns 9-31).
// - House tab (gid PALESTINE_TRACKER_HOUSE_GID): its CD ("CA-14", "VT-AL") names
//   a state and a district among chamber 'house' (lib/race-id.ts districtToken
//   reads members' NULL district as AL); then the sheet's last name must equal
//   members.last_name or appear in members.name, ignoring case, accents and
//   hyphens ("McClain-Delaney" on the sheet, "McClain Delaney" in members).
//   HO 769: two members at the CD with the surname are told apart by the
//   sheet's first name; a surname nobody at the CD holds is looked for among
//   the state's House members, and one there is the match, printed "matched by
//   state". Votes run from column 10 to the first empty header cell.
// - Either tab: exactly one member passes, or the row is unmatched and printed
//   with its reason. A member two rows match is printed, and --write refuses.
// - Only A to F is stored; N/A and blank grades are skipped and counted.
// - The pools: each tab's graded rows as read (not as matched) go to
//   dashboard_state PALESTINE_POOLS_KEY, which readPalestinePools takes as the
//   rank's denominator (lib/electoral-general.ts).
import "dotenv/config";
import type { InStatement } from "@libsql/client";
import { getDb } from "../lib/db";
import { readPalestinePools } from "../lib/electoral-general";
import {
  PALESTINE_POOLS_KEY,
  PALESTINE_TRACKER_HOUSE_GID,
  PALESTINE_TRACKER_SENATE_GID,
  PALESTINE_TRACKER_SHEET,
  isPalestineGrade,
} from "../lib/palestine-config";
import { districtToken } from "../lib/race-id";

const WRITE = process.argv.includes("--write");

type Tab = "senate" | "house";
const TABS: Tab[] = ["senate", "house"];
const GID: Record<Tab, string> = { senate: PALESTINE_TRACKER_SENATE_GID, house: PALESTINE_TRACKER_HOUSE_GID };
const csvUrl = (tab: Tab) => `${PALESTINE_TRACKER_SHEET}/export?format=csv&gid=${GID[tab]}`;

// Both tabs, 0-based: column 5 is the Senate's State and the House's CD.
const COL = {
  grade: 0,
  rank: 1,
  firstName: 2,
  lastName: 3,
  place: 4,
  sponsorScore: 5,
  votingScore: 6,
  totalScore: 7,
};

// The Senate's 23 vote and sponsorship columns, sheet columns 9-31 (handoff 90).
const SENATE_VOTES = Array.from({ length: 23 }, (_, i) => 8 + i);
// The House's first vote column, sheet column 10; they run to the first empty header cell.
const HOUSE_VOTES_FROM = 9;

// Basic CSV parser: quoted fields with embedded commas and newlines, and the
// doubled-quote ("") escape.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      current.push(field);
      field = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuote) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      current.push(field);
      field = "";
      rows.push(current);
      current = [];
    } else {
      field += ch;
    }
  }
  if (field || current.length) {
    current.push(field);
    rows.push(current);
  }
  return rows;
}

// The Senate tab names states in full; members holds the abbreviation.
function stateAbbr(name: string): string {
  const map: Record<string, string> = {
    Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
    Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
    Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
    Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
    Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO",
    Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
    "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH",
    Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
    Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
  };
  return map[name] ?? name;
}

const cell = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// For the House match: case, accents and hyphens fold away.
const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[-'’.]/g, " ").replace(/\s+/g, " ").trim();

// ---- the header checks (M2) -------------------------------------------------

type Header = { voteCols: number[]; voteLabels: string[]; lines: string[] };

function checkHeader(tab: Tab, rows: string[][]): Header {
  const h = rows[0] ?? [];
  const fails: string[] = [];
  const lines: string[] = [];
  const is = (i: number, label: string) => {
    if (cell(h[i]) !== label) fails.push(`col ${i + 1} is "${cell(h[i]).slice(0, 60)}", expected "${label}"`);
  };
  const starts = (i: number, prefix: string) => {
    if (!cell(h[i]).startsWith(prefix)) fails.push(`col ${i + 1} is "${cell(h[i]).slice(0, 60)}", expected it to begin "${prefix}"`);
  };
  starts(COL.grade, "Grade");
  is(COL.rank, "Rank");
  is(COL.firstName, "First Name");
  is(COL.lastName, "Last Name");
  is(COL.place, tab === "senate" ? "State" : "CD");
  starts(COL.sponsorScore, "Sponsor Score");
  starts(COL.votingScore, "Total Voting Score");
  starts(COL.totalScore, "Total Palestine Score");
  let voteCols: number[];
  if (tab === "senate") {
    voteCols = SENATE_VOTES;
    for (const i of voteCols) if (!cell(h[i])) fails.push(`col ${i + 1}, a vote column, is empty`);
    is(31, "2026 endorsements");
  } else {
    is(8, "2026 endorsements");
    let end = HOUSE_VOTES_FROM;
    while (end < h.length && cell(h[end])) end++;
    voteCols = Array.from({ length: end - HOUSE_VOTES_FROM }, (_, i) => HOUSE_VOTES_FROM + i);
    if (voteCols.length === 0) fails.push(`col ${HOUSE_VOTES_FROM + 1}, the first vote column, is empty`);
    if (end >= h.length) fails.push(`no empty header cell closes the vote columns`);
    else starts(end + 1, "Total Pro-Israel");
  }
  if (fails.length) throw new Error(`${tab} tab: header check failed, nothing written:\n  ${fails.join("\n  ")}`);
  lines.push(`header check: pass · ${voteCols.length} vote columns, sheet columns ${voteCols[0]! + 1}-${voteCols.at(-1)! + 1}`);

  // A label the header repeats takes the vote's date from the rows above the
  // members (the House tab's third row), else its ordinal, so no vote overwrites
  // another in votes_json: the House tab carries "Sanction the ICC for
  // Netanyahu warrant" twice, the 1/9/2025 vote and the 6/4/2024 one.
  const raw = voteCols.map((i) => (h[i] ?? "").trim());
  const count = new Map<string, number>();
  for (const l of raw) count.set(l, (count.get(l) ?? 0) + 1);
  const seen = new Map<string, number>();
  const voteLabels = raw.map((l, j) => {
    if ((count.get(l) ?? 0) < 2) return l;
    const n = (seen.get(l) ?? 0) + 1;
    seen.set(l, n);
    const date = rows
      .slice(1)
      .map((r) => cell(r[voteCols[j]!]))
      .find((v) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v));
    return `${l} (${date ?? n})`;
  });
  for (const [l, n] of count) if (n > 1) lines.push(`repeated label, ${n} columns, kept apart: "${l.replace(/\s+/g, " ").slice(0, 70)}" → ${voteLabels.filter((v, j) => raw[j] === l).map((v) => `"…${v.slice(l.length)}"`).join(", ")}`);
  return { voteCols, voteLabels, lines };
}

// ---- rows and matching ------------------------------------------------------

type Member = { bioguideId: string; name: string; lastName: string | null; state: string | null; district: number | null; chamber: string | null };

type SheetRow = {
  line: number; // the CSV row, 1-based, header = 1
  first: string;
  last: string;
  place: string; // the Senate's state in full, or the House's CD
  grade: string;
  rank: number | null;
  sponsor: string | null;
  voting: string | null;
  total: string | null;
  votes: Record<string, string>;
};

type Match = { row: SheetRow; bioguideId: string; note?: string };
type Miss = { row: SheetRow; reason: string };

function readRows(rows: string[][], header: Header): { members: SheetRow[]; other: number } {
  const members: SheetRow[] = [];
  let other = 0;
  rows.slice(1).forEach((r, k) => {
    const last = cell(r[COL.lastName]);
    if (!last) {
      // The House tab's vote-type, date and share rows and its credit line.
      if (r.some((c) => cell(c))) other++;
      return;
    }
    const votes: Record<string, string> = {};
    header.voteCols.forEach((i, j) => {
      const v = (r[i] ?? "").trim();
      if (v) votes[header.voteLabels[j]!] = v;
    });
    members.push({
      line: k + 2,
      first: cell(r[COL.firstName]),
      last,
      place: cell(r[COL.place]),
      grade: cell(r[COL.grade]),
      rank: Number.parseInt(cell(r[COL.rank]), 10) || null,
      sponsor: cell(r[COL.sponsorScore]) || null,
      voting: cell(r[COL.votingScore]) || null,
      total: cell(r[COL.totalScore]) || null,
      votes,
    });
  });
  return { members, other };
}

function matchSenate(row: SheetRow, members: Member[]): Match | Miss {
  const state = stateAbbr(row.place);
  const hits = members.filter(
    (m) => m.chamber === "senate" && m.state === state && m.name.toLowerCase().includes(row.last.toLowerCase()),
  );
  if (hits.length === 1) return { row, bioguideId: hits[0]!.bioguideId };
  if (hits.length === 0) return { row, reason: `no senator from ${state} has "${row.last}" in their name` };
  return { row, reason: `${hits.length} senators from ${state} match: ${hits.map((m) => `${m.name} ${m.bioguideId}`).join(", ")}` };
}

// HO 769: the two rows HO 768's write left unmatched, as members read on 2026-10-09.
// AZ-07 holds two Grijalvas, Raúl G000551 (is_current 0) and Adelita G000606
// (is_current 1), so the sheet's first name breaks a tie at the CD. The tracker
// puts Lucy McBath at GA-07, where members holds Richard McCormick, and members
// holds her at GA-06 (M001208), so a surname nobody at the CD holds is looked for
// among the state's House members. Each step takes exactly one member or none.
function matchHouse(row: SheetRow, members: Member[]): Match | Miss {
  const cd = /^([A-Z]{2})-(\d{1,2}|AL)$/.exec(row.place);
  if (!cd) return { row, reason: `CD "${row.place}" doesn't read as a district` };
  const token = cd[2] === "AL" ? "AL" : cd[2]!.padStart(2, "0");
  const last = fold(row.last);
  const hasSurname = (m: Member) => fold(m.lastName ?? "") === last || ` ${fold(m.name)} `.includes(` ${last} `);
  const list = (ms: Member[]) => ms.map((m) => `${m.name} ${m.bioguideId}`).join(", ");
  const atCd = members.filter((m) => m.chamber === "house" && m.state === cd[1] && districtToken(m.district) === token);
  const hits = atCd.filter(hasSurname);
  if (hits.length === 1) return { row, bioguideId: hits[0]!.bioguideId };
  if (hits.length > 1) {
    const first = fold(row.first);
    const named = first ? hits.filter((m) => ` ${fold(m.name)} `.includes(` ${first} `)) : [];
    if (named.length === 1) return { row, bioguideId: named[0]!.bioguideId };
    return { row, reason: `${hits.length} House members at ${row.place} match: ${list(hits)}; ${named.length} of them hold "${row.first}"` };
  }
  const inState = members.filter((m) => m.chamber === "house" && m.state === cd[1] && hasSurname(m));
  if (inState.length === 1) {
    const m = inState[0]!;
    return { row, bioguideId: m.bioguideId, note: `matched by state: the tracker's CD ${row.place}, members' ${m.state}-${districtToken(m.district)}` };
  }
  const here = atCd.length ? `${row.place} holds ${list(atCd)}; no "${row.last}"` : `no House member at ${row.place}`;
  return { row, reason: inState.length ? `${here}; ${inState.length} House members in ${cd[1]} match: ${list(inState)}` : `${here}, nor anywhere in ${cd[1]}` };
}

// ---- the run ----------------------------------------------------------------

type Stored = { grade: string | null; rank: number | null; sponsor: string | null; voting: string | null; total: string | null };

async function main() {
  const db = getDb();
  const now = new Date().toISOString();
  console.log(`sync:palestine — ${WRITE ? "WRITE" : "dry run (nothing is written; --write writes)"} · ${now}`);

  // Both tabs, both header checks, before anything else.
  const sheets = {} as Record<Tab, { rows: string[][]; header: Header }>;
  for (const tab of TABS) {
    const res = await fetch(csvUrl(tab));
    if (!res.ok) throw new Error(`${tab} tab: sheet fetch failed, HTTP ${res.status}`);
    const rows = parseCSV(await res.text());
    sheets[tab] = { rows, header: checkHeader(tab, rows) };
  }

  const members: Member[] = (
    await db.execute(`SELECT bioguide_id, name, last_name, state, district, chamber FROM members`)
  ).rows.map((r) => ({
    bioguideId: String(r.bioguide_id),
    name: String(r.name ?? ""),
    lastName: r.last_name == null ? null : String(r.last_name),
    state: r.state == null ? null : String(r.state),
    district: r.district == null ? null : Number(r.district),
    chamber: r.chamber == null ? null : String(r.chamber),
  }));
  const stored = new Map<string, Stored>(
    (await db.execute(`SELECT bioguide_id, grade, rank, sponsor_score, voting_score, total_score FROM palestine_scorecard`)).rows.map((r) => [
      String(r.bioguide_id),
      {
        grade: r.grade == null ? null : String(r.grade),
        rank: r.rank == null ? null : Number(r.rank),
        sponsor: r.sponsor_score == null ? null : String(r.sponsor_score),
        voting: r.voting_score == null ? null : String(r.voting_score),
        total: r.total_score == null ? null : String(r.total_score),
      },
    ]),
  );

  const pools: Record<Tab, { graded: number; read: string }> = { senate: { graded: 0, read: now }, house: { graded: 0, read: now } };
  const matched: Record<Tab, Match[]> = { senate: [], house: [] };
  const byMember = new Map<string, string[]>();

  for (const tab of TABS) {
    const { rows, header } = sheets[tab];
    const { members: sheetRows, other } = readRows(rows, header);
    const graded = sheetRows.filter((r) => isPalestineGrade(r.grade));
    const skipped = sheetRows.filter((r) => !isPalestineGrade(r.grade));
    pools[tab].graded = graded.length;
    const letters = ["A", "B", "C", "D", "F"].map((g) => `${g} ${graded.filter((r) => r.grade === g).length}`).join(" · ");
    const results = graded.map((r) => (tab === "senate" ? matchSenate(r, members) : matchHouse(r, members)));
    const hits = results.filter((x): x is Match => "bioguideId" in x);
    const misses = results.filter((x): x is Miss => "reason" in x);
    matched[tab] = hits;
    for (const m of hits) byMember.set(m.bioguideId, [...(byMember.get(m.bioguideId) ?? []), `${tab} row ${m.row.line} ${m.row.first} ${m.row.last}`]);

    console.log(`\n== ${tab} tab (gid ${GID[tab]})`);
    for (const l of header.lines) console.log(`  ${l}`);
    console.log(`  rows: ${sheetRows.length} member rows, ${other} other rows with content`);
    console.log(`  graded: ${graded.length} (${letters})`);
    console.log(`  matched: ${hits.length}`);
    for (const m of hits) if (m.note) console.log(`    ${m.row.first} ${m.row.last}, row ${m.row.line}: ${m.note}`);
    console.log(`  unmatched graded: ${misses.length}`);
    for (const m of misses) console.log(`    ${m.row.first} ${m.row.last} (${m.row.place}), row ${m.row.line}: ${m.reason}`);
    const why = new Map<string, SheetRow[]>();
    for (const r of skipped) why.set(r.grade || "(blank)", [...(why.get(r.grade || "(blank)") ?? []), r]);
    console.log(`  skipped (not A-F): ${skipped.length}${skipped.length ? ` · ${[...why].map(([g, rs]) => `${g} ${rs.length}: ${rs.map((r) => `${r.first} ${r.last} (${r.place})`).join(", ")}`).join(" · ")}` : ""}`);
    const changes: string[] = [];
    let fresh = 0;
    for (const m of hits) {
      const old = stored.get(m.bioguideId);
      if (!old) {
        fresh++;
        continue;
      }
      const diff: string[] = [];
      const cmp = (k: string, a: string | number | null, b: string | number | null) => {
        if ((a ?? null) !== (b ?? null)) diff.push(`${k} ${a ?? "—"} → ${b ?? "—"}`);
      };
      cmp("grade", old.grade, m.row.grade);
      cmp("rank", old.rank, m.row.rank);
      cmp("sponsor", old.sponsor, m.row.sponsor);
      cmp("voting", old.voting, m.row.voting);
      cmp("total", old.total, m.row.total);
      if (diff.length) changes.push(`    ${m.row.first} ${m.row.last} ${m.bioguideId}: ${diff.join(" · ")}`);
    }
    console.log(`  stored rows: ${hits.length - fresh} matched rows already stored, ${changes.length} of them changed; ${fresh} new`);
    for (const c of changes) console.log(c);
    console.log(`  pool it would write: ${tab}.graded = ${graded.length}`);
  }

  const twice = [...byMember].filter(([, rs]) => rs.length > 1);
  console.log(`\nmembers matched twice: ${twice.length}`);
  for (const [id, rs] of twice) console.log(`  ${id}: ${rs.join(" | ")}`);
  const value = JSON.stringify(pools);
  console.log(`pools (dashboard_state ${PALESTINE_POOLS_KEY}): ${value}`);

  if (!WRITE) {
    console.log(`\ndry run: nothing written. To write: npm run sync:palestine -- --write`);
    return;
  }
  if (twice.length) throw new Error(`--write refused: ${twice.length} member(s) matched twice; nothing written`);

  const upsert = `INSERT INTO palestine_scorecard
      (bioguide_id, grade, rank, sponsor_score, voting_score, total_score, votes_json, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bioguide_id) DO UPDATE SET
      grade = excluded.grade,
      rank = excluded.rank,
      sponsor_score = excluded.sponsor_score,
      voting_score = excluded.voting_score,
      total_score = excluded.total_score,
      votes_json = excluded.votes_json,
      synced_at = excluded.synced_at`;
  for (const tab of TABS) {
    const stmts: InStatement[] = matched[tab].map((m) => ({
      sql: upsert,
      args: [m.bioguideId, m.row.grade, m.row.rank, m.row.sponsor, m.row.voting, m.row.total, JSON.stringify(m.row.votes), now],
    }));
    const rs = await db.batch(stmts, "write");
    console.log(`\nwrote ${tab}: ${rs.reduce((a, r) => a + r.rowsAffected, 0)} rows affected in one batch of ${stmts.length}`);
  }
  const k = await db.execute({
    sql: `INSERT INTO dashboard_state (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [PALESTINE_POOLS_KEY, value, now],
  });
  console.log(`wrote ${PALESTINE_POOLS_KEY}: ${k.rowsAffected} row affected`);

  // Read back: the rows by chamber at this run's synced_at, the key, and the
  // pools as the page reads them.
  const back = await db.execute({
    sql: `SELECT m.chamber AS chamber, COUNT(*) AS n, SUM(ps.synced_at = ?) AS this_run
            FROM palestine_scorecard ps JOIN members m ON m.bioguide_id = ps.bioguide_id GROUP BY m.chamber`,
    args: [now],
  });
  for (const r of back.rows) console.log(`read back: palestine_scorecard ${r.chamber} ${r.n} rows, ${r.this_run} written by this run`);
  const kv = await db.execute({ sql: `SELECT value, updated_at FROM dashboard_state WHERE key = ?`, args: [PALESTINE_POOLS_KEY] });
  console.log(`read back: ${PALESTINE_POOLS_KEY} = ${kv.rows[0]?.value} (updated ${kv.rows[0]?.updated_at})`);
  console.log(`read back: readPalestinePools = ${JSON.stringify(await readPalestinePools(db))}`);
  console.log(`flush needed: POST /api/revalidate?tag=palestine (Authorization: Bearer $CRON_SECRET)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
