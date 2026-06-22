// HO 313 — markets tape freeze diagnostic (READ-ONLY, no writes).
//
// A MANUAL freshness check for the markets tape — run it by hand when the tape
// looks stale/frozen. It is NOT wired into any cron, route, or pipeline; nothing
// imports it and it writes nothing.
//
// What it reports, from the durable record (cron_runs + market_ticks):
//   1. cron_runs for /api/cron/markets — recent rows + status rollup: did the
//      cron fire, did it error or silently write nothing, and what does the
//      chronicErr / payload failSummary name as failing?
//   2. market_ticks per-symbol last write + AGE — which symbols are fresh vs
//      frozen and exactly when each last wrote (the tape's "AS OF" comes from
//      here), plus the most-recent write per SOURCE (fmp/fred/kalshi/polymarket)
//      — the fork between a stopped trigger (all sources frozen at one instant)
//      and a per-source fetch failure.
// Confirmed the HO 314 fix (Vercel daily cron floor) and is kept for the next
// freeze investigation.
// Run: npx tsx --env-file=.env scripts/diagnostic/markets-freeze-313.ts
import "dotenv/config";
import { getDb } from "../../lib/db";
import { MARKET_SYMBOLS } from "../../lib/markets";

function fmtET(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

async function main() {
  const db = getDb();
  const nowMs = Date.now();

  // ── 1. cron_runs for the markets route ───────────────────────────────────
  console.log("===== cron_runs WHERE route='/api/cron/markets' (last 18) =====");
  const runs = await db.execute({
    sql: `SELECT id, started_at, ended_at, status, elapsed_ms, error_message, payload
          FROM cron_runs
          WHERE route = '/api/cron/markets'
          ORDER BY started_at DESC
          LIMIT 18`,
    args: [],
  });
  for (const r of runs.rows) {
    const started = r.started_at as string;
    const status = r.status as string;
    const elapsed = r.elapsed_ms as number | null;
    const err = (r.error_message as string | null) ?? "";
    // pull ticked/failed count out of payload if present
    let counts = "";
    try {
      const p = r.payload ? JSON.parse(r.payload as string) : null;
      const pl = p?.payload ?? p;
      if (pl && typeof pl.ticked === "number") {
        counts = `ticked=${pl.ticked} failed=${pl.failed}`;
      }
    } catch { /* ignore */ }
    console.log(
      `#${r.id}  ${fmtET(started)} ET  ${status.padEnd(8)} ${String(elapsed ?? "").padStart(6)}ms  ${counts}`,
    );
    if (err) console.log(`        err: ${err.slice(0, 400)}`);
  }

  // distinct status rollup across all markets rows
  const roll = await db.execute({
    sql: `SELECT status, COUNT(*) n, MAX(started_at) last
          FROM cron_runs WHERE route='/api/cron/markets'
          GROUP BY status ORDER BY n DESC`,
    args: [],
  });
  console.log("\n  status rollup (all markets rows):");
  for (const r of roll.rows) {
    console.log(`    ${String(r.status).padEnd(9)} n=${String(r.n).padStart(4)}  last ${fmtET(r.last as string)} ET`);
  }

  // ── 2. market_ticks per-symbol last write ────────────────────────────────
  console.log("\n===== market_ticks: latest write per symbol =====");
  console.log("symbol        source     last ticked_at (ET)     mkt_date     price        age");
  const bySym: Record<string, { source: string }> = {};
  for (const s of MARKET_SYMBOLS) bySym[s.internal] = { source: s.source };

  const latest = await db.execute({
    sql: `SELECT t.symbol, t.price, t.ticked_at, t.market_date
          FROM market_ticks t
          JOIN (SELECT symbol, MAX(ticked_at) mx FROM market_ticks GROUP BY symbol) m
            ON m.symbol = t.symbol AND m.mx = t.ticked_at`,
    args: [],
  });
  const latestMap: Record<string, { price: number; ticked: string; mdate: string }> = {};
  for (const r of latest.rows) {
    latestMap[r.symbol as string] = {
      price: r.price as number,
      ticked: r.ticked_at as string,
      mdate: r.market_date as string,
    };
  }

  // Print in MARKET_SYMBOLS order, grouped by source freshness
  for (const s of MARKET_SYMBOLS) {
    const l = latestMap[s.internal];
    if (!l) {
      console.log(`${s.internal.padEnd(13)} ${s.source.padEnd(10)} (no ticks ever)`);
      continue;
    }
    const ageH = (nowMs - Date.parse(l.ticked)) / 3_600_000;
    const ageStr = ageH >= 24 ? `${(ageH / 24).toFixed(1)}d` : `${ageH.toFixed(1)}h`;
    console.log(
      `${s.internal.padEnd(13)} ${s.source.padEnd(10)} ${fmtET(l.ticked).padEnd(22)} ${l.mdate.padEnd(12)} ${String(l.price).padEnd(12)} ${ageStr}`,
    );
  }

  // group last-write by source — the headline fork
  console.log("\n  most-recent write per SOURCE:");
  const srcLast: Record<string, number> = {};
  for (const s of MARKET_SYMBOLS) {
    const l = latestMap[s.internal];
    if (!l) continue;
    const ms = Date.parse(l.ticked);
    if (!srcLast[s.source] || ms > srcLast[s.source]!) srcLast[s.source] = ms;
  }
  for (const [src, ms] of Object.entries(srcLast)) {
    const ageH = (nowMs - ms) / 3_600_000;
    console.log(`    ${src.padEnd(10)} last ${fmtET(new Date(ms).toISOString())} ET  (${ageH >= 24 ? (ageH/24).toFixed(1)+"d" : ageH.toFixed(1)+"h"} ago)`);
  }

  console.log(`\n  now: ${fmtET(new Date(nowMs).toISOString())} ET`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
