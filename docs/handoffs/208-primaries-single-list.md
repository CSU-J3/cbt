# HO 208 — Primaries tab: merge into one date-sorted list (surface results up top)

## Why

After HO 207, the results share bars — the payload of the 206/207 arc — sit inside a collapsed "Past primaries" `<details>` at the bottom of `/primaries`. The default-visible "Upcoming" section is entirely "not yet voted" fallback rows. So a first look at the page shows none of the results work; the headline feature is one expand down.

That two-section split (Upcoming / collapsed Past) is an artifact of when the page was built — everything was upcoming then. Now ~half the primaries have voted and that half is the interesting half. The page structure is fighting the data.

Fix: **collapse the two sections into one date-sorted list**, voted vs. upcoming carried as a visual distinction within the single list rather than as two separate containers.

## What

**One list, sorted most-recent-first.** Voted primaries (with their result share bars) at the top, descending by `primary_date`; the "not yet voted" upcoming primaries continue below in ascending-toward-future order, OR simply continue the descending sort so the nearest-upcoming sits just below the fold — pick whichever reads cleaner against the real data and note the call. The point: **the most recent results are the first thing visible on the page**, no expand required.

Rationale for recency-first (not calendar-ascending): the page answers "what just happened in these primaries," not "show me the full-year calendar." Fresh results are the signal; the far-future upcoming tail is reference. Most-recent-first puts the signal at the top.

**The voted/upcoming seam = the visual distinction.** Where the list crosses from voted into not-yet-voted, mark it lightly so the boundary reads without two hard-walled sections. Options (pick one, keep it subtle — this is a seam, not a section header):
- A thin `--border-strong` divider row with a small "UPCOMING" / "— not yet voted —" label in `--text-dim`, OR
- Just the natural visual difference (bars above, plain fallback lists below) carrying it with no explicit divider — if the shape change alone reads clearly, prefer no divider.

Confirm which reads better against real data in the dev server and keep it.

**Kill the collapsed `<details>`.** No more "Past primaries" expand-to-see. Everything's in the one scrollable list. (The per-row HO 148 click-to-expand for the full candidate field stays — that's a different mechanism, unaffected.)

## Preserve from HO 207 (do not regress)

- Voted rows: party-tinted results share bar, leader-bright → trailing-dim, top-3 + "+N", advancer ★ (incl. two-★ runoffs), inline Name NN% labels.
- Un-voted rows: plain "not yet voted" fallback list, incumbent in amber/INC, never a fake even-split bar.
- Per-row expand (HO 148): full field, shares, ★, INC, member links, no photos.
- Chrome (cursor `\Primaries`, contrast lift, no `search bills...`, amber glyphs) — unchanged.

## Build-time confirm (not a halt)

- The current sort: HO 207 said "keep whatever the tab sorts by, closest-margin-first if competitiveness." This handoff overrides that to **date-sorted** for the merged list. If the tab had a competitiveness sort, confirm whether to drop it entirely or offer it as a toggle — default to dropping it (one date-sorted list is the spec); note if a toggle is trivially cheap and you'd recommend keeping it.
- Whether the existing Upcoming/Past split is two components or one with a filter — report which, so the merge is structural-clean not a hack.

## Verification

- `/primaries` default view (no expand) shows **recent result bars at the top** — TX-Sen, the most recent voted contests, visible immediately.
- Scrolling down crosses the voted→upcoming seam cleanly; upcoming "not yet voted" rows below.
- No collapsed "Past primaries" `<details>` remains.
- All HO 207 rendering preserved (bars, ★, two-★ runoffs, fallback, expand, chrome) — spot-check the same TX-Sen two-★ case still renders right in its new top-of-list position.
- Sort is date-based; competitiveness sort dropped (or a confirmed cheap toggle).
- `tsc` passes; Corey eyeballs the default view (results visible without expanding), the seam, and a voted-row expand.

## After ship

- SKILL.md: note the primaries page is now a single date-sorted list (recent results top, upcoming below), the two-section Upcoming/Past structure removed.

## Out of scope

- Candidate photos (separate, pending photo diagnostic).
- The RACES tab.
- The primaries map (design-chat arc).
- Mobile <700.
- Any change to the share-bar internals or fallback semantics (HO 207 owns those) — this is purely the list structure / sort / seam.

read docs/handoffs/208-primaries-single-list.md and follow
