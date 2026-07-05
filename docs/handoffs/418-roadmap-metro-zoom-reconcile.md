# HO 418 — Roadmap reconcile: strike the stale metro-zoom "Banked / unbuilt" entry

> Self-claim the next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 418. If HEAD moved past 417, renumber.
>
> **Docs-only.** One file: `docs/roadmap.md`. No code, no schema, no `SKILL.md` edit. `git add docs/roadmap.md` only — explicit pathspec, ancestry re-checked immediately before push against current HEAD, one docs commit. No `verify:deploy` (docs don't touch runtime). Show me the diff before committing — no auto-commit.

## Gate — confirm the drift is still live (reconcile in place, report present-vs-applied)

The finding: the roadmap `## Status` block's **"Banked / unbuilt:"** line still lists `metro-zoom panels (spec-3 Phase 2)` as unbuilt, but it **shipped at HO 236/237** and is tombstoned in `backlog.md` DONE. That un-pruned entry has been feeding a stale "next feature = metro-zoom" pointer across session wraps. Before editing, confirm the drift hasn't already been fixed:

- `grep -n "metro-zoom\|Metro-zoom\|236/237\|spec-3 Phase 2" docs/roadmap.md docs/backlog.md` — confirm both: (a) `backlog.md` DONE carries the **shipped** tombstone ("**Metro-zoom panels + leader lines** (HO 236/237) … Shipped; live CA eyeball was the closeout"), and (b) `docs/roadmap.md` still has the entry **un-struck** on the Banked/unbuilt line.
- If the roadmap entry is **already struck** (a prior sweep beat this one), STOP and report no-op — don't double-log.
- Also grep for any **other** roadmap occurrence that frames metro-zoom as future/next (a theme paragraph, the sequencing list, prose). If one exists, reconcile it in the same edit. If the grep shows the Banked/unbuilt line is the only occurrence, say so explicitly.

## What's true (grounding — don't re-derive)

- Metro-zoom panels + leader lines **shipped HO 236/237** (dense-state CA/TX metro insets, `getStateDistrictGeometry` subset render, leader lines, `overviewBox`). Tombstoned in `backlog.md` DONE, which also notes "*(Was the 'spec-3 Phase 2' banked item.)*" — so 236/237 **is** spec-3 Phase 2; there's no separate unbuilt Phase 2.
- They're **live on `/electoral`** — the HO 333 consolidation preserved the `onStatePick`→`RaceDistrictModal` path the metro panels ride (the HO 333 OPEN LOOP confirms "Metro-zoom dense-state click-target (HO 236/237) is UNAFFECTED").
- The only genuinely-unbuilt metro work is **extending the per-state config past CA/TX** to other dense states. That's a fresh scoped item, not the banked one — do not resurrect it as "banked," and don't write a handoff for it here.

## The edit

On the `## Status` block's **"Banked / unbuilt:"** line, strike the metro-zoom entry following the block's own shipped-out-of-banked convention (mirror the already-struck `race→news / member→news surface` entry a few items over on the same line):

Replace:

`… · metro-zoom panels (spec-3 Phase 2) · …`

with:

`… · ~~metro-zoom panels (spec-3 Phase 2)~~ (**SHIPPED HO 236/237** — dense-state CA/TX metro insets + leader lines; see backlog DONE. Extending the per-state config to more dense states is a fresh scoped item, not this banked one.) · …`

Change only this token — keep the surrounding ` · `-separated items and their order intact.

## Provenance note (follow the block's Also-note convention)

The `## Status` block logs its own changes and carries a running "Also notes now run through HO NNN" tail. Add a compact housekeeping note and move the pointer so the block's audit trail records when the correction landed:

- Append a new Also paragraph:

  `**Also (HO 418), housekeeping — no theme-% change.** Struck the stale metro-zoom panels (spec-3 Phase 2) entry from the Banked/unbuilt line: it shipped at HO 236/237 (backlog DONE) but the banked entry was never pruned, which had been feeding a stale "next feature = metro-zoom" pointer across session wraps. No feature shipped, no bar moved. **Also notes now run through HO 418.**`

- Update the prior "**Also notes now run through HO 416**" tail so **418** is the single current pointer — don't leave two tails.

No theme `%`, no bar, and no overall figure change — this is a correction, not a ship.

## Commit discipline

One docs-only commit: `git add docs/roadmap.md`. Ancestry re-checked immediately before push against current HEAD (a concurrent session may have committed since the gate). Reconcile in place, not append-a-duplicate. No `verify:deploy`. Show me the diff before committing.

## Report back

Whether the gate found the entry already-struck (no-op) or live (applied), the grep result for any other metro-zoom occurrence in `roadmap.md`, and the diff.
