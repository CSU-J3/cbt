# Add pagination to the bill feed

## Problem

The feed at `/` currently caps at some implicit limit and there's no way
to reach older bills. With 1,757 bills in the table, anything past the
first chunk is invisible.

## Decision: numbered pagination, not infinite scroll

- Matches the Bloomberg / terminal aesthetic. Explicit, predictable.
- URL-driven via `?page=N`, consistent with the existing
  `?topics=`, `?stage=`, `?q=`, `?expanded=` state model.
- Pure server-component story — each page is one Turso query. No
  client-side accumulation, no scroll listeners, no `use client` for
  the list itself.
- Bookmarkable and shareable. "Page 14 of healthcare bills" survives a
  reload.

**Page size: 100.** Roughly 18 pages at the current row count, dense
enough to feel like a terminal feed.

## What to change

### 1. `lib/queries.ts`

The function that returns the feed list needs to accept `page` and
`pageSize`, return `{ bills, totalCount }`. Two queries: the existing
`SELECT … FROM bills WHERE … ORDER BY … LIMIT ? OFFSET ?`, plus a
matching `SELECT COUNT(*) FROM bills WHERE …` with the same WHERE
clause. Keep the WHERE/ORDER builder factored so both queries share it
and can't drift.

`OFFSET = (page - 1) * pageSize`. Clamp `page` to `>= 1`.

### 2. `app/page.tsx`

Read `page` from `searchParams`. Coerce to integer, default to 1, clamp
to `[1, totalPages]`. Pass to the query. Render a `<Pagination />` at
the bottom of the feed (and at the top too if it doesn't crowd the
header — your call once you see it).

Add `total bills · page X of Y` somewhere visible. The header already
shows `1,757 bills · updated 03:08 MT` — fine to leave that alone and
put the page indicator in the pagination control itself.

### 3. New `components/Pagination.tsx`

Server component, presentational. Receives `currentPage`, `totalPages`,
and the current `searchParams` (so it can preserve filters in the
generated links).

Layout, terminal-flavored:

```
‹ PREV    1 · 2 · 3 … 17 · 18    NEXT ›
```

- Prev / Next disabled (visually dim, no link) at boundaries.
- First and last page always shown.
- Current page ± 2 shown.
- `…` ellipsis for skipped ranges.
- Use existing color tokens: `--text-muted` for inactive, `--accent-amber-bright` for the current page.

Each link must rebuild the full querystring with `page` swapped, NOT
strip the other params. A small helper:

```ts
function buildHref(searchParams: URLSearchParams, page: number) {
  const sp = new URLSearchParams(searchParams);
  if (page === 1) sp.delete('page');
  else sp.set('page', String(page));
  const qs = sp.toString();
  return qs ? `/?${qs}` : '/';
}
```

Stripping `page` when it's 1 keeps URLs clean for the default view.

### 4. Filter changes must reset to page 1

This is the one thing that will silently break if missed. When a user
on `?page=14` clicks a topic chip, they should land on
`?topics=taxes`, not `?page=14&topics=taxes`. Anywhere a filter,
search, sort, or stage control builds a link or pushes URL state, drop
`page` from the params it carries forward.

Audit:
- Topic chips
- Stage filter dropdown
- Sort toggle (latest action / newly introduced)
- Search box (`SearchBox.tsx`)

Each one builds its own URL — search them all and make sure none of
them pass `page` through.

### 5. Watchlist and other feeds

`/watchlist` is small enough that pagination is unnecessary. Skip it.

`/sponsors`, `/stale`, `/president` — apply the same pattern only if
their row counts justify it. Eyeball each one; if it's under ~150
rows, leave it alone.

## Spot-checks

- `/` loads page 1 with 100 bills.
- `/?page=2` loads bills 101–200.
- `/?page=99` (out of range) clamps to last page, doesn't 404.
- `/?page=0` or `/?page=-1` clamps to 1.
- `/?topics=healthcare&page=3` works; clicking the `taxes` chip from there lands on `/?topics=taxes` (no `page=3`).
- Pagination control links preserve `topics`, `stage`, `q`, `sort`, but reset `expanded`.
- Last page shows however many bills are left (not padded).
- Total count in pagination matches `SELECT COUNT(*)` with the same filters applied.
- Mobile width — pagination wraps cleanly, no horizontal scroll.

## Out of scope

- No infinite scroll, no "load more" button.
- No per-page-size selector. 100 is the default and only option.
- Don't change the existing header bill count.
- Don't add cursor-based pagination — offset is fine at this scale.
