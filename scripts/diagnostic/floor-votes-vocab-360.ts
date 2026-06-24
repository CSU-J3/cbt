// HO 360 — READ-ONLY probe of the live votes vocabulary so the new BLOCKED
// (failed cloture) + REJECTED (failed/contested confirmation) matchers read real
// `result` strings, not invented ones. Prints distinct (chamber, result) for
// cloture-shaped and nomination-shaped rows, plus failed-looking results.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  const cloture = await db.execute(
    `SELECT chamber, result, COUNT(*) n FROM votes
     WHERE result LIKE 'Cloture%' OR question LIKE '%Cloture%'
     GROUP BY chamber, result ORDER BY n DESC`,
  );
  console.log("== cloture-shaped (result) ==");
  for (const r of cloture.rows) console.log(`${r.n}\t[${r.chamber}] ${r.result}`);

  const noms = await db.execute(
    `SELECT result, COUNT(*) n FROM votes
     WHERE result LIKE '%Nomination%' OR result LIKE '%Confirm%'
        OR amendment_designation LIKE 'PN%'
     GROUP BY result ORDER BY n DESC`,
  );
  console.log("\n== nomination-shaped (result) ==");
  for (const r of noms.rows) console.log(`${r.n}\t${r.result}`);

  const failed = await db.execute(
    `SELECT chamber, result, COUNT(*) n FROM votes
     WHERE result LIKE '%Reject%' OR result LIKE '%Defeat%'
        OR result LIKE '%Not Agreed%' OR result LIKE '%Fail%'
        OR result LIKE '%Not Invoked%' OR result LIKE '%Not Sustained%'
        OR result LIKE '%Not Confirmed%'
     GROUP BY chamber, result ORDER BY n DESC`,
  );
  console.log("\n== failed-looking (result) ==");
  for (const r of failed.rows) console.log(`${r.n}\t[${r.chamber}] ${r.result}`);
}

main().then(() => process.exit(0));
