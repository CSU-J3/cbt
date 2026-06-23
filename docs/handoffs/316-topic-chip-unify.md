# HO 316 — Unify the topic chip (one shared bordered component)

Confirm the next free number before saving: `ls docs/handoffs/ | sort -V | tail`. Body assumes 316.

The 315 shared-chip check came back **duplicated and divergent**. The bordered chip the dashboard shows is a module-private function, not a shared component, and /bills still renders a separate borderless one. 315 shipped the dashboard sponsor line but never extracted the chip or migrated /bills, so the two surfaces only *look* converged on the screenshot. This finishes it: one exported bordered chip, both surfaces import it. This also closes the topic-chip leg of the backlog's chip-family migration gap.

## Resolved premises (from Code's own grep — don't re-discover, build against these)

- **Bordered chip = private `TopicChips` fn** in `components/V2FeedList.tsx:77`. Emits `className="v2f-topic"` with an inline `color-mix(in srgb, <color> 45%, transparent)` border; topic-color text; bespoke `.topic-pop` hover span (`CODE · Full name`). Rendered at `V2FeedList.tsx:562`. Pulls `topicColor` / `topicLabel` / `topicFullLabel` from `@/lib/topic-colors`. Not exported. Repo-wide, this `v2f-topic` bordered treatment exists only here.
- **/bills uses a different renderer.** `BillRow.tsx:10` imports `TopicTags` from `@/components/TopicTags`, rendered at `BillRow.tsx:131` with the `responsive` prop. `TopicTags` is **borderless** 14px topic-color text wrapped in the shared `Tooltip variant="term"` (dotted underline + hover panel). No border.

The synthesis: keep V2FeedList's **border**, keep TopicTags's **proper use of the shared Tooltip primitive**. Drop V2FeedList's bespoke `.topic-pop` and TopicTags's borderless render.

## Build

- **Extract one exported bordered chip** (e.g. `components/TopicChips.tsx`, exporting the list wrapper). Lift the `v2f-topic` styling **exactly** as it ships today — Corey approved that look on the screenshot, this is a consolidation, not a redesign. Don't re-pick the border alpha or size.
- **Tooltip via the shared primitive.** Wrap each chip in the shared `Tooltip` for the `CODE · Full name` panel, but **without** the `term` dotted-underline trigger styling — the chip border is the affordance, a dotted underline under a bordered box is wrong. If the primitive has no underline-free variant, use/add a plain one. Retire the bespoke `.topic-pop`.
- **One overflow path.** Carry 315's fit-to-width `+N` into the shared chip and reconcile it with TopicTags's existing `responsive` (first + `+N` on mobile) behavior, so there's a single overflow implementation, not two. If neither current renderer actually does fit-to-width `+N`, build it once here — that's the payoff of unifying.
- **Point both sites at it.** `V2FeedList.tsx:562` → imported chip (delete the private `TopicChips` fn). `BillRow.tsx:131` → imported chip (drop the borderless `TopicTags` render). Every `BillRow` consumer (`/`, `/stale`, `/president`, `/changes`, `/watchlist`) inherits the bordered chip automatically.

## Decide by report, don't guess

Who else imports `TopicTags`? Grep it.
- If `BillRow` was the only consumer → delete `TopicTags.tsx` (cleanup, own commit).
- If other surfaces import it → list them in the ship report and leave them for now. Don't expand scope to migrate them in this pass unless the swap is trivial and identical.

## Constraints

- No redesign — lift the live `v2f-topic` styling into the shared chip unchanged.
- No new CSS variables. Topic colors stay sourced from `@/lib/topic-colors`.
- Named `git add` per commit, eyeball each diff. Suggested order: (1) shared chip extracted + primitive tooltip + single overflow path, (2) `V2FeedList` points at it (private fn removed), (3) `BillRow` points at it (borderless render removed), (4) `TopicTags` deleted if orphaned.
- Stale `.next`: verify the stylesheet loads (no 404 on `layout.css`); `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship: `git push`, then `npm run verify:deploy` until the served SHA === HEAD.

## Ship report

- Show both import lines — `V2FeedList` and `BillRow` — resolving to the **same** module path.
- Dashboard chips unchanged visually (still the `v2f-topic` look). /bills chips now bordered and matching the dashboard.
- Tooltip fires via the shared primitive on both surfaces; no dotted underline under the bordered chip; bespoke `.topic-pop` gone.
- State whether `TopicTags.tsx` was deleted or name who still imports it.
- Confirm this closes the topic-chip leg of the chip-family migration (so the backlog entry can be updated).
- Build clean; verify:deploy SHA matches.
