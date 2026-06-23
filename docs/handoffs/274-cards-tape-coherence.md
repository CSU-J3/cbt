# HO 274 — Race cards + tape coherence

Remaining items from the `/dashboard-v2` coherence review. One race-card fix, one battlefield check, two markets-tape items. All on the shipped v2 surface, no layout change. Commit each separately.

## Premise

Symptoms are from a live capture. The cards, battlefield, and tape are the realized HO 254 / 260 / 258 surfaces; this is correctness polish on them. Grep to locate the race card cell rendering and the tape data code before editing; don't take file names from this doc.

---

## Change 1 — consistent race-card odds labels (main fix)

On the competitive cards the Kalshi and Polymarket odds use mismatched label types. GA reads `D 84% / D 85%` (party / party), ME reads `Platner 56% / D 64%` (candidate vs party on the same card), NJ reads `Bennett 75%` (candidate). The paired display exists so the two venues can be compared at a glance, and a candidate label beside a party label kills that.

Rule: normalize both venues to party lean on the competitive cards. Render `[PARTY] [pct]%` colored by the existing party colors. Resolve a candidate-named Kalshi market to the candidate's party via the race roster / candidate data (the rosters seeded earlier; confirm the candidate-to-party lookup exists). ME then reads `KALSHI D 56% · POLYMARKET D 64%`, directly comparable.

Rules:
- Fallback: if a candidate can't be resolved to a party, keep the candidate name rather than dropping the row. Never print a number with no label.
- Polymarket absent (House seats it doesn't cover): collapse to the Kalshi value cleanly. No empty Polymarket column, no dangling `POLYMARKET` label with no value.
- Scope: competitive (general-election) cards only. Do not party-normalize primaries; multiple same-party candidates make party ambiguous there.

Tradeoff being accepted: a candidate-specific Kalshi market shown as party is slightly less precise than the candidate name, but it makes the K/P pair comparable and the cards uniform, and the headline candidate plus party dot above already names who. (If Corey would rather keep candidate names where the market names one, the alternative is annotating those with party color and a (D)/(R) tag instead of converting. Default is convert-to-party; flag back if unsure.)

---

## Check 2 — battlefield marker color vs card dot

Card candidate dots are colored by the headline candidate's party (Moskowitz blue/D, Collins red/R). Confirm what the battlefield track markers encode.

Target: marker color = the party currently holding the seat (incumbent), matching the card dot; marker position = lean score (toward the favored party). ME-SEN then shows a red marker (Collins, R, holds it) positioned toward the D side (D-favored), reading as "R-held seat leaning D" and matching its card. If markers are currently colored by lean/favored party instead (ME would show blue), switch color to incumbent/holder party. If they already match the cards, note it and skip.

---

## Change 3 — pin the tape labels

The MARKETS and SIGNALS labels should stay fixed on the left while the ticks scroll; the mock pins them. A live capture led with a bare `4.49%`, meaning the label is scrolling off inside the marquee. Pull the label out of the scrolling element so it's always visible. Only the ticks marquee.

---

## Change 4 — WTI value reads wrong

The tape showed WTI 84.65 with -10.89%. Both look off: an 11% daily move on oil is implausible and the level is high for the current market.

Check the WTI flow in the tape data code first. If the change% is a bad computation (absolute change used as percent, or a wrong prior close) or the symbol is pulling the wrong contract / a stale value, fix the mapping. Only if the local computation looks right, probe FMP `/stable/quote` for the WTI symbol from the deployment egress (not locally, per the source rule) to see the actual returned value and reconcile.

Add a defensive guard while you're in there: a daily move beyond roughly ±8% on a major index or commodity is almost certainly bad data; suppress or flag it rather than printing it.

---

## Ship

Commit each item separately (named `git add`, eyeball first). `git push`, `npm run verify:deploy`, confirm served SHA equals HEAD before reporting shipped. Live-verify the cards, battlefield, and tape.
