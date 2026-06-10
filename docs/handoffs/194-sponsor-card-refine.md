# HO 194 — Sponsor hover card: size + layout refinement

## Why

Approved design refinement to the HO 192 sponsor hover card (`SponsorHoverName`, used on both the expanded panel and the collapsed row). Bigger photo, repositioned layout, refined text hierarchy. Everything else about the card (the dotted-underline trigger, instant show/hide, the no-photo fallback, `/bills`-only scope) is unchanged.

## The spec

**Photo:** enlarge to **80px wide × 96px tall** (bioguide 5:6 ratio). The photo is the dominant element and sets the card height. `--border-strong` frame, 3px radius.

**Card:** ~268px wide, `--bg-row-hover` bg, `--border-strong` border. **Photo left + text right**, gap ~13px, **text top-aligned to the photo** (not vertically centered).

**Text** (natural order — NOT the row's "Last, First" format):
- `Rep./Sen. <First Last>` — `--text-primary`, 13px, bold
- party-district bracket (e.g. `[R-MD-1]`) — party-colored, 12px
- `<State> · <Nth District>` — `--text-dim`, 10px

**Unchanged from HO 192:** dotted-underline trigger + name highlight, instant CSS show/hide, `onError`→initials fallback when no photo, `/bills`-only (gated on `sponsor_bioguide_id`).

## Phase 1 — data check (then proceed)

The new text layout wants data the card may not currently format:
1. **Natural-order name** (`Rep./Sen. First Last`). The card currently derives from `FeedBill` — which carries `sponsor_name` in what format? If it's "Harris, Andy" (Last, First), report whether First/Last are separately available (or parseable) to produce "Rep. Andy Harris", and where the **Rep./Sen. chamber prefix** comes from (is chamber on the bill/sponsor data, or derived from bill type / a member lookup?).
2. **District** (`<State> · <Nth District>`). The party-district bracket `[R-MD-1]` implies district is encoded somewhere. Report whether state + district number are available as separate fields (to render "Maryland · 1st District") or only as the combined bracket. For **Senators** (no district), what should the third line read — just `<State>`, or `<State> · Senate`? (Confirm and recommend.)
3. If any piece (chamber prefix, first/last split, district number, full state name) **isn't on the current card data**, report whether it's a cheap derive (e.g. chamber from bill type, state-abbr→full-name map) or needs threading a new field through `getFeedBills`. Recommend the lowest-cost path — if "Rep./Sen. First Last" needs a new field and the existing data only cleanly gives "Last, First [R-MD-1]", flag it so we decide whether the reformat is worth a data change or we adjust the spec to fit available data.

**Brief HALT** with the data findings + any spec-vs-data gaps. If everything's already available (or a trivial derive), just confirm and proceed — this is a small visual refinement, no heavy gate. Only stop for sign-off if a piece needs a real data change.

## Phase 2 — implement
- Resize the photo to 80×96, `--border-strong` frame, 3px radius.
- Relayout the card: ~268px, photo-left/text-right, ~13px gap, text top-aligned.
- Text: `Rep./Sen. First Last` (13px bold `--text-primary`) / party bracket (12px party-colored) / `State · Nth District` (10px `--text-dim`).
- Apply in `SponsorHoverName` so BOTH the expanded panel and collapsed row update (shared component — one change, both surfaces).
- Keep: trigger affordance, instant show/hide, initials fallback, `/bills`-only gating.

## Verification
- Hover a sponsor (expanded panel AND collapsed row) → the larger 80×96 photo, photo-left/text-right, text top-aligned, the three text lines in the right styles/order.
- Natural-order name ("Rep. Andy Harris", not "Harris, Andy").
- Senator card reads sensibly on the third line (per the Phase-1 decision).
- Initials fallback still works when no photo (test or simulate).
- Card doesn't clip at the panel edge or against adjacent rows (the larger card is taller — re-confirm the collapsed-row downward-open still clears).
- Both surfaces match (shared component).
- Type check passes.
- Code uses the running dev server (:3000, already up — hot-reload, don't restart); Corey eyeballs.

## Out of scope
- The card's behavior/trigger/scope (unchanged from HO 192).
- Cosponsor cards.
- SKILL.md — flag for the next sweep (minor; can batch with future bill-panel doc updates).

## Note
- The card is taller now (96px photo vs the old 60px) — the collapsed-row card opens downward over the next row, so confirm the taller card doesn't collide awkwardly; clamp/flip if needed (the HO 192 finding was no clipping ancestor, but the taller card covers more of the row below).
