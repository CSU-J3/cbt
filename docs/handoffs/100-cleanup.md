# 100 — Cleanup: commit roadmap.md, fix SKILL.md funnel idiom

## What this is

Doc-only handoff. Two corrections from HO 99's findings:

1. `docs/roadmap.md` is referenced in handoffs and SKILL.md but doesn't exist in the repo. It lives in the Claude project upload, which means I can cite it freely but Code can't read it. Result: every handoff citation to "the roadmap" has been pointing at a file Code couldn't open. Commit the canonical version into the repo.
2. SKILL.md describes the stage funnel as "hand-rolled SVG." HO 99's audit found it's actually divs + CSS. Two of the five charts use SVG (BillsTimeSeries, SponsorProductivityScatter); three use divs + CSS (StageFunnel, TopicDistribution, TopicMixByChamber). The idiom is a principled split, not a single approach. Update SKILL.md to reflect what's actually in the codebase.

No code changes. One commit, two file edits.

## In scope

### File 1: `docs/roadmap.md`

The canonical roadmap content is bundled alongside this handoff as `roadmap.md`. Copy it into `docs/roadmap.md`. Don't edit, don't reformat. If `docs/` doesn't exist (unlikely given `docs/handoffs/` lives there), create it.

### File 2: `SKILL.md`

Find the section that describes the stage funnel's rendering approach. It currently calls the funnel "hand-rolled SVG" (or similar). Replace that characterization with the actual split:

**Suggested text** (adapt to the section's existing voice):

```markdown
### Chart idiom

Five charts ship today, split by what the chart needs:

- **divs + CSS** for 1-D bar rankings — StageFunnel, TopicDistribution, TopicMixByChamber. No coordinate system needed; the values map directly to bar widths via CSS variables. Inherits the terminal aesthetic from `app/globals.css` with zero extra scaffolding.
- **Hand-rolled SVG** for charts that need a coordinate space — BillsTimeSeries (time on x, count on y), SponsorProductivityScatter (volume vs. pass rate). Each currently re-declares its own axis and legend scaffolding; when a third SVG chart lands, extract the shared primitives.

No chart library. Recharts, D3, Observable Plot are all available via npm but the terminal aesthetic argues for control over convenience.
```

If SKILL.md already has a "Charts" or "Visualization" section, edit it in place. If not, add the section near the existing frontend-design notes.

## Out of scope

- Restructuring the roadmap content
- Rewriting any chart components
- Extracting the shared SVG primitives (worth doing when the third SVG chart lands, not now)
- Updating handoff docs to match — the roadmap commit makes future references resolve correctly; old handoffs stay as-is for traceability

## Acceptance

- `docs/roadmap.md` exists in the repo, content identical to the bundled `roadmap.md`
- SKILL.md chart-idiom section reflects the actual three-divs / two-SVG split
- Single commit: `docs: commit roadmap.md, fix SKILL.md chart idiom (HO 100)`
- `git diff` shows only `docs/roadmap.md` (new) and `SKILL.md` (modified)

## Notes

- The roadmap.md file is canonical project planning. Future handoffs can cite it freely and Code will be able to follow the references.
- HO 99's audit also flagged that the funnel was misattributed in SKILL.md to "HO 81" when the actual introduction was a bundle labeled HO 74/77/79 per git log. The audit doc captures the correct provenance; SKILL.md doesn't need to track introduction HOs per chart, so don't add that mapping here. The fix is at the idiom level only.
