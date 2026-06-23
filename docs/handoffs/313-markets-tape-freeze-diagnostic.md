# HO 313 — Markets tape freeze: diagnostic

Confirm the next free number before saving (`ls docs/handoffs/ | sort -V | tail`). Body assumes 313; rename if taken. (HO 312, the reports index, is already written and unaffected by this.)

## What this is

The masthead tape on `/` is frozen. Both strips read `AS OF 8:46 PM ET · STALE` while the bills sync ran fresh at 10:06 PM, so the cron fires but the markets fetch step isn't writing new ticks. This handoff finds exactly where and why the fetch stopped producing fresh data. It does not fix it. The fix can't be pre-written because the failure is in external sources on a moving tier (FMP free tier, FRED egress, Kalshi/Polymarket), and the failure mode dictates the fix: re-key, swap endpoint, swap source, fix env scope, or handle a rate limit. Diagnose, HALT, report; I scope the fix from the findings.

The swap just put this stale tape on the most-visible surface on the site, so it's the priority over the reports index.

## Read-only

This is a probe, not a change. Read `cron_runs`, read the fetch code, hit the sources from Vercel egress. Make no pipeline edits. The one allowed code touch is a temporary read-only probe route, and only if the cron's logging doesn't already expose the per-source cause (step 4). Remove it or hand it to the fix pass; don't leave a debug route lingering.

## Resolved premises (known gotchas — confirm against live, don't rediscover)

- The STALE flag is working (HO 234). The tape honestly reports old data; the bug is the pipeline, not the flag. Don't touch the staleness or closed-state logic.
- `cron_runs` is the durable log (HO 105). Vercel Hobby keeps function logs about 30 minutes, useless for a freeze that started hours or days ago, so the run history lives in `cron_runs`, not the Vercel log viewer.
- FMP free tier: only `/stable/` endpoints work; v3 quote 403s as legacy, ETFs 402 as gated. It's a moving target. Probe the exact endpoint the cron uses, on the prod tier, live.
- FRED `fredgraph.csv` is cloud-IP-blocked from Vercel egress; the working path is the JSON API at `api.stlouisfed.org` with a free key. FRED and FMP both behave differently from Vercel IPs than from a laptop, so probe from Vercel egress, not locally.
- Env vars must sit in the **Production** scope, not just preview. `FMP_API_KEY` was absent from prod in a past incident. Encrypted vars can't be pulled via CLI (`vercel env pull` returns empty strings), so confirm presence and scope in the Vercel dashboard or via a deployed `!!process.env.X` readout, never by trying to read the value.
- Hobby cron is once daily, 60s ceiling. Confirm whether markets rides the main daily cron (bills succeeded in the same run, markets didn't) or has its own route.

## Diagnose

1. **Did writes stop, and did the cron run after they stopped.** Find the last successful tick write (the `8:46 PM ET` the tape shows) and pull `cron_runs` for the markets cron across the days since. Did runs fire after 8:46 PM? Did they error, or complete while writing nothing fresh? This is the fork: a cron that stopped firing is a scheduling problem; a cron that fires and writes nothing is a fetch problem. Prior diagnosis put it in the fetch step, but confirm, since the cron's run daily since this was last looked at.
2. **Map symbol to source, live.** Read the markets cron route and `getLatestMarketTicks()`'s feeder. Enumerate which symbols come from FMP `/stable/quote` (the equities and indices: SPX, NQ, NVDA, AAPL, MSFT, GOOGL, LMT, TNX), which econ series from FRED `api.stlouisfed.org` (UNEMP and the CPI/recession inputs), and which odds from Kalshi versus Polymarket (SHUTDOWN, FED CUT JUL/SEP, RECESSION). The strip shows values for equities and FED CUT but `N/A` on a SHUTDOWN slot, so the failure is likely per-source, not blanket. The map tells you which probe matters.
3. **Find where the failure is swallowed.** Read the fetch step's error handling. If a source throws and the step catches per-source and logs to `cron_runs`, the cause is already in the run history from step 1, so read it there first. If it catches silently and writes a partial or empty batch, that's why the tape froze without a logged error, and you need the egress probe.
4. **Probe each source from Vercel egress.** Only if step 3 shows the cause is swallowed. Stand up a temporary read-only route on prod that hits each source the cron uses and reports status per source: 200 with payload, 401/403 (auth or tier), 402 (gated), 429 (rate limit), or empty/null. Local curl is misleading here (FMP tier-gates and FRED egress-blocks differ from a laptop), so it has to run from Vercel. Capture the per-source result into the report, then remove the route or hand it to the fix pass.
5. **Env scope.** Confirm the keys the failing source needs (`FMP_API_KEY`, the FRED key, any Kalshi/Polymarket creds) exist in Vercel **Production**, not only preview. Presence and scope, not the value.

## HALT

Stop after diagnosis and report, before any fix:

- Whether the cron fires after the last good tick, and whether failing runs error or write nothing silently, with the `cron_runs` rows.
- The symbol-to-source map.
- Which source or sources are failing, and the exact failure mode: status code or empty payload, from Vercel egress.
- The classification: auth/key, tier change, rate limit, endpoint moved, env scope, or silent catch on partial data.
- The env-scope finding for the relevant keys.
- A proposed fix per failing source.

I scope the fix handoff from that. Don't fix blind; the failure mode is exactly what picks the fix.

## Constraints

- Read-only diagnosis. No pipeline edits. The temporary probe route, if needed, is read-only and gets removed.
- Probe from Vercel egress, not locally, for any source check.
- `cron_runs` is the source of truth for run history, not the Vercel log viewer.

## Report

The six HALT items above, with the `cron_runs` rows and the per-source egress status. Enough for me to write the fix without re-probing.
