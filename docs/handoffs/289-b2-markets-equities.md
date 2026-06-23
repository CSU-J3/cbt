# HO 289 — B2 MARKETS strip: add equities

288 confirmed the roster. This adds the equities that build; the ODDS restructure and the motion/hover layers are later handoffs.

Add five equities to the MARKETS strip via FMP `/stable/quote`: NVDA, AAPL, MSFT, GOOGL (tech), LMT (defense). 288 confirmed all five return clean price + change + changePct from prod egress. Do NOT add RTX, NOC, GD — they 402 on the FMP free tier (the same gate that blocked the sector ETFs in 227), confirmed tier-determined not IP, so they're out unless the tier changes.

Locate the current MARKETS fetch + render (the indices path; grep the markets tape data layer and component). Wire the five tickers alongside the existing indices, same item shape (name + value + change). Match the EOD freshness treatment the indices already use (the 287 retrofit put EOD on the markets tape via MicroTag) — equities take the same EOD MicroTag.

Leave the second strip alone this pass. CPI/UNEMP relocation, recession, and the prediction-markets-only restructure are the next handoff.

## Notes

- FMP `/stable/quote` is the confirmed endpoint/tier; same key already in prod. If it batches (multi-symbol), use that; otherwise per-symbol is fine for five.
- No source tag on equities. K/P source tags are prediction-markets-only (the ODDS strip). Equities get the EOD freshness micro-tag only, consistent with the indices.
- Identifiers, direct: FMP symbols NVDA / AAPL / MSFT / GOOGL / LMT.

## Ship

Commit the fetch wiring + render together (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify MARKETS shows the five new equities with values + changes + EOD badges alongside the indices; second strip unchanged.
