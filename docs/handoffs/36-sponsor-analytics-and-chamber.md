# Sponsor analytics + chamber toggle

Three related additions: a chamber filter (House/Senate/All) that lives
on every feed, and two new pages — sponsor volume and sponsor pass
rate.

Build in this order: chamber toggle first (foundational), then volume
page, then pass-rate page. Each can be a separate commit.

---

## 1. Chamber toggle (House / Senate / All)

### URL state

New `?chamber=` param, three values: `house`, `senate`, omitted (= all).

### SQL filter

Add to `buildFeedWhere` (or wherever the shared WHERE builder lives):

```ts
if (chamber === 'house') {
  where.push(`bill_type IN ('hr','hjres','hconres','hres')`);
} else if (chamber === 'senate') {
  where.push(`bill_type IN ('s','sjres','sconres','sres')`);
}
```

### UI

Add a three-segment toggle to the filter row, near the existing stage
and sort dropdowns. Same monospace, same muted styling. Currently
selected segment uses `--accent-amber-bright`.

```
[ALL]  [HOUSE]  [SENATE]
```

Like every other filter, changing the chamber resets `page` to 1. Add
the same `params.delete("page")` treatment that sort, search, and
stage already got.

The toggle applies to `/`, `/watchlist`, `/stale`, `/president`, and
the two new pages below.

---

## 2. `/sponsors` — bills per sponsor (volume chart)

`/sponsors` already exists. Find out what it currently shows; this
handoff probably replaces or restructures it. If the existing version
is a plain list, evolve it into the chart described here.

### Query

```sql
SELECT sponsor_name, sponsor_party, sponsor_state, COUNT(*) AS bill_count
FROM bills
WHERE [chamber filter if set]
GROUP BY sponsor_name, sponsor_party, sponsor_state
ORDER BY bill_count DESC
LIMIT 100
```

### Render

Horizontal bar chart, top 100 sponsors. **Plain CSS bars — no
charting library.** A row per sponsor:

```
RANK  NAME              [████████████████  47]
 1    Smith [R-TX]      [██████████████    42]
 2    Garcia [D-CA]     [████████          28]
 3    Wong [I-VT]       [████              16]
 ...
```

Bar fill width is `(bill_count / max_count) * 100%`. Bar color matches
the sponsor's party (`--party-republican`, `--party-democrat`,
`--party-independent`).

Click a row → link to `/?sponsor={name}` (or however the existing
sponsor filter param works — check the `SearchBox` /
existing sponsor filter wiring; reuse, don't reinvent).

### Filters

Top of page: chamber toggle (from §1). Optional: a topic filter chip
row, same component as the main feed. Skip if it complicates layout —
chamber toggle alone is enough for v1.

### Page header

Title, total count, brief context line. Example:

```
SPONSORS                                    1,461 bills tracked
Top 100 by bills introduced (119th Congress)
```

---

## 3. `/sponsors/pass-rate` — % enacted per sponsor

### Query

```sql
SELECT
  sponsor_name, sponsor_party, sponsor_state,
  COUNT(*) AS total,
  SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted
FROM bills
WHERE [chamber filter if set]
GROUP BY sponsor_name, sponsor_party, sponsor_state
HAVING total >= 5
ORDER BY (CAST(enacted AS REAL) / total) DESC, total DESC
LIMIT 100
```

The `HAVING total >= 5` threshold prevents a sponsor with one enacted
bill from showing up at 100%. Tune later if 5 feels too low or too
high.

### Render

Same horizontal-bar pattern as the volume page, but each row shows the
percentage as the bar and the raw counts as a suffix:

```
RANK  NAME              [██████████████████   62%]   (8 / 13)
 1    Smith [R-TX]      [████████             34%]   (16 / 47)
 2    Garcia [D-CA]     [██                   11%]   (3 / 28)
 ...
```

Bar color = party color. Numbers on the right are `enacted / total`.

### Important caveat to render on the page

We are mid-119th-Congress. Most bills haven't had time to be enacted
or formally fail — they're sitting in committee. A "pass rate" today
isn't a final judgment, just a snapshot. Add a one-line muted note at
the top of the page saying so:

> *Pass rate = bills currently at `enacted` stage. Most bills die in
> committee without a formal vote. Numbers stabilize after the
> Congress ends.*

### Filters

Chamber toggle (from §1). Same threshold control optional —
hardcoding `>= 5` is fine for v1.

---

## Where to link from

Add `PASS RATE` (or similar) to the header nav next to `SPONSORS`. The
existing `SPONSORS` link continues to point at `/sponsors`. New link
points at `/sponsors/pass-rate`.

Use a leading icon for the new link, same convention as `👥 SPONSORS`,
`✒ DESK`, `★ WATCHLIST`. Reasonable choice: `📊 PASS RATE` (or `▤`
or `%`). Code's call.

---

## No new dependencies

Per `SKILL.md`: don't introduce a charting library. Plain divs with
`width: X%` and the existing CSS color variables are enough for these
horizontal bars. If something more is genuinely needed later (stacked
bars, line charts), we'll discuss adding Recharts then.

## Cost note

These are pure aggregation queries — no LLM calls, no external API
hits. Free.

## Verify

- `?chamber=house` shows only HR / HJRES / HCONRES / HRES bills on the main feed; `?chamber=senate` shows only S / SJRES / SCONRES / SRES; absent shows all.
- Toggle persists across pagination but resets to page 1 when changed.
- `/sponsors` shows top 100 by volume with party-colored bars and clickable rows.
- `/sponsors/pass-rate` shows top 100 by pass rate (min 5 bills), with the caveat note visible above the chart.
- Both new pages respect the chamber toggle.
- The new nav link appears in the header next to `SPONSORS` and routes correctly.
- No console errors, no type errors, no new packages in `package.json`.
