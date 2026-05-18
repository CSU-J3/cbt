// Idempotent loader for caucus rosters (handoff 61).
//
// Reads data/affiliations-seed.json, upserts each (bioguide_id, org) into
// the affiliations table. Re-running after editing the JSON is the refresh
// workflow — INSERT ... ON CONFLICT updates category/source_url/
// last_verified in place. Rosters whose bioguide_id is not yet in the
// members table get warn-and-skip, not abort (freshmen / appointments may
// land before `npm run sync:members` next runs).
import "dotenv/config";
import { getDb } from "../lib/db";
import seed from "../data/affiliations-seed.json";
import { isCaucusOrg } from "../lib/caucus-config";

interface CaucusSeed {
  org: string;
  category: string;
  source_url: string | null;
  last_verified: string;
  members: string[];
}

async function main() {
  const db = getDb();
  const caucuses = seed.caucuses as CaucusSeed[];

  for (const c of caucuses) {
    if (!isCaucusOrg(c.org)) {
      console.error(
        `Unknown caucus org '${c.org}' in seed JSON. Add it to lib/caucus-config.ts or remove the entry. Aborting.`,
      );
      process.exit(1);
    }
  }

  const memberRes = await db.execute("SELECT bioguide_id FROM members");
  const knownIds = new Set(memberRes.rows.map((r) => r.bioguide_id as string));

  let inserted = 0;
  let missing = 0;

  for (const caucus of caucuses) {
    for (const bioguideId of caucus.members) {
      if (!knownIds.has(bioguideId)) {
        console.warn(
          `  ${caucus.org}: bioguide_id '${bioguideId}' not in members table — skipping`,
        );
        missing++;
        continue;
      }

      await db.execute({
        sql: `INSERT INTO affiliations (bioguide_id, org, category, source_url, last_verified)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(bioguide_id, org) DO UPDATE SET
                category = excluded.category,
                source_url = excluded.source_url,
                last_verified = excluded.last_verified`,
        args: [
          bioguideId,
          caucus.org,
          caucus.category,
          caucus.source_url,
          caucus.last_verified,
        ],
      });
      inserted++;
    }
  }

  console.log(
    `Done. inserted/updated=${inserted} missing_members=${missing}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
