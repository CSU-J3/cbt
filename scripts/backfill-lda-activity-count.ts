// HO 597 — one-time populate of lda_filings.activity_count for the rows that
// existed before lib/lda-sync.ts started writing it. Every filing after this runs
// gets the value from the sync's own upsert; this only fills the back catalogue.
//
// WHY IT IS NOT ONE UPDATE STATEMENT. The obvious form —
//   UPDATE lda_filings SET activity_count =
//     (SELECT COUNT(*) FROM lda_activities a WHERE a.filing_uuid = lda_filings.filing_uuid)
// — is a correlated aggregate over 129k filings x 421k activities in a single
// statement. That is the exact shape this whole handoff exists to stop running,
// and one abort leaves the corpus half-filled with no way to tell which half.
// Instead: read the counts ONCE (the aggregate is unavoidable, but it happens
// here, off the request path, on a long-timeout client), then write in bounded
// chunks so an interrupted run resumes.
//
// RESUMABLE + IDEMPOTENT. The work set is `WHERE activity_count IS NULL`, so a
// re-run picks up exactly what is left and a completed run is a no-op. NULL means
// "not yet counted" and 0 means "counted, and it is none" — that distinction is
// what makes the resume predicate honest, so zero-activity filings are written as
// an explicit 0 rather than skipped.
//
//   npm run backfill:lda-activity-count
import "dotenv/config";
import { createClient, type InStatement } from "@libsql/client";

// Off the request path, and the driving aggregate is the ~20s query this handoff
// is retiring — the 10s lib/db.ts bound would abort it (HO 597 M3).
const CLIENT_TIMEOUT_MS = 300_000;
// Statements per write batch. The LDA sync tuned its own flush to 100 (HO 435,
// down from 300, for this shared prod Turso's contention profile); match it.
const CHUNK = 100;

function db() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    fetch: (i: RequestInfo | URL, init?: RequestInit) =>
      fetch(i, { ...init, signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS) }),
  });
}

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

async function main() {
  const c = db();

  const todo = await c.execute(
    "SELECT COUNT(*) AS n FROM lda_filings WHERE activity_count IS NULL",
  );
  const remaining = Number((todo.rows[0] as { n?: number }).n ?? 0);
  if (remaining === 0) {
    console.log("nothing to backfill — every lda_filings row has activity_count");
    return;
  }
  console.log(`rows needing activity_count: ${remaining.toLocaleString()}`);

  // The counts, once. Filings absent from this map have no lda_activities rows at
  // all and take an explicit 0 — they are exactly the set the old VOLUME INNER
  // JOIN dropped, and the read path's equivalence argument needs them countable.
  console.log("reading per-filing activity counts (the aggregate, once)...");
  let t0 = performance.now();
  const agg = await c.execute(
    "SELECT filing_uuid, COUNT(*) AS c FROM lda_activities GROUP BY filing_uuid",
  );
  console.log(`  ${agg.rows.length.toLocaleString()} filings with activities in ${ms(performance.now() - t0)}`);
  const counts = new Map<string, number>();
  for (const r of agg.rows) {
    counts.set(String(r.filing_uuid), Number(r.c ?? 0));
  }

  const targets = await c.execute(
    "SELECT filing_uuid FROM lda_filings WHERE activity_count IS NULL",
  );
  const uuids = targets.rows.map((r) => String(r.filing_uuid));
  console.log(`writing ${uuids.length.toLocaleString()} rows in chunks of ${CHUNK}...`);

  t0 = performance.now();
  let written = 0;
  let zeros = 0;
  for (let i = 0; i < uuids.length; i += CHUNK) {
    const slice = uuids.slice(i, i + CHUNK);
    const stmts: InStatement[] = slice.map((u) => {
      const n = counts.get(u) ?? 0;
      if (n === 0) zeros++;
      return {
        sql: "UPDATE lda_filings SET activity_count = ? WHERE filing_uuid = ?",
        args: [n, u],
      };
    });
    await c.batch(stmts, "write");
    written += slice.length;
    if (written % 10_000 < CHUNK || written === uuids.length) {
      console.log(`  ${written.toLocaleString()} / ${uuids.length.toLocaleString()} (${ms(performance.now() - t0)})`);
    }
  }

  const after = await c.execute(
    `SELECT COUNT(*) AS total,
            COUNT(activity_count) AS filled,
            SUM(CASE WHEN activity_count = 0 THEN 1 ELSE 0 END) AS zero
       FROM lda_filings`,
  );
  const row = after.rows[0] as Record<string, unknown>;
  console.log(
    `\ndone in ${ms(performance.now() - t0)} — wrote ${written.toLocaleString()} (${zeros.toLocaleString()} zero-activity)`,
  );
  console.log(
    `lda_filings: total ${Number(row.total).toLocaleString()} | activity_count NOT NULL ${Number(row.filled).toLocaleString()} | = 0 ${Number(row.zero).toLocaleString()}`,
  );
  if (Number(row.total) !== Number(row.filled)) {
    console.log(`*** ${Number(row.total) - Number(row.filled)} rows still NULL — re-run to finish`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
