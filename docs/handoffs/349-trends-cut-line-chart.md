# HO 349 — Trends tab: cut the redundant line chart

> Claim the next free HO number; if 349 is taken, use the next available and
> rename. Independent of the Patterns and Stale work.

On the Trends tab, remove the `TOTAL INTRODUCTIONS OVER TIME` line chart; keep the
two charts below it.

- CUT: `TOTAL INTRODUCTIONS OVER TIME` line. Its monthly total is the sum of the
  bars below it, so it draws the same number twice.
- KEEP (now top): `BILLS INTRODUCED PER MONTH, BY TOPIC` stacked bars.
- KEEP (bottom): `TOPIC MIX · BY CHAMBER` House/Senate split.

If the line chart's component or its query is unused after removal, grep for other
importers; if none, remove them too (print-before-delete). If the query is shared,
leave it.

Constraints: no new data, static, no new tokens. Interactions on the kept charts
unchanged.

**Don't act on (deferred):** a normalized-to-100% mix-over-time chart with the
line brought back for absolute volume. Later, not now.

Ship: `tsc`, confirm the Trends page renders styled (stylesheet 200), named
`git add` only, push, `npm run verify:deploy` until SHA matches.
