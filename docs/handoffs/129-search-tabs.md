# 129 — /search tabs (Frame 3)

## What this is

Last of the three Claude Design frames. Today search is `?q=<query>` on `/feed` only — bills only, single result list, lives in `SearchBox` per HO 12. Frame 3 makes `/search?q=<query>` a dedicated route with tabbed results across multiple entity types, mirroring the AlienVault/OTX `Searching...` view (Pulses · Users · Groups · Indicators · Malware Families · …).

Continues the design-language pivot from HO 125/126/127/128. Frame 1 (`/patterns` bubble cluster) shipped in HO 128.

Multi-layer change: new route, new tab component, per-tab queries, `SearchBox` rewire. Phase 1 diagnostic precedes any implementation per the discipline.

## Prior art

- **HO 12** — original search, `?q=` on `/`, `SearchBox` client island
- **HO 19** — added `sponsor_name` to the LIKE clause
- **HO 53** — `/` → `/feed` route move; search lives on `/feed?q=` today
- **HO 89** — `/sponsors` → `/members` rename
- **HO 64 / 75 / 86 / 102 / 103 / 104 / 111** — news pipeline (`news_mentions` table)
- **HO 58 / 75 / 85 / 109 / 110 / 111 / 112 / 113** — reports schema and content
- **HO 128** — most recent design-language ship (`/patterns` bubble cluster)

## In scope

- Phase 1 — audit current search, count actual entity matches for a representative query, propose tab set + URL convention + count strategy + row shapes + `SearchBox` rewire policy
- Phase 2 — `/search` route with tabbed results, parallel count queries, active-tab result fetch
- Phase 3 — `SearchBox` rewires from `/feed?q=` to `/search?q=` (bundle into Phase 2 unless scope balloons; same pattern HO 128 used for its drill-out link)

## Out of scope

- Per-tab filter rail (the OTX `Indicators Search` left rail with Indicator Type / Role / All Time). Counts + sort only in v1.
- Cross-tab filters (date range, party, stage). Explosive surface area; v2.
- LLM-synthesized answer at the top of `/search`. v3 territory; needs separate scoping.
- Fuzzy / vector / semantic search. LIKE semantics stay.
- Autocomplete or type-ahead inside `SearchBox`.
- Saved searches.
- Tabs for entities the dashboard doesn't yet surface (committees, votes, etc.).
- Mobile-first redesign of the tab strip — desktop ships first.

## Phase 1 — Diagnostic (no commits)

Read actual artifacts. Run real counts. Post findings to chat with proposals. No code beyond ad-hoc queries.

### Required reads

1. **`components/SearchBox.tsx`** — confirm `router.push` target today (expected: `/feed?q=`), debounce, clear behavior
2. **`lib/queries.ts`** — `buildFeedWhere` `q` clause, what columns it ORs across, `sanitizeQ` shape if any
3. **`app/feed/page.tsx`** — confirm `?q=` plumbing on the feed
4. **`app/members/page.tsx`** (and/or `app/sponsors/page.tsx`) — confirm canonical member page + what name field drives matching
5. **`app/news/page.tsx`** — confirm what `news_mentions` columns are user-facing-searchable (headline? source? matched bill_id?)
6. **`app/reports/page.tsx`** — confirm reports schema. Body column? Single string vs JSON? Tells us if Reports is a cheap tab or expensive one.
7. **`scripts/migrate.ts`** — schemas for `news_mentions` and `reports` to confirm column names

### Queries to run

Pick a representative query that hits multiple entities. `'education'`, `'immigration'`, or `'healthcare'` are good — each is a common topic with bill matches, sponsor co-mentions, and news coverage. Use one query consistently across all counts so the relative numbers are comparable.

```sql
-- BILLS count (mirror the existing /feed?q= LIKE clause exactly)
SELECT COUNT(*) FROM bills
WHERE summary IS NOT NULL
  AND (LOWER(title) LIKE '%education%'
    OR LOWER(summary) LIKE '%education%'
    OR LOWER(id) LIKE '%education%'
    OR LOWER(sponsor_name) LIKE '%education%'
    OR REPLACE(LOWER(id), '-', '') LIKE '%education%');

-- MEMBERS count (distinct sponsors whose name matches)
SELECT COUNT(DISTINCT sponsor_name) FROM bills
WHERE LOWER(sponsor_name) LIKE '%education%';
-- ^^ confirm whether this is the canonical member match or whether a /members table has a richer field

-- NEWS count (against news_mentions — confirm columns first)
SELECT COUNT(*) FROM news_mentions
WHERE LOWER(headline) LIKE '%education%'
   OR LOWER(source) LIKE '%education%';
-- ^^ adjust columns to whatever actually exists per the schema read

-- REPORTS count (confirm shape first)
SELECT COUNT(*) FROM reports
WHERE LOWER(body) LIKE '%education%' OR LOWER(title) LIKE '%education%';
-- ^^ if body is JSON or multi-column, adjust accordingly

-- Sample rows for each tab (top 3 by date or count)
-- e.g. for bills: SELECT id, title FROM bills WHERE … ORDER BY latest_action_date DESC LIMIT 3;
```

