# HO 195 — Members page: chrome consistency (1 of 4)

## Why

First of four split handoffs redesigning `/members` (the MEMBERS tab). This one brings the Members masthead in line with the inner-page chrome — and closes the long-standing loose end that **`/members` is the last page still on the legacy HeaderBar search band** (per SKILL). Chrome only; the list-row bar, scatter, and expanded card are HO 196/197/198.

## The changes

1. **Cursor position.** Move the blinking `_` to the END of the full inline masthead string, after the sync info:
   `Congress Terminal:\119TH\Members> · 15,519 BILLS · UPDATED 3:33 AM MT _`
   **This is an intentional divergence from the Bills page** (where the cursor is glued to `>`). On Members it trails everything. Deliberate — note it in the commit/comment so a future reader doesn't "fix" it as drift.

2. **Contrast lift on the inline sync.** Currently `--text-dim`. Change: the sync run → `--text-muted` (#94a3b8); the bill-count number → `--text-secondary` (#cbd5e1). Stays inline with the title, just more legible.

3. **Drop the redundant top `search bills...` chrome-row input ON MEMBERS ONLY.** Wrong context — it duplicates the page's own `search members...` in the sub-header. Keep `search members...`. **The row must collapse cleanly — no dead gap** where the input was.

4. **INCLUDE CEREMONIAL toggle** — Phase 1 decides relocate-vs-remove:
   - The spec wants it moved out of the masthead chrome INTO the sub-header filter row (the `ALL/HOUSE/SENATE · ALL PARTIES · ALL STATES · VOLUME/PASS RATE` row), at the right edge adjacent to VOLUME/PASS RATE.
   - **BUT** if Phase 1 finds ceremonial has no members-page effect (it's a bills filter), **remove it from this page entirely** rather than relocate a no-op.

5. **Title/glyph match Bills exactly:** amber `\` and `>` (`--accent-amber`), `--text-primary` path. Only the cursor position differs.

## Phase 1 — Diagnostic (HALT after)

1. **The chrome-row mechanics (the crux).** How does `/members` currently render its top row — is it on the legacy HeaderBar search+ceremonial band, or does it pass `pageOwnsControls` like `/bills`/`/changes`/`/stale`? Report exactly, because this determines whether dropping the `search bills...` input is a clean prop change or requires migrating members onto the `pageOwnsControls` path (the same migration the chrome rethink left undone for this page). Report how to drop the input so the row collapses with NO dead gap.
2. **INCLUDE CEREMONIAL on members.** Does the members page read/use the ceremonial param at all — does toggling it change the member list/ranking, or is it inert here (bills-only)? **If inert → remove it from this page entirely; if it has a real effect → relocate it to the filter row.** Report which and recommend.
3. **Masthead cursor + sync.** Confirm where the Members masthead string is built and that moving the cursor to the end + lifting the sync contrast is a contained change (the breadcrumb path itself is the shared `BreadcrumbMasthead` — confirm the cursor-trailing variant doesn't break the Bills page's cursor-glued-to-`>` behavior; this likely needs a per-page flag or a Members-specific masthead arrangement since the two now diverge).

**HALT. Report the chrome-row mechanics + the ceremonial relocate-vs-remove call + the cursor-divergence approach. The ceremonial call and whether this needs the `pageOwnsControls` migration are the two I want confirmed before building.**

## Phase 2 — Implement (after sign-off)
- Cursor to end of the inline string (Members divergence, flagged); contrast lift; drop the redundant `search bills...` (clean collapse); ceremonial relocated-or-removed per Phase 1; amber glyph match.

## Verification
- Members masthead matches Bills (amber `\`/`>`, `--text-primary` path), cursor trailing the full string, sync contrast lifted.
- Top `search bills...` gone, row collapsed clean (no gap); `search members...` sub-header search intact.
- Ceremonial relocated to the filter row (right edge, by VOLUME/PASS RATE) OR removed entirely per Phase 1.
- The Bills page cursor (glued to `>`) is UNAFFECTED by the Members divergence.
- Type check passes.
- Code uses the running dev server (:3000, hot-reload); Corey eyeballs.

## Out of scope
- List-row bar (HO 196), scatter (HO 197), expanded card (HO 198).
- The COMMITTEES tab.
- Mobile <700 (deferred).
- SKILL.md — flag for the next sweep (with HO 194).
