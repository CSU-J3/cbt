// Diagnostic (read-only, HO 273 Phase 1): sample committee_meetings.title strings
// to calibrate cleanMeetingTitle's leading-procedural-phrase strip rules against
// the real corpus. Run: `npx tsx scripts/diagnostic/hearing-titles-273.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

// Candidate leading phrases (case-insensitive) — count how many titles start with each.
const PREFIXES = [
  "Hearings to examine ",
  "Hearing to examine ",
  "Business meeting to consider ",
  "Closed business meeting to consider ",
  "Executive session to consider ",
  "To receive a closed briefing on ",
  "To receive a briefing on ",
  "To receive a closed briefing regarding ",
  "Markup of ",
  "Full committee markup of ",
  "Subcommittee markup of ",
  "Oversight hearing on ",
  "Field hearing on ",
  "Hearing on ",
  "An oversight hearing to examine ",
  "Hearings to consider ",
];

async function main() {
  const db = getDb();

  const total = await db.execute(
    `SELECT COUNT(*) c FROM committee_meetings WHERE title IS NOT NULL AND TRIM(title) <> ''`,
  );
  console.log(`total non-empty titles: ${total.rows[0]?.c}\n`);

  console.log("=== prefix hit counts (case-insensitive LIKE) ===");
  for (const p of PREFIXES) {
    const esc = p.replace(/%/g, "\\%").replace(/_/g, "\\_");
    const r = await db.execute({
      sql: `SELECT COUNT(*) c FROM committee_meetings
            WHERE LOWER(title) LIKE LOWER(?) ESCAPE '\\'`,
      args: [`${esc}%`],
    });
    console.log(`${String(r.rows[0]?.c).padStart(5)}  ${p}`);
  }

  console.log("\n=== 60 sample titles (most recent) ===");
  const sample = await db.execute(
    `SELECT title FROM committee_meetings
     WHERE title IS NOT NULL AND TRIM(title) <> ''
     ORDER BY meeting_date DESC LIMIT 60`,
  );
  for (const r of sample.rows) console.log(`  ${r.title}`);

  console.log("\n=== distinct leading word (first token), top 30 ===");
  const titles = await db.execute(
    `SELECT title FROM committee_meetings
     WHERE title IS NOT NULL AND TRIM(title) <> ''`,
  );
  const firstWord = new Map<string, number>();
  for (const r of titles.rows) {
    const w = String(r.title).trim().split(/\s+/).slice(0, 3).join(" ");
    firstWord.set(w, (firstWord.get(w) ?? 0) + 1);
  }
  const sorted = [...firstWord.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  for (const [w, c] of sorted) console.log(`${String(c).padStart(5)}  ${w}`);
}

main().then(() => process.exit(0));