Post the raw counts + 2–3 sample row titles per tab. The relative ratios decide which tabs are worth shipping.

### Proposals to post

Each gets a recommendation. Sign-off picks one per item.

1. **Tab set for v1.** Recommend Bills (default) + Members + News. Add Reports only if (a) the body column is a single TEXT field cheap to LIKE-scan and (b) its count for the representative query is non-trivial (≥5 results). If Reports is JSON-blob shaped or expensive to query, defer to v2.

2. **URL convention.**
   - (a) `?q=foo&tab=members` query-param-based
   - (b) `/search/members?q=foo` segment-based
   - Recommend (a) — one route, simpler sanitize, easier to share the same `?q=` plumbing the rest of the app already uses.

3. **Default tab.** Always Bills regardless of which tab has the most hits. Matches existing UX, doesn't surprise anyone with a query like `'Schumer'` defaulting to Members. Alternative: highest-count tab. Recommend always-Bills.

4. **Count strategy.** Parallel `Promise.all` of N tab-count queries on every page load, plus the active-tab result fetch. Each count cached via `unstable_cache` keyed on `q`. Skip result fetch for inactive tabs — only the active tab loads rows. Recommend.

5. **Result row shapes.**
   - Bills: existing compact BillRow variant (HO 125's ActivityTicker shape; reuse, don't fork)
   - Members: name · party · state · bill count · link to `/members/[bioguide]` or `/members?q=` per current convention
   - News: headline · source · published date · linked bill IDs as clickable badges
   - Reports (if shipped): title · week · first 1–2 sentences of body

6. **`SearchBox` routing.**
   - (a) Always route to `/search?q=` regardless of current page
   - (b) Route to `/search?q=` from anywhere *except* `/feed`, where searches stay inline as today
   - Recommend (b). On `/feed` the in-feed filter is the more useful behavior; from anywhere else `/search` is the right destination. `/feed?q=` URLs keep working for bookmarks regardless.

7. **Empty-state-per-tab.** When the active tab has zero results but another tab has matches, show `NO MATCHES IN MEMBERS · try BILLS (147 matches) →`. The redirect hint is itself a Link to `?tab=bills`. Recommend.

### HALT

End Phase 1 with: schema confirmations, raw counts for the representative query (+ 2–3 sample titles per tab), and proposals 1–7 with picks. Wait for sign-off on every numbered item before Phase 2.

## Phase 2 — Implementation (after sign-off)

### Query layer

`lib/queries.ts`:

- `searchBills(q, { limit, offset })` — reuse existing `buildFeedWhere` `q` clause as a sub-helper, but expose as a search-shaped function that *ignores* stage/topic/cluster filters (search is global by intent)
- `searchBillsCount(q)`
- `searchMembers(q, limit)` and `searchMembersCount(q)`
- `searchNews(q, limit)` and `searchNewsCount(q)`
- `searchReports(q, limit)` and `searchReportsCount(q)` — only if Phase 1 picks include Reports
- Each `unstable_cache`'d, tagged with the matching invalidation tag (`bills`, `news`, `reports`)
- `sanitizeQ` may already exist from HO 12; reuse

### Route

`app/search/page.tsx`. Server component.

- Reads `?q` and `?tab` from `searchParams`. `sanitizeSearchTab(input)` validates against the known tab set; falls back to `bills`.
- Runs every tab count in parallel via `Promise.all`.
- Runs the active tab's result fetch.
- Renders:
  - `HeaderBar` with search variant (the search input already lives there; populate it with the current `q`)
  - Count line: `145 RESULTS IN BILLS · "education"` (numerator in `--accent-amber`, mirrors the existing feed count idiom)
  - `SearchTabs` tab strip with counts
  - Active tab's result list
  - Empty-state-per-tab redirect when applicable

Empty `?q=`: render the SearchTabs strip with all zero counts plus a centered hint `ENTER A QUERY TO SEARCH BILLS, MEMBERS, AND NEWS.` Don't 404.

### Components

- `components/SearchTabs.tsx` — client island
  - Renders `Bills (145)` · `Members (12)` · `News (38)` · `Reports (4)`
  - Active tab: `--accent-amber` bottom border, 2px
  - Inactive: muted text, no border
  - Zero-count tabs are dimmed (50% opacity) but still clickable
  - Click → `router.push('/search?q=' + q + '&tab=' + slug, { scroll: false })`
  - 12px uppercase letter-spacing 0.5px, matches existing chrome
