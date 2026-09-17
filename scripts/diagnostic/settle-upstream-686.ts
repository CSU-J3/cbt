// HO 686 — READ-ONLY upstream read. Does Ballotpedia carry a winner NOW for the
// settle-window rows, and what date does the source itself give the contest?
//
// BUILDS NOTHING AND WRITES NOTHING. No DB writes of any kind — the DB is read
// only to name the rows to compare against. The upstream side is a live fetch.
//
// INSTRUMENT: the EXISTING scrape path (`scrapeHouseCandidates` /
// `scrapeSenateCandidates` from lib/primary-candidates-scrape), NOT a raw fetch.
// That is deliberate — the question is "would the recovery heal this row", and
// the recovery (backfill-primary-results / reingest-primary-slate) reads through
// exactly those functions. A raw fetch could report a winner the parser does not
// extract, which would be a wrong answer to the question actually being asked.
//
// `bypassCache: true` is MANDATORY (HO 206) on the HOUSE path: `.cache/ballotpedia`
// is pre-results HTML scraped ~May 20, so a cached read reports NO winner for every
// contest and is indistinguishable from a genuine upstream gap.
// `scrapeSenateCandidates` takes no `opts` and is already cache-free.
//
// CONTROL. A target is read beside a contest known settled-and-healed in our DB.
// If the control shows a winner upstream and the target does not, the target's
// gap is real. If the CONTROL shows no winner either, the parser or the fetch is
// the problem and the target reading is void — a zero here would otherwise mean
// "no winner upstream" and "instrument blind" identically, which is the whole
// failure mode this control exists to separate.
//
// ── HO 731 — ID-DRIVEN, in the shape `settle-window-686.ts` already has (`:57-60`).
//
// WHAT CHANGED: contest ids may be passed positionally. Each one's `state`,
// `district` and `chamber` are read OFF THE `primaries` ROW rather than parsed out
// of the id, so this file mirrors no id grammar and makes no new claim about one.
// `chamber` dispatches to the house or the senate scrape.
//
// WHY THE HO 686 PAIR STAYS: it is the DEFAULT when no ids are passed, and a
// no-args run is the DEFAULT-PATH CONTROL for this change — the extension adds a
// path, and the old path has to be shown unmoved.
//
// A CONTROL PER FUNCTION, because a control for one is no control for the other.
// The House control is HO 686's `house-WA-08-2026-open`. The Senate control is the
// newest senate row carrying `status='winner'`, chosen by query and named in the
// output. If a chamber's control shows no winner upstream, that chamber's TARGET
// reading is VOID — which is a different statement from "no advancer upstream".
//
// A NON-FINITE `district` IS A HALT, and the check is scoped to `chamber='house'`:
// `primaries.district` is TEXT and nullable (`scripts/migrate.ts:457`), a senate row
// carries NULL there by design, and the senate scrape takes no district — so halting
// on that NULL would be a gate firing on its own target (HO 731 STEP 0).
//
// `--out <dir>`: for HOUSE seats only, copy the page the parser read into <dir> and
// print each candidate row's raw `class="results_row…"` value beside its visible
// text. `isWinner` is a per-row class test (`lib/primary-candidates-scrape.ts:212`),
// so without this "the page marks N" and "the parser marks N" are the same output.
// Senate pages carry no copy — `scrapeSenateCandidates` never calls
// `writeCachedHtml` — and the instrument says so rather than printing nothing.
//
//   npx tsx scripts/diagnostic/settle-upstream-686.ts
//   npx tsx scripts/diagnostic/settle-upstream-686.ts house-AK-00-2026-open senate-AK-2026-open --out docs/handoffs/731-artifacts
import "dotenv/config";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "@/lib/db";
import {
  scrapeHouseCandidates,
  scrapeSenateCandidates,
} from "@/lib/primary-candidates-scrape";
import { stateName } from "@/lib/states";

const SLEEP_MS = 1100; // Ballotpedia politeness, matching the cron's per-unit pace
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Seat = {
  role: string;
  primaryId: string;
  state: string;
  chamber: string;
  district: number | null;
};

