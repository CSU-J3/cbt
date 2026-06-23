# HO 302 — B2 ODDS: add Fed-cut September

The 301 probe settled the B2 roster update: of the mock's three additions, only the September Fed-cut builds. The defense trio still 402s (no FMP tier change) and there's still no debt-ceiling market on either venue. So this adds the one buildable piece: the September Fed-cut horizon alongside July.

## Change

The ODDS strip currently shows SHUTDOWN, FED CUT, RECESSION. After this:
- Relabel the existing FED CUT → FED CUT JUL (it's the July decision; the mock disambiguates the two horizons).
- Add FED CUT SEP right after it, dual-source, wired exactly like July:
  - Kalshi `KXFEDDECISION-26SEP` (series KXFEDDECISION, strike 2026-09-16; the cut-sum compute the July market uses works, ~16%).
  - Polymarket `fed-decision-in-september-762` (the fed-decision-in-{month} slug pattern fetchPolymarketFedCut already discovers).

ODDS becomes SHUTDOWN, FED CUT JUL, FED CUT SEP, RECESSION, each dual-source K/P with the 287 SourceTags.

## Notes

- The September Kalshi strike is the same KXFEDDECISION series as July, so it shouldn't add a new concurrent fetch; but confirm the markets cron still ticks all odds without tripping the Kalshi rate limit (the 290 jittered backoff should cover it).
- Not in scope: the defense trio and debt ceiling (both still walls per 301). If a debt-risk slot is ever wanted, the only honest option 301 found is a US-DEFAULT pair (Kalshi KXDEFAULT-26DEC31 ~5% + Polymarket us-defaults-on-debt-by-2027 ~3%), accurately labeled DEFAULT, not debt ceiling. Flagged, not built.

## Ship

Commit (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Then trigger the markets cron and confirm the ODDS strip shows SHUTDOWN · FED CUT JUL · FED CUT SEP · RECESSION, the Sep market populated K/P, no rate-limit failures in the tick.
