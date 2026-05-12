# Sponsor row expansion: stats + photo

Two-phase change. Phase A is foundational schema/sync work. Phase B
is the UI on top.

---

## Phase A — capture sponsor bioguide ID

### Why

Right now sponsors are identified by name string (`Smith [R-TX]`).
Two different Smiths in TX would collide. We also need a stable ID
for fetching photos and for keying the expansion URL state. The
Congress.gov API gives every sponsor a `bioguideId` (e.g. `M000133`
for Markey) — we just haven't been storing it.

### Schema

Add to `bills` table:

```sql
ALTER TABLE bills ADD COLUMN sponsor_bioguide_id TEXT;
CREATE INDEX idx_bills_sponsor_bioguide ON bills(sponsor_bioguide_id);
```

Migration script in `scripts/migrate.ts` (or wherever the existing
migrations live).

### Sync

In `lib/sync.ts`, when extracting sponsor info from the bill detail
response, pull `bioguideId` and write it to the new column. Update the
upsert.

### Backfill

`raw_json` already holds the full bill detail for every existing row.
Write a one-shot script in `scripts/` (e.g.
`backfill-sponsor-bioguide.ts`) that:

1. Selects all rows where `sponsor_bioguide_id IS NULL`.
2. Parses `raw_json`, extracts `sponsors[0].bioguideId`.
3. Updates the row.

No API calls needed — we already have the JSON. Should run in seconds.

### Refactor downstream

All sponsor aggregation queries (the volume bar chart, pass-rate page)
should now `GROUP BY sponsor_bioguide_id` instead of
`sponsor_name`. Keep the name as a `MAX(sponsor_name)` or similar
representative-row aggregate so display still works.

The existing `?sponsor=` filter on `/` should accept either a
bioguide_id or a name string for backwards compatibility — but going
forward the canonical link form is `?sponsor={bioguide_id}`.

---

## Phase B — expanding sponsor row

### Behavior

Mirror the bill-feed expansion pattern exactly:

- URL state: `?expanded={bioguide_id}` on `/sponsors`.
- Clicking a row toggles expansion. Only one expanded at a time.
- Click outside / click the same row again collapses.

Component-wise this should reuse whatever utility powers the bill row
expansion. Keep the same chevron `▸` / `▾` indicator on the left.

### Expansion content

Layout:

```
▾  1   Sen. Markey, Edward J. [D-MA]   [████████  15]

   ┌─────────┐  TOTAL BILLS    15
   │ [photo] │  ENACTED        1  (7%)
   │  150px  │  STAGES         ▸ INTRO 4 · ▸ COMMITTEE 9 · ▸▸ FLOOR 1 · ✓ ENACTED 1
   │  200px  │  TOPICS         ENV (8) · ENRG (5) · TECH (4)
   └─────────┘
                RECENT BILLS
                S 4471   Energy market transparency             ▸ COMMITTEE   04-30-26
                S 4470   Urban agriculture office reform        ▸ COMMITTEE   04-30-26
                S 4469   Commodity exchange event contracts     ▸ COMMITTEE   04-30-26
                S 4468   School staff behavioral health         ▸ COMMITTEE   04-30-26
                S 4467   Nursing facility requirements          ▸ COMMITTEE   04-30-26

                VIEW ALL 15 BILLS →
```

Rules:
- Photo on left (~150–200px wide, fixed aspect). If the photo URL 404s, show a monogram fallback (initials in a muted square the same size).
- Stats panel right of photo. Plain text in monospace.
- Stage breakdown reuses the same `▸ / ▸▸ / ▸▸▸ / ▸▸▸▸ / ✓` glyphs and stage colors as the feed.
- Topics: top 3 by count, comma-separated, each clickable to `/?sponsor={bioguide_id}&topics={topic}`.
- Recent bills: 5 most recent by `latest_action_date`, each is a link to `/bill/{id}`. Stage column matches feed style.
- "View all N bills →" link points to `/?sponsor={bioguide_id}`. The N matches `total_bills`.

### Photo URL

Bioguide photos live at:
`https://bioguide.congress.gov/bioguide/photo/{first_letter_of_bioguide_id}/{bioguide_id}.jpg`

E.g. for Markey (`M000133`):
`https://bioguide.congress.gov/bioguide/photo/M/M000133.jpg`

Verify this pattern is current by hitting one or two manually before
wiring it up — the bioguide site has changed URL schemes in the past.
If the pattern's wrong, alternatives to try:

- `https://www.congress.gov/img/member/{bioguide_id_lowercase}.jpg`
- `https://clerk.house.gov/images/members/{bioguide_id}.jpg` (House only)

Use a `<img>` tag with `loading="lazy"` and an `onerror` handler that
swaps in the monogram fallback. No need to proxy or cache server-side
for v1 — the browser handles it.

### Apply to both pages

The same expansion behavior should work on `/sponsors` and
`/sponsors/pass-rate`. Component should be reusable across both.

### Stats query

Per sponsor expansion, run one query that returns everything needed
for the panel:

```sql
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
  SUM(CASE WHEN stage = 'introduced' THEN 1 ELSE 0 END) AS introduced,
  SUM(CASE WHEN stage = 'committee' THEN 1 ELSE 0 END) AS committee,
  SUM(CASE WHEN stage = 'floor' THEN 1 ELSE 0 END) AS floor_count,
  SUM(CASE WHEN stage = 'other_chamber' THEN 1 ELSE 0 END) AS other_chamber,
  SUM(CASE WHEN stage = 'president' THEN 1 ELSE 0 END) AS president
FROM bills
WHERE sponsor_bioguide_id = ?
```

Plus a separate query for top topics (since `topics` is a JSON array
in the row, you'll need to expand it — easiest is to load all bill
topic arrays for that sponsor and aggregate in JS, given counts will
be ≤ 50ish per sponsor).

Plus a third query for recent bills:

```sql
SELECT id, bill_type, bill_number, title, stage, latest_action_date
FROM bills
WHERE sponsor_bioguide_id = ?
ORDER BY latest_action_date DESC
LIMIT 5
```

Three queries on expand is fine. Don't try to denormalize.

### Performance

Expansion fires when the user clicks a row, so the queries run on
demand. Server component, fresh fetch on each URL change. No caching
needed for v1.

---

## Out of scope

- Standalone `/sponsor/[id]` permalink page. The expansion is enough
  for now. We can add the permalink page later by extracting the
  expansion content into a shared component.
- Cosponsors. The schema doesn't track them yet. Lead-sponsor only.
- Photo CDN / proxy. Browser-direct fetch is fine until it isn't.

## Cost note

No LLM calls. No paid API calls. Backfill is a local DB pass over
existing JSON.

## Verify

- Migration ran, `sponsor_bioguide_id` column exists, indexed.
- Backfill script populated bioguide IDs for all 1,461 bills.
- `/sponsors` and `/sponsors/pass-rate` aggregations match what they showed before — totals shouldn't shift.
- Clicking a sponsor row expands inline; URL becomes `?expanded={bioguide_id}`.
- Photo loads for known sponsors (Markey M000133, Schumer S000148, Pelosi P000197). Fallback monogram shows for any 404.
- Stats match: enacted % equals what the pass-rate page shows for that sponsor.
- "View all N bills" link routes to `/?sponsor={bioguide_id}` and shows that sponsor's bills filtered.
- Mobile width — photo + stats stacks vertically rather than side-by-side, recent bills list still readable.
