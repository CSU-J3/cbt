# 112 — Weekly reports prose & prompt tuning

## What this is

Third fix handoff from the HO 109 audit. Structural fixes landed in HO 110; news signal wiring in HO 111. This one tunes what the LLM actually writes, given good structure and properly-filtered news context now in place.

The audit's through-line — "reports are data dumps; the only synthesis surface is the LEAD, and it stat-recites" — points the lift here. Synthesis is what the LEAD is supposed to do. Right now it doesn't, and the rest of the prose follows the same template-y energy.

Scope: SYSTEM_PROMPT + buildUserPrompt. No structural changes (HO 110), no query changes (HO 111). Just prose.

## In scope

### 1. Fix the LEAD

The audit found 4/5 LEADs were stat-recite ("This week, 216 new bills were introduced", "Congress introduced 100 new bills this week") — exactly the anti-pattern the existing SYSTEM_PROMPT instruction tells the LLM to avoid. Two possibilities:

- **Instruction is too weak.** The "avoid generic openers" line is being overridden by the input data shape. The LLM gets a stat dump and writes a stat summary because that's the easiest interpretation of "synthesize this." Fix: harden the instruction with explicit examples of what's wrong and what's right.
- **Input context is too sparse.** The LLM can't synthesize what it doesn't see. If `buildUserPrompt` passes counts but not relationships (which topics are converging, which sponsors are unusually active, which committee is the bottleneck this week), then the LLM has nothing to synthesize FROM.

Both probably true. Address both:

- Rewrite the LEAD instruction with concrete anti-patterns (the actual bad LEADs from the 5 historical reports work as negative examples) and a concrete what-to-do-instead.
- Audit `buildUserPrompt` — is it giving the LLM the raw material for synthesis? Top movers, biggest topic shifts, week-over-week deltas, anything beyond plain counts. Add what's missing.

### 2. Stop the restate-then-list pattern

Enactments prose says "Three bills became law this week: S 4465, HR 7147, and HJRES 140." Bullet list immediately below shows the same three IDs.

Same likely pattern in other sections — the LLM names every entity it's about to list. Fix at the prompt level: instruct the LLM that when a bulleted list follows, the prose introduces the section's significance, not its contents.

Sweep `assembleMarkdown` for every section that pairs prose with a list. Each one needs the same instruction.

### 3. Wire the `confidence_tier` from HO 111 into news prose

HO 111 added `confidence_tier: 'high' | 'medium'` to the news section's prompt context. SYSTEM_PROMPT needs corresponding language guidance:

- **High-confidence:** assertive verbs ("drew coverage in", "received attention from", "was cited by")
- **Medium-confidence:** hedging verbs ("appeared in", "was mentioned by", "showed up in")

The tier exists. The vocabulary has to come from the prompt, or the LLM will either ignore the tier or invent something inconsistent.

### 4. Fix the count-aware and direction-aware prose

Audit found 05-11 stage commentary saying "All five of the top stage transitions…" while the section lists 10. The LLM is hallucinating a count. Also flagged: narrating a backward floor→committee transition as a routine forward step.

Two prompt fixes:

- Don't let the LLM name counts. If "five" is wrong, tell the LLM to write "the leading stage transitions" or "this week's transitions" instead of any number.
- Add direction awareness. Stage data should pass "direction: forward | backward | other_chamber" alongside the transition so the LLM can narrate backward transitions honestly ("HR 8469 dropped back to committee from floor consideration"). If the data doesn't currently encode direction, that's a `gatherReportData` add.

### 5. Anti-pattern sweep

Beyond the specific findings, audit the SYSTEM_PROMPT for any anti-newsletter language the LLM tends to default to:

- "noteworthy this week"
- "of particular interest"
- "stood out" / "marked a significant"
- Any of Corey's banned phrases ("delve", "underscore", "leverage", etc. — those are user preferences but also worth banning at the prompt level so the LLM doesn't reach for them)

Add explicit don't-write-this list to SYSTEM_PROMPT. Spell out a few of the worst offenders so the LLM has clear negative examples.

## Out of scope

- Switching LLM providers or model (still Gemini 2.5 Flash)
- Restructuring the prompt assembly (the SYSTEM_PROMPT + buildUserPrompt split stays)
- Adding new sections
- Bill-ID linking (HO 113)
- Regenerating the 5 backfilled reports (they stay as historical artifacts; verification happens against fresh generation)
- Tuning the news matcher prompt (HO 104 territory; out of scope for reports)

## Verification

Prompt iteration is iterative by nature. First pass probably won't be perfect.

1. Regenerate (don't write) at least two reports against historical weeks where the data exists (05-11 has stage data; current partial week has news data — but HO 110's incomplete-week guard blocks regen there, so 05-11 is the better target).
2. Read the LEAD aloud. Does it sound like analyst prose or template prose? If still template, the LEAD instruction needs another iteration.
3. Read the enactments section. Are the bills named twice (once in prose, once in list)? If yes, anti-restate instruction needs sharpening.
4. Read the news section against the `confidence_tier` of its mentions. Does the verb hedge appropriately on medium-confidence?
5. Spot-check for count hallucinations. Any "five" / "three" / "all of the top X" that mismatches the actual list.

If the first pass surfaces specific failure modes that another round of prompt tuning would fix cleanly, file as HO 112.1 follow-up rather than over-iterating in this handoff. The discipline is "ship one pass, observe, iterate" not "rewrite the prompt until it's perfect."

## Acceptance

1. SYSTEM_PROMPT rewritten with hardened LEAD instruction, anti-restate instruction, `confidence_tier` vocabulary, no-counts-in-prose instruction, banned-phrases list.
2. `buildUserPrompt` enriched with synthesis raw material (top movers, deltas, anything else identified during the in-flight audit). Document what was added in the commit.
3. At least one regenerated report's LEAD reads as synthesis, not stat-recite.
4. At least one regenerated report's enactments section doesn't restate-then-list.
5. At least one regenerated report's news section hedges appropriately by confidence tier.
6. No count hallucinations in regenerated reports.
7. SKILL.md updated with the prompt convention (one-liner; the prompt itself lives in source).
8. Commit: `feat: weekly report prose & prompt tuning (HO 112)`.
9. Working tree clean, push.

## Notes

- The audit named 5 prose issues. Numbers 1, 4, 5 are SYSTEM_PROMPT changes. Number 2 (zero-case stage redundancy) was already fixed in HO 110. Number 3 (enactments restate) is the restate-then-list pattern in this handoff.
- Prompt tuning rarely lands first-try. If after this handoff the LEAD is better but still off, that's not a HO 112 failure — that's the second round of iteration. File HO 112.1.
- HO 113 (bill-ID linking) is independent and orthogonal. Can ship before, after, or in parallel with this.
- After this lands, weekly reports theme should be at or near 95%. HO 113 is the closer.
