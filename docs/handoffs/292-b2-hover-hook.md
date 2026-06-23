# HO 292 — B2 tape: hover-box policy hook

Last B2 pass. The tape hover box already shows the item name + as-of date (the 147 popover, dropping below from 286). This adds the spec's policy hook: one curated line per item giving the Congress/policy angle. Static for now; wiring it to live bill/topic data is banked (see end).

## What to add

A short policy-hook line in the existing hover box, below the name/date, dim secondary styling. Driven by a per-item map keyed to the roster's identifiers (symbol for equities/indices, market id for the odds items). Draft copy below — Corey will edit, so keep it in one obvious editable place (a single map/const, not scattered).

Draft hooks:
- SPX → Broad market; moves on fiscal and tax policy
- NDQ → Tech-heavy index; sensitive to antitrust and trade
- NVDA → AI chips; exposed to export controls
- AAPL → Hardware and services; trade and antitrust exposure
- MSFT → Cloud and AI; federal contracts and antitrust
- GOOGL → Search and ads; antitrust scrutiny
- LMT → Defense prime; tracks the appropriations cycle
- 10Y → Benchmark yield; the government's borrowing cost
- WTI → Crude; energy policy and the strategic reserve
- CPI → Inflation; drives the Fed's rate path
- UNEMP → Labor market; the Fed's other mandate
- SHUTDOWN → Odds of a funding lapse before the appropriations deadline
- FED CUT → Odds the Fed cuts at its next meeting
- RECESSION → Odds of a recession this year; backdrop for fiscal fights

Match these to whatever the roster keys actually are. If a roster item has no hook entry, the box omits the line (don't render an empty slot).

## Notes

- Box behavior (drop-below, in-viewport, no clip) is already correct from 286; don't change positioning.
- This is the tape hover only; don't touch other tooltips.
- Keep the box compact: name, as-of date, hook line. Value/change/source already read on the tape inline.

## Backlog

Log under BANKED: the policy hook should later link into CBT's own bill/topic data (hover or click reaching the relevant bills), part of the news-linkage arc. Static curated copy is the interim.

## Ship

Commit (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify the hover box shows the hook line under the name/date on a few items across both strips, still drops below without clipping.
