// HO 742 — READ-ONLY shape instrument for the race-ratings ingest.
//
// BUILDS NOTHING. No database connection, no writes, no network unless you pass
// a URL. It runs the SHIPPED parser (`parseRatingsTable` /`discoverWidgetUrl`
// from lib/race-ratings-scrape.ts) against saved HTML, so what is under test is
// the code the cron runs and not a copy of it.
//
//   npx tsx scripts/diagnostic/race-ratings-shape-742.ts --selftest \
//     docs/handoffs/742-artifacts/bpwidget-ratings.html \
//     docs/handoffs/742-artifacts/house-2026.html
//
// WHY IT EXISTS. For two Wednesdays this ingest wrote `scraped 0 upserted 0`
// under a `success` verdict, because its only guard compared the one number
// Ballotpedia's change had preserved (435 rows) while every row fell through a
// `continue`. The fix replaces those with four throws. A throw nobody has seen
// throw is a promise, so this runs each of them against a deliberately mangled
// copy and FAILS IF THE THROW DOES NOT HAPPEN — the HO 592/679 form: positive
// and negative fixtures, exit 1 on the first mismatch.
//
// The four legs, in the order a reader should care about them:
//   GREEN      the real widget HTML parses to > 0 ratings, with AK-AL-2026 × 3
//   RED (a)    the rater names removed from the header -> header throw
//   RED (b)    every district cell rewritten to an unknown shape -> floor throw
//   RED (c)    every rating cell set to "Solid Republican" -> zero-ratings throw
// plus, when a page fixture is given:
//   GREEN/RED  discovery finds exactly one widget data-url, and a page with the
//              div removed throws rather than falling through to the PVI table
//              (which is precisely what happened in production).
//
// HO 743 EXTENDS THE GREEN LEG AND LEAVES THE FOUR REDS ALONE. The parse now
// returns the Solid/Safe cells as evidence rather than dropping them, and a
// row can be DELETED on one, so the green leg asserts the cell census
// (competitive + locked == 435 × 3, i.e. nothing classified as neither), the
// three sources present, the ±3 label/score contract the departure row is
// written from, and that no locked cell carries a Senate id. The file keeps its
// -742 name: this is the ingest's one instrument, not a per-HO artifact.
import { readFileSync } from "node:fs";
import {
  discoverWidgetUrl,
  parseRatingsTable,
  captionAsOfDate,
  type RatingsScrape,
} from "@/lib/race-ratings-scrape";

const args = process.argv.slice(2);
const selftest = args.includes("--selftest");
const paths = args.filter((a) => !a.startsWith("--"));
const widgetPath = paths[0] ?? "docs/handoffs/742-artifacts/bpwidget-ratings.html";
const pagePath = paths[1];

let failures = 0;
function ok(label: string, detail: string) {
  console.log(`  PASS  ${label}: ${detail}`);
}
function bad(label: string, detail: string) {
  console.log(`  FAIL  ${label}: ${detail}`);
  failures++;
}

