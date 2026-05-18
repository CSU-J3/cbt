# 79 — Voting record on member hub

## What this is

Handoff 77 synced ~537 House votes and 231k member positions. None of it is visible yet. This handoff adds the voting record section to `/sponsors/[bioguideId]` so opening any House member's page shows how they actually vote, not just what they sponsor.

Senate members get a "not yet available" placeholder because handoff 78 (Senate XML scraper) hasn't shipped. The component should handle both cases without crashing.

Per the IA rule: this is hub-level content (snapshot, not deep dive). 20 recent votes + a one-line stats summary. The pageable full history becomes `/sponsors/[bioguideId]/votes` in a later handoff if the snapshot proves useful.

## Where it goes

Place the section on `/sponsors/[bioguideId]` after the existing sponsored-bills list. Order on the page:

1. Header (name, photo, party/state, next-election chip, badges) — unchanged
2. Stats row (sponsored count, etc.) — unchanged
3. Sponsored bills list — unchanged
4. **NEW: Voting record section**

Don't reorder or restyle anything above it.

## Vote color tokens

Add to `app/globals.css`:

```css
--vote-yea: #10b981;        /* matches --stage-enacted */
--vote-nay: #f87171;        /* distinct red, NOT --party-republican (avoids party-coding nay votes) */
--vote-present: #fbbf24;    /* matches --accent-amber-bright */
--vote-not-voting: #6b7280; /* matches --text-dim */
```

The reason `--vote-nay` is a separate token from `--party-republican`: rendering a Democrat's nay vote in `--party-republican` red reads as "Republican-coded vote" semantically when it's actually a Democrat voting against something. Vote color must be decoupled from party color.

## Components

Two new server components in `components/`:

### `MemberVoteStats.tsx`

One-line dense summary above the votes list. Reads from `getMemberVoteStats(bioguideId)`. Format:

```
HOUSE VOTES · 537 TOTAL · 380 YEA (71%) · 145 NAY (27%) · 2 PRESENT · 10 MISSED (2%)
```

12px uppercase, `0.5px` letter-spacing, joined by ` · ` separators. Percentages computed from `total` (not from `total - notVoting`). The `MISSED` value is `notVoting / total`. Use `tabular-nums` so the numbers don't jiggle across rows.

If `stats.total === 0`, render the empty-state version:

```
HOUSE VOTES · No votes recorded
```

### `MemberVoteRow.tsx`

One row per vote in the recent-votes list. Grid layout, similar density to `BillRow`. Columns:

| Width | Content |
|---|---|
| 60px | Position chip (`[YEA]` / `[NAY]` / `[PRES]` / `[N/V]`) in the corresponding `--vote-*` color, uppercase, brackets included |
| 70px | Date (`MM-DD-YY`) |
| 70px | Vote ID or bill ID: if `bill_id` is set, show the bill ID (`HR 1234`) and link to `/bill/[id]`. If null, show `amendment_designation` (`HAMDT5`) plain text, no link |
| 1fr | Question + result: `"On Passage · Passed"` style. Truncate the question at the word boundary if needed |
| 80px | Roll call number, right-aligned, dim (`#237`) |

Below 700px, hide the roll-call column and the bill-id column compresses. Same media query approach as `.feed-row`.

Position chip styling: uppercase, 12px, mono, foreground color from `--vote-*`. No background fill — the colored brackets carry the signal. `not_voting` renders as `N/V`.

## Page integration

In `app/sponsors/[bioguideId]/page.tsx` (or wherever the hub lives):

```typescript
// Existing
const member = await getMemberByBioguide(bioguideId);
const sponsoredBills = await getSponsoredBills(bioguideId);

// New
const voteStats = await getMemberVoteStats(bioguideId);
const recentVotes = await getMemberVotes(bioguideId, { page: 1, pageSize: 20 });

// Render after sponsored bills:
<section className="member-votes">
  <MemberVoteStats stats={voteStats} chamber={member.chamber} />
  {voteStats.total > 0 ? (
    <div className="member-votes-list">
      {recentVotes.votes.map(v => <MemberVoteRow key={v.id} vote={v} />)}
    </div>
  ) : (
    <SenateVotesPlaceholder chamber={member.chamber} />
  )}
</section>
```

`SenateVotesPlaceholder` is a tiny inline component (don't make a new file for it) that reads:

- If chamber is Senate: `"Senate voting records sync ships next. Check back soon."`
- If chamber is House but no votes: `"No House votes recorded for this member yet."` (rare — only for very new House members or vacancies)

Center-aligned, `--text-muted`, 13px.

## Linking out

Don't add a "VIEW ALL N VOTES →" link in this handoff. The sub-page (`/sponsors/[bioguideId]/votes`) doesn't exist yet. Adding a stub link that 404s creates a confusing failure state. Show the 20 most recent and stop. The sub-page is a follow-up handoff if the snapshot proves analytically useful.

## SponsorRow snapshot enhancement (optional, can defer)

The `/sponsors` page row dropdown currently shows recent sponsored bills. A useful snapshot addition: show the member's last 2-3 votes alongside their recent bills, since voting is the bigger action signal. But this requires a wider expand panel and a layout decision that's a separate scoping conversation. Defer to a follow-up.

## Verification

1. `/sponsors/[bioguideId]` for a House member (try Speaker Johnson, AOC, Hakeem Jeffries) renders the stats line with non-zero totals and 20 vote rows below.
2. Vote rows show correct color per position. A YEA row shows green brackets; a NAY row shows the distinct red (not party red).
3. Clicking the bill ID on a row navigates to `/bill/[id]`.
4. Clicking a row with `amendment_designation` (no bill) doesn't navigate anywhere; the text is plain.
5. `/sponsors/[bioguideId]` for a Senate member (try Schumer, Thune, Sanders) renders the stats line with `No votes recorded` and the Senate placeholder text below.
6. Page below 700px doesn't blow up: roll-call column hidden, bill-id column compressed, everything still legible.
7. View source on the page: the entire voting section is server-rendered. No client hydration markers around it.
8. Performance: page load doesn't visibly slow down. The `unstable_cache` wrapping on the new query helpers should keep it snappy after first render.

## Out of scope

- The `/sponsors/[bioguideId]/votes` sub-page with paginated full history
- Senate vote data (handoff 78)
- Vote analytics: party-line %, "lone no" votes, vote-week summaries (future)
- Filtering by topic, date range, or vote category on the hub section (sub-page concern)
- Adding voting record to the bill detail page (would show all members' positions on a single vote — different surface, future handoff)
- The SponsorRow expand snapshot enhancement mentioned above
- Visualizations (charts of voting patterns over time, ideological clustering, etc.)

## Don't

- Don't fetch from Congress.gov in the page render. All reads go through the cached query helpers in `lib/queries.ts`.
- Don't add `'use client'` to anything in this handoff. The voting section is pure server render — no toggles, no client islands needed.
- Don't add a "view all" link to a sub-page that doesn't exist. Either ship the sub-page or omit the link.
- Don't use `--party-republican` for nay votes. The new `--vote-nay` token is non-negotiable for semantic clarity.
- Don't reformat the existing member hub sections to match the new vote section's typography. Match the prevailing style on the page; the vote section blends in.
- Don't backfill the SKILL.md design system docs in this handoff. The four new `--vote-*` tokens are worth documenting eventually but that's a docs sweep, not a UI handoff.
