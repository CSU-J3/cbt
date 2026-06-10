# HO 193 — SKILL.md reconciliation sweep (HO 191 → 192)

## Why

SKILL.md is current through HO 189/190. Since then, HO 191 and 192 reshaped the expanded bill panel and `getFeedBills`. Reconcile. Same approach as the prior sweeps (181/186/190): **factual updates only, preserve voice/structure, re-grep the client-island count, show the diff, commit separately as a `docs:` commit, trust the live files over this summary.**

## What shipped since HO 190 (the drift)

**HO 191 — expanded bill-row panel redesign (stage pipeline + two columns)**
- `BillExpandedPanel` was rebuilt from a vertical stack (summary → label-list → timeline strip → news → buttons) into: **row header → full-width STAGE PIPELINE → two columns**.
- **Stage pipeline** (replaces the old thin timeline strip entirely): six stages INTRO · COMMITTEE · FLOOR · OTHER CHAMBER · PRESIDENT · ENACTED, using `--stage-*` tokens. Reached = filled dot in stage color; current = larger bright marker + bold label; unreached = dim hollow dot. Connector colored up to current, `--border-strong` after. Dates under reached stages where available — **only INTRO (`introduced_date`) and the current stage (`stage_changed_at`, present on ~4% of bills) are dated**; intermediate reached stages show label only (full per-stage history isn't stored).
- **Dead/failed bills:** no schema signal exists for death, so the pipeline shows **last-reached stage as current** (claims position, not death). No struck/dimmed dead-state. Enacted fills the whole pipeline. NULL-stage bills (123) render unreached.
- **Two columns:** LEFT (~1.6 flex, border-right) = SUMMARY (`--text-secondary` 12px) + RELATED NEWS (≤5 matched articles, `[SOURCE]` + headline link). RIGHT (~1.0 flex, darker) = label-value rows (SPONSOR linked / COSPONSORS count / COMMITTEE linked / INTRODUCED / LAST ACTION stacked) + action buttons (FULL BILL PAGE → / CONGRESS.GOV ↗).
- **Redundancy resolved:** old timeline strip removed (pipeline owns position; last-action is solely the LAST ACTION row); the STAGE label row removed from the metadata list (pipeline shows current stage).
- **Shared component, one prop:** `variant="compact"` (the existing `compact` boolean, used by the dashboard ACTIVITY expand) renders **pipeline + summary only** — drops the right metadata column AND related news. **Compact also skips the `/api/bill/[id]/panel` fetch entirely → 0 queries** on the dashboard expand (full `/bills` stays at 2). This is a deliberate content reduction on the dashboard glance surface (it previously showed committees + news via the shared full panel).
- **Compact label tweak:** the compact pipeline abbreviates OTHER CHAMBER → "OTHER CH." to keep all six nodes single-line at the smaller size; the full `/bills` pipeline keeps "OTHER CHAMBER". Driven by an optional `compactLabel` on the pipeline stage table + the `compact` flag.
- **No-news empty state:** the full-panel RELATED NEWS section, when zero articles, now renders the label + a muted "No related news" (`--text-dim`, reusing `.bill-expanded-news-empty`) instead of hiding entirely. Full `/bills` only — the compact variant still drops news entirely.

**HO 192 — sponsor hover card + name affordance**
- `getFeedBills` gained a **`LEFT JOIN members msp ON msp.bioguide_id = bills.sponsor_bioguide_id` selecting `msp.depiction_url AS sponsor_depiction_url`** (mirrors `getSponsorProductivity`; verified 1:1, no row multiplication). `FeedBill` gained `sponsor_depiction_url?: string | null`.
- **Sponsor hover card** (`SponsorNameWithCard`) on the SPONSOR name — pure-CSS hover/focus reveal (tape/topic-chip popover idiom), opaque `--bg-row-hover` + border + shadow, absolute (no layout shift): 46×60 avatar from `depiction_url` (`onError` → party-colored initials, the `SponsorPhoto`/`MemberHeader` pattern) + name + party-state in party color. The name is **highlighted (amber/link treatment)** so the interaction is discoverable; the `<a>` still navigates to `/members/[bioguideId]` (card is additive). Unmatched sponsors (no bioguide) get plain text, no card.
- Applied to **both the expanded-panel SPONSOR row AND the collapsed bill row's sponsor** (e.g. "HARRIS [R-MD]"). [Confirm in the live files how the collapsed-row card handles the row's `overflow:hidden` — it may use the portal-tooltip approach (like the per-row topic codes) rather than the CSS popover, if the row clips. Report which.]
- **Scope:** `depiction_url` (and `sponsor_bioguide_id`) are in `getFeedBills` only → the card is **`/bills`-only**, degrading to absent on `/stale`/`/changes`/`/watchlist` (consistent with the existing sponsor link).
- Implementation notes: the `lib/queries` import in the panel is **type-only** (importing runtime `normalizePartyVariant` would pull `next/cache` into the client bundle and break it — party normalization inlined); `noUncheckedIndexedAccess` required a typed `as const` color map.

## Phase 1 — light diagnostic (then proceed)
1. Read the SKILL sections on `BillExpandedPanel` (the HO 188 entry — it'll need the redesign overlaid), `getFeedBills`, the client-island count, and any bill-row / feed-row notes.
2. Grep `"use client"` for the island count — HO 191/192 may have added `SponsorNameWithCard` or the pipeline as islands, or kept it server/CSS. Report whether the count changed from 26.
3. **Trust the live files** — `view` `components/BillExpandedPanel.tsx`, the collapsed bill-row component, `lib/queries.ts` (getFeedBills + the new JOIN), the stage-pipeline component, the relevant CSS. Report stale sections + edit plan, brief HALT to confirm, then proceed.

## Phase 2 — reconcile
- Rewrite the `BillExpandedPanel` SKILL entry: the redesign (row header → stage pipeline → two columns), the pipeline mechanics (reached/current/unreached, dated INTRO + current only, dead-bill = last-reached-as-current), the compact variant (pipeline+summary, 0-query fetch-skip, OTHER CH. label), the no-news empty state. Keep the HO 188 enrichment facts (sponsor link, cosponsor count) folded into the new structure.
- Add `getFeedBills`' `depiction_url` JOIN + the `sponsor_depiction_url` field.
- Document the sponsor hover card (both collapsed + expanded, `/bills`-only scope, the photo source + initials fallback, the name-highlight affordance, the type-only-import / inlined-party-normalization note).
- Preserve voice/structure; factual only; update the island count.

## Verification
- Show the diff (word-level if large).
- Confirm: the panel redesign (pipeline + two columns), the compact variant + 0-query skip, the no-news state, the `depiction_url` JOIN, the sponsor hover card (both states, `/bills`-only), island count.
- Commit: `docs: reconcile SKILL.md for HO 191–192`.
- Docs-only — confirm no code touched.

## Out of scope
- No code changes — documentation only.
- Any next bill-panel work — this documents the current shipped state.
