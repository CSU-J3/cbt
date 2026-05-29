# 153 — Reports page + dashboard snapshot (spec 6)

## What this is

Spec 6 from the design session: give the weekly reports their own surface. Two pieces — a slim full-width snapshot strip on the dashboard (filling the `.home-snapshot-slot` HO 150 reserved) and a `/reports` index page in the `Reports:\>` masthead style. The Reports nav item already shipped in HO 150.

Both wire to existing report data. The generation pipeline (HO 58/75/85/110/112) and the rendered report detail already exist — this surfaces them, it does not rebuild generation or the report content.

The snapshot deliberately does **not** re-synthesize the week. The masthead prompt already does that. The snapshot points to the written report; it's a pointer, not a second summary.

## Phase 1 — Diagnostic (HALT for sign-off)

Read real artifacts, post findings, stop.

### A. Existing reports surfaces

HO 75 was "reports-index" — so `/reports` may already exist. Read it (and the report detail route). Report:

- Does `/reports` exist? What does it render today — a list, a single latest report, something else? Its current layout and styling.
- The report detail route — `/reports/[date]`? `/reports/[id]`? What identifies a report. Confirm the path so the index and snapshot link correctly.
- Whether the current index already approximates spec 6's dated-index shape or needs the redesign to `Reports:\>` masthead + dated rows.

### B. Report data shape + lead excerpt (load-bearing)

The snapshot's middle and each index row want a "1-2 line lead excerpt" that's distinct from the full report. Report the stored report record shape (from HO 110's report-structure-data work especially). Specifically:

- Is there a separable lead / intro / summary field on the report, or is it a single body blob (markdown / structured sections)?
- If a lead/intro section exists (HO 110 structured the reports, so there may be one), use it.
- If not, the excerpt must be derived for display — first sentence or first paragraph of the body, truncated. **Don't modify the generation pipeline to add an excerpt field** (coupling says don't rebuild generation). Derive it at read time from existing content.

This is the same shape as the HO 148 summary-teaser question: confirm whether a short-form exists or whether display derives one. Recommend the approach.

### C. Report list query

Confirm the helper that lists reports newest-first (date + identifier + whatever the excerpt source is). HO 75 likely has `getReports()` or similar. Report its shape and whether it carries enough for the index rows and the snapshot (latest + the 3 previous dates). If it returns full bodies, note the cost and whether a lighter list query is warranted.

### D. Dashboard snapshot slot

Confirm `.home-snapshot-slot` exists and is empty (HO 150 reserved it below the two-column grid). Confirm filling it is a clean insert with no layout fight.

### E. Masthead style reuse

Spec 6 wants the `Reports:\>` masthead on the index. Confirm whether the dashboard masthead (the `PageName:\>` prompt from HO 150) is a reusable component or inline in `HomeHeader`. If reusable, the index uses it; if not, note that the broad per-page masthead parity is HO 154's job and the index gets a local `Reports:\>` header here that HO 154 later unifies.

### Report format

1. Existing `/reports` + detail route state.
2. Report record shape + lead-excerpt availability + derive-or-reuse recommendation (load-bearing).
3. Report list query shape + cost.
4. Snapshot slot confirmed.
5. Masthead reuse state.
6. Proposed Phase 2 scope: files, the excerpt approach, any list-query addition.

### HALT. Wait for sign-off.

## Phase 2 — Implementation (after sign-off)

### Dashboard snapshot strip

Fills `.home-snapshot-slot`. Slim, full-width:

- **Left (fixed):** `WEEKLY REPORT` label (`--text-muted` mono 10px) + the report date (`--accent-amber` mono 11px).
- **Middle (flex):** the report's lead excerpt (per Phase 1 — stored field or derived), sans `--text-secondary` 12px, 1-2 lines. Not a re-synthesis of the week.
- **Right:** `read full →` chip, `--accent-amber`, links to that report's detail page.
- **Below:** `PREVIOUS · <date> · <date> · <date> · all →` thin mono line, `--text-dim` / `--text-muted`, each date linking its report, `all →` to the index.
- Height: ~1 line + the previous-dates row. Slim.

### Reports index (`/reports`)

- Header: `Reports:\>` masthead style (per Phase 1's reuse finding).
- Dated index, newest first. Each row: date (`--accent-amber` mono ~110px) + `Weekly Report` title + `read →`, with a 1-line lead excerpt indented under the title.
- Row click / `read →` opens the existing report detail page.
- If `/reports` already exists, redesign it to this shape; don't add a parallel route.

## Out of scope

- Report generation, structure, or content. Wire to existing data only.
- The report detail / rendered-report page itself (HO 58/110/112). Linked, not touched.
- Re-summarizing the week anywhere. The masthead owns that; the snapshot points.
- Adding a lead/excerpt field to the generation pipeline. Derive at read time if none exists.
- Per-page masthead parity beyond the reports index. HO 154.
- Mobile. Deferred to the #15 pass.
- New tokens or motion.

## Acceptance

1. Phase 1 report posted; the lead-excerpt approach (stored vs derived) and the `/reports` redesign-vs-build call signed off before Phase 2.
2. Dashboard snapshot strip fills the reserved slot: WEEKLY REPORT label + date left, lead excerpt middle, `read full →` right, PREVIOUS dates row below. Slim height.
3. The snapshot excerpt is the report's lead, not a re-synthesis of the week.
4. `/reports` renders the dated index newest-first in `Reports:\>` style, each row linking the detail page, with a lead excerpt per row.
5. Snapshot and index link to the correct existing report detail route.
6. No change to report generation or content.
7. `npm run typecheck` and `npm run build` clean.
8. `SKILL.md` updated: the dashboard snapshot strip, the `/reports` index shape, and the lead-excerpt approach.
9. Single commit: `feat: reports page + dashboard snapshot (HO 153)`.

## Notes

- **The snapshot is a pointer, not a summary.** Spec 6 is explicit that it doesn't re-synthesize the week — the masthead prompt already carries the synthesized lead. The snapshot's job is "a written report exists for this week, here's its lead, read it." Duplicating the synthesis would put two summaries of the same week on one screen.
- **Lead excerpt mirrors the HO 148 teaser question.** If HO 110's structure gave reports a lead section, use it. If reports are one body, derive the first line for display rather than touching generation. Same discipline: don't add a field to the pipeline for a display concern.
- **Redesign `/reports`, don't fork it.** If HO 75 already shipped an index, this restyles it to spec 6. A second reports route is the duplication the cleanup audit would later flag.
- **The previous-dates row keeps the snapshot honest about history.** One latest report plus three prior dates plus `all →` gives the dashboard a sense of the report cadence without becoming the index itself.
