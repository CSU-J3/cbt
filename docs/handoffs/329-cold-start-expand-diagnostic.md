\# HO 329 — Diagnose the member-expand cold-start 500



Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 329.



The `?expanded=<bioguide>` path fires 5 queries server-side — getSponsorStats, getSponsorTopTopics, getSponsorRecentBills, getMemberCommittees, getMemberAffiliations. On a cold cache it can trip the 10s DB-abort (HO 238) → 500; warm is fine. Third cold-start 500 this arc (/bills, the merge expand). Probe the cause and HALT with findings — the fix differs by what's eating the budget, so don't fix blind.



Diagnosis only. Don't change the abort timeout (HO 238 is intentional — the fix is making queries fit, never raising it). VACUUM/ANALYZE are blocked on hosted Turso, don't propose them.



\## Probe (one-off script under scripts/diagnostic/)



Against the prod Turso (the real remote round-trip latency), cold — bypass the unstable\_cache layer by calling the inner query helpers directly, or a fresh process so nothing's warm:



1\. Per-query cold latency. Time each of the 5 expansion queries individually for a heavy bioguide (e.g. the Rick Scott / 154-bill case). Report each query's cold ms, sorted. Find which one(s) dominate.



2\. Await structure. Read the expansion fetch path (SponsorExpandedPanel's server fetch in app/members/page.tsx or the panel). Report whether the 5 are awaited sequentially or already in a Promise.all. Sequential stacking of 5 cold remote round-trips is the prime suspect: 5 × cold vs max(cold).



3\. EXPLAIN QUERY PLAN on the slowest one or two. Report whether it's a full scan on a fat table (the misplan class, like 277 / the /bills sighting) or already index-served. If a scan, name the table + the covering index that would serve it.



4\. Confirm the 500 is the 10s abort firing (the AbortSignal.timeout in lib/db.ts), not another error. Note that prod adds serverless function init on top of the bare query time, so the real budget is tighter than the numbers the probe shows.



\## HALT — report:

\- The 5 cold latencies, sorted.

\- Sequential vs parallel.

\- The EXPLAIN verdict on the slow one(s), plus the covering index if it's a misplan.

\- Recommended fix and expected cold wall-time: Promise.all if sequential; covering index + INDEXED BY if a single query misplans; both if both. Rough before/after.



Don't implement. I want the cause visible before we pick the fix.



\## FINDINGS (probe: scripts/diagnostic/member-expand-329.ts, prod Turso, heaviest sponsor = Rick Scott S001217, 159 bills)



\### 1. Per-query latency, sorted (WARM — server page cache was hot; see the cold caveat)

\- getSponsorRecentBills — 208ms

\- getSponsorTopTopics — 192ms

\- getSponsorStats — 188ms

\- getMemberCommittees — 39ms

\- getMemberAffiliations — 32ms



The three sponsor queries dominate; committees + affiliations are index-served point-lookups and are not the problem. **These are warm numbers and badly understate cold** — they share the EXACT plan HO 277/279 measured swinging 112ms↔18s+ across hits (getFeedStats: 12.1s cold → 38ms). A warm 200ms here is consistent with multi-second-to-abort cold spikes.



\### 2. Sequential vs parallel — ALREADY PARALLEL

The 5 are already in a `Promise.all` at app/members/page.tsx:173-180. **The handoff's prime suspect (sequential 5× cold stacking) is wrong — it was already fixed.** Wall-time is max(cold), not sum. Promise.all measured 245ms vs 659ms sum-of-t1. So Promise.all is NOT the fix.



\### 3. EXPLAIN verdict — the HO 277/279 misplan class

All three sponsor queries plan as `MULTI-INDEX OR` over **idx_bills_is_ceremonial** (twice — for `is_ceremonial=0 OR IS NULL`), i.e. they walk ~every non-ceremonial row of the **16,538-row fat bills table**, then filter by sponsor. The `OR sponsor_name = ?` branch is **unindexed** (there is NO index on sponsor_name — only idx_bills_sponsor_bioguide / idx_bills_sponsor_agg / idx_bills_sponsor_topics on the bioguide column), so the planner can't point-lookup the sponsor and falls back to the ceremonial-index walk. Same statless-planner trap as HO 277 (/members getFeedStats), 278, 279.



**Critically: the `OR sponsor_name = ?` branch is DEAD on this path.** The only callers are app/members/page.tsx:175-177 and `key` is always `expandedMember.bioguide_id` (page.tsx:172) — a bioguide string can never equal a `sponsor_name` string, so the branch matches nothing AND destroys the plan.



\### 4. The 500 is the 10s abort

DB_REQUEST_TIMEOUT_MS = 10_000 in lib/db.ts (HO 238). A cold MULTI-INDEX-OR walk of the 16.5k-row fat table that exceeds 10s aborts → propagates → Next 500. No other error class involved. Prod adds serverless init on top, so the real budget is tighter than the warm probe shows.



\## RECOMMENDED FIX

Drop the `OR sponsor_name = ?` branch in getSponsorStats / getSponsorTopTopics / getSponsorRecentBills (bioguide-only, provably safe — single caller, always a bioguide) and add the matching `INDEXED BY` hint (mandatory — index alone never wins the statless planner, HO 277/279 rule). Measured before/after, even WARM:

\- getSponsorStats: 188ms → **31ms** (`COVERING INDEX idx_bills_sponsor_agg`)

\- getSponsorTopTopics: 192ms → **60ms** (`COVERING INDEX idx_bills_sponsor_topics`)

\- getSponsorRecentBills: 208ms → **29ms** (`INDEX idx_bills_sponsor_agg` + temp-b-tree for the ORDER BY)



Cold: each flips from a multi-second-to-abort full ceremonial walk to a ~159-row point lookup — i.e. from 500-risk to tens of ms. No new index needed (all three covering indexes already exist from HO 277). No Promise.all change. Committees + affiliations untouched.



**Caveat to confirm at fix time:** the bioguide-only forms hinted onto idx_bills_sponsor_agg / idx_bills_sponsor_topics need the WHERE to keep constraining sponsor_bioguide_id (+ topics IS NOT NULL for the topics hint) or SQLite throws "no query solution" — same INDEXED BY discipline as the existing forced-index helpers.



\## Constraints

\- Diagnosis only, no fix this handoff.

\- Don't touch the 10s abort (HO 238).

\- Keep the probe under scripts/diagnostic/ (named-diagnostic convention) — it re-probes a path that's bitten three times.

