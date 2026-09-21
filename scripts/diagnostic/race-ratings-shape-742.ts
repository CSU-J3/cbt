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
//   npx tsx scripts/diagnostic/race-ratings-shape-742.ts --selftest --chamber senate \
//     docs/handoffs/744-artifacts/bpwidget-senate-0920.html \
//     docs/handoffs/744-artifacts/senate-page-0920.html
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
// (competitive + locked == rows × 3, i.e. nothing classified as neither), the
// three sources present, the ±3 label/score contract the departure row is
// written from, and that no locked cell carries a Senate id. The file keeps its
// -742 name: this is the ingest's one instrument, not a per-HO artifact.
//
// HO 744 — `--chamber house|senate`, AND THE COLLISION IS ASSERTED, NOT
// TRUSTED. The parser is now chamber-parameterized because a Senate widget's
// id cell is a BARE STATE NAME and the House branch mints `{ST}-AL-2026` from
// it — four of which name live House races. Every leg below runs per chamber
// against that chamber's expected row count, and one leg is new and exists
// only for the collision: with both fixtures present, the House parse must
// contain no `S-`-prefixed id and the Senate parse no House-shaped one, and
// the two id sets must not intersect at all. That property is what keeps a
// Senate scrape from deleting House races; an assertion is the only thing
// that can notice it stopping being true.
import { readFileSync, existsSync } from "node:fs";
import {
  discoverWidgetUrl,
  parseRatingsTable,
  captionAsOfDate,
  type Chamber,
  type RatingsScrape,
} from "@/lib/race-ratings-scrape";

const args = process.argv.slice(2);
const selftest = args.includes("--selftest");
const chamberArg = args[args.indexOf("--chamber") + 1];
const chamber: Chamber = args.includes("--chamber") && chamberArg === "senate" ? "senate" : "house";
if (args.includes("--chamber") && chamberArg !== "house" && chamberArg !== "senate") {
  console.error(`--chamber must be house|senate, got ${JSON.stringify(chamberArg)}`);
  process.exit(2);
}
// Per chamber: the widget's row count, and the fixtures used when none are
// named. The row count is the instrument's own copy — deliberately NOT read
// from the scraper's EXPECTED_ROWS, because a check that shares its constant
// with its subject cannot catch that constant being wrong (method.md § Gates).
const EXPECTED_ROWS: Record<Chamber, number> = { house: 435, senate: 35 };
const DEFAULT_WIDGET: Record<Chamber, string> = {
  house: "docs/handoffs/742-artifacts/bpwidget-ratings.html",
  senate: "docs/handoffs/744-artifacts/bpwidget-senate-0920.html",
};
const paths = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--chamber");
const widgetPath = paths[0] ?? DEFAULT_WIDGET[chamber];
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
console.log(`chamber: ${chamber}\nfixture: ${widgetPath} (${widget.length} bytes)\n`);

