// HO 770 leg A — the shape of Sabato's rating-changes page, through the SHIPPED reader
// (parseSabatoChanges and fetchSource, lib/race-ratings-scrape.ts), on the page as saved at STEP 0
// and on mangled copies of it. Replaces race-ratings-shape-742.ts, retired with the Ballotpedia
// transport it tested.
//
//   npx tsx scripts/diagnostic/race-ratings-shape-770.ts [--chamber house|senate] [--page <saved html>]
//
// With no --chamber, both. Every case is a red or a control:
//   the served page   both chambers parse at the floors, with counts by label and date; the two id
//                     sets don't intersect; table 39 takes Sept. 10 from the table above it (the S1
//                     ruling's control)
//   the date rule     a paragraph between tables 38 and 39 throws (the rule's edge); a section's first
//                     table with its date line removed throws, with no table above it to inherit from;
//                     a mid-section table with its date line removed takes the date above (the rule's
//                     reach, asserted so it is seen)
//   the mangles       a section heading removed; three House rows' tokens removed; every label
//                     unknown; one race twice on one date: each fires its throw, and the other chamber
//                     still parses where the mangle was one chamber's
//   the columns       old and new headers swapped: the labels follow the headers
//   the counted       one row's token removed is unparsed, counted and listed; one unknown label is
//                     counted and its race not written
//   the fetch         a local 404 throws fetchError naming the URL, after the shipped agent and Accept
//                     arrived; a local host that accepts and never answers throws status 0 inside 8s
//
// Read-only: the saved page (no fetch of Sabato's host) and two servers on 127.0.0.1.
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { createServer as createTcpServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { fetchSource, parseSabatoChanges, type Chamber, type SabatoChanges } from "@/lib/race-ratings-scrape";

const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const PAGE = argAt("--page") ?? "docs/handoffs/770-artifacts/m4/centerforpolitics.org_crystalball_2026-rating-changes_.html";
const ONLY = argAt("--chamber") as Chamber | undefined;
if (ONLY && ONLY !== "house" && ONLY !== "senate") throw new Error(`--chamber must be house|senate, got ${ONLY}`);
const CHAMBERS: Chamber[] = ONLY ? [ONLY] : ["house", "senate"];
const AGENT = "CBT-ratings-sync/1.0 (+https://github.com/CSU-J3/cbt)"; // lib/race-ratings-scrape.ts USER_AGENT
const CAP_MS = 8_000; // FETCH_TIMEOUT_MS

let passes = 0;
let fails = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
  if (ok) passes++;
  else fails++;
};
const quiet = <T>(fn: () => T): T => {
  const warn = console.warn;
  const log = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
    console.log = log;
  }
};
const parse = (html: string, c: Chamber) => quiet(() => parseSabatoChanges(html, c));
const throwsOf = (html: string, c: Chamber): string | null => {
  try {
    parse(html, c);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};
const short = (s: string | null) => (s == null ? "(no throw)" : s.length > 260 ? `${s.slice(0, 260)}…` : s);

// ── the page and its tables ─────────────────────────────────────────────────
const html = readFileSync(PAGE, "utf8");
type Span = { start: number; end: number };
const tableSpans = (h: string): Span[] =>
  [...h.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
const rowSpans = (h: string, t: Span): Span[] =>
  [...h.slice(t.start, t.end).matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => ({
    start: t.start + (m.index ?? 0),
    end: t.start + (m.index ?? 0) + m[0].length,
  }));
const splice = (h: string, s: Span, text: string) => h.slice(0, s.start) + text + h.slice(s.end);
const textOf = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
// The date line above table i: the <p> in the gap between the boundary above and the table.
function dateLineSpan(h: string, i: number): Span {
  const t = tableSpans(h)[i]!;
  const lo = Math.max(i > 0 ? tableSpans(h)[i - 1]!.end : 0, h.lastIndexOf("</h2>", t.start));
  const gap = h.slice(lo, t.start);
  const m = /<p\b[^>]*>[\s\S]*?<\/p>/i.exec(gap);
  if (!m) throw new Error(`no date line above table ${i}`);
  return { start: lo + (m.index ?? 0), end: lo + (m.index ?? 0) + m[0].length };
}
// The House token in a row's first cell, replaced; the cell's text before and after.
function stripToken(h: string, i: number, row: number): { html: string; before: string; after: string } {
  const r = rowSpans(h, tableSpans(h)[i]!)[row]!;
  const rowHtml = h.slice(r.start, r.end);
  const cell = /<td\b[\s\S]*?<\/td>/i.exec(rowHtml)!;
  // In the cell's text only, never its attributes.
  const re = /\b[A-Z]{2}-(\d{1,2}|AL)\b|(?<=[\s(,-])[A-Z]{2}(?=[\s),-])/;
  let done = false;
  const newCell = cell[0].replace(/>([^<]+)</g, (m, txt: string) => {
    if (done || !re.test(txt)) return m;
    done = true;
    return `>${txt.replace(re, "")}<`;
  });
  if (newCell === cell[0]) throw new Error(`table ${i} row ${row}: no token to remove in ${textOf(cell[0])}`);
  const newRow = rowHtml.replace(cell[0], newCell);
  return { html: splice(h, r, newRow), before: textOf(cell[0]), after: textOf(newCell) };
}
const label = (p: SabatoChanges, id: string) => {
  const r = p.ratings.find((x) => x.raceId === id);
  if (r) return `${r.rating} as of ${r.asOfDate}`;
  const l = p.locked.find((x) => x.raceId === id);
  return l ? `${l.label} as of ${l.asOfDate}` : null;
};

const spans = tableSpans(html);
const SECTION_FIRST: Record<Chamber, number> = { senate: 0, house: 34 };
console.log(`HO 770 leg A · ${new Date().toISOString()} · ${PAGE} (${Buffer.byteLength(html).toLocaleString("en-US")} bytes, ${spans.length} tables) · chambers ${CHAMBERS.join(", ")}`);

// ── the served page ─────────────────────────────────────────────────────────
console.log(`\n── the served page`);
const base: Partial<Record<Chamber, SabatoChanges>> = {};
for (const c of CHAMBERS) {
  const p = parse(html, c);
  base[c] = p;
  const floor = c === "house" ? 100 : 20;
  const by = (xs: { rating?: string; label?: string }[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x.rating ?? x.label ?? "?", (m.get(x.rating ?? x.label ?? "?") ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
  };
  const dates = p.tables.map((t) => t.date).sort();
  check(
    `${c} parses at the floor`,
    p.rows >= floor && p.unparsed.length <= 2,
    `${p.tables.length} tables, ${p.rows} rows (floor ${floor}), ${p.unparsed.length} unparsed, ${dates[0]} … ${dates.at(-1)} · ` +
      `current: ${p.ratings.length} competitive (${by(p.ratings)}) and ${p.locked.length} Safe (${by(p.locked)}) · unknown ${JSON.stringify(p.unknown)}`,
  );
  const shape = c === "house" ? /^[A-Z]{2}-(\d{2}|AL)-2026$/ : /^S-[A-Z]{2}-2026$/;
  const ids = [...p.ratings, ...p.locked].map((x) => x.raceId);
  check(`${c} ids all have the chamber's form`, ids.every((id) => shape.test(id)), `${ids.length} ids, e.g. ${ids.slice(0, 4).join(", ")}`);
}
if (base.house && base.senate) {
  const h = new Set([...base.house.ratings, ...base.house.locked].map((x) => x.raceId));
  const both = [...base.senate.ratings, ...base.senate.locked].map((x) => x.raceId).filter((id) => h.has(id));
  check("the two chambers' id sets don't intersect", both.length === 0, both.length ? both.join(", ") : `${h.size} House · ${base.senate.ratings.length + base.senate.locked.length} Senate · 0 shared`);
}
if (base.house) {
  const p = base.house;
  const t39 = p.tables.find((t) => t.index === 39);
  const inherited = p.tables.filter((t) => t.inherited).map((t) => t.index);
  check(
    "control (S1 ruling): table 39 takes Sept. 10 from table 38 above it, and is the only table that inherits",
    t39?.date === "2026-09-10" && t39.inherited && inherited.length === 1 && textOf(html.slice(spans[38]!.end, spans[39]!.start)) === "",
    `table 39 ${JSON.stringify(t39)} · inherited ${JSON.stringify(inherited)} · gap above it ${JSON.stringify(html.slice(spans[38]!.end, spans[39]!.start))}`,
  );
  check(
    "…so its two rows read as of 2026-09-10",
    label(p, "AL-02-2026") === "Lean R as of 2026-09-10" && label(p, "TX-34-2026") === "Lean D as of 2026-09-10",
    `AL-02 ${label(p, "AL-02-2026")} · TX-34 ${label(p, "TX-34-2026")}`,
  );
}
if (base.senate) {
  const inherited = base.senate.tables.filter((t) => t.inherited).map((t) => t.index);
  check("the Senate has no table that inherits", inherited.length === 0, JSON.stringify(inherited));
}

// ── the date rule ───────────────────────────────────────────────────────────
console.log(`\n── the date rule`);
if (CHAMBERS.includes("house")) {
  const at = spans[39]!.start;
  const withPara = html.slice(0, at) + "<p>A note on these changes.</p>\n" + html.slice(at);
  const e = throwsOf(withPara, "house");
  check(
    "edge (S1 ruling): a paragraph between tables 38 and 39 makes the House throw",
    e !== null && e.includes("table 39") && e.includes("A note on these changes."),
    short(e),
  );
  if (CHAMBERS.includes("senate")) check("…and the Senate still parses", throwsOf(withPara, "senate") === null, short(throwsOf(withPara, "senate")));
  const mid = dateLineSpan(html, 40);
  const noMid = splice(html, mid, "");
  const pm = throwsOf(noMid, "house") ?? "";
  const t40 = pm ? null : parse(noMid, "house").tables.find((t) => t.index === 40);
  check(
    "reach (S1 ruling): table 40 with its date line removed takes table 39's date, Sept. 10, by the rule",
    t40?.date === "2026-09-10" && t40.inherited === true,
    `removed ${JSON.stringify(textOf(html.slice(mid.start, mid.end)))} · table 40 now ${JSON.stringify(t40)}${pm ? ` · threw ${short(pm)}` : ""}`,
  );
}
for (const c of CHAMBERS) {
  const first = SECTION_FIRST[c];
  const s = dateLineSpan(html, first);
  const mangled = splice(html, s, "");
  const e = throwsOf(mangled, c);
  check(
    `${c}: the section's first table (${first}) with its date line removed throws, with no table above it to inherit from`,
    e !== null && e.includes(`table ${first} has no date`) && e.includes("no table above it"),
    `removed ${JSON.stringify(textOf(html.slice(s.start, s.end)))} · ${short(e)}`,
  );
  const other: Chamber = c === "house" ? "senate" : "house";
  if (CHAMBERS.includes(other)) check(`…and the ${other} still parses`, throwsOf(mangled, other) === null, short(throwsOf(mangled, other)));
}

// ── the mangles ─────────────────────────────────────────────────────────────
console.log(`\n── the mangles`);
const HEADING: Record<Chamber, string> = { senate: "Senate rating changes", house: "House rating changes" };
for (const c of CHAMBERS) {
  const m = [...html.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi)].find((x) => textOf(x[0]) === HEADING[c])!;
  const mangled = html.slice(0, m.index ?? 0) + html.slice((m.index ?? 0) + m[0].length);
  const e = throwsOf(mangled, c);
  check(`${c}: its section heading removed throws`, e !== null && /heading says/.test(e) && e.includes(`header says ${c}`), short(e));
  const other: Chamber = c === "house" ? "senate" : "house";
  if (CHAMBERS.includes(other)) check(`…and the ${other} still parses (leg C's c2 rests on this for the Senate)`, throwsOf(mangled, other) === null, short(throwsOf(mangled, other)));
}
if (CHAMBERS.includes("house")) {
  let h = html;
  const cells: string[] = [];
  for (const row of [1, 2, 3]) {
    const r = stripToken(h, SECTION_FIRST.house, row);
    h = r.html;
    cells.push(`${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}`);
  }
  const e = throwsOf(h, "house");
  check("house: three rows with their tokens removed throws (at most 2 unparsed)", e !== null && e.includes("3 didn't (at most 2)"), `${cells.join(" · ")} · ${short(e)}`);
}
for (const c of CHAMBERS) {
  const unknownAll = html.replace(/<table\b[\s\S]*?<\/table>/gi, (t) =>
    t.replace(/Republican/g, "Rpblcn").replace(/Democratic/g, "Dmcrtc").replace(/Toss-up/g, "Tossup"),
  );
  const e = throwsOf(unknownAll, c);
  check(`${c}: every label unknown throws`, e !== null && e.includes("ZERO competitive current ratings"), short(e));
}
for (const c of CHAMBERS) {
  const t = spans[SECTION_FIRST[c]]!;
  const r = rowSpans(html, t)[1]!;
  const dup = html.slice(0, r.end) + "\n" + html.slice(r.start, r.end) + html.slice(r.end);
  const e = throwsOf(dup, c);
  check(
    `${c}: the same race twice on one date throws, naming it`,
    e !== null && /: \S+-2026 changed twice on \d{4}-\d{2}-\d{2} \(tables (\d+) and \1\)/.test(e),
    `duplicated ${JSON.stringify(textOf(html.slice(r.start, r.end)))} in table ${SECTION_FIRST[c]} · ${short(e)}`,
  );
}

// ── the columns ─────────────────────────────────────────────────────────────
console.log(`\n── the columns`);
if (CHAMBERS.includes("house")) {
  const t = spans[SECTION_FIRST.house]!;
  const head = rowSpans(html, t)[0]!;
  const headHtml = html.slice(head.start, head.end);
  const swapped = headHtml.replace(/Old Rating|New Rating/g, (x) => (x === "Old Rating" ? "New Rating" : "Old Rating"));
  const mangled = splice(html, head, swapped);
  const headerNow = textOf(mangled.slice(head.start, head.start + swapped.length));
  const rows = rowSpans(html, t).slice(1).map((r) => [...html.slice(r.start, r.end).matchAll(/<td\b[\s\S]*?<\/td>/gi)].map((m) => textOf(m[0])));
  const p1 = parse(mangled, "house");
  const p0 = base.house!;
  const date = p0.tables.find((x) => x.index === SECTION_FIRST.house)!.date;
  const VOCAB: Record<string, string> = { "Safe Democratic": "Safe D", "Likely Democratic": "Likely D", "Leans Democratic": "Lean D", "Toss-up": "Toss Up", "Leans Republican": "Lean R", "Likely Republican": "Likely R", "Safe Republican": "Safe R" };
  // This is the newest House table, so each of its rows is its race's newest change.
  const idOf = (cell: string) => {
    const m = /\b([A-Z]{2})-(\d{1,2}|AL)\b/.exec(cell);
    return m ? `${m[1]}-${m[2] === "AL" ? "AL" : m[2]!.padStart(2, "0")}-2026` : null;
  };
  const seen = rows.map((r) => {
    const id = idOf(r[0]!);
    return { cell: r[0], old: r[1], now: id ? label(p1, id) : null, id };
  });
  check(
    "the swap applied: the first House table's header now reads District | New Rating | Old Rating",
    headerNow === "District New Rating Old Rating",
    JSON.stringify(headerNow),
  );
  check(
    "…and each of its races now reads its OLD label as current: the labels follow the headers",
    seen.length > 0 && seen.every((s) => s.id !== null && s.now === `${VOCAB[s.old!]} as of ${date}`),
    seen.map((s) => `${s.id ?? s.cell}: was ${label(p0, s.id ?? "")} → now ${s.now} (its old label ${s.old})`).join(" · "),
  );
}

// ── the counted ─────────────────────────────────────────────────────────────
console.log(`\n── the counted`);
if (CHAMBERS.includes("house")) {
  const r = stripToken(html, SECTION_FIRST.house, 4);
  const p = parse(r.html, "house");
  const p0 = base.house!;
  check(
    "house: one row with its token removed is unparsed, counted and listed, and the parse goes on",
    p.unparsed.length === 1 && p.unparsed[0]!.cell === r.after && p.rows === p0.rows - 1,
    `${JSON.stringify(r.before)} → ${JSON.stringify(r.after)} · unparsed ${JSON.stringify(p.unparsed)} · rows ${p0.rows} → ${p.rows}`,
  );
  const t = spans[SECTION_FIRST.house]!;
  const row = rowSpans(html, t)[4]!;
  const rowHtml = html.slice(row.start, row.end);
  const cellsAt = [...rowHtml.matchAll(/<td\b[\s\S]*?<\/td>/gi)];
  const newCell = cellsAt[2]![0];
  const was = textOf(newCell);
  const mangledRow = rowHtml.replace(newCell, newCell.replace(was, "Leans Purple"));
  const p2 = parse(splice(html, row, mangledRow), "house");
  const id = "WI-01-2026";
  check(
    "house: one unknown label is counted, and its race is not written (it keeps the row it has)",
    textOf(cellsAt[0]![0]).includes("WI-1") && p2.unknown["Leans Purple"] === 1 && label(p0, id) !== null && label(p2, id) === null,
    `${textOf(cellsAt[0]![0])}: ${JSON.stringify(was)} → "Leans Purple" · unknown ${JSON.stringify(p2.unknown)} · ${id} ${label(p0, id)} → ${label(p2, id) ?? "absent"}`,
  );
}

// ── the fetch (controls) ────────────────────────────────────────────────────
console.log(`\n── the fetch`);
async function controls() {
  let headers: IncomingHttpHeaders | null = null;
  const http = createHttpServer((req, res) => {
    headers = req.headers;
    res.writeHead(404, { "content-type": "text/plain" }).end("not here");
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  const url404 = `http://127.0.0.1:${(http.address() as AddressInfo).port}/crystalball/2026-rating-changes/`;
  let e404 = "";
  try {
    await fetchSource(url404, "text/html");
  } catch (e) {
    e404 = e instanceof Error ? e.message : String(e);
  }
  http.close();
  check("a local 404 throws fetchError naming the URL", e404 === `fetch ${url404} -> 404`, JSON.stringify(e404));
  const h = headers as IncomingHttpHeaders | null;
  check("…and the request carried the shipped agent and Accept: text/html", h?.["user-agent"] === AGENT && h?.accept === "text/html", `User-Agent ${JSON.stringify(h?.["user-agent"])} · Accept ${JSON.stringify(h?.accept)}`);

  const sockets: Socket[] = [];
  const tcp = createTcpServer((s) => {
    s.on("error", () => {});
    sockets.push(s);
  });
  await new Promise<void>((r) => tcp.listen(0, "127.0.0.1", () => r()));
  const urlHang = `http://127.0.0.1:${(tcp.address() as AddressInfo).port}/hang`;
  const t0 = Date.now();
  let eHang = "";
  try {
    await fetchSource(urlHang, "text/html");
  } catch (e) {
    eHang = e instanceof Error ? e.message : String(e);
  }
  const ms = Date.now() - t0;
  tcp.close();
  for (const s of sockets) s.destroy();
  check(
    "a local host that accepts and never answers throws status 0 inside the cap",
    eHang === `fetch ${urlHang} -> 0: no answer within the ${CAP_MS}ms per-fetch budget` && ms >= CAP_MS && ms < CAP_MS + 1_500 && sockets.length === 1,
    `${ms} ms · ${sockets.length} connection accepted, 0 answered · ${JSON.stringify(eHang)}`,
  );
}

controls()
  .then(() => {
    console.log(`\n${passes} PASS · ${fails} FAIL`);
    process.exitCode = fails ? 1 : 0;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 2;
  });
