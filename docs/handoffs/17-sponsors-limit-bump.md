# Handoff 17: Bump sponsor list cap

## Goal

Raise the `getSponsors(filters, limit=500)` cap to `600`. Current Congress has roughly 540 unique sponsors with bills in the table, so 500 silently truncates the long tail and creates a `540 OF 540 SPONSORS` header that doesn't match the rendered row count.

## Change

In `lib/queries.ts`, update the default for `getSponsors`:

```ts
export async function getSponsors(filters: SponsorFilters, limit = 600) { ... }
```

Confirm there's no other call site passing an explicit limit; the page's call should resolve to 600 unmodified.

## Acceptance

- `/sponsors` with no filters renders every distinct sponsor in the table (current count: ~540).
- Header `X OF Y SPONSORS` numerator matches the rendered row count exactly.
- `npm run typecheck` clean.

## Don't

- Don't remove the cap entirely. 600 is generous headroom; an unbounded query is the wrong default for a personal dashboard.
- Don't add pagination. If we ever blow past 600, that's the moment to revisit, not now.

## Cost note

Zero. SQL only.
