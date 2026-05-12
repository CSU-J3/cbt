# Reset page to 1 when stage filter changes

## Problem

`/?topics=healthcare&page=3` → change stage dropdown to COMMITTEE →
URL becomes `/?topics=healthcare&stage=committee&page=3` instead of
`/?topics=healthcare&stage=committee`.

This is the same issue that was already fixed in `SortDropdown.tsx` and
`SearchBox.tsx` in the pagination handoff. The stage filter component
got missed.

## Fix

In whichever component renders the stage dropdown (likely
`components/StageFilter.tsx` or similar — same one with the
`ALL STAGES / INTRODUCED / COMMITTEE / FLOOR / OTHER CHAMBER /
PRESIDENT / ENACTED` options), find where it builds the URL on change
and drop `page` before assembling the querystring.

Same pattern as the sort and search fix:

```ts
const params = new URLSearchParams(searchParams);
params.delete("page");
// ...set or delete `stage` as needed
```

That's it. No other changes.

## Verify

- `/?page=3` → change stage to COMMITTEE → URL is `/?stage=committee`.
- `/?topics=healthcare&page=3` → change stage to FLOOR → URL is `/?topics=healthcare&stage=floor`.
- Resetting stage to ALL STAGES from a non-1 page also drops `page`.
