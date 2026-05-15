# 52 — Cluster pattern calibration

## What this is

Handoff 51 shipped clean but two of the five regexes are broken. The backfill counts:

```
cra-disapproval:        188   ✓
sense-of-congress:      117   ✓
honoring-resolution:    333   ✓ (plausible)
facility-naming:          0   ✗ broken
awareness-designation:    2   ✗ broken
```

Diagnosis: the original patterns assume verbose action-description titles ("To designate the facility of..."), but Congress.gov frequently returns marketing short titles ("Eliot L. Engel Post Office Designation Act"). Awareness designations are usually phrased as "Supporting the goals and ideals of..." or "Recognizing [X] as [Y]", not "Designating [X] as [Y]". The regexes need rewriting against the actual phrasing the API returns.

This handoff samples real titles for each broken pattern, rewrites the regex from the data, clears the affected rows, and re-runs the backfill.

## Step 1 — Sample real titles

Open a quick scratchpad query. For facility namings:

```sql
SELECT id, bill_type, title FROM bills
WHERE LOWER(title) LIKE '%post office%'
   OR LOWER(title) LIKE '%federal building%'
   OR LOWER(title) LIKE '%courthouse%'
   OR LOWER(title) LIKE '%va medical center%'
   OR LOWER(title) LIKE '%air traffic control tower%'
ORDER BY RANDOM()
LIMIT 30;
```

For awareness designations:

```sql
SELECT id, bill_type, title FROM bills
WHERE bill_type IN ('hres', 'sres', 'hconres', 'sconres')
  AND (LOWER(title) LIKE '%awareness day%'
       OR LOWER(title) LIKE '%awareness week%'
       OR LOWER(title) LIKE '%awareness month%'
       OR LOWER(title) LIKE '%national % day%'
       OR LOWER(title) LIKE '%national % week%'
       OR LOWER(title) LIKE '%national % month%')
ORDER BY RANDOM()
LIMIT 30;
```

Paste both result sets into the chat output so the calibration is auditable. The goal isn't to write the perfect regex — it's to look at 30 real titles and see what phrasings dominate.

## Step 2 — Rewrite the regexes

Based on what the samples show, update `lib/cluster-patterns.ts`. Expected directions:

**`facility-naming`** should catch both phrasings. Sketch:

```ts
regex: /(post office|federal building|courthouse|medical center|air traffic control tower|federal correctional)( building)?( designation)?( act)?$|^to designate .+ as the .+(post office|federal building|courthouse|medical center)/i
```

That's a starting point, not a final answer. The end-of-title `... Post Office Designation Act` form is probably the dominant case for House bills (`hr`). The verbose `To designate the facility of...` form shows up in older bill texts but may be less common in the title field. Look at the data and write what fits.

Tighten to avoid false positives:
- "Postal Service Reform Act" should NOT match — it's substantive postal policy, not a renaming.
- "Federal Building Security Act" should NOT match — not a renaming.
- The match should require the facility-type noun to be near the end of the title, or paired with a person's name pattern, or co-occur with "designation"/"naming"/"renaming".

**`awareness-designation`** should catch the resolution phrasings. Sketch:

```ts
regex: /^(supporting the goals and ideals of|recognizing .+ as|expressing support for the designation of) .+ (day|week|month)/i
```

Plus the original `designating ... as ... day/week/month` form for cases where that phrasing does appear. Two-alternative regex or two separate cluster patterns — your call based on what the data shows. If there are more than three distinct phrasings, prefer two separate patterns over one regex with five alternations.

## Step 3 — Clear and re-run

Once the new regexes are in:

```sql
UPDATE bills SET cluster_id = NULL
WHERE cluster_id IN ('awareness-designation', 'facility-naming');
```

Then `npm run backfill-clusters`. The script's `WHERE cluster_id IS NULL` clause will pick up the cleared rows plus everything that wasn't matched before.

Paste back the new count summary.

## Acceptance

- `facility-naming` matches at least 300 bills. (Quick sanity floor — there are 435 House members and post-office renamings happen at a few per member per Congress. Below 300 means the regex is still too narrow.)
- `awareness-designation` matches at least 100 bills. Page 1 alone surfaced 8+; the corpus should hold many multiples of that.
- No regression on the three working clusters: `cra-disapproval`, `sense-of-congress`, `honoring-resolution` counts should be within ±10 of the previous run. (Some bills might now match a different pattern via ordering, but big swings mean a new regex is catching the wrong things.)
- Spot-check: open `/?cluster=facility-naming` and `/?cluster=awareness-designation`. The first 10 rows of each should look obviously like the cluster name. Any bill that doesn't fit is a false positive worth tightening for.

## Don't

- Don't lower the bill-type narrowing on `cra-disapproval`. That regex works because it's surgical.
- Don't merge facility-naming with honoring-resolution. They overlap (renaming a post office *honors* someone) but the analytical questions differ — `/?cluster=facility-naming` should answer "who's the post-office champion" cleanly, which requires keeping them separate.
- Don't add a sixth cluster in this handoff. Calibration only. New clusters get their own handoff once these two are working.
- Don't tune `honoring-resolution` unless the spot-check surfaces obvious false positives. 333 is in the believable range; touch it only with evidence.
