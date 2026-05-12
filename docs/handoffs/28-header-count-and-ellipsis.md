# Header count + pagination ellipsis fixes

Two small, unrelated fixes bundled together. Tackle in either order.

---

## Fix 1: Header bill count doesn't match the feed

### Problem

`HeaderBar` shows `1,757 BILLS` but pagination only exposes ~1,500
(15 pages × 100). The 257-bill gap is bills with `summary IS NULL` —
sync has fetched them but the cron hasn't summarized them yet. The
feed query filters them out; the header count doesn't.

### Fix

Make the header count source apply the same baseline filter as the
feed list query. Find the function that produces the header total
(probably in `lib/queries.ts` — something like `getTotalBillCount` or
similar, likely called from `app/layout.tsx` or `components/HeaderBar.tsx`).

Two options, prefer (a):

**(a)** Reuse the existing shared `buildFeedWhere` helper from the
pagination work, called with empty filters, so the header count and an
unfiltered feed always agree.

**(b)** If that's awkward (e.g. `buildFeedWhere` requires filters that
don't make sense for an unfiltered count), at minimum add
`WHERE summary IS NOT NULL` to the header count query.

Whichever path: header label stays as `BILLS`. Don't introduce a
"pending" sub-count or a tooltip — the unsummarized rows are
transient.

### Verify

- Header count equals `total` returned by `getFeedBills` with no filters.
- Header count equals `Math.ceil(totalPages * pageSize)` minus the
  remainder on the last page (i.e. the count of rows actually
  reachable through pagination).
- After the next cron tick summarizes a batch, the header count goes
  up by that batch size, not stays flat.

---

## Fix 2: Pagination ellipsis skips single-page gaps

### Problem

Currently on `?page=5` of 15 the control renders:

```
‹ PREV  1 · 3 4 5 6 7 … 15  NEXT ›
```

The space between `1` and `3` is just page 2 — a one-page gap — but
nothing renders there. Either an ellipsis or the missing page number
should appear.

### Fix

In `components/Pagination.tsx`, the page-range builder. Rule:

- Always show first and last page.
- Show `current - 2` through `current + 2`.
- For each gap between consecutive shown pages: if the gap is exactly
  one missing page, render that page number; if it's more than one,
  render `…`.

Pseudocode:

```ts
const window = 2;
const start = Math.max(1, current - window);
const end = Math.min(total, current + window);

const pages: (number | 'ellipsis')[] = [];

if (start > 1) {
  pages.push(1);
  if (start === 3) pages.push(2);
  else if (start > 3) pages.push('ellipsis');
}

for (let i = start; i <= end; i++) pages.push(i);

if (end < total) {
  if (end === total - 2) pages.push(total - 1);
  else if (end < total - 2) pages.push('ellipsis');
  pages.push(total);
}
```

### Verify (traces)

- current=5, total=15 → `1 2 3 4 5 6 7 … 15`
- current=1, total=15 → `1 2 3 … 15`
- current=2, total=15 → `1 2 3 4 … 15`
- current=3, total=15 → `1 2 3 4 5 … 15`
- current=13, total=15 → `1 … 11 12 13 14 15`
- current=14, total=15 → `1 … 12 13 14 15`
- current=15, total=15 → `1 … 13 14 15`
- total=4, any current → no ellipses, all pages shown