- `components/SearchResultsBills.tsx` — server, reuses HO 125 compact BillRow
- `components/SearchResultsMembers.tsx` — server, `MemberSearchRow` compact shape
- `components/SearchResultsNews.tsx` — server, `NewsSearchRow` shape
- `components/SearchResultsReports.tsx` — server, only if Reports is in the picks

### `SearchBox` rewire

Per Phase 1 pick. Default policy if (b):

```tsx
// inside SearchBox
const onSubmit = (value: string) => {
  const sanitized = sanitizeQ(value);
  if (pathname.startsWith('/feed')) {
    router.push(`/feed?q=${encodeURIComponent(sanitized)}`);
  } else {
    router.push(`/search?q=${encodeURIComponent(sanitized)}`);
  }
};
```

Direct `/feed?q=...` bookmarks keep working. Direct `/search?q=...` bookmarks keep working. The only behavioral change is *new* queries from the header bar on pages other than `/feed` go to `/search`.

### CSS

Add to `globals.css`:

```css
.search-layout { padding: 16px 24px; }
.search-tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--border-strong); margin-bottom: 16px; }
.search-tabs a {
  font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase;
  color: var(--text-muted); padding: 8px 0; border-bottom: 2px solid transparent;
}
.search-tabs a[aria-current="page"] { color: var(--text-primary); border-bottom-color: var(--accent-amber); }
.search-tabs a[data-empty="true"] { opacity: 0.5; }
.search-tabs .count { color: var(--text-dim); margin-left: 4px; }
.search-empty-hint { text-align: center; color: var(--text-muted); padding: 48px 16px; font-size: 13px; }
.search-empty-hint a { color: var(--accent-amber); }
@media (max-width: 700px) {
  .search-tabs { gap: 12px; overflow-x: auto; }
}
```

### Verification

1. `/search?q=education` renders with Bills tab active by default
2. All tab counts visible and correct
3. Click Members tab → URL updates to `&tab=members`, members list renders, Bills count persists
4. Empty tab shows `NO MATCHES IN MEMBERS · TRY BILLS (147 MATCHES) →` with a working Link
5. `?tab=foo` invalid value sanitizes to Bills
6. `HeaderBar` search from `/members` routes to `/search?q=...`
7. `HeaderBar` search from `/feed` stays on `/feed?q=...` (per pick 6b)
8. Direct `/feed?q=education` bookmarks work as before
9. Empty `?q=` shows the centered hint, not a 404 or crash
10. Type-check clean, no console errors, working tree ready to commit

## Acceptance

1. Phase 1 diagnostic posted in chat with all seven proposals, raw counts, schema confirmations
2. Sign-off received on every numbered proposal
3. Phase 2 implementation per the signed-off spec
4. `/search` route ships with three or four tabs (Bills + Members + News, plus Reports if Phase 1 greenlit it)
5. `SearchBox` rewire per sign-off (likely 6b)
6. `/feed?q=` bookmarks still work
7. SKILL.md `### Search` section rewritten to reflect the new architecture; `### Pages` gets a `/search` entry
8. Type-check clean, working tree clean, pushed
9. Commit message: `feat(search): tabbed entity search at /search (HO 129)`

## Don't

- Don't add a filter rail. Out of scope for v1; defer to v2 only if real usage proves it's needed.
- Don't fetch result rows for inactive tabs. Counts only.
- Don't introduce a tab library (shadcn, Radix, headless-ui). Hand-rolled HTML matches the terminal aesthetic; existing chrome is plain `<a>` + Tailwind/globals.css.
- Don't break `/feed?q=` semantics. The feed-page search is the in-feed filter; that's a feature, not a bug.
- Don't change the LIKE search semantics. Same fields, same OR pattern. Only the *surface* changes.
- Don't ship Reports as a tab unless its count for the representative query is non-trivial and the schema is cheap to scan. The handoff name is "search tabs", not "search every entity that exists."
- Don't add Topics or Patterns as tabs. Both are short browseable lists already surfaced elsewhere.
- Don't animate tab transitions. Plain swap.

## Notes

- The biggest unknown is Reports schema shape. Phase 1 confirms in the required reads. If reports body is JSON, defer Reports to v2; if it's a single TEXT column with reasonable size, ship it.
- The active-tab-only result fetch is the perf-saving move. Counts can run in parallel cheaply because they're `COUNT(*)` against indexed columns or short tables; result lists are heavier (joins, ordering, summary text).
- HO 128's `?selected=` URL pattern (slug + scroll-preserve) is the same shape as `?tab=` here. Same router.push idiom.

read docs/handoffs/129-search-tabs.md and follow