// HO 686's pair, retained verbatim as the DEFAULT — and therefore as this
// change's default-path control. role: which question this seat answers;
// "control" must show a winner.
const DEFAULT_SEATS: Seat[] = [
  { role: "TARGET ", primaryId: "house-AZ-03-2026-R", state: "AZ", chamber: "house", district: 3 },
  { role: "CONTROL", primaryId: "house-WA-08-2026-open", state: "WA", chamber: "house", district: 8 },
];

const HOUSE_CONTROL_ID = "house-WA-08-2026-open";

// Mirror of `cacheFileFor` (lib/primary-candidates-scrape.ts:257-262, read at
// `2ba95e0`). The house scrape writes the fetched page there on its success path
// (`:564`) even under `bypassCache`, so this reads THE SAME BYTES the parser read
// — no second fetch, no second parser. If the mirror is ever wrong the file is not
// found and this prints so; it cannot silently print a different page.
function cachedPathFor(url: string): string {
  const name = url
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[^a-zA-Z0-9]+/g, "_");
  return join(process.cwd(), ".cache", "ballotpedia", `${name}.html`);
}

// Same row expression the parser uses (`lib/primary-candidates-scrape.ts:171` at
// `2ba95e0`), so the rows printed here are the rows `isWinner` was tested against.
const ROW_RE = /<tr class="results_row[^"]*">[\s\S]*?<\/tr>/g;
const stripTags = (s: string) =>
  s.replace(/<[^>]*>/g, " ").replace(/&#160;|&nbsp;/g, " ").replace(/\s+/g, " ").trim();

function dumpRawRows(url: string, outDir: string, label: string): void {
  const src = cachedPathFor(url);
  if (!existsSync(src)) {
    console.log(`   raw rows: NO CACHED COPY at ${src} — not dumped (the scrape's write path did not run)`);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, `${label}.html`);
  copyFileSync(src, dest);
  const html = readFileSync(src, "utf8");
  const rows = html.match(ROW_RE) ?? [];
  console.log(`   raw rows: ${rows.length} \`results_row\` rows in the page the parser read → ${dest}`);
  for (const row of rows) {
    const cls = row.match(/<tr class="(results_row[^"]*)">/)?.[1] ?? "?";
    console.log(`     class="${cls}"  |  ${stripTags(row).slice(0, 160)}`);
  }
}

async function readSeat(
  db: ReturnType<typeof getDb>,
  seat: Seat,
  outDir: string | null,
): Promise<void> {
  const slug = stateName(seat.state).replace(/ /g, "_");
  const res =
    seat.chamber === "house"
      ? await scrapeHouseCandidates(seat.state, slug, seat.district!, { bypassCache: true })
      : await scrapeSenateCandidates(seat.state, slug);

  const seatLabel =
    seat.chamber === "house"
      ? `${seat.state}-${String(seat.district).padStart(2, "0")}`
      : `${seat.state}-SEN`;
  console.log(`── ${seat.role}  ${seatLabel}  (${seat.primaryId})`);
  console.log(`   row says: state=${seat.state} district=${seat.district ?? "NULL"} chamber=${seat.chamber}`);
  console.log(`   url=${res.url}`);
  console.log(`   status=${res.status}  candidates=${res.candidates.length}`);

  const byContest = new Map<string, typeof res.candidates>();
  for (const c of res.candidates) {
    const k = c.contest;
    if (!byContest.has(k)) byContest.set(k, []);
    byContest.get(k)!.push(c);
  }
  for (const [contest, list] of byContest) {
    const winners = list.filter((c) => c.isWinner);
    console.log(`   contest "${contest}": ${list.length} candidates, ${winners.length} marked winner`);
    for (const c of list) {
      console.log(
        `     ${c.isWinner ? "WINNER " : "       "} ${String(c.votePct ?? "—").padStart(6)}%  ${c.name} (${c.party ?? "?"})${c.incumbent ? " [INC]" : ""}`,
      );
    }
  }
  if (byContest.size === 0) console.log("   (no contests parsed)");

  if (outDir) {
    if (seat.chamber === "house") dumpRawRows(res.url, outDir, seat.primaryId);
    else console.log("   raw rows: senate pages are not cached by the scrape path — no copy to dump");
  }

  // our side, for the same seat
  const ours = await db.execute({
    sql: `SELECT name, status, vote_pct FROM primary_candidates
           WHERE primary_id = ? ORDER BY (vote_pct IS NULL), vote_pct DESC`,
    args: [seat.primaryId],
  });
  const ourWinners = ours.rows.filter((r) => String(r.status) === "winner").length;
  console.log(`   OUR ${seat.primaryId}: ${ours.rows.length} rows, ${ourWinners} winner`);
  console.log("");
  await sleep(SLEEP_MS);
}

