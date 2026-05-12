# Move "UPDATED 03:08 MT" under the CBT wordmark

## Problem

The last-updated timestamp currently sits on the right side of the
header next to the bill count (`234 OF 1,461 BILLS · UPDATED 03:08 MT`).
That mashes a navigation/state metric (count) together with a system
metadata stamp (when the data was last synced). They're different
concerns.

## Fix

In `HeaderBar.tsx`, move just the `UPDATED HH:MM MT` portion to a
second line directly under the `CBT // 119TH CONGRESS` wordmark on the
left. Smaller, dimmer, no separator — it reads as a metadata caption
on the brand.

```tsx
<div className="flex flex-col leading-tight">
  <span className="...existing wordmark classes...">CBT // 119TH CONGRESS</span>
  <span className="text-xs text-[var(--text-dim)] tracking-wide">
    UPDATED {time} MT
  </span>
</div>
```

Right side stays as `234 OF 1,461 BILLS` only — drop the trailing
`· UPDATED ...` and the now-orphan separator.

## Verify

- Header reads `CBT // 119TH CONGRESS` with `UPDATED 03:08 MT` underneath in muted text.
- Right side shows just the bill count, no trailing separator or stranded `·`.
- Search bar and nav links don't shift vertically — they stay center-aligned with the wordmark, not the new two-line block. Use `items-center` on the header flex row so the taller left block centers the rest.
- Mobile width — the timestamp wraps with the wordmark, doesn't crash into the search box.

## Also: timestamp must not change when filters change

The timestamp reflects "when did the dataset last sync from
Congress.gov" — a global property of the database. It should be
identical on `/`, `/?topics=healthcare`, `/?stage=committee&page=3`,
and any combination thereof.

While you're in there, audit how the value is sourced. Two scenarios:

- **If it's already global** (e.g. `SELECT MAX(update_date) FROM bills`
  unconditional, or read from a sync-metadata row): leave it alone,
  this section is a no-op.
- **If it's derived from the filtered set** (e.g. it's piggy-backing
  on the same query that produces the feed): change it to an
  unconditional query so it always shows the same value regardless of
  filters.

Do not memoize it on the client or hardcode it. It must update when
the next cron tick runs and the user reloads.

## Out of scope

Don't change the timestamp format or timezone label. Don't add a tooltip with the full date. Just move the existing element and make sure its source is global.
