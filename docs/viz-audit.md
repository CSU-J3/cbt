# CBT visualization audit (2026-05-20)

## Existing charts

| Component | Path | Data source | Render at | Approach | State | HO |
|-----------|------|-------------|-----------|----------|-------|-----|
| `StageFunnel` | `components/StageFunnel.tsx` | `getStageDistribution()` | `/` — dashboard, left pane | divs + CSS (`.funnel-bar-track`/`-fill`, horizontal bars) | shipped, working | ~56 (bundle `4aa79ac`) |
| `TopicDistribution` | `components/TopicDistribution.tsx` | `getTopicDistribution()` | `/` — dashboard, right pane | divs + CSS (`.topic-dist-bar-track`/`-fill`) | shipped, working | ~56 (bundle `4aa79ac`) |
| `TopicMixByChamber` | `components/TopicMixByChamber.tsx` | `getTopicMixByChamber()` | `/` — dashboard, below the grid | divs + CSS (two columns, `.topic-chamber-row` bars on a shared scale) | shipped, working | 76 (bundle `85f4f22`) |
| `BillsTimeSeries` | `components/BillsTimeSeries.tsx` | `getBillsByMonth()` | `/` — dashboard, below the grid | hand-rolled SVG (monthly bars stacked by topic, axis + legend) | shipped, working | 66 (bundle `85f4f22`) |
| `SponsorProductivityScatter` | `components/SponsorProductivityScatter.tsx` | `getSponsorProductivity()` | `/members` — above the sponsor list | hand-rolled SVG (scatter, volume × pass rate, party-colored dots) | shipped, working | 67 (bundle `85f4f22`) |

All five are imported and rendered on live routes (`app/page.tsx`, `app/members/page.tsx`), each backed by a real `lib/queries.ts` function. None are scaffolded, stale, or dead.

**Considered, not charts** (data displays, excluded from the inventory): `ActivityTicker` (list of recent stage transitions rendered via `BillRow`), `CompetitiveRacesBlock` (list of races with `RatingChip`s), `MemberStats` / `MemberVoteStats` / `MemberFundraisingLine` (single-line stat readouts).

## Visual idiom

The terminal aesthetic holds across all five — monospace font, CSS-variable color tokens (`--stage-*`, `lib/topic-colors`, `--party-*`), 11–12px uppercase tracked labels, no chart library. The idiom splits cleanly by what the chart needs:

- **1-D rankings → divs + CSS.** `StageFunnel`, `TopicDistribution`, and `TopicMixByChamber` are nested `<span>`s: a label, a `*-bar-track` with a width-percent `*-bar-fill`, and a count. No SVG.
- **Anything needing a coordinate space → hand-rolled SVG.** `BillsTimeSeries` (time on x) and `SponsorProductivityScatter` (2-D scatter) use a `viewBox="0 0 1000 H"`, a `PAD` constant, `<line>` gridlines, mono-font `<text>` axis ticks, CSS-var fills, and a flex-wrap swatch legend below the `<svg>`.

The divergence is principled — a scatter can't be divs — but the two SVG charts each re-declare their own `VB_WIDTH`/`PAD`/axis-tick/legend scaffolding; there is no shared chart primitive.

Interaction model also varies: `StageFunnel` and `TopicDistribution` wrap rows in `<Link>`s for dashboard click-to-filter (`?stage=` / `?topics=`); `SponsorProductivityScatter` dots link to `/members/[bioguideId]`; `TopicMixByChamber` and `BillsTimeSeries` are static (SVG `<title>` tooltips only).

## Roadmap mapping

No `docs/roadmap.md` (or any `roadmap*` file) exists in the repo — mapped against handoff 99's inline theme-5 list:

- Stage funnel on the home page — **built** (`StageFunnel`, `/`)
- Topic distribution faceted by chamber — **built** (`TopicMixByChamber`, `/`)
- Activity over time stacked by topic — **built** (`BillsTimeSeries`, `/` — monthly bars stacked by topic)
- Sponsor productivity scatter (volume vs. pass rate) — **built** (`SponsorProductivityScatter`); lives on `/members`, the route the roadmap calls `/sponsors`
- 119th vs. 118th laws-enacted comparison on reports — **missing**

## What's missing

- The 119th-vs-118th laws-enacted comparison chart. No component, no query — there is no cross-Congress enacted-count query in `lib/queries.ts` — and `/reports` + `/reports/[slug]` render no charts at all.
- No shared SVG chart scaffolding. `BillsTimeSeries` and `SponsorProductivityScatter` each re-declare `VB_WIDTH`, `PAD`, axis-tick rendering, and legend markup; a third SVG chart would re-implement it a third time.
- The reports surface has no visualization layer; it is Markdown-only.

## Audit notes

- `docs/roadmap.md` does not exist — handoff 99 cites "roadmap.md theme 5" but no roadmap file is in the repo.
- SKILL.md describes the dashboard funnel as "static hand-rolled SVG"; `StageFunnel.tsx` is actually divs + CSS. Only `BillsTimeSeries` and `SponsorProductivityScatter` use SVG. (SKILL.md fix is out of scope per handoff 99 — flagged for the next handoff.)
- HO attribution is best-effort. `TopicMixByChamber` / `BillsTimeSeries` / `SponsorProductivityScatter` were first committed in bundle `85f4f22` (labeled "HO 74, 77, 79"); SKILL.md attributes them to HO 76 / 66 / 67 respectively — SKILL.md's numbers are used above. `StageFunnel` / `TopicDistribution` shipped in bundle `4aa79ac` ("handoffs 50-58"), in the ~HO 56 dashboard redesign — handoff 99's "HO 81 spec" reference postdates the component itself.
