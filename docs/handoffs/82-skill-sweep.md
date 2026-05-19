# Handoff 82 — SKILL.md sweep

## What this is

Documentation-only. No code changes. `SKILL.md` is missing everything shipped since roughly handoff 67. This handoff brings it current so future Claude Code sessions don't operate on stale context.

## File to update

`SKILL.md` at the repo root (the one Claude Code reads via `.claude/skills/cbt/`). If there are two copies, update whichever one is symlinked or referenced in `.claude/`. Check with `ls .claude/skills/cbt/`.

## Changes to make

Work section by section. Don't rewrite prose that's still accurate — add, append, or replace only what's stale.

---

### 1. Database schema — add new tables

After the `watchlist` table definition, add:

```sql
CREATE TABLE members (
  bioguide_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  party TEXT,
  state TEXT,
  chamber TEXT,                     -- 'House' | 'Senate'
  district INTEGER,                 -- House only; NULL for Senate
  next_election_year INTEGER,
  in_office INTEGER DEFAULT 1,      -- 1 = current, 0 = departed
  lis_id TEXT,                      -- Senate LIS ID when available (often NULL; see lib/lis-map.ts)
  birth_year INTEGER,
  leadership_role TEXT,
  image_url TEXT,
  raw_json TEXT
);

CREATE TABLE affiliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
  org TEXT NOT NULL,
  category TEXT NOT NULL,           -- 'caucus' | 'union' | 'advocacy'
  source_url TEXT,
  last_verified TEXT
);

CREATE TABLE news_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id TEXT REFERENCES bills(id),
  source TEXT,
  headline TEXT,
  url TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE race_ratings (
  id TEXT PRIMARY KEY,              -- e.g. "CO-08-2026"
  state TEXT NOT NULL,
  district TEXT,
  cycle INTEGER NOT NULL,
  incumbent_bioguide_id TEXT REFERENCES members(bioguide_id),
  cook_rating TEXT,
  sabato_rating TEXT,
  inside_elections_rating TEXT,
  last_updated TEXT
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,              -- e.g. "2026-05-19"
  generated_at TEXT NOT NULL,
  week_start TEXT,
  week_end TEXT,
  content TEXT NOT NULL,           -- full MDX or markdown body
  bill_changes_count INTEGER,
  new_bills_count INTEGER,
  enacted_count INTEGER
);

CREATE TABLE votes (
  id TEXT PRIMARY KEY,              -- e.g. "house-119-2-1234" or "senate-119-1-00132"
  congress INTEGER NOT NULL,
  session INTEGER NOT NULL,
  chamber TEXT NOT NULL,            -- 'House' | 'Senate'
  vote_number INTEGER NOT NULL,
  vote_date TEXT,
  question TEXT,
  vote_title TEXT,
  result TEXT,
  bill_id TEXT REFERENCES bills(id),  -- NULL for nominations, procedural votes
  yea_count INTEGER,
  nay_count INTEGER,
  not_voting_count INTEGER
);

CREATE TABLE member_votes (
  vote_id TEXT NOT NULL REFERENCES votes(id),
  bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
  position TEXT NOT NULL,           -- 'yea' | 'nay' | 'not_voting' | 'present' (lowercase)
  PRIMARY KEY (vote_id, bioguide_id)
);
```

Note: `member_votes` uses `position` (not `vote_cast`) — normalized to lowercase.

---

### 2. New query helpers — add to the `lib/queries.ts` section

Append to the query helpers list:

- `getStageCounts()` — count of bills per stage, excludes NULL stage. Tagged `"bills"`. Used by `StageFunnel`.
- `getStageDistribution(filters?)` — richer version of above. Returns `{ bars, offPath, total }`. Accepts optional `is_ceremonial` and `topics` filters. Off-path = NULL + 'other' stage bills shown separately. Tagged `"bills"`.
- `getTopicDistribution(filters?)` — bill counts per topic, click-to-toggle compatible. Tagged `"bills"`.
- `getTopicMixByChamber()` — House vs Senate topic stacks, capped at 8 rows per column with an OTHER rollup. Tagged `"bills"`.
- `getRecentVotes(bioguideId, limit?)` — most recent votes for a member across both chambers, joining `member_votes → votes`. No chamber filter — returns House and Senate together.
- `getMemberVotes(bioguideId, filters?)` — paginated version of the above for the member hub vote section.
- `getVoteDetail(voteId)` — single vote with full member breakdown.
- `getNewsForBill(billId, limit?)` — news_mentions rows for a specific bill, sorted by `published_at DESC`.
- `getRaceRating(raceId)` — single race_ratings row.

---

### 3. New lib files — add a section or append to existing

Add under a `## Key lib files` section (or inline wherever sync logic is documented):

**`lib/lis-map.ts`**
Resolves Senate XML member references to `bioguide_id`. Senate LIS XML uses a `lis_member_id` field, but Congress.gov doesn't expose LIS IDs via the member API. The resolver uses `(last_name, state)` matching against the `members` table instead. Includes an explicit fallback table for members who left mid-Congress (Rubio, Vance — resigned; Armstrong — newly seated 2026). Re-evaluate when `sync-members` learns to pull current senators directly.

