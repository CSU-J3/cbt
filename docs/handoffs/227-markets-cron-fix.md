# HO 227 — markets cron failure: diagnose + fix (Stooq 404, stale tape)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 227.

## What this is

The markets tape on the dashboard is **stale on a trading day** — `/api/cron/markets` 404s on Stooq equity endpoints (SPX, NDQ reported) every tick, latest data 2026-06-05, but the route finalizes `success` so it slipped past `cron_runs` and 30-min log retention unnoticed for days. This is the "STALE tape" flagged across every screenshot this session, now diagnosed as a live broken cron, not market-hours-closed.

**Two-part fix, and the second part is why it went unnoticed:**
1. **Re-source the failing quotes** — Stooq changed/broke the equity paths; find the current working path or fall back to FRED (designed in as the fallback since HO 142).
2. **Make the route surface fetch-failure honestly** — it currently reports `success` with the failures buried in `error_message`. A tick where the equity symbols all 404 is `failed` or `degraded`, not `success`. Fix the status logic so the next breakage shows up in `cron_runs` instead of hiding.

This is a third-party-endpoint fix, so it is **probe-gated** (the OpenSecrets/FMP discipline): diagnose *why* Stooq 404s against the live endpoint before swapping anything. Don't assume the cause.

## Phase 1 — diagnose live (HALT-gated, no fix yet)

Read the live state and probe the actual failing endpoint. Report before changing anything.

**1A — read the live route + symbol set.**
- Find `/api/cron/markets` (route) + the Stooq fetch helper (HO 142 put the symbol map in the route; HO 172 evolved it). Print the **current** symbol map — the live set has drifted (HO 142 had `^spx ^tnx cl.f ^dxy ^vix`; HO 172 listed `SPX WTI ITA XLK XLV GOLD` on Stooq + `TNX VIX` on FRED; the cron error names SPX **and NDQ**, and NDQ isn't in the HO 172 list — so confirm what's actually fetched today).
- Print the exact fetch URL the code builds (HO 142 documented `https://stooq.com/q/l/?s=<stooq>&f=sd2t2ohlcv&h&e=csv`). Confirm it's still that shape.
- Read how the route decides its `cron_runs` status (where `success` is set, where `error_message` is appended) — locate the exact spot the fix in Phase 2 part 2 changes.

**1B — probe the failing endpoint directly.** For each currently-fetched Stooq symbol, hit the live URL the code builds (curl/fetch the actual `stooq.com/q/l/?s=...&e=csv`) and report the raw response per symbol:
- Which symbols 200 with a data row vs 404 vs return an empty/garbage CSV.
- For a 404 symbol, probe the cause: is it the **symbol convention** (try `^spx` vs `spx` vs `^spx.us` — Stooq has changed index prefixes before; HO 142 already warned DXY resolves under multiple aliases), the **path** (did `/q/l/` move), or an **IP/rate block** (does the same URL work from a different IP / does it 404 consistently or intermittently)? Distinguish these — the fix differs for each.
- Check the working symbols (WTI/GOLD/sector ETFs if they still 200) to confirm it's equity-index-specific, not a total Stooq outage.

**1C — confirm the FRED fallback is viable for the dead symbols.** HO 142 designed FRED as the Stooq-down fallback (1:1 map, `^TNX → DGS10`, VIX `→ VIXCLS`). For the equity indices that are 404ing (SPX, NDQ): does FRED carry them? (FRED has `SP500` for the S&P 500; NASDAQ via `NASDAQCOM`.) **Caveat the design already knows:** FRED is **end-of-day only** (HO 172) — so a FRED fallback for SPX means the tape shows yesterday's close intraday, not 15-min-delayed. That's a degradation from Stooq's intraday, but a *correct stale-labeled* value beats a 404. Report whether FRED can cover the dead symbols and flag the intraday→EOD downgrade so the fix is a conscious choice.

**HALT after Phase 1** with: the live symbol set + fetch URL, the per-symbol probe result (which 404 and *why* — convention/path/block), whether a corrected Stooq symbol resolves (e.g. if `^spx`→`spx.us` works), the FRED-fallback viability for the dead symbols, and the exact route location where `success` is wrongly set. **Recommend the fix path** (corrected Stooq symbol vs FRED fallback vs both) but don't build it — I'll confirm the source choice, since intraday-vs-EOD is a product call.

## Phase 2 — fix (after sign-off on the source path)

**Part 1 — re-source the quotes** (per the Phase-1 recommendation, my confirmed path):
- If it's a symbol-convention change: update the symbol map to the working Stooq symbols, keep the intraday source.
- If Stooq dropped the indices entirely: fall back to FRED for those symbols (EOD, stale-labeled in the UI — the tape already has a stale state from HO 149/172; confirm it labels EOD-sourced symbols honestly rather than showing them as fresh).
- Either way: the per-symbol fallback HO 142 specced ("if a symbol returns no data, log it and fall back; don't crash the whole tick") should mean one dead symbol doesn't blank the strip — confirm that per-symbol resilience still holds after the change.

**Part 2 — failure honesty in the route** (the fix that matters most long-term):
- Change the `cron_runs` status logic so a tick where the equity fetches fail is recorded as `failed` (or a `degraded` status if the schema supports it and partial success is meaningful) — NOT `success` with the failure in `error_message`. The rule: if the tick didn't get the data it exists to fetch, it didn't succeed.
- Keep `error_message` populated with the per-symbol detail (it's useful), but the **status** must reflect reality so the next Stooq move shows up in a `cron_runs` query within the 30-min retention window instead of rotting for days.
- Don't over-correct: a genuinely partial tick (4 of 6 symbols fetched, market just opened) shouldn't hard-fail if the design intent is best-effort — use your judgment on `failed` vs `degraded` and report which you chose and why.

## Verification

- Run the cron route locally (or trigger the GitHub Action) and confirm: the previously-404 symbols now return data (or a labeled-stale FRED value), `market_ticks` gets a fresh row dated today, and the tape renders current numbers.
- **Confirm the failure-honesty fix works**: temporarily force a fetch failure (bad symbol) and confirm the route records `failed`/`degraded` in `cron_runs`, not `success`. Revert the forced failure.
- The tape on the dashboard shows today's date in the `AS OF` stamp, not 2026-06-05.
- Any FRED-sourced (EOD) symbol is labeled stale/EOD honestly, not shown as fresh intraday.
- `tsc` clean. Confirm the GitHub Actions markets workflow schedule is intact (HO 172 set the intraday cadence — don't break it).

Commit as HO 227. Update the backlog: the 🔴 markets-cron entry moves from open-bug to fixed (note the resolution — corrected symbol or FRED fallback, and the failure-honesty change). SKILL: note the markets source if it changed (Stooq symbol convention or FRED fallback for indices) and the cron-status-honesty fix.

## Constraints

Probe before swapping (don't assume the 404 cause). Don't change the tape UI (HO 149/172/202 own it) beyond confirming its stale-labeling is honest. Don't touch the FRED EOD symbols (TNX/VIX) that already work. The GitHub Actions schedule stays as HO 172 set it.

---

read docs/handoffs/227-markets-cron-fix.md and follow
