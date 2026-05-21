# 109 — Weekly reports audit (diagnostic, halt for fix sequencing)

## What this is

Weekly reports is the lone sub-95% theme. The push goal is 95%, but "what's actually broken" needs eyes on the 5 generated reports before any fix handoff gets scoped. Without that, fix handoffs are guesses.

This handoff is diagnostic-only. No code, no commits, no migrations. Read the 5 reports in `reports/` (or wherever the report rows / files live), score them across four dimensions, and report back in chat with a prioritized fix sequence. After sign-off, focused fix handoffs (110, 111, etc.) land each dimension.

Same pre-flight pattern as HO 107 phase 1. The gate paid for itself there. Same expectation here.

## Approach

1. **Locate the 5 reports.** Could be Turso rows (a `reports` table), MD files in `reports/`, or rendered HTML on `/reports/[id]`. The roadmap mentioned MDX vs DB scoping but I don't remember which way that landed. Check.
2. **Read all 5 end-to-end.** Not skim — actual read. Treat them as a reader would.
3. **Score each across four dimensions** (the four buckets from the chat scoping):

   - **Prose quality** — does the LLM-generated copy read like a tired newsletter (filler phrases, hedging, "noteworthy this week" boilerplate), or like an analyst who knows the corpus? Flag repeated phrases across reports, stock framings, anywhere it sounds like a press release instead of a sense-making tool.
   - **Section structure** — what sections are present, in what order. What's missing that should be there per the roadmap framing question ("WTF is going on in Congress?"). What's present that adds no signal. What's in the wrong order. Are stage transitions actually being counted (the May 4 zero-count issue was a known bug — has it recurred)?
   - **News signal integration** — HO 104 shipped matcher confidence. Are reports surfacing high-confidence news ties? Is there a "most talked about" section, and does it use confidence to filter noise? If news isn't appearing at all in reports despite the matcher being live, that's a wiring gap.
   - **Visual / page UX** — is there an archive at `/reports`? Permalinks per report? Is the page scannable on first load, or does it read as a wall of text? Date prominent? Mobile readable?

4. **Identify concrete issues per dimension.** Examples (not exhaustive):
   - "Prose: every report opens with 'This week in Congress...' — boilerplate, drop"
   - "Structure: enacted-bills section appears in reports 1-2 but missing from 3-5, looks like a query regression"
   - "News: zero news mentions cited across all 5 reports despite 200+ matches in `news_mentions`"
   - "UX: no archive page; reports only reachable via stage-funnel breadcrumb"

5. **Propose a fix sequence.** Group issues into 2-4 focused handoffs (HO 110, 111, 112, maybe 113). For each, estimate scope (small / medium / large), what files it touches, and what depends on what. The point is to make each fix handoff shippable in one Code session without bundling.

   Sequencing guidance: prefer the structural/data fixes before the prose tuning. If section structure is broken (missing stage transitions, dropped sections), fixing prose on top of broken data is wasted iteration. Likewise, if news signal isn't wired into reports at all, no amount of prompt tuning surfaces what isn't there.

## Deliverables (in chat, no commits)

1. Brief note on where reports actually live (table, files, rendered route, all three).
2. Per-dimension scoring with concrete issue list. Brevity over comprehensiveness — best ~5 issues per dimension, not a sprawl.
3. Proposed fix-handoff sequence: titles, scopes, dependencies.
4. Optional: anything cross-cutting that doesn't fit one bucket (e.g., the report generation prompt lives in `lib/report-generation.ts` and every change interacts with it).

## HALT

Stop here. Wait for sign-off on the fix sequence before any commit or fix handoff lands. The sign-off determines which fix handoff gets written first.

## Out of scope

- Any code changes
- Reading the report generation prompt with the intent to rewrite it (read for context only — rewriting is HO 110/111 territory after sequencing is locked)
- Touching the news matcher (HO 104 territory)
- Building an archive page (HO 112+ territory if UX surfaces as a fix)
- Backfilling missing reports

## Notes

- The roadmap framing question ("WTF is going on in Congress?") is the ground truth for "is this report doing its job." Don't score against generic "is this a good newsletter." Score against whether someone who opened the dashboard at 8am Monday gets a sense-making answer from the report.
- If only 4 reports exist (not 5), or 6, just say so. The "5 reports live" annotation was my memory and may be off.
- May 4 report had a known stage-transitions zero-count bug from a no-backfill rule. If it still reads that way, file it as a structural fix — it's been 17 days of subsequent reports to confirm it didn't regress past that one date.