/** Run `fn`; require it to throw with a message containing `needle`. */
function mustThrow(label: string, needle: string, fn: () => unknown) {
  try {
    const out = fn();
    const scrape = out as Partial<RatingsScrape> | undefined;
    const shape = scrape?.ratings
      ? `${scrape.ratings.length} ratings + ${scrape.locked?.length ?? "?"} locked`
      : typeof out;
    bad(label, `did NOT throw — returned ${shape}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes(needle)) ok(label, msg.slice(0, 120) + (msg.length > 120 ? "…" : ""));
    else bad(label, `threw the WRONG error (wanted "${needle}"): ${msg.slice(0, 160)}`);
  }
}

const widget = readFileSync(widgetPath, "utf8");
console.log(`fixture: ${widgetPath} (${widget.length} bytes)\n`);

// ── GREEN: the real thing ───────────────────────────────────────────────────
console.log("GREEN — the saved widget response");
try {
  const { ratings: out, locked, sourcesPresent } = parseRatingsTable(widget);
  if (out.length > 0) ok("parses to > 0 ratings", `${out.length} competitive ratings`);
  else bad("parses to > 0 ratings", "0");
  const bySource = new Map<string, number>();
  for (const r of out) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  ok("per source", [...bySource.entries()].map(([k, v]) => `${k}=${v}`).join(" "));
  const ak = out.filter((r) => r.raceId === "AK-AL-2026");
  if (ak.length === 3) ok("AK-AL-2026 (the at-large branch)", ak.map((r) => `${r.source}=${r.rating}`).join(" "));
  else bad("AK-AL-2026 (the at-large branch)", `expected 3 rows, got ${ak.length}`);
  const asOf = captionAsOfDate(widget);
  if (asOf) ok("caption as-of date", asOf);
  else bad("caption as-of date", "did not parse");

  // ── HO 743: the locked cells are now part of the return, and the cell census
  // is the assertion — every (district, rater) cell is competitive, locked, or
  // empty, and the widget renders no empty ones today. Printing all three is
  // what makes a future drift legible: if `locked + ratings` stops reconciling
  // to 435 × 3, the difference is cells the parser saw and classified as
  // neither, which is precisely the silent skip HO 742 exists to prevent.
  const CELLS = 435 * 3;
  const seen = out.length + locked.length;
  if (seen === CELLS) ok("cell census reconciles", `${out.length} competitive + ${locked.length} locked = ${CELLS} (0 empty/unknown)`);
  else bad("cell census reconciles", `${out.length} + ${locked.length} = ${seen}, expected ${CELLS} — ${CELLS - seen} cell(s) classified as neither`);

  if (sourcesPresent.length === 3) ok("sourcesPresent", sourcesPresent.join(" "));
  else bad("sourcesPresent", `expected 3, got ${sourcesPresent.length}: ${sourcesPresent.join(" ") || "(none)"}`);

  const lockedBySource = new Map<string, number>();
  for (const c of locked) lockedBySource.set(c.source, (lockedBySource.get(c.source) ?? 0) + 1);
  ok("locked per source", [...lockedBySource.entries()].map(([k, v]) => `${k}=${v}`).join(" "));

  // The label/score contract the departure row is written from. A locked cell
  // with score 0 would file a seat going safe at dead-centre of the scale (0 is
  // Toss Up's), and a NULL would violate rating_history.rating_score NOT NULL.
  const labels = new Map<string, number>();
  for (const c of locked) labels.set(`${c.label}@${c.ratingScore}`, (labels.get(`${c.label}@${c.ratingScore}`) ?? 0) + 1);
  const badScore = locked.filter((c) => c.ratingScore !== 3 && c.ratingScore !== -3);
  if (badScore.length === 0) ok("locked label/score", [...labels.entries()].map(([k, v]) => `${k}×${v}`).join(" "));
  else bad("locked label/score", `${badScore.length} locked cell(s) not at ±3, e.g. ${badScore[0]!.label}@${badScore[0]!.ratingScore}`);

  // Every locked cell names a House race id. The Senate rows are out of reach
  // by construction and this is the line that would notice if they stopped
  // being — an `S-`-prefixed id here means the delete could touch the seed.
  const senate = locked.filter((c) => c.raceId.startsWith("S-"));
  if (senate.length === 0) ok("no Senate ids among locked cells", `${locked.length} checked`);
  else bad("no Senate ids among locked cells", `${senate.length}, e.g. ${senate[0]!.raceId}`);
} catch (e) {
  bad("parses to > 0 ratings", `threw: ${(e as Error).message.slice(0, 200)}`);
}

// ── The three reds ──────────────────────────────────────────────────────────
if (selftest) {
  console.log("\nRED legs — each must throw its own message");

  // (a) header: rename the rater columns.
  const noHeader = widget
    .replace(/Cook Political Report/g, "Column A")
    .replace(/Inside Elections/g, "Column B")
    .replace(/Sabato's Crystal Ball/g, "Column C")
    .replace(/Sabato&#39;s Crystal Ball/g, "Column C");
  mustThrow("(a) header renamed", "expected exactly 1 table whose header names", () => parseRatingsTable(noHeader));

  // (b) district cells: rewrite the FIRST cell of every body row to a shape the
  // parser cannot know.
  //
  // TWO THINGS THIS LEG GOT WRONG BEFORE IT GOT THEM RIGHT, both worth keeping,
  // because each produced a green that meant nothing. A page-wide substitution
  // rewrote the RATING cells as well, so the floor never tripped. Scoping it
  // per-<tr> and replacing the first `<td>` then hit the COOK column, because
  // the district cell is a `<th scope="row">` — the leg came back with exactly
  // 148 ratings, which is inside-elections 70 + sabato 78, i.e. one column
  // silently removed and the other two intact. The mangle has to match what the
  // parser matches: the first `<th>` or `<td>` in the row.
  const allCells = widget.replace(/<tr[^>]*>[\s\S]*?<\/tr>/g, (row) =>
    row.replace(/<t([hd])([^>]*)>([\s\S]*?)<\/t[hd]>/, (_m, tag, attrs) => `<t${tag}${attrs}>ZZ-not-a-district-ZZ</t${tag}>`),
  );
  mustThrow("(b) district cells mangled", "rows yielded a race id", () => parseRatingsTable(allCells));

  // (c) every rating Solid Republican -> nothing competitive survives NORMALIZE.
  const allSolid = widget.replace(
    />(Likely|Lean|Tilt|Toss-up|Solid|Safe)[^<]*</g,
    ">Solid Republican<",
  );
  mustThrow("(c) every rating Solid", "scraped ZERO competitive ratings", () => parseRatingsTable(allSolid));
}

// ── Discovery, when a page fixture is given ─────────────────────────────────
if (pagePath) {
  console.log(`\nDISCOVERY — ${pagePath}`);
  const page = readFileSync(pagePath, "utf8");
  try {
    const url = discoverWidgetUrl(page);
    ok("exactly one widget data-url", url);
  } catch (e) {
    bad("exactly one widget data-url", (e as Error).message.slice(0, 200));
  }
  if (selftest) {
    const stripped = page.replace(/race-ratings-full-table/g, "some-other-widget");
    mustThrow("(d) widget div removed", "expected exactly 1 race-ratings widget", () => discoverWidgetUrl(stripped));
  }
}

console.log(`\n${failures === 0 ? "ALL LEGS BEHAVED" : `${failures} LEG(S) MISBEHAVED`}`);
process.exit(failures === 0 ? 0 : 1);
