# 121 — Topic alias map for LLM-suggested categories

## What this is

HO 120's backlog drain (1,511 bills, 0 failures) surfaced a consistent pattern: Gemini repeatedly proposes topic tags outside the `lib/enums.ts` taxonomy. Counts from that single run:

- `public_health` (×4)
- `human_rights` (×3)
- `animal_welfare` (×3)
- `homeland_security` (×2)
- `native_americans` / `native_american_affairs` (×2 combined)
- ones and twos for `urban_development`, `law_enforcement`, `humanitarian_aid`, `food_security`, `disability_rights`, `occupational_safety_and_health`, `infrastructure`, `manufacturing`, `small_business`, `ethics`, `business`, `poverty`

Each drop costs that bill one topic tag. Bills still get summarized; the bad tag just gets stripped.

Fix is a small `TOPIC_ALIASES` map applied at validation time, before the dropped-topic logger fires. Keeps the canonical taxonomy stable (roadmap argument: comprehension over coverage; 22 topics is already busy). Adds zero new categories. Catches the confident aliases; lets genuinely ambiguous ones keep dropping as signal for future taxonomy decisions.

Single-layer (validation logic only). No Phase 1 — the diagnostic was the drain log.

## In scope

- `TOPIC_ALIASES` const in `lib/enums.ts`
- Application at validation time, before the dropped-topic logger
- Dedup so alias collision (`public_health` + `healthcare` both proposed) becomes one `healthcare`
- Logger continues firing for tags that don't match the canonical taxonomy AND don't match an alias

## Out of scope

- Backfilling the ~26 bills that lost one tag each during the HO 120 drain. Each still has at least one valid topic and the loss is invisible in the dashboard. If a future analyst view depends on it, that's the trigger for a follow-up.
- Adding new categories to the canonical taxonomy. Roadmap says don't.
- UI changes. The filter UI and topic-color map operate on the canonical taxonomy; aliases never reach them.
- Re-running summarize against existing bills. The map is forward-looking only.

## Implementation

### `lib/enums.ts`

Add the const. Confident mappings only:

```ts
export const TOPIC_ALIASES: Record<string, Topic> = {
  public_health:                 'healthcare',
  human_rights:                  'civil_rights',
  native_americans:              'civil_rights',
  native_american_affairs:       'civil_rights',
  disability_rights:             'civil_rights',
  homeland_security:             'defense',
  humanitarian_aid:              'foreign_policy',
  urban_development:             'housing',
  law_enforcement:               'criminal_justice',
  food_security:                 'agriculture',
  occupational_safety_and_health: 'labor',
};
```

Anything debatable (`animal_welfare`, `small_business`, `manufacturing`, `ethics`, `infrastructure`, `business`, `poverty`) stays out. Those continue to fire the dropped-topic logger as signal. If any of them recur 10+ times over a quarter, that's the evidence to either expand the canonical enum or extend the map with a defensible target — a future decision, not this one.

### Validator change

Locate the topic-validation call site (probably `lib/summarize.ts` or a parser helper called from it). Update the per-tag check:

1. For each LLM-proposed topic, check the canonical enum first.
2. If no match, check `TOPIC_ALIASES`. If hit, substitute the canonical equivalent.
3. If still no match, fire the existing `invalid-topic ${billId}: dropped ${tag}` logger.
4. Dedup the resulting topics array.

The "invalid-topic" log message format stays unchanged — keep it grep-friendly with prior runs.

### Verification

1. Re-run `npm run summarize -- --limit 5 --dry` against five known bills from the drain log that previously dropped a now-mapped tag. Easy candidates: `119-hr-9011` (urban_development → housing), `119-hr-3184` (public_health → healthcare), `119-hr-6162` (native_americans → civil_rights), `119-hr-7645` (humanitarian_aid → foreign_policy), `119-hr-4472` (law_enforcement → criminal_justice). Confirm no "invalid-topic" line fires for those mapped tags.
2. Run against one bill known to drop an unmapped tag (`119-hr-8471` dropped `animal_welfare`). Confirm the dropped-topic logger still fires — signal preserved.
3. Type-check clean.

## Acceptance

1. `TOPIC_ALIASES` const in `lib/enums.ts` with the eleven confident mappings above.
2. Validator applies the map before the dropped-topic logger.
3. Logger continues firing for unmapped non-canonical tags.
4. Type-check clean.
5. Commit: `feat: topic alias map for LLM-suggested categories (HO 121)`
6. Working tree clean, pushed.

## Notes

- The unmapped categories continuing to drop is **the** signal layer. Don't pre-populate the map aggressively. The false-confidence risk (mapping `infrastructure` → `transportation` when half those bills are about energy or housing) is worse than the current dropped-topic risk.
- No backfill of the ~26 bills affected by the HO 120 drain. They each carry at least one valid topic and the loss is invisible to the dashboard.
- If a future SKILL.md sweep wants it, this is the kind of decision worth a one-liner in the "Things to watch for" section: "When Gemini repeatedly proposes a non-canonical topic, prefer aliasing over taxonomy growth; expansion dilutes the existing color/abbreviation system."
