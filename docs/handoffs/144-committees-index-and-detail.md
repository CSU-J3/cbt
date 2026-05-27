# 144 — Committees, Phase 2: index + minimal detail

## What this is

Phase 2 of three on the committee surface. HO 143 landed the data layer (235 committees, 22,765 committee_bills, 3,839 committee_members). This handoff puts a UI on it: a `/committees` index sortable by recent activity, and a minimal `/committee/[systemCode]` detail page so the index has working links.

Intentionally tight. Phase 3 adds depth — rich activity charts, topic distribution within a committee, subcommittee hierarchy, hearing data. None of that here. Phase 2 ships what's needed for the index to feel functional.

## In scope

- `/committees` index page
- `/committee/[systemCode]` minimal detail page
- Header nav entry: `⚙ COMMITTEES` (or whatever fits the existing nav idiom)
- Query helper extensions in `lib/queries.ts` if Phase 1's `getCommitteeActivity` / `getCommitteeBills` / `getCommitteeMembers` need shape adjustments for the page consumers
- Cache wiring with the `committees` tag (already established by HO 143)
- `SKILL.md` updates for the two new pages

## Out of scope

- Activity time series chart per committee. Phase 3.
- Topic distribution chart within a committee. Phase 3.
- Subcommittee hierarchy navigation (parent ↔ children). Phase 3.
- Hearings, communications, or reports surfacing. Phase 3.
- Member-hub committee badges (the "Senator X serves on Y, Z committees" pill on member pages). Phase 3.
- Bill-detail committee references. Phase 3.
- Search/autocomplete on the index. v2 polish, not v1.
- Mobile-first responsive design. Per HO 134 backlog, mobile redesign is consolidated for all dashboard surfaces — not committee-specific.

## Index page: `/committees`

### Route

`app/committees/page.tsx`. Server component. Reads searchParams for filter/sort state.

### URL state

- `?chamber=house | senate | joint` — single value, optional. Missing = all chambers.
- `?sort=activity | name | members` — default `activity`. Stable across page loads.

### Layout

Mirror `/races` structure. Top filter strip (chamber buttons + sort dropdown), then rows.

Each row, in order:
1. Committee name (linkable to detail)
2. Chamber badge
3. Committee type (Standing/Select/Joint/etc.) as muted text
4. Recent bill count (last 30 days) — the activity metric
5. Member count
6. Subcommittee indicator if `parent_system_code IS NOT NULL` — small "↳ sub" tag, no extra navigation in Phase 2

Use the existing row styling from `/races` or `/sponsors` as the reference. Plain list, not cards.

### Sorting

- `activity` — DESC by count of committee_bills rows with activity_date in last 30 days
- `name` — ASC alphabetical
- `members` — DESC by count of committee_members rows

Compute the sort key in SQL, not in JS. If it gets ugly, materialize a `committee_stats` view or do it as a one-time aggregate in the query helper — but don't fan out 235 N+1 queries.

### Filter behavior

- Chamber filter is a single value (radio-style), not multi. House/Senate/Joint/All.
- Subcommittees included in counts by default. Don't add a "top-level only" filter in v1 — too many edge cases; revisit if Phase 3 needs it.
- `is_current = 0` rows excluded by default. No toggle to show retired committees in v1.

### Header chrome

Count mode label: `COMMITTEES`
Subtitle: `<N> committees, sorted by recent activity` (or whatever the active sort says)

Empty state shouldn't be reachable (235 committees exist), but include a graceful one anyway.

## Detail page: `/committee/[systemCode]`

Minimal. Phase 3 makes it rich. This page exists primarily so the index has working links.

### Route

`app/committee/[systemCode]/page.tsx`. Server component.

### Layout

Header block:
- Committee name (large)
- Chamber + committee type, muted
- Parent committee link if `parent_system_code IS NOT NULL` (links back up the hierarchy)
- Subcommittee links if any exist for this systemCode as parent — flat list, no nesting depth
- `isCurrent = 0` badge if retired

Two body sections, side by side on desktop, stacked on mobile:

