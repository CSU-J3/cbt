# HO 231 — Topic Distribution treemap (design item 3)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 231.

## What this is

Replace the topic-distribution **bubble cluster** with a **treemap**. HO 229 already did the Phase-1 verify — straight build, no HALT, one commit. Read the live files, match the existing rendering model, swap the component.

## Resolved premises (from HO 229 — don't re-derive)

- Current topic viz = **`components/DashboardBubbleChart.tsx`** (d3-hierarchy pack cluster), mounted at **`app/page.tsx:139`**. That's the component being replaced.
- **`lib/topic-colors.ts::topicColor()`** exists and exposes the per-group hex — the treemap reuses it. **No new tokens.**

## The one design call (read before building)

The design doc asks for two things that fight each other on skewed data: **"area encodes count"** AND **"every topic gets a labeled legible cell."** Topic counts are heavily skewed (GOV dominates, a long tail of small topics), so a pure area-proportional treemap gives big legible cells up top and sub-legible slivers in the tail. You can't have honest area *and* a fitted label in every cell.

**My call — area stays honest:**
- **Squarified treemap, strictly area-proportional.** Accurate area comparison is the entire reason we're leaving bubbles (bubble area is perceptually unreliable). Don't betray that.
- **Label every cell that clears a legibility floor** (cell is tall AND wide enough for `TOPIC` on one line + the count). Cells below the floor render filled and colored but **unlabeled, with `TOPIC + count` on hover** (the standard peek pattern used elsewhere).
- **Do NOT inflate small cells to fit labels.** Faking a min-size makes the treemap lie about magnitude the same way bubbles do — that's the bug we're fixing, not a feature to reintroduce.
- **Fallback, if the eyeball shows too many unlabeled slivers to be useful:** a min-area floor (guarantee every cell clears a label-legible size, accepting slight area distortion in the tail). That's a **Design-chat call** — flag it for me, don't floor silently. Ship area-honest first; we adjust if it reads wrong.

## Build spec

- **d3 treemap, `d3.treemapSquarify` tiling.** Hierarchy = the flat topic list, `.sum(d => d.count)`, laid out to the container width at **~half the bubble cluster's height** (recovers vertical space, consistent with the dashboard-density direction). No gaps between cells.
- **Same topic set as the current bubble chart** — don't add or drop topics. If the bubble chart shows all topics, the treemap shows all; if it's top-N, keep that N. Read `DashboardBubbleChart` to confirm the set and match it.
- **GOV is the dominant anchor cell** — automatic from area-proportional (highest count); just confirm it lands as the largest cell (squarified typically anchors it top-left).
- **Cell fill + label are tonal:** the cell fills with its family color from `topicColor(topic)`; the **label uses a darker shade of that same family** (`TOPIC` + count), so it reads on the fill. Check `topic-colors.ts` for shade variants — if it exposes a dark shade per family, use it; if not, darken the cell hex programmatically for the label. The label must clear a legibility contrast against the fill.
- **Click a cell → `?topic=<id>`** — preserve the current bubble-chart filter interaction (HO 56), just on cells now.
- **Match the existing rendering model.** d3-treemap is layout-only (pure functions, no DOM), so if `DashboardBubbleChart` computes its layout server-side and renders SVG/divs, compute the treemap server-side too and keep d3 off the client (the district-geo pattern). Only mount a client island if the bubble chart already is one. Don't introduce a new client dependency the old chart didn't have.
- **Remove `DashboardBubbleChart`** after the swap — grep for other importers first; if the dashboard is the only consumer, delete it (clean swap, no dead component). If anything else imports it, leave it and just repoint `page.tsx:139`.

## Verification

- Treemap renders: no gaps, strictly area-proportional, GOV the dominant cell, ~half the prior height.
- Cells labeled where they fit (`TOPIC` + count, tonal dark-shade label legible on the fill); sub-legible cells peek `TOPIC + count` on hover.
- Clicking a cell sets `?topic=<id>` and filters, same as the old chart.
- `topicColor()` reused, no new tokens.
- `tsc` clean. If styling doesn't render, it's the stale-compiled-CSS trap (HO 212): `rm -rf .next` + fresh dev, confirm the stylesheet 200s.
- The dashboard SSR is slow right now (the corpus-wide-read latency condition) — verify on the warmed cache; it renders 200, the change is presentational.

## Constraints

No new tokens (reuse `topic-colors.ts`). **Area-proportional is firm** — if legibility needs a min-area floor, flag it as a Design call, don't silently floor. Preserve the `?topic=` click. Read the live files (the `/mnt/project` copy lags). **No SKILL or backlog edits** — the SKILL sweep batches after the design-pass group (230 onward) lands.

One commit: `feat: topic distribution treemap, replaces bubble cluster (HO 231, design item 3)`

---

read docs/handoffs/231-topic-treemap.md and follow