// Read state/district/chamber OFF the row. Returns null on a missing row (a
// finding) and halts the process on a house row whose district will not coerce.
async function seatFromRow(
  db: ReturnType<typeof getDb>,
  id: string,
  role: string,
): Promise<Seat | null> {
  const rs = await db.execute({
    sql: `SELECT id, state, district, chamber FROM primaries WHERE id = ?`,
    args: [id],
  });
  if (rs.rows.length === 0) {
    console.log(`── ${role}  ${id}`);
    console.log("   NO SUCH ROW in `primaries` — finding, not an absence of data.\n");
    return null;
  }
  const r = rs.rows[0]!;
  const chamber = String(r.chamber);
  let district: number | null = null;
  if (chamber === "house") {
    const raw = r.district;
    const n = Number(raw);
    if (raw === null || String(raw).trim() === "" || !Number.isFinite(n)) {
      console.log(
        `HALT — ${id} is a house row whose \`district\` does not coerce to a finite number: ` +
          `raw=${raw === null ? "NULL" : JSON.stringify(String(raw))}. Not coerced to 0.`,
      );
      process.exit(2);
    }
    district = n;
  }
  return { role, primaryId: id, state: String(r.state), chamber, district };
}

async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const outDir = outIdx >= 0 ? (argv[outIdx + 1] ?? null) : null;
  // `outIdx + 1` is the --out VALUE, not an id. Guarded on outIdx >= 0, or a
  // run with no --out would drop argv[0] — its first contest id.
  const ids = argv.filter(
    (a, i) => !a.startsWith("--") && !(outIdx >= 0 && i === outIdx + 1),
  );

  const db = getDb();
  console.log("HO 686 — upstream winner read (live Ballotpedia, via the scrape path)");
  console.log(
    ids.length
      ? `  ids from argv (${ids.length}); controls chosen per chamber\n`
      : "  no ids passed — HO 686 DEFAULT pair (this run is the default-path control)\n",
  );

  if (!ids.length) {
    for (const seat of DEFAULT_SEATS) await readSeat(db, seat, outDir);
    console.log("Read the CONTROL first: if it shows 0 winners upstream, the target reading is VOID.");
    return;
  }

  const targets: Seat[] = [];
  for (const id of ids) {
    const s = await seatFromRow(db, id, "TARGET ");
    if (s) targets.push(s);
  }

  // Controls first, one per chamber actually being read.
  const controls: Seat[] = [];
  if (targets.some((t) => t.chamber === "house")) {
    const s = await seatFromRow(db, HOUSE_CONTROL_ID, "CONTROL");
    if (s) controls.push(s);
  }
  if (targets.some((t) => t.chamber === "senate")) {
    const rs = await db.execute(
      `SELECT p.id FROM primaries p
        WHERE p.chamber = 'senate'
          AND EXISTS (SELECT 1 FROM primary_candidates pc
                       WHERE pc.primary_id = p.id AND pc.status = 'winner')
        ORDER BY p.primary_date DESC, p.id LIMIT 1`,
    );
    if (rs.rows.length === 0) {
      console.log("SENATE CONTROL: no senate row in `primaries` carries a winner — the senate target reading is VOID.\n");
    } else {
      const s = await seatFromRow(db, String(rs.rows[0]!.id), "CONTROL");
      if (s) controls.push(s);
    }
  }

  console.log("=== CONTROLS (read these first) ===");
  for (const seat of controls) await readSeat(db, seat, outDir);
  console.log("=== TARGETS ===");
  for (const seat of targets) await readSeat(db, seat, outDir);
  console.log(
    "Per chamber: if that chamber's CONTROL shows 0 winners upstream, its TARGET reading is VOID — not \"no advancer upstream\".",
  );
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
