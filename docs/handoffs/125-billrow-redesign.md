# 125 — BillRow redesign per image 2 mockup

## What this is

`BillRow` is the most-repeated UI element in the app. The image 2 mockup you reviewed earlier embodies the OTX-inspired readability principles in one concrete redesign:

- Vertical colored bill-id rail (type stacked above number) instead of horizontal `HR 1234` prefix
- Title in larger, more readable type with clearer hierarchy against the metadata
- Two stage pills with time-since (e.g. `INTRODUCED · 9MO AGO` then `→ COMMITTEE · 1D AGO`) instead of a single current-stage indicator
- Inline summary excerpt instead of click-to-expand as the primary affordance
- Sponsor on its own line with party color, cosponsor count, topic tags inline
- Explicit `View Detail →` link rather than expand-toggle as the primary detail surface

The change propagates to every surface that renders `BillRow`: `/`, `/feed` (if separate), `/stale`, `/watchlist`, `/members/[bioguideId]` (HO 79's bills block), and possibly `/changes` depending on whether the activity feed uses `BillRow` or a different row variant.

Multi-layer: data layer audit (stage transition timestamps), component refactor, every consumer page, design tokens for the new pill fills. Phase 1 verifies data exists and audits all consumers. Phase 2 builds the new `BillRow` and rolls it through.

Prior art:
- HO 23 / 40 — BillRow lineage and the flag-bills readability pass
- HO 43 — stage-changes table (the timestamp data the time-since pills need)
- HO 79 — voting record block on member hub (consumes BillRow indirectly)
- HO 118 — NewsRow companion (same row family, different content)
- HO 123 — tooltips already cover bill-type, topic codes, stage names; they should keep working

This is the anchor for the design-language pivot. If it lands well, subsequent surfaces (image 1 home reorganization with TOP STALLS, `/search` tabs, `/patterns` bubble cluster) inherit the vocabulary. If it doesn't, we learn fast on one component and pivot.

## Phase 1 — Diagnostic (HALT for sign-off)

### A. Stage transition data

The two-pill `INTRODUCED · 9MO AGO → COMMITTEE · 1D AGO` design needs both current stage AND previous stage with timestamps:

- Does a `stage_changes` (or similar) table exist per HO 43? Schema?
- For a typical bill in the corpus, can we cheaply derive timestamps of the last two stage transitions, or only the most recent one?
- Query cost of joining stage_changes into the feed query for 50 bills per page. If expensive, propose denormalization (e.g. `bills.previous_stage`, `bills.previous_stage_at` updated on every transition write).
- "9 MO AGO" implies a relative-time computation. Confirm it's SSR'd at render (no drift inside the cache window) and decide refresh cadence relative to the existing `bills` revalidation tag.

### B. Consumer audit

```
grep -rn "BillRow" components/ app/ --include="*.tsx"
```

Expected consumers:
- `app/page.tsx` or `app/feed/page.tsx` (main feed)
- `app/stale/page.tsx`
- `app/watchlist/page.tsx`
- `app/members/[bioguideId]/page.tsx`
- Possibly `app/changes/page.tsx`
- Possibly `app/bill/[id]/page.tsx` for a related-bills sidebar

For each consumer, confirm whether it wants the full new design (image 2) or a stripped-down compact variant. A related-bills sidebar probably wants one-line compact, not the full mockup. The activity feed on `/changes` may need its own variant if it's structurally different.

### C. Expand pattern decision

Current `BillRow` has expand-to-reveal showing a `SponsorExpandedPanel`-style content block. Image 2 replaces this as the primary affordance with inline summary + `View Detail →`.

Two paths to choose between:

1. **Keep expand for power users, demoted.** Small disclosure indicator on the row; inline content is the primary surface. Expanded panel still shows deeper stuff (full stage history, cosponsor list, vote results).
2. **Drop expand entirely.** Detail behavior moves to `/bill/[id]` exclusively. Cleaner but removes a fast-scan pattern some users may rely on.

Phase 1 picks one with rationale, factoring in what content the expand currently shows and whether `/bill/[id]` already covers it.

### D. Stage pill spec

The mockup shows two pills: `INTRODUCED · 9MO AGO` then `→ COMMITTEE · 1D AGO`. Specify:

- Always two pills (previous + current), or one when there's no transition history (e.g., a brand-new INTRO-only bill)?
- For bills further along (currently FLOOR with COMMITTEE and INTRODUCED in history), show last-two or condense to current-only + "had N earlier stages"?
- Color treatment: background fill, border, text color. Should match HO 123's existing stage tooltip vocabulary so a hover still reads naturally.
- Time-since format: `9MO AGO` (terminal-style abbreviated) vs `9 months ago` (prose) vs `9mo` (terse). Match existing CBT conventions if any; otherwise propose.

### E. Bill-id rail spec

Vertical rail showing bill type stacked above number (e.g. `HR` / `1234`). Specify:

- Color source: today's topic-based tint, or a new chamber-based color (House blue, Senate red, joint resolution amber)?
- Width and visual prominence — how dominant is the rail in the row's left edge?
- Interaction with the watch/star indicator from the existing row

### Report format

Post findings in chat. Sections:

1. Stage transition data state (exists, partial, missing). If missing, decide whether to scope expansion in this handoff or split to a follow-up.
2. Consumer list with full-vs-compact variant decision per consumer.
3. Expand pattern decision with rationale.
4. Stage pill detail proposal.
5. Bill-id rail detail proposal.
6. Proposed Phase 2 scope: file paths, component split, token additions, data layer changes if needed.

### HALT

Stop here. Wait for sign-off on Phase 2 before implementing.

## Phase 2 — Implementation (after Phase 1 sign-off)

Shape depends on Phase 1. General target:

### Component split

Likely sub-components, each in its own file under `components/`:

- `BillIdRail` — vertical type + number block with color treatment
- `StagePillStrip` — two-pill transition display with time-since
- `BillSponsorStrip` — sponsor name + party + state + cosponsor count + topic tags
- `BillRow` — composition of the above with title + summary excerpt + `View Detail →` link

Type-safe props derived from the existing Bill type plus the new stage history join.

### Design tokens

New tokens in `app/globals.css`:

- `--pill-bg-current` — fill for the current stage pill
- `--pill-bg-previous` — fill for the previous stage pill (lower contrast)
- `--rail-bg-house` / `--rail-bg-senate` / `--rail-bg-joint` (if chamber-colored) or topic-tinted variants

### Data layer

If Phase 1 finds stage history isn't query-friendly, denormalize: `bills.previous_stage` + `bills.previous_stage_at` columns, updated on every stage transition write in `lib/sync.ts`. Backfill once from the existing `stage_changes` table.

### Page updates

Each consumer from Phase 1's audit gets the new `BillRow` (full or compact variant per spec). The `/changes` activity row may stay distinct if it's structurally different.

### Verification

1. Visual: rows on each consumer page render the new layout cleanly. Spot-check `/`, `/stale`, `/watchlist`, a `/members/[bioguideId]` page with bills.
2. Stage pills: time-since renders correctly for a bill with known history (e.g. an HR you've been tracking).
3. Expand pattern (if surviving): toggle works and shows expected content.
4. `View Detail →` lands on the correct `/bill/[id]`.
5. Responsive: spot-check a narrower viewport. The new row is taller per item; pagination math may shift.
6. Type-check clean.
7. HO 123 tooltips still apply to bill type, topics, and stages on the new layout.

## Out of scope

- `/bill/[id]` page redesign (separate handoff if it wants polish)
- `NewsRow` (different component, different content; HO 118 already handled its dedup)
- Search page tabbed entity results (image 2's tab bar — separate handoff)
- `/patterns` bubble cluster (separate handoff)
- Image 1 home reorganization with TOP STALLS quadrant (separate handoff, follows naturally from this one)
- Member-hub layout beyond the bills block

## Acceptance

1. Phase 1 report posted with all six sections.
2. Sign-off obtained.
3. Phase 2 implemented per sign-off.
4. New `BillRow` renders correctly on every consumer page identified in the audit.
5. Stage pills show accurate time-since values based on stage transition history.
6. Type-check clean, working tree clean, pushed.
7. Commit: `feat: BillRow redesign per image 2 mockup (HO 125)`

## Notes

- HO 43's stage-changes table is the linchpin. If Phase 1 finds it doesn't capture per-transition timestamps, the data layer step gets heavier. The conservative budget assumes the data exists and is queryable.
- Mobile: the new row is taller. Responsive behavior at narrow viewports may need attention. Worth a Phase 2 verification step but not blocking for desktop ship.
- HO 123's tooltips apply automatically since the codes (bill type, topic codes, stage names) are unchanged. Tooltip placement on the new vertical rail and stage pills may need small adjustments — flag if any in Phase 1.
- If Phase 1's expand-pattern decision is "drop entirely," confirm in chat sign-off that `/bill/[id]` already covers everything the expand currently shows. Don't strand functionality.
