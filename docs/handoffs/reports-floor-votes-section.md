# HO NNN — Reports: weekly floor-votes section

Assign the next free number in `docs/handoffs/`. New section inside the existing weekly report, off the HO 353 probe (votes data confirmed present and current). Resolved in the design chat. The markdown-parity constraint governs the whole section; one render-layer color rule is the only new piece of architecture, flagged below.

## Established context (per HO 352 / 353, confirm before editing)

- The report is one `content_md` markdown string. It's web-rendered via `ReportMarkdown` (no rehype-raw, renders no client components) and served verbatim as the `.md` download. Anything that isn't plain markdown either fails to render or leaks literal HTML into the file (HO 352 proved this with the StageFunnel bar). So the section is text-only markdown.
- Data: `votes` (+ `member_votes`, `members`). 1,429 rows for the 119th (house 586 / senate 843), date-rangeable on `vote_date`. Per-vote `question` / `description` / `result` / `yea` / `nay` / `present` / `not_voting` are 100% non-null. Party split is derivable through `member_votes` → `members`. 832 votes carry a clean `bill_id` (zero orphans); 597 are non-bill (mostly `PN` nominations). Fresh through 06-23.
- The section is assembled in `assembleMarkdown` (`lib/report-generation.ts`) alongside the other sections. The prose lead is LLM-generated and must be fed true counts, not a capped sample (HO 352 lesson: the LLM undercounted off a truncated list).

## Placement

Immediately after Stage movements. The ladder shows what moved and how far; votes shows the tally and split. Back-to-back so the boundary reads.

## Section: Floor votes (V)

Header `## Floor votes (V)`, where V is the total recorded votes that week across both chambers, matching the ladder's `(N)` convention. Renders uppercase like the other section headers.

### Selection — what gets listed

A vote is listed only if it decided something. Three buckets:

1. Final passage of a bill → `PASSED` / `FAILED`
2. Decisive cloture or procedural that broke or sustained a filibuster on a bill → `ADVANCED` / `BLOCKED`
3. Contested confirmation (a recorded roll call with real opposition) → `CONFIRMED` / `REJECTED`

Amendments, routine motions, and the unanimous-consent nomination flood are out.

Order: failed and blocked first (that's the signal the ladder can't carry), then by margin closeness (`|yea − nay|` ascending). Confirmations sort in by margin.

Cap ~8 listed. Remainder line: `· + N more recorded votes (procedural and amendment)`, where N is V minus the listed count.

Selection keys off `question` / `description` text (which encode "On Passage", "On Cloture", "On the Nomination", etc.) plus the yea/nay margin. Confirm the exact strings in the data before wiring the filter.

### Line shapes

Two shapes, told apart by the outcome verb and whether there's a bill link.

Bill vote:
```
**OUTCOME** · CH · [BILL_ID](/bills/slug) Title · yea–nay[ · D y–n · R y–n]
```

Confirmation:
```
**OUTCOME** · CH · Nominee → Office · yea–nay[ · D y–n · R y–n]
```

- `OUTCOME` is bolded and one of the six tokens.
- `CH` is `H` or `S`.
- The bill reference is a markdown link to the bill page (amber on render, literal `[HR 12](/bills/hr-12)` in the `.md`).
- Margin (`yea–nay`) always shown, primary text on render.
- Party split shown only when the parties split or the margin is tight (within ~15%); omitted for lopsided bipartisan votes. Independents (`I y–n`) only when an independent broke from caucus or was decisive. The split renders in muted (gray) text, so the red FAILED verb never collides with a red party label.
- Cloture votes carry the word `cloture` before the margin: `ADVANCED · S · [S 1290](…) AI Safety Standards Act · cloture 51–49 · D 48–0 · R 3–49`.
- `Nominee → Office` is parsed from `description`; no bill link (nominees aren't members, so don't assume linkability).

### Outcome colors — the one architecture note, render-layer only

`ReportMarkdown` gains a rule: a `<strong>` whose text is exactly one of `{PASSED, FAILED, ADVANCED, BLOCKED, CONFIRMED, REJECTED}` gets a color class. Mapping uses existing tokens, no new ones:

- `PASSED`, `CONFIRMED` → `--stage-enacted` (green), decided yes
- `ADVANCED` → `--stage-floor` (amber), moved forward but not final
- `FAILED`, `BLOCKED`, `REJECTED` → `--party-republican` (red), decided no

`content_md` carries no color and no HTML, just `**FAILED**`. The `.md` download serves the raw string (bold asterisks, no color). Color exists only in the web render. The match is exact-text on the bolded token, so the word "passed" in prose never false-matches.

⚠ This is the single deliberate divergence between web and download. It does not change how reports are stored (still one pure-markdown string); it's a scoped render rule on `ReportMarkdown`. If the rule is unwanted, the fallback is uncolored bold outcomes (the words still carry the meaning) with zero render change. Confirm the rule is acceptable, or flip to uncolored.

### Empty and partial states

- One chamber in recess: a status line replaces that chamber's absence (`HOUSE · in recess this week (last vote <date>, returned <date>)`), and the listed votes are the sitting chamber's. Dim text on render; plain text in the `.md`.
- Both chambers in recess: the section collapses to one line: `Both chambers were in recess this week. No floor votes.` Header `(0)`.
- In session but nothing decisive: one line: `Both chambers were in session but took no final-passage or confirmation votes; all N recorded votes were procedural or on amendments.`

### Prose lead

LLM-generated, 1–2 sentences, fed the true per-bucket counts and per-chamber totals (never the capped sample). States the recorded-vote totals per chamber, the headline (top-ranked vote), and the recess note if a chamber was dark. Update the prose-generation prompt with a Floor-votes section block describing this shape, in lockstep with the assembly (HO 352 pattern: prompt and assembly change together or the commentary maps to the wrong structure).

### Boundary with the stage ladder

No duplication. The ladder owns the stage fact (it moved, how far). Votes owns the count fact (the tally and split). A passage vote can appear in both, stating different facts: the votes line states the count (`PASSED 220–210`), never the stage advance (`advanced to floor`), which is the ladder's. Lead the section with what's absent from the ladder (failures, blocks, confirmations), then the passage tallies.

## Constraints

- Text-only markdown in `content_md`. No component, no raw HTML. The color rule is render-layer only.
- No new tokens. Reuse the stage and party tokens as mapped.
- Static, no motion.
- Web and `.md` content identical except the render-layer outcome color.

## Ship

- A sitting week lists the decided votes (failed first, then by closeness), capped ~8 with the remainder line.
- A recess week shows the dark-chamber status line and the sitting chamber's votes; both-recess and nothing-decisive each collapse to one line.
- Outcome verbs colored on the web render; the downloaded `.md` is plain markdown with no color or HTML.
- Party split appears only on contested votes; lopsided votes show the margin alone.
- Lead prose totals match the true weekly counts (the capped list never drives the numbers).
- One clean commit, explicit pathspec (shared working tree, re-check HEAD before push). `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

(Stock trades came back from the probe as a separate section, secondary. Not in this handoff.)
