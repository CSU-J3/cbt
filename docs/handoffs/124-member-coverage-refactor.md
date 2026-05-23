# 124 — Member coverage refactor: all members of Congress, not just bill sponsors

## What this is

The `/sponsors` page (or `/members` if HO 89 shipped) shows only members who've sponsored bills. Members who haven't sponsored anything but have voted, cosponsored, or served on committees never appear. User wants every member of the current Congress on the page, regardless of sponsorship activity.

The change is two-part:
1. Confirm HO 89 actually shipped (the rename `/sponsors` → `/members`) and complete it if not.
2. Invert the page's query from `bills.sponsor` → members to `members` → LEFT JOIN aggregations, so members with zero sponsorships still surface with their voting record, cosponsorship count, committees, and bio as primary content.

Multi-layer (route audit + data layer + UI). Phase 1 diagnoses HO 89 status, current query shape, members table completeness. Phase 2 implements per diagnosis.

Prior art:
- HO 89 — `/sponsors` → `/members` rename (status uncertain; the wireframes still showed SPONSORS in nav today)
- HO 60 — member bio data
- HO 61 — caucus badges
- HO 71 — Cook race ratings on the member hub
- HO 77 / 80 — House and Senate voting records
- HO 79 — voting record block on the member hub
- HO 94 — members-refresh (member table sync)

## Phase 1 — Diagnostic (HALT for sign-off)

### A. HO 89 status

- Does `app/members/` exist? Does `app/sponsors/` still exist alongside it?
- Is the rename actually live (HeaderBar nav reads "MEMBERS"), or was it scoped but not shipped?
- Are `next.config.ts` redirects in place (`/sponsors` → `/members`, `/sponsors/:bioguideId` → `/members/:bioguideId`)?

If HO 89 hasn't shipped, this handoff completes it as part of the same commit. If it has, the rename steps skip.

### B. Current data shape

- Where does the current page read its data? Which file, which query helper?
- Is it a `SELECT DISTINCT sponsor_name FROM bills` style, or does it already join through a `members` table?
- What aggregations does it compute per row (sponsored count, cosponsored count, votes cast, etc.)?
- Are there any caching tags wired (`unstable_cache`, `revalidateTag`)?

### C. Members table audit

- Does a `members` table exist? Schema (columns + indexes)?
- Row count. Expected ~535 House + ~100 Senate = ~635 for the 119th Congress.
- Which sync route or script populates it? When was it last refreshed?
- What identifier ties members to votes, sponsorships, cosponsorships? bioguideId primary?
- How many rows in `votes` (or similar) reference a `bioguide_id` that has no corresponding `members` row? That's the "voted but invisible" gap.

### D. Member-hub page sanity check

- `/members/[bioguideId]` for a member with zero sponsored bills: does the page load cleanly, or does it assume sponsorship data is present?
- Pick a real zero-sponsorship case from the audit in (C) to test. If none exists today, the page is implicitly safe for now but the refactor needs to keep it that way.

### E. Filters, search, sort

- What filter controls render today (chamber, party, state)?
- Search field — operates over the full members table, or only sponsors?
- Default sort — what does the page render top-down without a sort interaction?

### Report format

Post findings in chat. Sections:

1. HO 89 status — shipped, partial, or not shipped, with exact state of routes / nav / redirects
2. Current data query shape — file path + query helper + which tables it reads
3. Members table state — schema, row count vs expected ~635, sync route, gaps
4. Member-hub page robustness for zero-sponsorship members
5. Existing filter / search / sort controls
6. Proposed Phase 2 scope:
   - Rename completion if needed
   - Query inversion target shape
   - Sort default proposal with rationale (one of: most-active composite, alphabetical, by state, by party, by chamber)
   - Filter additions if any
   - Empty-state handling for members with zero recorded activity

### HALT

Stop here. Wait for sign-off on Phase 2 scope before implementing.

