import "dotenv/config";
import { getDb } from "../lib/db";

type RawSponsor = { bioguideId?: string };
type RawBill = { sponsors?: RawSponsor[] };

async function main() {
  const db = getDb();
  const rs = await db.execute(
    "SELECT id, raw_json FROM bills WHERE sponsor_bioguide_id IS NULL",
  );

  let updated = 0;
  let missing = 0;
  let parseErrors = 0;

  for (const row of rs.rows) {
    const id = row.id as string;
    const rawJson = row.raw_json as string;

    let bioguide: string | null = null;
    try {
      const parsed = JSON.parse(rawJson) as RawBill;
      bioguide = parsed.sponsors?.[0]?.bioguideId ?? null;
    } catch {
      parseErrors++;
      continue;
    }

    if (!bioguide) {
      missing++;
      continue;
    }

    await db.execute({
      sql: "UPDATE bills SET sponsor_bioguide_id = ? WHERE id = ?",
      args: [bioguide, id],
    });
    updated++;
  }

  console.log(
    `backfill complete: ${updated} updated, ${missing} missing bioguideId, ${parseErrors} parse errors, ${rs.rows.length} examined`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
