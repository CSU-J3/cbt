# 75 — /reports index page

## What this is

The weekly report pipeline ships output but there's no index. Past reports live at `/reports/[id]` (or similar — verify during pre-flight) with no list view to discover them. This handoff adds `/reports` as a flat chronological list. Date, title, a short preview, click-through to the full report.

Read-side only. No changes to the report generation pipeline. No new schema. No LLM calls.

## Pre-flight

Locate where reports are stored. From the prior session's wrap, reports v1 shipped with "cron + CLI + routes + download." Two likely architectures:

1. **DB table** (e.g. `reports` with columns like `id`, `week_start`, `title`, `body`, `generated_at`) — most likely given the rest of the project's libSQL discipline.
2. **MDX files** in `content/reports/` or similar — possible if the storage was kept human-editable for hand-curation.

Open `lib/queries.ts`, `lib/report-generation.ts`, and the existing `/reports/[id]` route (or whatever pattern was used). The first will tell you. Implement against the actual structure, not the assumed one.

If reports are MDX files, the `/reports` list comes from `readdirSync` over the content directory + frontmatter parsing. If they're a DB table, a `getReports(limit, offset)` query in `lib/queries.ts`. Same UI either way.

Flag which architecture you found in the run notes.

## In scope

- New route: `app/reports/page.tsx`
- New query helper (if DB-backed): `getReports(limit, offset)` and `getReportCount()`
- New `ReportRow` component for the list view
- Add `/reports` to the global nav (between `/news` and `/stale`, or wherever fits the existing pattern)
- HeaderBar with title `WEEKLY REPORTS · {count}` and last-updated MT
- Empty state for "no reports yet"
- Pagination if more than 20 reports exist (unlikely for a while; ship it anyway)

## Out of scope

- Search or filters on the index. v1 is flat chronological.
- A second view (calendar grid, tag clusters, topic split). One list is enough.
- Editing or deleting reports from the index. Read-only.
- RSS or email digest of reports.
- Anything that changes report generation, content, or storage.
- Tagging system.

## UI

### `ReportRow` component

`components/ReportRow.tsx`. Server component. Grid via new `.report-row` class:

```
90px       — week start date (YYYY-MM-DD, monospace)
1fr        — title (the report's headline or generated title)
180px      — quick stats (e.g. `47 new · 12 advanced · 3 stalled` — pull from the report's stored summary fields if present)
80px       — link arrow / action
```

If the reports don't store separate stats columns and only have a `body` field, the 180px column collapses — render just date + title + arrow. Don't extract stats from prose; that's parsing the LLM's own output and is brittle.

Click the row → navigate to the existing report detail route (`/reports/[id]` or whatever the existing pattern is).

### `/reports/page.tsx`

```
HeaderBar: WEEKLY REPORTS · {count}
[empty state] No reports generated yet. The cron runs Mondays at 09:00 UTC.
[non-empty]
  Header row: DATE · REPORT · STATS · -
  ReportRow × up to 20 most recent
  [Pagination footer: ← Previous · Page N of M · Next →]  only if count > 20
FooterLegend
```

If 0 reports exist, render the empty-state line and stop. No FooterLegend, no pagination, no header row. Same pattern as `/president`'s empty state.

For pagination, follow the URL convention used by the main feed: `?page=N`. Hide the previous/next links at the edges.

### CSS

Add to `globals.css`:

```css
.report-row {
  display: grid;
  grid-template-columns: 90px 1fr 180px 80px;
  align-items: baseline;
  column-gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-soft);
  font-size: 13px;
}

.report-row:hover {
  background: var(--bg-row-hover);
}

.report-row .stats {
  font-size: 12px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

@media (max-width: 700px) {
  .report-row {
    grid-template-columns: 90px 1fr 60px;
  }
  .report-row .stats {
    display: none;
  }
}
```

Mobile drops the stats column. Same pattern as the other row types.

## Caching

If DB-backed: wrap `getReports` and `getReportCount` in `unstable_cache` tagged `reports-list`, revalidate 1h. The reports cron writes weekly, so even an hour-stale list is fine.

Add `revalidateTag('reports-list')` to the cron route after report writes. Add `reports-list` to `ALLOWED_TAGS` in `app/api/revalidate/route.ts`.

If MDX-backed: no cache needed at this scale. `readdirSync` per request is fast enough; revisit if there are ever 100+ reports.

## Navigation

Add `/reports` to the global nav strip. Position: after `/news`, before `/stale`. The order reflects how a user would read the dashboard top-down (news → reports → staleness → at-desk → changes → sponsors → watchlist).

## Verification

1. `/reports` loads without errors.
2. If reports exist, they render with most-recent-first.
3. If no reports exist, the single-line empty state renders.
4. Clicking a row navigates to the existing report detail route.
5. Mobile: stats column hidden, date + title + arrow visible.
6. Pagination works on the >20 case (test by lowering the page size to 2 in a temporary local edit if there aren't enough real reports yet, then revert).
7. The nav link highlights when on `/reports`.
8. Monday's cron tick (tomorrow 09:00 UTC) generates a new report; `/reports` shows it within a refresh after the sync route runs.

## Don't

- Don't write a new report. The cron generates them; the index just lists.
- Don't summarize, re-summarize, or process the existing report bodies in any way for the index. Use only what's stored.
- Don't add a "generate report now" button. Manual generation goes through the existing CLI per the report-generation.ts setup.
- Don't display tags, topics, or anything not already on the report object. The list view should be a thin projection of what's stored.
- Don't ship if no reports exist yet and you can't verify the route renders. Drop a synthetic test row into the DB or MDX file long enough to confirm rendering, then delete it.
