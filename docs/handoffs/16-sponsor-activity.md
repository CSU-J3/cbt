# Handoff 16: Sponsor activity view

## Goal

A new `/sponsors` page that lists who's actually introducing bills this Congress. Aggregates by sponsor across the existing `bills` table, with no new sync work and no schema changes. Click a sponsor to expand inline; "View all" jumps to the main feed filtered to their bills.

## Why

The dashboard tracks bills. Sometimes you want the inverse: who's sponsoring the most, who's quiet, which Senator from Texas has the most bills moving. The data is already in `sponsor_name`, `sponsor_party`, `sponsor_state`; surface it.

## Aggregation query

`getSponsors(filters: SponsorFilters)` returns:

```ts
{
  sponsor_name: string;
  sponsor_party: string | null;       // "R", "D", "I", sometimes "ID" (Sanders), sometimes null
  sponsor_state: string | null;       // 2-letter
  bill_count: number;                 // total bills this sponsor has in the table
  latest_action_date: string | null;  // MAX(latest_action_date) across their bills
}
```

SQL groups by `(sponsor_name, sponsor_party, sponsor_state)` with `COUNT(*)` and `MAX(latest_action_date)`. Inherit `summary IS NOT NULL` from `buildFeedWhere` so unsummarized bills don't pad sponsor counts. Document this in `SKILL.md` alongside the existing buildFeedWhere note.

`SponsorFilters`:

```ts
{
  party?: 'R' | 'D' | 'I';  // I covers any independent variant (ID, IND, etc.)
  state?: string;            // 2-letter
  q?: string;                // case-insensitive substring on sponsor_name
}
```

Sort: `bill_count DESC, sponsor_name ASC` (the second clause keeps ordering stable when counts tie).

`getSponsorCount(filters)` returns `{total, filtered}` matching the established pattern. `total` = total distinct sponsors with summarized bills, `filtered` = after filters.

`getSponsorRecentBills(sponsor_name: string, limit = 5)` returns the 5 most recent bills for inline expand, sorted `latest_action_date DESC`.

`getSponsorStates()` returns distinct `sponsor_state` values present in the data, alphabetical, for the state filter dropdown.

## Sponsor identity (slug problem)

We don't store bioguide_id. Use URL-encoded `sponsor_name` as the routing slug. Document the collision risk: two reps with identical names from the same state and party would collide. Likelihood is low; the real fix is adding `sponsor_bioguide_id` in a future handoff if it shows up in practice. Don't preemptively fix.

## Layout

Custom grid; BillRow doesn't fit because the columns are different:

```
[expand] [name] [party-badge] [state] [bill-count] [latest-action]
  24px    1fr      40px        50px      80px         110px
```

