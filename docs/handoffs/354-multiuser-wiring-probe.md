# HO 354 — Multi-user wiring probe (read-only)

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 354.

Read-only. No writes, no migrations, no commits. This is the premise check before any auth work — A1 (auth + `users` table) and A2 (scope watchlist to `user_id`) get written from your findings, so accuracy beats speed. Grep the live repo and report exact file paths and line anchors.

Going multi-user, light version: logged-out is the demo (full read access to the shared corpus), auth only gates the watchlist. So the only thing that needs a user key is the watchlist write/read path plus whatever per-browser state exists today. Confirm that's true and pin the exact shapes.

## Confirm and report

1. **Auth: confirm none exists.** Grep for `next-auth`, `@auth/`, any `middleware.ts`, any session/cookie identity, any `lib/auth*`. Expected: zero. If anything auth-shaped exists, stop and report it first — it changes A1.

2. **Watchlist write path.** `app/api/watchlist/route.ts` (the lone POST per SKILL). Report: the exact request body it accepts, what it writes, and confirm it assumes a single global list with no user key. Handler summary + line anchors.

3. **Watchlist read path.** `getWatchlistBills` (likely `lib/queries.ts`). Report: full signature, whether it's `unstable_cache`-wrapped and the exact cache key/tag if so, and confirm the HO 342 drive-order fix is present (drives `FROM watchlist w JOIN bills b`, `INDEXED BY` forced on the watchlist key). Also grep for `getWatchedBillIds` — backlog has it as an HO 341 prop-wiring loop; confirm whether it's live and, if so, its shape and callers.

4. **`watchlist` table schema.** Exact columns, PK, FK, indexes. Confirm there's no `user_id` today and confirm the join key (`w.bill_id` → `b.id`). Pull from the migration or schema file, whichever is source of truth — name which.

5. **Watch-state client surfaces — full blast radius.** List every component that writes or reads watch state: `WatchlistToggle`, `WatchStar`, the `useWatchToggle` hook, and anything else that calls the toggle or branches on watched-vs-not. A2 needs the complete set to know where the "sign in to save" empty state has to land.

6. **localStorage, site-wide.** Grep every `localStorage` / `sessionStorage` key. For each: the key name and what it stores. HO 272's last-opened-RACES-tab marker is one; report all of them. (Under auth these stay per-browser, not per-user; A2 decides which, if any, move to the user row.)

7. **`/watchlist` page.** What `app/watchlist/page.tsx` renders, and confirm it 200s fast on empty post-HO-342 (no regression of the drive-order fix).

## No HALTs

Read-only — no external deps, nothing destructive. Just report.

## Deliverable

A findings block, file-path and line-anchored, paste-ready. That's the whole job — no code changes this round. Paste it back and A1/A2 get written from it.