**Members** (left, ~40% width)
- Sorted by `party_side` ASC, then `rank` ASC — chair/ranking member naturally floats to top within each side
- Each member: bioguide-linked name, role indicator if present (Chair/Ranking Member), party letter from `members.party` JOIN, state
- Header: `MEMBERS (<N>)` with majority/minority counts as muted suffix

**Recent bills** (right, ~60% width)
- Bills with committee_bills.activity_date in the last 30 days, ordered by activity_date DESC
- Limit 25 in v1; full feed waits for Phase 3 or a `/committee/[id]/bills` sub-page
- Reuse `BillRow` component. The activity_type and activity_date for this committee shows in the row (think: "Referred to" 3d ago)
- Header: `RECENT ACTIVITY (last 30 days)`

If the committee has zero rows on either side (defunct, no recent bills), render a single muted line rather than an empty section.

## Query helpers

Likely additions to `lib/queries.ts`:

```ts
// Index page consumer
export async function getCommitteesWithActivity(filters?: {
  chamber?: 'house' | 'senate' | 'joint';
  sort?: 'activity' | 'name' | 'members';
}): Promise<CommitteeRow[]>;

// Detail page consumers — extend HO 143's helpers if shape differs
export async function getCommitteeBySystemCode(systemCode: string): Promise<Committee | null>;
export async function getCommitteeSubcommittees(parentSystemCode: string): Promise<Committee[]>;
// getCommitteeMembers and getCommitteeBills already exist from HO 143; verify their shape works for the page
```

Cache everything with `unstable_cache`, tag `'committees'`. The sync route from HO 143 already revalidates that tag.

## Nav integration

Add committees entry to the header. Order in the nav goes roughly:

`/` `/changes` `/stale` `/president` `/members` `/committees` `/races` `/reports` `/watchlist`

Committees sits between people-axis (`/members`) and race-axis (`/races`) — it's the institutional structure that connects them.

Icon: `⚙` if the existing nav uses small unicode glyphs. If it uses lucide-react icons, pick one that matches (`Users` or `Building2`).

## Acceptance

1. `/committees` renders with 235 rows by default, sortable by activity/name/members, filterable by chamber.
2. Default sort (`activity`) puts the most-active committee at the top. House Judiciary or House Energy & Commerce are likely candidates; verify the top entry passes sanity.
3. `/committee/<systemCode>` for a real committee renders header + members + recent bills cleanly. Test with at least: a top-level committee with many members, a subcommittee, and an "empty recent bills" committee (a quiet one).
4. Parent ↔ subcommittee links work in both directions where applicable.
5. Members sort puts chair/ranking member at the top within majority and minority blocks.
6. Recent bills section uses `BillRow` and shows the per-committee activity (type + date), not the global latest action.
7. Nav entry added; clicking from any page lands on `/committees`.
8. `pnpm build` (or `npm run build` per project convention) produces no new errors. Both pages static-prerender unless searchParams forces dynamic.
9. `SKILL.md` updated with the two new routes and the cache-tag wiring.
10. Single commit: `feat: committees index + detail (HO 144)`.

## Notes

- **Why minimal detail and not skip the detail page entirely?** Skipping leaves a broken-feeling index where every row is a dead-end. A small detail page with members and recent bills is enough to feel functional; Phase 3 enriches it.
- **Sort by 30-day activity, not all-time bill count.** The framing question is "which committee is most active right now," not "which has handled the most bills ever." All-time counts would put House Judiciary and Senate Foreign Relations on top every week regardless of what's actually happening.
- **Subcommittees in the index.** They show up as their own rows alongside parent committees. Reasonable people could argue for indenting/grouping them — Phase 3 territory. v1 keeps the flat list because the data already supports it that way.
- **`getCommitteeBills` shape check.** HO 143 returned a generic shape; the detail page consumer wants the activity_type and activity_date inline with the bill data. If the existing helper doesn't carry those, extend it rather than write a parallel query.
- **Performance.** 235 committees on the index page is trivial; 22,765 rows in committee_bills with a 30-day filter and grouped count is also trivial with the indices HO 143 added. No N+1 to watch for as long as the activity sort aggregates in SQL.
