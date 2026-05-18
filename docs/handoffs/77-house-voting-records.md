# 77 — House voting records ingestion

## What this is

CBT can tell you what a member sponsors but not how they vote. That's the biggest analytical gap in the member hub right now — sponsorship is intent, voting is action, and "how did X vote on Y" is the single most-asked question the dashboard currently can't answer.

This handoff ships the data layer for House roll call votes. Schema, sync, query helpers. No UI surface — that's the next handoff. Senate votes ship in a separate handoff (different data source, XML scraping from senate.gov; the Congress.gov API only covers House).

Member depth theme, step that turns it from cosmetic to useful.

## API verification

House Roll Call Votes endpoints went live on the Congress.gov API in May 2025 and have matured over the past year. Confirm exact URL pattern against current docs before scoping the fetch logic:

```powershell
curl "https://api.congress.gov/v3/house-vote/119/1?api_key=$env:CONGRESS_API_KEY&limit=5&format=json"
```

If that 404s, the path is different — check https://github.com/LibraryOfCongress/api.congress.gov for the current endpoint structure under "House Vote" or "Roll Call." The three documented levels are list, item, and member-votes. Don't proceed with the sync until a successful list call returns vote objects.

If the call works, eyeball one vote object to confirm fields. The expected shape:

```json
{
  "congress": 119,
  "session": 1,
  "rollCallNumber": 237,
  "voteDate": "2026-04-15T14:32:00Z",
  "question": "On Passage",
  "result": "Passed",
  "bill": { "number": "HR1234", "congress": 119, "type": "HR" },
  "totals": { "yea": 218, "nay": 211, "present": 0, "notVoting": 6 }
}
```

Field names may differ. Use what the live API returns; don't fight the schema.

## Schema

Two new tables. Add to `scripts/migrate.ts`:

```sql
CREATE TABLE votes (
  id TEXT PRIMARY KEY,                   -- 'house-119-1-237'
  chamber TEXT NOT NULL,                 -- 'house' (senate added in handoff 78)
  congress INTEGER NOT NULL,
  session INTEGER NOT NULL,              -- 1 or 2
  roll_call INTEGER NOT NULL,
  vote_date TEXT NOT NULL,               -- ISO datetime
  question TEXT,                         -- 'On Passage', 'On the Amendment', etc.
  description TEXT,                      -- nullable; longer explanation
  result TEXT,                           -- 'Passed', 'Failed', 'Agreed to', etc.
  bill_id TEXT REFERENCES bills(id),     -- nullable; many votes aren't tied to bills
  amendment_designation TEXT,            -- nullable; e.g. 'HAMDT5' for amendment votes
  yea_count INTEGER NOT NULL,
  nay_count INTEGER NOT NULL,
  present_count INTEGER,
  not_voting_count INTEGER,
  raw_json TEXT NOT NULL,
  update_date TEXT NOT NULL
);

CREATE INDEX idx_votes_chamber_date ON votes(chamber, vote_date DESC);
CREATE INDEX idx_votes_bill_id ON votes(bill_id) WHERE bill_id IS NOT NULL;

CREATE TABLE member_votes (
  vote_id TEXT NOT NULL REFERENCES votes(id),
  bioguide_id TEXT NOT NULL,             -- not FK; members table may not have every member
  position TEXT NOT NULL,                -- 'yea' | 'nay' | 'present' | 'not_voting'
  PRIMARY KEY (vote_id, bioguide_id)
);

CREATE INDEX idx_member_votes_bioguide ON member_votes(bioguide_id);
```

Don't make `bioguide_id` a foreign key to `members`. There will be members in vote records who haven't been synced yet (or were members at the time of the vote but have since left), and we don't want the FK to block the insert. Treat `bioguide_id` as opaque identifier; the join happens at query time.

The `bill_id` on votes maps to the existing `bills.id` (format `119-hr-1234`). Normalize the API's bill reference into that format on insert.

## Sync logic

New file `lib/votes-sync.ts`. Pattern matches `lib/sync.ts`:

