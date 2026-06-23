# HO 290 — B2 ODDS strip: prediction-markets-only

289 finished the MARKETS equities. This finishes the second strip: relabel it ODDS, make it prediction-markets-only, add recession, move the econ readings to MARKETS. Uses the recession identifiers 288 confirmed and the SourceTag/MicroTag from 287.

## 1. Relocate CPI / UNEMP to MARKETS

They're on the second strip now; move their render to the MARKETS strip. They're FRED monthly, so they take the MO MicroTag (month-over), not EOD — eod is FRED-daily (the 10Y/WTI treatment), and CPI/UNEMP aren't daily. Data's already in market_ticks (288: CPI 4.2% pc1, UNEMP 4.3), so this is render-target only, no fetch.

## 2. Add recession to the second strip, dual-source

Wire recession the same way shutdown and Fed-cut already are (locate that dual-source reconcile path and follow it). Identifiers from 288:
- Kalshi `KXRECSSNBER-26`
- Polymarket `us-recession-by-end-of-2026`

Render with the K/P SourceTag from 287, P beside K. No debt ceiling — 288 found no clean market on either venue and the proxies are off-question, so it's dropped, not proxied.

## 3. Relabel and confine

The second strip's pinned label (274) becomes ODDS. After the relocation it carries only prediction markets: shutdown, Fed-cut, recession. Confirm nothing econ remains on it.

## Notes

- Shutdown and Fed-cut already carry K/P tags from the 287 retrofit; recession joins them in the same treatment.
- The recession change/direction convention follows whatever shutdown/Fed-cut show.
- Counter-scroll and the hover box are later passes; don't touch motion or add hover here.

## Ship

Commit the data wiring and the composition separately if it's clean to do so (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify: MARKETS shows CPI/UNEMP as MO badges; the second strip reads ODDS and shows shutdown · Fed-cut · recession with K/P tags, nothing econ left on it.
