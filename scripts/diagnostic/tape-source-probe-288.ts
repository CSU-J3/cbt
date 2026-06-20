// HO 288 — B2 tape data probe (read-only). Confirms what the specced B2 roster
// can actually fetch before the build scopes around it:
//   1. FMP /stable/quote for 8 equities (4 tech + 4 defense)
//   2. Kalshi + Polymarket recession + debt-ceiling markets (exist? identifiers?)
//   3. CPI/UNEMP current values (FRED, already wired — just confirm on hand)
// Run: npx tsx scripts/diagnostic/tape-source-probe-288.ts
//
// NOTE on FMP egress: FMP_API_KEY in local .env is the same key as prod, and
// FMP's free-tier gating (402 payment / 403 v3 / empty array) is key/tier-
// determined, not IP-determined, so a laptop probe with the prod key is
// authoritative for "which tickers the tape can render". A prod-egress
// confirmation is run separately via the throwaway /api/_probe-288 route.
import "dotenv/config";
import { getDb } from "../../lib/db";

const TECH = ["NVDA", "AAPL", "MSFT", "GOOGL"];
const DEFENSE = ["LMT", "RTX", "NOC", "GD"];
const KALSHI_BASE = "https://external-api.kalshi.com/trade-api/v2";
const GAMMA_BASE = "https://gamma-api.polymarket.com";
const RX = /recession|debt[ -]?ceiling|debt[ -]?limit/i;

async function probeFmp() {
  console.log("\n=== 1. FMP /stable/quote (laptop egress, prod key) ===");
  const key = process.env.FMP_API_KEY;
  if (!key) {
    console.log("  FMP_API_KEY not set locally — skipping");
    return;
  }
  for (const sym of [...TECH, ...DEFENSE]) {
    const url = `https://financialmodelingprep.com/stable/quote?symbol=${sym}&apikey=${key}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const body = await res.text();
      if (!res.ok) {
        console.log(`  ${sym.padEnd(6)} HTTP ${res.status}  ${body.slice(0, 120)}`);
        continue;
      }
      let arr: unknown;
      try { arr = JSON.parse(body); } catch { arr = null; }
      const q = Array.isArray(arr) ? (arr[0] as Record<string, unknown>) : null;
      if (!q || q.price == null) {
        console.log(`  ${sym.padEnd(6)} EMPTY/no-price  ${body.slice(0, 120)}`);
        continue;
      }
      console.log(
        `  ${sym.padEnd(6)} OK  price=${q.price}  change=${q.change ?? "?"}  changePct=${q.changePercentage ?? q.changesPercentage ?? "?"}  (${q.name ?? ""})`,
      );
    } catch (e) {
      console.log(`  ${sym.padEnd(6)} FETCH ERR  ${(e as Error).message}`);
    }
  }
}

async function probeKalshi() {
  console.log("\n=== 2a. Kalshi — recession / debt-ceiling (open events scan) ===");
  let cursor = "";
  let pages = 0;
  const hits: { ticker: string; title: string; markets: number; sample: string }[] = [];
  try {
    while (pages < 45) {
      const url = `${KALSHI_BASE}/events?status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        console.log(`  events HTTP ${res.status} (page ${pages})`);
        break;
      }
      const d = (await res.json()) as {
        events?: { event_ticker?: string; title?: string; sub_title?: string; markets?: { ticker?: string; title?: string; last_price?: number; yes_bid?: number }[] }[];
        cursor?: string;
      };
      for (const ev of d.events ?? []) {
        const hay = `${ev.event_ticker ?? ""} ${ev.title ?? ""} ${ev.sub_title ?? ""} ${(ev.markets ?? []).map((m) => `${m.ticker} ${m.title}`).join(" ")}`;
        if (RX.test(hay)) {
          const m0 = (ev.markets ?? [])[0];
          hits.push({
            ticker: ev.event_ticker ?? "?",
            title: (ev.title ?? "").slice(0, 80),
            markets: (ev.markets ?? []).length,
            sample: m0 ? `${m0.ticker} last=${m0.last_price ?? m0.yes_bid ?? "?"}` : "—",
          });
        }
      }
      pages++;
      cursor = d.cursor ?? "";
      if (!cursor) break;
    }
    console.log(`  scanned ${pages} pages`);
    if (hits.length === 0) console.log("  NO recession/debt-ceiling open events found");
    for (const h of hits) {
      console.log(`  [${h.ticker}] "${h.title}"  markets=${h.markets}  e.g. ${h.sample}`);
    }
  } catch (e) {
    console.log(`  ERR ${(e as Error).message}`);
  }
}

async function probePolymarket() {
  console.log("\n=== 2b. Polymarket — recession / debt-ceiling (Gamma public-search) ===");
  for (const q of ["recession", "debt ceiling", "recession 2026", "us recession"]) {
    try {
      const url = `${GAMMA_BASE}/public-search?q=${encodeURIComponent(q)}&limit_per_type=20&events_status=active`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { accept: "application/json", "user-agent": "cbt/1.0" },
      });
      if (!res.ok) {
        console.log(`  q="${q}" HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as {
        events?: { slug?: string; title?: string; closed?: boolean; endDate?: string; volume?: number; liquidity?: number; markets?: { question?: string; outcomes?: string; outcomePrices?: string; volume?: number; liquidity?: number }[] }[];
      };
      const evs = (data.events ?? []).filter((e) => RX.test(`${e.slug ?? ""} ${e.title ?? ""}`));
      console.log(`  q="${q}" → ${evs.length} matching event(s)`);
      for (const e of evs.slice(0, 6)) {
        console.log(
          `    slug=${e.slug}  closed=${e.closed}  end=${e.endDate?.slice(0, 10) ?? "?"}  vol=${Math.round(e.volume ?? 0)}  liq=${Math.round(e.liquidity ?? 0)}  markets=${(e.markets ?? []).length}`,
        );
        const m0 = (e.markets ?? [])[0];
        if (m0) console.log(`       e.g. "${(m0.question ?? "").slice(0, 70)}"  outcomes=${m0.outcomes}  prices=${m0.outcomePrices}`);
      }
    } catch (e) {
      console.log(`  q="${q}" ERR ${(e as Error).message}`);
    }
  }
}

async function probeCpiUnemp() {
  console.log("\n=== 3. CPI / UNEMP current values (FRED, market_ticks) ===");
  const db = getDb();
  const rs = await db.execute(
    `SELECT symbol, price, change_pct, market_date, ticked_at
     FROM market_ticks
     WHERE symbol IN ('CPI','UNEMP')
       AND id IN (SELECT MAX(id) FROM market_ticks WHERE symbol IN ('CPI','UNEMP') GROUP BY symbol)
     ORDER BY symbol`,
  );
  if (rs.rows.length === 0) console.log("  NONE — no CPI/UNEMP rows in market_ticks");
  for (const r of rs.rows) {
    console.log(`  ${String(r.symbol).padEnd(6)} ${r.price}  chg=${r.change_pct}  marketDate=${r.market_date}  ticked=${r.ticked_at}`);
  }
}

async function main() {
  await probeFmp();
  await probeKalshi();
  await probePolymarket();
  await probeCpiUnemp();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
