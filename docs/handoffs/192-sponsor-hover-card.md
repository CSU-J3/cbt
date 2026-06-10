# HO 192 — Sponsor hover card (photo + name + party-state) on the expanded bill panel

## Why

Approved design: hovering the SPONSOR name in the expanded bill panel (`BillExpandedPanel`) shows a hover card with the sponsor's photo + name + party-state. The Phase-1 diagnostic (prior turn) confirmed all the data is already on hand — this is an `<img>` + hover card, no new data API.

## What the diagnostic established (build on this — don't re-audit)

- The sponsor's **bioguide ID is already on the row** (`bill.sponsor_bioguide_id`, SELECTed by `getFeedBills`) — the sponsor name already links to `/members/[bioguideId]` off it. No fetch needed.
- **Name / party / state** are already on `FeedBill` (`sponsor_name`, `sponsor_party`, `sponsor_state`).
- **Photo:** use the stored `members.depiction_url` (100% coverage for current sponsors, lowest 404 risk) — **JOIN it into `getFeedBills`** (the `LEFT JOIN members` pattern already used in `getSponsorProductivity`), add it to the `FeedBill` type. This is decision (b) from the diagnostic, chosen over the direct-bioguide-URL (a) because it's the lowest-404-risk source and reuses what the member hub already shows.
- **Fallback:** keep an `onError → initials` placeholder (both `SponsorPhoto` and `MemberHeader` already do this) — reuse the pattern. Coverage is 100% today but the fallback is free insurance.
- **Scope:** `sponsor_bioguide_id` + the new `depiction_url` are wired into `getFeedBills` only, so the hover card is **`/bills`-only** — it degrades to absent on `/stale`/`/changes`/`/watchlist` (consistent with the sponsor link, which already does this). Not a new gap.

## Build

1. **JOIN `depiction_url` into `getFeedBills`** (LEFT JOIN `members` on `sponsor_bioguide_id`, mirroring `getSponsorProductivity`'s pattern); add `sponsor_depiction_url` (or similar) to the `FeedBill` type.
2. **Hover card on the SPONSOR name** in `BillExpandedPanel`:
   - Trigger: hover the sponsor name (which is already the member-page link — the card is additive, the click still navigates to `/members/[bioguideId]`).
   - Content: photo (from `depiction_url`, `onError` → initials placeholder reusing the existing pattern) + name + party-state (e.g. "Rep. Latta, Robert E." · "R-OH"), with the party-colored treatment the panel already uses.
   - Style: absolute-positioned floating card, opaque (`--bg-row-hover` or the panel's card bg), border + shadow so it reads as a distinct overlay — match the existing hover-card/popover idiom (the tape full-name, the race cards, the topic chips). Non-layout-affecting (doesn't push the panel content).
   - Position: open in clear space (below/beside the name); it's inside the panel, so confirm it doesn't clip at the panel edge — clamp or flip if needed.
3. **Compact variant:** the dashboard ACTIVITY expand (compact) drops the right metadata column entirely, so the SPONSOR row isn't there — the hover card is moot in compact. Confirm it simply doesn't apply (no SPONSOR name to hover). No special handling needed beyond it not rendering.

## Phase 1 — light confirm (then proceed)
The data audit is done (prior turn). Just confirm before building:
- The `getFeedBills` JOIN for `depiction_url` mirrors `getSponsorProductivity` cleanly (no row multiplication — one member per `sponsor_bioguide_id`).
- The existing `onError → initials` fallback (from `SponsorPhoto`/`MemberHeader`) is reusable as-is or needs a small shared extract.
Report briefly, then build (this is a small, well-scoped feature — no heavy gate).

## Verification
- Hover the SPONSOR name in an expanded `/bills` bill → a floating card with photo + name + party-state appears, doesn't shift the panel layout, doesn't clip at the panel edge.
- The photo loads from `depiction_url`; a sponsor with a missing/broken image shows the initials fallback (test by simulating an error if no real case is handy).
- Clicking the sponsor name still navigates to `/members/[bioguideId]` (the card is additive, not a replacement).
- The card is `/bills`-only (degrades to absent where `depiction_url` isn't SELECTed — `/stale`/`/changes`/`/watchlist`); the compact dashboard expand has no SPONSOR row, so no card there.
- No row multiplication from the JOIN (bill count unchanged).
- Type check passes.
- Code starts the dev server; Corey eyeballs the hover card on `/bills`.

## Out of scope
- Extending the sponsor data (link/card) to `/stale`/`/changes`/`/watchlist` — a separate "extend enrichment to other feeds" follow-up.
- Cosponsor hover cards (only the sponsor for now).
- Any new photo infrastructure — reuse `depiction_url` + the existing fallback.
- SKILL.md — flag for the next sweep (along with HO 191).

## Note
- HO 191 (the panel redesign + no-news state) should be committed/pushed before or alongside this — this builds on the redesigned panel's SPONSOR row.
