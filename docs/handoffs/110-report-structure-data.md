# 110 — Report structure & data

## What this is

First of four fix handoffs from the HO 109 audit. Structural layer of the weekly reports rebuild — section ordering, honest zero-data handling for early weeks, incomplete-week guard, and the `government_operations` enum leak. Prose tuning, news wiring, and bill-ID linking come later (HO 112, 111, 113 respectively) and depend on this landing first.

Theme is the roadmap framing question — "WTF is going on in Congress?" Every section either earns its place by answering that question or gets trimmed.

## In scope

### 1. Section reorder

Current order buries the signal. Reorder so the strongest signals lead and the lowest-signal section ends:

1. LEAD (synthesis prose) — unchanged position
2. Most talked about (news signal — strongest "what matters right now")
3. Stage movements (what advanced this week)
4. Enactments (what became law)
5. Topic breakdown (what's getting worked on)
6. Newly stalled (anti-news, trimmed — see #2)
7. New introductions count (raw activity stat — moved to end)

If a different order surfaces from the section names actually in `assembleMarkdown`, propose and justify against the framing question in the commit message. Don't reorder blindly.

### 2. Trim "Newly stalled"

Currently ~30 bare bill IDs across 10 topics — Code's audit flagged it as the bulkiest, lowest-signal section. Compress to:

- Top 3 topics by stall volume
- Up to 3 bill IDs per topic (so max 9 IDs total)
- One-line topic context if the section header alone isn't enough ("Healthcare bills stalled" tells you nothing; "Healthcare stalls trending up: 14 bills, 3 in committee for 60+ days" tells you the shape)

Don't gut the section to nothing — stalls are part of the framing answer. Just stop the ID-wall pattern.

### 3. Honest stage-zero copy for early-week reports

`stage_changed_at` wasn't backfilled, so 04-20/04-27/05-04 reports legitimately have zero stage data. Currently the section reads as if Congress did nothing.

Two cases to differentiate:

- **No data because tracking hadn't started.** Text like: "Stage transition tracking began [date]. This report predates that and shows no movements." Don't pretend Congress was idle.
- **No data because the week was genuinely quiet.** Existing zero-case text is fine.

Decide which case applies via comparing the report's `week_end` to a known stage-tracking-started timestamp. The cutoff lives somewhere — probably either a constant in `lib/report-generation.ts` or derivable from `MIN(stage_changed_at)` across the bills table. Use whichever is cleaner.

Also add a STAGE_COMMENTARY zero-case instruction to the prompt — the audit flagged it as missing (`ENACTMENTS` and `MOST_TALKED` have one). Match their style.

### 4. Incomplete-week guard

Report 05-18 was generated 05-19 covering 05-18..24 — a week that hadn't ended. Result: near-empty report.

Add a guard in the report-generation flow: if `week_end > today`, refuse to generate (or generate but flag the row, depending on the existing schema). Recommended behavior — refuse, log, retry next cron tick once the week has closed.

Decide if existing partial-week reports get regenerated or stay as historical artifact. Recommend stay — they're already in the table, regenerating them silently rewrites history. If you want them cleaned, fold into a separate one-row DELETE handoff later.

### 5. `government_operations` enum leak (1-liner)

`buildUserPrompt` feeds the LLM `d.topicIntroductions[0].topic` (raw enum) instead of running it through `topicLabel()`. Fix: wrap with `topicLabel()` (or equivalent display formatter) wherever topic enums get passed into the prompt.

Sweep `buildUserPrompt` for any other raw-enum leaks while you're in there. Stage values, topic values, anywhere an enum gets serialized into LLM input. The LLM copies what it sees.

## Out of scope

- Prose tuning beyond the STAGE_COMMENTARY zero-case instruction (HO 112)
- News query confidence filtering (HO 111)
- Bill-ID linking in rendered reports (HO 113)
- Regenerating historical reports
- Adding new sections that don't currently exist
- Touching `ReportMarkdown.tsx` rendering (that's HO 113)
- Adjusting the LEAD generation prompt (HO 112)

## Verification

Before/after on at least two reports:

1. The 05-04 report (raw enum leak case) — verify "government_operations" is gone, replaced with the display label.
2. The 04-27 report (zero-stage early-week case) — verify the section now reads as "tracking hadn't started" rather than "Congress did nothing."
3. Generate a fresh report against current data and verify section order matches the new sequence.
4. Attempt to generate a report for a future-ending week — verify the incomplete-week guard refuses or flags.

Don't regenerate the 5 backfilled reports in this handoff — leave them as historical artifacts. Verification can happen against fresh generation against the same week data without overwriting the existing rows.

## Acceptance

1. `lib/report-generation.ts` reflects the new section order (visible in `assembleMarkdown`).
2. "Newly stalled" trims as specified — max 3 topics × 3 IDs.
3. Stage-zero copy differentiates the two cases honestly.
4. STAGE_COMMENTARY prompt has a zero-case instruction.
5. Incomplete-week guard refuses or flags partial weeks.
6. `government_operations` (and any other raw-enum) leak fixed.
7. Verification report regenerated against at least one historical week, output spot-checked.
8. SKILL.md updated where applicable (the incomplete-week guard is worth a one-liner; section order isn't worth documenting).
9. Commit: `fix: weekly report structure & data (HO 110)`.
10. Working tree clean, push.

## Notes

- The 5 backfilled reports were generated 2026-05-19 22:19–22:35 in a single batch. That batch context explains several findings (incomplete-week 05-18, structural news-blanks for April reports). Code's audit already named this — file under "historical context, not regenerating" rather than treating it as a fix target.
- The structural-news-blank issue (RSS feeds don't carry historical articles) is a permanent reality for the 4 backfilled reports. Not a fix target. Going-forward reports will populate organically.
- After this lands, HO 111 takes the news wiring next (confidence filtering, ranking, surfacing high-confidence ties). Sequencing this way means HO 111's news improvements don't get buried at the bottom of the report.
