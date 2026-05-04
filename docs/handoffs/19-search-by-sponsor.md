# Handoff 19: Search by sponsor on the main feed

## Goal

When a user types a name like `pelosi` into the feed search box, return bills sponsored by Pelosi alongside any title/bill-ID matches. Currently the search only matches title and bill ID (handoff 13), so finding a sponsor's bills requires a detour through `/sponsors`. One search box, three match types.

## Change

In `lib/queries.ts`, extend the `q` branch of `buildFeedWhere` to OR a third clause: case-insensitive substring match on `sponsor_name`.

Before:

```sql
(LOWER(title) LIKE ? OR <bill-id-normalized match>)
```

After:

```sql
(LOWER(title) LIKE ? OR <bill-id-normalized match> OR LOWER(sponsor_name) LIKE ?)
```

Same `%${q.toLowerCase()}%` pattern as the title clause. Don't try to be clever about detecting "this looks like a name" vs "this looks like a topic." Just OR all three; one query, one round-trip.

## Where it applies

Anywhere that calls `buildFeedWhere` with `q` set:

- `/` main feed
- `/watchlist` (if it has search; if not, ignore)
- `/stale`
- `/president`

`/sponsors` already searches `sponsor_name` directly via its own `getSponsors` query. Don't touch it.

## UI

No UI changes. The existing search box and `· "query"` suffix in the count line are correct as-is. The user types the same way; they just get more results back.

Don't add a "matched in sponsor name" badge or hint on individual rows. Too clever, and the bill rows already show sponsor name inline so it's self-evident.

## Edge case

`q=smith` will probably match both bill titles containing "smith" (rare) and bills sponsored by anyone named Smith. That's the intended behavior. The count line stays `X OF Y BILLS · "smith"` either way.

## Files to touch

- `lib/queries.ts` (extend the `q` clause in `buildFeedWhere`)
- `.claude/skills/cbt/SKILL.md` (update the search section under handoff 13's notes to mention sponsor name as a third match field)

## Acceptance

- Searching `pelosi` on `/` returns bills sponsored by anyone with "pelosi" in their name.
- Searching `tax` continues to return bills with "tax" in the title.
- Searching `hr-2702` continues to resolve via bill-ID normalization.
- A query that matches multiple categories (e.g. a sponsor whose name also appears in a bill title) doesn't return duplicates. It's the same row matching via OR; the SELECT returns it once.
- Search composes correctly with stage, topic, and `?sponsor=` filters (AND across categories, OR within `q`).
- `/sponsors` search behavior unchanged.
- `npm run typecheck` clean.

## Don't

- Don't add a separate "search sponsors" toggle or radio. One box, OR'd matching.
- Don't try to rank or weight results (sponsor matches first, then titles, etc.). The default sort is still latest action; search just decides which rows are eligible.
- Don't denormalize sponsor name into a search column. The existing index situation is fine for this scale.

## Cost note

Zero. SQL only.
