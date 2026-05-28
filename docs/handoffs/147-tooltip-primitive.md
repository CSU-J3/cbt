# 147 — Tooltip primitive

## What this is

The rich-content tooltip component that specs 1, 5, 7, and 8 from the design session all depend on. This is the component HO 123 explicitly deferred: that handoff used native HTML `title` and noted "if a surface needs rich content — a tooltip that links somewhere, or shows a small chart — that's the signal to introduce a real tooltip component." The design session produced that signal (label + body + caret + a data variant with click hints for chart-element hovers). This builds it.

Scope is the primitive plus a first application to the two affordances the design names (dotted-underline term, `?` panel badge). App-wide placement — which terms across which surfaces get tooltips — is the cleanup audit (HO 154 / spec 8), not this handoff. Build the tool; the sweep comes later.

## Reconciliation with HO 123

HO 123 shipped `lib/labels.ts` (`BILL_TYPE_LABELS`, `TOPIC_LABELS`, `STAGE_LABELS`, `RACE_RATING_SOURCES`) and applied native `title` attributes across bill rows, topic tags, stage indicators, and race pills. Two rules so this handoff doesn't create a competing system:

- **Content source is `lib/labels.ts`.** The new component reads the same mappings. Don't duplicate the label text.
- **Don't rip out the existing native `title`s in this handoff.** Migrating each native-`title` site to the component is the cleanup audit's job (HO 154), done systematically with the placement decisions. Here, the component coexists with the native `title`s already in the tree. The first applied instances (below) are net-new marked affordances, not replacements.

## Pre-flight (inline, no halt)

Single-layer component handoff, same posture as HO 123 — audit and build in one pass, no Phase 1 sign-off gate. But confirm three things before writing positioning code, and report findings in the commit message:

1. **Positioning lib.** Check `package.json` for an existing positioning/floating dependency (Floating UI `@floating-ui/react`, Popper, Radix). If one's already in the stack, use it for the flip/clamp logic. If not, hand-roll a small positioning helper (`lib/tooltip-position.ts`) rather than adding a dependency for one component — the clamp/flip math is ~30 lines. State which path you took.
2. **`lib/labels.ts` shape.** Confirm the four mappings exist and are exported as HO 123 left them. The component's content-by-key convenience wrappers read from these.
3. **Existing `?`/help glyphs.** Grep for any current `?` help affordances or hand-rolled hover popovers (the design references one on the legend). If something half-built exists, the component supersedes it; note what it replaces.

## Component: `components/Tooltip.tsx`

Client island (needs hover/focus state + positioning). Two trigger affordances and one panel, both driving the same panel.

### Triggers

- **Dotted-underline term.** Wraps inline text. 1px dotted `--text-dim` underline, `cursor: help`. Works on plain words and on colored codes — a colored code keeps its color and gains the underline (don't override the code's color with the underline color). Use `text-decoration: underline dotted` on the trigger span, or a `border-bottom` if that renders cleaner against the existing code colors; Code's call on which sits right.
- **`?` badge.** Bordered box, `--text-dim`, for panel/section-level help (e.g. the color-key header in spec 1). Small, mono.

Both triggers: focusable (`tabindex=0` if not natively focusable), `aria-describedby` pointing at the panel, opens on hover AND focus, Escape dismisses.

### Panel

- `--bg-panel` background, 1px `--border-strong`, 5px radius, ~9-11px padding, max-width 260px, subtle drop shadow.
- 6px caret pointing at the trigger.
- **Label row:** monospace 10px `--accent-amber` (the code or section title).
- **Body:** sans 12px `--text-secondary`, 1-2 short lines.
- **Data variant:** same panel chrome; body carries a count/share figure plus a `--text-dim` click hint (this is what the topic-bubble and chart-element hovers will use later — `42 bills · 12% · click to filter`). Expose it as a prop/mode, not a separate component.

### Timing (static principle — no fade)

