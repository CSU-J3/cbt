// HO 474 markets/kalshi cron-migration recon — READ-ONLY. No writes, no POSTs.
// Answers the live-environment questions a static clone can't:
//   1. Does the `30 21` Vercel markets floor actually fire on Pro now?
//   2. Auth proxy: do the existing vercel.json crons succeed? (⇒ CRON_SECRET set)
//   5. market_ticks bloat/retention readout.
//   npx tsx scripts/diagnostic/markets-cadence-474.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.log("CHECK BROKEN: TURSO_DATABASE_URL not set. Run with the CBT .env.");
    return 3;
  }
  const db = createClient({ url, authToken });

  // ── 1. markets floor: recent /api/cron/markets runs (does a ~21:xx UTC row exist?)
  console.log("===== /api/cron/markets — last 24 runs (UTC) =====");
  const markets = await db.execute({
    sql: `SELECT id, started_at, status, elapsed_ms,
                 json_extract(payload,'$.ticked')  AS ticked,
                 json_extract(payload,'$.failed')  AS failed,
                 substr(error_message,1,80)         AS err
          FROM cron_runs WHERE route='/api/cron/markets'
          ORDER BY started_at DESC LIMIT 24`,
    args: [],
  });
  for (const r of markets.rows) {
    const hhmm = String(r.started_at).slice(11, 16);
    console.log(
      `#${r.id}  ${r.started_at}  [${hhmm} UTC]  ${r.status}  ticked=${r.ticked} failed=${r.failed} ${r.elapsed_ms}ms  ${r.err ?? ""}`,
    );
  }

  // Distinct UTC hours markets fired over last 7d — a 21 in here = floor fires.
  console.log("\n----- markets: run-count by UTC hour, last 7 days -----");
  const byHour = await db.execute({
    sql: `SELECT substr(started_at,12,2) AS hh, COUNT(*) n
          FROM cron_runs
          WHERE route='/api/cron/markets'
            AND started_at >= datetime('now','-7 days')
          GROUP BY hh ORDER BY hh`,
    args: [],
  });
  console.log(byHour.rows.map((r) => `${r.hh}h:${r.n}`).join("  "));

  // ── kalshi runs too (the other migrating cron)
  console.log("\n===== /api/cron/kalshi — last 12 runs (UTC) =====");
  const kalshi = await db.execute({
    sql: `SELECT id, started_at, status, elapsed_ms, substr(error_message,1,80) AS err
          FROM cron_runs WHERE route='/api/cron/kalshi'
          ORDER BY started_at DESC LIMIT 12`,
    args: [],
  });
  for (const r of kalshi.rows) {
    console.log(`#${r.id}  ${r.started_at}  ${r.status}  ${r.elapsed_ms}ms  ${r.err ?? ""}`);
  }

  // ── 2. auth proxy: do the KNOWN Vercel-scheduled Bearer-authed crons succeed?
  //    Consistent success ⇒ Vercel is attaching Bearer CRON_SECRET ⇒ markets/kalshi
  //    will authorize once registered. A 401 would surface as status='error'.
  console.log("\n===== auth proxy — existing vercel.json crons, last 5 each =====");
  for (const route of ["/api/cron/summarize", "/api/cron/news", "/api/sync", "/api/cron/lda"]) {
    const runs = await db.execute({
      sql: `SELECT started_at, status, substr(error_message,1,60) AS err
            FROM cron_runs WHERE route=? ORDER BY started_at DESC LIMIT 5`,
      args: [route],
    });
    const summary = runs.rows
      .map((r) => `${String(r.started_at).slice(5, 16)} ${r.status}${r.err ? `(${r.err})` : ""}`)
      .join("  |  ");
    console.log(`${route}\n   ${summary || "(no rows)"}`);
  }

  // ── 5. market_ticks bloat / retention
  console.log("\n===== market_ticks — rows by symbol =====");
  const bySym = await db.execute({
    sql: `SELECT symbol, COUNT(*) n, MIN(ticked_at) first, MAX(ticked_at) last
          FROM market_ticks GROUP BY symbol ORDER BY n DESC`,
    args: [],
  });
  for (const r of bySym.rows) {
    console.log(
      `${String(r.symbol).padEnd(18)} n=${String(r.n).padStart(6)}  ${String(r.first).slice(0, 16)} → ${String(r.last).slice(0, 16)}`,
    );
  }
  const total = await db.execute(`SELECT COUNT(*) n, MIN(ticked_at) f, MAX(ticked_at) l FROM market_ticks`);
  console.log(
    `\nTOTAL rows=${total.rows[0]!.n}  span ${String(total.rows[0]!.f).slice(0, 16)} → ${String(total.rows[0]!.l).slice(0, 16)}`,
  );

  return 0;
}

main().then((c) => process.exit(c));
