# HO 287 — Chip family normalization

From chip-family.html. Normalize the chip/tag family into one consistent system and add the new source/qualifier tags with their tokens. This is the foundational styling that B2 (source tags) and B6 (id/topic/stage chips) both build on, so it goes before those arcs.

Audit-first: locate the current chip/tag elements (bill-id chips, topic tags, stage pills, party tags; grep) and compare to the spec below. Align what diverges; don't rebuild what already matches.

## Tokens (new)

- `--kalshi: #4DE4B2`, `--poly: #2E5CFF`. Scope them strictly to the source tags and the B2 hover box. Poly-blue sits near --party-democrat, so the mitigation is to always render P next to the turquoise K, never alone in a party context.

## The family (chip-family.html)

Three tiers, one size ladder (11 / 10 / 9px):

- Tier 1 chips: bordered, 2px radius, weight 600. ID chip = solid --accent-amber border, 11px (the row anchor). Topic chip = topic color at 45% alpha border, 10px. Use the real topic hexes from `topic-colors.ts`, not the html's approximations.
- Tier 2 stage pills: bordered, 10px, format `LABEL · age`. Inactive = --text-dim / --border-strong. Current/active stage = its stage color at 50% alpha border.
- Tier 3 text tags: no border. Party = --text-dim (tint optional, off by default). Source = brand-color letter, weight 600, 10px (K = --kalshi, P = --poly). Qualifier micro-tag = --text-dim, bordered, 9px (EOD, MO).

## Net-new in this pass

The tier-3 source tags (K/P) and the micro-tags (EOD/MO) don't exist yet; create them as shared components per the spec. The id/topic/stage chips and party tags likely exist already; align their sizes/borders/alpha to the ladder.

## Scope guard

If aligning the existing chips turns out to be more than a light pass (far from spec, or used in many divergent ways), flag it and stop after the additive part (tokens + the new K/P and micro tags) so B2 still has what it needs. We'll split the existing-chip migration into its own handoff rather than let this one balloon.

## Ship

Commit the tokens + new tags and any existing-chip normalization separately (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify the new tags render per spec and existing chips still read correctly wherever they appear (id/topic/stage are shared, so check a bill row and the feed).
