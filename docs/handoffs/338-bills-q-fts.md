# HO 338 — Wire bills_fts into /bills?q= (the feed filter)

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 338.

HO 336 found this: `/bills?q=<common term>` 500s on prod (`/bills?q=tax` ~20s), the same leading-`%` LIKE cold-abort 336 just fixed for `/search`. 336 only swapped the standalone search helpers; `buildFeedWhere` (the inline feed filter) still LIKEs title/summary and aborts. The `bills_fts` index already exists from 336, so this is wiring, not building.

It isn't a straight helper swap, for a specific reason. `buildFeedWhere` feeds the same `getFeedBills` query that carries HO 335's sort-conditional `INDEXED BY` hint (`idx_bills_latest_action` / `idx_bills_introduced_date` by sort key). That hint forces the sort index, and an FTS `MATCH` wants to drive from `bills_fts`. You can't do both: forcing the sort index blocks the FTS join from driving, which lands you right back on a scan. So the plan has to branch on whether `q` is present.

## The crux — confirm, then branch on q

First, premise-check: grep where HO 335's `INDEXED BY` hint is applied relative to `buildFeedWhere` and the `q` predicate, and report whether the `q` path inherits the bare-feed hint or has none. The fix depends on it.

Then the query branches on q. When q is present, drive from the `bills_fts` MATCH (the narrow side, since a term match is far more selective than the sort index), join to `bills` on rowid, apply the stage/topic/chamber filters, sort the matched set, limit, and take the count from the match rather than a second scan. The HO 335 sort-index hint comes off this path; it fights the FTS drive. When q is absent, leave HO 335 exactly as it is, so the bare and chamber feed plans don't move.

Protecting the q-absent plan is a hard requirement. The FTS wiring must not disturb the HO 335 bare-feed walk we just shipped.

## The wiring

Replace the title/summary LIKE in `buildFeedWhere`'s q branch with a `bills_fts` MATCH via the rowid join. Matching inherits the index's columns (title, summary, sponsor_name), so it's token-prefix and now spans sponsor too, consistent with `/search` after 336. id-substring stays dropped, same reason as 336: id tokens (`119`, `hr`) sit in nearly every id and a prefix expands to the whole index. Token-prefix rather than substring carries over too (`tax` won't match inside `syntax`); that's the behavior `/search` already has.

No interim half-measure. Code floated dropping summary from the LIKE, but a title-only LIKE still scans 16k rows and can still abort on a common title term. The index is there; wire it.

## Verify

- `/bills?q=tax` (was ~20s and 500ing) returns fast and 200, cold and warm.
- Compositions: `/bills?q=tax&stage=passed-house`, `&sort=introduced`, `&topic=...`, with pagination, all 200. These are the point of the work; q has to AND cleanly with the rest.
- EXPLAIN the q-present plan: drives from `bills_fts`, not `idx_bills_is_ceremonial` and not the sort index. If it doesn't drive from `bills_fts`, HALT and report rather than forcing a hint blind.
- Regression: `/bills` with no q still EXPLAINs the HO 335 sort-walk with no TEMP B-TREE. Confirm the wiring left it alone.
- `tsc` + build clean.

## Docs

- Close the `/bills?q=` OPEN LOOP from 336.
- SKILL.md: the feed filter `q` goes through `bills_fts`, same FTS rule as `/search`. Record the q-present vs q-absent index split so the next person doesn't force the sort hint onto the q path and re-break it.
- backlog: tombstone 338.

## Cleanup

`scripts/diagnostic/recover-fts-336.ts` and `scripts/diagnostic/drop-stale-index-335.ts` are spent one-shots; delete both. `cold-start-audit-332.ts` stays as the standing regression probe.

## Ship

- Named `git add`; `tsc` + build clean.
- `git push`; `npm run verify:deploy` until served SHA === HEAD.
- Confirm on prod that `/bills?q=tax` 200s fast and a filtered composition (`&sort=introduced`) does too.
