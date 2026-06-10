# HO 190 — SKILL.md reconciliation sweep (HO 187 → 189)

## Why

SKILL.md is current through HO 185/186. Since then, three handoffs shipped and merged — all touching the inner-page chrome and the bill row, which overlap. Reconcile before the bill-row layout redesign (queued in the design chat) lands on top. Same approach as the HO 181 / 186 sweeps: **factual updates only, preserve voice/structure, re-grep the client-island count, show the diff, commit separately as a `docs:` commit, trust the live files over this summary.**

## What shipped since HO 186 (the drift)

**HO 187 — inner-page chrome 5-band consolidation**
- The inner (non-dashboard) pages went from ~9-10 stacked chrome bands to **5**: TITLE BAR (path + nav, one row) / SYNC STRIP (thin · N BILLS · UPDATED MT) / CONTROL STRIP (BILLS|NEWS toggle + ALL STAGES + ALL/HOUSE/SENATE + compact search + INCLUDE CEREMONIAL + SORT) / TOPICS BAND (sub-nav Changes·President·Reports + divider + 24 chips) / LEGEND + PAGINATION.
- **Markets tapes REMOVED from inner pages** (dashboard-only now) — deliberate reversal of HO 185's "dual tapes everywhere." `DualMarketsTape` stays (dashboard uses it); just unmounted from `HeaderBar`.
- Search moved out of the masthead into the control strip (compact ⌕, flex:1, max 230px), replacing the oversized box. INCLUDE CEREMONIAL relocated from masthead to the control strip.
- Bills per page **100 → 25** (`FEED_PAGE_SIZE`; the real prior value was 100, not the documented 50).
- Chamber filter is a 3-way ALL/HOUSE/SENATE SegmentedToggle (relocated, no behavior change).
- Topic chips (filter row) + per-row topic codes got a **colored full-name hover** (HLTH → "Health" in the topic's color), via `topicFullLabel()`/`TOPIC_FULL_LABELS`. Filter chips = CSS popover; per-row codes = portal tooltip (the row truncates).
- Bill-row title bumped **16px → 18px** (`.feed-row .row-title`, shared with the dashboard activity feed — both grew).
- The 5-band layout was rolled across the feed-shaped pages: `/bills`, `/changes`, `/stale` (each got the control row). `/members` intentionally left on the old HeaderBar search band (it has its own inline search) — a known follow-up.
- Title-bar path made larger than the nav (path 20px > nav 13px; path is the title, nav subordinate).

**HO 188 — expanded bill-row enrichment**
- The expanded bill panel (`BillExpandedPanel`, shared by `/bills` feed + the dashboard ACTIVITY expand) gained: **sponsor → member-page link** (`sponsor_bioguide_id` added to `getFeedBills` SELECT + FeedBill → `/members/[bioguideId]`), **cosponsor count** (`cosponsor_count` added to the SELECT, "N cosponsors"; the list is not stored), and a **thin timeline milestone strip** (Introduced → Reached committee → Last action, with dates + a · middot separator, built from existing fields — 0 new queries).
- Committee links + related news were ALREADY shipped (the panel route `getBillCommittees` + `getNewsForBill` cap 5) — confirm SKILL reflects them.
- Dropped: similar/related bills (no real topical-similarity data — only regex template `cluster_id`). Full action-history timeline deferred (not stored).
- Enriched expanded row stays at **2 queries** (committees + news); the new items are column-level/derived. No gating — the enrichments also show on the dashboard ACTIVITY expand (consistent with committees/news already there).
- The sponsor link + cosponsor count are wired into `getFeedBills` only — they degrade to absent on `/stale`/`/changes`/`/watchlist` (the timeline still shows). Known, extendable later.

**HO 189 — inner chrome v2 (5 → 4 bands)**
- The standalone SYNC STRIP (HO 187 band 2) was **removed**; its content moved **inline into the title bar**, after the cursor: `Congress Terminal:\119TH\<Section>>_ · N BILLS · UPDATED MT` (the cursor `_` stays glued to `>`, sync after it). So inner pages are now **4 bands** (title+sync inline / control / topics / legend+pagination).
- The inline sync is filter-aware (e.g. `N OF M BILLS · "query" · UPDATED MT`).
- Degrade rule: the sync is lowest-priority (`flex:0 1 auto` + ellipsis → collapses to empty), nav protected (`flex:0 0 auto` + margin-left:auto), path gives last (the HO 187 wrap-under fallback). Verified: sync truncates/hides before nav wraps or path truncates. Known edge: the longest committee paths wrap nav to a second row (left-aligned) at ~1440 — accepted, protects the path.
- Page size stays 25 (the design spec's "15" was not adopted).

## Phase 1 — light diagnostic (then proceed)
1. Read the SKILL sections on: the inner-page chrome / HeaderBar bands, the markets tape (now dashboard-only — the HO 185 "dual everywhere" must be corrected), the feed page size, the bill-row component + the expanded panel, the topic-chip hover, the client-island count, and the masthead/title-bar description.
2. Grep `"use client"` for the island count (HO 188/189 may not have added islands — the enrichment is server/column-level, the chrome is layout; report whether the count changed from 26).
3. **Trust the live files** — `view` `components/HeaderBar.tsx`, `components/BillExpandedPanel.tsx` (or the expanded-panel component), `app/bills/page.tsx`, `lib/queries.ts` (getFeedBills, FEED_PAGE_SIZE), the topic-hover CSS, `app/globals.css` for the band structure. Report stale sections + the edit plan, brief HALT to confirm, then proceed.

## Phase 2 — reconcile
- Inner chrome: 4 bands (correct any "5-band" if an interim doc note landed; the live state is 4 — title+sync inline / control / topics / legend+pagination).
- Markets tape: dashboard-only (correct HO 185's "dual everywhere"; note the reversal).
- Page size 25; search-in-control-strip; ceremonial relocated; chamber 3-way; topic-chip colored hover; 18px rows; the title-bigger-than-nav + inline filter-aware sync + degrade rule.
- Bill-row enrichment: sponsor link, cosponsor count, timeline strip; committees/news already there; similar-bills dropped; full-timeline deferred; 2-queries-per-expanded-row; no gating; `/bills`-only column wiring.
- Note known-state: `/members` still on the old search band; the longest-committee-path nav-wrap edge; the enrichment not yet on stale/changes/watchlist.
- Preserve voice/structure; factual only; update the island count.

## Verification
- Show the diff (word-level if large).
- Confirm: inner chrome = 4 bands, tape dashboard-only, page size 25, the enrichment items, the topic hover, 18px rows, island count.
- Commit: `docs: reconcile SKILL.md for HO 187–189`.
- Docs-only — confirm no code touched.

## Out of scope
- No code changes — documentation only.
- The bill-row layout redesign (still in the design chat) is NOT part of this — this documents the current shipped state so that redesign lands on a current doc.