**`lib/senate-votes-sync.ts`**
`runSenateVotesSync()` — mirrors `votes-sync.ts` shape. Fetches the session menu XML from `senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_{session}.xml`, then detail XML for each vote from `vote119{session}/vote_119_{session}_{NNNNN}.xml`. Syncs both session 1 (2025) and session 2 (2026). Incremental by checking MAX(vote_number) already stored per session.

**`lib/report-generation.ts`**
Generates weekly markdown reports. Runs on cron (Monday 09:00 UTC). Sections: LLM-generated summary lead, bill changes (new/advanced/enacted this week), stage movements, stale bills, most talked about (placeholder — news signal parked). Report stored in `reports` table keyed by date string.

---

### 4. New npm scripts — add to the scripts section

```
sync:senate-votes   tsx scripts/sync-senate-votes.ts    # Senate roll call votes, both sessions
sync:votes          tsx scripts/sync-votes.ts           # House roll call votes
sync:members        tsx scripts/sync-members.ts         # Congress.gov member bio sync
```

`sync:votes` and `sync:senate-votes` run manually. Not yet wired into `/api/sync` cron (follow-up: fold into cron if 60-second ceiling allows, or add a separate daily cron entry).

---

### 5. New components — add to Frontend / Pages section

Add to the component list:

- `StageFunnel.tsx` — horizontal bar chart of bill counts per stage. Relative bar widths (max = 100%). Click row → `/?stage={stage}` filter. Off-path bills shown as a footer line. Server component.
- `TopicDistribution.tsx` — bar chart of bill counts per topic. Click-to-toggle `?topics=` filter. Server component.
- `TopicMixByChamber.tsx` — two-column House vs Senate topic stacks. Capped at 8 per column with OTHER rollup. Server component.
- `SponsorProductivityScatter.tsx` — scatter plot on `/sponsors`. X = bill count, Y = pass rate (enacted/total). Server component. Known: React duplicate-key warning at line 184 (cosmetic, doesn't break render).
- `VotingRecord.tsx` — member hub voting section. Shows recent votes with position color-coded by `--vote-*` tokens (see below). Both House and Senate votes appear together, labeled by chamber.

---

### 6. CSS tokens — add vote colors

In the color palette section, add:

```css
--vote-yea: #10b981;        /* green — same as --stage-enacted */
--vote-nay: #ef4444;        /* red */
--vote-not-voting: #6b7280; /* dim */
--vote-present: #a78bfa;    /* purple */
```

Design rationale: vote position colors are deliberately decoupled from party colors. Yea/nay carry no party signal — a Republican Yea and a Democrat Yea render identically. Party is shown separately via the member's party badge.

---

### 7. Pages — add new routes

Add to the pages list:

- `/sponsors/[bioguideId]` — member hub. Thesis: "what does this person work on in Congress?" Sections: bio header (party, state, chamber, district), sponsored bills list, voting record (`VotingRecord` component), caucus/affiliation badges, seat-up indicator when applicable. Links to `/race/[id]` when a race record exists.
- `/race/[id]` — race hub. ID pattern: `{STATE}-{DISTRICT}-{CYCLE}` (e.g. `CO-08-2026`). Sections: rating chips (Cook, Sabato, Inside Elections), incumbent link, seat-up year, candidate roster. MVP: mostly static/hand-entered data.

---

### 8. Known issues / follow-ups (add a section if none exists)

- **Votes cron not wired.** `sync:votes` and `sync:senate-votes` run manually. Fold into `/api/sync` when the 60-second ceiling is tested — or add a separate cron entry in `vercel.json`.
- **Senate LIS ID gap.** `lib/lis-map.ts` uses `(last_name, state)` matching as a fallback because Congress.gov doesn't expose LIS IDs. Three senators use an explicit fallback table (Rubio, Vance, Armstrong). Revisit if new senators are missing from vote coverage.
- **React duplicate-key warning in `SponsorProductivityScatter.tsx:184`.** Cosmetic. Fix when in the file for another reason.
- **`is_ceremonial` column not yet in schema.** Planned for theme 1 (bill signal). Affects `getStageDistribution` filter param which accepts but currently ignores it.
- **News signal parked.** `news_mentions` table exists; RSS pipeline runs; matching accuracy insufficient for "most talked about" report section. LLM-based matcher (~$30-40/year) is the path forward when reopening.

---

## Verification

After making all edits:

1. Read through the schema section — every table that exists in the DB should appear.
2. Read through the query helpers — every exported function in `lib/queries.ts` should be represented.
3. `grep -i "senate" SKILL.md` — should return the LIS map entry and senate-votes-sync entry.
4. `grep -i "vote" SKILL.md` — should return the votes/member_votes schema, query helpers, components, and CSS tokens.
5. No code files touched. `git diff` shows only `SKILL.md`.

## Acceptance

A fresh Claude Code session reading `SKILL.md` should have accurate context for: the full schema, the vote pipeline (both chambers), the member hub, the race surface, all dashboard components, and the known gaps. No surprises in the next session from stale docs.
