// handoff 91: primary tracker sync. Phase 1 lands the state-level primary
// calendar (all 50 states) into the `primaries` table. The Senate candidate
// rosters (Step 3) are a separate follow-up pass — see syncSenateCandidates.
import "dotenv/config";
import { getDb } from "../lib/db";
import { scrapeStatePrimaryCalendar } from "../lib/primary-calendar-scrape";
import { scrapeSenateCandidates } from "../lib/senate-candidates-scrape";
import { stateName } from "../lib/states";

// 2026 Senate states. WA was dropped from the handoff's SENATE_STATES_2026
// list — Washington has no 2026 Senate race (its seats are up 2028 / 2030).
// FL and OH are 2026 specials; the scraper resolves their special-election
// URL automatically.
const SENATE_STATES_2026 = [
  "AL", "AK", "AR", "CO", "DE", "GA", "ID", "IL", "IA", "KS",
  "KY", "LA", "ME", "MA", "MI", "MN", "MS", "MT", "NE", "NH",
  "NJ", "NM", "NC", "OK", "OR", "RI", "SC", "SD", "TN", "TX",
  "VA", "WY",
  "FL", "OH",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Last word of a candidate name, lowercased — the member-match key.
function lastNameKey(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

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

// Step 3 — Senate candidate rosters. Scrapes each 2026 Senate state's
// Ballotpedia election page, parses the D/R primary voteboxes, and upserts
// the rosters into primary_candidates. Per-state delete-then-insert keeps
// re-runs idempotent (the table has no natural unique key). Candidates are
// best-effort matched to sitting senators by last name + state — challengers
// aren't members of Congress, so most rows resolve to a NULL bioguide_id.
async function syncSenateCandidates(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  const memberRows = await db.execute(
    "SELECT bioguide_id, name, state FROM members WHERE chamber = 'senate'",
  );
  const senatorsByState = new Map<
    string,
    { bioguideId: string; name: string }[]
  >();
  for (const r of memberRows.rows) {
    const st = r.state as string | null;
    if (!st) continue;
    const list = senatorsByState.get(st) ?? [];
    list.push({
      bioguideId: r.bioguide_id as string,
      name: ((r.name as string | null) ?? "").toLowerCase(),
    });
    senatorsByState.set(st, list);
  }

  function matchMember(candidateName: string, state: string): string | null {
    const key = lastNameKey(candidateName);
    if (!key) return null;
    const hits = (senatorsByState.get(state) ?? []).filter((m) =>
      m.name.includes(key),
    );
    return hits.length === 1 ? hits[0]!.bioguideId : null;
  }

  let okStates = 0;
  let totalCandidates = 0;
  let matchedCandidates = 0;
  const failures: string[] = [];
  const perState: string[] = [];

  for (const abbr of SENATE_STATES_2026) {
    const slug = stateName(abbr).replace(/ /g, "_");
    const result = await scrapeSenateCandidates(abbr, slug);
    await sleep(700); // be polite to Ballotpedia between fetches

    if (result.status !== "ok") {
      failures.push(`${abbr} — ${result.status}`);
      continue;
    }
    okStates++;

    // Route each candidate to its primary by contest: the D / R partisan
    // primaries, or the "open" all-candidate primary (AK's top-four). The
    // 'open' primaries row only exists for top-two/four states, so the
    // DELETE/INSERT there is a no-op for ordinary D/R states.
    for (const contest of ["D", "R", "open"] as const) {
      const primaryId = `senate-${abbr}-2026-${contest}`;
      await db.execute({
        sql: "DELETE FROM primary_candidates WHERE primary_id = ?",
        args: [primaryId],
      });
      const roster = result.candidates.filter((c) => c.contest === contest);
      for (const c of roster) {
        const bioguideId = matchMember(c.name, abbr);
        if (bioguideId) matchedCandidates++;
        totalCandidates++;
        await db.execute({
          sql: `INSERT INTO primary_candidates
                  (primary_id, name, party, incumbent, bioguide_id, status, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            primaryId,
            c.name,
            c.party,
            c.incumbent ? 1 : 0,
            bioguideId,
            c.isWinner ? "winner" : "running",
            now,
          ],
        });
      }
    }
    perState.push(`  ${abbr}: ${result.candidates.length} candidates`);
  }

  console.log("\n=== Senate candidate sync ===");
  if (perState.length > 0) console.log(perState.join("\n"));
  console.log(
    `\nStates scraped OK: ${okStates}/${SENATE_STATES_2026.length}`,
  );
  console.log(
    `Candidates upserted: ${totalCandidates} ` +
      `(matched to a sitting senator: ${matchedCandidates})`,
  );
  if (failures.length > 0) {
    console.log(`Failed to parse (${failures.length}):`);
    for (const f of failures) console.log(`  ${f}`);
  } else {
    console.log("Failed to parse: none");
  }
}

async function main() {
  await syncCalendar();
  await syncSenateCandidates();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
