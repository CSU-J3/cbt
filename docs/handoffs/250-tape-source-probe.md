# HO 250 — tape source probe: FRED CPI/UNEMP + Kalshi shutdown/fed-cut

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 250.

## What this is

The gate before scoping the tape swap. The FULL spec wants the tape to read `S&P · NASDAQ · 10Y · CPI · UNEMP · SHUTDOWN ODDS · FED CUT · WTI`. Four of those already ride the live tape (S&P / NASDAQ / 10Y / WTI via FMP + FRED). The four NEW ones — CPI, UNEMP (FRED), SHUTDOWN ODDS, FED CUT (Kalshi) — get probed here. **Probe only; build nothing.** The deliverable is a report that scopes the swap.

This project gets burned scoping third-party APIs from local success: FRED's `fredgraph.csv` was IP-blocked from Vercel egress while working locally, Stooq went dead, FMP v4 vanished. Here the access is in better shape — FRED's JSON API and Kalshi are both already hit from egress in prod (228 for FRED, 217/218 for Kalshi race odds), and the new symbols are the SAME endpoints with different params, not new surfaces. So the egress risk is lower than the canonical csv case. The real unknowns are the specific series/tickers, their shape, and how to render each as one tape number.

## Probe targets

### FRED — CPI and UNEMP (ride the existing `fetchFred` path)
- **UNEMP:** `UNRATE`. Confirm latest value + release cadence. It's already a %.
- **CPI:** presentation is the catch. `CPIAUCSL` is an index level (~314) — meaningless on a ticker. The tape wants YoY inflation **%** (~3.x%). FRED's observations endpoint has a `units=pc1` transform (percent change from a year ago) that may yield YoY CPI directly off `CPIAUCSL` — confirm that, or fall back to computing the 12-month change. Report which, with the latest value.
- Both are **monthly** series, not daily — report the latest print date so the tape shows "as of {month}" rather than implying a daily figure.

### Kalshi — SHUTDOWN ODDS and FED CUT (ride the existing Kalshi client / auth)
- The hard part: Kalshi markets are **date-bound and ephemeral** — they resolve and close, so there's no permanent "shutdown" or "fed-cut" ticker. Determine whether there's a stable way to find the CURRENT relevant market each run (an event/series prefix to query for open markets — a funding-deadline series, the next-FOMC series) or whether it needs dynamic discovery. This is the key scoping input — it decides how the tape integration finds the market.
- **SHUTDOWN ODDS:** find the current open government-shutdown / funding-deadline market. Report the ticker (or the query that finds it), the current yes-price (= probability %), the resolution criterion + date, and whether it's liquid/active.
- **FED CUT:** find the next FOMC rate-decision market (cut odds). Report ticker/query, current cut probability %, which meeting it resolves on, liquidity.
- Confirm the auth matches the existing race-odds Kalshi access (same key/path) or note any difference.

## Egress confirmation

The endpoints are the same proven ones with different params, so this is a sanity check, not a reason to build a heavy probe harness. Confirm the specific series/tickers return from egress — exercise the deployed FRED/Kalshi paths with the new series/tickers (a light temporary probe route hit on Vercel then torn down, or a manual fetch in the deployed context). Don't leave a probe route in the tree.

## Report — the deliverable (no code ships)

Per symbol — CPI, UNEMP, SHUTDOWN ODDS, FED CUT:
- **Available from egress?** Yes + the access pattern (series ID / ticker-or-query), or no + why → that symbol degrades to N/A on the tape, which the HO 234 closed-state already supports.
- **The single tape number** it yields (value + unit) and its freshness/cadence.
- **Kalshi only:** the current-market discovery approach (stable prefix vs dynamic), since that's what the tape integration needs to locate the market each run.

End with a one-line readiness verdict: which of the four are swap-ready, which degrade to N/A. That report scopes the tape-swap handoff — where the drop/add symbol-set decision (the spec drops BTC/GOLD/DOW/NATGAS/VIX for these) actually gets made.
