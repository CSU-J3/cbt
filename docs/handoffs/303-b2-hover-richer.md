# HO 303 — B2 hover: richer box

Confirmed: build the richer hover from the mock (b2-tape-labels.html, the `#tip` box). It restructures the current hover into name + sector / note / figure / freshness, changes the name to amber-bright, and keeps numbers white.

## Layout

Four parts, top to bottom:
- Name + sector: the item name in amber-bright (--accent-amber-bright, the yellowish), with a small dim sector label beside it (the `.tip-sec`, 9px uppercase --text-dim).
- Note: the policy hook, --text-muted, omitted when the item has none (several do).
- Figure: for markets, the value in white (--text-primary) followed by the change in up/down color with ▲/▼. For odds, "K [val] P [val]" with K/P letters brand-colored (--kalshi/--poly) and the numbers white. CPI/UNEMP show the value alone (no change).
- Freshness meta: a dim bottom line (--text-dim, 10px, top border) showing the item's real freshness, NOT the mock's uniform "EOD". Derive it: FRED-daily (10Y/WTI) → "EOD · [time]"; FRED-monthly (CPI/UNEMP) → "FRED · monthly · released [date]"; intraday equities/indices → the as-of time, no EOD label; odds → "Live · prediction market".

## Colors (the "check colors again" pass)

- Name: amber-bright (yellowish). This is the change from the mock, whose tip-name is white.
- Numbers (figure values): white (--text-primary).
- Change: up/down colors. K/P letters: brand colors. Sector / note / meta: dim/muted.
- While here, confirm the tape itself follows the same convention (item code amber-bright, value white) so the hover and tape read consistently.

## Per-item sector + note

The sector is a curated per-item descriptor, like the hooks. Restructure the hook data (lib/policy-hooks.ts) to carry both a sector and an optional note per item, drafted from the mock below (Corey edits). Keep it one editable place.

- SPX → sector "US large-cap index"
- NDQ → "US tech-heavy index"
- 10Y → "US sovereign rate", note "Moves on Fed path and fiscal supply"
- WTI → "Energy · $/bbl"
- NVDA → "Semiconductors", note "Exposed to chip export controls"
- AAPL → "Consumer tech", note "Antitrust and tariff exposure"
- MSFT → "Software / cloud", note "Federal cloud and AI policy"
- GOOGL → "Search / ads", note "Active antitrust litigation"
- LMT → "Defense prime", note "Tracks NDAA appropriations"
- CPI → "Inflation · YoY"
- UNEMP → "Labor · U-3"
- SHUTDOWN → "Prediction market", note "Funding lapse if no CR passes"
- FED CUT JUL → "Prediction market"
- FED CUT SEP → "Prediction market"
- RECESSION → "Prediction market", note "NBER-defined"

Items with no note show no note line.

## Notes

- Keep the box's current positioning behavior (the over-the-ticker anchor from 294); this slice changes content and color, not placement.

## Ship

Commit (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify: hover a market (amber-bright name, dim sector beside it, white value + colored change, real freshness line) and an odds item (K/P brand letters, white numbers, "Live · prediction market"). Confirm the tape's code/value colors match.
