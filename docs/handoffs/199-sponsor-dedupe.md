# HO 199 — Dedupe sponsor aggregation at the query + audit all consumers

## Why

HO 197 surfaced a real data bug: `getSponsorProductivity` splits **one member into two rows** when their bills carry two `sponsor_name` variants under a single `bioguide_id`. Confirmed case: Nick Begich (bioguide `B001323`) → "Nicholas J." (27 bills) + "Nicholas" (7 bills) = two dots / two rows for one person.

Root cause (confirmed): the query does `GROUP BY b.sponsor_bioguide_id, b.sponsor_name, b.sponsor_party, b.sponsor_state, …` — grouping on the **denormalized `sponsor_name`**, so a member whose bills carry two name spellings under one bioguide splits.

HO 197 made the *scatter* handle it gracefully (per-point labeling + one-label-per-member guard), but that's a band-aid on one consumer. **The fix is at the query: group by the stable `bioguide_id`, resolve the display name/party/state from the canonical `members` row (not the denormalized bill fields), and audit every consumer of the sponsor-aggregation shape.** The scatter tolerates the split; the ranked LIST does not (it would show a member twice, with split counts).

## Scope: query-level dedupe, then consumer audit — NOT a per-consumer patch

The framing is deliberate: **dedupe at the source, audit all consumers**, not "fix each surface." The scatter already copes; other consumers (the members ranked list especially) will double-count or double-list. One correct fix at the query beats N band-aids.

## Phase 1 — Diagnostic (HALT after)

1. **The canonical query.** Read `getSponsorProductivity` (~queries.ts:578) and report its exact GROUP BY + SELECT. Confirm grouping on `sponsor_name` (denormalized) is the split cause, and that `bioguide_id` is the stable key. Report how to regroup: `GROUP BY sponsor_bioguide_id` alone, resolving name/party/state via a `JOIN members` (the canonical row) — mirroring the pattern other helpers use (`getSponsorProductivity` already LEFT JOINs `members` for `chamber` per SKILL; extend it to source the display fields from there too). Report whether any member has bills with NO bioguide (then `sponsor_name` is the only key — how to handle that residual: keep name-grouped only for null-bioguide, or drop).

2. **Consumer audit (the core of this handoff).** Find EVERY consumer that aggregates/groups on denormalized sponsor fields. Code already flagged two beyond getSponsorProductivity:
   - `COALESCE(sponsor_bioguide_id, sponsor_name)` ~line 2451
   - `GROUP BY sponsor_name, sponsor_party` ~line 3282
   For each (and any others — grep `sponsor_name`, `GROUP BY.*sponsor`, the sponsor-aggregation helpers like `getMembersRanked`, `getSponsorStats`, the member list, the dashboard sponsor surfaces): report what it powers, whether it has the same split bug, and whether the dedupe fix applies or it needs its own grouping correction. **`getMembersRanked` (the ranked members list) is the priority** — it's the one that would visibly double-list Begich where the scatter merely double-dotted.

3. **Blast radius + verification target.** Report which surfaces change (the scatter — already tolerant, should now get one Begich dot; the ranked list — should show one Begich row with merged 34 bills; any others). Confirm the dedupe doesn't change *correct* counts for normal members (only merges the split ones). Report a concrete before/after: Begich's row(s) and dot(s) before vs after.

**HALT. Report the query fix (group-by-bioguide + JOIN-members for display fields), the full consumer audit (which share the bug, which the fix covers, which need their own correction), and the before/after for Begich. Wait for sign-off — this touches shared aggregation, so I want the blast radius confirmed before implementation.**

## Phase 2 — Implement (after sign-off)
- Regroup the sponsor aggregation on `bioguide_id`, sourcing display name/party/state from the canonical `members` row.
- Apply the same correction to the other consumers that share the bug (per the audit).
- Handle the null-bioguide residual per Phase 1.
- The HO 197 scatter band-aid (per-point labeling / one-label-per-member guard): leave it — it's harmless once the data's deduped (one dot per member), and it's a reasonable defensive guard. Note it's now belt-and-suspenders, not load-bearing.

## Verification
- Begich appears ONCE in the ranked list (merged ~34 bills, correct pass rate) and as ONE dot per chart.
- Spot-check other members who might have name variants under one bioguide (report any others found in the audit).
- Normal (single-name) members are UNCHANGED — counts, pass rates, ranking positions identical.
- All audited consumers show one row/dot per bioguide.
- No member with a real bioguide is dropped.
- Type check passes.
- Code uses the running dev server (:3000); Corey eyeballs the ranked list (Begich once) + the scatter (one Begich dot).

## Out of scope
- Backfilling/normalizing the denormalized `sponsor_name` in the `bills` table (the real data-hygiene fix would be a sync-side normalization — that's a bigger, separate effort; this handoff fixes the aggregation to be robust against the denormalized variants, which is the right layer for now).
- The Members visual redesign (HO 198 expanded card is separate and still pending).
- SKILL.md — flag for the batched sweep (194 + 195–199).

## Sequencing note
- This is independent of HO 198 (expanded card). Either order works; the dedupe is a data-correctness fix, 198 is the card layout. Corey sequences.
