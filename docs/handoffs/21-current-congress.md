# Handoff 21: Auto-derive current Congress number

## Goal

The `CBT // 119th Congress` label in the header is hardcoded. Replace it with a date-derived value so the dashboard rolls over to `120th Congress` automatically on January 3, 2027 (and `121st` on January 3, 2029, etc.). Also update the sync URL — without that, the label rolls forward but the data doesn't.

## Calculation

Modern Congresses run two years, starting January 3 of odd years:

- 119th: January 3, 2025 → January 3, 2027
- 120th: January 3, 2027 → January 3, 2029

New file `lib/congress.ts`:

```ts
export function getCurrentCongress(date = new Date()): number {
  const year = date.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(year, 0, 3)); // Jan 3
  const effectiveYear = date < startOfYear ? year - 1 : year;
  const congressStartYear = effectiveYear % 2 === 1 ? effectiveYear : effectiveYear - 1;
  return Math.floor((congressStartYear - 2025) / 2) + 119;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function currentCongressLabel(date = new Date()): string {
  return `${ordinal(getCurrentCongress(date))} Congress`;
}
```

Sanity-check the math against these dates:

- `2026-05-04` → 119
- `2027-01-02` → 119 (still in 119th, Jan 3 hasn't hit)
- `2027-01-03` → 120
- `2028-12-31` → 120
- `2029-01-03` → 121
- Ordinals: 119→"119th", 120→"120th", 121→"121st", 122→"122nd", 123→"123rd", 131→"131st"

## Use it in two places

### Header label

Replace the hardcoded `119th Congress` string in `HeaderBar.tsx` (or wherever it lives) with `currentCongressLabel()`. Server-rendered, no client work needed.

### Sync URL

`lib/sync.ts` and the cron route (`app/api/sync/route.ts`) hardcode `/bill/119`. Replace with `` `/bill/${getCurrentCongress()}` ``. Do the same for any standalone scripts in `scripts/` that hit the list endpoint.

The cron runs once a day at 09:00 UTC, so the rollover happens within ~24 hours of January 3 of any odd year — close enough.

## What this does NOT do

- Doesn't backfill old Congresses. `bills` table keeps everything that's ever been synced. After the 120th starts, 119 bills stay in the DB; new 120 bills get added. Both show in the feed, sorted by latest action.
- Doesn't stop the sync from picking up late activity on old-Congress bills. The list endpoint is scoped to current Congress only, so once we move to `/bill/120`, late updates on 119 bills (delayed enactment signatures, etc.) won't be picked up. That's a real loss, but the alternative — keeping a historical-Congress sync running — is more complexity than this dashboard needs. Document the tradeoff in `SKILL.md` and move on.
- Doesn't change bill detail URLs. `/bill/[id]` reads the congress number from the stored `bill_id` (`119-hr-2702`), not from any global constant. Old bills keep working.

## Files to touch

- `lib/congress.ts` (new)
- `components/HeaderBar.tsx` (replace hardcoded label)
- `lib/sync.ts` (replace hardcoded `/bill/119` in the list URL)
- `app/api/sync/route.ts` (same, if it builds the URL independently)
- `scripts/sync.ts` (same, if it builds the URL independently)
- `.claude/skills/cbt/SKILL.md` — document `getCurrentCongress`, replace `/bill/119` references in the API section with `/bill/{currentCongress}`, add a note about the late-activity tradeoff after a rollover

## Acceptance

- Header on every page reads `119th Congress` today (May 2026).
- Manually constructing a `Date` for `2027-01-03` and passing it through `currentCongressLabel` returns `120th Congress`. Add a quick unit test or smoke check in `scripts/`.
- `lib/sync.ts` builds the list URL from `getCurrentCongress()`, not a literal `119`.
- `npm run sync` still works today; output unchanged.
- `npm run typecheck` clean.

## Don't

- Don't add a manual override env var (`CONGRESS_NUMBER=119`). Date-derived is correct and unambiguous.
- Don't render the year range too (`119th Congress (2025–2027)`). The number alone is what the user asked for.
- Don't move other instances of `119` (like in test fixtures or example bill IDs in docs) — they're literals, not constants.

## Cost note

Zero.
