> **RESOLVED** — premise stale. SKILL already matched live source (kept current by skill-sweeps 161/181/186/190/201/204); the stale grid citation lives in the HO 130/215 handoff .md files, not SKILL. No change.

# HO 216 — SKILL fix: stale BillRow grid + inline-expand blocks

## Why

HO 215's bad premise traced to a stale SKILL §Layout grid. SKILL line ~244 still claims a six-column row `24px 86px 1fr 150px 96px 150px` with a `.feed-header-row` — that's pre-HO-125. The real collapsed grid is `1fr 40px 36px` and the row is headerless (no `.feed-header-row`, no column-label band). This drift is what caused HO 215 to re-scope a shipped feature; fixing it now stops the next bad premise.

This is **documentation-only.** No code changes. Read the live source, correct SKILL to match it.

## Scope — two SKILL blocks, both suspected stale

### 1. `### Layout grid` (≈ SKILL line 240–251)

Currently says: six-column `24px 86px 1fr 150px 96px 150px` → `[expand-arrow][bill-id][title-and-sponsor][stage][action-date][topics]`, `.feed-row` + `.feed-header-row`, with a 700px block (`.col-date` hidden, stage short-form, topics first+`+N`, chips wrap).

Read the **actual** current definitions and rewrite to match:
- `components/BillRow.tsx` — the real grid template, the cell order, the watch-star slot (HO 127), the media-attention cell (HO 130/`MediaAttentionCell`), the compact/ticker variant if it differs.
- `globals.css` — `.feed-row` (Code's report cited `1fr 40px 36px` near line 1018; confirm the live value and the full cell breakdown), `.col-media-attention` (HO 130, ~line 1030), and whether `.feed-header-row` still exists at all (report says headerless — confirm and remove the reference if so).
- The current 700px mobile behavior — which columns hide, what actually happens now vs. the 4 bullets SKILL lists.

Rewrite the block to describe the **live** grid. If the row is genuinely headerless, say so explicitly and delete the header-row sentence — that's the specific line that misled HO 215.

### 2. `### Inline expand on the feed` (≈ SKILL line 254–256)

Currently says: `?expanded=<bill-id>` URL-driven, server-rendered `<ExpandedPanel>` sibling, left border `--accent-amber`, contains introduced + last-action + full summary + `[★ WATCH][VIEW DETAIL ↗][CONGRESS.GOV ↗]`.

This predates HO 188 (enrich) and HO 191 (panel redesign → stage pipeline + two columns). Almost certainly stale. Read the real current expanded panel:
- The component (HO 191 named it `BillExpandedPanel` — confirm the actual name/path).
- Its real structure (row header → stage pipeline → two columns: summary+news left, metadata+buttons right, per HO 191).
- The real expand mechanism — is it still `?expanded=`, or client-state via `BillRowList` (HO 155 found the feed uses client-side state)? Capture what's live.

Rewrite to match. If HO 155/191 already superseded this, the block should describe the pipeline + two-column panel, not the old vertical stack.

## Don't

- Don't change any code. SKILL only.
- Don't invent values — every number/name in the rewrite comes from a file you actually read this session, cited.
- Don't touch other SKILL sections. If you spot other drift while reading, **list it at the end for a future sweep** — don't fix it here.

## Verification / report

Post in chat, before committing:
1. The live `.feed-row` grid template (verbatim from `globals.css`) + the live cell order from `BillRow.tsx`.
2. Confirm headerless (no `.feed-header-row`) or correct me.
3. The live expand mechanism + the live expanded-panel structure.
4. The diff you're writing into SKILL (both blocks).
5. Any other drift spotted, listed for later (don't fix).

## Commit

`docs(skill): correct stale BillRow grid + inline-expand blocks (HO 216)`

Working tree clean after, pushed.
