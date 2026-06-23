# HO 327 — Chrome-arc SKILL sweep round 2 (tape section, font table, dead export)

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 327.

Closes the three items HO 326 flagged for a separate pass. Two are SKILL.md prose, one is a dead-export delete. Line numbers below are approximate — HO 326 edited the file, so locate each section by content, not line.

## 1 — Markets-tape SKILL section (~1142–1144)

It still describes the bare tape on inner pages. That's wrong since HO 323: the tape is dashboard-only, in the B2 band. Rewrite to that truth and drop the ⚠ stamp.

The load-bearing correction is placement: the tape lives only in the dashboard's B2 band (the MARKETS equities/commodities row + the ODDS prediction-market row), not "app-wide" or "on every inner page." Any HO 202/234 app-wide framing is superseded by 323.

For the tape's *behavior* — symbols, odds, motion, hover, the fed-cut separator — describe what the live component actually does. You have the code; the frozen SKILL prose (HO 251/287/289/290/291/292/293/294/302/303) doesn't, and it's dense enough that re-narrating each sub-handoff isn't the goal. Grep the tape component, state current behavior, keep it tight.

## 2 — HO 157 font-size table (~1100–1102)

It cites header elements that no longer exist and one stale size. Confirm the live sizes against the CSS before writing (the values below came from the 325/326 reports — verify, don't trust).

- Remove the inline-sync row and the count-line row. Both elements are gone post-323.
- The inner nav row is `PrimaryNav variant="home"` at 14px now, not `.header-nav` 13px. Update it.
- Add the LAST SYNC subhead (`.header-sync-sub`, 11px, HO 325) if the table tracks header type sizes.

## 3 — Dead `formatLastUpdated` export (`lib/format.ts`)

HO 326 removed its last consumer. Grep-confirm zero consumers repo-wide, then delete the function and its export. `tsc` confirms nothing else references it. This is the only code change in this handoff.

## Constraints

- Factual only; preserve SKILL voice and structure.
- GUARD (carried from 326): don't touch the live LAST SYNC mechanism — `getCorpusStats(true)`, `.header-sync-sub`, the `CyclingTimestamp` mount, `.header-nav-row`. This sweep edits prose and deletes one dead export, nothing else.
- Don't re-edit the cycling-stamp-count lines (~1084/1209/1210) that 325/326 already fixed. Keep the tape/font rewrites consistent with them.
- `backlog.md`: tombstone the tape-prose and font-table flags 326 added, plus the `formatLastUpdated` line. DONE entries per the usual cadence.
- `roadmap.md` / `oddities.md`: confirm no change needed; report if a reference turns up.

## Ship

- Split is natural: `docs:` commit for the SKILL + backlog edits, `chore:` commit for the `lib/format.ts` delete. One commit is fine too — your call.
- `tsc` passes; build clean.
- `git push`; `npm run verify:deploy` until served SHA === HEAD. No runtime change expected (prose + a tree-shaken dead export) — the deploy just confirms the commit landed. A quick header eyeball is enough; nothing functional moved.