- Appear: instant, no fade-in.
- Hover-in delay: ~400ms before showing, to avoid flicker when the cursor passes over a trigger en route elsewhere.
- Out: instant.
- This matches the dashboard's "cursor blink is the only motion" rule. No transitions on the panel.

### Positioning

- Default above the trigger.
- Flip below when there's no room above; clamp horizontally near viewport edges so the panel never clips off-screen.
- Caret tracks the trigger after clamping.
- Use the lib from pre-flight, or the hand-rolled helper.

### Tokens

Colors only from the existing system (`--bg-panel`, `--border-strong`, `--text-dim`, `--text-secondary`, `--accent-amber`). No new CSS vars. Direction/data colors, if ever needed, reuse existing tokens.

## First application

Apply the component to exactly two places so it's proven end-to-end without sprawling into the full sweep:

1. **Legend `?` badge (spec 1 / #2).** The color-key box header gets a `?` badge that, on hover/focus, pops the PARTIES / BILL TYPES / ACCENT content the trimmed legend no longer shows inline. This is the panel-level affordance.
2. **One dotted-underline term on a code.** Pick a single representative coded term already carrying a native `title` — a topic code in `TopicTags` or a stage label in `StageIndicator` — and give it the dotted-underline + component treatment as the proof of the inline affordance on colored text. Leave the rest on native `title` for HO 154.

Don't go further. The point is a working, styled, accessible primitive with two live instances, not the app-wide rollout.

## Out of scope

- App-wide tooltip placement (which terms, which surfaces). HO 154 cleanup audit.
- Migrating existing native `title` sites to the component. HO 154.
- Touch behavior (tap-to-open, tap-elsewhere-to-close). Deferred to the #15 mobile pass per every design spec.
- Chart-element wiring (topic bubbles, scatter dots). The data variant is built here; wiring it into specific charts happens in those charts' handoffs (the bubble drawer, the members scatter HO).
- Any new color tokens or motion beyond the existing cursor blink.

## Acceptance

1. `components/Tooltip.tsx` renders both trigger affordances (dotted-underline, `?` badge) and the panel with label + body, plus the data variant mode.
2. Hover and keyboard-focus both open the panel; Escape closes it; `aria-describedby` wired.
3. Panel flips below / clamps at viewport edges without clipping; caret tracks the trigger.
4. ~400ms hover-in delay, instant out, no fade.
5. Legend `?` badge pops PARTIES / BILL TYPES / ACCENT content; the inline dotted-underline instance works on a colored code without losing the code's color.
6. Content for coded terms reads from `lib/labels.ts`; no duplicated label text.
7. Tokens only; no new CSS vars; no motion added.
8. Existing HO 123 native `title`s untouched and still present.
9. `npm run typecheck` and `npm run build` clean.
10. `SKILL.md` updated: new component, the dotted-underline + `?`-badge idiom, the static-no-fade timing rule, and a one-line note that HO 154 owns the app-wide migration off native `title`.
11. Commit message states which positioning path was taken (existing lib vs hand-rolled helper) and what, if anything, it superseded. Single commit: `feat: tooltip primitive (HO 147)`.

## Notes

- **Why a component now when native `title` was right for HO 123.** HO 123's offenders needed only a decode string, which native `title` delivers with zero JS. The design now wants marked affordances (visible dotted underline / `?` badge), rich layout (label + body + caret), a data variant with a click hint, and keyboard/focus a11y that native `title` can't do. That's the threshold HO 123 named for introducing the real component.
- **400ms hover-in is deliberate.** Instant-show on hover makes tooltips fire every time the cursor crosses a trigger, which is visual noise on a dense terminal layout. The delay keeps them intentional. Out is instant because a lingering panel after the cursor leaves reads as lag.
- **Data variant lives here, wired later.** Building it now keeps the chart handoffs from each inventing their own hover panel. They import the mode; they don't rebuild it.
- **Coexistence is intentional, not debt to fix here.** Two tooltip systems in the tree for one handoff cycle is fine. HO 154 resolves it with the full placement audit, which is the right place to decide term-by-term what graduates to the component versus stays on native `title` versus drops entirely.
