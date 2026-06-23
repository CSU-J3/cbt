# HO 312 — Reports index stale: June 8 report missing from the listing

This is the reserved 312 slot (the reports-index bug). 313 and 314 already shipped around it, so 312 should be the gap; confirm with `ls docs/handoffs/ | grep '^312'` and keep the 312 number, don't bump to 315.

## The bug

The June 8 weekly report exists as a full standalone page and renders fine, but it's absent from the reports index listing. The index sits behind the project's `unstable_cache` + `revalidateTag` caching, and the leading hypothesis is the catch-up report-write path (HO 285) writes the row without calling `revalidateTag` on the index, so the cached listing never picks up a backfilled report. The standalone page reads the row directly and bypasses that cache, which is why the page works while the index doesn't.

Diagnose-then-fix. Confirm the cause before patching; the fix differs by branch.

## Diagnose

1. **The row exists, and how the page reads it.** Confirm the June 8 report row is in the `reports` table and read how the standalone page fetches it (by id/date/slug directly, not through the index query). This is why the page renders.
2. **The index query and its cache.** Find the reports index query (the `/reports` listing feed) and confirm it's wrapped in `unstable_cache` under a tag. Note the tag. Confirm the index reads through that cached path, which is why it's serving a pre-June-8 listing.
3. **The two write paths.** Find the normal weekly-report cron write and the catch-up write (HO 285). Compare them: does the normal path call `revalidateTag(<index tag>)` after writing while the catch-up path omits it? That's the hypothesis. Confirm or refute by reading both.
4. **Rule out the predicate branch.** Check the June 8 row's fields against the index query's WHERE clause. If the index filters on a status or flag (`status = 'published'`, a `finalized` boolean, a non-null field) that the catch-up path didn't set, the row is index-ineligible regardless of cache, and the fix is to set that field, not just revalidate. Diff the June 8 row's fields against a report that does appear in the index; any field the missing one lacks is the smoking gun.
5. **Scope: is June 8 the only victim?** Check whether other reports written via catch-up are also missing from the index (rows that exist but aren't in the listing). If the catch-up path has always skipped the revalidation or the flag, there may be a set, and the backfill has to surface all of them, not just June 8.

The fork:

- **Branch A (cache):** the row is index-eligible (same fields as listed reports) but the catch-up path skipped `revalidateTag`. Fix is the revalidation plus surfacing the already-written rows.
- **Branch B (predicate):** the row is missing a field the index requires. Fix is setting that field in the catch-up path plus a one-time backfill UPDATE on the affected rows.

Both can be true at once. Confirm which before patching.

## Fix

Both branches share a forward fix and a one-time flush; Branch B adds a row UPDATE.

**Forward fix (both).** Add `revalidateTag(<index tag>)` to the catch-up write path, matching the normal path, so future backfilled reports surface without a manual step. Branch B additionally: set the missing field in the catch-up path so backfilled rows are index-eligible going forward.

**Surface the already-written June 8 row (both).** Don't assume the fix deploy colds the index cache. Vercel's Data Cache can persist across deployments, so the existing June 8 row needs an explicit one-time `revalidateTag(<index tag>)` flush to appear. Confirm whether your setup colds on deploy; if not (the likely case), trigger the explicit flush: reuse an existing revalidation affordance if one exists, otherwise a one-shot route that calls the revalidation, hit it once, then remove it or keep it as an operational tool. Branch B: run the targeted backfill UPDATE first, then flush.

**Branch B backfill UPDATE.** Scope by id to the identified rows (June 8 plus any siblings from step 5), print the rows before and after, don't batch beyond the identified set.

**If it's neither branch** (the row is malformed, the index query is broken in a way that needs a design call, or June 8 is excluded for a reason that's neither a flag nor the cache): HALT and report the finding instead of guessing a fix.

## Constraints

- Match the existing pattern. The catch-up path calls the same `revalidateTag` the normal path uses; don't invent a new tag or a new cache.
- Any backfill UPDATE is scoped by id to the identified rows, printed before and after, never a blind batch.
- No change to the standalone report page, the report-generation logic, or the index query's shape beyond what the branch requires.
- `cron_runs` logging unchanged.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

- Which branch (cache, predicate, or both), with the evidence: the catch-up path's revalidation gap and/or the missing field, and June 8's row fields versus a listed report's.
- Whether June 8 was the only victim or there was a set, and what the backfill covered.
- `/reports` now lists the June 8 report (and any siblings); the standalone page still renders.
- The catch-up path now calls `revalidateTag` (and sets the field, if Branch B), so the next backfilled report surfaces without a manual step.
- For any UPDATE: the affected rows before and after.
- Build clean; `verify:deploy` SHA matches HEAD.
