# 148 — Click-to-expand row (inline accordion)

## What this is

Spec 4 (#5) from the design session: the feed row becomes a click-to-expand inline accordion. Whole-row click toggles an expanded panel below the row, single-open, chevron affordance, with the LLM summary, a meta grid, related-news rows, and action chips inside the panel. Codes in the panel carry the HO 147 tooltip primitive.

This pattern is the spine for specs 5, 7, and 8 (the feed restructure, the members list, and the cleanup audit all reuse it), so it ships as a clean, reusable expand behavior on the full `BillRow` before those surfaces consume it.

**This reverses an HO 125 decision, and that's intentional.** HO 125 moved the BillRow *away* from click-to-expand — it made the inline summary excerpt plus `View Detail →` the primary affordance and demoted or dropped expand. Spec 4, produced by the design project this session, moves back to expand-as-primary with the summary inside the panel. The design language matured; this is a conscious evolution, not a regression. But it means the collapsed row almost certainly changes (likely loses its inline summary), and Phase 1 must surface exactly what changes so the reversal is deliberate.

## Phase 1 — Diagnostic (HALT for sign-off)

Read real artifacts, post findings, stop. No implementation.

### A. HO 125 ground truth + summary reconciliation (load-bearing)

Read the current `BillRow` (and its sub-components from HO 125's split — `BillIdRail`, `StagePillStrip`, `BillSponsorStrip`, or whatever actually shipped). Report:

- What HO 125 decided on the expand pattern: kept-but-demoted, or dropped entirely? Is there any expand/disclosure code left in `BillRow` today, or is it pure inline + `View Detail →`?
- Does the collapsed row currently render an inline summary excerpt? If so, where and how long.
- Spec 4's collapsed row is title + mono meta line (bill ID · stage transition · sponsor · topics) + star — **no inline summary**, because the summary moves into the expanded panel. So adopting spec 4 means removing the inline excerpt from the collapsed state. Confirm that's the reconciliation, or propose an alternative (e.g. keep a one-line teaser collapsed, full summary expanded) and flag the duplication tradeoff. **This is the decision I most need signed off before Phase 2.**

### B. Consumer audit

```
grep -rn "BillRow" components/ app/ --include="*.tsx"
```

For each consumer, decide whether it gets the expand behavior:

- **Feed (full `BillRow`)** — yes, this is the target surface.
- **Compact variant** (ActivityTicker, the HO 132.1 drawer body) — no. Compact rows stay link-only; expand is a feed-surface behavior. Confirm the compact variant is a separate component/prop so the expand can be gated to the full row.
- `/stale`, `/watchlist`, `/members/[bioguideId]` bills block, `/changes` — decide per consumer. Default: surfaces that render the full `BillRow` inherit expand; compact/sidebar contexts don't. Flag any consumer where expand would fight the layout.

### C. Expanded-panel data availability + load strategy

The panel renders only sections that have data. Confirm each source exists and report query cost:

- **Summary** — the LLM summary already on the `Bill` type. Confirm.
- **Meta grid** — SPONSOR, COSPONSORS (with party split), COMMITTEE, INTRODUCED, LAST ACTION. Sponsor/cosponsor/dates are on the bill record; COMMITTEE comes from HO 145's `getBillCommittees(billId)`. Confirm whether the party split for cosponsors is cheaply available or needs a join.
- **Related news (N)** — per-bill rows from the news_mentions pipeline (HO 64/86/111). Confirm the helper (`getBillNews(billId)` or similar) and that it returns headline + source + date. Omit the section when zero.
- **Action links** — `full bill page →` (to `/bill/[id]`) and `congress.gov ↗` (external). Confirm the canonical congress.gov URL is derivable from the bill record.

**Load strategy decision:** is all panel data already present in the feed query (so the panel pre-renders hidden, cheap to toggle), or does some of it — news, committees — require extra joins that would bloat the 50-rows-per-page feed query? If the latter, propose lazy-loading the panel on first expand versus widening the feed query. Report the tradeoff; don't pre-decide.

### D. URL-state coexistence

The feed already carries several params. Audit them (`?stage=`, `?topics=`, `?page=`, `?q=`, `?sponsor=`, and note the drawer's singular `?topic=` from HO 132.1). Confirm `?open=<billid>` slots in without clobbering any of them, and that opening/closing a row updates only `open`. Decide whether URL sync is in Phase 2 or deferred — it's optional per spec. If in, single-open means `open` holds one bill ID at a time; back button should collapse.

### E. Two-pattern split confirmation

Confirm HO 132.1's bubble drawer shipped and stays as-is. The deliberate split: dashboard bubbles → slide-out drawer (compact rows), feed rows → inline accordion (full rows). This handoff doesn't touch the drawer. One sentence confirming the split is intact is enough — no deep audit.

### F. Click-through elements

Whole-row click toggles, but the star (WatchStar, HO 127) and any links inside the row must not toggle. Confirm the current event structure so Phase 2 wires `stopPropagation` (or equivalent) correctly. HO 127's note that the star lives as a sibling of the row link, not inside it, is the relevant prior art — verify it still holds.

### Report format

1. HO 125 expand ground truth + the collapsed-row summary reconciliation proposal.
2. Consumer list with expand yes/no per consumer.
3. Panel data sources confirmed + load-strategy recommendation.
4. URL-state audit + `?open=` in-Phase-2-or-deferred recommendation.
5. Two-pattern split confirmation.
6. Click-through wiring findings.
7. Proposed Phase 2 scope: files, component shape, any token additions.

### HALT. Wait for sign-off.

## Phase 2 — Implementation (after sign-off)

Shape follows Phase 1. General target:

### Collapsed row

Per spec 4 and Phase 1's reconciliation: stage-colored left rail, title (sans), mono meta line (bill ID · stage transition · sponsor · topics), star right, chevron marking expandability. Whole-row click toggles. Star and links click through without toggling.

### Expanded panel (`--bg-row-hover` background)

Renders only sections with data:
- **Summary** — LLM summary, sans `--text-secondary`.
- **Meta grid** — mono label/value pairs: SPONSOR, COSPONSORS (party split), COMMITTEE, INTRODUCED, LAST ACTION.
- **Related news (N)** — headline + source + date rows, mini-BREAKING style; omitted if none.
- **Action links** — `full bill page →`, `congress.gov ↗` as bordered mono chips in `--accent-amber`.
- Codes in the panel use the HO 147 `Tooltip` component (term variant). Content from `lib/enums.ts` / `lib/topic-colors.ts` (the real label locations HO 147 found, not `lib/labels.ts`).

### Interaction

- Single-open: opening a row closes any other open row.
- Chevron `▸` rotates 90° on open, instant, no transition (static principle from HO 147).
- Static reveal — panel appears below, pushes rows down. No slide animation.
- Optional `?open=` URL sync per Phase 1 decision.

### Tokens

Reuse existing. `--bg-row-hover` for the panel background is already in the system. No new color vars expected; flag if the chevron or chip styling needs one.

## Out of scope

- The HO 132.1 bubble drawer. Untouched.
- `NewsRow` / the news-led row pattern (that's spec 5's NEWS mode, reusing HO 69/118). Separate handoff.
- Compact BillRow variant expand. Compact stays link-only.
- Mobile touch behavior (tap-to-open, tap-elsewhere-to-close). Deferred to the #15 mobile pass per every design spec.
- The full feed restructure (BILLS|NEWS toggle, filter bars). That's HO 151 / spec 5; this just makes the row expandable.
- Any new motion beyond the chevron rotate and existing cursor blink.

## Acceptance

1. Phase 1 report posted with all six sections; collapsed-row summary reconciliation and load strategy signed off before Phase 2.
2. Feed rows expand on whole-row click; single-open enforced; chevron rotates instant.
3. Star and in-row links click through without toggling the row.
4. Expanded panel renders only data-bearing sections; news section omitted when a bill has no mentions.
5. Codes in the panel show HO 147 tooltips.
6. Compact variant (ticker, drawer) unaffected and still link-only.
7. `?open=` behavior matches the Phase 1 decision (in or deferred), without clobbering existing feed params.
8. `npm run typecheck` and `npm run build` clean.
9. `SKILL.md` updated with the expand pattern, single-open rule, and the collapsed-row change from HO 125.
10. Single commit: `feat: click-to-expand feed row (HO 148)`.

## Notes

- **Why reverse HO 125.** HO 125 bet that inline summary beat click-to-expand for scan-ability. The design project, iterating on the OTX reference, landed on expand-as-primary because the collapsed row reads cleaner as a dense scannable line (title + meta only) with detail one click away, and the panel can hold richer content (news, meta grid) than an inline excerpt ever could. The reversal is the design language settling, and it's worth stating in the commit so the git history explains why the row flipped twice.
- **Load strategy is the perf-sensitive call.** Pre-rendering hidden panels for 50 rows is fine if the data's already in the feed query, wasteful if it forces news + committee joins per row. Lazy-load on first expand is the safer default if those joins are heavy. Phase 1's query-cost finding decides it.
- **`lib/labels.ts` does not exist.** HO 147 found the real label maps in `lib/enums.ts` (bill type, stage, race) and `lib/topic-colors.ts` (topic). Reference those.
- **Single-open is a deliberate constraint.** Multi-open accordions on a 50-row feed turn into a wall of expanded panels and lose the scan benefit. One panel at a time keeps the feed legible.
