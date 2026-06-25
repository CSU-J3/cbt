# HO 356 — Watchlist per-user + fold HO 342 drive-order fix (A2 of multi-user arc)

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 356.

Depends on HO 355 (A1) shipped AND you signed in once on prod — your `users` row must exist, the migration seeds existing watched rows to it.

Makes the watchlist per-user in one deploy, and folds in the HO 342 drive-order fix that HO 354 found was never shipped (doc untracked, no commit, `getWatchlistBills` still drives bills-first). Same query A2 rewrites, so one pass.

Scope is small and fully enumerated by HO 354: one table, one write route + 2 write helpers, 3 read helpers across 10 call sites, 2 client write components.

## Resolved premises (HO 354 — don't re-derive)

- `watchlist` PK is `bill_id` alone → no room for two users on one bill. Must become composite `(user_id, bill_id)`. SQLite can't ALTER a PK, so it's a table rebuild (destructive — gated below).
- The HO 342 fix is NOT in the tree. `getWatchlistBills` drives `FROM bills b INNER JOIN watchlist w` with no `INDEXED BY` (lib/queries.ts:~4520). The ~27s cold-500 risk on a populated watchlist is live.
- Read helpers (`getWatchlistBills`, `getWatchedBillIds`, `isInWatchlist`) are called from 10 server sites → they read the session **internally** so call sites stay unchanged. Write helpers (`addToWatchlist`, `removeFromWatchlist`) are called only from `/api/watchlist` → they take an explicit `userId` param the route passes. Keep that asymmetry; do NOT add a userId param to the read helpers.
- `getWatchedBillIds` / `getWatchlistBills` are `unstable_cache`-wrapped today. Once they read `auth()` they CANNOT be cached — `unstable_cache` has no request-scoped cookie access, and a global cache would leak one user's stars to another. Dropping the cache is required, not optional. Queries are tiny (`WHERE user_id = ?` on the PK); uncached is cheap. Keep the 10s abort (HO 238). All 10 callers are server-side (they hit the DB), so `auth()` is safe in each.
- One localStorage key only (`cbt:racesLastView`); per-browser cue, stays client-side, does not move to the user row.
- v2 dashboard feed (`V2FeedList`) and `BillExpandPanel` render no watch affordance — nothing to gate there. The "sign in to save" surfaces are exactly: BillRow's star, the `/bill/[id]` button, and the `/watchlist` empty block.

## Destructive migration — HALT, preconditions first

New one-shot script `scripts/migrate-watchlist-userid.ts`. Before the drop:

