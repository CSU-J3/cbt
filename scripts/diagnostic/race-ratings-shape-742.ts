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
import { readFileSync } from "node:fs";
import {
  discoverWidgetUrl,
  parseRatingsTable,
  captionAsOfDate,
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
    bad(label, `did NOT throw — returned ${Array.isArray(out) ? out.length + " ratings" : typeof out}`);
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
  const out = parseRatingsTable(widget);
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
