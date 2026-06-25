# HO 345 — Stale reframe: wiring check (read-only diagnostic)

> Claim the next free HO number. If 345 is taken in `docs/handoffs/`, use the
> next available and rename this file to match.

**Diagnostic, not a build.** Confirm the data supports a stage-led `/stale`
reorder, and decide whether the momentum layer gets spec'd or dropped. Read-only
SELECTs plus live spot-checks. No schema change, no commit. Paste answers back.

Goal of the reframe: `/stale` stops being "no action in 60+ days" and becomes
stage-led — sorted stage desc, then time since last action — with opening-week
procedural resolutions filtered out so they stop polluting the view. A second
"momentum" pass (people backed it / it got a hearing, then it died) is gated on
Q5–Q6.

## Seed (from the frozen SKILL.md base — confirm live, the base doc lags)

- `stage` column on `bills`, enum `introduced | committee | floor |
  other_chamber | president | enacted`, plus an `other` catchall seen in the
  stale-page WHERE. Also `previous_stage` and `stage_changed_at`. Confirm the
  live distinct `stage` values and null count before trusting sort/filter.
- `latest_action_date` / `latest_action_text` on `bills`; `introduced_date`
  separate.
- The base schema explicitly skipped cosponsors / committees / hearings; those
  arrived in later arcs, so do **not** trust the base DDL for Q5–Q6. Grep live.

## BASE — is the stage-led reorder buildable? (1–4)

**1. Stage as a discrete, sortable, filterable value.** Confirm `stage` is the
field, give the exact live enum (distinct values + counts), and confirm it's a
plain column, not packed in `raw_json`. Note any nulls — a stage-led sort has to
decide where nulls land.

**2. Last-action date past committee — real and varied.** Pull a sample of
`floor` and `other_chamber` bills and show their `latest_action_date` values. The
question is whether they're non-null and genuinely varied, not all clustered on
the January opening date. Report the date distribution (count by month) across
floor + other_chamber so the spread is visible. If a chunk all carry the same
January date, those are almost certainly the housekeeping resolutions from Q3 —
call it out, it connects the two checks.

**3. Procedural housekeeping class — identifiable for filtering?** These are
floor-stage simple resolutions that did one opening-week job: quorum assembled,
electing officers, appointing members to committees, fixing the daily meeting
hour, notifying the President of the election of officers. They sit at floor with
a January last-action date and never move again. Not stalled, done. The reorder
filters them out.

First check for an existing flag: is there an `is_ceremonial` column or a
`cluster_id` that catches these? Note the Filler Watch four clusters
(`awareness-designation`, `honoring-resolution`, `facility-naming`,
`sense-of-congress`) do **not** obviously include opening-week housekeeping, so
don't assume `is_ceremonial` covers it. Verify.

If no flag, scope the cheapest catch and return candidate matches so they can be
eyeballed against real floor bills. Likely start: `bill_type IN ('hres','sres')`
AND title matches the stereotyped opening-week patterns, e.g. titles containing:

- "Electing officers" / "Electing the Speaker" / "Electing Members to ...
  committees" / "Election of Members to ... committees"
- "To inform the President ... of the election of" / "notifying the President ...
  of the election of officers"
- "the House has assembled and a quorum" / "To inform the Senate that the House
  has assembled"
- "Fixing the daily hour of meeting" / "the hour of daily meeting"
- "Electing a President pro tempore"
- "consent to assemble outside the seat of government"
- "Notifying the President ... that a quorum ... has assembled"

Return the count and a sample of what each pattern catches. Given how few these
are (~10–15 a Congress), a **frozen ID list** built from the pattern matches is
probably the cleanest zero-false-positive catch — surface the candidates first,
then the call is list vs live-pattern.

**Boundary to protect:** the opening-day Rules package (adopting the Rules of the
House) is NOT housekeeping. It sets the terms of the whole Congress and is a real
floor bill. The filter must not catch it. Flag if any pattern would, and confirm
the candidate list is clean of it.

**4. "Past committee" stage group.** Confirm `stage IN
('floor','other_chamber','president')` is expressible — floor + other-chamber +
president, EXCLUDING enacted (a law isn't stalled). Both `other` and `enacted`
are out of the group per the definition. Trivial given (1); just confirm.

## MOMENTUM — gate the second pass (5–7)

**5. Cosponsor count — stored? history?** Check for a dedicated cosponsor-count
column. If none, is the count extractable from `raw_json` (Congress.gov bill
detail carries `cosponsors.count`)? And critically: is there any time-series /
history of the count, or only the current total? "People backed this, it died
anyway" wants a delta over time; current-count-only still allows ranking by
support. Report exactly which you have — dedicated column / raw_json-only /
nothing — and history yes/no.

**6. Hearing-to-bill linkage.** news-to-bill is wired (`news_mentions` is
bill-keyed). Confirm whether hearing-to-bill is too: does the hearings table
(HO 263 data layer) carry a `bill_id` reference or a junction table, or is it
committee-keyed only with no bill link? "Got a hearing, then went silent" needs
the bill join. Report the hearings schema's bill-linkage state plainly.

**7. The gate.** If 5 and 6 are both missing (no usable cosponsor signal AND no
hearing-to-bill join), say so plainly: the momentum layer drops and `/stale`
ships on the stage-led base alone. If either is present, note which, so the
momentum pass can be scoped to what's actually available.

## Method

- Live Turso instance the app uses (via `lib/db.ts`, or `turso db shell` against
  prod). Cross-check the instance.
- For (2) and (3), pull real rows and show actual values — this is a spot-check,
  not a count. Small samples are fine.
- No writes, no schema change, no commit, no doc edits. Paste answers back.

## Return format

Per-item (1–7), BASE then MOMENTUM, with the Q7 gate decision (momentum spec'd vs
dropped) stated explicitly at the end.
