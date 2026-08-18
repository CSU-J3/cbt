// HO 378 — President stage probe. READ-ONLY. No writes, no commit.
// Settles whether PRESIDENT = 0 is correct (transient-empty) or a classifier gap.
// Direct script path, so the 10s app abort wrapper doesn't apply.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function rows(sql: string, args: unknown[] = []) {
  const rs = await db.execute({ sql, args: args as never });
  return rs.rows;
}
function hr(t: string) {
  console.log("\n========== " + t + " ==========");
}

async function main() {
  // Stage distribution sanity (should match the UI bar)
  hr("0. stage distribution (all bills)");
  console.table(
    (await rows(`SELECT stage, COUNT(*) AS n FROM bills GROUP BY stage ORDER BY n DESC`)).map(
      (r) => ({ stage: r.stage, n: Number(r.n) }),
    ),
  );

  // a. True president candidates — currently presented, unresolved (the money query)
  hr("a. currently presented & unresolved");
  const a = await rows(
    `SELECT id, stage, latest_action_text, latest_action_date
       FROM bills
      WHERE latest_action_text LIKE '%Presented to President%'
        AND latest_action_text NOT LIKE '%Became Public Law%'
        AND latest_action_text NOT LIKE '%Signed by President%'
        AND latest_action_text NOT LIKE '%Vetoed%'
      ORDER BY latest_action_date DESC`,
  );
  console.log(`rows: ${a.length}`);
  console.table(
    a.map((r) => ({
      id: r.id,
      stage: r.stage,
      date: r.latest_action_date,
      action: String(r.latest_action_text ?? "").slice(0, 70),
    })),
  );

  // b. All-time presentment vocab by assigned stage
  hr("b. 'Presented to President' by assigned stage");
  console.table(
    (
      await rows(
        `SELECT stage, COUNT(*) AS n
           FROM bills
          WHERE latest_action_text LIKE '%Presented to President%'
          GROUP BY stage`,
      )
    ).map((r) => ({ stage: r.stage, n: Number(r.n) })),
  );

  // c. Sanity — anything presidential / public-law / white-house by stage
  hr("c. President / Public Law / White House by stage");
  console.table(
    (
      await rows(
        `SELECT stage, COUNT(*) AS n
           FROM bills
          WHERE latest_action_text LIKE '%President%'
             OR latest_action_text LIKE '%Public Law%'
             OR latest_action_text LIKE '%White House%'
          GROUP BY stage`,
      )
    ).map((r) => ({ stage: r.stage, n: Number(r.n) })),
  );
}

main().then(() => process.exit(0));
