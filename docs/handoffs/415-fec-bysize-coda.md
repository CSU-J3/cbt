# HO 415 — FEC `by_size` coda: close the Member-depth-98 gap (or find its honest floor)

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 415. If HEAD has moved past 414, renumber.
>
> Gate is read-only. The `sync:fec` run and any sync-code change are **spec-driven with HALTs** — `sync:fec` is a write that hammers an external rate-limited API (api.data.gov), so **HALT before running it** and before any code change. Show diffs, no auto-commit. Docs are a separate commit.

## What this is

The second and last hold on Member depth 98. HO 414 closed member→news; this closes FEC `by_size`. The live number is **463/530 — 67 members short** on the Schedule A by-size (small/large donor bucket) breakdown, left over from the original `sync:fec` hitting the api.data.gov rate limit mid-run.

The memory shorthand was "self-heals on next `sync:fec` run." That's the assumption to test, not to trust: the number is still 463/530, so either the sync isn't in the daily cron (it's a deliberate command that just hasn't been run since the truncation) or it's in the cron and keeps re-truncating at the rate ceiling. And "67 short" isn't necessarily 67 fetchable rows — some of those members may have no valid candidate ID or no by-size data at all, which no sync can fix. The probe splits the gap before anything runs.

## Grounding (don't re-derive — confirm at the gate)

- Members already carry a name-matched **`fec_candidate_id`** field (HO 399). That's the field the probe checks for null. A null ID is a crosswalk gap, not a rate-limit gap — `sync:fec` has nothing to query.
- The congress-legislators **`fec` array holds candidate IDs, not committee IDs**, and is not a reliable complete career history. Do **not** use it to blind-backfill missing candidate IDs.
- Three known **fuzzy FEC-match suspects** are tracked in backlog (correct-vs-wrong candidate-ID pairs; only Gillen is a true freshman, Ivey and Mullin are second-term). If any of the 67 overlap these, their by-size can come back empty because the ID points at the wrong or no candidate — flag the overlap explicitly.
- This is Schedule A `by_size`, not Schedule E — the ~5× F24/F3X over-count note doesn't apply here.

## The gate — split the 67 before running anything (read-only)

**§A — bucket by candidate ID (local Turso only, free, no external calls).** Of the members missing `by_size`, how many have a non-null `fec_candidate_id` vs. null/empty? Two lists:
- **Null-ID members** — a crosswalk gap. `sync:fec` can't populate them (no ID to query). List them; note any overlap with the three fuzzy-match suspects.
- **ID-present-but-unpopulated members** — the candidates for truncation. Count them; this is the set the sync can actually act on.

**§B — establish the sync's rate behavior (read the sync code + cron config, read-only).**
- Is `sync:fec` wired into the daily cron (Vercel/GitHub Actions) or is it a manual-only command? If it's in the cron and the gap persists, it's re-truncating; if it's manual-only, it simply hasn't run since — which matches the "deliberate run" read.
- How many api.data.gov requests does it make **per member** (one by-size call, or paginated / multi-cycle)? Times the populatable set, against the effective rate ceiling for the key tier in use. This is the question that decides whether **one clean run covers 530** or whether it needs chunking across rate windows.
- Confirm **why the original run stopped at 463** — a rate ceiling hit mid-run, or an interrupted/one-off run. 463 landing 67 short is the clue: if it's 1 req/member under a 1,000/hr ceiling it shouldn't have stopped there, so there's likely either a lower tier or >1 req/member. Report the actual numbers.

**§C — sample the FEC API for the ID-present set (external — HALT before, rate-budget-aware).** For a **bounded sample** of §A's ID-present-but-unpopulated members (not all 67 — leave rate budget for the actual sync), hit the FEC by-size endpoint:
- Returns rows → **truncation**: we just never fetched them, a run closes them.
- Returns empty for a valid ID → **genuine floor**: candidate filed but has no by-size breakdown this cycle, or the ID is a fuzzy mismatch. These don't count against the denominator.

Report the split as a fraction of the sample.

**HALT with the verdict:** is the 67 gap truncation-dominated, floor-dominated, or crosswalk-null-dominated — and does one deliberate `sync:fec` run fit the rate budget, or does the sync need rate-hardening first? Wait for review before running the sync or touching code.

## The fix — forks by the gate's verdict

**Truncation + one run fits the rate budget.** Run `sync:fec` (HALT before — external rate-limited write). Re-count `by_size` populated. Confirm it reaches the **populatable ceiling** (530 minus the null-ID and genuine-floor members from §A/§C), not necessarily a literal 530.

**Truncation but one run can't fit (requests needed > rate ceiling).** The sync needs **chunking/resume** so it covers all populatable members across rate windows without re-truncating — a bounded per-window batch with a resume cursor, or a backoff that respects the api.data.gov limit. Spec-driven: propose the shape, show the diff, then run. (This also fixes the standing "keeps re-truncating in cron" failure mode if §B found the sync is in the cron.)

**Floor / crosswalk-null dominated.** Document the members who legitimately can't have by-size (null ID, non-filer, committee-only, fuzzy-mismatch) with the reason for each. The honest denominator is 530 minus that set. Run the sync for whatever truncation portion exists, then the number is "all populatable members populated" — report the residual and its cause rather than chasing rows that can't exist.

## Verification

- `by_size` populated count after the run, against the populatable ceiling established at the gate (not a blind 530).
- If chunking was added: confirm a full run completes without hitting the rate ceiling, and that a re-run is idempotent (already-populated members aren't refetched, or are refetched cheaply).
- Spot-check two or three newly-populated members on the member hub — the by-size breakdown renders where it's consumed.
- If `sync:fec` writes touch any cached surface, confirm the relevant tag revalidates (or note that the daily read picks it up).

## Roadmap (the coda's point — doc sweep, separate commit)

Bump **Member depth 98→99 only when `by_size` is populated to its honest ceiling** — every member who *can* have a by-size breakdown does. If §A/§C found a genuine floor (N members who legitimately can't), 99 lands on that denominator with the floor documented in oddities/backlog; don't hold the point hostage to rows that can't exist, and don't bump if truncation is still open. This is the second of the two HO 404 holds — with it closed, both pre-arc loops from the start of this arc are discharged.

## Discipline

- `sync:fec` HALTs before running (external, rate-limited, write). Read probes are fine but **rate-budget-aware** — don't burn the budget the sync then needs (that's how the original truncation happened).
- Any sync-code change (chunking/resume) is spec-driven: plan → diff → approval, no auto-commit.
- Explicit pathspec, ancestry re-checked before push, code and docs separate commits.
- SKILL only if a genuine structural convention emerges (e.g. a new chunking/resume pattern worth banking) — HALT for self-mod approval, don't route around the guard.
