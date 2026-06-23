# HO 288 — B2 tape: data probe

Probe before building. The B2 tape spec expands the roster (tech + defense equities) and re-purposes the second strip into prediction-market ODDS (shutdown, Fed-cut, recession, debt ceiling). Most of that data probably isn't wired yet, so this confirms what's actually fetchable before the build scopes around it. 287 already shipped the SourceTag/MicroTag the tape will use and 274 pinned the labels, so this arc is the roster, the ODDS strip, counter-scroll, and the hover box; the styling primitives are ready.

Diagnosis only. Don't build.

## 1. Equities (MARKETS strip additions)

The spec adds tech (NVDA, AAPL, MSFT, GOOGL) and defense (LMT, RTX, NOC, GD). The feed currently pulls indices + FRED rates, not individual equities.

Probe FMP `/stable/quote` for these eight tickers from the deployment egress, not locally (FMP keys live in Vercel prod, and FMP behavior is tier- and egress-specific; free tier serves only `/stable/`, v3 quote 403s, ETFs 402-gate). For each ticker confirm it returns a current price + change the tape can render. Note any that 403/402/return nothing.

## 2. ODDS strip (prediction markets)

The spec wants the second strip to carry shutdown, Fed-cut horizons, recession, and debt ceiling, dual-source (Kalshi + Polymarket). Shutdown and Fed-cut are already on the current signals strip, so those are wired. Recession and debt ceiling are flagged illustrative in the spec.

Probe Kalshi and Polymarket for recession and debt-ceiling markets: do they exist, what are the identifiers/slugs, and is each single- or dual-source? Report which of the four ODDS items are actually available on each venue.

## 3. CPI / UNEMP (no probe, just confirm)

The spec moves CPI and UNEMP from the second strip to MARKETS as econ MO badges. These are FRED, already wired, so it's a UI relocation with no new data. Just confirm the current CPI/UNEMP values are on hand.

## Output

Report: which of the eight equities `/stable/quote` returns cleanly from prod egress; which of recession/debt-ceiling exist on Kalshi and Polymarket (with identifiers); and confirmation CPI/UNEMP are available for relocation. That tells us whether the specced roster builds as-is or trims to what's fetchable. Don't change anything; the build is the next handoff.

## Ship

Read-only probe. If you add a throwaway probe script, follow the `scripts/diagnostic/*-NNN.ts` convention and keep it for build verification. No deploy change to verify.
