# HO 422 — Kevin Kiley party fix + the ideology-surface doc sweep (421)

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 422 (421 = the DW-NOMINATE hub surface, shipped `99de3c1`). If HEAD moved, renumber.
>
> **Two commits, in order, never mixed: (1) code — the Kiley fix; (2) docs — the sweep.** Commit 1 is `members`-party code + a re-sync + a diagnostic re-run; commit 2 is `docs/` + `SKILL.md` only, by explicit pathspec. `SKILL.md` trips its self-mod guard: HALT and re-approve. Spec-driven throughout: propose the plan, wait for review, show each diff, no auto-commit. Commit 1 touches runtime data, so verify locally; no `verify:deploy` for commit 2.

## Part 1 (commit 1, code) — correct `members.party` for K000401 Kevin Kiley

HO 419's ideology diagnostic surfaced it: `members.party='I'` for Kiley, but Voteview `party_code=200` (R) is correct — he's a California Republican (CA-03). The ideology sync found exactly 1 party disagreement across 552 scored members, so Kiley is the only current instance.

**Diagnose before fixing — don't patch the symptom blind.**

- Inspect the source record for K000401 and the `sync:members` party derivation. Where does `members.party` come from (the Congress.gov member payload, or the congress-legislators `terms[]` party field), and why does it land `I` for Kiley? Candidates: a mis-mapped party string, a stale prior-term record, an independent-caucus mislabel, or reading the wrong `terms[]` entry.
- **Fix at root if it's a derivation bug** — so future syncs self-correct and any siblings are caught — rather than a one-row data poke. A targeted override is the fallback only if the upstream source is genuinely wrong and can't be re-derived.
- **Scope guard:** if the diagnosis shows a *broad* `sync:members` party problem (many members mis-derived, not just Kiley), **HALT and report**. A members-party overhaul is its own handoff, not a rider on this sweep. Fix the contained case; escalate the broad one.

**Verify (a derivation fix alone doesn't rewrite stored rows):**

- After the derivation fix, **re-run `sync:members`** (it's manual) so Kiley's stored `members.party` actually flips to `R`. If the fix is a targeted override instead, it writes the row directly.
- Re-run `scripts/diagnostic/ideology-coverage-419.ts` → the `party_code`-vs-`members.party` disagreement count reads **0**.
- Kiley's member hub renders R, including the **ideology marker flipping from independent-purple to republican-red** (the `MemberIdeology` marker colors off `members.party`; pre-fix his purple marker sits in R territory near the R-median, visually incoherent — post-fix it's red). Ties the fix back to the 421 surface.

Commit 1: code only (`sync:members` + wherever the derivation lives), message names the root cause.

## Part 2 (commit 2, docs) — sweep the ideology arc + close the Kiley loop

Docs-only, after commit 1 lands. **Gate first:** `git log --oneline` since `99de3c1` (no docs commit already tombstoning 421?), `grep -n "MemberIdeology\|getMemberIdeology\|ideology surface\|421\|Kiley" docs/*.md SKILL.md`, and `git status` for untracked handoffs (421, 422) to fold in. Reconcile in place, report present-vs-applied.

### `backlog.md`

- **DONE tombstone for 421** (`99de3c1` — first ideology surface: `getMemberIdeology` + `MemberIdeology`, the fixed −1..+1 vertically-banded axis with the below-rail caret resolving the on-median collision, the 1-null empty state, the `member-ideology` cache tag, no cron, no index).
- **Strike the QUEUED "first ideology surface" item** — shipped at 421.
- **Close the Kiley OPEN LOOP** (opened HO 420) as FIXED, referencing commit 1 and the root cause. If Part 1 hit the broad-problem scope guard instead, don't close it — update it with the diagnosis and point at a future members-party handoff.

### `roadmap.md` — the surface note + the Member-depth bar (Corey signs off on the bar)

Read Member depth live (expect 99). Add a housekeeping note stamped "run through HO 422" (per the per-note convention — 413/414/416/418/419 each carry their own) recording: the first ideology surface shipped (HO 421, the DW-NOMINATE axis on the member hub), plus this sweep and the Kiley party fix (HO 422). The **Member-depth bar value is the one decision, Corey's to sign off:**

- **Option A — 99 → 100:** the ideology axis is the Member-depth closeout (last major member-data gap, now ingested and surfaced where a user reads a member). The note records the closeout.
- **Option B — hold at 99:** ideology rides as the Also; 100 stays reserved for the member-scorecard arc, which keeps the final point.

**No sign-off recorded → HALT and ask. Don't pick one.**

### `SKILL.md` (self-mod guard — HALT and re-approve)

- **Query registry:** `getMemberIdeology(bioguide_id)` — the member's row plus app-side chamber D/R medians, the ~535-row context scan (no index), the `member-ideology` daily-TTL cache tag (no cron flushes it).
- **Design system / components:** `MemberIdeology` — the fixed −1..+1 axis, and **codify the positioned-marker-on-track idiom** as distinct from the width-fill bars (`.stage-funnel-*`): median ticks above the rail with contrasting cores, the member marker as a below-rail caret (its disambiguating identity) plus a secondary above-rail bar, a 2% domain inset for near-edge markers. The next positioned-marker surface reuses this, not the fill-bar pattern.

### `oddities.md` — only if the Kiley root cause is reusable

If Part 1's diagnosis is a trap a future author would re-trip (a specific congress-legislators party-field quirk, or how independent-caucusing members are labeled upstream), add one note. If it's a genuine one-off, skip it — don't pad oddities.

## Commit discipline

Two commits, never mixed. **Commit 1:** the code paths, `git add` by explicit pathspec, re-run `sync:members`, verify Kiley (diagnostic 0, hub reads R). **Commit 2:** `git add docs/roadmap.md docs/backlog.md` + `oddities.md` if touched + the SKILL path after approval + untracked handoffs from `git status`. Ancestry re-checked immediately before each push. Show me both diffs — no auto-commit.

## Report back

The Kiley root cause and the fix taken (root vs override), the diagnostic disagreement count after (expect 0), confirmation Kiley's hub and ideology marker now read R, which bar option was applied, and both diffs. Confirm SKILL was edited only under approval.
