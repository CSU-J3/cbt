# Merge /sponsors and /sponsors/pass-rate into one page

## Problem

`/sponsors` shows volume bars. `/sponsors/pass-rate` shows pass rate
bars. Same dataset, same row component, same expansion. The only
meaningful difference is `ORDER BY`. Two URLs for one piece of data is
clutter — and it forces you to context-switch to compare a sponsor's
volume against their pass rate.

## Fix

Consolidate into `/sponsors`. Add a sort toggle alongside the chamber
toggle. Each row shows both metrics inline, so the toggle just changes
ordering, not what's visible.

### URL state

`?sort=volume` (default) or `?sort=passrate`. Same `params.delete("page")`
treatment when the toggle changes (consistent with chamber, stage,
topic, search).

### Toggle UI

Place near the chamber toggle. Same three-segment styling:

```
SORT BY  [VOLUME]  [PASS RATE]
```

Selected segment uses `--accent-amber-bright`.

### Row layout

Each row now shows both metrics:

```
RANK  NAME                              [████████  15]   [██  5%]   1✓ / 19
 1    Sen. Markey, Edward J. [D-MA]     [██████    14]   [          0%]   0✓ / 14
```

Two parallel bars per row:

- **Volume bar** — width = `(bill_count / max_volume) * 100%`. Party-colored (existing behavior).
- **Pass-rate bar** — width = `(passrate / 100) * 100%`. Stage-enacted color (`--stage-enacted`), so it visually reads as "this much of their work made it through."

Suffix the row with raw counts: `1✓ / 19` (enacted / total).

If two parallel bars feel cramped on narrower screens, stack the pass-rate
bar below the volume bar within the same row. Mobile gets the stacked
treatment by default.

### Single query

Combine the two existing aggregations into one:

```sql
SELECT
  sponsor_bioguide_id,
  MAX(sponsor_name) AS sponsor_name,
  MAX(sponsor_party) AS sponsor_party,
  MAX(sponsor_state) AS sponsor_state,
  COUNT(*) AS total,
  SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
  CAST(SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) AS passrate
FROM bills
WHERE [chamber filter if set]
GROUP BY sponsor_bioguide_id
ORDER BY
  CASE WHEN ? = 'passrate' THEN passrate END DESC,
  CASE WHEN ? = 'passrate' THEN total END DESC,
  CASE WHEN ? = 'volume' THEN total END DESC
LIMIT 100
```

Bind the sort param three times. Tie-break the pass rate sort by
total bills so a sponsor with 5/5 doesn't outrank one with 8/10.

### Threshold

The old pass-rate page had `HAVING total >= 5` to avoid noise from
small-sample sponsors. On the merged page that cutoff is wrong for
volume sort — Sen. X with 4 bills should still show up. Two options:

- **(preferred)** Drop the `HAVING` filter entirely. Display every sponsor in the top 100 regardless of total. Pass rates for sponsors with very few bills are inherently noisy; the user can read the raw counts (`1✓ / 4`) and judge.
- Keep `HAVING total >= 5` only when sort is `passrate`. Conditional. More complex; only do it if dropping the threshold makes the volume view look weird.

Start with the first. Revisit if it's noisy in practice.

### Page header

```
SPONSORS                                                  ALL · HOUSE · SENATE  |  VOLUME · PASS RATE
TOP 100 BY {volume|pass rate} (119TH CONGRESS)
```

Subtitle updates with the active sort.

## Cleanup

- Delete `/sponsors/pass-rate` route and its page file.
- Update the header nav: remove the `📊 PASS RATE` link. The icon next
  to `👥 SPONSORS` can stay or change to whatever still fits one
  consolidated page.
- Any documentation in `SKILL.md` that references the two-page split
  should be updated to describe the single page.

## Caveat note

The mid-Congress caveat from the old pass-rate page still applies — most
bills are still in flight, so pass rates today aren't final. Move the
note onto the merged page and only show it when `sort=passrate` is
active.

## Verify

- `/sponsors` defaults to volume sort.
- `/sponsors?sort=passrate` re-sorts by pass rate, both bars still render on every row.
- Chamber toggle works under both sorts; toggling it preserves `sort` but resets `page` to 1.
- Sort toggle preserves `chamber` and `topics` (if topic filter exists), resets `page` to 1.
- `/sponsors/pass-rate` either 404s cleanly or redirects to `/sponsors?sort=passrate` (your call — redirect is friendlier).
- Header nav no longer shows the pass-rate link.
- Mobile width — bars stack vertically per row, no horizontal overflow.
- Expansion still works: clicking a row expands; bioguide photo, stats, recent bills all render.
