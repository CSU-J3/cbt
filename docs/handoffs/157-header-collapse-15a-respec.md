# 157 — Header collapse + font-size bands (spec 15a re-spec)

## What this is

The deferred half of 15a. HO 156 shipped the skeleton (breakpoint vocabulary, gutter mechanism, `MobileNavDrawer` island). This pass adds the two things HO 156 explicitly held back because the original spec was written against a stale header model: header collapse rules against the **real** two-header model, and font-size bands derived from **real shipped ≥1024 values**.

This supersedes the collapse + sizing rules from the original 15a (HO 156's handoff text). Those described a single header with a secondary nav row that HO 134 deleted. This re-spec is correct to what shipped.

**No fresh diagnostic.** HO 156 Phase 1 already mapped the real header model (recorded below and in SKILL.md). This is direct implementation. If Code finds any element whose real ≥1024 value differs from the table below, it halts and reports rather than applying — but the values here are HO 156's frozen readings, so that shouldn't fire.

## Real header model (from HO 156 Phase 1)

- **HomeHeader** — dashboard (`/`) only. Holds the prompt (`Congress Terminal:\>`), lead-in prose, blinking cursor, subhead.
- **HeaderBar** — every other page. Title `CBT // 119th Congress`, a bills-count line, single flat nav.
- **page-masthead** — per-page hero (`Feed:\>`, `Members:\>`). Separate from both headers.
- **GroupTabs** — sub-nav strip on landing pages. Not header chrome.

The old secondary STALE·CHANGES·PRESIDENT·WATCHLIST nav row was deleted in HO 134. Nav is one flat row of 6 group landings.

## Sizing principle

One hero element per surface **grows** on mobile; everything else **holds** or moves to the drawer. **Nothing shrinks.** (The original spec's title-shrink was the wrong model — this is the correction.)

## Font-size bands (≥1024 / 700–1023 / <700)

All derived from real shipped values.

| Element | ≥1024 | 700–1023 | <700 | Behavior |
|---|---|---|---|---|
| HomeHeader prompt | 18px | 18px | 24px | **Grows** (hero; keep current 24px mobile grow) |
| HomeHeader lead-in | shown | hidden | hidden | Cursor goes with it (already CSS, gate the `@media`) |
| HomeHeader subhead | 11px | 11px | 11px | Holds; text abbreviates, size constant |
| HeaderBar title | 16px | 16px | 16px | Holds, one line to 320px |
| HeaderBar count line | 11px | 11px | 11px | Holds; wraps to 2 lines on narrow, never truncates |
| HeaderNav items | 16px | 16px | drawer | Moves to drawer <700 |
| home-nav (icon) | 14/16px | 14/16px | drawer | Moves to drawer <700 |
| page-masthead | holds | holds | holds | Do **not** grow (GroupTabs sits under it; growing masthead + tab strip eats the viewport) |
| GroupTabs | 14px | 14px | 14px | Holds; overflow behavior **deferred** (see below) |

## HeaderBar collapse rules (settled)

- **Title** holds 16px, stays one line down to 320px (~20 chars ≈ 140px, fits comfortably).
- **Count line** holds 11px; let it **wrap to a second line** on narrowest phones rather than truncate.
- **Nav** (6 flat items) moves into the shared `MobileNavDrawer` <700px — the same drawer HomeHeader uses (shipped HO 156).

## HomeHeader collapse rules (settled)

- **Prompt** grows to 24px <700px (keep current behavior — it helps the 320px fit).
- **Lead-in + blinking cursor**: shown ≥1024px only, hidden both lower bands. Confirm the existing `@media (max-width: 1023px)` gate from HO 156's cursor work covers this; if HO 156 only gated the cursor and not the full lead-in prose, extend it to hide the whole `.home-header-lead`.
- **Subhead** holds 11px; text abbreviates per the existing rule (`· HH:MM MT · N BILLS` below 700px), size constant.
- **home-nav** moves into `MobileNavDrawer` <700px.

## Implementation notes

- **Both headers feed the same drawer.** HO 156 mounted `MobileNavDrawer` in both. This pass moves `HeaderNav` (HeaderBar) and `home-header-nav` (HomeHeader) into it <700px — confirm both nav lists resolve to the same 6 flat NAV_ITEMS so the drawer content is identical regardless of which header mounted it.
- **page-masthead holds, doesn't grow.** Explicit anti-rule: the per-page `Feed:\>` / `Members:\>` masthead must not adopt the HomeHeader prompt's mobile grow. It has a GroupTabs strip under it; a growing masthead plus the tab strip would eat the phone viewport. Hold its display size across all bands.
- **Count line wraps, never truncates.** On the narrowest phones the `CBT // 119th Congress` + bills-count line may need two lines. Let it wrap. No ellipsis, no truncation — the count is information, not chrome.

## Deferred to the mobile overflow pass

Bundled with filter-bar wrapping (#7) and markets/breaking marquee (#6) so the horizontal-overflow convention is decided **once** across all three surfaces, not piecemeal:

- **GroupTabs wrap-vs-scroll-x.** Until that pass, GroupTabs holds at its 14px desktop value and is not mobile-adapted. Carry this recommendation in: scroll-x with a faint right-edge fade as the more-exists affordance, active tab pinned visible on load. **But that introduces a sub-1024 motion exception, so it's an explicit approval gate in that pass, not a default.**

## Constraints

- Desktop ≥1024px **pixel-unchanged**, verified against the real frozen values from HO 156 (not the original guessed table).
- **No sub-1024 motion exception** introduced this pass. The dashboard blinking cursor stays desktop-only as before.
- No light mode. No new color tokens.

## Out of scope

- GroupTabs mobile adaptation (overflow pass).
- Filter-bar wrapping (#7 / overflow pass).
- Markets tape + breaking-news marquee on touch (#6 / overflow pass).
- The HO 147 tooltip primitive's mobile equivalent (15c).
- Feed accordion / members scatter mobile (15b).
- Any new drawer interaction — drawer behavior shipped in HO 156, untouched here.

## Acceptance

1. Font-size bands applied per the table; every ≥1024 value matches HO 156's frozen readings (desktop unchanged).
2. HomeHeader: prompt grows to 24px <700; lead-in + cursor hidden below 1024; subhead holds 11px and abbreviates; home-nav moves to drawer <700.
3. HeaderBar: title holds 16px one-line to 320px; count line holds 11px and wraps (never truncates) on narrow; nav moves to drawer <700.
4. page-masthead holds its size across all bands — does not grow.
5. Both headers' nav resolves to the same 6 NAV_ITEMS in the shared drawer.
6. GroupTabs holds at 14px, unmodified, deferred to the overflow pass.
7. No motion renders below 1024px; cursor stays desktop-only.
8. `npm run typecheck` and `npm run build` clean.
9. `SKILL.md` updated: the font-size band table, the "one hero grows, nothing shrinks" principle, HeaderBar + HomeHeader collapse rules, the page-masthead anti-grow rule, and the GroupTabs deferral with its overflow-pass coupling.
10. Single commit: `feat: header collapse + font-size bands (HO 157, spec 15a re-spec)`.

## Notes

- **Why nothing shrinks.** The original 15a shrank the title on mobile, which inverted the real shipped behavior (the dashboard prompt grows). The corrected model: each surface has one hero that grows for thumb-reach legibility, and everything else either holds its size or relocates to the drawer. Shrinking text on a small screen is the wrong instinct — small screens need the primary mark bigger, not smaller.
- **Why page-masthead is the exception to the grow rule.** It's a hero by shape (`Feed:\>`), so the instinct is to grow it like the dashboard prompt. But it's the only hero that ships with a GroupTabs strip directly beneath it. Two stacked growing elements would consume the top third of a phone before any content. Holding the masthead keeps the content above the fold.
- **GroupTabs is deferred on purpose, not forgotten.** Its overflow (scroll-x vs wrap) is the same problem the filter bars and the marquee have. Solving it three different ways would fragment the touch convention. One decision in the overflow pass, applied to all three. The scroll-x-with-fade recommendation is the likely answer but it costs a motion exception, so it's a deliberate gate there.
- **No diagnostic phase.** HO 156 Phase 1 is the diagnostic for this. The values are frozen, the model is mapped. If anything in the table contradicts the live code, that's a signal something changed since HO 156 — halt and report rather than applying.
