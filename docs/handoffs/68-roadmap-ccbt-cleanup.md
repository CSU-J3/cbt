# 68 — Roadmap CCBT section cleanup

## What this is

Documentation-only handoff. The CCBT parity section in `docs/roadmap.md` is stale — it treats CCBT as a debt item inside CBT's roadmap when it's actually a parallel active project with its own repo (`ccbt-eta.vercel.app`), its own SKILL.md, and its own handoff log (currently at 28, on state-session cadence). The "untouched, 14+ handoffs behind" framing is wrong. Clean it up so the roadmap reflects reality.

No code changes. No SKILL.md changes. One file: `docs/roadmap.md`.

## In scope

- Rewrite theme 8 in `docs/roadmap.md` from a parity/porting theme to a one-paragraph acknowledgment that CCBT exists as its own project
- Remove the CCBT port batch item from the sequencing list
- Maybe update any other roadmap.md sentences that frame CCBT as a CBT theme (search for "CCBT" in the file)

## Out of scope

- SKILL.md changes (no CCBT references there to clean up)
- Cross-repo changes (don't touch CCBT's own docs)
- Renumbering remaining themes (1–7 already sit before the CCBT block; just remove or shrink 8)

## The edit

Find this section in `docs/roadmap.md`:

```markdown
### 8. CCBT parity

CCBT lags CBT by every feature that shipped after the fork: `/stale`, `/changes`, `/president`, sponsor depth, sort dropdown, fluid layout, header rename. The longer the gap, the harder the port.

Three options: inline porting (every CBT handoff that ships, follow with the CCBT equivalent in the next session), batched porting (quarterly sweep), or selective porting (only features that pass a "this matters at the state level too" filter). Doing nothing is worse than any of these.
```

Replace with:

```markdown
### 8. CCBT

CCBT is the Colorado state-level sibling of this dashboard, live at https://ccbt-eta.vercel.app. It has its own repo, its own SKILL.md, and its own handoff log on a state-session cadence (sessions adjourn and resume on different beats than the federal Congress). It is not tracked from inside this roadmap and not a parity debt item. What gets ported between the two projects happens on CCBT's own schedule, driven by its data needs, not by anything that ships here.
```

Then in the sequencing list at the bottom of the file:

```markdown
14. **CCBT port batch.**
```

Delete that line entirely. Don't renumber the remaining list — the numbers were already loose ("roughly six months of work at a CBT pace") and the doc explicitly says "Order is logical, not calendar."

## Search the rest of the file

`grep -i ccbt docs/roadmap.md` or equivalent. Any other passing reference to CCBT parity or porting outside theme 8 and the sequencing list — apply the same logic. Most likely just those two places.

## Verification

1. Open `docs/roadmap.md`. Theme 8 is one paragraph, no porting strategies, no parity language.
2. Sequencing list at the bottom does not mention CCBT.
3. `grep -i ccbt docs/roadmap.md` returns only the theme-8 paragraph.
4. No other files touched. `git diff` shows only `docs/roadmap.md`.

## Acceptance

`docs/roadmap.md` reflects that CBT and CCBT are siblings, not parent and child. Future end-of-session roadmap status reports won't pull CCBT in as a 0% bucket because the doc no longer frames it as one.
