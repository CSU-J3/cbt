# HO 259 — Dashboard v2: Polymarket macro on the SIGNALS strip (wire + paired render)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 259. Builds on HO 253 (two-tape) and HO 256 (Polymarket seat-odds infra). Composes with HO 258 (marquee scroll), a different aspect of the same strip, no conflict.

## What this is

Wire Polymarket's two macro markets (fed decision, government shutdown) and render the v2 SIGNALS strip as paired dual-source items, per Design's decision. The mock now has the paired treatment, so match it.

## Source of truth

- **Visual:** `docs/design/dashboard-2col.html`, the SIGNALS tape (`tapeOddsHTML`). It renders the paired treatment exactly: `SHUTDOWN K 49% P 51%`, `FED CUT JUL K 40% P 32%`, then bare `CPI 3.1%` / `UNEMP 4.0%`, with the dim `.src` source tags (K / P) and the green LIVE dot. **Letters on the tape** — the cards use diamonds; don't carry diamonds here.
- **Behavior** (N/A, hover, fed caveat): Design's spec, encoded below.

v2-specific: don't change `/`'s tape.

## Data guards (the load-bearing part — verify, don't assume)

Design's note said "both Poly macro markets exist, so no slot is N/A today." The HO 255 probe says otherwise for shutdown. Verify both at wire time:

- **Fed (real, deep, pairs):** Polymarket's fed market is the deepest on the platform, but it must answer the SAME question as Kalshi. Kalshi `KXFEDDECISION` is **cut-sum** = P(any cut) at the decision. Polymarket's fed market may be multi-outcome (cut 25 / cut 50 / hold / hike), so **sum its cut outcomes** to match Kalshi's P(any cut), for the **same meeting** (the mock label is `FED CUT JUL` = next FOMC decision). Pair them on that. As meetings roll, keep both K and P on the same upcoming meeting; the label reflects it.
- **Shutdown (likely N/A today):** Kalshi `KXGOVTSHUTDOWN` = P(government shutdown by the funding deadline). The probe found Polymarket's same-question market (`government-shutdown-by-october-1`) was a **$38 ghost**, and its only liquid shutdown-adjacent market asks a **different** question. So: check the current Polymarket shutdown markets and pair the P slot ONLY if a market is both liquid (above the ghost threshold) AND the same question as Kalshi. If the only comparable market is still a ghost, the shutdown **P slot is N/A** (per Design's fallback). Do NOT pair Kalshi's shutdown against the ghost or against a different-question market. Expect P N/A on shutdown today.

## Wire

- Extend `lib/polymarket.ts` (parallel to the seat-odds fetch from 256): a `fetchPolymarketMacro()` for fed + shutdown that parses the relevant nested market, applies the same ghost threshold, and normalizes fed to the next-meeting P(any cut).
- Store as market ticks (e.g. `POLY-FEDCUT`, `POLY-SHUTDOWN`) alongside the Kalshi macro ticks.
- Ride the existing cron the Kalshi macro/odds run on. Non-fatal: a Polymarket failure leaves prior values in place and never breaks the Kalshi write (same pattern as 256).

## Render (match the mock)

- SIGNALS strip, order unchanged: market odds first (SHUTDOWN, FED CUT), econ after (CPI, UNEMP), then the LIVE indicator.
- Dual-source items (SHUTDOWN, FED CUT) render paired: `LABEL [K] x% [P] y%`, with the dim K/P tags per `.src`.
- Single-source items (CPI, UNEMP) render bare, no source tag.
- **N/A per slot** (Design): a missing / stale / ghost source shows dim `N/A` in its slot and the pair stays intact — `SHUTDOWN K 49% P N/A`. Don't collapse a designated dual-source item to bare, or it reads as single-source. Reuse the existing dim N/A style (the same one the cards use for Kalshi N/A); no new style.
- **Hover** (Design): reuse the tape's existing item hover; show full source names, each value, and the resolve date, e.g. "Kalshi 49% · Polymarket N/A · resolves Oct 1, 2026."
- Keep the green LIVE dot and no-close behavior.

## Not here

The card POLYMARKET-cell N/A treatment (Senate dim N/A; House no cell at all) is the cards handoff (c), not this one. Banked.

## Constraints

- v2-specific; `/`'s tape untouched. Additive to the markets pipeline, parallel to Kalshi and the 256 fetch.
- The mock is the visual source of truth; this doc owns the data guards and the N/A / hover behavior.
- Named `git add` per commit, eyeball the diff. Stale `.next` rule: verify `layout.css` loads (no 404); `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

Lead with the shutdown verdict: is there a liquid, same-question Polymarket shutdown market, or is the P slot N/A today? State the fed pairing: which meeting both K and P quote, and confirm both are P(any cut) (Polymarket's cut outcomes summed to match Kalshi's cut-sum). Then confirm the SIGNALS strip renders paired K/P for the dual-source items with dim tags, bare CPI/UNEMP, per-slot N/A where a source is missing, the hover with source names + resolve date, and the LIVE dot. Confirm `/`'s tape is unchanged. Build clean; verify:deploy SHA matches.
