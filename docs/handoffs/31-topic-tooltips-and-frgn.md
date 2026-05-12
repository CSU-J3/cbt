# Topic chip tooltips + rename FOR → FRGN

## Problem

`FOR` reads as the English word "for" before it reads as
"foreign_policy." That's the worst collision in the topic abbreviation
set, but it isn't the only ambiguous one — `CONS`, `GOV`, `SS` all
require prior knowledge to decode.

## Fix

Two changes, both small.

### 1. Add `title` attributes to all topic chips

Wherever topic chips render — the filter row at the top of `/`, the
`TopicTags` per-row component, anywhere else they appear — add a
`title` attribute with the full topic name in human-readable form.

The mapping likely already exists in `lib/topic-colors.ts` (or wherever
the abbreviation lookup lives). If it's currently `code → abbreviation`
only, extend it to `code → { abbr, label }` or add a parallel
`code → label` map.

Labels should be the human-readable form, not the snake_case enum:

- `foreign_policy` → `Foreign policy`
- `civil_rights` → `Civil rights`
- `criminal_justice` → `Criminal justice`
- `financial_services` → `Financial services`
- `government_operations` → `Government operations`
- `consumer_protection` → `Consumer protection`
- `social_security` → `Social security`
- everything else → capitalize the single word (`Healthcare`, `Energy`, etc.)

Markup pattern:

```tsx
<span title={label} className="...">
  {abbr}
</span>
```

Native browser tooltip — no JS, no library, accessible by default.

### 2. Rename `FOR` → `FRGN`

In whichever file holds the abbreviation map, change `foreign_policy`'s
abbreviation from `FOR` to `FRGN`. No data migration needed — bills
store the full topic name (`foreign_policy`) in the JSON array, only
the UI abbreviation changes.

Update `SKILL.md` if it lists the abbreviation explicitly. Don't worry
about old URLs that reference `?topics=foreign_policy` — those use the
full name, not the abbreviation, so they keep working.

## Out of scope (mention only)

`SS` for `social_security` carries historical baggage some readers will
notice. If it bothers you, change it to `SOC` or `SSEC` in the same map
when you're already in there. Not pushing this — flagging it.

## Verify

- Hover any topic chip, anywhere it appears: tooltip shows full label.
- Filter row chip for foreign policy reads `FRGN`, not `FOR`.
- Per-row chips on bills like `SRES 707` or `S 4473` show `FRGN` instead of `FOR`.
- `?topics=foreign_policy` URLs still work — clicking the renamed chip should produce that URL.
- Nothing else changed visually.
