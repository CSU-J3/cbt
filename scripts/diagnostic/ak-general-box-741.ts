// HO 741 — READ-ONLY. Read Ballotpedia's AK at-large 2026 page through the
// SCRAPER'S OWN path and print the two 2026 voteboxes side by side: the primary
// box the ingest reads, and the GENERAL box nothing reads.
//
// BUILDS NOTHING. One GET and one parse. No INSERT/UPDATE/DELETE, no seed call,
// no database connection at all.
//
//   npx tsx scripts/diagnostic/ak-general-box-741.ts
//
// WHY IT EXISTS, and why it is tracked rather than thrown away. The challenger
// harvest derives a GENERAL-ELECTION roster from `primary_candidates.status =
// 'winner'` — a PRIMARY result. On a top-four seat those two diverge the moment
// an advancer leaves the ballot, because Alaska replaces a withdrawn advancer
// with the next finisher. Measured here on 2026-09-20:
//
//   primary box  ✔ Begich 44.6 · ✔ Hill 32.5 · ✔ Hafner 3.8 · ✔ Williams 2.7
//                  Schultz 8.1 "(Unofficially withdrew)" — NOT marked
//                  McDermott 1.2 — not marked
//   general box    Begich · Hafner · McDermott · Hill
//                  Withdrawn or disqualified: John Brendan Williams
//
// `primary_candidates` matches the primary box name for name, so the ingest is
// FAITHFUL and re-running it changes nothing — `backfill:primary-results` and
// `reingest:primary-slate` re-derive the same four. What is missing is a reader
// for the second box. HO 743 is that reader, and it starts from this file.
//
// THE PAGE CARRIES SEVEN VOTEBOXES, four of them historical (2024 / 2022) with
// identical markup — the same trap `lib/primary-candidates-scrape.ts`'s header
// warns about for vote shares. The 2026 pair are selected by their <h5> text
// plus a marked-row count, never by position, so a page that gains a box does
// not silently shift the reading.
import {
  houseDistrictUrl,
  parseCandidatesPage,
} from "@/lib/primary-candidates-scrape";

// The scraper's own User-Agent. Ballotpedia 202s a bare/automation UA, so a
// bare fetch that "works" with a different one is not a reading of what the
// pipeline sees.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const STATE_SLUG = "Alaska";
const DISTRICT = 0; // at-large

function strip(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#160;/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Box = { index: number; h5: string; kind: string; rows: string[]; winners: number; withdrawn: string | null };

function voteboxes(html: string): Box[] {
  const anchor = html.indexOf('id="Candidates_and_election_results"');
  if (anchor === -1) throw new Error("no Candidates_and_election_results section — Ballotpedia served a challenge or restructured");
  const seg = html.slice(anchor);
  const raw = [
    ...seg.matchAll(/<div class="(?:[^"]*\b)?votebox\b[^"]*"[\s\S]*?(?=<div class="(?:[^"]*\b)?votebox\b|$)/g),
  ].map((m) => m[0]);
  return raw.map((b, index) => {
    const wd = b.indexOf("Withdrawn or disqualified");
    return {
      index,
      h5: strip((b.match(/<h5[^>]*>([\s\S]*?)<\/h5>/) ?? [null, ""])[1] ?? ""),
      kind: (b.match(/race_header\s+([a-z]+)/) ?? [null, "(bare)"])[1] ?? "(bare)",
      rows: [...b.matchAll(/<tr class="(results_row[^"]*)"[\s\S]*?<\/tr>/g)].map(
        (r) => `${/winner/.test(r[1] ?? "") ? "[WINNER] " : "[      ] "}${strip(r[0])}`,
      ),
      winners: (b.match(/results_row[^"]*winner/g) ?? []).length,
      withdrawn: wd === -1 ? null : strip(b.slice(wd, wd + 220)),
    };
  });
}

const url = houseDistrictUrl(STATE_SLUG, DISTRICT);
console.log("scraper-built URL :", url);

const res = await fetch(url, {
  headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  redirect: "follow",
});
const html = await res.text();
console.log("status            :", res.status, "| bytes:", html.length);
console.log("candidates anchor :", html.includes('id="Candidates_and_election_results"'));

// 1. What the INGEST sees — the shipped parser, unmodified.
const parsed = parseCandidatesPage(html, "AK", url);
console.log(`\n=== what lib/primary-candidates-scrape.ts reads (status: ${parsed.status}) ===`);
for (const c of parsed.candidates) {
  console.log(
    `  ${c.isWinner ? "WINNER" : "      "}  ${c.name.padEnd(24)} ${String(c.party).padEnd(3)}` +
      ` ${c.votePct === null ? "  null" : String(c.votePct).padStart(6)}%  ${c.votes ?? "null"}`,
  );
}
console.log(
  "  marked set:",
  parsed.candidates.filter((c) => c.isWinner).map((c) => c.name).join(" · ") || "(none)",
);

// 2. What NOTHING reads — the general box, selected by its own header text.
const boxes = voteboxes(html);
console.log(`\n=== voteboxes on the page: ${boxes.length} (the 2026 pair, plus historical) ===`);
const is2026Primary = (b: Box) => /^Nonpartisan primary for U\.S\. House/i.test(b.h5) && b.winners > 0;
const is2026General = (b: Box) => /^General election for U\.S\. House/i.test(b.h5) && b.winners === 0;
for (const b of boxes) {
  const tag = is2026General(b) ? "  <== THE BALLOT (nothing reads this)" : is2026Primary(b) ? "  <== the ingest reads this" : "";
  console.log(`  [${b.index}] winners=${b.winners} rows=${b.rows.length} kind=${b.kind} h5="${b.h5}"${tag}`);
}
for (const b of boxes.filter((x) => is2026General(x) || is2026Primary(x))) {
  console.log(`\n--- box ${b.index}: ${b.h5}`);
  for (const r of b.rows) console.log("   " + r.slice(0, 110));
  if (b.withdrawn) console.log("   " + b.withdrawn.slice(0, 150));
}

// 3. The divergence, stated rather than left to the reader.
const general = boxes.find(is2026General);
const primary = boxes.find(is2026Primary);
if (general && primary) {
  const nameOf = (row: string) => (row.match(/\]\s*(?:✔\s*)?(?:&#10004;\s*)?(?:Submit photo\s*)?([A-Za-z.' -]+?)\s*\(/) ?? [])[1]?.trim();
  const marked = primary.rows.filter((r) => r.startsWith("[WINNER]")).map(nameOf).filter(Boolean) as string[];
  const ballot = general.rows.map(nameOf).filter(Boolean) as string[];
  console.log("\n=== the divergence ===");
  console.log("  marked in the primary :", marked.join(" · "));
  console.log("  on the November ballot:", ballot.join(" · "));
  console.log("  marked but NOT on the ballot:", marked.filter((n) => !ballot.includes(n)).join(" · ") || "(none)");
  console.log("  on the ballot but NOT marked:", ballot.filter((n) => !marked.includes(n)).join(" · ") || "(none)");
}
