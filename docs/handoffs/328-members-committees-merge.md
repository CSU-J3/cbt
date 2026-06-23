# HO 328 — Merge Members + Committees into one two-pane tab

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 328.

The approved design from the design chat: collapse `/members` and `/committees` into one cross-filtering two-pane browser — committee rail left (312px), member list right (1fr) — replacing the Members · Committees sub-nav. The three approved mocks (`members-committees-merged.html`, `-live.html`, `-expand.html`) are the pixel reference; they're dropped alongside this file.

Desktop only this pass — mobile stacks (rail above list), deferred to the mobile pass. Index-level only: `/committee/[systemCode]` detail stays untouched. Big restructure, touching `/members` (HO 195–200) and `/committees` (143–146) plus the sub-nav — plan it in plan mode.

Chrome note: the page stays at `/members` with the standardized HeaderBar chrome from HO 323/325 (breadcrumb path → LAST SYNC subhead → nav row). The mocks' simplified `.mast`/`.sub` masthead is illustrative — don't replace the real chrome. The filter bar sits below it.

## Confirm first — data layer (gates the UI)

Three premises. Resolve them before building the UI. Two have a real "might not be feasible" branch; if either fails, HALT and report options rather than building on it or faking it. If all three resolve cleanly, proceed to the UI in the same run.

1. Per-row topic mix — the bar. Every member row renders a volume bar segmented into that member's top-3 topics + an OTHR rollup, with per-topic shares. Today the topic mix is fetched only for the one expanded member (`getSponsorTopTopics`); the list needs it for every visible row. Confirm `getMembersRanked` can carry the top-3-topics-with-shares aggregate for the whole ranked set in one query (a `json_each` fanout + grouping, or a companion batch query keyed by bioguide). If the only path is a per-row fetch (N+1 across ~536 members), HALT — that would tank the page; report the query options before building the bar.

2. Scoped roster order — chair → ranking → volume. Clicking a committee scopes the right pane to its roster, ordered chair first, ranking member second, then the rest by bill volume DESC. The `/committee/[systemCode]` detail query (`getCommitteeMembers`, `party_side` then `rank`) already resolves chair/ranking roles; the merge needs that membership joined to the member volume + topic-mix shape. Confirm the join is cheap to reuse at the index level — no heavy per-click refetch.

3. Live group feasibility. The LIVE NOW rail group lists committees with a hearing in its scheduled in-session window right now (committee · hearing title · elapsed). Schedule-derived, not a feed. Confirm the hearings data layer carries per-hearing scheduled start + window so "in session now" and elapsed are derivable. If the schedule is date-only with no time granularity, the group can't be built as specced — HALT, report, and we decide (omit the group + the `● N LIVE` count, or a fallback). Don't fabricate live state.

Already available, confirm and reuse: `getMemberCommittees(bioguideId)` (HO 145) returns a member's full committee set with subcommittees — it feeds both the expanded card's COMMITTEES column (uncapped here) and the rail's member-marking.

## The build

### Filter bar
Full-width strip (border, no bottom border, connects to the pane). Left: MEMBERS label (amber-bright) + filtered count ("N of the 119th", reflects active chamber/party/state/search). Right: chamber segmented control (ALL/HOUSE/SENATE), ALL PARTIES ▾, ALL STATES ▾, VOLUME/PASS RATE segmented control, □ CEREMONIAL toggle, search. The chamber control filters both the member pane and the rail; everything else drives the member pane only.

### Left rail — committee index (312px)
Border-right, bg-panel. Header row: COMMITTEES on the left (optional `· N`), and on the right `● N LIVE` (party-red) when live committees exist; when a member is expanded, append `· ● on N` to the left label.

LIVE NOW group, pinned at the top, only when live committees exist: a LIVE NOW header (red), then per-live-committee rows — top line `● LIVE · chamber tag · committee name`, sub-line `hearing title · elapsed`.

