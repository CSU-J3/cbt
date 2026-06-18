# HO 251 — tape swap: econ/prediction symbol set + static

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 251.

## What this is

The build the HO 250 probe gated. Swap the dashboard tape to the FULL spec's set — `S&P · NASDAQ · 10Y · CPI · UNEMP · SHUTDOWN ODDS · FED CUT · WTI` — dropping BTC, GOLD, DOW, NATGAS, VIX. S&P / NASDAQ / 10Y / WTI stay on their existing FMP + FRED wiring. The four new symbols all probed swap-ready from egress (250). Also make the tape **static (no crawl)** — deferred from HO 244 to here because the trimmed 8-symbol set is what makes a static full-width row fit.

Read the live markets fetch + symbol config + the tape component before editing; `/mnt/project` is a fossil. The probe referenced `MARKET_SYMBOLS`, `MarketSymbol`, `fetchFred` — confirm those live.

## Resolved premises — from the 250 probe, don't re-derive

- **CPI:** FRED `CPIAUCSL` with `units=pc1` → YoY % directly (4.17% for May 2026; the raw index ~334 is meaningless on a tape). **Monthly.**
- **UNEMP:** FRED `UNRATE`, default units (already a %, 4.3% May 2026). **Monthly.**
- **FED CUT:** Kalshi `KXFEDDECISION` (not `KXFED`). Dynamic discovery: `events?series_ticker=KXFEDDECISION&status=open`, pick soonest by `close_time`; currently `KXFEDDECISION-26JUN` (FOMC Jun 17), rolls to `-26JUL` automatically after it closes. Headline = P(cut) = sum of the meeting's `-C25` + `-C26` yes-prices (~2% now; market is 99% maintain). Deeply liquid.
- **SHUTDOWN ODDS:** Kalshi `KXGOVTSHUTDOWN` (with the T — `KXGOVSHUTDOWN` returns nothing). Dynamic discovery: `events?series_ticker=KXGOVTSHUTDOWN&status=open`, soonest-closing; currently `KXGOVTSHUTDOWN-26OCT01` (FY2027 deadline). Single yes/no → yes-price = probability (49% last trade). **Thin** (bid/ask 0.37/0.71, OI ~1,556).
- **Kalshi auth:** none. `external-api.kalshi.com/trade-api/v2`, same client/path the race-odds cron (217/218) already uses from egress.
- Egress confirmed for all four (same proven hosts the live tape + the 218 cron already hit).

## The build

1. **Symbol set.** Update the tape symbol config to the 8-symbol spec set; drop BTC / GOLD / DOW / NATGAS / VIX. S&P / NASDAQ / 10Y / WTI unchanged.
2. **FRED `units` param.** Plumb a `units` field into the symbol config; CPI = `pc1`, UNEMP = default (omit). `fetchFred` passes it through.
3. **Per-symbol freshness — the main wrinkle.** CPI + UNEMP are monthly; the existing 26h STALE wash would flag them permanently broken. Add a per-symbol cadence category: daily-ish symbols keep the 26h wash; monthly symbols (CPI, UNEMP) are NOT washed at 26h — they read as current as of their print month. Minimal display: show the value normally, optionally an "as of {Mon}" suffix; only treat a monthly symbol as stale if it's genuinely overdue (e.g. >~40 days past its expected release). May CPI must not render as a dead pipeline.
4. **Kalshi computed/dynamic symbols — the new fetch shape.** FED CUT and SHUTDOWN aren't static symbol→quote maps. Add a Kalshi source kind to the markets fetch that (a) discovers the soonest open event in the series (`KXFEDDECISION` / `KXGOVTSHUTDOWN`) via `events?status=open` sorted by `close_time`, then (b) computes the headline — FED CUT = sum of the meeting's `-C25` + `-C26` yes-prices; SHUTDOWN = the single market's yes-price. Store the number + the event's resolution date (for an optional label, e.g. `FED CUT · JUN 17`, `SHUTDOWN · OCT 1`). Reuse the existing Kalshi client/auth. Runs in the markets fetch/cron (HO 227 path) alongside the other symbols. This is closer to the race-odds cron than to the static `MARKET_SYMBOLS` map.
5. **SHUTDOWN thinness — ship it.** Use the last-trade yes-price (49%); if Kalshi exposes a more representative mark, prefer it. No liquidity gate this round — shutdown risk is exactly the signal this dashboard surfaces, and it's a real trade, not fabricated. The 234 closed-state N/As it if no market is open. (Conservative override, if you want it later: gate on min-OI/spread → N/A. Flagged, not built.)
6. **Static tape (no crawl).** Remove the crawl/marquee; render the 8 symbols as a static full-width row. Keep the 234 closed-state + STALE precedence (now per-symbol-cadence-aware per #3) and the 176/177/179 spacing/hover. Confirm the static 8-symbol row fits full-width on desktop without overflow (dropping wide values like `GOLD 4,239.90` / `BTC 63,482.72` helps). Mobile is a separate pass — note behavior, don't solve it.

## Constraints

- The markets cron fetches + stores all symbols; the Kalshi symbols add discovery + compute to that path. On a fetch failure a symbol degrades to **N/A** (not a stale/zero), and the cron reports `error` in `cron_runs` — don't bury a Kalshi miss as success.
- No new tokens. Reuse the 234 closed-state token.
- Named `git add` per commit. Stale `.next` rule on the UI ship (verify the stylesheet loads). `npm run build` clean.

## Ship report

All 8 symbols render and the 5 dropped ones are gone. CPI/UNEMP show monthly values with no false STALE (state the cadence handling). FED CUT + SHUTDOWN show computed probabilities with the nearest-open-event discovery working — state the events found and the values. Static row, no crawl, fits full-width desktop (mobile noted). A simulated Kalshi miss degrades to N/A + a `cron_runs` error, not a buried zero. Build clean.
