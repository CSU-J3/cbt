# HO 324 — Expanded panel HEARING slot → rich + always-on

Confirm the next free number before saving: `ls docs/handoffs/ | sort -V | tail`. Body assumes 324.

The rich HEARING slot deferred from 317. The design chat resolved both open questions: selection = **soonest upcoming**, and it follows the **always-on empty-state** pattern like NEWS/ODDS. This upgrades the minimal block (date + committee, omit-when-empty) that's live today in the shared `BillExpandPanel`.

**One component, both surfaces.** HO 317 made the expand the shared `BillExpandPanel`, imported by `V2FeedList` (dashboard `/`) and `BillRowList` (`/bills`). Build the slot once in `BillExpandPanel`; both surfaces inherit it. (The `/dashboard-classic` compact variant has no meta/news column and is out of scope — unlinked legacy.)

## Verify first

The data mostly exists — `getMeetingsForBill(billId)` returns the full `CommitteeMeeting[]` (`eventId, chamber, meetingDate, meetingType, meetingStatus, title, building, room, videoUrl, committeeSystemCode, bills: FeedBill[]`). The questions are whether it reaches the component intact and how a couple of fields resolve:

- **Projection.** The current block renders only date + committee, but `getMeetingsForBill` returns everything. Confirm whether the lazy-load path (`/api/bill/[id]/panel`, which SKILL still lists as returning `{ committees, news }` — likely stale post-317) passes the **full** meeting shape or a **slimmed** projection. If slimmed, widen it to carry `meetingType, meetingStatus, building, room, videoUrl, committeeSystemCode`, and the meeting's `bills`. If it's already full, this is a pure render change.
- **Committee name.** `getMeetingsForBill` returns `committeeSystemCode`, not the name; the slot needs the name as the link text. Confirm the name is available (it may need a `committees` join or a code→name lookup). Resolve it, don't show the bare code.
- **LIVE detection.** Confirm what `meetingStatus` contains. If it carries a LIVE value, map it → green pip. If there's no LIVE signal (only Scheduled-type statuses), derive LIVE from the meeting being in-progress, or **default everything to Scheduled (dim pip)** until a real LIVE signal exists — don't fake it.
- **Time + ET.** Confirm the start time (in `meetingDate` or a separate field) and reuse the hearings calendar's existing ET time-rendering rather than rolling a new formatter.

## Build

Ship the label + empty state **unconditionally first** — they need no data — then the populated branch behind the join.

- **Always-on.** Render the `HEARING` label + (when no upcoming hearing) the empty line `NO RELATED HEARINGS` (mono, `--text-dim`, the same style as `NO RELATED NEWS` / `NO PREDICTIONS MADE`). **Change the current omit-when-empty to always-render.**
- **Selection.** Soonest **upcoming** meeting (`meetingDate >= now`) from `getMeetingsForBill`. More than one → soonest upcoming. None upcoming → the empty state. (A bill whose only hearings are past shows `NO RELATED HEARINGS` — consistent with the Scheduled/LIVE pip having no "completed" state. Flag this in the report so it's visible; if past hearings should surface, that's a follow-up.)
- **Placement.** Directly under the summary, leading the related block: HEARING → RELATED NEWS → ODDS. That's already the 317 order — keep it.
- **Populated content** — three lines, label `HEARING` in the mono-dim uppercase style matching `RELATED NEWS`:
  - **Line 1:** `[pip]` committee **name** (amber link → `/committee/[committeeSystemCode]`) + `↗`. Pip = 6px dot, `--text-dim` when Scheduled, `--stage-enacted` (green) when LIVE.
  - **Line 2:** mono, `--text-dim`, middot-joined: `TYPE · STATUS · DATE · TIME ET · ROOM` (ROOM = `building` + `room`, e.g. `2175 Rayburn HOB`). Example: `MARKUP · SCHEDULED · THU JUN 25 · 10:00a ET · 2175 Rayburn HOB`.
  - **Line 3:** mono, `--text-dim`, amber links: `WATCH <livestream ↗> · AGENDA <HR 9337> · <HR 8801>`. WATCH omitted when `videoUrl` is null. AGENDA = the meeting's other bills (`bills` minus the current bill), each an amber link → `/bill/[id]`.

## Constraints

- Build once in `BillExpandPanel`; purely additive to the left column. Summary, RELATED NEWS, ODDS, the meta box, stage bar, and expand behavior are unchanged.
- Reuse the NEWS/ODDS empty-state style and the existing amber-link + ET time-render idioms; don't roll new ones.
- No new CSS variables.
- Named `git add`, eyeball the diff. Stale `.next`: stylesheet loads (no 404 on `layout.css`), `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship: `git push`, then `npm run verify:deploy` until served SHA === HEAD.

## Ship report

- HEARING always renders: name a bill with an upcoming hearing showing the full three lines, and a bill with none showing `NO RELATED HEARINGS`.
- Where the meeting data came from, and whether you widened a slimmed projection or it was already full.
- Committee name: shown as the link text, and how you resolved it if it needed a join.
- LIVE detection: how it's determined; if you defaulted everything to Scheduled, say so.
- AGENDA links to the other bills with the current bill excluded; WATCH omitted when no stream.
- Confirm past-only bills show the empty state (or flag if you handled them differently).
- Build clean; verify:deploy SHA matches.