1. Confirm `users` has **exactly one** row (you). Zero → STOP (A1 not shipped or you haven't signed in). More than one → STOP and ask which id seeds existing rows (ambiguous).
2. Dump current `watchlist` rows to `scripts/diagnostic/watchlist-backup-<date>.json` (recover path if seeding goes wrong).

Then: create `watchlist_new` with the composite PK, copy existing rows assigning `user_id = (the single users.id)`, drop `watchlist`, rename `watchlist_new` → `watchlist`.

```sql
CREATE TABLE watchlist_new (
  user_id TEXT NOT NULL REFERENCES users(id),
  bill_id TEXT NOT NULL REFERENCES bills(id),
  added_at TEXT NOT NULL,
  notes TEXT,
  PRIMARY KEY (user_id, bill_id)
);
```
The composite PK covers `WHERE user_id = ?`, so no extra index is needed for the read drive order.

Also update the canonical `watchlist` CREATE in `scripts/migrate.ts` to this shape so fresh DBs are born correct.

**Ordering: migration runs against prod BEFORE the code deploy.** Code that reads/writes `user_id` against the old table would 500 every watchlist read in the gap. Migrate first, then deploy.

## Query rewrite (folds 342 + user_id)

- `getWatchlistBills(sort, chamber)`: read session via `auth()`; anonymous → `[]`. `WHERE w.user_id = ?`. Force-drive from `watchlist w` (small, user-filtered) then bills by PK; add `INDEXED BY` on the watchlist PK if the stateless planner still grabs bills first (the HO 342 fix). Drop `unstable_cache`. Keep the 10s abort.
- `getWatchedBillIds()`: read session; anonymous → `[]` (anonymous users get empty stars, no error, 10 call sites unchanged). `SELECT bill_id FROM watchlist WHERE user_id = ?`. Drop `unstable_cache`. Returns `string[]` as before.
- `isInWatchlist(billId)`: read session; anonymous → `false`. `WHERE user_id = ? AND bill_id = ?`.
- `addToWatchlist(userId, billId)` / `removeFromWatchlist(userId, billId)`: add the `userId` param. Insert `INSERT OR IGNORE INTO watchlist (user_id, bill_id, added_at) VALUES (?, ?, ?)`; delete `DELETE FROM watchlist WHERE user_id = ? AND bill_id = ?`.

## API route — `app/api/watchlist/route.ts`

Session check at the top: anonymous → `401`. Authed → pass `session.user.id` into the write helpers. After the read helpers go uncached, `revalidateTag("watchlist")` has no consumer — remove it if grep confirms nothing else reads that tag, else leave it. `router.refresh()` in `useWatchToggle` already re-renders the (now uncached) server reads, so stars still update after a write.

## "Sign in to save"

- **Stars + bill-detail button** (client): the anonymous POST now 401s. In `components/use-watch-toggle.ts`, on a 401 call `signIn("github")` instead of the error-revert (other errors keep the existing revert). No new props, no SessionProvider — the client reacts to the 401. Anonymous users see empty stars; clicking one sends them to sign-in.
- **`/watchlist` empty block** (server, app/watchlist/page.tsx:~68-80): branch the copy on `auth()`. Anonymous → "Sign in to save bills to your watchlist" + a sign-in button. Authed-but-empty → keep the existing "Add bills from any bill detail page by clicking ★ Watch."

## Cleanup (rides along)

- Delete `getSponsorStates` (lib/queries.ts:~3487) — HO 354 re-confirmed zero callers (`/members` uses `getMemberStates`). Print the function first, then delete (print-before-delete discipline).
- Fix `scripts/diagnostic/cold-start-audit-332.ts:~277-278` — it encodes the bills-first watchlist shape as "expected GOOD." Update the expectation to the watchlist-driven shape A2 now forces.

## Docs (in-place, not appended)

- SKILL.md: watchlist is per-user (composite PK, FK to `users.id`); `/api/watchlist` 401s when anonymous; read helpers read session internally and are uncached; design note "logged-out is the demo, auth only gates the watchlist."
- oddities.md: add `/watchlist` to the drive-order trap note (drive from the small user-filtered side, force with `INDEXED BY`); record that HO 342 never shipped and was absorbed here.
- backlog.md OPEN LOOPS: close the `/watchlist` 500 (fixed here), close `getSponsorStates`, close the HO 341 `getWatchedBillIds` loop (now per-user); tombstone HO 342 as absorbed-into-356; add the multi-user arc state (A1+A2 shipped, landing B1 pending Design mock).
- roadmap.md: leave theme bars untouched — multi-user is net-new direction, not a theme. No percentage change.

## Verify

- Migration: backup file written; post-migration `watchlist` has the composite PK and your existing rows under your `user_id`; `PRAGMA table_info(watchlist)` shows `user_id`.
- EXPLAIN on `getWatchlistBills` drives from `watchlist` (user-filtered) then bills by PK — not a bills scan.
- Signed in: star a bill from a feed row → shows in `/watchlist`; unstar from `/watchlist` → gone; bill-detail WATCH button matches.
- Anonymous: feed loads, stars empty, clicking a star → GitHub sign-in; `/watchlist` shows the sign-in empty state; no 500 anywhere.
- Two users (sign in as a second GitHub account if you can, else reason it): each sees only their own stars — no cache bleed.
- `tsc` + build clean, named `git add`, push, `npm run verify:deploy` until served SHA === HEAD.
