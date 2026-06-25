# HO 358 — Reports: floor votes section

> Claim the next free HO number; if 358 is taken in `docs/handoffs/`, use the next
> available and rename. Independent of the multi-user arc (355/356).

Add a Floor votes section to the weekly report, per the approved design mock.
Builds on the HO 353 probe (the `votes` table is complete and current through
06-23) and sits alongside the HO 352 stage ladder inside the same `content_md`.

**The mock is the spec.** Commit the approved mock to
`docs/design/floor-votes-section.html` before building so this handoff's reference
is live (mocks-in-repo rule). It carries three rendered states and, under each, a
**markdown-source panel** — those panels are the literal `content_md` target.

## Confirm the two edit locations (same coupling as HO 352)

- **Assembly:** `assembleMarkdown` in `lib/report-generation.ts` emits the section
  into `content_md`. Floor votes is a new section in that same function.
- **Prompt:** the lead is LLM-generated against the prose-generation prompt's
  section template. Add the votes-section guidance there in the same commit, or the
  lead maps to the wrong shape.

Grep both, confirm they still match HO 352's structure before editing.

## Parity is the governing constraint (the HO 352 lesson)

`content_md` is one markdown string, web-rendered by `ReportMarkdown` (no
rehype-raw, no client components) and served verbatim as the `.md` download.
Everything ships as plain markdown — the mock's source panel is the literal target.
Each named vote is one line:

```
**PASSED** · S · [S 880](/bills/s-880) Grid Security Act · 60–40 · D 47–0 · R 13–40
```

Bold outcome, markdown bill link, middot `·` separators, en-dash margins/splits.

## Render fidelity — the one decision, confirm before building

Plain markdown gives the bold outcome and the amber bill link for free — the two
highest-value cues. It does **not** give the mock's finer tints (dim
chamber/separators, primary-weighted tabular margin, muted tabular split). HO 352
hit this exact wall and shipped flat: the ladder renders with markdown primitives
(bold, `_emphasis_` for dim rungs, links) and no per-span coloring, because the
report has no custom line-renderer.

Two ways to land it:

- **(b) Vanilla render — recommended.** Bold outcome + amber link + the rest plain
  `--text-secondary`. Zero new machinery, consistent with how the 352 ladder
  already renders, parity-trivially-safe. The dense line reads flatter than the
  mock but stays legible.
- **(a) Custom line-render in `ReportMarkdown`.** A rehype pass that spots vote
  lines (leading `**PASSED/FAILED/ADVANCED/CONFIRMED**`) and tints the segments.
  Parity-safe (it only restyles text already in `content_md`; the `.md` is
  untouched). Operate on the parsed tree — the bill link and bold outcome are
  already distinct nodes; the custom part is tinting the chamber/margin/split text
  between them. Cost: pattern-coupled render code the line format must keep
  matching. Upside: it would lift the 352 ladder's colors back too.

Recommendation: ship (b) now, don't block the section on building render
machinery; treat (a) as an optional report-wide follow-up if the flat line reads
poorly. Either way the `.md` is byte-identical — this is a web-render choice only.
**Say which before running; body below assumes (b).**

## Section shape (locked by the mock)

- Header `## Floor votes (N)`, N = total recorded votes both chambers (named +
  collapsed). Nothing below changes it.
- **Lead:** 2–4 LLM sentences — per-chamber counts, the pivotal vote, what cleared.
  Feed it the true structured counts and the named-vote list; do not let it count
  off a sample (the HO 352 undercount bug).
- **Named votes, one line each:** outcome verb (PASSED / FAILED / ADVANCED /
  CONFIRMED), chamber (S/H), then for a bill `[ID](/bills/<slug>) Title`, for a
  nomination `Nominee → Position` (no link), then margin `yea–nay`, then party
  split when contested. Cloture/advance votes prefix the margin with `cloture`
  (`cloture 51–49`).
- **Collapse line:** `· + N more recorded votes (procedural and amendment)`,
  N = total minus named.
- Outcomes are uniform `--text-primary`; the verb carries pass/fail. The mock
  deliberately does NOT stage-color or red/green them. Don't.

## Edge + recess states (locked by the mock)

- **One chamber in recess** (zero votes that chamber, the other voted): a line
  above the list — `HOUSE · in recess this week (last vote Jun 11, returned Jun
  23)`. The return clause needs a vote after `week_end`; if the chamber hasn't
  voted again yet, drop it (`… (last vote Jun 11)`).
- **Both in session, zero named votes:** header + one quiet line, no list — "Both
  chambers were in session but took no final-passage or confirmation votes; all N
  recorded votes were procedural or on amendments."
- **Both in recess** (zero votes total): `## Floor votes (0)` + "Both chambers were
  in recess this week. No floor votes."

## Classification — derive from live data, don't assume the vocabulary

The named/collapsed split and the outcome verbs come from `votes` fields the probe
saw but didn't enumerate by value. Before writing the classifier, inspect the live
table for the actual vocabularies:

- `result` values (Passed / Failed / Agreed to / Rejected / Confirmed / …?).
- How cloture / motion-to-proceed reads in `question` / `description`.
- `amendment_designation` shape: `PN…` = nomination, amendment designations =
  amendment votes, null = ?

Derive outcome and type from those. Named = final passage (pass **or** fail) +
cloture that succeeded (ADVANCED) + confirmation. Everything else collapses. A
failed cloture defaults to the collapse line unless it's on a tracked bill and
clearly consequential — surface that from the data, don't force it. No fabricated
`result` strings; grep the table first.

## Party split — scope and display rule

- Derive from `member_votes` → `members`, grouped by party, yea/nay per party.
  **Scope the join to the named vote IDs only** (a handful per week), never all
  votes — `member_votes` is ~337k rows.
- Display rule: show the split when the vote is contested, omit when
  lopsided/bipartisan. The mock shows it on 49–51 / 51–49 / 60–40 and omits on
  412–18 / 88–12. Concrete starting rule: show when the losing position took
  ≥ ~25% of the total (tune later). One knob — flag it in the code.

## Boundary with the stage ladder (HO 352)

The ladder names bills that advanced by destination stage; this section names
recorded votes with tally + split. A passed bill appears in both (ladder:
advanced; votes: PASSED 412–18). The mock treats them as complementary lenses and
does not cross-reference. Build to that — no de-dup, no cross-link. Put Floor votes
after Stage movements (the natural read: what moved, then how the floor voted);
state the order and move on.

## Constraints

- No new tokens — the mock uses only `--text-primary/-secondary/-muted/-dim` and
  `--accent-amber`.
- Plain markdown into `content_md`; web and `.md` carry identical content.
- Static, no motion. Header `(N)` unchanged.

## Ship

- Generate against live data for a sitting week (both chambers, named + collapse)
  and the 2026-06-15 recess week (House-dark line, Senate-only list). Eyeball the
  web render and confirm the `.md` download carries the same lines.
- No fabricated outcomes; the classifier reads live `result` / `question` /
  `amendment_designation`.
- **Shared-tree hazard is live** (a co-agent is committing in this repo): named
  `git add <file>` only, re-check HEAD before pushing, commit by explicit pathspec
  so nothing foreign rides along.
- One clean commit. `git push`, then `npm run verify:deploy` until the served SHA
  matches HEAD.
