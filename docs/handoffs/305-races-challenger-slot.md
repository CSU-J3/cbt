# HO 305 — V2 RACES: race card challenger slot (matchup block)

Confirm the next free number before saving (`ls docs/handoffs/ | sort | tail`). Body assumes 305; rename if taken.

## Scope

`/dashboard-v2` RACES tab, the v2 `RaceCard`. UI-only: the challenger names are already fetched and handed to the card, just unrendered. No data work, no `/` changes. Static, no motion. The approved Design spec governs visuals; where this doc and the spec differ on look, the spec wins.

## Resolved premises (from the diagnostic, don't re-derive)

- `CompetitiveRacesBlock` (v2) already fetches each seat's roster via `getRaceCandidates(race.id)` and passes it to `RaceCard` as `candidates`. RaceCard today uses `candidates` only to color the K/P market favorite by party (HO 274). Challenger names are in hand.
- Incumbent name / party / tenure / cash come from `getRacesIndex` (incumbent-bioguide-keyed). Incumbent cash is present; challenger cash is structurally absent (member_fundraising is bioguide-keyed and active challengers carry no bioguide). No challenger cash anywhere.
- Roster rows carry a status (the diagnostic saw `won_primary` plus withdrawals; confirm the exact field + values). Filter to **active** challengers (drop withdrawn) before deriving the card's shape.
- Per-seat ground truth the shapes must reproduce: GA-SEN active = Dooley + M. Collins, incumbent Ossoff is the favorite. ME-SEN active = Platner + Mills, Platner is the favorite. FL-23 zero challenger rows, Moskowitz favored. NJ-07 active = Bennett (won primary), Bennett favored.

## Card layout (top to bottom)

This replaces the single incumbent name + "{party} · since {year}" subhead and the old three-stat row. Height stays neutral: the subhead folds into the incumbent line and cash moves up out of the stat row, so the card doesn't grow and the HEARINGS box stays pinned (282/304).

### 1. Seat label row
Unchanged on the left ("GA SENATE"). Right tag: see Out of scope; keep current behavior, don't add a tag.

### 2. Matchup block (replaces name + subhead)

**Incumbent line:** party dot (party color) · name (sans) · meta `{P} · inc. {YYYY}` · cash right-aligned on the same line as a dim `CASH` tag (9px) + `${amt}` (12px, text-secondary). This fold is what drops the INCUMBENT badge and holds the height. Remove the INCUMBENT badge from the card.

**Challenger line:** party dot · name(s) · meta. Derive one of four shapes from the active roster + the market favorite:

| shape | when | name | meta |
|---|---|---|---|
| settled nominee | one active challenger, or one with `won_primary` | `Bennett` (surname) | `{P} · nominee` |
| contested, leader | ≥2 active challengers AND the market favorite is one of them | `Graham Platner†` (full name + dagger) | `{P} · leads · {other}` |
| contested, no lead | ≥2 active challengers AND the favorite is the incumbent/party | `Dooley · M. Collins` (surnames, dot-joined) | `{P} · primary ({N})` |
| empty | zero challenger rows | `no challenger filed` (text-dim, hollow dot) | `—` |

- The leader in the contested-leader shape is the active challenger who matches the market favorite; that name gets the dagger.
- `{N}` = active challenger count. `{other}` = the other active challenger's surname (ME → "Mills"); if more than one other, use a count ("{N−1} others"). If the no-lead name list is too long for the column, degrade to "{N} candidates".
- Add a first initial only where the surname alone is ambiguous (the spec's "M. Collins").
- **Never** show cash on the challenger line. The missing figure is the signal.

### 3. Lean spectrum bar
Unchanged.

### 4. Ratings row (COOK · SABATO · IE)
Unchanged.

### 5. Divider
Unchanged.

### 6. Market strip (replaces the three-stat row; cash already moved up)
Name the favorite, party-colored, per market. Senate shows KALSHI + POLYMARKET; House shows KALSHI + `POLY n/a` (text-dim). Each cell reads `{MARKET} {favorite name} {pct}` → "KALSHI Platner 56%", "KALSHI Ossoff 84%". No dagger here. The favorite name comes from the existing HO 274 resolution extended from party → candidate; where a market resolves only to a party (not a single candidate), name that party's nominee/leader, else fall back to the party label.

## Edge accent

The market-favored candidate's line (incumbent OR challenger) gets a 2px left border in their party color: `margin-left:-9px; padding-left:9px`. Exactly one per card. Edge on the challenger (bottom) line means the incumbent is losing, readable at a glance.

Ground-truth edge placement (verify your derivation against this — a different result means the logic is wrong): GA → incumbent line (Ossoff), ME → challenger line (Platner), FL-23 → incumbent line (Moskowitz), NJ-07 → challenger line (Bennett).

## Dagger + footnote

Dagger only on the roster name in the contested-leader shape (`Platner†`), never on market cells. When any card on the page is in that shape, render one footnote below the card row: `† presumptive — {party} primary unresolved`. For the live four that's ME only → "† presumptive — Democratic primary unresolved". If more than one party is presumptive, name each.

## Constraints

- Static, no motion. Tokens only, no new CSS vars (party colors, text tiers, accent already exist).
- The incumbent line is the busiest line; it needs ~340px column width before long name + CASH crowd. Below ~340px, drop the `CASH` tag first (Code's call at the live card width on whether the amount also drops). Verify at the actual /dashboard-v2 card width whether CASH fits the 4-across grid; report what you did.
- Don't add a challenger cash slot or any cash symmetry.
- Names use the card's existing sans `.nm` treatment; everything else stays mono per the house style.

## Out of scope

- FL-23 challenger data: the empty state needs none, so all four ship together. Filling FL-23 with a real challenger is separate roster work, doesn't block this.
- Top-right seat tag: undecided (CLASS II / 2024 margin are placeholders; Senate has no single 2024 margin, House has it where backfilled, FL-23's isn't in data). Keep the current top-right behavior (the 2024 margin where present, e.g. NJ-07 "2024 R+5.4"; nothing otherwise). Don't invent a tag. Flagged for a later decision. Note: dropping the INCUMBENT badge here supersedes the HO 304 NJ-07 badge swap, that swap is now moot.

## Ship

- Named `git add` per commit, eyeball the diff. Stale `.next`: verify the stylesheet loads (no 404 on `layout.css`); `rm -rf .next` + restart if the dev server has been up a while. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

On /dashboard-v2 RACES, confirm all four cards render the matchup block: incumbent line with party/tenure/cash folded in and no INCUMBENT badge, plus the right challenger shape — GA `Dooley · M. Collins / R · primary (2)`, ME `Graham Platner† / D · leads · Mills`, FL-23 `no challenger filed / —`, NJ-07 `Bennett / D · nominee`. Confirm the edge accent lands on the favored line (challenger for ME and NJ-07, incumbent for GA and FL-23), exactly one per card. Confirm the market strip names the favorite party-colored (Senate two markets, House Kalshi + POLY n/a), and the presumptive footnote shows once for ME. State whether CASH fit at the live card width or dropped. Confirm `/` is untouched. Build clean, verify:deploy SHA matches.
