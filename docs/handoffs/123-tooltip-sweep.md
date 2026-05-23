# 123 — Tooltip sweep for readability

## What this is

The "readability" lens narrowed to tooltips. Native HTML `title` attributes on the categories of abbreviated/coded text that a new user can't decode without context: bill-type acronyms, topic codes, stage notation, race rating sources. Plus whatever else surfaces during the audit step.

Foundation pattern is already in place — HO 118's `[+N]` pill uses native `title` for the companion bill IDs. Same approach here: zero JS, browser-default tooltip behavior, accessible enough for "extra context" use, consistent with prior work. No custom tooltip component unless a specific surface ever needs rich content (none of the named offenders do).

Single-layer (lib + components only). No Phase 1 halt; audit and implementation in one pass.

## In scope

- New `lib/labels.ts` (or extension of `lib/enums.ts` for cohesion — Code's call) with four mappings:
  - `BILL_TYPE_LABELS` for all eight bill types
  - `TOPIC_LABELS` for all 22 topic codes
  - `STAGE_LABELS` for the six stages
  - `RACE_RATING_SOURCES` for Inside Elections / Cook / Sabato
- Native `title` attribute application at the render site of each abbreviation:
  - Bill type prefix in `BillRow` and anywhere else bill IDs render
  - Each tag in `TopicTags`
  - The label in `StageIndicator`
  - Source + verdict pills in the competitive-races block
- Audit pass: grep `app/`, `components/`, `lib/` for other user-facing abbreviations and apply the same pattern to any that aren't already self-evident.

## Out of scope

- Custom tooltip component (Radix, Floating UI, hand-rolled). Native `title` is the right tool for this use case.
- Mobile-touch tooltip equivalents. Native `title` doesn't fire on touch. Known limitation; future design-language work can revisit.
- `aria-label` for accessibility-critical surfaces. Use `title` only here; existing semantics carry where needed.
- Rewording the abbreviations or stage labels themselves. The terminal vocabulary stays; tooltips explain it.
- Touching party-state codes (`[R-NJ]`, `[D-CA]`). Self-evident to the target audience.

## Implementation

### Labels module

```ts
// lib/labels.ts (or add to lib/enums.ts)
import type { BillType, Topic, Stage } from './enums';

export const BILL_TYPE_LABELS: Record<BillType, string> = {
  hr:      'House Bill',
  s:       'Senate Bill',
  hjres:   'House Joint Resolution',
  sjres:   'Senate Joint Resolution',
  hconres: 'House Concurrent Resolution',
  sconres: 'Senate Concurrent Resolution',
  hres:    'House Simple Resolution',
  sres:    'Senate Simple Resolution',
};

export const TOPIC_LABELS: Record<Topic, string> = {
  // Every code in lib/enums.ts maps to a display name.
  // Copy display names from the existing FooterLegend if they're already defined there;
  // otherwise match the SKILL.md taxonomy table.
};

export const STAGE_LABELS: Record<Stage, string> = {
  introduced:    'Introduced; filed but not yet referred to committee',
  committee:     'In committee; under review',
  floor:         'On the floor of the originating chamber',
  other_chamber: 'Passed to the other chamber',
  president:     "On the president's desk",
  enacted:       'Enacted into law',
};

export const RACE_RATING_SOURCES = {
  inside_elections: 'Inside Elections with Nathan L. Gonzales',
  cook:             'Cook Political Report',
  sabato:           "Sabato's Crystal Ball (UVA Center for Politics)",
};
```

The `STAGE_LABELS` prose above is a starting point. If it reads off for the terminal aesthetic, Code can tighten; the goal is "what's happening to this bill" in one short clause.

### Component changes

Native `title` on the smallest semantically-correct element. Don't wrap whole rows.

```tsx
// BillRow.tsx — bill-type prefix
<span title={BILL_TYPE_LABELS[bill.bill_type]}>{bill.bill_type.toUpperCase()}</span>{' '}{bill.bill_number}

// TopicTags.tsx — each tag
<span title={TOPIC_LABELS[topic]} className={...}>{TOPIC_CODE[topic]}</span>

// StageIndicator.tsx — wrap the label
<span title={STAGE_LABELS[stage]}>{stage_label}</span>

// Competitive races — each rating pill
<span title={RACE_RATING_SOURCES[source]}>{SOURCE_CODE[source]}</span>
```

### Audit step

After the named four, sweep for other user-facing abbreviations:

```
grep -rn "uppercase\|toUpperCase" components/ app/
```

Likely candidates to inspect: chamber tags (HSE / SEN), days-since color mode labels (`/stale`, `/president`), the activity feed's stage-transition arrows in expanded panels, any abbreviated header on the new home blocks (TOP STALLS, TOPIC DISTRIBUTION column labels). Apply tooltips to any that aren't already self-evident; skip the ones a typical reader would already understand.

Report what got added in the commit message.

### Verification

1. Hover each named offender on `/`, `/bill/[id]`, `/changes`, `/stale`, `/president`, and the competitive-races block. Tooltip shows expected text.
2. `Record<>` types catch any missing label mappings at compile time.
3. Type-check clean.
4. No visual layout shift from adding the attributes (none expected; `title` is purely behavioral).

## Acceptance

1. `lib/labels.ts` (or `lib/enums.ts` extension) contains the four named mappings, all values fully populated and type-checked against their enum.
2. Native `title` attributes applied to bill-type prefixes, topic tags, stage indicators, and race rating pills across every surface where they render.
3. Audit grep run; any additional non-obvious abbreviations get the same treatment, noted in commit message.
4. Type-check clean, working tree clean, pushed.
5. Commit: `feat: tooltip sweep for readability (HO 123)`

## Notes

- Mobile-touch is a known gap. Native `title` doesn't fire on tap, so the same readability problem exists on phones. Not blocking — the design-language pivot can revisit when it's time. Filing as a known issue.
- `TOPIC_LABELS` should match whatever display names the existing `FooterLegend` already uses. Don't invent new names; reuse what's there to keep the legend and the tooltips in sync.
- For `STAGE_LABELS`, the active phrasing matters more than the exact wording — "In committee" beats "Committee stage" because the latter forces the reader to translate.
- If a surface during the audit needs rich content (e.g., a tooltip that links somewhere, or shows a small chart), that's the signal to introduce a real tooltip component. Park as a follow-up; don't expand scope here.
