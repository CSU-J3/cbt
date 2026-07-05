// HO 419 — member ideology sync from Voteview DW-NOMINATE (119th).
//
// Writes one row per current member into `member_ideology`: the headline
// nominate_dim1 (economic left/right) plus dim2, the per-congress nokken_poole
// pair, vote count and the provisional flag. One static-file GET + local parse,
// no pagination, no per-record network, no LLM — runtime is seconds.
//
// The member file carries bioguide_id natively, so we join Voteview -> members on
// bioguide_id DIRECTLY (the HO 402 crosswalk's ICPSR bridge is not on this path).
//
// GATE (the HO 402 "never invent a member" pattern): load known bioguides from
// `members` first; a 119th Voteview row whose bioguide isn't on the current
// roster (departed mid-term, or the President's empty-bioguide row) is skipped and
// counted, never an orphan. libSQL runs foreign_keys OFF, so the gate — not a
// constraint — is what prevents orphan inserts.
//
// DEDUP: a bioguide with more than one 119th row (a mid-term chamber switcher, or
// House+Senate service in the same congress) keeps the row with the MOST
// nominate_number_of_votes — deterministic, primary-chamber dominates (mirrors the
// FEC scoring-tie tie-break).
//
// Manual, paired with sync:members -> sync:crosswalk (needs `members` populated
// for the gate). Voteview re-estimates live, so the upsert overwrites the score
// fields + updated_at each run. NOT on the daily Vercel cron.
import "dotenv/config";
import { getDb } from "../lib/db";
import { fetchVoteview119, type VoteviewMember } from "./voteview-source";

// -1 sentinel so a row with a null vote count loses the dedup to any row that has
// one; two nulls tie and the first-seen wins (deterministic over the file order).
function voteRank(m: VoteviewMember): number {
  return m.number_of_votes ?? -1;
}

async function main() {
  const db = getDb();

  // 1. Fetch + parse the 119th member file.
  const rows = await fetchVoteview119();
  console.log(`Fetched ${rows.length} Voteview 119th rows`);

  // 2. The gate: known bioguides from `members`.
  const memRes = await db.execute("SELECT bioguide_id FROM members");
  const known = new Set(memRes.rows.map((r) => r.bioguide_id as string));
  console.log(`Known bioguides in members: ${known.size}`);

  // 3. Gate + dedup in one pass: keep, per bioguide, the row with the most votes.
  const best = new Map<string, VoteviewMember>();
  let skippedOffRoster = 0;
  const skipped: string[] = [];
  for (const m of rows) {
    if (!m.bioguide_id || !known.has(m.bioguide_id)) {
      skippedOffRoster++;
      skipped.push(m.bioguide_id || `(no-bioguide: ${m.bioname})`);
      continue;
    }
    const prev = best.get(m.bioguide_id);
    if (!prev || voteRank(m) > voteRank(prev)) best.set(m.bioguide_id, m);
  }

  // 4. Upsert. Idempotent — Voteview re-estimates live, so overwrite scores +
  // updated_at every run.
  const updatedAt = new Date().toISOString();
  let upserted = 0;
  for (const m of best.values()) {
    await db.execute({
      sql: `INSERT INTO member_ideology (
              bioguide_id, icpsr, congress, chamber,
              nominate_dim1, nominate_dim2, nokken_poole_dim1, nokken_poole_dim2,
              number_of_votes, conditional, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(bioguide_id) DO UPDATE SET
              icpsr = excluded.icpsr,
              congress = excluded.congress,
              chamber = excluded.chamber,
              nominate_dim1 = excluded.nominate_dim1,
              nominate_dim2 = excluded.nominate_dim2,
              nokken_poole_dim1 = excluded.nokken_poole_dim1,
              nokken_poole_dim2 = excluded.nokken_poole_dim2,
              number_of_votes = excluded.number_of_votes,
              conditional = excluded.conditional,
              updated_at = excluded.updated_at`,
      args: [
        m.bioguide_id,
        m.icpsr,
        m.congress,
        m.chamber,
        m.nominate_dim1,
        m.nominate_dim2,
        m.nokken_poole_dim1,
        m.nokken_poole_dim2,
        m.number_of_votes,
        m.conditional,
        updatedAt,
      ],
    });
    upserted++;
  }

  console.log("\n=== Ideology sync — HO 419 ===");
  console.log(`fetched (119th rows):          ${rows.length}`);
  console.log(`gated-in (upserted):           ${upserted}`);
  console.log(`skipped_off_roster:            ${skippedOffRoster}`);
  if (skipped.length > 0) console.log(`  ${skipped.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
