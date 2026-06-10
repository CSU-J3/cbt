# HO 198 — Members page: expanded member card 3-column redesign (4 of 4)

## Why

Last of four `/members` redesign handoffs (195 chrome, 196 list bar, 197 scatter shipped; 199 dedupe done). Replace the expanded member card's full-width vertical stack (~650px tall) with a **3-column layout matching the HO 191 bill panel** (~280px). Rearranges data the panel already fetches — no new queries.

## Structure (top to bottom)

**Row header** (unchanged height): caret · rank # · name · party bracket · right-aligned "N bills · X% enacted".

**LEFT RAIL (~200px, border-right, darker `--bg-panel`):**
- Photo 96px wide (bioguide ratio), `--border-strong` frame. **Reuse the same photo source as the sponsor card (`members.depiction_url`)** — don't refetch.
- Identity: "Sen./Rep. <First Last>" (`--text-primary` 13px bold) · party bracket (party-colored) · state (`--text-dim`).
- Stat block: TOTAL BILLS · ENACTED (n + %) as label-value rows.
- STAGES: inline glyph run, `--stage-*` tokens (▸ INTRO n · COMMITTEE n · ▸▸ FLOOR n).
- TOPICS: up to 3 topic chips with counts (topic-color borders).
- Buttons stacked: VIEW DETAIL → (amber border) · OPEN IN FEED → (soft border).
- **DROP the state flag image** (decoration).
- **DROP the floating "N ISSUES ×" tag** (dev artifact — Phase-1 confirm safe to remove; per SKILL the "data-quality issues" badge was deferred with "no existing schema signal; ships clean", so it shouldn't be wired to anything real).

**MIDDLE (~1.5 flex, border-right):**
- RECENT BILLS + "· N total" dim count.
- Cap 6–8 rows: bill ID (amber) · truncated title · right-aligned date.
- "SEE ALL N BILLS →" (links to the member detail page's full list).

**RIGHT (~1 flex, darker `--bg-panel`):**
- COMMITTEES + "· N" dim count.
- Cap ~8 visible: committee name · chamber tag (dim) · CHAIR badge where applicable (amber border). Subcommittees indented `└`.
- "+N more subcommittees" collapse for overflow.

Net card height ~650px → ~280px.

## Phase 1 — Diagnostic (HALT after)

1. **The current expanded panel.** Read `SponsorExpandedPanel` (per SKILL: photo + state flag + stats + stage glyphs + top topics + scrollable bills + COMMITTEES via `getMemberCommittees` with CHAIR/RANKING badges + subcommittee captions + CAUCUSES via `getMemberAffiliations`). Report its current structure and confirm it ALREADY fetches everything the 3-column layout needs (recent bills, committees w/ chair+subcommittee, top topics, stage counts, stats) — so this is a rearrange, **no new queries**. Flag anything the new layout needs that ISN'T already fetched.
2. **Photo source.** Confirm `depiction_url` (the HO 192/194 sponsor-card source, also used by MemberHeader) is available on the expanded-panel data path. Reuse it — don't add a fetch.
3. **The "N ISSUES" tag.** Confirm it's the dev artifact (the deferred spec-7 data-quality badge — SKILL says no schema signal, ships clean). Confirm it's safe to remove (not wired to anything real). Report where it's rendered.
4. **CAUCUSES.** The current panel shows CAUCUSES (HO 152, `getMemberAffiliations` + `CaucusBadge`). The new 3-column spec doesn't list caucuses — does it drop them, or fold them somewhere (left rail under topics)? **Report and recommend** — the spec is silent, so flag it rather than silently dropping a working feature. (Lean: keep them, fold into the left rail under TOPICS, or note if there's no room and recommend dropping.)
5. **Expand mechanism.** The members panel uses URL-driven single-open (`?expanded=<bioguide_id>`, per SKILL) — distinct from the `/bills` client-state model. Confirm the 3-column rebuild stays on the existing `?expanded=` mechanism (don't change the expand wiring, just the panel's internal layout).

**HALT. Report: the data-already-fetched confirm (+ anything missing), the "N ISSUES" removal confirm, and the CAUCUSES decision (drop vs. fold — recommend). Wait for sign-off.**

## Phase 2 — Implement (after sign-off)
- Rebuild `SponsorExpandedPanel` as the 3-column layout (left rail / middle recent-bills / right committees).
- Reuse `depiction_url` for the photo; drop the state flag + the "N ISSUES" tag.
- Caps: recent bills 6–8 + "SEE ALL", committees ~8 + "+N more subcommittees".
- CAUCUSES per the Phase-1 decision.
- Keep the `?expanded=` mechanism; no new queries.
- Match the HO 191 bill-panel idiom (column borders, darker side rails, terminal density).

## Verification
- Expanding a member shows the 3-column card (~280px, down from ~650px): left rail (photo from depiction_url, identity, stats, stages, topics, buttons), middle (recent bills, capped, SEE ALL), right (committees, chair badges, subcommittees, +N more).
- No state flag, no "N ISSUES" tag.
- CAUCUSES handled per the decision.
- Photo reuses depiction_url (no new fetch); no new queries overall.
- The `?expanded=` single-open still works (expand/collapse, one at a time).
- VIEW DETAIL → and OPEN IN FEED → links go to the right places.
- Type check passes.
- Code uses the running dev server (:3000, hot-reload); Corey eyeballs an expanded member.

## Out of scope
- The member detail page (`/members/[bioguideId]`) — the card links to it, doesn't redesign it.
- The COMMITTEES tab.
- Mobile <700 (deferred — the 3-column card needs a stack rule there; note, don't spec).
- SKILL.md — this completes the Members arc; the batched sweep (194 + 195–199 + 198) comes next.
