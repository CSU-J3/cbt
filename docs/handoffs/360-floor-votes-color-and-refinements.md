# HO 360 — Floor votes: outcome color rule + refinements

> Claim the next free HO number; if 360 is taken in `docs/handoffs/`, use the next
> available and rename. Independent of the reports chrome fix (HO 359).

## ⚠ Read first — this is an edit, not a build

The floor-votes section already shipped in **HO 358, commit 854a0f4**, live on
`/reports/2026-06-08` and `/reports/2026-06-15`. The source draft for this work
reads as a from-scratch build and claims to supersede the standalone floor-votes
spec — **that framing is stale, discard it.** 358 is the shipped baseline; this
handoff layers a color rule and a few refinements on top of it. Do not rebuild the
section.

**First step: grep the shipped state.** Open the Floor votes block in
`assembleMarkdown` (`lib/report-generation.ts`) and the `VOTES_COMMENTARY` block in
the prose prompt. Confirm what's already there before touching it:

- Header `## Floor votes (V)` after Stage movements ✓
- Outcomes emitted today: `PASSED` / `FAILED` / `ADVANCED` / `CONFIRMED`
- Named = final passage + successful cloture + confirmation; rest collapse to
  `_+ N more recorded votes (procedural and amendment)_`
- Dedup terminal-action-wins (a nominee that cleared cloture then was confirmed
  shows once as `CONFIRMED`) — **preserve this**
- Bill refs are bare IDs run through `linkifyBillIds` → `/bill/119-…`, *not*
  `/bills/slug` (the draft's `/bills/slug` is the path 358 already corrected — keep
  bare IDs)
- Party split scoped to the named vote IDs only, never the ~337k-row `member_votes`
- Render is option (b), vanilla markdown, `.md` byte-identical to web

Everything below is a delta against that. If a delta already exists, skip it.

## Delta 1 — outcome color rule (the deferred 358 render)

`ReportMarkdown` gains one scoped rule: a `<strong>` whose text is *exactly* one of
`{PASSED, FAILED, ADVANCED, BLOCKED, CONFIRMED, REJECTED}` gets a color class.
Existing tokens only — confirm the exact token names exist before mapping:

- `PASSED`, `CONFIRMED` → `--stage-enacted` (green) — decided yes
- `ADVANCED` → `--stage-floor` (amber) — moved forward, not final
- `FAILED`, `BLOCKED`, `REJECTED` → `--party-republican` (red) — decided no

This reuses the red party token for outcome semantics, not party. That's fine
because the party-split labels render muted gray (see Delta 4), so a red `FAILED`
never sits beside a red `R` label.

`content_md` carries no color and no HTML — just `**FAILED**`. The `.md` download
serves the raw bold string. Color lives only in the web render, exact-text matched
on the bolded token, so the word "passed" in prose never false-matches.

This is the single deliberate web/download divergence. It doesn't change how reports
are stored (still one pure-markdown string); it's a scoped `ReportMarkdown` rule.
**Decision (confirmed): ship colored. Build the rule — no uncolored fallback.**
Note: this same rule would give the HO 352 ladder its stage colors back later, but
that's out of scope here.

## Delta 2 — two new outcome verbs

Extend the classifier (which already reads the live `result` / `question` /
`amendment_designation` vocabulary — keep reading it live, no invented strings):

- `BLOCKED` — a decisive cloture/procedural vote on a bill that *failed* (filibuster
  sustained). Today a failed cloture collapses; promote the decisive ones to named
  `BLOCKED`.
- `REJECTED` — a contested confirmation (real recorded opposition) that *failed*.
  Today only successful `CONFIRMED` is named.

So the bucket pairs become: passage → PASSED/FAILED, decisive cloture →
ADVANCED/BLOCKED, contested confirmation → CONFIRMED/REJECTED. Routine motions,
amendments, and the unanimous-consent nomination flood still collapse.

## Delta 3 — ordering + cap

Confirm the shipped order, then apply if not present: **failed and blocked first**
(that's the signal the ladder can't carry), then by margin closeness
(`|yea − nay|` ascending); confirmations sort in by margin. Cap the named list at
~8; the remainder rolls into the existing collapse line (`V` minus listed).

## Delta 4 — split rule refinement + independents

- Refine the existing split-display knob to: show the split when **the parties
  diverge OR the margin is tight** (within ~15%); omit for lopsided bipartisan
  votes. This is compatible with the approved mock (60–40 party-line still shows,
  because the parties diverge) and is a tweak to the one existing knob, not a new
  mechanism. Keep it a single tunable threshold.
- Add independents: render `I y–n` only when an independent broke from caucus or was
  decisive — not on every vote.
- Split labels stay muted gray (already the case), which is what keeps the red
  outcome verb from colliding with a red party label.

## Constraints

- Text-only markdown in `content_md`. No component, no raw HTML. The color rule is
  render-layer only.
- No new tokens. Confirm `--stage-enacted` / `--stage-floor` / `--party-republican`
  are the real names before mapping.
- Static, no motion. Web and `.md` content identical except the render-layer color.
- Lead prose (`VOTES_COMMENTARY`) still fed true per-bucket counts and per-chamber
  totals, never the capped list (the HO 352 undercount lesson). Update it in lockstep
  if the new verbs/ordering change what the headline should say.

## Ship

- A sitting week: decided votes listed, failed/blocked first then by closeness,
  capped ~8 with the remainder line; new BLOCKED/REJECTED verbs appear when the data
  has them.
- Outcome verbs colored on the web render (green/amber/red per the map); the
  downloaded `.md` is plain bold markdown, no color or HTML — verify both on a real
  generated report.
- Split shows on contested/divergent votes only; lopsided votes show the margin
  alone; independents only when notable.
- One clean commit. Shared tree is live: explicit pathspec, re-check HEAD before
  push. `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.
