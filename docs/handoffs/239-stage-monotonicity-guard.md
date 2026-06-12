# HO 239 — stage monotonicity guard + flicker repair

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 239.

## What this is

The backward-hop diagnostic (2026-06-12) found 60 of 230 transitioned bills (26.1%) carry a backward slot pair, 49 of them `*→introduced` — a transition that cannot legislatively occur. Mechanism confirmed on `119-hr-8467`: input frozen at Jun 10, output flipped Jun 12, and to a stage *less* accurate than the prior label (the action text is post-passage floor procedure). Verdict: classifier flicker, settled — don't re-adjudicate.

Three-part fix, two commits: reduce flicker at the source (prompt rule), stop it at the write point (monotonicity guard), and repair the standing damage (one-shot, 49 rows). The deeper fix — a deterministic action-code tier ahead of the LLM — is explicitly **banked, not built** here; add it to the backlog with the diagnostic numbers if it isn't there already.

Detectable backward hops are the visible half of a symmetric noise process; record that inference in the backlog entry too (forward flicker exists inside legitimate-looking transitions and is currently unmeasurable).

## Resolved premises (don't re-derive)

- The classify/write point is `lib/summarize-runner.ts`'s transitioned branch (slot write + HO 232 `stage_transitions` INSERT, shared condition and timestamp).
- Stage rank order exists wherever the stage system defines it (intro → committee → floor → other_chamber → president → enacted); use the canonical ordering from the live code, don't redefine it.
- The HO 232 validator's invariant is `bills moved post-anchor (by stage_changed_at) ↔ log rows`. The repair below is designed to leave both sides untouched — keep it that way.
- Legitimate setbacks exist (recommit/re-referral: the 8 `floor→committee` pairs may be real). The guard must allow them through a confirmation path, not a keyword list.

## Commit 1 — prompt rule + write-time guard

**Prompt (source-level reduction):** add one targeted rule to the stage-classification prompt: a bill never returns to `introduced` once it has advanced, and post-passage procedural actions (e.g., "motion to reconsider laid on the table") indicate `floor` or later, never `introduced`/`committee`. Keep it to a couple of lines; this is a rule injection, not a prompt rewrite.

**Guard (write-level), in the transitioned branch, before the slot write:**

1. `rank(new) ≥ rank(current)` → accept exactly as today (slot write + log INSERT unchanged).
2. `new = introduced` while `current` ranks higher → **hard reject, always.** Un-introducing is impossible; a stable wrong answer is still wrong. `console.warn("[stage] rejected impossible downgrade", billId, current, "→", new)`.
3. Any other downgrade → **two-tick confirmation.** Add `pending_stage` + `pending_stage_at` columns to `bills` (migration per the repo convention). First proposal: record pending, do **not** move stage, warn `[stage] downgrade pending`. If the next classification of that bill proposes the **same** downgrade, accept it (write slot + log row, clear pending). Any other outcome clears pending. Flicker is non-deterministic, so it almost never repeats; genuine recommits reclassify stably.

No changes to MOVERS, the weekly count, or any consumer — they get cleaner through the data.

**Verify:** synthetic-path test (a scratch under `scripts/diagnostic/` that drives a fake bill through reject / pend / confirm and prints each decision); typecheck + build clean; one real summarize run locally shows no behavior change for forward transitions.

**Commit:** `fix: stage monotonicity guard + classifier prompt rule (HO 239)`

## Commit 2 — one-shot repair of the 49 impossible pairs

**Scope:** exactly the bills where `previous_stage` ranks higher than `stage` **and** `stage = 'introduced'` (the impossible bucket — expect 49). The 8 `floor→committee` and other plausible setbacks are **untouched**; we can't bulk-adjudicate them.

**Repair per row:** `stage ← previous_stage` (strictly closer to truth; hr-8467 shows it may still understate, and that's accepted), `previous_stage ← NULL`, `stage_changed_at ← NULL`. The NULLs keep these bills out of MOVERS/`/changes` (no phantom movement from an admin fix) and keep the validator's A-side unchanged; no log rows are written (nothing "moved" — a wrong label was corrected). State this reasoning in a comment in the script.

**Destructive-op discipline:** the script (tracked, `scripts/repair-impossible-stage-pairs-239.ts`) runs `--dry-run` by default, printing the full before/after table (bill id, old stage, restored stage). Run dry first, paste the plan into the ship report, then apply with an explicit flag. The printed plan is the recovery record.

**Verify:** re-run `scripts/diagnostic/backward-hop-238.ts` — backward pairs drop from 60 to ~11, the `*→introduced` bucket to 0; validator still PASS; stage-distribution INTRO count drops accordingly (eyeball the dashboard funnel before/after and note the delta in the report).

**Commit:** `fix: repair 49 impossible backward stage pairs (HO 239)`

## Constraints

- No action-code pre-classifier, no prompt rewrite, no reclassification sweep of the whole corpus, no touching the 8+ plausible setbacks. Surgical: prompt rule, guard + migration, repair script, scratch test.
- The guard must share the exact transition condition with the existing slot write — one branch, not a parallel code path.
- Named `git add` per commit; dry-run plan in the ship report before apply; stale-`.next` rule as always.
