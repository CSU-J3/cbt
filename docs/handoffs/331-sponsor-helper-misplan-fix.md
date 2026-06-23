\# HO 331 — Fix the member-expand cold-start 500 (sponsor-helper misplan)



Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 331.



HO 329 found it: the member-expand `?expanded=` path fires 5 queries (already in a `Promise.all`, app/members/page.tsx:173-180 — parallelism was never the problem). Three of them — `getSponsorStats`, `getSponsorTopTopics`, `getSponsorRecentBills` — carry a `(sponsor\_bioguide\_id = ? OR sponsor\_name = ?)` clause. The `sponsor\_name` branch is unindexed, so the planner can't point-lookup the sponsor and falls to a MULTI-INDEX OR over `idx\_bills\_is\_ceremonial` — a walk of \~every non-ceremonial row of the 16,538-row `bills` table. Warm that's \~200ms; cold it's the HO 277 plan that swung 112ms↔18s+, and a cold walk past the 10s abort (`DB\_REQUEST\_TIMEOUT\_MS`, lib/db.ts) → 500. The `OR sponsor\_name` branch is provably dead here: callers pass `key = bioguide\_id`, and a bioguide string never equals a `sponsor\_name`, so it matches nothing while wrecking the plan. Fourth sighting of this misplan class this session.



The fix is small: drop the dead `OR sponsor\_name = ?` branch in the three helpers, go bioguide-only, and `INDEXED BY` the covering indexes that already exist (HO 277 — no new index). HO 329's measured warm before/after:

\- getSponsorStats 188 → 31ms (`idx\_bills\_sponsor\_agg`)

\- getSponsorTopTopics 192 → 60ms (`idx\_bills\_sponsor\_topics`)

\- getSponsorRecentBills 208 → 29ms (`idx\_bills\_sponsor\_agg`)



Don't touch the 10s abort (HO 238 is intentional — fit the query, never raise it).



\## Confirm before editing — the branch is shared



The three helpers aren't expand-only. Grep every caller of `getSponsorStats`, `getSponsorTopTopics`, `getSponsorRecentBills` (the bar query, member hub, dashboard sponsor surfaces, anywhere). Confirm no live caller passes a `sponsor\_name` and depends on the OR branch resolving by name. The expand path provably passes bioguide; verify it holds for ALL callers. If any caller relies on the name branch, HALT and report — don't silently remove it.



\## The change



In each of the three helpers: remove the `OR sponsor\_name = ?` (and its bound param) so the WHERE is `sponsor\_bioguide\_id = ?` only, and add `INDEXED BY` the covering index the EXPLAIN names (`idx\_bills\_sponsor\_agg` for stats + recent-bills, `idx\_bills\_sponsor\_topics` for top-topics) — forced because the stateless Turso planner won't pick it (the 277–279 pattern). No new index, no migration.



\## Verify cold, not just warm



The whole bug is the cold/warm gap — warm understates the win. The plan is what changed, so prove the plan:

\- `EXPLAIN QUERY PLAN` on all three post-fix: point lookup on the covering index, NO MULTI-INDEX OR over `idx\_bills\_is\_ceremonial`.

\- A cold prod hit on a fully evicted cache (force one if you can) is the real proof — the path that was aborting should now return in tens of ms.

\- The 5-query `Promise.all` stays as-is; it was never the issue.



\## Docs (the one line shared with HO 330 — lands here, not there)



The sponsor-aggregation helpers are now bioguide-only and `INDEXED BY` the covering indexes; the `sponsor\_name` fallback is retired. Note this in SKILL.md (the sponsor-helper entries) + an oddities line, so the next person doesn't reintroduce an unindexed `OR sponsor\_name` branch and walk the fat table again. HO 330 is told to leave this note to this handoff.



\## Ship



\- Named `git add`; `tsc` + build clean.

\- `git push`; `npm run verify:deploy` until served SHA === HEAD.

\- Confirm cold member-expand on prod no longer 500s (the EXPLAIN flip + a cold hit).

\- Keep `scripts/diagnostic/member-expand-329.ts` — it re-probes this exact path; it's earned its place after four sightings.