- Name in `--text-primary`, font-medium
- Party badge: single character (R/D/I), colored via `--party-republican` / `--party-democrat` / `--party-independent`. Collapse `ID` and any non-R-non-D variant to `I` for both color and display.
- State in `--text-muted`, 2-letter
- Bill count right-aligned, monospace, `--accent-amber-bright` (it's the headline number for this view)
- Latest action date in `--text-muted`, rendered with the same `Intl.DateTimeFormat` used elsewhere

New component: `components/SponsorRow.tsx`. Don't try to extend BillRow with conditional columns.

## Filters and search

- Party filter dropdown: All / R / D / I. Mirrors `StageFilter` shape.
- State filter dropdown: All + every state present in the data (from `getSponsorStates()`), alphabetical.
- Search: by name substring, case-insensitive. Reuse `SearchBox` with `basePath="/sponsors"`. The `q` param applies to sponsor names on this page, not to bills.

URL params: `?party=`, `?state=`, `?q=`, `?expanded=` (URL-encoded sponsor name of currently expanded row).

## Expand behavior

Click a sponsor → expand inline. Expanded panel renders:

- Their 5 most recent bills as a compact list (not full BillRow): bill ID, truncated title, latest action date
- A `[VIEW ALL N BILLS →]` link to `/?sponsor=${encodeURIComponent(sponsor_name)}`

Same expand semantics as other pages: replace history entry, one expanded at a time.

## Sponsor filter on main feed

`?sponsor=` is part of this handoff so the "View all" link has somewhere to go.

- Add `sponsor?: string` to `FeedFilters`
- Extend `buildFeedWhere` to AND `sponsor_name = ?` when set
- `HeaderBar` shows the active sponsor in the count line, e.g. `47 OF 1,643 BILLS · sponsored by Smith`, with the suffix in `--accent-amber` matching the existing `· "query"` treatment
- Stage, topic, and search filters must compose with `?sponsor=` without breaking. Same `FeedFilters` plumbing; should be free.

## Header

`X OF Y SPONSORS` count line, same shape as `/`, `/stale`, `/president`. Numerator in `--accent-amber-bright`. Subtitle in `--text-muted`: `who's introducing what, sorted by bill count`. Suffix `· "query"` when search is active, same treatment.

Empty results: centered `NO SPONSORS MATCH "..."` + `[CLEAR SEARCH]`, mirroring the feed pattern.

Add a `Sponsors` nav link to `HeaderBar` between `Feed` and `Watchlist`. Text-only (consistent with the no-emoji feedback from the `/stale` review). Active state on `/sponsors`.

## Files to touch

- `app/sponsors/page.tsx` (new server component)
- `lib/queries.ts` (`getSponsors`, `getSponsorCount`, `getSponsorStates`, `getSponsorRecentBills`; extend `FeedFilters` with `sponsor?: string`; extend `buildFeedWhere` to handle it)
- `components/SponsorRow.tsx` (new)
- `components/PartyFilter.tsx` (new client component, mirrors `StageFilter`)
- `components/StateFilter.tsx` (new client component; takes server-fetched state list as a prop)
- `components/HeaderBar.tsx` (`countMode: "sponsors"`, `sponsorCounts` prop, nav link, `· sponsored by X` suffix in count line when `?sponsor=` is active on main feed)
- `.claude/skills/cbt/SKILL.md` (document `/sponsors` in Pages, the new query helpers, the SponsorRow grid layout, the party-variant collapse rule, the slug-collision caveat)

## Acceptance

- `/sponsors` lists distinct sponsors sorted by `bill_count DESC`, ties broken by name.
- Party filter narrows correctly. `ID` and other independent variants collapse to `I` (both for color and for filtering).
- State filter narrows correctly; only states present in the data appear in the dropdown.
- Search by name substring works, case-insensitive. Empty filtered result shows the centered `NO SPONSORS MATCH` block.
- Clicking a row expands inline, shows 5 most recent bills and a `VIEW ALL` link.
- `/?sponsor=<encoded name>` filters the main feed correctly. The count line shows `· sponsored by <name>` in amber.
- Stage, topic, and search filters all compose with `?sponsor=` on the main feed.
- HeaderBar shows `X OF Y SPONSORS` with the `· "query"` suffix when `q` is active.
- `Sponsors` nav link present, active state on `/sponsors`.
- Main feed (`/`), `/stale`, `/president`, `/watchlist` visually unchanged.
- `npm run typecheck` clean.

## Don't

- Don't create a `/sponsor/[slug]` detail page. Inline expand + main-feed filter covers the case for less code and zero new routing.
- Don't add `sponsor_bioguide_id` to the schema. Slug-by-name MVP is fine until proven otherwise.
- Don't try to reuse `BillRow` with conditional columns. The grid is fundamentally different; new component.
- Don't sort sponsors by anything other than bill_count DESC for v1. No user-controlled sort dropdown.
- Don't render party as a full word (Republican / Democrat). Single letter, colored. Existing aesthetic.
- Don't add an emoji to the nav link.

## Cost note

Zero LLM cost. SQL aggregation only.
