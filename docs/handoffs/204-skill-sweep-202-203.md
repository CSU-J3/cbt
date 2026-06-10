# HO 204 — SKILL.md reconciliation sweep (HO 202 + 203 + HO 187 amendment)

## Why

SKILL.md is current through HO 200 (the HO 201 sweep). Since then, HO 202 (dual tape restored to inner pages) and HO 203 (primaries row redesign) shipped — and HO 202 **reverses HO 187**, so the existing HO 187 entry now contradicts the live app. Reconcile. Same discipline as prior sweeps (193/201): **factual only, preserve voice/structure, trust the LIVE files over this summary, re-grep the island count, show the diff, single `docs:` commit.**

## What shipped / changed since HO 200

**HO 202 — dual markets tape restored to all inner pages** (`HeaderBar.tsx`, `MarketsTape.tsx`)
- `DualMarketsTape` is now mounted once in `HeaderBar` (under the title bar, matching the dashboard's masthead→tape→nav order), so it appears on **every inner page** (`/bills`, `/members`, `/changes`, `/stale`, `/watchlist`, `/races`, `/primaries`, `/patterns`, `/reports`) — not just the dashboard.
- **This reverses HO 187** (which had removed the tape from inner pages, dashboard-only). The dashboard's `HomeHeader` tape is a separate mount, unchanged (no double-mount).
- Perf: each `MarketsTape` reads the shared `unstable_cache(tag "markets")` (`getLatestMarketTicks`); the dual tape = 2 polls/page identical to the dashboard, flushed together by the markets cron's `revalidateTag`. No fetch multiplication.
- Mobile: `.markets-tape` is globally `display:none` below 700px, so inner-page tapes inherit the same mobile-hide automatically.
- Two stale code comments were corrected in the process (`HeaderBar.tsx`, `MarketsTape.tsx`).

**HO 203 — Primaries tab: chrome consistency + candidate-field row + single-open expand** (`app/primaries/page.tsx`, `components/PrimaryRow.tsx` + a new `PrimaryExpandProvider` context, `lib/queries.ts` PRIMARY_SELECT)
- **Chrome consistency:** `/primaries` now passes `cursorAtEnd` + `liftSyncContrast` (matching Members/Races) — breadcrumb `Congress Terminal:\119TH\Races\Primaries>`, cursor trailing the full string, sync run `--text-muted`, count `--text-secondary`. No `search bills...` band existed to drop (bare `HeaderBar`), so no `pageOwnsControls` migration was needed.
- **Row upgrade:** the bare "N candidates" count is replaced by the **candidate-field list** — incumbent-first, top-3 last names + "+N other(s)", incumbent ★-flagged. Empty rosters (~50 of 447 upcoming) show muted "roster pending". `PrimaryRow` is a new client island.
- **Seat-incumbent ★ semantics (the fix):** the ★ marks only the candidate who is the actual officeholder of THAT seat, via a `seat_incumbent_bioguide` subquery (current House officeholder matched by state+district, `is_current`), falling back to the raw `incumbent` flag where unresolved (at-large/senate/open — ≤1 there). NOT the raw `incumbent` flag, which means "is a sitting member of Congress" and legitimately flags >1 candidate in top-two/redraw contests (CA-40: Calvert+Kim; TX-18: Menefee+Green). The `incumbent` flag is unchanged and still drives the member-page links (Calvert still links to his hub, just isn't ★'d in CA-40). Chosen over `races.incumbent_bioguide_id` because `primaries.race_id` is dead (3/907) and that field has cycle gaps + excludes at-large.
- **Expand:** HO 148 click-to-expand added (was none) — full candidate field, ★ INC flag, party, status, `/members/[bioguideId]` links for sitting members. **Single-open** via a shared `PrimaryExpandProvider` context (client-side, survives inside the past-primaries `<details>`).
- **Share bar — explicitly deferred.** A candidate-field poll/results share bar was specced but is **unbuildable**: no polling data model exists, and `primary_candidates.vote_pct` (results) is 100% NULL (results ingestion deferred at HO 91 Step 3). No bar renders against empty data; deferred pending a results-ingestion sync. Note this as the prerequisite.

**HO 187 entry amendment** — the existing SKILL HO 187 note says "tape removed from inner pages / dashboard-only." **Flip it to resolved:** tape was restored app-wide in HO 202; keep the HO 187 history but mark it superseded so a future reader doesn't see "removed" in the doc and "present" in the app and assume drift.

## Phase 1 — Diagnostic (HALT after)
1. Read the SKILL sections that drift: the markets-tape / inner-chrome notes + the HO 187 entry (202 + the amendment), the `/primaries` / Primaries-tab section (203 — row, ★ semantics, expand, deferred bar), `HeaderBar`/`MarketsTape`, the design-system intro + canonical island list + count.
2. **Re-grep the island count.** Current is 27. HO 203 added `PrimaryRow` (new client island) and `PrimaryExpandProvider` (context — confirm whether it counts as an island under the existing convention). HO 202 added no island (tape components already counted; the mount is in existing `HeaderBar`). Report the new count and exactly what changed.
3. **Trust the LIVE files** — `view` `HeaderBar.tsx`, `MarketsTape.tsx`, `app/primaries/page.tsx`, `PrimaryRow.tsx`, the expand context, `PRIMARY_SELECT` in `lib/queries.ts`. Report stale sections + edit plan.

**HALT with: the stale-section map, the island-count finding (PrimaryRow/PrimaryExpandProvider), and the edit plan. Then proceed.**

## Phase 2 — Reconcile
- Update the markets-tape/chrome notes for the app-wide restore; **amend the HO 187 entry to "superseded by HO 202 — tape restored app-wide."**
- Add/update the Primaries-tab section: the candidate-field row, the seat-incumbent ★ semantics (one-per-seat via the bioguide subquery, vs. the "sitting member" flag that drives links), the single-open expand, and the **deferred share bar (prerequisite: primary results ingestion, HO 91 Step 3)**.
- Update the island count + canonical list (PrimaryRow; PrimaryExpandProvider per the convention).
- Preserve voice/structure; factual only.

## Verification
- Show the diff (word-level if large).
- Confirm: the tape app-wide restore + the HO 187 amendment reading as resolved, the Primaries row/★/expand/deferred-bar facts, the island count corrected, nothing over-claimed vs. the live files.
- Commit: `docs: reconcile SKILL.md for HO 202–203 + amend HO 187`.
- Docs-only — confirm no code touched.

## Out of scope
- No code changes — documentation only.
- The deferred items (mobile pass, the data-blocked sync features, the News-uniformity + primaries-map design threads) — note as open threads if SKILL tracks them, don't spec.
