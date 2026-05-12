# Move bill count under the wordmark, next to UPDATED

## Problem

Handoff 32 moved `UPDATED 03:08 MT` under the `CBT // 119TH CONGRESS`
wordmark. The bill count (`234 OF 1,461 BILLS`) is still alone on the
right side. Pulling it down next to the timestamp consolidates all
dataset-state metadata into one place and frees the right side for
just the nav links.

## Fix

In `HeaderBar.tsx`, move the bill count out of the right-side block
and put it on the same metadata line under the wordmark, separated
from `UPDATED` by `·`:

```
CBT // 119TH CONGRESS                                                    SPONSORS · ⏳ STALE · DESK · ★ WATCHLIST
234 OF 1,461 BILLS · UPDATED 03:08 MT
```

Both pieces use the same muted style — they're now siblings in a
single metadata caption under the brand.

```tsx
<div className="flex flex-col leading-tight">
  <span className="...wordmark...">CBT // 119TH CONGRESS</span>
  <span className="text-xs text-[var(--text-dim)] tracking-wide">
    {filteredCount.toLocaleString()} OF {totalCount.toLocaleString()} BILLS · UPDATED {time} MT
  </span>
</div>
```

Right side of the header now contains only the nav links (`SPONSORS`,
`⏳ STALE`, `DESK`, `★ WATCHLIST`). No leading separator, no orphan `·`.

## Verify

- Wordmark on top, `234 OF 1,461 BILLS · UPDATED 03:08 MT` underneath in muted text.
- Right side is just nav links, no count, no separator stranded at the start.
- Filtered counts still update with `?topics=` etc. (this is presumably already the case from the existing right-side rendering — just make sure it carries over).
- Search bar stays vertically centered against the new two-line block.
- Mobile width — metadata line wraps cleanly under the wordmark, doesn't crash into the search box or nav.
