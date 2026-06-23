# HO 296 — B6 mover feed: diagnostic

Probe before the B6 build. B6 rebuilds the v2 mover-feed rows per the 6-block spec (collapsed row + single-open expand, stage bar with ping, a RELATED block, a sponsor photo card, shared across MOVERS / TOP STALLS / NEW THIS WEEK with per-tab metric+sort, and the deferred chip migration). This grounds that build: inventory the current row and confirm the data each addition needs, so the slices don't assume.

Diagnosis only. Don't build.

## 1. Current row inventory

The v2 movers feed was last redesigned in 257. Read its current row component and report:
- The collapsed row: what it shows, and which chips it uses (id / topic / stage / party). These are the chips the B6 migration to the chip-family system will touch.
- Expand behavior: is there an expand, is it single-open or multi-open, and what's in the expanded state now?
- The tabs: do MOVERS / TOP STALLS / NEW THIS WEEK exist (249 added new-this-week)? How do they currently differ (metric, sort)?

## 2. Data deps for the B6 additions

Confirm each is available and report the shape:
- RELATED = NEWS (always): the bill → news lookup. news_mentions is bill-keyed; confirm the per-bill news query and that it's populated.
- RELATED = HEARINGS (if the bill has a meeting): the meeting_bills REVERSE lookup (bill → meetings). Confirm meeting_bills supports bill→meeting and the data's there.
- RELATED = ODDS (if the bill has a market): this is the uncertain one. Is there any bill → prediction-market linkage? The markets are macro (shutdown/Fed/recession), not per-bill, so this may not exist at all. Report whether any bill↔market association exists; if not, say so plainly.
- Sponsor photo card: confirm sponsor photos are available (bioguide-based, from the member-hub work) and the source.
- TOP STALLS ceremonial filter: confirm the ceremonial classifier (HO 50) exists and can gate the stalls list.

## Output

Report the current row structure and, per data dep, available / shape / or not-wired. Flag the bill→market question clearly, since it gates whether RELATED=ODDS is buildable. Don't change anything; the build follows once this and the precise spec are confirmed.

## Ship

Read-only. If you add a throwaway probe script, follow `scripts/diagnostic/*-NNN.ts`. No deploy change to verify.
