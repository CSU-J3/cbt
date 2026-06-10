# HO 203 — Primaries tab: chrome consistency + candidate-field share bar

## Why

Approved design from the CBT Design chat. Two changes to `/races → PRIMARIES tab` (sibling to the RACES tab): bring its chrome in line with Races/Members, and replace/upgrade the per-primary row with a candidate-field **poll-share bar** (a primary is a within-party multi-candidate field, NOT a D↔R contest, so it uses a share bar, not the Races spectrum).

Phase-1 gated — the poll-share data reality decides how much of this is the bar vs. the no-polling fallback.

## 1. Chrome consistency (same pattern as Races/Members, HO 195)
- **Cursor** trails the full inline string: `Congress Terminal:\119TH\Races\Primaries> · 15,519 BILLS · UPDATED 3:33 AM MT _` (breadcrumb shows the `\Primaries` segment). Same `cursorAtEnd` treatment Members/Races use.
- **Contrast lift:** sync run `--text-dim` → `--text-muted`; count number → `--text-secondary` (the `liftSyncContrast` treatment).
- **Drop the redundant top `search bills...` input** (clean collapse, no gap — the `pageOwnsControls` pattern, same as Members).
- Amber `\`/`>` glyphs, `--text-primary` path (shared masthead).

## 2. Candidate-field share bar (per primary row)

A primary is a within-party multi-candidate field. **Deliberately parallel structure to the Races spectrum** (same row rhythm + expand) but a different metric — a poll-share bar, not a D↔R spectrum.

**Columns:** `SEAT · PARTY · FIELD (poll share) · PRIMARY (date)`.

**Share bar:**
- Horizontal bar segmented by candidate poll share; segments sum to ~100% (undecided/other = a remaining `--border-strong` segment — Phase-1 decides whether to show it or omit).
- **Party-tinted:** the whole bar in `--party-democrat` OR `--party-republican` (a primary is one party).
- **Rank by brightness:** LEADER segment full-opacity; trailing candidates step down in opacity (~0.62, ~0.40) so rank reads by brightness. (Phase-1: confirm legibility against real party hexes — low-opacity trailing segments on a saturated color may be hard to read; adjust steps if needed.)
- Segment labels inline ("Name NN") where width allows; leader marker (★ or none) — Phase-1 decides.
- **Long fields:** top-3 segments + a "+N" `--border-strong` segment for the rest.
- **Contest state reads from shape:** one wide segment = locked; two near-equal = contested.

**No-polling fallback (the likely-majority case):** primaries without polls render a **plain candidate list** ("A · B · 2 others — no polling", `--text-dim`) — NOT a bar. **Never fake an even-split bar** — an even split falsely reads as "tied." This fallback must cover the majority gracefully (Phase-1 confirms how many primaries actually have polling).

**Expand (reuse HO 148 click-to-expand):** full candidate field — every candidate's share, incumbent flag, links to member pages where a candidate is a sitting member. Preserve any existing row-click behavior. (Candidate photos in the expand are a SEPARATE future decision pending the photo diagnostic — NOT in this handoff. Build the expand without photos for now.)

**Sort:** keep whatever the tab currently sorts by. If it's competitiveness, "closest margin first" surfaces contested primaries (two near-equal segments) up top — confirm and keep.

## Phase 1 — Diagnostic (HALT after)
1. **Poll-share data — the gating question.** What's the source + freshness of primary candidate poll shares? Are shares stored per-candidate, or do they need derivation? **What fraction of primaries actually have polling vs. none?** (This decides whether the share bar is the common case or the exception — if most primaries have no polls, the no-polling fallback is the primary surface and the bar is the minority.) Report the real split.
2. **Opacity-step legibility.** Against the real `--party-democrat`/`--party-republican` hexes, are trailing segments at ~0.62/~0.40 opacity legible, or do they wash out? Recommend the steps (or an alternative rank cue if opacity doesn't read).
3. **Leader marker + undecided segment.** Recommend: ★ on the leader vs. none; undecided/other as its own `--border-strong` segment vs. omitted.
4. **Chrome mechanics.** Confirm the Primaries tab uses the same chrome path as Races/Members — does dropping the `search bills...` input + the cursor/contrast treatment apply cleanly (the `pageOwnsControls`/`cursorAtEnd`/`liftSyncContrast` pattern from HO 195)? Report whether Primaries is already on `pageOwnsControls` or needs the same migration.
5. **Existing row + expand.** What does the Primaries row render today, and does it already use the HO 148 click-to-expand? Report the current sort. Confirm the candidate field data (names, shares where present, incumbent flag, sitting-member bioguide links) is available for the bar + expand.

**HALT with: the polling-coverage split (the big one — it shapes how much is bar vs. fallback), the opacity-legibility call, the marker/undecided recommendations, and the chrome-mechanics confirm. Wait for sign-off.**

## Phase 2 — Implement (after sign-off)
- Chrome consistency (cursor, contrast, drop search, glyphs) per the Races/Members pattern.
- Share bar per primary (party-tinted, opacity-ranked, top-3 + "+N", inline labels, leader marker per Phase-1), with the no-polling fallback list for primaries without polls.
- Expand (reuse HO 148): full field, shares, incumbent flag, member-page links — NO photos (separate future decision).
- Keep the existing sort.

## Verification
- Chrome matches Races/Members (cursor trailing, contrast lifted, no `search bills...`, amber glyphs).
- Primaries WITH polling show the party-tinted share bar (leader bright, trailing dimmer, top-3 + "+N", contest state legible from shape).
- Primaries WITHOUT polling show the plain candidate-list fallback ("A · B · N others — no polling") — never a fake even-split bar.
- Expand shows the full field + shares + incumbent flag + member links (no photos).
- Sort unchanged; contested primaries surface appropriately if sort is competitiveness.
- Type check passes.
- Code uses the running dev server (:3000); Corey eyeballs a polled primary, an unpolled one, and an expand.

## Out of scope
- **Candidate photos in the expand** (separate, pending the photo diagnostic).
- The RACES tab (this is the sibling PRIMARIES tab).
- Mobile <700 (deferred).
- SKILL.md — flag for the next sweep (with the HO 187 tape-restore amendment + this).
