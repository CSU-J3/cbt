# HO 421 — Member ideology surface: DW-NOMINATE on the member hub

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 421 (420 = the 419 doc sweep, shipped `ad7beb7`). If HEAD moved, renumber.
>
> **Code only. No docs.** SKILL.md, roadmap.md, backlog.md, oddities.md defer to a follow doc sweep (see Docs below). Don't touch `docs/` or `SKILL.md` here.
>
> Spec-driven: **propose the plan, wait for review, show the diff, no auto-commit.** Eyeball the rendered readout against real members before committing. `git add` by explicit pathspec, ancestry re-checked immediately before push.

## Grounding — what exists (don't re-derive)

- **`member_ideology` shipped** (HO 419, books closed at `ad7beb7`): bioguide PK, `nominate_dim1` (economic left/right, DW-NOMINATE domain ≈ −1..+1, negative = left/liberal), `nominate_dim2`, `nokken_poole_dim1/2`, `number_of_votes`, `conditional` (1 = provisional), `updated_at`. Joins `members` on `bioguide_id` directly. Live: 552 rows, **1 current member `nominate_dim1` NULL** (too few votes), 0 `conditional`.
- **The member hub is `app/members/[bioguideId]/page.tsx`** — server fetches via a `Promise.all`, sections rendered inline (no shared body/drawer, per HO 414). Existing sections: bio / committees / votes / badges / palestine / trades / donor-split / news. Existing compact stat readouts: `MemberStats`, `MemberVoteStats`, `MemberFundraisingLine`.
- **Queries live in `lib/queries.ts`.** The 1-D bar idiom is div + CSS (`.funnel-bar-track` / `-fill`, per `StageFunnel` / `TopicDistribution`). Party colors are `--party-*` tokens. Hand-rolled SVG is reserved for 2-D coordinate charts (`SponsorProductivityScatter`) — **not** this surface.

## The surface

A compact DW-NOMINATE readout on the member hub, sized like the other stat blocks (not a full-width chart). Div + CSS, terminal idiom (mono, 11–12px tracked uppercase labels, CSS-var colors). It's a 1-D left/right axis:

- A horizontal track on a **fixed −1..+1 domain** (the true DW-NOMINATE range — comparable across members and chambers; do not scale to the chamber's min/max, that exaggerates small gaps and breaks comparability). Ends labeled (e.g. `LIBERAL −1` / `CONSERVATIVE +1`), a center tick at `0`.
- **The member's marker** positioned at `nominate_dim1`, colored by the member's `--party-*`. This is the prominent element.
- **Both party medians for the member's chamber** as thin reference ticks (D-colored + R-colored), so the marker reads as moderate-vs-extreme within its own party and relative to the other party. **Median computed app-side** over the chamber's `dim1` set — it's honest for a skewed distribution; don't use `AVG` and label it a median.
- **Numeric readout:** `nominate_dim1` to 3 decimals, labeled as the economic left/right dimension. `dim2` optional as a low-key secondary numeric; don't build a second axis for it.
- **States:** `nominate_dim1 IS NULL` → an empty state (`NO IDEOLOGY SCORE YET` / too few votes this Congress) — this is the 1 current member. `conditional = 1` → a small `PROVISIONAL` marker on the value (none fire now, but handle it).

Interpretation aside for your own sanity when eyeballing: DW-NOMINATE keys off roll-call coalition voting, so some progressives read center-left (Voteview has a whole article on AOC estimating as a moderate — she votes against Democratic leadership from the left, which the model reads as cross-pressure). The marker is faithful to the data; don't "fix" a number that looks off.

## Query

`getMemberIdeology(bioguideId)` in `lib/queries.ts`:

- PK lookup for the member's row: `nominate_dim1`, `nominate_dim2`, `number_of_votes`, `conditional`, `chamber`.
- The member's-chamber `dim1` values for the two major parties (join `member_ideology` to `members` for party + chamber), to compute the D and R medians app-side.
- Return `{ dim1, dim2, numberOfVotes, conditional, chamber, demMedian, repMedian }` (medians null-safe if a party is somehow empty).
- The context aggregate scans ~535 rows: sub-millisecond, **no `INDEXED BY`, no new index**. This is the small-table judgment, not the fat-`bills` regime where forced indexes matter.

## Component

`components/MemberIdeology.tsx` — the axis above. Match the project SKILL design system and the existing 1-D bar tokens (`--party-*`, the stage/topic bar track pattern); new CSS classes follow the same stylesheet convention as the other 1-D bars. Pull the exact tokens from SKILL, don't invent a palette.

## Page wiring

- Add `getMemberIdeology(bioguideId)` to the existing `Promise.all` in `app/members/[bioguideId]/page.tsx`; render `<MemberIdeology … />` as a section.
- **Placement:** with the legislative-behavior stats (next to `MemberVoteStats`), since ideology is voting-derived — not beside fundraising.
- **Caching:** follow the existing member-hub pattern for a manually-synced field (crosswalk / fundraising). Don't add a cron-flushed cache tag — nothing flushes ideology on a schedule (`sync:ideology` is manual); it self-heals on the page TTL, or a manual revalidate after a sync run.

## Deferred (name, don't build)

- The **2-D DW-NOMINATE scatter** (`dim1` × `dim2`, the classic Voteview plot) — hand-rolled SVG, the `SponsorProductivityScatter` idiom, its own handoff.
- An **ideology axis on the existing `SponsorProductivityScatter`** (color or a third channel by `dim1`).
- **Chamber/party ideology medians as a dashboard block** (the medians this query already computes, promoted to a standalone surface).
- **Percentile/rank phrasing** ("more conservative than N% of the party").

## Docs (deferred to a follow sweep — don't write here)

The sweep carries: SKILL (the `MemberIdeology` component in the design system + `getMemberIdeology`); a roadmap note (this is the **first ideology surface** — gauge whether it moves the Member-depth bar or rides as an Also); a backlog DONE tombstone + striking the QUEUED "first ideology surface" item.

## Commit discipline

Propose the plan; wait for review. One code commit: `lib/queries.ts` + `components/MemberIdeology.tsx` + the page edit + any stylesheet touched. Explicit pathspec, ancestry re-checked before push. **Eyeball before committing** against a clear-left member, a clear-right member, and the 1 `nominate_dim1 IS NULL` member (find it via `SELECT bioguide_id FROM member_ideology WHERE nominate_dim1 IS NULL`, or a member with no row) for the empty state. Show the diff — no auto-commit.

## Report back

The rendered readout for 2–3 members including the empty state (description or screenshot), the diff, and confirmation `docs/` and SKILL are untouched (deferred to the sweep).
