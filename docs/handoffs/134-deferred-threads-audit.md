# 134 — Deferred-threads audit + backlog triage

## What this is

Housekeeping pass. The roadmap has been moving fast through the 100s and a lot of "we'll do this later" decisions are now buried in handoff Out-of-scope sections, code TODOs, and verbal deferrals from chat. Goal of this handoff: surface every open thread that's been deferred, triage each one (ship, kill, formal-park in `docs/backlog.md`, or leave as-is), and land the result so the project state matches what we actually intend to do.

No new features. No code changes that aren't doc updates or trivial cleanups.

Two phases. Phase 1 is read-only audit. HALT for triage. Phase 2 applies decisions.

## Pre-flight

Confirm `docs/backlog.md` exists. HO 42 seeded it. If it's missing, flag in Phase 1 and propose recreation as part of Phase 2.

## Phase 1 — Audit (read-only, report in chat)

### Sources to scan

1. **`docs/backlog.md`** — current contents verbatim. Each bullet is an existing open thread by definition.

2. **Handoff Out-of-scope sections, HOs 100–133.** Grep `docs/handoffs/` for items explicitly named as deferred:
   - `## Out of scope`
   - `still parked`
   - `parked at partial`
   - `still open`
   - `future handoff`
   - `separate cleanup`
   - `TODO` (in handoff bodies, not code)

   Don't grep older handoffs (1–99) — most of that is shipped or stale. The recent stretch is where the live deferrals live.

3. **Code TODOs.** Grep the repo (excluding `node_modules`, `.next`, `docs/`) for `TODO`, `FIXME`, `XXX`. Filter to items that look like deferred features or known incomplete work, not noise.

4. **From this chat session, two additions Code won't find on its own:**
   - **Breaking news ticker.** Scrolling marquee on the dashboard pulling from existing `news_mentions`. Data layer is already built (HOs 64/75/86/102/103/104/111). Open gap per memory: "breaking-news UI block is the remaining gap in news signal theme."
   - **Member stock-trades ticker / pipeline.** Discussed 2026-05-27. Quiver Quantitative API is the obvious source ($300/yr Hobbyist). Parked until CBT has any revenue story. HO 70's failed FMP attempt left schema work behind that could be reused. Free-data alternative is direct STOCK Act PTR scraping from House Clerk + Senate eFD — viable but multi-handoff project for a non-blocking feature.

### Report format (in chat, no commits)

For each thread found, one line in this shape:

```
[SOURCE] <one-line description> — <current status>
```

Where `SOURCE` is one of: `BACKLOG`, `HO-NNN`, `CODE-TODO`, `CHAT-2026-05-27`.

Group by source. Don't try to dedupe across sources in Phase 1 — same thread mentioned in two places is itself useful signal.

After the grouped list, a short recommendation column. For each item, one of:

- **SHIP** — small enough to handoff now, or already implicitly ready
- **KILL** — superseded, no longer relevant, or always was a bad idea
- **PARK** — belongs in `docs/backlog.md` if not already there; not actionable yet
- **LEAVE** — already correctly captured where it is; no change needed

Recommendation is just Code's read. Final call is in chat after HALT.

### HALT

Wait for triage decisions in chat before Phase 2. Expect a numbered list back from Corey with disposition per item.

## Phase 2 — Apply triage (after sign-off)

Shape depends on Phase 1, but likely components:

### `docs/backlog.md` updates

- Append items marked PARK that aren't already in the file. Match existing format: bold lead, one or two sentences of context, nothing more.
- Remove items from backlog that got marked SHIP or KILL.
- Don't restructure the file — no sections, no priority ordering, no dates. HO 42's "dumb on purpose" rule still holds.

### Code TODO cleanup

- For items marked KILL in code: remove the TODO comment entirely.
- For items marked PARK in code: leave the TODO in place, but add a one-line pointer to `docs/backlog.md` if the comment is sparse enough to benefit.
- For items marked SHIP: leave the TODO until the actual handoff lands.

### New handoff stubs (only if Phase 1 reveals genuine SHIP candidates)

For each SHIP item, write a numbered handoff stub. Don't try to fully scope these inline — just a skeleton with the title, one-paragraph framing, and a placeholder for in-scope/out-of-scope. The full scoping conversation happens in chat afterward. Numbering continues from 135.

### Two specific entries to add to `docs/backlog.md`

Unless Phase 1 finds them already there, add:

```markdown
- **Breaking news ticker.** Scrolling marquee on the dashboard surfacing recent `news_mentions`. Data layer shipped through HOs 64/75/86/102/103/104/111; this is the open UI block in the news signal theme. Component lives in the design chat once scoped.
- **Member stock-trades pipeline + ticker.** Surfaces member PTR disclosures and ties them to bill/committee context. Quiver Quantitative is the obvious paid source ($300/yr Hobbyist tier). Free alternative is direct STOCK Act PTR scraping from House Clerk + Senate eFD. Parked until CBT has a revenue story; HO 70 left schema work behind that's reusable when the pipeline gets built.
```

Phrasing can adjust based on Phase 1 findings — if these are already partially captured elsewhere, merge rather than duplicate.

## Out of scope

- Scoping any of the SHIP items into full handoffs. Phase 2 writes stubs only.
- Touching `docs/roadmap.md`. The roadmap is theme-level; backlog is item-level. Different docs, different rules.
- Cleaning up shipped-but-stale comments in old handoff files. Historical artifacts stay as-is.
- Cross-project items (CCBT, Sovereign-Connections). Per the recent CCBT roadmap cleanup (HO 68), CCBT is a sibling project and not tracked here.

## Validation

1. Phase 1 audit posted in chat as a grouped list with recommendations.
2. After triage sign-off, `docs/backlog.md` reflects the new state — additions for items marked PARK, removals for items marked SHIP or KILL.
3. Code TODOs cleaned per triage.
4. Any handoff stubs created for SHIP items, numbered 135+.
5. Single commit: `chore: deferred-threads audit + backlog triage (HO 134)`.
6. Working tree clean, push.

## Notes

- This is a one-time pass, not a recurring process. If the project keeps generating deferred threads at the rate of the last month, that's a signal to do this every 20–30 handoffs, but don't try to institutionalize it now.
- Phase 1 may surface more items than expected. That's fine — the value of the audit is precisely in seeing what accumulated. Triage is fast once the list exists.
- If `docs/backlog.md` is missing (deleted, never created), Phase 1 flags it and Phase 2 recreates from HO 42's seed plus everything from this audit.
- Don't worry about handoffs 132 being missing from the numbered sequence. Gaps are fine; they happen when a handoff gets scoped and abandoned before commit.
