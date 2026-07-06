# HO 428 — Polarization over time (ideology, ship 3 of 3) + shared SVG scaffold

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 428 (427 = the polarization-history data layer, `e0601dc`). If HEAD moved, renumber.
>
> **Code only. Docs deferred** to the arc-closing sweep (which also carries 427's items and the King/Sanders oddity correction). Don't touch `docs/` or `SKILL.md`. Spec-driven: propose the plan, wait for review, show each diff, no auto-commit. `git add` by explicit pathspec, ancestry re-checked before push.
>
> **Two commits, separated:** (A) the refactor — extract the shared SVG scaffold and retrofit the three existing charts onto it; (B) the feature — the over-time chart on that scaffold. A three-live-chart migration does not ride inside the new feature's diff.

The last surface in the ideology arc, and the fourth live hand-rolled SVG chart, so the standing "extract the shared primitives at the fourth chart" trigger fires here. Mockup: `ideology-polarization-over-time.html`. Data landed at HO 427.

## Grounding — what's settled (don't re-derive)

- **`polarization_history` is live** (HO 427): `(congress, chamber, dem_median, rep_median)`, lowercase chamber, 190 rows, 95 Congresses/chamber, two-party series from the 34th (1855). Caucus-based (`party_code` 100/200). The 119th reconciles to the band at 0.000 delta (Kiley is the only differing member and doesn't move a median).
- **The caucus/registration seam is already decided:** the historical **line runs through the 118th** from `polarization_history` (caucus); the **current point is a live dot from `getPolarizationBand`** (registration). They agree to three decimals, so the seam doesn't render, and the 119th is never plotted by two party rules.
- **Three existing SVG charts** re-declare their own `viewBox`/`PAD`/axis-tick/legend scaffolding: `BillsTimeSeries`, `CommitteeActivityChart`, `IdeologyStrip`. This chart is the fourth.

## Commit A (refactor) — extract the shared SVG scaffold

Extract the boilerplate common to the three existing SVG charts into a shared module: the `viewBox`/`PAD` constants, gridline + axis-tick rendering (lines plus mono-font tick labels), the legend markup, and the hover hit-layer pattern. Chart-specific rendering (lines, bars, dots, the gap polygon) stays in each chart; the scaffold is the frame, each chart fills it. Design the abstraction against all four charts, including the over-time chart below, so it fits the new one without a fifth re-declaration.

Retrofit `BillsTimeSeries`, `CommitteeActivityChart`, and `IdeologyStrip` onto it. **Eyeball each before/after for zero visual change** — this is a pure refactor of live charts. If one chart's scaffold is too divergent to share cleanly, leave it on its copy and report which, rather than forcing a bad abstraction. If the retrofit proves larger or riskier than a clean refactor once you're in it, stop and say so, and we split it out before touching the live charts.

## Commit B (feature) — the over-time chart

### Query

`getPolarizationHistory()` in `lib/queries.ts`: return all `polarization_history` rows (both chambers, ~190; the component filters by the toggle, no refetch), `{ congress, chamber, demMedian, repMedian }`. Derive `year = 1789 + 2*(congress-1)` here or in the component. Small-table read, no index. `unstable_cache`, daily TTL, tag `member-ideology` (or a `polarization-history` tag; nothing flushes it on a cron either way). The page also reads the existing `getPolarizationBand` for the live current dot.

### Chart (mockup spec, on the extracted scaffold)

- Full-width SVG, x = year (start **1879**, the 46th Congress, the mockup's post-Reconstruction start), y = `dim1` median. Two lines: D median (`--party-democrat`), R median (`--party-republican`). The gap between them shaded faint amber (`--accent-amber`, ~0.07). Emphasized 0 line, y/x gridlines.
- **HOUSE/SENATE toggle**, HOUSE default, client-side (swaps the filtered series and the current dot, no refetch).
- **Historical line renders through the 118th** (ends 2023). The **current-Congress point (2025) is a separate dot pair from `getPolarizationBand`** with the gap bracket labeled with the live gap. Leave the current dot visually distinct from the line's end (it comes from a different, live source); don't line-connect 2023→2025 across the caucus/registration boundary.
- **Midcentury-low guide computed from the real data, per chamber** — find the minimum-gap Congress in `polarization_history` for the selected chamber and place the dashed guide + label there. **Do not hardcode 1961**; the real minimum may differ and differs House vs Senate.
- Header `POLARIZATION OVER TIME · 1879–2025` (amber) + descriptor `party median on dim1 · per Congress`. Footer legend (`DEMOCRAT median · REPUBLICAN median · shaded = the gap`) + source (`Voteview HSall · House/Senate`). Hover a year → both medians + the gap for that Congress.
- **No prose caption.** The curve, the data-derived midcentury-low marker, and the current-gap bracket carry the story, consistent with the other CBT charts. The mockup's prose (the 0.81/0.88 endpoints, the "Republicans moved ~2× as far" asymmetry) was illustrative and its endpoints are wrong (the real 119th is 0.92/0.92); the two lines show whatever asymmetry is real without asserting a number.

### Placement (one call for your plan, not pre-decided)

The mockup and the approved spec put this full-width chart **above the dotplot strip on `/members`**. But stacking ~384px over the strip's ~180px buries the member browser that the strip's 180px was chosen to keep above the fold. Surface this in the plan: **my lean is collapsed-by-default with a toggle** (history on demand, the browser stays reachable) over always-open orientation-first. Show the stacked reality at eyeball time; Corey flips it if he disagrees.

## Deferred (don't do here)

Docs to the arc-closing sweep: the `polarization_history` schema + `sync:polarization-history` chain entry, `getPolarizationHistory`, this chart in the SVG inventory (count goes to four, and the scaffold is now shared), the roadmap note, the backlog tombstone. Plus the items already banked from 427: the King/Sanders `party_code=328` oddity correction, the caucus-vs-registration `polarization_history`-vs-`getPolarizationBand` note, and the QUEUED shared-`median()` extraction.

## Commit discipline

Commit A (refactor): the scaffold module + the three retrofitted charts, each eyeballed unchanged. Commit B (feature): `getPolarizationHistory` + the over-time chart + the `/members` wiring. Explicit pathspec each, ancestry re-checked before push. Eyeball the new chart (both chambers via the toggle, the data-derived midcentury low, the live current dot matching the band, hover) and re-confirm the three retrofitted charts render unchanged. Show both diffs, no auto-commit.

## Report back

The rendered over-time chart (both chambers, the midcentury low it found per chamber, the current dot vs the band), confirmation the three retrofitted charts are visually unchanged (or which one stayed on its copy and why), the placement decision the plan used, both diffs, and confirmation `docs/` and SKILL are untouched.
