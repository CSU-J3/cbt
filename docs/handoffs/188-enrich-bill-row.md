# HO 188 — Enrich the expanded bill row (links, related news, cosponsors, related bills, timeline)

## Why

The expanded bill row (click a bill in the `/bills` feed → the detail panel with summary + SPONSOR/STAGE/INTRODUCED/LAST ACTION/COMMITTEE + the FULL BILL PAGE / CONGRESS.GOV buttons) is mostly static text. Enrich it with connective links and more context:

1. **Sponsor → member page link** (`/members/[bioguideId]`)
2. **Committee → committee page link** (`/committee/[systemCode]`)
3. **Related news** — matched articles for this bill (the news-signal pipeline), with source + link
4. **Cosponsors** — count + access
5. **Related / similar bills** — from the similarity pipeline (HO 51/52)
6. **Stage timeline / history** — the bill's progression

This is **content enrichment**, not a layout redesign. The *arrangement* of an enriched row is a separate design-chat question — this handoff is about getting the data INTO the row. Build it with sensible inline placement; a later design pass can rearrange.

## Important framing

The six items span "data already on hand, just wire a link" (sponsor, committee) to "needs a query that may not exist yet" (news, cosponsors, similar bills, timeline). **Phase 1 is a data-availability audit** — Code reports, per item, whether the data is already fetched for the expanded row, available via an existing query, or needs new fetching/schema. We then decide what's in scope based on cost. Don't build until the map is in and signed off.

## Note on shared component

The expanded row uses `.feed-row` / the feed row component, which is **shared with the dashboard activity feed** (the 18px bump just affected both). Phase 1 must report whether the enrichment applies to BOTH surfaces or only the `/bills` expanded state — and whether the dashboard feed even has an expanded state. If shared, decide whether the enrichments should appear on the dashboard feed too or be scoped to `/bills` only (likely the latter — the dashboard feed is a glance surface).

## Phase 1 — Data-availability audit (HALT after)

For EACH of the six, report: (a) is the data already in context for the expanded row? (b) if not, is there an existing query/helper that returns it? (c) if not, what new fetch/query/schema would it need + the cost? (d) the cheapest correct way to surface it.

1. **Sponsor → member link.** The expanded row already shows the sponsor ("Rep. Van Duyne, Beth [R-TX-24]"). Does the bill record carry the sponsor's `bioguideId` (to build `/members/[bioguideId]`)? Confirm the member page exists at that route for the linked id. (Expected: cheap — the ID is likely already there.)

2. **Committee → committee link.** The row shows the committee name ("Education and Workforce Committee"). Does it carry the committee `systemCode` to link to `/committee/[systemCode]` (the HO 144 committee pages)? If only the name is stored (not the code), report what resolving name→code would take. (May be cheap or may need a lookup.)

3. **Related news.** The news-signal pipeline matches news articles to bills (the news matcher, HO 86/104). Per bill, is there a query that returns its matched articles (headline, source, url, date)? Report the query (or that one needs writing) and the shape. How many to show (cap, e.g. top 3 most recent)?

4. **Cosponsors.** Does the bill record / a query have cosponsor data (count, and the list with bioguide ids)? Congress.gov provides cosponsors — are they synced/stored, or would this need a new fetch? Report. If available: show the count (e.g. "42 cosponsors"), and decide whether to list/link them or just count + link to the full bill page.

5. **Related / similar bills.** The similarity pipeline (HO 51/52 — clustering/similarity). Is there a per-bill "similar bills" query? Report whether it exists, returns what, and the cost to surface (e.g. top 3 similar, each linking to its bill).

6. **Stage timeline / history.** The row shows current STAGE + LAST ACTION. Is the full action history (the progression of stages with dates) stored per bill, or only the latest action? Report what's available — a real timeline needs the action history; if only last-action is stored, a timeline may be out of scope or need the actions synced.

**Also report:** the shared-component question (does this apply to the dashboard feed too, or `/bills` only — recommend `/bills` only), and a proposed scope split (which of the six are cheap-wins to do now vs. which need new data and could be deferred or dropped).

**HALT. Report the six-item data map + the scope recommendation. I'll decide what's in scope for Phase 2 based on cost — likely the cheap links (sponsor, committee) + whatever of news/cosponsors/similar/timeline is already queryable, deferring anything that needs heavy new syncing.**

## Phase 2 — Implementation (after sign-off, scoped to what's approved)
- Wire the approved enrichments into the expanded row.
- Links use existing routes (`/members/[bioguideId]`, `/committee/[systemCode]`, `/bill/[id]` for related).
- Related news / similar bills capped (e.g. top 3) to keep the row from ballooning.
- Scoped to `/bills` expanded state (not the dashboard glance feed) unless Phase 1 says otherwise.
- No layout redesign — sensible inline placement; the design chat handles arrangement later.

## Verification
- Each approved enrichment renders and links correctly (sponsor → right member page, committee → right committee page, related bills → right bills).
- Related news shows real matched articles (or nothing if none matched — clean empty state).
- No N+1 query explosion — the enrichment data is fetched efficiently (one query per type, or joined), not per-row in a loop. Report the query count for an expanded row.
- The dashboard activity feed is unaffected (if scoped to /bills).
- Type check passes.
- Code starts the dev server; Corey eyeballs an expanded row.

## Out of scope
- Layout/arrangement redesign of the expanded row (→ design chat, separate).
- Any enrichment Phase 1 flags as needing heavy new syncing, unless explicitly approved.
- The dashboard activity feed (glance surface — keep it lean).
- SKILL.md — flag for the next sweep.

## Sequencing note
- HO 187 (inner-page chrome) should be pushed/complete before this stacks on the same bill-row surface.
