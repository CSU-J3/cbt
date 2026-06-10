# HO 168 — Markets tape: add 5 tickers + fix the marquee for N symbols

## Why

The markets tape (HO 142 data + HO 149 marquee) currently carries 4 symbols (SPX, WTI, DXY, TNX) and the marquee doesn't visibly scroll — per SKILL.md line 888 the animation is hardcoded for "only four symbols" (`translateX 0 → -50%`, 22s), and four items don't overflow a wide viewport so the loop reads static. We want a Congress-relevant set of 8 and a marquee that actually moves.

**Target set (8):** SPX, WTI, TNX (keep), drop DXY, add **defense (ITA)**, **tech (XLK)**, **health (XLV)** sector ETFs, **gold**, **VIX**. The sector ETFs tie market movement to legislative activity (defense/health/tech bills) — on-theme for "WTF is going on in Congress?" in a way DXY wasn't.

Two coupled problems: (1) the ingestion must fetch 5 new symbols from a working free source, and (2) the marquee wrap math (currently assuming 4 symbols at -50%) must be generalized so any symbol count loops seamlessly.

## API-liveness rule — this is why Phase 1 exists

HO 65 and HO 70 both shipped against dead/changed endpoints and broke. **SKILL.md line 410 + 509 explicitly say VIX was deferred in HO 142: "no free reliable source."** So VIX is the highest-risk ticker in this set. Do not add any symbol to the ingestion until Phase 1 confirms it's fetchable, with the exact symbol string, on the current free tier.

## Phase 1 — Diagnostic (HALT after)

Don't change ingestion or the marquee yet. Verify sources + characterize the marquee, then halt.

1. **Read `lib/markets.ts` and `/api/cron/markets`.** Report the current fetch pattern: how Stooq symbols are formatted in the URL, how FRED series are pulled, how percent-change is computed, how rows land in `market_ticks`.

2. **Verify each new symbol against a free source** (fetch a sample, report the actual response):
   - **Gold** — Stooq symbol (likely `XAUUSD` or a gold futures/ETF like `GLD`)? Confirm which returns clean data.
   - **Defense → ITA** (iShares US Aerospace & Defense) — Stooq US-equity format (e.g. `ITA.US`)? Confirm.
   - **Tech → XLK** (Technology Select Sector SPDR) — same, confirm `XLK.US` or equivalent.
   - **Health → XLV** (Health Care Select Sector SPDR) — confirm.
   - **VIX** — SKILL says no free source was found in HO 142. **Check FRED series `VIXCLS`** (CBOE Volatility Index, daily close) — it's the most likely free path. Confirm it returns data via the existing FRED CSV pattern. If `VIXCLS` works, VIX is in via FRED (end-of-day, like TNX). If nothing free and reliable exists, **report that and drop VIX** — don't ship a symbol that 404s the cron.

   For each: report the working symbol string + source (Stooq vs FRED) + a sample value, or "no free source — drop."

3. **Confirm the drop of DXY** is clean — it's currently fetched; removing it shouldn't orphan anything. Report any code that assumes DXY specifically.

4. **Characterize the marquee.** Read `MarketsTapeClient.tsx`. Report how the double-track `translateX 0 → -50%` wrap works and why it's tied to 4 symbols. Propose how to generalize it so N symbols (here 8) loop seamlessly — the standard fix is duplicating the track content and animating to exactly -50% of the *doubled* track regardless of item count, with the duration scaled to content width (or a fixed px/sec speed) so 8 symbols scroll at a readable pace rather than whipping past. Report the cleanest approach for this codebase.

5. **Speed/duration.** With 8 symbols the 22s/-50% timing will be wrong. Propose a duration (or a px/sec rate) that reads as a calm Bloomberg crawl, not a fast scroll. Note the motion exception + reduced-motion + pause-toggle behavior must be preserved exactly (SKILL line 888).

**HALT. Report the verified symbol set (with any drops), the marquee generalization plan, and the proposed speed, then wait for sign-off before Phase 2.**

## Phase 2 — Implementation (only after sign-off)

Based on Phase 1:

- Add the verified symbols to the ingestion (`lib/markets.ts` + the markets cron lineup). Drop DXY. If VIX has no free source per Phase 1, ship the 7 that work and note VIX as still-deferred.
- Each new symbol: same percent-change-vs-prior-row computation, same `market_ticks` upsert, same non-fatal per-symbol failure handling (HO 139 chronicErr pattern) so one bad fetch doesn't fail the cron.
- Generalize the marquee wrap so the verified symbol count loops seamlessly (duplicate track → animate to -50% of the doubled width, or the Phase-1-agreed approach). Scale duration/speed per Phase 1.
- Preserve the pause toggle (`cbt-tape-paused`), reduced-motion handling, and the client-side staleness check (HO 149) exactly.
- The tape stays hidden <700px (HO 156) — don't touch that.
- Update the GitHub Actions markets cron if the symbol count change affects the workflow (it shouldn't — same route — but confirm).

## Verification

- Show the diff.
- Confirm the markets cron fetches all verified symbols and writes `market_ticks` rows for each (run it once or read a fresh tick set).
- Confirm the marquee visibly scrolls with the full symbol set and loops seamlessly (no jump at the wrap).
- Confirm pause toggle + reduced-motion still work.
- Type check passes.

## Out of scope

- No 12-hour timestamp change (HO 169).
- No weekly-report move (HO 169).
- No new data source beyond Stooq/FRED — if a symbol isn't on either for free, it's dropped, not sourced elsewhere.
