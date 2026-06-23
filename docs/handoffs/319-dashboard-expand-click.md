# HO 319 — Dashboard expand: drop hover, both surfaces click

Confirm the next free number before saving: `ls docs/handoffs/ | sort -V | tail`. Body assumes 319. Independent of 318 (run in either order).

The dashboard hover-to-expand isn't working in practice: it's transient, you can't read the open panel (related news included) before it collapses, and it's dead on touch. Drop the hover model entirely. Both surfaces expand on **click**, via the same shared single-open pattern /bills already uses. The shared `BillExpandPanel` is unchanged — only the trigger and mount change.

This is a simplification, not new surface: it removes the nested-hover mount, the lazy-load-on-first-hover, the grow-inline-on-hover, and the `:focus-within` path, and it retires the banked touch-expand follow-up (click works on tap).

## Changes

- **Dashboard (`V2FeedList`):** replace the `:hover` / `:focus-within` trigger with the same click single-open mechanism `BillRowList` uses (`useSingleOpenPanel`). Match /bills' approach so the two surfaces share the interaction, not just the panel — adopt its mount (sibling below the row) rather than keeping the nested-in-row hover mount, unless nesting is cleaner with the shared component, in which case keep nested but trigger on click. Your call on the mount; the requirement is click-to-open, single-open, stable.
- **Drop the hover-specific bits:** load the panel data on expand (click), not on hover; the box grows on click now (deliberate, same as /bills); remove the `:focus-within` reveal.
- **Caret:** still rotates / goes amber on expand, now on click.
- Single-open both surfaces, both via the React click-state pattern (not URL state).

## Verify related news (this is the real question behind the gripe)

In the click-open panel, confirm **RELATED NEWS renders real items**, not just the `NO RELATED NEWS` empty state. Pick a bill that actually has `news_mentions` (`getNewsForBill` returns rows) and confirm they show. Report which case it is:
- Renders for a news-having bill, empty for others → wired correctly, the gripe was hover-transience (fixed by this revert). The sparseness is data coverage, not a bug — that's the banked news-linkage arc, leave it.
- Doesn't render even for a news-having bill → a real wiring gap in the shared panel; fix it here.

## Constraints

- Shared `BillExpandPanel` / `BillStageBar` unchanged — trigger and mount only.
- Named `git add`, eyeball the diff. Stale `.next`: stylesheet loads (no 404 on `layout.css`), `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship: `git push`, then `npm run verify:deploy` until served SHA === HEAD.

## Ship report

- Dashboard expands on **click**, single-open, panel reads stably (no collapse-on-move).
- RELATED NEWS: which case (renders for a news-having bill — name it — or a wiring gap you fixed).
- Confirm touch-expand now works (tap opens on the dashboard), and note the touch-expand backlog item can be un-banked.
- Build clean; verify:deploy SHA matches.
