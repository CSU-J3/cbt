# HO 243 — Trends: calendar-axis introductions TIMELINE

## Why

`/trends`' introductions-over-time view (`BillsTimeSeries`, HO 66) bins by sequential month with no calendar spacing, year boundary, or partial-month treatment. Add a calendar-accurate total-introductions line that reads cleanly as an overall-volume trend.

## Resolved premises (verified against live code, 2026-06-13 — don't re-derive)

- **`/trends` stays a Patterns sub-tab.** Not promoted to top nav (confirmed: 7-item nav post-230). This handoff touches the chart only, not the IA.
- **`BillsTimeSeries` is the per-topic temporal chart** — 6 topic-colored series, `SvgLegend`, `TOP_N_TOPICS = 6`, `topicColor`/`topicLabel`. It answers "which topics drive introductions." `TopicMix` (HO 76) is topic-by-chamber, a different cut. **Neither shows total introductions on a true calendar axis**, so the new TIMELINE is a different metric and **sits alongside — keep `BillsTimeSeries`, do not replace it.** (This is Design's own fallback for the different-metric case; the spec's single-amber-line styling confirms it's meant as a distinct chart.)
- **Data scoping:** `getBillsByMonth` returns per-topic monthly counts, auto-scoped to the latest congress via `congress = (SELECT MAX(congress) FROM bills)`, excluding ceremonial bills and bills with NULL `topics`.
- **⚠ Do NOT sum `getBillsByMonth` to get the total.** It drops NULL-topic bills, so the sum undercounts. The TIMELINE needs its own `COUNT(*)` query on the **same universe** as `getBillsByMonth` so the line equals the envelope of the per-topic chart and the two read coherently side by side.
- **SVG primitives:** only `SvgGridY` and `SvgLegend` exist — **no divider primitive.** Hand-roll the year divider to match `LawsEnactedComparison`'s dashed vertical `<line strokeDasharray="3 3" />`. (`LawsEnactedComparison` is a week-of-session axis — `FULL_TERM_WEEKS = 104` — so reuse its dashed-rule *visual*, not its axis logic.)

## Changes

1. **New query** (e.g. `getIntroductionsByMonth`): same WHERE as `getBillsByMonth` minus the topic dimension —
   ```sql
   SELECT substr(introduced_date, 1, 7) AS month, COUNT(*) AS n
   FROM bills
   WHERE introduced_date IS NOT NULL
     AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
     AND topics IS NOT NULL
     AND congress = (SELECT MAX(congress) FROM bills)
   GROUP BY month
   ORDER BY month
   ```
   `unstable_cache`, tag `"bills"`.

2. **New component** (e.g. `BillsIntroTimeline`), hand-rolled SVG per house convention, reusing `SvgGridY`:
   - **X-axis:** true calendar months, Jan 2025 → current month, **proportionally spaced** (not sequential bins — a gap month must show as a gap). Reuse the existing `"Mon 'YY"` label format.
   - **Year divider:** dashed vertical rule at the Dec 2025 → Jan 2026 boundary, labeled with the year, matching `LawsEnactedComparison`'s `strokeDasharray="3 3"`.
   - **Partial-month tail:** the current incomplete month draws with a dashed final segment + hollow end point + a "partial" label, so it doesn't read as a real drop.
   - Single `--accent-amber-bright` line, filled points; styled to match the Reports comparison chart.

3. **Placement on `/trends`:** TIMELINE first (overall volume — the headline), then `BillsTimeSeries` (per-topic composition), then `TopicMix` (by chamber). Order is adjustable; flag if you want a different stack.

No COMPARE overlay. The 118-vs-119 comparison stays on `/reports` (`LawsEnactedComparison`); a true intro-vs-intro overlay would need a 118th-introductions backfill, which Design ruled not worth it.

## Constraints

Static. Hand-rolled SVG. No new tokens. Named `git add`, eyeball before commit.

## Commit

One commit, e.g. `feat(trends): calendar-axis introductions TIMELINE alongside the per-topic chart`.
