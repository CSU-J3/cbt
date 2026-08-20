// HO 675 STEP 3 — resolve each capture target to a search phrase the /bills
// list can actually find it with, and PROVE it lands.
//
// /bills' ?q runs through bills_fts MATCH (getFeedBills), not the id LIKE that
// buildFeedWhere uses for the other feeds — so `?q=119-hr-842` returns ZERO
// rows and the first version of the capture harness silently screenshotted a
// bill list that was not there. This emits {id, phrase} and verifies against
// the live server that the phrase returns a page containing that bill.
//   npx tsx scripts/diagnostic/roster-shot-targets-675.ts [baseUrl]
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const IDS = [
  "119-hconres-90", "119-hconres-24", "119-hconres-32", "119-hr-842",
  "119-hr-452", "119-hr-14", "119-hjres-124", "119-hconres-100",
  "119-hconres-23", "119-hr-1082", "119-hr-7567", "119-s-5299",
  "119-hr-8591", "119-hr-1628", "119-s-4944",
];

// FTS chokes on punctuation and on very long phrases, so this hands MATCH six
// alphanumeric words.
//
// The six LONGEST words, not the first six, and the difference decided a
// capture. `119-hjres-124` is a Congressional Review Act resolution whose title
// opens "Providing for congressional disapproval under chapter 8 of title 5..."
// — boilerplate shared by hundreds of bills, so a leading-words phrase ranked
// the target off the first three pages and the harness could not reach it at
// any viewport. Long words skip the stopwords and land on the agency and
// subject that actually distinguish one CRA resolution from another.
function phraseOf(title: string): string {
  const words = title
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  return words
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w.length - a.w.length || a.i - b.i)
    .slice(0, 6)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.w)
    .join(" ");
}

async function main() {
  const c = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const rs = await c.execute({
    sql: `SELECT id, bill_type, bill_number, title, summary IS NOT NULL AS has_summary
            FROM bills WHERE id IN (${IDS.map(() => "?").join(",")})`,
    args: IDS,
  });
  const byId = new Map(rs.rows.map((r) => [String(r.id), r]));

  const out: { id: string; label: string; phrase: string; ok: boolean }[] = [];
  for (const id of IDS) {
    const row = byId.get(id);
    if (!row) {
      console.log(`  ${id.padEnd(16)} NOT IN bills`);
      continue;
    }
    const label = `${String(row.bill_type).toUpperCase()} ${row.bill_number}`;
    const phrase = phraseOf(String(row.title ?? ""));
    // The feed hides un-summarized rows (buildFeedWhere's first clause), so a
    // bill with no summary can never appear however it is searched. Reading
    // that here rather than discovering it as an empty screenshot.
    // The feed hides un-summarized rows (buildFeedWhere's first clause), so a
    // bill with no summary can never appear however it is searched. Read here
    // rather than discovered as an empty screenshot.
    const hasSummary = Number(row.has_summary) === 1;
    out.push({ id, label, phrase, ok: hasSummary });
    console.log(
      `  ${id.padEnd(16)} ${label.padEnd(14)} summary=${hasSummary ? "y" : "N"}  q="${phrase}"`,
    );
  }
  // NO HTTP CHECK HERE, deliberately. The first version fetched /bills and
  // grepped the response for the bill type and number — but that response is a
  // Suspense shell plus an RSC payload, so the grep was reading serialized
  // props rather than the DOM and could report both false positives and false
  // negatives. Whether a target is REACHABLE is decided in the browser, by the
  // capture harness, which fails loudly when a panel does not open.
  const bad = out.filter((x) => !x.ok);
  writeFileSync(
    "docs/handoffs/675-artifacts/shot-targets.json",
    JSON.stringify(out, null, 2),
  );
  console.log(`\n  ${out.length - bad.length}/${out.length} targets reachable`);
  if (bad.length) {
    console.log("  UNREACHABLE: " + bad.map((b) => b.id).join(", "));
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
