# 272 — v2 RACES-tab update badges, MOVES / NEW (Piece 3 of 3)

MOVES and NEW badges on the RACES top tab (plus per-card indicators in COMPETITIVE), so a user can stay on the HEARINGS default tab and still see when races change. MOVES is feasible and ships now; NEW is gated on the news→race linkage and ships dark.

## Source of truth

The approved spec block below is the source of truth. `dashboard-v2-tabbed-words.html` is structural reference only; mock data is fabricated. Existing tokens, no new tokens **except the red** (gated with NEW, see diagnostics). v2 route only.

## Depends on

Piece 1 (270, the box shell); rating-history (HO 220) for MOVES; the news→race linkage for NEW.

## Phase 1 diagnostic — run and report before building

1. **MOVES feasibility.** Confirm the rating-history log (HO 220) carries what's needed to count "rating changed since the user last opened RACES" per race — dated rating-change events per race, countable since a timestamp. Report the log shape.
2. **NEW gating — decide.** NEW = news-mention → race join, which is the deferred/absent linkage (`news_mentions` are bill-keyed, no race key — the wall every race surface hits). Recommendation: ship MOVES now, NEW dark until the join lands. Confirm this rather than gating the whole badge set.
3. **Red token — decide.** The mock's `#ef4444` is also `--party-republican`; on a races tab a red badge reads as a party cue. Confirm whether `#9b3d3d` (the muted closed-market red) is already a token, and prefer it over `#ef4444`. If `#9b3d3d` is net-new, it's the one sanctioned color per the spec's "existing tokens except the red" carve-out. The red only renders once NEW populates, so it rides in with the NEW feature — but lock the choice now (recommend `#9b3d3d`).
4. **"Since last view" persistence.** Confirm how the per-user "last opened RACES tab" marker is persisted. This is the real app (not an artifact), so `localStorage` is available — a per-browser last-opened timestamp, with the badge counting changes since it, is the natural fit. Confirm `localStorage` vs a server-side per-user marker.

## Scope note

272 ships **MOVES live + the badge framework with the NEW slot dark**. NEW's count and the red rendering land later, when the news→race linkage exists. The MOVED per-card indicator (amber) ships with MOVES and needs no red.

## Approved design spec (source of truth)

```
## Approved design — v2 RACES tab update badges

Layout: Two update badges on the RACES top tab, plus per-race indicators in the
COMPETITIVE panel, so the user stays on HEARINGS and still sees when races change.

Blocks:
- RACES tab badges (right of the label): `MOVES n` (--accent-amber-bright,
  outlined + ~16% tint fill) and `NEW n` (red, outlined + ~16% tint fill).
  Mono, ~11px, uppercase. Counts = changes since the tab was last opened.
- Per-card indicators (COMPETITIVE cards): a card whose rating changed shows
  `MOVED · <new lean>` (--accent-amber-bright); a card with new news shows `NEW`
  (red). Card counts sum to the tab badge counts.

Interactions: both badges clear on opening the RACES tab (reset the
since-last-view state). No motion.

Constraints: v2 route; desktop; static; existing tokens except the red — see below.

Open questions / build diagnostics:
- MOVES = rating-change events (the daily rating-history log, HO 220). Feasible.
- NEW = news-mention → race join. This is the news-to-race linkage currently
  DEFERRED / absent (news_mentions are bill-keyed, no race key). Until it lands
  the NEW badge can't populate — ship MOVES alone with NEW dark, or gate the
  whole badge set on the linkage. Confirm which.
- Red token: the mock uses #ef4444, which is also --party-republican; on a races
  tab a red badge can read as a party cue. Fallback is the muted closed-market
  red #9b3d3d. Pick one.
- "Since last view" needs a per-user last-opened marker. Confirm how it's persisted.

Depends on: Piece 1; rating-history (HO 220) for MOVES; the news→race linkage for NEW.
```

## Acceptance

1. Phase 1 diagnostics posted: rating-history shape for MOVES, the NEW-gating decision (MOVES-first / NEW-dark), the red-token decision, the since-last-view persistence mechanism. Build only after.
2. `MOVES n` badge on the RACES tab (amber-bright, outlined + ~16% tint), count = rating-change events since the user last opened RACES; clears on opening RACES.
3. Per-card `MOVED · <new lean>` indicator (amber) on COMPETITIVE cards whose rating changed; card counts sum to the MOVES badge count.
4. NEW slot present but dark/absent until the news→race linkage lands (per the locked decision); the red token locked (`#9b3d3d` recommended) for when NEW populates.
5. "Since last view" persisted per the locked mechanism (`localStorage` recommended); opening RACES resets it.
6. Static, no motion; existing tokens (red gated with NEW).
7. Ship per HO 252: push, then `npm run verify:deploy` until the deployed SHA matches HEAD.
8. Single commit: `feat: v2 races-tab MOVES badge (HO 272)`.
