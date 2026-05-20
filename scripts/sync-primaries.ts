// handoff 91: primary tracker sync. Phase 1 lands the state-level primary
// calendar (all 50 states) into the `primaries` table. The Senate candidate
// rosters (Step 3) are a separate follow-up pass — see syncSenateCandidates.
import "dotenv/config";
import { getDb } from "../lib/db";
import { scrapeStatePrimaryCalendar } from "../lib/primary-calendar-scrape";

// Pulls the 270toWin calendar and upserts a D and an R primary row per state,
// plus an 'open' row for top-two / top-four states. Row id shape is
// "senate-{STATE}-2026-{party}" — the id prefix is a fixed convention from
// the handoff (the row carries the state's primary date, which applies to
// every contest that day regardless of chamber).
async function syncCalendar(): Promise<void> {
  const db = getDb();
  const calendar = await scrapeStatePrimaryCalendar();
  const now = new Date().toISOString();

  for (const entry of calendar) {
    for (const party of ["D", "R"] as const) {
      const id = `senate-${entry.state}-2026-${party}`;
      await db.execute({
        sql: `INSERT INTO primaries
                (id, state, chamber, party, primary_date, runoff_date, primary_type, updated_at)
              VALUES (?, ?, 'senate', ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                primary_date = excluded.primary_date,
                runoff_date = excluded.runoff_date,
                primary_type = excluded.primary_type,
                updated_at = excluded.updated_at`,
        args: [
          id,
          entry.state,
          party,
          entry.primaryDate,
          entry.runoffDate,
          entry.primaryType,
          now,
        ],
      });
    }

    // top-two / top-four states run a single all-candidate ballot — add an
    // 'open' row alongside the D/R rows.
    if (
      entry.primaryType === "top_two" ||
      entry.primaryType === "top_four"
    ) {
      const id = `senate-${entry.state}-2026-open`;
      await db.execute({
        sql: `INSERT INTO primaries
                (id, state, chamber, party, primary_date, runoff_date, primary_type, updated_at)
              VALUES (?, ?, 'senate', 'open', ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                primary_date = excluded.primary_date,
                runoff_date = excluded.runoff_date,
                primary_type = excluded.primary_type,
                updated_at = excluded.updated_at`,
        args: [
          id,
          entry.state,
          entry.primaryDate,
          entry.runoffDate,
          entry.primaryType,
          now,
        ],
      });
    }
  }

  console.log(`Calendar synced: ${calendar.length} states`);
}

// Step 3 — Senate candidate rosters from Ballotpedia. Deferred to a focused
// follow-up pass (handoff 91 was landed calendar-first). Note for whoever
// picks this up: the working Ballotpedia URL is the SINGULAR form
// `https://ballotpedia.org/United_States_Senate_election_in_{State},_2026`
// — the handoff's plural `..._elections_in_...` 404s for every state.
async function syncSenateCandidates(): Promise<void> {
  console.log(
    "Senate candidate sync: deferred (handoff 91 Step 3 follow-up pass)",
  );
}

async function main() {
  await syncCalendar();
  await syncSenateCandidates();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