## Phase 2 — Implementation (after Phase 1 sign-off)

Shape depends on Phase 1. General target:

### Rename completion (only if HO 89 isn't done)

Per HO 89 steps 2-5: move routes, add redirects, update nav, update internal hrefs and references.

### Members table population

If the table has gaps:
- Sync helper that reads Congress.gov `/member/119/<chamber>` endpoint
- Upsert by bioguideId
- Canonical fields: full_name, party, state, chamber, district (House) or class (Senate), bioguideId, congresses
- Wire into the daily sync cron or run as a one-off backfill, depending on Phase 1 gap size

### Query inversion

Replace the list query with the shape:

```ts
SELECT
  m.bioguide_id,
  m.full_name,
  m.party,
  m.state,
  m.chamber,
  m.district,
  COALESCE(s.sponsored_count, 0)   AS sponsored_count,
  COALESCE(c.cosponsored_count, 0) AS cosponsored_count,
  COALESCE(v.votes_cast, 0)        AS votes_cast,
  COALESCE(v.attendance_pct, 0)    AS attendance_pct
FROM members m
LEFT JOIN sponsored_agg   s ON s.bioguide_id = m.bioguide_id
LEFT JOIN cosponsored_agg c ON c.bioguide_id = m.bioguide_id
LEFT JOIN vote_agg        v ON v.bioguide_id = m.bioguide_id
WHERE m.congresses LIKE '%119%'
ORDER BY <sort_default>
LIMIT ? OFFSET ?
```

The aggregates may already exist as views or computed columns; reuse if so. If new aggregates are needed, materialize as VIEW or compute inline.

### Filter controls

At minimum chamber, party, state should be filterable. Search field operates over `full_name LIKE`. Audit existing controls and extend only if Phase 1 shows gaps.

### Empty-state handling

For a member with zero across all aggregates, render the row anyway with whatever data exists (bio + committees + caucus). The roster is the source of truth; aggregates are decoration.

### Member-hub page fixes (if Phase 1 surfaces breakage)

If `/members/[bioguideId]` breaks for zero-sponsorship members, fix the query helpers to LEFT JOIN through to sponsorships rather than INNER JOIN.

## Out of scope

- New bio scraping or committee data sources beyond what's wired
- Member-hub layout redesign (separate handoff if it wants polish)
- External scoring data (DW-NOMINATE, etc.)
- Cross-Congress historical members — 119th only
- Touching the readability tooltips from HO 123 (they should already apply correctly to the new rows since the tags are the same)

## Acceptance

1. Phase 1 report posted with all six sections.
2. Sign-off obtained.
3. Phase 2 implemented per sign-off.
4. `/members` shows every member of the 119th Congress (~635 rows), not only bill sponsors.
5. Filter and search work across the full member set.
6. Sort default matches the agreed choice.
7. `/members/[bioguideId]` loads cleanly for any member, including those with zero sponsorships.
8. Type-check clean, working tree clean, pushed.
9. Commit message references HO 89 status (completed in this handoff if applicable).

## Notes

- HO 89 status is the gating unknown. Phase 1's section A resolves it before any other work.
- HO 94 (members-refresh) reportedly ran a member-table refresh recently. Phase 1's section C confirms whether that handoff fully populated the table or only partially.
- Sort default is the first-impression knob for a new visitor landing fresh (paired with HO 123's tooltips). My lean is most-active composite because it answers "who's the most useful starting point" without prior context. Alphabetical is safer but less informative. Code's proposal should weigh both.
- The page is going from ~150-300 rows (rough estimate of unique sponsors) to ~635 rows. Pagination behavior may want a look during Phase 1 — the current page-size might be tuned to a smaller universe.
- HO 123's tooltips should apply automatically to the new rows. If Phase 1 finds any new abbreviation surfaces (vote-attendance modes, committee codes, etc.), they fold into this handoff's audit rather than a follow-up.
