# HO 314 — Markets tape: reliable daily trigger (313 fix)

Confirm the next free number before saving (`ls docs/handoffs/ | sort -V | tail`). Body assumes 314; rename if taken.

## What this is

HO 313 found the freeze isn't a data-source failure, it's GitHub Actions scheduled-cron delivery. The `markets-tick` schedule delivers about 20% of its weekday slots on a good day and fired zero times today; the Mon-to-Fri-only schedule then blanks weekends, so the tape reads multi-day frozen. The data layer is healthy: the last run (#403) ticked all 18 live symbols from prod egress, keys present in Production, every source returning.

Fix: give the healthy markets fetch a reliable daily trigger on Vercel's scheduler, the same one that fires the bills cron every day without fail. That bounds the tape to at most a day stale and ends the freeze. Leave the GitHub Actions intraday crons in place as best-effort gravy on top; this handoff only adds the reliable daily floor underneath them.

## Resolved premises (from 313, don't re-diagnose)

- Data layer healthy. All four sources (FMP `/stable/quote`, FRED `api.stlouisfed.org`, Kalshi, Polymarket) wrote at #403; the full 19-symbol roster ticks when the trigger fires. Don't touch the fetch logic, the sources, or the STALE/closed-state.
- Keys present in Production (`FMP_API_KEY`, `FRED_API_KEY`, `CRON_SECRET`). No env work.
- The only standing per-source issue is the POLY-SHUTDOWN ghost (no liquid same-question market, intended N/A). Pre-existing and independent of the freeze. Out of scope here; banked separately.
- The GitHub Actions workflow files are unchanged since HO 227 and aren't the problem; GitHub's best-effort scheduler is just dropping the slots. Don't edit or delete the workflows in this handoff.

## Confirm first, then pick the path

The bills cron already holds a Vercel daily cron slot, and Hobby's cron-count limit is a moving target. Confirm it live before implementing:

1. **Hobby cron-count headroom.** Can `vercel.json` carry a second daily cron alongside the bills one on the current plan? If yes, Path A. If the count is capped, Path B.
2. **60s budget, only if Path B.** If you fold markets into the bills cron, confirm the combined run stays under the 60s function ceiling (markets fetch was ~1.6s at #403; bills sync is the heavy part). If bills already runs close to 60s, don't fold; the cap then means a plan-level fix is needed, so HALT and say so rather than risk timing out the bills sync.

## Implement

**Path A: separate Vercel daily cron (preferred).** Add a daily cron in `vercel.json` hitting `/api/cron/markets` bare (full roster, no `?source`). Confirm the route's auth accepts the Vercel-cron call: Vercel sends `Authorization: Bearer ${CRON_SECRET}` when `CRON_SECRET` is set, so the route's existing secret check should pass; verify it does. Fire after US market close (around 21:30 UTC) so the daily snapshot reflects the day's close and the tape's `AS OF` reads a useful hour with CLOSED correct. Path A is preferred partly for this: a post-close fire gives a better snapshot than the bills cron's pre-market 09:00 UTC timing.

**Path B: fold into the bills cron (only if the count is capped and the budget allows).** Add the markets fetch as a step in the existing daily bills cron route, reusing the markets route's fetch (extract or call it, don't duplicate). Same `cron_runs` logging via the existing wrapper. The snapshot lands at the bills cron's time (pre-market), acceptable but less ideal than post-close.

Either path writes the full 19-symbol roster as #403 already demonstrated.

## Constraints

- Additive only. No change to the fetch code, the sources, the staleness/closed-state logic, or the GitHub Actions workflows. Just a reliable trigger.
- `cron_runs` logging on the new path via the existing `wrapCronRoute` helper.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.
- A Vercel cron only fires at its scheduled time, so the deploy SHA match proves the deploy, not the trigger. To prove the path writes, hit the endpoint once manually with auth and confirm a fresh tick lands and the tape's STALE clears with a current `AS OF`. The manual trigger writes real ticks, which is the goal here. The scheduled fire then carries it daily.

## Ship report

- Which path (separate Vercel cron or folded into bills), and the constraint that decided it (cron-count headroom, 60s budget).
- The manual prove-out: a fresh tick wrote, the full 19-symbol roster ticked, the tape's `AS OF` is current, STALE cleared.
- The GitHub Actions workflows and the fetch logic are untouched.
- Open loops: intraday-reliable upgrade (move the 30-min refresh off GitHub Actions to a free hosted cron) banked as optional; the no-tick-in-N-hours watchdog banked; the POLY-SHUTDOWN ghost banked.
