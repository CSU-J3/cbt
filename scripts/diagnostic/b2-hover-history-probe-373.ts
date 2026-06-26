// HO 373 — B2 hover history probe (read-only). Scopes the hover enrichment
// (sparkline + trailing delta) by reading what `market_ticks` actually holds
// per symbol. Diagnosis only — no writes, nothing to deploy.
//
// Runs against the LIVE hosted Turso (getDb() reads TURSO_DATABASE_URL — the
// same instance the app uses), not the /mnt/project snapshot. `market_ticks`
// is small and the (symbol, ticked_at DESC) index covers these reads.
//
// Timestamp trap (HO 142): ticked_at is ISO-UTC with a `T`; datetime('now')
// returns a space-separated string, so a naive string compare against now is
// silently wrong (`T` > ` ` lexically). Every offset query compares with
// julianday() on BOTH sides. MAX(ticked_at) as "latest" is a safe string
// compare (one consistent writer).
//
// Run: npx tsx scripts/diagnostic/b2-hover-history-probe-373.ts
import "dotenv/config";
import { getDb } from "../../lib/db";

const db = getDb();

// Displayed tape items → stored internal symbol (lib/markets MARKET_SYMBOLS).
// Code ground truth: the markets cron INSERTs symbol.internal, NOT the rolling
// Kalshi event ticker — so the odds history is keyed on a stable string.
const DISPLAYED: Record<string, string> = {
  "S&P 500": "SPX",
  Nasdaq: "NDQ",
  "10Y Treasury": "TNX",
  "WTI Crude": "WTI",
  Nvidia: "NVDA",
  Apple: "AAPL",
  Microsoft: "MSFT",
  Alphabet: "GOOGL",
  Lockheed: "LMT",
  CPI: "CPI",
  Unemployment: "UNEMP",
  "Shutdown Odds": "SHUTDOWN",
  "Fed Cut JUL": "FEDCUT",
  "Fed Cut SEP": "FEDCUT-SEP",
  Recession: "RECESSION",
  // Polymarket halves (v2 SIGNALS/ODDS strips only)
  "Shutdown (P)": "POLY-SHUTDOWN",
  "Fed Cut (P)": "POLY-FEDCUT",
  "Fed Cut SEP (P)": "POLY-FEDCUT-SEP",
  "Recession (P)": "POLY-RECESSION",
};

function pad(v: unknown, n: number): string {
  return String(v ?? "").padEnd(n);
}

async function queryA() {
  console.log("\n=== A — roster + density (per symbol) ===");
  const rs = await db.execute(`
    SELECT
      symbol,
      COUNT(*)        AS n_total,
      MIN(ticked_at)  AS first_tick,
      MAX(ticked_at)  AS last_tick,
      SUM(CASE WHEN julianday(ticked_at) >= julianday('now','-1 day')  THEN 1 ELSE 0 END) AS n_24h,
      SUM(CASE WHEN julianday(ticked_at) >= julianday('now','-7 day')  THEN 1 ELSE 0 END) AS n_7d,
      SUM(CASE WHEN julianday(ticked_at) >= julianday('now','-30 day') THEN 1 ELSE 0 END) AS n_30d
    FROM market_ticks
    GROUP BY symbol
    ORDER BY symbol`);
  console.log(
    `  ${pad("symbol", 16)} ${pad("n", 6)} ${pad("24h", 5)} ${pad("7d", 5)} ${pad("30d", 5)} ${pad("first_tick", 26)} last_tick`,
  );
  const stored = new Set<string>();
  for (const r of rs.rows) {
    stored.add(String(r.symbol));
    console.log(
      `  ${pad(r.symbol, 16)} ${pad(r.n_total, 6)} ${pad(r.n_24h, 5)} ${pad(r.n_7d, 5)} ${pad(r.n_30d, 5)} ${pad(r.first_tick, 26)} ${r.last_tick}`,
    );
  }
  return stored;
}

async function queryB() {
  console.log("\n=== B — gap structure, trailing 7d (hours) ===");
  const rs = await db.execute(`
    WITH w AS (
      SELECT symbol, ticked_at,
             (julianday(ticked_at)
              - julianday(LAG(ticked_at) OVER (PARTITION BY symbol ORDER BY ticked_at))) * 24 AS gap_h
      FROM market_ticks
      WHERE julianday(ticked_at) >= julianday('now','-7 day')
    )
    SELECT symbol,
           COUNT(*)            AS pts_7d,
           ROUND(AVG(gap_h),2) AS avg_gap_h,
           ROUND(MAX(gap_h),2) AS max_gap_h
    FROM w
    WHERE gap_h IS NOT NULL
    GROUP BY symbol
    ORDER BY symbol`);
  console.log(`  ${pad("symbol", 16)} ${pad("pts_7d", 7)} ${pad("avg_gap_h", 10)} max_gap_h`);
  for (const r of rs.rows) {
    console.log(`  ${pad(r.symbol, 16)} ${pad(r.pts_7d, 7)} ${pad(r.avg_gap_h, 10)} ${r.max_gap_h}`);
  }
}

