# HO 330 — Doc sweep: the Members + Committees merge (HO 328) + carryover

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 330.

Reconcile the living docs to the HO 328 merge — SKILL, roadmap, backlog, oddities, plus the stale mock. Docs-only; the one optional code touch (orphaned `getSponsorProductivity`) is grep-gated. Independent of the cold-start work (HO 329 + its eventual fix) — that docs separately when it lands.

## SKILL.md

- `/members` entry — rewrite to the merged two-pane browser. The page is now a committee rail (312px, `getCommitteesIndex`) + member list (1fr). Chamber filter drives both panes; party/state/sort/ceremonial/search drive the member list. Clicking a committee scopes the roster (`getCommitteeRoster`, chair → ranking → volume, `?committee=<systemCode>`) and the bar rescales to roster max. The per-member bar is `MemberTopicBar` (top-3 topics + OTHR, scales to the global filtered max unscoped / roster max scoped, colors from `lib/topic-colors`). Expand reuses `SponsorExpandedPanel` with `committeeCap=Infinity` (uncapped COMMITTEES). The rail marks the expanded member's committees (lighter-amber `●`, `· ● on N` in the header) via `getMemberCommittees`. An UPCOMING HEARINGS group is pinned at the rail top (`getUpcomingMeetings`, 7-day window, `◷ N THIS WEEK`) — NOT LIVE NOW (see oddities). New helpers: `getMembersTopicMix` (flat array, `json_each` fanout, cached under `bills`, served by `idx_bills_sponsor_topics`), `getCommitteeRoster`. New components: `MemberTopicBar` (server), `CommitteeRailRow` + `RosterShowAll` (client islands). Drop the `MemberProductivityScatter` (152/197) prose and the HO 196 one-bar-per-sort + green-track prose — both superseded.
- `/committees` entry — now `redirect("/members")`; the committee index lives as the `/members` rail (HO 328). The `/committee/[systemCode]` detail (HO 146) is unchanged and still linked from the rail.
- Sub-nav (`GROUP_TABS` / HO 173) — the Members group is a single Members tab now; Committees merged in.
- Schema — note `idx_bills_sponsor_topics` (covering index on `sponsor_bioguide_id, is_ceremonial, topics`, HO 328, forced via `INDEXED BY` in `getMembersTopicMix` per the 277–279 pattern).
- Client-island list + count — add `CommitteeRailRow` + `RosterShowAll`, re-grep the island count, report the new number and the delta.

## roadmap.md (STATUS block — read from repo, edit the block)

The Member depth theme and the committees work collapse into one `/members` surface. Read the current figures from the STATUS block and update them to reflect the merge (Member depth advances; committees folds into Members). Don't carry numbers from memory — edit what's in the block.

## backlog.md

- Tombstone the HO 328 doc-debt items — this sweep clears them.
- Add: `getSponsorProductivity` orphaned, scatter was its only consumer (HO 328); cleanup pending (see optional delete below).
- The member-expand cold-start 500 is under active diagnosis (HO 329) — link it, don't close.
- Carryover: the HO 157 font-table never absorbed HO 281's ≥701px desktop lifts (title→26, nav→16, lines ~1097/1106) — keep banked unless folded here (optional below).

## oddities.md

- Add: the `/members` rail shows UPCOMING HEARINGS, not LIVE NOW as the mock shows. The schema has no hearing end-time / in-progress signal and the page is daily-cached, so "in session now" can't be derived honestly; UPCOMING (real scheduled starts) is the honest surface (HO 328). A future reader comparing the LIVE NOW mock to prod should know this is intentional, not drift.
- Optional: `MemberTopicBar`'s `pageMax` is dual-scale — global filtered max on the full list, roster max when a committee is scoped. The same bar length means different things in the two states.

## Stale mock

Mark `docs/design/members-committees-live.html` stale with a one-line note at the top: LIVE NOW is superseded by UPCOMING (HO 328); the schema can't support live state. Don't rebuild the mock, just flag it.

## Optional, grep-gated (Code's call — don't expand the sweep)

- Delete `getSponsorProductivity` if a grep confirms zero consumers (scatter was the last, per HO 328 + the HO 199 audit). If anything still references it, leave it and keep the backlog entry. Same pattern as `formatLastUpdated` in 327.
- The HO 281 font-table drift: if Code is already in the HO 157 table, fix the three rows (title→26, nav→16 at ≥701px; the ~1097 prompt row + ~1106 breadcrumb bullet). Otherwise leave banked. Confirm sizes against live CSS first.

## Ship

- Docs-only, plus the optional grep-gated delete. If `getSponsorProductivity` is deleted, `tsc` + build clean proves it; otherwise run `tsc` anyway as a cheap guard.
- Named `git add` (`SKILL.md`, `roadmap.md`, `backlog.md`, `oddities.md`, the mock, and `lib/queries.ts` only if the helper's deleted).
- `git push`; `npm run verify:deploy` until served SHA === HEAD (confirms the commit landed; docs don't change runtime, but a helper delete shifts the bundle).
- Commit: `docs: reconcile SKILL/roadmap/backlog/oddities for the HO 328 merge`.
