# 142 — Markets ticker data layer

## What this is

Ships the data pipeline behind a markets ticker on the main dashboard. Five indices that act as policy-effect indicators (S&P 500, 10Y Treasury yield, WTI crude, DXY, VIX), refreshed every 30 minutes during US market hours via GitHub Actions cron (bypassing Vercel Hobby's once-daily limit), persisted to a `market_ticks` table, exposed through a query helper for the UI.

This handoff is the data layer only. The visual ticker component (marquee, pause-on-hover, mobile behavior, styling) lives in the design chat and gets built against the query helper this handoff exposes.

## Framing

The roadmap framing question is "WTF is going on in Congress?" Markets aren't separate from that — they're a real-time reaction surface to policy actions (tariffs, Fed pressure, energy decisions, debt-ceiling moments). A small ticker on the dashboard puts the policy effect next to the policy activity. Not Bloomberg cosplay; a policy-effect lens.

## In scope

- New `market_ticks` table (append-only, history retained)
- New `/api/cron/markets` route that fetches the five symbols from Stooq, computes percent change vs previous close, and writes rows
- GitHub Actions workflow at `.github/workflows/markets-tick.yml` running on a market-hours schedule
- Query helper `getLatestMarketTicks()` in `lib/queries.ts`
- Wrap the new route in the `cron_runs` instrumentation pattern from HO 139
- `SKILL.md` update for the new table, new route, and the GitHub-Actions-cron pattern (worth documenting as a reusable trick)

## Out of scope

- The visual ticker component itself. That's design chat work against this handoff's query helper.
- Historical chart of market data. The history accumulates organically; charting is future work.
- Sector ETFs (defense, energy, financials, etc.). Possible v2; not in v1.
- After-hours or pre-market handling. Stooq returns whatever it has; we record it. UI can decide whether to show "stale" indicators.
- Real-time tick-level data. Once-per-30-min is the refresh contract.
- Anomaly detection or alerting (e.g. "VIX spiked 20% in 30 min"). Out of v1.

## Schema

Add to `scripts/migrate.ts` and run `npm run migrate` against prod:

```sql
CREATE TABLE IF NOT EXISTS market_ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,            -- internal symbol: 'SPX', 'TNX', 'WTI', 'DXY', 'VIX'
  price REAL NOT NULL,             -- last price from the data source
  change_pct REAL,                 -- percent change vs previous close (nullable if not computable)
  ticked_at TEXT NOT NULL,         -- ISO timestamp of when we fetched (UTC)
  market_date TEXT NOT NULL        -- YYYY-MM-DD of the trading day this tick represents
);

CREATE INDEX IF NOT EXISTS idx_market_ticks_symbol_time
  ON market_ticks(symbol, ticked_at DESC);
```

History stays — 5 symbols × 13 ticks/day × 252 trading days = ~16,400 rows/year. Trivial.

## Symbol map

In a new `lib/markets.ts`:

```ts
export const MARKET_SYMBOLS = [
  { internal: 'SPX', stooq: '^spx', label: 'S&P 500',          format: 'index' },
  { internal: 'TNX', stooq: '^tnx', label: '10Y Treasury',     format: 'yield' },
  { internal: 'WTI', stooq: 'cl.f', label: 'WTI Crude',        format: 'price' },
  { internal: 'DXY', stooq: '^dxy', label: 'Dollar Index',     format: 'index' },
  { internal: 'VIX', stooq: '^vix', label: 'VIX',              format: 'index' },
] as const;
```

**Verify the Stooq symbols against `https://stooq.com/q/?s=<symbol>` before locking them in.** DXY in particular sometimes resolves under different aliases (`^dxy`, `usd_i`, etc.). If a symbol returns no data, log it and fall back; don't crash the whole tick.

## Sync route

`app/api/cron/markets/route.ts`:

1. Verify `CRON_SECRET` via `Authorization: Bearer ...` header (same pattern as existing cron routes).
2. Wrap in the `cron_runs` instrumentation from HO 139.
3. For each symbol in `MARKET_SYMBOLS`:
   - Fetch `https://stooq.com/q/l/?s=<stooq>&f=sd2t2ohlcv&h&e=csv`
   - Parse CSV — Stooq returns one data row with columns: Symbol, Date, Time, Open, High, Low, Close, Volume.
   - Compute `change_pct` against the previous trading day's close. Stooq's daily CSV gives current `Close`; for previous-day reference, store the most recent `market_date != today` value from our own `market_ticks` and diff against that. Skip the change calc if no prior row exists (first tick of the symbol).
   - Insert one row into `market_ticks` with current price, change_pct, ticked_at = now, market_date = parsed CSV date.
4. Return a summary: `{ ticked: 5, failed: 0, duration_ms: ... }`.
5. Errors per symbol logged but non-fatal — one failed symbol shouldn't kill the rest. Follow the chronic-err pattern from `/api/cron/news`.

Time budget: this is small (5 HTTP fetches in parallel + 5 small upserts). Should complete in 2-5 seconds. No need for AbortController gymnastics, but mirror the wrapper conventions so it logs cleanly to `cron_runs`.

## GitHub Actions workflow

Create `.github/workflows/markets-tick.yml`:

```yaml
name: Markets Tick

on:
  schedule:
    - cron: '0,30 14-20 * * 1-5'  # every 30min, 14:00-20:00 UTC, Mon-Fri
                                   # ~9-10 AM to 3-4 PM ET depending on DST
  workflow_dispatch: {}            # manual trigger for testing

jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - name: Hit markets endpoint
        run: |
          curl -fsS -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            https://cbt-chi-silk.vercel.app/api/cron/markets
```

Two setup notes for after the file lands:

1. Add `CRON_SECRET` as a GitHub repository secret (matches the value already in Vercel env).
2. First scheduled run may be up to ~15 min delayed — GitHub Actions cron isn't punctual. That's fine for this use case.

DST drift means the schedule will be 13:30-19:30 ET in summer and 14:30-20:30 ET in winter. Either accept the off-hour edges or define two schedules with date-range conditions. v1 accepts the drift.

## Query helper

In `lib/queries.ts`:

```ts
export type MarketTick = {
  symbol: string;
  label: string;
  price: number;
  changePct: number | null;
  tickedAt: string;
  format: 'index' | 'yield' | 'price';
};

export async function getLatestMarketTicks(): Promise<MarketTick[]>
```

SQL: window-function or correlated subquery to grab the most recent row per symbol.

```sql
SELECT m.symbol, m.price, m.change_pct, m.ticked_at, m.market_date
FROM market_ticks m
INNER JOIN (
  SELECT symbol, MAX(ticked_at) AS max_t
  FROM market_ticks
  GROUP BY symbol
) latest ON m.symbol = latest.symbol AND m.ticked_at = latest.max_t
ORDER BY m.symbol;
```

Join the `label` and `format` from the in-code `MARKET_SYMBOLS` map; don't denormalize them into the DB.

Cache with `unstable_cache(..., ['market-ticks-latest'], { tags: ['markets'], revalidate: 60 })`. The sync route should call `revalidateTag('markets')` after a successful tick so the dashboard picks up new prices on the next render.

## Acceptance

1. Migration applied to prod Turso; `market_ticks` table exists with correct schema and index.
2. `/api/cron/markets` returns 200 on first manual hit (`curl -X POST ... -H 'Authorization: Bearer ...'`) and writes 5 rows.
3. Stooq symbols verified — all 5 resolve to real data, no silent fallbacks.
4. `cron_runs` shows the new route logging cleanly per HO 139 pattern.
5. GitHub Actions workflow lands; manual `workflow_dispatch` trigger succeeds end-to-end.
6. `getLatestMarketTicks()` returns 5 rows in expected shape; verified via a quick script or scratch query.
7. After at least two ticks have run, `change_pct` is populated on the second tick (first tick is bootstrap, no prior reference).
8. `SKILL.md` updated.
9. Single commit: `feat: markets ticker data layer (HO 142)`.

## Notes

- **Why Stooq, not FRED?** FRED is the official Fed source but returns end-of-day only; its API isn't built for intraday. Stooq's CSV endpoint serves intraday-ish data (15-20 min delayed) for free with no API key. For a policy-effect view that doesn't need real-time precision, this is the right tradeoff. FRED stays as a fallback if Stooq goes down — symbols map 1:1 (^TNX → DGS10, etc.).
- **Why GitHub Actions, not Vercel Cron?** Vercel Hobby caps cron at once daily. GitHub Actions cron is free, runs on whatever schedule you set, and just hits a regular HTTP endpoint — Vercel doesn't care that the request comes from a non-Vercel cron. This pattern is worth documenting in `SKILL.md` because it generalizes; any future high-frequency sync (news refresh, race-rating polling, primary-results scraping) can use the same trick.
- **Stale-data semantics.** Outside market hours, ticks won't fire. The latest row's `ticked_at` will lag and the UI should show "as of X:XX UTC". That's design-chat territory but worth flagging now — the data layer doesn't pretend to be live.
- **Cost.** Zero new API spend. GitHub Actions free tier covers this trivially (~3,300 hits/year, each <1 min). Vercel function invocations negligible.
- **First-tick bootstrap.** The change-pct calc needs a prior reference row. The very first tick after deploy will have `change_pct = NULL`. The UI handles this by showing "—" or blank. Same applies whenever a new symbol gets added.