Committee rows — all current committees + subcommittees (this is the `/committees` index, now the rail). Five columns: on-marker slot (reserved always so rows don't shift; a lighter-amber `●` when the expanded member sits on this committee, empty otherwise) · chamber tag (SEN/HSE) · name · thin activity bar (3px, `--stage-committee` fill, width = recent-activity share) · member count. Selected committee: 2px amber-bright left border + amber-bright name. Name links to `/committee/[systemCode]`. Ordering matches the current `/committees` index (chamber-grouped, activity-ranked — confirm against `getCommitteesIndex`).

### Right pane — member content (1fr)
Top to bottom:
- Topic key strip at the top — TOPICS label + the 8 topic-group swatches (colors from `lib/topic-colors`), above everything in the pane. (The merged mock's bottom legend is superseded; key goes at the top per the spec and the expand mock.)
- Context header, only when a committee is selected: `chamber · committee name · N members · [spacer] · committee detail → · × all members`. "committee detail →" links `/committee/[systemCode]`; "× all members" clears the scope.
- Column header: MEMBER · BILLS · TOPIC MIX · RATE · ENACT · BILLS.
- Member rows (grid `1fr / 320px / 56px / 64px / 52px`): caret (when expandable) + name (sans) + `[party-state]` bracket (party-colored) + CHAIR/RANKING badge when in a scoped roster · the segmented bar · RATE (green >0, dim at 0) · ENACT (`N ✓`) · BILLS (dim, emphasized).
- Roster cap ~10, then `▾ SHOW ALL N MEMBERS (M more)`.

### The bar — the model change
One bar, always. A 9px track; a fill whose width = member bills / page-max; the fill split into the member's top-3 topics (largest first) + a dim OTHR rollup, each segment width = that topic's share of the member's bills, colored from `lib/topic-colors`, 1px `--bg-base` hairline between segments. Party is not in the bar (bracket only).

Page-max scales the bar: the full ranked list against the global max across the filtered set; a scoped committee roster against the roster max, so lengths compare within the committee, not against all 536. (That's the Armed Services "wall of teal" read.)

This replaces HO 196's one-bar-per-active-sort — the party-colored VOLUME bar and the green PASS RATE track both go. VOLUME vs PASS RATE now only reorders rows; the bar is identical across both; RATE and ENACT carry the metric as columns in both sorts. No green pass-rate track.

### Expanded member card
Click a member's caret/row → the row gets a `▾` caret and an `×` (right edge), and the HO 198 3-column card opens below it (grid `210px / minmax(0,1.5fr) / minmax(0,1fr)`):
- Left rail: photo, identity (Sen./Rep. name + party bracket), TOTAL BILLS / ENACTED n%, STAGES glyph run, TOPICS chips, USCPR SCORECARD, stacked VIEW DETAIL / OPEN IN FEED.
- Middle: RECENT BILLS · N TOTAL, capped ~7 + SEE ALL N BILLS →.
- Right: COMMITTEES · N — uncapped, all committees with subcommittees nested (`↳`), CHAIR badge where applicable, chamber tag.

Reuse the existing `SponsorExpandedPanel` — the only change is uncapping the COMMITTEES column (HO 198 capped it ~8). Close via the `×` on the name bar or the caret.

### Member → rail cross-link
When a member is expanded, the rail marks every committee they sit on with the lighter-amber `●` in the on-marker slot, and the header shows `· ● on N`. The amber is lighter than the selected-committee amber-bright border, so "this member sits here" and "I selected this committee" read as distinct. Source: `getMemberCommittees(bioguideId)`.

### Interactions + URL
Click committee → scope the pane (chair → ranking → volume), context header appears, bar rescales to roster max. "× all members" or re-click → full ranked list. Click member → expand the card + rail marking. VOLUME/PASS RATE → reorder rows only. Native `<title>` on bar segments (full topic name · count) and on live rows. Committee names → `/committee/[systemCode]`.

URL: keep the existing members params (sort, party, state, chamber, ceremonial, search) + `?expanded=<bioguide>` (the single-open mechanism is unchanged). Add `?committee=<systemCode>` for the scoped roster. All state URL-driven.

## Cuts — print consumers before deleting
- `MemberProductivityScatter` (both charts, HO 152/197) off `/members`. Grep all consumers first; if anything outside `/members` imports it, HALT and report rather than delete.
- The Members · Committees sub-nav. The Members group in `GROUP_TABS` (HO 173) collapses to a single Members tab — Committees is merged in, nothing left to switch between. Redirect `/committees` → `/members` (the rail is the index now); grep and repoint any in-app links to `/committees`. `/committee/[systemCode]` detail stays and stays linked from the rail.
- HO 196's one-bar-per-active-sort logic + the pass-rate green-track state (superseded by the always-on segmented bar).

## Constraints
- Desktop two-pane only. Mobile stacks, deferred — don't build it.
- `/committee/[systemCode]` detail (HO 146) untouched; index-level merge only.
- Static. The live dot is a static party-red `●`, no pulse (a pulsing LIVE would be a third motion exception next to the cursor and ticker; not flagged). Live red = `--party-republican` — committee rows carry no party, so no collision; `--accent-amber-bright` is the fallback if you'd rather keep red strictly for party.
- Bar segment cap = 3 + OTHR. Roster cap ~10 before SHOW ALL. Page scrolls on overflow.
- No new tokens — reuse existing, and `lib/topic-colors` for every segment/swatch/chip color. Monospace throughout.
- Page chrome stays the standardized HeaderBar (323/325); the mocks' `.mast`/`.sub` is illustrative.

## Ship
- Confirm the current `/members` (195–200) and `/committees` (143–146) structure before cutting. Reuse `SponsorExpandedPanel`, `getMembersRanked`, `getMemberCommittees`, `getCommitteesIndex`, `lib/topic-colors` — don't rebuild.
- Named `git add`; `tsc` + build clean; fresh `.next`, stylesheet loads.
- `git push`; `npm run verify:deploy` until served SHA === HEAD.
- Live-verify: default (full ranked list, rail as nav, bar scaled to global max); click a committee (pane scopes chair → ranking → volume, context header, bar rescales to roster max); expand a member (3-col card, COMMITTEES uncapped, rail marks their committees + `● on N`); VOLUME↔PASS RATE reorders rows only; chamber filter narrows both panes; URL round-trips `?committee` + `?expanded`; `/committees` redirects to `/members`; the scatter is gone.
- Docs owed: supersedes HO 196's bar rule, cuts the scatter (152/197), collapses the HO 173 Members sub-nav, merges the committees index. SKILL + roadmap + backlog reconciliation — flag for the sweep or fold a note; the roadmap Member/committees status shifts.
