# HO 201 — SKILL.md reconciliation sweep (HO 194 + 195–200)

## Why

SKILL.md is current through HO 193 (the 191–192 sweep). Since then, seven handoffs shipped — the sponsor-card refinement (194) and the entire Members redesign arc (195–200). This is a big batched sweep. Same discipline as prior sweeps (181/186/190/193): **factual updates only, preserve voice/structure, trust the LIVE files over this summary, re-grep the client-island count, show the diff, single `docs:` commit.**

## What shipped since HO 193 (the drift)

**HO 194 — sponsor hover card refinement** (`SponsorHoverName`, both expanded panel + collapsed row)
- Photo enlarged 80×96 → **120×144** (5:6 bioguide ratio); card widened to **320px**; photo-left/text-right, text top-aligned.
- Three-line text in natural order (NOT the row's "Last, First"): `Rep./Sen. First Last` (prefix from bill_type, parse-safe e.g. "King, Angus S., Jr."→"Angus King") / party-district bracket (party-colored; at-large→"At-Large", Senate→no district) / `State · Nth District` (full state, ordinal; Senate→"· Senate"; at-large→"· At-Large District").
- Threaded `first_name`/`last_name`/`district` (as `sponsor_first_name`/`sponsor_last_name`/`sponsor_district` on `FeedBill`) through the EXISTING HO 192 `members` JOIN — no new query.
- **At-rest affordance:** the sponsor name now shows a solid amber underline AT REST (was hover-only) so the interaction is discoverable; hover intensifies. Both surfaces.

**HO 195 — Members chrome consistency** (`app/members/page.tsx`, `BreadcrumbMasthead.tsx`, `HeaderBar.tsx`)
- **`/members` migrated onto `pageOwnsControls`** — drops the redundant legacy `search bills...` chrome input (clean conditional collapse, no gap); keeps `feedFilters` for the inline sync line; the page's own `search members...` untouched. **This closes the last legacy-HeaderBar-band page** — every page is now on the inner-page chrome pattern.
- **INCLUDE CEREMONIAL relocated** from the masthead chrome into the sub-header filter row (right edge, by VOLUME/PASS RATE). Confirmed it has a real members effect (`billsAggCte(includeCeremonial)` in `getMembersRanked` shifts totals/ranking) — relocated, not removed.
- **Cursor divergence (deliberate):** on Members the blinking `_` trails the FULL inline string (after the sync), vs. Bills' cursor glued to `>`. Gated behind new `cursorAtEnd` + `liftSyncContrast` props that ONLY `/members` sets; `BreadcrumbMasthead` got a `cursor` prop (default true = glued). Bills/everywhere else unchanged. Commented as deliberate.
- **Contrast lift (Members-only):** sync run → `--text-muted`, count → `--text-secondary`.

**HO 196 — Members list-row bar + headers** (`app/members/page.tsx`, `globals.css`)
- Replaced the two-bars-two-scales rows with **ONE bar per active sort**: VOLUME (default landing) = party-colored bar scaled to page `maxVolume`; PASS RATE = green `--stage-enacted` full-width track (enacted %, 0%=empty). Never two bars.
- Columns `# · MEMBER(+party bracket) · [BAR] · RATE · ENACT · BILLS`; thin 9px `--text-dim` border-bottom header row, middle label swaps BILLS↔PASS RATE with the toggle. Figures: RATE green>0/dim-at-0, ENACT `N ✓`, BILLS dim/emphasized-when-volume. (Header uses "ENACT" to avoid crowding.)
- **Default stays VOLUME** (the no-param landing — sort logic unchanged; the spec's "pass rate default" wording described the bar STATE, not the landing view). No new query.

**HO 197 — Members productivity scatter legibility** (`MemberProductivityScatter.tsx`)
- Replaced top-N labeling (TOP_N=5 by volume∪passrate — the pileup cause) with: **threshold** (label only if passRate>10% OR billCount>100) + **greedy collision dodge** (salience-sorted, suppress within ~16px) + **seeded zero-pass jitter** (±~3px on passRate===0, derived deterministically from sponsorKey — NOT Math.random, because the server component re-renders per request and would re-jitter; presentational only — `<title>`/`<Link>` bound to TRUE row data, jitter offsets only rendered `cy`). Per-point labeling with a one-label-per-member guard. Kept caveat/toggle/colors/log-x/y-zoom/▲.

**HO 199 — sponsor aggregation dedupe at the query** (`lib/queries.ts`)
- `getSponsorProductivity`: was `GROUP BY sponsor_bioguide_id, sponsor_name, …` (denormalized name split one member into multiple dots when bills carried name variants under one bioguide — e.g. Begich). Fixed: **`GROUP BY b.sponsor_bioguide_id` alone, sourcing display name/party/state/chamber from the canonical `members` JOIN.** Scatter dots ~557→536 (~21 split members merged). 0 null-bioguide bills (no fallback needed).
- `getClusterDrilldown` top-5 sponsors (display-only, `/patterns`): same group-by-bioguide fix, but kept `MAX(sponsor_name)` because its `shortSponsor()` expects "Last, First".
- `getMembersRanked` was ALREADY immune (groups by bioguide in `billsAggCte`) — left untouched. `getSponsors`/`getSponsorCount` orphaned — untouched.
- The HO 197 scatter per-point/one-label guard is now belt-and-suspenders (data deduped upstream).

**HO 198 + 200 — Members expanded card 3-column redesign + USCPR scorecard** (`SponsorExpandedPanel.tsx`, `SponsorPhoto.tsx`, `app/members/page.tsx`, `globals.css`, `lib/queries.ts`)
- Rebuilt `SponsorExpandedPanel` from the ~650px vertical stack into a **3-column layout (~280px)** matching the HO 191 bill panel: row header → grid `210px · minmax(0,1.5fr) · minmax(0,1fr)`.
  - **LEFT RAIL:** 96px photo (`SponsorPhoto`, bioguide-direct URL + onError→initials — NOT depiction_url; the panel never had that column) via a new `width` prop (hub stays 150px) · identity "Sen./Rep. First Last" (new `chamber` prop threaded from `MemberRanking`) + party bracket + state · stat block (TOTAL BILLS / ENACTED n+%) · STAGES glyph run (`--stage-*`) · TOPICS chips · **CAUCUSES** folded under topics (skip-on-empty, `getMemberAffiliations`/`CaucusBadge`) · **USCPR SCORECARD** (the shared `PalestineBadge` + total_score + #rank of 47; "Not scored" state for off-sheet members; third-party USCPR attribution mirrored from the list) · stacked VIEW DETAIL / OPEN IN FEED buttons. **State flag dropped.**
  - **MIDDLE:** RECENT BILLS · N total, capped to 7 + "SEE ALL N BILLS →"; titles `truncate pr-3`, dates `min-w-[58px] shrink-0 text-right` (spacing fix so titles don't crowd the date).
  - **RIGHT:** COMMITTEES · N, capped ~8 + CHAIR/RANKING badges + subcommittees (indented) + "+N more subcommittees".
  - All three columns share ONE `--bg-row-hover` base with `border-right` dividers (the seam fix — earlier per-column `--bg-panel` rails caused a visible seam against the lighter middle).
  - Text sized up across titles/body for legibility, kept terminal-dense, consistent with the HO 191 bill panel scale.
  - `?expanded=<bioguide_id>` URL-driven single-open mechanism UNCHANGED.
  - Data: added one column (`ps.total_score` → `MemberRanking.palestineScore`) to `getMembersRanked` via the EXISTING `palestine_scorecard` JOIN — no new query. Caps are render-only slices.
- Note: the "N ISSUES" data-quality badge referenced in the design spec **does not exist** (deferred/never built per SKILL) — nothing was removed.

## Phase 1 — Diagnostic (HALT after)
1. Read the SKILL sections that will drift: `SponsorHoverName` (HO 194), `getFeedBills` (the 194 threaded fields), `SponsorExpandedPanel` (full 198/200 rebuild), `MemberProductivityScatter` (197), `getSponsorProductivity` + `getClusterDrilldown` + `getMembersRanked` (199 + the 200 palestineScore), the Members page chrome/masthead notes + `HeaderBar`/`BreadcrumbMasthead` (195), the design-system intro + the canonical client-island list + count.
2. **Re-grep the island count.** Current is 27. HO 195–200 may have added/removed islands (the masthead prop changes, the card rebuild). Report the new count and what changed (if anything).
3. **Trust the LIVE files** — `view` each changed file, report stale sections + an edit plan. The summary above is a guide; the served code wins (e.g. confirm the exact grid-template, the scatter thresholds, the dedupe GROUP BY, the new props).

**HALT with: the stale-section map (one row per SKILL location), the island-count finding, and the edit plan. Then proceed.**

## Phase 2 — Reconcile
- Update each drifted section factually; fold HO 194's card-refinement facts into the existing `SponsorHoverName` entry; fully rewrite the `SponsorExpandedPanel` entry for the 3-column redesign + USCPR scorecard; update the four query helpers; document the Members chrome migration + cursor divergence + the new `HeaderBar`/`BreadcrumbMasthead` props; update the scatter entry; update the island count + canonical list.
- Note the closed loose end: **`/members` legacy-band migration done — all pages now on the inner-page chrome pattern.**
- Preserve voice/structure; factual only.

## Verification
- Show the diff (word-level if large — this is a big sweep).
- Confirm every shipped change above is reflected and nothing is over-claimed against the live files.
- Island count corrected.
- Commit: `docs: reconcile SKILL.md for HO 194 + 195–200`.
- Docs-only — confirm no code touched.

## Out of scope
- No code changes — documentation only.
- The deferred mobile pass (the 3-column card, the bigger hover card, the new chrome bands all need `<700` rules — note as an open thread if SKILL tracks deferred work, don't spec).
