# HO 177 — Expand tape to 14 symbols + enrich hover with full instrument name

## Why

Two asks, stacking on the HO 175+176 tape work (still on the `ho-175` branch, unmerged):

1. **Add 6 tickers** to fill out the tape: **XLF (financials), XLE (energy), XLI (industrials)** sector ETFs + **Bitcoin, Nasdaq, Dow** broader markets. Takes the tape from 8 → 14 symbols. (More symbols also gives the marquee more to scroll, reinforcing the "it actually moves" fix.)

2. **Enrich the hover.** Today hovering XLK shows only the short group label ("Tech") + update time. It should show the **full instrument name** ("Technology Select Sector SPDR Fund") + group + change% + as-of. The current `MarketTick.label` is the short group, not the full name — a new full-name field is needed.

## Constraints (same as HO 168)

- **Every new symbol must be fetchable free from Stooq or FRED, verified in Phase 1 with the exact symbol.** HO 168 precedent: VIX wasn't on Stooq (`^vix` → N/D) but worked via FRED `VIXCLS`. Don't add any symbol that 404s.
- **Bitcoin is the risk** — crypto feeds behave differently than equities; verify `btcusd` (or whatever Stooq uses) returns clean data, or drop it.
- Full instrument names are static facts (stable) — a hardcoded map, no liveness concern.

## Phase 1 — Diagnostic (HALT after)

Don't add anything yet.

1. **Verify each new symbol** against Stooq/FRED (fetch a sample, report the actual response + working symbol string + a value):
   - **XLF** (Financial Select Sector SPDR) — Stooq `xlf.us`?
   - **XLE** (Energy Select Sector SPDR) — Stooq `xle.us`?
   - **XLI** (Industrial Select Sector SPDR) — Stooq `xli.us`?
   - **Nasdaq** — Stooq index symbol (`^ndq`? `^ixic`?) — confirm which returns clean data and what its price magnitude is (affects the per-symbol width pin).
   - **Dow** — Stooq (`^dji`?) — confirm symbol + magnitude (Dow is ~40,000+ → 6-7 digit price, needs a wide width pin).
   - **Bitcoin** — Stooq (`btcusd`?) — confirm it returns clean data; report magnitude (BTC ~$100k → very wide). If no clean free source, **report and drop it** (don't ship a 404).
   For each: working symbol + source + sample value + digit magnitude.

2. **Per-symbol width pins for the new symbols** (HO 176 added `PRICE_SLOT_CH`). The new ones have very different magnitudes — Dow (~40,000 = 6+ digits) and BTC (~100,000+ = 7+ digits with commas) are much wider than anything currently in the tape. Report the right `ch` pin for each so they stay jump-proof (right-aligned, sized for realistic max). This matters — a too-narrow pin on Dow/BTC reintroduces the jump when they cross a digit boundary.

3. **Full-name map.** Report where symbol metadata lives (`MARKET_SYMBOLS` in `lib/markets.ts` per SKILL — it already has the short `label`). Propose adding a `fullName` field per symbol for all 14:
   - SPX → "S&P 500", WTI → "Crude Oil (WTI)", TNX → "10-Year Treasury Yield", GOLD → "Gold (Spot)", VIX → "CBOE Volatility Index"
   - ITA → "iShares U.S. Aerospace & Defense ETF", XLK → "Technology Select Sector SPDR", XLV → "Health Care Select Sector SPDR"
   - XLF → "Financial Select Sector SPDR", XLE → "Energy Select Sector SPDR", XLI → "Industrial Select Sector SPDR"
   - Nasdaq → "Nasdaq Composite" (or per the actual index), Dow → "Dow Jones Industrial Average", Bitcoin → "Bitcoin (USD)"
   Report whether `fullName` threads cleanly through `MarketTick` → the tape's hover popover.

4. **Marquee + measurement check.** 14 symbols × 2 track-halves is a much longer track. Confirm the measured-duration approach (40px/sec) still works and the tape doesn't scroll too slowly/fast. Report whether 14 needs any speed adjustment or if 40px/sec holds.

5. **Cron split.** The new ETFs/indices are intraday Stooq symbols (belong in `markets-tick.yml ?source=stooq`); Bitcoin trades 24/7 (Stooq, intraday-ish); none are FRED. Confirm the new symbols join the Stooq intraday set, and the daily run still does all of them. Report any cron adjustment.

**HALT. Report: verified symbols (with any drops), per-symbol width pins for the new ones (esp. Dow/BTC), the fullName map wiring, the speed check at 14 symbols, and the cron split. Wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

- Add the verified symbols to `MARKET_SYMBOLS` (drop any that failed Phase 1).
- Add the `fullName` field to all 14 symbols; thread it to the hover popover.
- **Enriched hover:** full name (new, prominent) + group label + change% + as-of date.
- Add per-symbol `PRICE_SLOT_CH` pins for the new symbols per Phase 1 (Dow/BTC need wide pins — get these right or the jump returns).
- Same percent-change-vs-prior-session, same `market_ticks` upsert, same non-fatal per-symbol failure (HO 139 chronicErr).
- Cron: new Stooq symbols join the intraday set; daily run does all.
- Preserve everything from 175/176: jump fix, hover-pause, size bump, `<700px` hide, measurement.

## Verification

- Show the diff.
- Confirm the cron fetches all verified symbols, `market_ticks` rows land for each (run it once).
- Confirm the tape renders 14 (or the verified count), hover shows the full name + group + change + as-of.
- **Jump regression (critical):** the new wide symbols (Dow/BTC) must have width pins that keep them stable across polls — confirm structurally, Corey eyeballs live through 2+ poll cycles.
- Type check passes.
- Continue on the `ho-175` branch — Corey eyeballs locally before the whole tape fix (175+176+177) merges to main as one unit.

## Out of scope
- No paid data source — if a symbol isn't free on Stooq/FRED, drop it (don't source elsewhere).
- No live-primary feature (parked).
