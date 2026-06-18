# 268 — Weekly report committee-activity section (Piece 5 of 5)

A COMMITTEE ACTIVITY section in the generated weekly report, between ENACTED and STAGE MOVEMENTS, leading with the markups that moved bills. This is a generation-order and prompt-narration change (the report is generated `content_md` via `assembleMarkdown` + the Gemini prompt), not just a page edit. Hand it over last — it's double-gated.

## Source of truth

The approved spec block below plus the live HO 263 helpers are the source of truth. `weekly-report-hearings.html` is visual reference only — read the rendering, not its data or code; all mock values (bills, moves, counts) are fabricated. Established chrome, tokens, IA, and project voice; no new tokens.

## HARD GATES — clear both before scoping the build

**Gate A — the markup→stage-change join.** The strong version (the `VIA <COMMITTEE> MARKUP` firehose annotations and the `COMMITTEE → FLOOR` moves in the markup blocks) needs to attribute a stage transition to a specific markup. Probe feasibility against live data: confirm the stage-change table exists and its shape (bill id, from/to stage, date), then test joining a markup meeting's bills (`meeting_bills` where the meeting type is a markup) to that week's stage-change events. Report whether it produces sane attributions on a real recent markup whose bills moved committee→floor the same week. If the join holds → build the strong version. If it's absent or unreliable → **fall back**: markup blocks show bills at their current stage, and the firehose `VIA` annotations drop. Don't build the strong version past an unconfirmed join.

**Gate B — report assembly not mid-change.** This edits the report generation pipeline. Confirm `assembleMarkdown` and the report prompt are **not** being actively restructured by the in-flight report work (placement / perf / enactments-top). If assembly is mid-change, HALT and report — scoping a generation-order change against a moving pipeline will collide.

## Depends on

Report assembly (an active area — Gate B) and the meeting↔stage-change join (Gate A).

## Phase 1 diagnostic — beyond the gates, run and report before building

1. **Section placement.** Confirm where COMMITTEE ACTIVITY sits in the current generated order, and that inserting it between ENACTED and STAGE MOVEMENTS is clean given the live assembly.
2. **Reports index stat strip — decide.** Flag whether to add MARKUPS (or MTGS) to the index stat strip (currently `LAWS · INTRO · MOVES`). Optional, separate change — recommend including MARKUPS for parity with the new section, but confirm before touching the index.

## Approved design spec (source of truth)

```
## Approved design — weekly report COMMITTEE ACTIVITY section

Layout: New section in the generated weekly report detail, placed between
ENACTED (top) and STAGE MOVEMENTS (firehose).

Blocks:
- Header: `COMMITTEE ACTIVITY · N MEETINGS`.
- Prose line (generated, project voice): meetings held, markups that reported
  bills, the standout markup.
- Count strip (mono): `n HEARINGS · m MARKUPS · b BUSINESS · x COMMITTEES`.
- Markup blocks (lead the section, the bill-movers): each = header (committee ·
  MARKUP · date · ▶ recording) + bill rows (id · title · stage move
  `COMMITTEE → FLOOR` in stage colors), cap + `+N more reported to the floor`.
- Firehose tie-in: stage-movement rows originating from a markup annotated
  `VIA <COMMITTEE> MARKUP` (strong version).

Interactions: bill id/title → bill hub; committee → committee detail; recording
external. Firehose stays collapsible.

Constraints: report is generated content_md (assembleMarkdown + prompt), so this
is a generation-order + prompt-narration change, not only a page edit; existing
tokens; static; project voice.

Open questions (build diagnostics):
- THE JOIN: attributing a stage transition to a specific markup (meeting.bills →
  that week's stage_change events). Strong version (VIA tags + COMMITTEE → FLOOR
  moves) needs it. Fallback: markup blocks show bills at current stage, firehose
  annotations drop.
- Confirm section placement in the generated order (above stage movements).
- Optional separate change: add MARKUPS (or MTGS) to the reports index stat
  strip (currently LAWS · INTRO · MOVES) — flag whether to include.
- Overlaps active report build (placement/perf/enactments-top). Confirm assembly
  isn't mid-change before scoping.

Depends on: report assembly (active area) + the meeting↔stage-change join.
```

## Acceptance

1. Both gates cleared in chat: the join probe result (strong vs fallback) and confirmation that report assembly is stable. (If either fails, HALT report instead of building.)
2. Phase 1 findings posted (placement in the generated order; the index-strip decision). Build only after.
3. COMMITTEE ACTIVITY section is generated between ENACTED and STAGE MOVEMENTS — header `· N MEETINGS`, the project-voice prose line, the count strip.
4. Markup blocks lead the section (committee · MARKUP · date · ▶ recording + bill rows with stage moves), capped with `+N more reported to the floor`; bill links to bill hub, committee to committee detail, recording external.
5. Firehose tie-in: if the join held, markup-origin rows carry `VIA <COMMITTEE> MARKUP` and the firehose stays collapsible; if fallback, the annotations are absent and markup blocks show current stage.
6. Index stat strip updated per the locked decision (or left as-is).
7. Existing tokens, project voice, no new tokens.
8. Ship per HO 252: push, then `npm run verify:deploy` until the deployed SHA matches HEAD.
9. Single commit: `feat: weekly report committee activity (HO 268)`.
