# HO 301 — B2 update probe: re-check the data walls

Re-probe before the B2 roster update. 288 found RTX/NOC/GD 402-gated and no clean debt-ceiling market; the new mock shows both, so this re-checks whether anything changed, plus confirms the September Fed-cut market. Diagnosis only.

Probe from the deployment egress (FMP/Kalshi behavior is egress- and tier-specific), not locally.

## 1. Defense trio — FMP /stable/quote

Re-probe RTX, NOC, GD on `/stable/quote` from prod egress. 288 had all three 402 ("not available under your current subscription") on the free tier. Confirm whether they still 402, or whether the FMP tier has changed and they now return price + change. If they 402, they stay blocked (only LMT builds).

## 2. Debt ceiling — Kalshi + Polymarket

288 found Kalshi's only debt-ceiling market was KXDCEILEND-26 ("will it be abolished", a novelty) and no Polymarket market. The mock shows DEBT CEILING at K 12% / P n/a, implying a Kalshi X-date/breach market exists. Re-probe both venues for a debt-ceiling breach / X-date market: does one exist now, what's the identifier, and is it single- or dual-source? Report what's actually there.

## 3. Fed cut September — Kalshi + Polymarket

The current ODDS strip has the July Fed-cut market wired. Confirm a September Fed-cut market exists on Kalshi (and Polymarket) the same way, with identifiers, so it can be wired alongside July.

## Output

Per item: fetchable / identifier / single-or-dual-source, or still-blocked. That tells us which roster additions the build can wire. Don't change anything; the build follows.

## Ship

Read-only probe. Reuse or extend the `scripts/diagnostic/tape-source-probe-288.ts` pattern. No deploy change to verify.