// ── GREEN: the real thing ───────────────────────────────────────────────────
console.log("GREEN — the saved widget response");
try {
  const { ratings: out, locked, sourcesPresent } = parseRatingsTable(widget, chamber);
  if (out.length > 0) ok("parses to > 0 ratings", `${out.length} competitive ratings`);
  else bad("parses to > 0 ratings", "0");
  const bySource = new Map<string, number>();
  for (const r of out) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  ok("per source", [...bySource.entries()].map(([k, v]) => `${k}=${v}`).join(" "));
  // The at-large branch, and the seat that makes it matter. HO 744: the Senate
  // side's equivalent is Maine, competitive on all three raters since January
  // and the one Senate seat nobody has ever moved out of Toss-up/Tilt.
  const probeId = chamber === "house" ? "AK-AL-2026" : "S-ME-2026";
  const probeLabel = chamber === "house" ? "AK-AL-2026 (the at-large branch)" : "S-ME-2026 (the id form)";
  const probe = out.filter((r) => r.raceId === probeId);
  if (probe.length === 3) ok(probeLabel, probe.map((r) => `${r.source}=${r.rating}`).join(" "));
  else bad(probeLabel, `expected 3 rows, got ${probe.length}`);
  const asOf = captionAsOfDate(widget);
  if (asOf) ok("caption as-of date", asOf);
  else bad("caption as-of date", "did not parse");

  // ── HO 743: the locked cells are now part of the return, and the cell census
  // is the assertion — every (district, rater) cell is competitive, locked, or
  // empty, and the widget renders no empty ones today. Printing all three is
  // what makes a future drift legible: if `locked + ratings` stops reconciling
  // to 435 × 3, the difference is cells the parser saw and classified as
  // neither, which is precisely the silent skip HO 742 exists to prevent.
  const CELLS = EXPECTED_ROWS[chamber] * 3;
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

  // EVERY id this chamber produced is this chamber's shape — ratings AND
  // locked cells, because either one can reach a DELETE or an UPSERT.
  //
  // Before HO 744 this was one-way and rested on a construction argument: the
  // widget was `office_type=House`, so an `S-` id could not appear. Both
  // chambers are read now and the construction is gone, so the assertion has
  // to hold in both directions and over both arrays. A House-shaped id in the
  // Senate parse is the collision live; an `S-` id in the House parse is the
  // same bug wearing the other hat.
  const SHAPE: Record<Chamber, RegExp> = {
    house: /^[A-Z]{2}-(\d{2}|AL)-\d{4}$/,
    senate: /^S-[A-Z]{2}-\d{4}$/,
  };
  const everyId = [...out.map((r) => r.raceId), ...locked.map((c) => c.raceId)];
  const wrongShape = everyId.filter((id) => !SHAPE[chamber].test(id));
  if (wrongShape.length === 0)
    ok(`every id is ${chamber}-shaped`, `${everyId.length} checked (${new Set(everyId).size} distinct)`);
  else
    bad(
      `every id is ${chamber}-shaped`,
      `${wrongShape.length} are not, e.g. ${wrongShape.slice(0, 3).join(", ")}`,
    );
  const distinct = new Set(everyId).size;
  if (distinct === EXPECTED_ROWS[chamber]) ok("distinct race ids", `${distinct}`);
  else bad("distinct race ids", `${distinct}, expected ${EXPECTED_ROWS[chamber]}`);
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
  mustThrow("(a) header renamed", "expected exactly 1 table whose header names", () => parseRatingsTable(noHeader, chamber));

  // (b) id cells: rewrite the FIRST cell of every body row to a shape the
  // parser cannot know.
  //
  // THREE THINGS THIS LEG GOT WRONG BEFORE IT GOT THEM RIGHT, all worth
  // keeping, because each produced a green that meant nothing. A page-wide
  // substitution rewrote the RATING cells as well, so the floor never tripped.
  // Scoping it per-<tr> and replacing the first `<td>` then hit the COOK
  // column, because the id cell is a `<th scope="row">` — the leg came back
  // with exactly 148 ratings, which is inside-elections 70 + sabato 78, i.e.
  // one column silently removed and the other two intact. The mangle has to
  // match what the parser matches: the first `<th>` or `<td>` in the row.
  //
  // THE THIRD, FOUND AT HO 744 BY POINTING THIS LEG AT THE SENATE. The <tr>
  // sweep did not stop at the body — it rewrote the HEADER row's first cell
  // too. On the House that still reached the floor throw, and for a reason
  // that is pure luck: the replacement string contains the substring
  // "district", so the header check (`h.toLowerCase().includes("district")`)
  // went on matching a header cell reading `ZZ-not-a-district-ZZ`. Point the
  // same mangle at the Senate, whose token is "state", and the HEADER throw
  // fires instead — a red leg passing under the wrong throw for four HOs,
  // visible only because a second chamber existed to disagree. The fix is the
  // one the comment above always claimed: scope the sweep to <tbody>.
  const allCells = widget.replace(/<tbody>[\s\S]*?<\/tbody>/, (body) =>
    body.replace(/<tr[^>]*>[\s\S]*?<\/tr>/g, (row) =>
      row.replace(/<t([hd])([^>]*)>([\s\S]*?)<\/t[hd]>/, (_m, tag, attrs) => `<t${tag}${attrs}>ZZ-not-an-id-ZZ</t${tag}>`),
    ),
  );
  mustThrow("(b) id cells mangled", "rows yielded a race id", () => parseRatingsTable(allCells, chamber));

  // (c) every rating Solid Republican -> nothing competitive survives NORMALIZE.
  const allSolid = widget.replace(
    />(Likely|Lean|Tilt|Toss-up|Solid|Safe)[^<]*</g,
    ">Solid Republican<",
  );
  mustThrow("(c) every rating Solid", "scraped ZERO competitive ratings", () => parseRatingsTable(allSolid, chamber));

  // (e) HO 744 — THE FLOOR IS THE CHAMBER'S. This red exists because the House
  // number could not be reused: the floor read a hard `435 - 5`, so a 35-row
  // Senate table failed it unconditionally, and the header throw firing first
  // is what kept that invisible. Feeding this chamber's widget to the OTHER
  // chamber's parse is the sharpest available probe of both halves at once —
  // it must throw, and for a reason that names the mismatch rather than
  // succeeding on a wrong-shaped id.
  const other: Chamber = chamber === "house" ? "senate" : "house";
  mustThrow(
    `(e) parsed as ${other}`,
    "header matched the table but not its columns",
    () => parseRatingsTable(widget, other),
  );
}