async function queryC() {
  console.log("\n=== C — delta anchors (now / nearest <=24h / nearest <=7d) ===");
  const now = await db.execute(`
    SELECT symbol, price AS price_now, ticked_at AS at_now
    FROM market_ticks m
    WHERE ticked_at = (SELECT MAX(ticked_at) FROM market_ticks WHERE symbol = m.symbol)`);
  const a24 = await db.execute(`
    SELECT symbol, price AS price_24h, ticked_at AS at_24h
    FROM market_ticks m
    WHERE ticked_at = (
      SELECT MAX(ticked_at) FROM market_ticks
      WHERE symbol = m.symbol AND julianday(ticked_at) <= julianday('now','-1 day'))`);
  const a7 = await db.execute(`
    SELECT symbol, price AS price_7d, ticked_at AS at_7d
    FROM market_ticks m
    WHERE ticked_at = (
      SELECT MAX(ticked_at) FROM market_ticks
      WHERE symbol = m.symbol AND julianday(ticked_at) <= julianday('now','-7 day'))`);

  const bySym = new Map<string, Record<string, unknown>>();
  for (const r of now.rows) bySym.set(String(r.symbol), { ...r });
  for (const r of a24.rows) Object.assign(bySym.get(String(r.symbol)) ?? bySym.set(String(r.symbol), {}).get(String(r.symbol))!, r);
  for (const r of a7.rows) Object.assign(bySym.get(String(r.symbol)) ?? bySym.set(String(r.symbol), {}).get(String(r.symbol))!, r);

  console.log(
    `  ${pad("symbol", 16)} ${pad("price_now", 11)} ${pad("at_now", 22)} ${pad("price_24h", 11)} ${pad("at_24h", 22)} ${pad("price_7d", 11)} at_7d`,
  );
  for (const sym of [...bySym.keys()].sort()) {
    const r = bySym.get(sym)!;
    console.log(
      `  ${pad(sym, 16)} ${pad(r.price_now, 11)} ${pad(r.at_now, 22)} ${pad(r.price_24h ?? "—", 11)} ${pad(r.at_24h ?? "—", 22)} ${pad(r.price_7d ?? "—", 11)} ${r.at_7d ?? "—"}`,
    );
  }
}

async function queryD() {
  console.log("\n=== D — odds roll-stability (any rolling-ticker fragmentation?) ===");
  const rs = await db.execute(`
    SELECT symbol, COUNT(*) AS n, MIN(ticked_at) AS first_tick, MAX(ticked_at) AS last_tick
    FROM market_ticks
    WHERE symbol LIKE '%FED%'  OR symbol LIKE '%CUT%'    OR symbol LIKE '%KXFED%'
       OR symbol LIKE '%SHUT%' OR symbol LIKE '%KXGOV%'
       OR symbol LIKE '%RECES%' OR symbol LIKE '%RECSSN%'
    GROUP BY symbol
    ORDER BY symbol`);
  console.log(`  ${pad("symbol", 18)} ${pad("n", 6)} ${pad("first_tick", 26)} last_tick`);
  for (const r of rs.rows) {
    console.log(`  ${pad(r.symbol, 18)} ${pad(r.n, 6)} ${pad(r.first_tick, 26)} ${r.last_tick}`);
  }
}

function reconcile(stored: Set<string>) {
  console.log("\n=== Roster reconcile (displayed ↔ stored) ===");
  const displayedKeys = new Set(Object.values(DISPLAYED));
  console.log("  displayed item            internal      in market_ticks?");
  for (const [disp, internal] of Object.entries(DISPLAYED)) {
    console.log(`  ${pad(disp, 25)} ${pad(internal, 13)} ${stored.has(internal) ? "yes" : "NO — can't sparkline"}`);
  }
  const orphaned = [...stored].filter((s) => !displayedKeys.has(s));
  console.log(`\n  stored-but-not-displayed (dead history): ${orphaned.length ? orphaned.join(", ") : "(none)"}`);
}

async function main() {
  const stored = await queryA();
  await queryB();
  await queryC();
  await queryD();
  reconcile(stored);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
