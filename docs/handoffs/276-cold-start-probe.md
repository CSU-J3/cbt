# HO 276 — Cold-start probe (dashboard-v2 transient 500)

Diagnosis only. Don't fix anything. /dashboard-v2 cold-starts with a transient 500 (2 tries, then 200), the heavy-aggregate DB-timeout pattern. It's the last thing gating the v2 -> / swap, because / inherits it on cold start. Find which queries breach the 10s abort on a cold container before we prescribe a fix; the fix forks by cause and gets its own handoff (277).

## Premise

The 500 is render-only-changes-clean (274 confirmed / and /races serve 200 cold). The backlog logs it as an instance of the existing fan-out cold-start WATCH item. Hosted-Turso specifics that shape this: the 10s DB abort is intentional and not negotiable (HO 238), VACUUM/ANALYZE are blocked so the planner has no warmed stats, and a cold planner mis-plans fat-table queries unless forced with INDEXED BY. So a cold container can mis-plan, or simply do too much work, and trip the abort. Which one is the open question.

## Step 1 — enumerate the cold path (read)

Walk the /dashboard-v2 server render's data-fetching call tree: every query/aggregate it runs on initial load (masthead counts, stage + topic distribution, the hearings week, battlefield/races, movers, breaking, the WEEK OF summary, the tapes). For each, record:

- cached or live: wrapped in `unstable_cache`? Its revalidate / tag if so.
- rough shape: which tables, which joins, whether it already carries INDEXED BY hints.

Then diff against `/`'s cold path. `/` serves 200 cold, so whatever v2 runs beyond what `/` runs is the suspect set. That comparison narrows it fast: an uncached heavy aggregate with no hints that `/` doesn't run is the prime candidate.

## Step 2 — measure cold vs warm on the deployment

Cold-planner behavior is a hosted-Turso phenomenon; local timings won't reproduce it, so measure against the deployment, not locally. Prefer a temporary returnable diagnostic over log-scraping (Vercel keeps logs ~30 min): add a throwaway read-only endpoint (e.g. `/api/diag/cold-dashboard`) that runs each dashboard-v2 query in sequence with per-query timing and returns `{name, ms, cached}` as JSON. Hit it as the first request on a cold container (after idle, or right after a fresh deploy) for cold numbers, then again warm. Remove it or flag it off after.

Note the within-request warming effect: the first query can warm the connection for the rest, so the first-vs-rest split is itself signal. Watch for which pattern dominates:

- one query disproportionately slow cold, fast warm -> mis-plan, INDEXED BY candidate.
- only the first query slow, rest fast -> connection setup cost, a warming problem.
- many mid-weight queries each paying cold overhead and summing past tolerance -> fan-out, a caching / parallelization / reduction problem.

## Output

Report a per-query cold-vs-warm timing table with the cached/live flag, the total cold time, the v2-minus-/ suspect set, and your read on the dominant cause. Don't change app behavior; the fix lands in 277 once we know what we're fixing.

## Ship

Probe is read-only. If you added a diagnostic endpoint, commit it on its own so it's trivial to revert, push, and confirm it returns cold numbers from prod. No UI change to verify.
