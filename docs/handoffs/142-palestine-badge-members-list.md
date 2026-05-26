# 142 — Palestine grade badge on /members row list

## What this is

Extends the Palestine grade badge from HO 138 to the `/members` row list. The HO 138 scope was hub-header-only with a recommendation to keep it off the row list; Corey is overriding that after seeing the hub badge live.

The badge component, color tier, tooltip vocabulary, and data layer all stay identical to HO 138. This is purely a placement add.

Stays out of `BillRow` sponsor expansion — that's a separate decision if it comes up.

## Prior art

- **HO 138** — Palestine badge component, color tier, tooltip pattern, hub placement
- **HO 90** — `palestine_scorecard` table + `getPalestineScorecard()` query
- **HO 61** — caucus badge precedent for row-level chip rendering
- **HO 89** — `/sponsors` → `/members` rename, current row component shape

## In scope

- Render `PalestineBadge` on each `/members` row for members with a scorecard row (~47 Senate Dems)
- Members without a scorecard row render nothing — no placeholder chip, no reserved column width
- Reuse the existing `PalestineBadge` component and `PALESTINE_GRADE_CONFIG`
- Tooltip vocabulary identical to the hub-header rendering
- Sort/filter behavior unchanged — this is display only
- SKILL.md update: extend the badge-surface note to include the row list

## Out of scope

- `BillRow` sponsor expansion. Separate scope if it comes up
- New sort/filter on Palestine grade. Display only
- Schema changes, sync changes
- Restyling the row layout. The badge slots into the existing row chrome
- Cron-wiring `sync:palestine` (still deferred from HO 90)
- Changing the hub-header rendering — that stays as HO 138 shipped it

## Phase 1 — Diagnostic (small, single read)

No halt. Single read to confirm the row component file and the right slot for the badge. Post the finding + one pick, then proceed.

### Required reads

1. **`app/members/page.tsx`** — current row component name + the page-level query that returns member rows. Confirm whether `palestine_scorecard` data is already joined into that query or needs to be added
2. **The row component itself** (likely `components/MemberRow.tsx` or similar) — current layout, where the name renders, where caucus badges currently sit if at all

### Single pick

**Badge slot on the row.** Recommend: render the badge inline with the name, after caucus badges (matching hub-header order). Same chip chrome (12px uppercase, colored border + text on transparent background, `var(--vote-nay)` for D/F, `--accent-amber` for C, `--text-secondary` for A/B). If Phase 1 finds the row is dense enough that an inline chip would crowd the name, fall back to a dedicated `.row-palestine` slot at the right edge of the row with right-alignment — flag in Phase 1 if needed.

If the query needs extending to include `palestine_scorecard` data, do that in Phase 1's diagnostic confirmation (one extra LEFT JOIN, no Phase 2 surprise).

## Phase 2 — Implementation

Shape depends on Phase 1 finding. Sketch:

```tsx
{member.palestineGrade && isPalestineGrade(member.palestineGrade) && (
  <PalestineBadge
    grade={member.palestineGrade}
    rank={member.palestineRank}
  />
)}
```

Render position confirmed by Phase 1.

The query helper for the `/members` page extends to LEFT JOIN `palestine_scorecard` and projects `grade` + `rank`. Members without a scorecard row return null on both — the badge component's null check handles the rest.

## Verification

1. `/members` row for Sanders (`S000033`) renders the `A` chip in muted color
2. `/members` row for Bennet (`B001267`) renders the `F` chip in rose
3. `/members` row for Thune (any Republican senator) renders no chip
4. `/members` row for any House member renders no chip
5. Hub header at `/members/[bioguideId]` still renders the badge per HO 138 (unchanged)
6. Hover tooltip matches the hub vocabulary: `"USCPR Palestine scorecard: F (rank #3 of 47)"`
7. Sort/filter controls work unchanged
8. Mobile breakpoint — the chip doesn't break row layout at narrow widths
9. Type-check clean, no console errors

## Acceptance

1. Phase 1 read posted with row component confirmation + query-extension confirmation + the single slot pick
2. All 9 verification items pass
3. SKILL.md updated: badge surface now covers hub header + `/members` row list
4. Type-check clean, working tree clean, pushed
5. Commit: `feat(members): Palestine grade badge on row list (HO 142)`

## Don't

- Don't extend the badge to BillRow sponsor expansion in this handoff. If that's wanted, it's a separate scope decision
- Don't reserve column width for non-graded members. Absence of badge is the signal — same as the hub
- Don't change the `PalestineBadge` component itself. Pure reuse
- Don't change row sort/filter behavior
- Don't add a new badge color or token. The three-tier color (vote-nay / amber / text-secondary) is locked
- Don't fetch `palestine_scorecard` per-row. Single query at the page level, LEFT JOIN

read docs/handoffs/142-palestine-badge-members-list.md and follow
