# 72 — Competitive races block on the home dashboard

## What this is

Handoff 71 shipped Cook ratings into `race_ratings`, including the `getMostCompetitiveRaces(cycle, limit)` query helper. Nothing surfaces it yet. This handoff adds a small block to the home dashboard that renders the most competitive 2026 races right now — toss-ups first, leans second, click-through to `/race/[id]`.

Tiny scope. One new component, one home-page edit, one CSS block. No schema, no pipeline, no new query. The framing question gets an electoral-context anchor next to its legislative one.

## In scope

- New `CompetitiveRacesBlock` server component
- Place it on the home dashboard (`app/page.tsx`)
- New `.competitive-race-row` CSS grid in `globals.css`
- Reuses `RatingChip` from handoff 71

## Out of scope

- House and Governor ratings (separate small handoff; only 35 Senate rows exist in `race_ratings`)
- Sabato and Inside Elections sources (separate handoff to layer in)
- A dedicated `/races` index page (different sub-page, future)
- Multi-source consensus calculation across raters
- Live polling, fundraising, or any other race detail (the block links out for that)

## Component spec

`components/CompetitiveRacesBlock.tsx`. Server component.

```ts
export async function CompetitiveRacesBlock({
  cycle = 2026,
  limit = 8
}: {
  cycle?: number;
  limit?: number;
}) {
  const races = await getMostCompetitiveRaces(cycle, limit);
  if (races.length === 0) return null;
  // …
}
```

Hide the block entirely if zero rated races exist. Same pattern as `BreakingNewsBanner` — empty dashboards don't get placeholder shells.

### Rendering

Header line in `--accent-amber`, 12px uppercase, letter-spacing 0.5px:

```
COMPETITIVE RACES · 2026
```

Right-aligned secondary text shows the count of rated races at the limit cap: `8 SHOWN`. No "view all" link — there's no races index page yet. Add it later when the destination exists.

Below the header: `limit` rows of `.competitive-race-row`. Grid:

```
60px       — race ID column (S-OH-2026 → "OH SENATE", S-FL-2026 → "FL SENATE")
1fr        — incumbent name + party
40px       — chamber chip (`SEN`)
180px      — rating chip(s) — use existing RatingChip; if multiple sources, render inline with `·`
```

For now (Cook-only), one chip per row. When Sabato + Inside Elections land later, the cell auto-renders multiple.

The race-ID column displays the human-readable form, not the raw `S-OH-2026`. Helper:

```ts
function formatRaceLabel(raceId: string): string {
  // S-OH-2026 → "OH SENATE"
  // H-CA-22-2026 → "CA-22 HOUSE" (handles future house ratings)
  // G-OH-2026 → "OH GOVERNOR" (future)
}
```

If `getMostCompetitiveRaces` doesn't already return incumbent data joined from the `races` table, extend it to do so — the dashboard needs the name visible without a second fetch per row. If incumbent data isn't in the races table yet (handoff 62 might have stubbed races without incumbents), render the race label only and leave the name column empty. Don't crash, don't show "Unknown."

Row click navigates to `/race/${raceId}`. Use a `<Link>` element on the entire row. Hover state: `--bg-row-hover` background.

If `/race/<id>` doesn't yet render for a given race (e.g. handoff 62's stub coverage was partial), that's a known gap — don't try to disable navigation here. The clicker lands on whatever the race page returns; better to surface gaps than silently hide rows.

### Sort and tie-breaking

`getMostCompetitiveRaces` already returns rows sorted by `ABS(rating_score) ASC, updated_at DESC` — toss-ups first, then leans. Display in that order. Don't re-sort client-side.

With 35 Senate rows and 4 toss-ups (ME, MI, OH-SP, plus whichever the latest update placed), expect:

```
OH SENATE      [interim Husted]    SEN   [COOK · TOSS UP]
ME SENATE      [Collins]           SEN   [COOK · TOSS UP]
MI SENATE      [retiring]          SEN   [COOK · TOSS UP]
NH SENATE      [retiring]          SEN   [COOK · LEAN D]
GA SENATE      [Ossoff]            SEN   [COOK · LEAN D]
NC SENATE      [retiring]          SEN   [COOK · LEAN D]
AK SENATE      [Sullivan]          SEN   [COOK · LEAN R]
IA SENATE      [retiring]          SEN   [COOK · LIKELY R]
```

(The 8th row spills into Likely R because that's the next-most-competitive after 7 toss-ups + leans.)

## CSS

Add to `globals.css` near the other row classes:

```css
.competitive-race-row {
  display: grid;
  grid-template-columns: 100px 1fr 40px 180px;
  align-items: baseline;
  column-gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-soft);
  font-size: 13px;
}

.competitive-race-row:hover {
  background: var(--bg-row-hover);
}

.competitive-race-row .race-label {
  font-size: 12px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.competitive-race-row .chamber-chip {
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  text-transform: uppercase;
}

@media (max-width: 700px) {
  .competitive-race-row {
    grid-template-columns: 100px 1fr 120px;
  }
  .competitive-race-row .chamber-chip {
    display: none;
  }
}
```

Mobile drops the chamber chip column. The rating chip column shrinks; the chip itself already handles a narrower render via the `size='sm'` prop on `RatingChip` from 71. Use `size='sm'` here regardless of viewport — the block is dense by design.

## Home dashboard placement

`app/page.tsx`. Place `<CompetitiveRacesBlock />` below the existing dashboard blocks (LLM lead, stage funnel, topic mix, time-series chart, scatter) but above the breaking news banner if that's currently at the top, or below it if it's at the top. The order that makes sense:

1. LLM lead (the day's three-sentence summary)
2. Breaking news banner
3. Stage funnel + topic mix
4. Time-series chart
5. **Competitive races block** ← new
6. Sponsor scatter (if currently on home)

Rationale: legislative signal first (what's moving through Congress right now), electoral context second (what's at stake in November). The framing question is primarily about Congress's current work; race ratings are a layer of "and here's where the political pressure is coming from."

If the existing order doesn't match this exactly, place the block somewhere reasonable and don't reorganize the page. The IA decision is "competitive races appears on the home dashboard," not "everything gets resorted."

## Acceptance

1. `/` renders the new block with 8 rows when Cook ratings are seeded.
2. Top 3 rows are toss-ups (rating in `--accent-amber-bright`), next rows are leans (party color).
3. Clicking a row navigates to `/race/<raceId>` for that race.
4. With no ratings in the DB (e.g. on a fresh local before seeding), the block renders nothing — no error, no empty shell.
5. Mobile (`< 700px`): chamber column hidden, rating chip remains visible.
6. The `8 SHOWN` count line correctly reflects the configured limit when fewer than `limit` rated races exist (e.g. `4 SHOWN` if only 4 toss-ups + leans exist).

## Don't

- Don't add filters to this block. It's a glance surface, not a workspace.
- Don't expand the block to show ratings from other sources before those sources are seeded. A second chip per row only appears when a second source has data, naturally.
- Don't add a "view all races" link until a races index page exists. Dead links are worse than missing links.
- Don't compute consensus scores across sources here. That's a query-layer decision, not a UI decision.
- Don't paginate. If the user wants more than 8, the future races index page handles that.