// ── HO 744: THE COLLISION, when both fixtures are on disk ───────────────────
//
// The one property nothing else can check from inside a single chamber's run:
// the two chambers' id spaces do not overlap. If they ever do, a Solid/Safe
// cell in one chamber retires a row in the other — which is the failure this
// HO was written to make impossible, and it would otherwise show up as a
// perfectly clean parse on both sides.
{
  const houseFixture = chamber === "house" ? widgetPath : DEFAULT_WIDGET.house;
  const senateFixture = chamber === "senate" ? widgetPath : DEFAULT_WIDGET.senate;
  if (existsSync(houseFixture) && existsSync(senateFixture)) {
    console.log("\nCROSS-CHAMBER — the id spaces must not intersect");
    try {
      const h = parseRatingsTable(readFileSync(houseFixture, "utf8"), "house");
      const s = parseRatingsTable(readFileSync(senateFixture, "utf8"), "senate");
      const hIds = new Set([...h.ratings, ...h.locked].map((r) => r.raceId));
      const sIds = new Set([...s.ratings, ...s.locked].map((r) => r.raceId));
      const both = [...hIds].filter((i) => sIds.has(i));
      if (both.length === 0) ok("House ∩ Senate id sets", `0 of ${hIds.size} × ${sIds.size}`);
      else bad("House ∩ Senate id sets", `${both.length} shared, e.g. ${both.slice(0, 5).join(", ")}`);
      const sInH = [...hIds].filter((i) => i.startsWith("S-"));
      const hInS = [...sIds].filter((i) => !i.startsWith("S-"));
      if (sInH.length === 0) ok("no Senate id in the House parse", `${hIds.size} checked`);
      else bad("no Senate id in the House parse", `${sInH.length}, e.g. ${sInH[0]}`);
      if (hInS.length === 0) ok("no House id in the Senate parse", `${sIds.size} checked`);
      else bad("no House id in the Senate parse", `${hInS.length}, e.g. ${hInS[0]}`);
    } catch (e) {
      bad("cross-chamber parse", (e as Error).message.slice(0, 200));
    }
  } else {
    console.log(
      `\nCROSS-CHAMBER — skipped, ${existsSync(houseFixture) ? senateFixture : houseFixture} not on disk`,
    );
  }
}

// ── Discovery, when a page fixture is given ─────────────────────────────────
if (pagePath) {
  console.log(`\nDISCOVERY — ${pagePath}`);
  const page = readFileSync(pagePath, "utf8");
  try {
    const url = discoverWidgetUrl(page, chamber);
    ok("exactly one widget data-url", url);
  } catch (e) {
    bad("exactly one widget data-url", (e as Error).message.slice(0, 200));
  }
  if (selftest) {
    const stripped = page.replace(/race-ratings-full-table/g, "some-other-widget");
    mustThrow("(d) widget div removed", "expected exactly 1 race-ratings widget", () => discoverWidgetUrl(stripped, chamber));
    // HO 744: discovery is per `office_type`, so one chamber's page must NOT
    // yield the other's widget. Without this, a discovery that ignored the
    // office type would read green on both chambers and hand each leg the
    // same table.
    const other: Chamber = chamber === "house" ? "senate" : "house";
    mustThrow(
      `(f) ${chamber} page has no ${other} widget`,
      "expected exactly 1 race-ratings widget",
      () => discoverWidgetUrl(page, other),
    );
  }
}

console.log(`\n${failures === 0 ? "ALL LEGS BEHAVED" : `${failures} LEG(S) MISBEHAVED`}`);
process.exit(failures === 0 ? 0 : 1);