1. Read `MAX(vote_date)` from `votes WHERE chamber = 'house'`. If empty, default to the start of the current Congress (Jan 3, 2025).
2. Fetch the house-vote list endpoint filtered to `congress=119`, paginated. Filter to vote_date > max stored.
3. For each new vote: fetch item-level detail, fetch member-vote level, normalize bill_id reference, upsert into `votes`, bulk-insert member positions into `member_votes`.
4. Throttle to stay under Congress.gov's 5000-req/hour limit. The initial backfill is the heavy hit — roughly 800 votes × 2 API calls each = 1600 requests, plus pagination, well within budget.

New file `scripts/sync-votes.ts` — standalone runner, mirrors `scripts/sync.ts`. Add `"sync:votes": "tsx scripts/sync-votes.ts"` to package.json.

For the cron: do NOT add to the existing `/api/sync` route in this handoff. That route is already packed and runs near the 60s ceiling. Wire a separate `/api/sync-votes` route in handoff 78 alongside the Senate work — by then you'll know how long the House sync takes on incremental load and can size the cron entry accordingly.

For now, voting records sync runs manually via the CLI. This is fine until the surface ships in handoff 79 (UI).

## Query helpers

Add to `lib/queries.ts`:

```typescript
// Recent votes by chamber
getRecentVotes(chamber: 'house' | 'senate', limit: number): Vote[]

// Votes on a specific bill
getVotesByBill(billId: string): Vote[]

// A member's vote on a specific vote (null if not in record)
getMemberVote(voteId: string, bioguideId: string): MemberVote | null

// A member's full voting history, paginated
getMemberVotes(bioguideId: string, opts: { page, pageSize }): {
  votes: VoteWithMemberPosition[],
  total: number
}

// Aggregate stats for a member: total votes, party-line %, missed %
getMemberVoteStats(bioguideId: string): {
  total: number,
  yea: number,
  nay: number,
  present: number,
  notVoting: number
}
```

Wrap the read-side ones in `unstable_cache` with tags `votes` and `member-votes:{bioguideId}` so they integrate with the existing revalidation pattern. After `sync-votes.ts` writes, call `revalidateTag('votes')`.

## Backfill plan

Run once manually:

```powershell
npm run migrate
npm run sync:votes
```

Expected: ~800 vote rows, ~350k member_votes rows for 119th Congress to date. Initial sync takes 10-20 minutes depending on throttle. Watch for errors; the API occasionally 5xxs and the script should retry with backoff (3 retries, exponential).

## Verification

1. `npm run sync:votes` completes without crashing.
2. `SELECT COUNT(*) FROM votes WHERE chamber='house'` returns several hundred rows.
3. `SELECT COUNT(*) FROM member_votes` returns roughly `votes_count × 435` (some missing positions are normal).
4. `SELECT bill_id, COUNT(*) FROM votes WHERE bill_id IS NOT NULL GROUP BY bill_id ORDER BY 2 DESC LIMIT 10` shows bills with multiple votes (procedural + passage).
5. Spot-check one vote in Turso: `SELECT * FROM votes WHERE id='house-119-1-237'` (or whatever a recent vote ID is); then `SELECT position, COUNT(*) FROM member_votes WHERE vote_id='house-119-1-237' GROUP BY position` should sum to ~435 and match the totals on the votes row.
6. Query helpers compile and basic shapes work in a quick test script.

## Out of scope

- **Senate votes.** Different data source (XML on senate.gov, no Congress.gov API). Handoff 78.
- **Cron wiring.** Stays manual until handoff 78 ships and we know combined timing.
- **UI surface on member hub.** Handoff 79.
- **Vote analytics** (party-line %, missed %, "lone no" votes, vote-week summaries). Future work, derived from this data.
- **Committee votes.** Out of scope; only floor roll calls land in this pipeline.
- **Voice votes.** Not roll calls, not in the API, not in scope.
- **Historical Congresses** (pre-118th). API doesn't cover them; out of scope.

## Don't

- Don't add Senate vote logic in this handoff. The XML parsing is a separate problem.
- Don't make `bioguide_id` a foreign key. It would block inserts on members who aren't in our members table.
- Don't summarize votes with the LLM. The data is structured; the question is what to display, not how to interpret.
- Don't add voting records to the existing `/api/sync` cron route. Wire a separate route in 78.
- Don't backfill 118th Congress unless you specifically want historical comparison data — it doubles the row count for analytical value the dashboard doesn't surface yet.
- Don't change the bills schema to add a `votes_count` denormalization. Compute it from joins; cache it if the queries get slow.
