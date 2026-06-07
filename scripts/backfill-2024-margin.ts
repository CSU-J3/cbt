// HO 214 — one-time 2024 House general-election margin backfill. For each
// House seat in getRacesIndex(2026), scrape the per-seat Ballotpedia 2024
// election page and write the signed margin into races.margin_2024.
//
// Confirmed source/isolation (HO 213 probe + HO 214 pre-flight):
//   - URL: the canonical 2024-election link is harvested from the cached 2026
//     page (ground truth — sidesteps the possessive variance that 404'd a
//     templated TX-15: "Texas%27_" vs "Maine%27s_"); template fallback if the
//     cache/link is missing. ALL 435 cached House pages carry the 2024 link.
//   - Votebox isolation: scope to the page's main "Candidates and election
//     results" section (drops the District_history historical generals that
//     share the "General election for U.S. House" header — the wrong-votebox
//     trap, HO 206), take the General-election votebox whose slice carries a
//     2024 date, read its results_table shares. Margin = winner% − runner-up%.
//   - Party (for the sign): bar-color class → fusion "(D / …)" suffix →
//     thumbnail wrapper. Sign: R-won positive, D-won negative.
//
// Honest gaps (reported, never silently dropped):
//   - Senate seats: skipped (no 2024 general — last ran 2020/2022).
//   - RCV states (Maine, Alaska): the 2024 result is an RCV widget, not a
//     standard votebox → no margin, reported as "no 2024 general votebox".
//   - 404 / unresolved URLs: reported with the seat list.
//
// Browser-UA live fetch (curl/WebFetch get a bot stub); polite ~1.1s pacing;
// idempotent (overwrites on re-run). Run: `npm run backfill:2024-margin`.
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../lib/db";
import { houseDistrictUrl } from "../lib/primary-candidates-scrape";
import { stateName } from "../lib/states";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const SLEEP_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function strip(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function partyLetter(w: string | undefined): "R" | "D" | "L" | "G" | "I" {
  const s = (w ?? "").toLowerCase();
  if (s.startsWith("republ") || s === "r") return "R";
  if (s.startsWith("democr") || s === "d") return "D";
  if (s.startsWith("libert") || s === "l") return "L";
  if (s.startsWith("green") || s === "g") return "G";
  return "I";
}

// Party for one general-election results row. Three markups in the wild:
// the bar color class (inner_percentage Republican), NY fusion text suffix
// ("(D / Working Families Party)"), and the thumbnail wrapper word.
function rowParty(row: string): "R" | "D" | "L" | "G" | "I" {
  const bar = row.match(/inner_percentage\s+([A-Za-z]+)\s*"/)?.[1];
  if (bar && bar.toLowerCase() !== "unknown") return partyLetter(bar);
  const suf = row.match(/<\/a>\s*\(\s*([A-Za-z]+)/)?.[1];
  if (suf) return partyLetter(suf);
  const wrap = row.match(/image-candidate-thumbnail-wrapper\s+([A-Za-z]+)/)?.[1];
  if (wrap) return partyLetter(wrap);
  return "I";
}

type Extracted =
  | { ok: true; signed: number; winner: string; winnerParty: string; runner: string; shares: string }
  | { ok: false; reason: "no-section" | "no-2024-general" | "lt2" };

// Isolate the 2024 general votebox in the main section and compute the margin.
function extractMargin(html: string): Extracted {
  const a = html.indexOf('id="Candidates_and_election_results"');
  if (a === -1) return { ok: false, reason: "no-section" };
  const nextH2 = html.indexOf("<h2", a + 10);
  const section = html.slice(a, nextH2 === -1 ? a + 120_000 : nextH2);

  for (const m of section.matchAll(
    /<h5[^>]*votebox-header-election-type[^>]*>([\s\S]*?)<\/h5>/g,
  )) {
    if (!/General election/i.test(strip(m[1] ?? ""))) continue;
    const slice = section.slice(m.index ?? 0, (m.index ?? 0) + 9000);
    // Guard: the box must be the 2024 general, not an embedded special/other.
    if (!/2024/.test(slice.slice(0, 1500))) continue;
    const table = slice.match(/<table class="results_table">[\s\S]*?<\/table>/)?.[0];
    if (!table) continue;

    const cands: Array<{ name: string; party: string; pct: number }> = [];
    for (const row of table.match(/<tr class="results_row[^"]*">[\s\S]*?<\/tr>/g) ?? []) {
      const name = strip(
        row.match(/<a [^>]*href="https:\/\/ballotpedia\.org\/[^"]*"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "",
      );
      if (!name) continue; // "Other/Write-in" aggregate rows carry no link
      // Prefer the high-precision bar width over the rounded percentage_number.
      const width = row.match(/inner_percentage[^"]*"\s+style="width:\s*([0-9.]+)%/)?.[1];
      const pn = row.match(/percentage_number">\s*([0-9.]+)/)?.[1];
      const pct = width != null ? Number(width) : pn != null ? Number(pn) : null;
      if (pct == null || !Number.isFinite(pct)) continue;
      cands.push({ name, party: rowParty(row), pct });
    }
    const v = cands.sort((x, y) => y.pct - x.pct);
    if (v.length < 2) return { ok: false, reason: "lt2" };
    const top = v[0]!;
    const second = v[1]!;
    const mag = Number((top.pct - second.pct).toFixed(2));
    const signed = top.party === "D" ? -mag : mag; // R/other positive, D negative
    return {
      ok: true,
      signed,
      winner: top.name,
      winnerParty: top.party,
      runner: second.name,
      shares: `${top.name} ${top.pct.toFixed(1)}% vs ${second.name} ${second.pct.toFixed(1)}%`,
    };
  }
  return { ok: false, reason: "no-2024-general" };
}

// Resolve the 2024 page URL. Primary: the canonical link inside the cached 2026
// page (handles all naming variance). Fallback: the 2024 template.
function resolve2024Url(state: string, district: number): string | null {
  const slug = stateName(state).replace(/ /g, "_");
  const url2026 = houseDistrictUrl(slug, district);
  const cacheName =
    url2026.replace(/^https?:\/\/(www\.)?/, "").replace(/[^a-zA-Z0-9]+/g, "_") + ".html";
  const cachePath = join(process.cwd(), ".cache", "ballotpedia", cacheName);
  if (existsSync(cachePath)) {
    const cached = readFileSync(cachePath, "utf8");
    const href = cached.match(
      /href="(\/[^"]*Congressional_District_election[^"]*2024)"/,
    )?.[1];
    if (href) return `https://ballotpedia.org${href}`;
  }
  // Fallback: the 2026 template with the year swapped.
  return url2026.replace("_2026", "_2024");
}

async function fetchHtml(url: string): Promise<{ status: number; html: string }> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow" });
    return { status: r.status, html: r.ok ? await r.text() : "" };
  } catch {
    return { status: 0, html: "" };
  }
}

async function main() {
  const db = getDb();

  const seatsRs = await db.execute(`
    SELECT r.id, r.state, r.district
    FROM races r
    WHERE r.cycle = 2026 AND r.chamber = 'house'
      AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026)
    ORDER BY r.state, r.district
  `);
  const seats = seatsRs.rows;
  console.log(`HO 214: ${seats.length} House index seats to process (Senate skipped by design).\n`);

  let written = 0;
  const notResolved: string[] = []; // 404 / fetch failure
  const noGeneral: string[] = []; // resolved but no standard 2024 general votebox (RCV etc.)
  const spot: string[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < seats.length; i++) {
    const row = seats[i]!;
    const raceId = row.id as string;
    const state = row.state as string;
    const district = Number(row.district);

    const url = resolve2024Url(state, district);
    if (!url) {
      notResolved.push(`${raceId} (no url)`);
      continue;
    }
    const { status, html } = await fetchHtml(url);
    if (status !== 200 || !html) {
      notResolved.push(`${raceId} (http ${status})`);
      await sleep(SLEEP_MS);
      continue;
    }
    const ex = extractMargin(html);
    if (!ex.ok) {
      noGeneral.push(`${raceId} (${ex.reason})`);
      await sleep(SLEEP_MS);
      continue;
    }
    await db.execute({
      sql: "UPDATE races SET margin_2024 = ? WHERE id = ?",
      args: [ex.signed, raceId],
    });
    written++;
    const label = ex.winnerParty === "D" ? `D+${Math.abs(ex.signed)}` : `${ex.winnerParty === "R" ? "R" : ex.winnerParty}+${Math.abs(ex.signed)}`;
    if (spot.length < 6) spot.push(`${raceId}: ${label} — ${ex.shares}`);

    if ((i + 1) % 20 === 0 || i + 1 === seats.length) {
      console.log(`  …${i + 1}/${seats.length} processed · ${written} margins written`);
    }
    await sleep(SLEEP_MS);
  }

  console.log("\n=== backfill complete ===");
  console.log(`margins written: ${written} / ${seats.length} House index seats`);
  console.log(`\nspot-checks (proves the 2024 GENERAL was read, not a primary):`);
  for (const s of spot) console.log(`  ${s}`);
  console.log(`\nno 2024 general votebox (RCV/structure — honest gap): ${noGeneral.length}`);
  for (const s of noGeneral) console.log(`  ${s}`);
  console.log(`\nunresolved / 404 (honest gap): ${notResolved.length}`);
  for (const s of notResolved) console.log(`  ${s}`);

  const coverage = await db.execute(
    `SELECT COUNT(*) AS n FROM races WHERE cycle=2026 AND chamber='house' AND margin_2024 IS NOT NULL
       AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id=races.id AND rr.cycle=2026)`,
  );
  console.log(`\ncoverage: ${coverage.rows[0]?.n ?? 0} House index seats now carry margin_2024.`);
  console.log("Flush cache: POST /api/revalidate?tag=races (Bearer CRON_SECRET).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
