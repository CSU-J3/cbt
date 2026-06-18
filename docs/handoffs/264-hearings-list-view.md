# 264 — Hearings page, list view (Piece 1 of 5)

The standalone `/hearings` list surface plus the HEARINGS nav entry. This establishes the meeting-row and click-to-expand vocabulary that Pieces 2–4 (265–267) reuse, so it ships first; 2/3/4 are parallel once it lands.

## Source of truth

The approved spec block below (from the Design chat) plus the live HO 263 helpers are the source of truth. The attached `hearings-full-page.html` is visual reference only — read the rendering, not its data or code; all mock values are fabricated. Don't lift mock markup; don't treat any mock value as a requirement. Established chrome, nav rubric, tokens, and IA rule; no new tokens.

## Helpers it consumes (HO 263, live)

- `getUpcomingMeetings()` → THIS WEEK / NEXT WEEK bands (returned 30 on prod).
- `getRecentMeetings(days)` → RECENTLY HELD band (returned 18 at days=7).
- `CommitteeMeeting`: `eventId, chamber, meetingDate, meetingType, meetingStatus, title, building, room, videoUrl, committeeSystemCode, bills[]`.

Bands derive from `meetingDate` vs now; group server- or client-side, empty bands omitted.

## Phase 1 diagnostic — run against the live helpers, report before building

Don't build past an unconfirmed data assumption. Report findings, then build.

1. **`meetingType` → badge map.** Query the distinct `meetingType` values across both chambers, with counts. Confirm every value maps to one of HEARING / MARKUP / BUSINESS with nothing falling through unbadged. Proposed map to confirm (raw set from the HO 261 probe): `Hearing` / `Open Hearing` → HEARING; `Markup` / `Open Markup Session` → MARKUP; `Meeting` / `Open Business Meeting` / `Closed Business Meeting` → BUSINESS. Report the distinct set, counts, and anything unmapped.
2. **Watch-state rule (LIVE / WATCH / STREAM / blank).** Enumerate distinct `meetingStatus` values with counts. Determine whether status distinguishes live/past/scheduled, or whether the rule must lean on `meetingDate` vs now plus `videoUrl`. Propose the concrete derivation — e.g. blank if `videoUrl` null; `STREAM ↗` if `meetingDate` is future; `● LIVE` if now ∈ [meetingDate, meetingDate + Nh] and `videoUrl` present (N to confirm); `▶ WATCH` otherwise (past with recording). State whether a URL spot-check is feasible to avoid a false LIVE on a dead scheduled link. **This rule is reused by Piece 3's LIVE NOW callout — settle it here.**
3. **bill-chip cap sanity.** Cap is 3 + `·N more` (approved). Confirm the per-meeting bill-count distribution (how many exceed 3, the max) so the collapsed cap and the expanded uncapped list both hold. (Prod: 2020 links / 2447 meetings, markups dense — expect some 10+.)

## Approved design spec (source of truth)

```
## Approved design — /hearings (list view)

Layout: New standalone /hearings surface. Masthead + nav, filter bar, grouped
chronological list of committee meetings. List leads; calendar is Piece 2.

Blocks (top to bottom):
- Masthead: `Hearings:\>` mono prompt (~25px, --text-primary + --accent-amber
  glyph), blinking amber cursor glued to `>` (sanctioned motion exception,
  matches Bills). Subhead, mono 11px --text-dim: `· N MEETINGS · HOUSE n /
  SENATE n · 119TH CONGRESS` from the helper counts.
- Nav: consolidated rubric, HEARINGS added to the middle group between BILLS
  and MEMBERS (\BILLS \HEARINGS \MEMBERS \RACES \PATTERNS). HEARINGS active.
- Filter bar (mono, bracket-active, bracket space reserved): TYPE [ALL]
  HEARINGS MARKUPS BUSINESS · CHAMBER [ALL] HOUSE SENATE. Right-aligned result
  count `N MEETINGS`. Defaults: TYPE=ALL, CHAMBER=ALL.
- Grouped list: bands THIS WEEK / NEXT WEEK / RECENTLY HELD (derived from
  meetingDate vs now). Date subheaders per day (`WED JUN 17 · TODAY`, count
  right). Empty days/bands omitted.
- Meeting row (collapsed) grid: caret | time | type | title+meta | bills | watch
  · time: mono local (`9:30a`)
  · type: normalized HEARING/MARKUP/BUSINESS (map raw meetingType). MARKUP
    tinted --accent-amber; HEARING/BUSINESS --text-dim.
  · title: sans --text-primary, ellipsis (un-truncates on open)
  · meta (mono --text-dim): CHAMBER · committee · building+room. Zero-bill
    rows carry no chip cluster, read clean.
  · bills: ids in --accent-amber, cap 3 + `·N more`
  · watch (derive from meetingStatus + meetingDate vs now + videoUrl):
    ● LIVE (--stage-enacted) / ▶ WATCH (--accent-amber-bright, recording) /
    STREAM ↗ (--text-muted, scheduled-future) / blank (null videoUrl)
- Expanded row (click to toggle, app expand convention):
  · WATCH — full video link + state copy
  · BILLS COVERED · N — uncapped; each: id · title · sponsor (party-colored
    (R-ST)) · stage chip (stage tokens); id/title link to bill hub
  · COMMITTEE — links to committee detail via committeeSystemCode
  · DETAILS — raw meetingType · meetingStatus · full building+room · date+time

Interactions: row click toggles expand (caret ▸/▾, title un-truncates).
Filters hide non-matching rows, collapse empty day/band groups, empty-state
message on no match. Filter state in URL (?type=, ?chamber=). Watch opens external.

Constraints: desktop-first; static (cursor blink only motion); existing tokens
only; IA index surface; grid minmax(0,1fr) so titles ellipsis, no overflow.

Open questions (build diagnostics): meetingType→badge normalization map; LIVE
detection rule (status + time window + URL spot-check); bill-chip cap = 3.

Depends on: HO 263 data layer.
```

## Acceptance

1. Phase 1 diagnostic findings posted in chat (type map, watch-state rule, bill-count distribution). Build only after.
2. `/hearings` renders the grouped list (THIS WEEK / NEXT WEEK / RECENTLY HELD) from the live helpers — row grid, badges, bill chips (cap 3), watch states per the spec.
3. Row click toggles expand (caret, title un-truncates); expanded row shows WATCH, BILLS COVERED (uncapped, linked to bill hub), COMMITTEE (linked via `committeeSystemCode`), DETAILS.
4. TYPE and CHAMBER filters hide non-matching rows, collapse empty groups, empty-state on no match; state in the URL (`?type=`, `?chamber=`).
5. HEARINGS in the nav, active on `/hearings`, established chrome and tokens, no new tokens.
6. Ship per HO 252: push, then `npm run verify:deploy` until the deployed SHA matches HEAD.
7. Single commit: `feat: hearings list view (HO 264)`.
