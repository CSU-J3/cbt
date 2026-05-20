# 99 — Visualization inventory + idiom audit

## What this is

Discovery-only handoff. Three handoffs this session had wrong premises that pre-flight caught; the visualizations theme (currently 70%) has the same risk because the status annotation "funnel + topic dist + scatter" reflects partial existing work but I don't know which charts are actually shipped vs scaffolded vs still missing. Audit the ground truth before writing the next chart handoff.

No new charts. No refactors. One markdown doc as the deliverable.

## In scope

Produce `docs/viz-audit.md` covering:

1. **Existing chart components.** Inventory every component in `components/` (and anywhere else) that renders a chart, graph, funnel, distribution, scatter, sparkline, or any other visual representation of data. Likely targets to look for: stage funnel, topic distribution, sponsor scatter, activity-over-time, anything else.

2. **For each chart, document:**
   - Component name + path
   - Data source (query function it consumes, e.g., `getStageDistribution`)
   - Render location(s) (which page/route it appears on, what surrounding context)
   - Visual approach (raw SVG, divs+CSS, Recharts, D3, hand-rolled — whatever is actually in the code)
   - State: shipped + working / shipped but stale / scaffolded but not wired / dead code
   - HO it was introduced (best guess from git log / handoff docs if a marker is obvious)

3. **The established visual idiom.** Per HO 81's spec, the stage funnel went with "no chart library, divs and CSS, terminal aesthetic." Whether that idiom held across subsequent charts is the question. Document what's actually in use, with one or two sentences of pattern (color tokens, layout, interaction model like click-to-filter). If charts disagree on idiom, flag the divergence — that's a future debt item.

4. **Roadmap mapping.** From `docs/roadmap.md` theme 5, the candidate first charts list is:
   - Stage funnel on the home page
   - Topic distribution faceted by chamber
   - Activity over time stacked by topic
   - Sponsor productivity scatter (volume vs. pass rate) on `/sponsors`
   - 119th vs 118th laws-enacted comparison on reports

   For each: built / partial / missing. One line each.

5. **The 30% gap.** Based on items 1-4, what's actually outstanding in the visualizations theme? Bulleted list, no editorializing. This is the input to the next chart handoff.

## Out of scope

- Writing or modifying any chart code
- Refactoring existing charts to a new idiom
- Building any missing chart
- Updating SKILL.md (the viz idiom note belongs in SKILL.md eventually, but ship the audit first and decide what to bake in once we see what's actually there)

## Deliverable

`docs/viz-audit.md`. Markdown. Tables or sections, your call — readable beats clever. No prose preamble; lead with the inventory table or section list.

Sketch:

```markdown
# CBT visualization audit (2026-05-20)

## Existing charts

| Component | Path | Data source | Render at | Approach | State | HO |
|-----------|------|-------------|-----------|----------|-------|-----|
| StageFunnel | components/StageFunnel.tsx | getStageDistribution() | / | divs + CSS | shipped | 81 |
| ... | ... | ... | ... | ... | ... | ... |

## Visual idiom

(2-3 sentences on what pattern the existing charts share, or where they diverge.)

## Roadmap mapping

- Stage funnel: built (HO 81)
- Topic distribution by chamber: ...
- Activity over time stacked by topic: ...
- Sponsor productivity scatter: ...
- 119th vs 118th laws-enacted comparison: ...

## What's missing

- ...
- ...
```

## Acceptance

- `docs/viz-audit.md` exists
- Every chart component in the repo appears in the inventory
- Every roadmap viz item has a one-line built/partial/missing verdict
- "What's missing" section is concrete enough to scope the next chart handoff from
- Single commit: `docs: visualization audit (HO 99)`
- No code files changed

## Notes

- If the audit turns up that the existing idiom has already drifted (e.g., one chart hand-rolled, another using Recharts), flag it but don't fix it here. The fix belongs in the next chart handoff or its own refactor handoff.
- Best-effort on HO numbers in the inventory — `git log --oneline -- components/StageFunnel.tsx` or similar usually gets you the introduction commit. If a chart predates handoff numbering, just say "pre-numbered."
- Cheap handoff. ~10-15 minutes of reading + writing. The output is what unblocks the next real chart handoff.
