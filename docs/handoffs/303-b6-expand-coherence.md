# HO 303 — Dashboard v2 B6 expand: coherence pass against the mock

Confirm the next free number before saving (`ls docs/handoffs/ | sort | tail`). Body assumes 303; rename if taken.

## Scope

`/dashboard-v2` only. Do not change the feed on `/` (`app/page.tsx`). If the v2 expand shares a component with `/`, fork or gate the change to the v2 variant; `/` stays as-is until the swap. Pure presentation, no data or query work.

## Resolved premises (confirmed from the live render, don't re-derive)

- The expanded v2 row already applies the `--bg-row-hover` fill. Only the border is missing.
- The stage-bar track dates currently render MM-DD-YY (`06-18-26`). The meta column on the same card already renders ISO (`2026-06-18`).
- Both expand buttons currently render in the muted gray `.btn` style; FULL BILL PAGE is not accented.

## Changes

### 1. Amber frame on the expanded row (the headline fix)

The expanded row reads as a flat panel section because the amber border was dropped. The mock's expanded-row rule:

```
background: var(--bg-row-hover);   /* already applied */
border: 1px solid var(--accent-amber);
border-radius: 2px;
margin: -1px 0;
position: relative;
z-index: 1;
```

Add everything except the background. The parts that matter:

- Use the muted amber (the mock's `--accent-amber`, `#d97706`), not the bright `--accent-amber-bright` (`#fbbf24`). Bright amber is reserved for the active-tab underline and the primary-button text. Match the live token by name if it exists, by value if the name differs.
- `margin:-1px 0` pulls the amber border over the neighboring rows' `--border-soft` bottom borders, so the frame is a single clean line, not a doubled edge.
- `position:relative; z-index:1` makes the amber border paint above the sibling row borders.
- Make sure the expanded rule's full `border` overrides the collapsed row's `border-bottom`, so the bottom edge isn't doubled.

### 2. Stage-bar dates to ISO

Switch the track date labels from MM-DD-YY to ISO `YYYY-MM-DD`, matching the meta INTRODUCED field on the same card. Reuse whatever formatter the meta column already uses rather than adding a second one.

### 3. FULL BILL PAGE as the amber primary

Per the mock's primary-button rule: `color: var(--accent-amber-bright); border-color: var(--accent-amber);`, and append a ` →` to the label. CONGRESS.GOV keeps the muted gray `.btn` and its `↗`. Only FULL BILL PAGE gets the accent.

### 4. Truncated-title hover (verify first, add only if missing)

The mock ellipsizes long titles and reveals the full title on hover. The live collapsed rows already ellipsize (HR 9359 truncates). Grep the v2 row's title element: if a native `title` attr or a Tooltip already carries the full title on truncation, leave it. If there's no hover reveal, add the full title via a native `title` attr (the HO 123 idiom), don't build a new popover. This is the one item that may be a no-op; confirm before touching.

## Out of scope (my defaults on the two open audit questions)

- ODDS sub-block in the expand: not building it. A clean prediction market exists for only a handful of bills, so the block would sit empty almost always, and odds already live on the B2 tape and the race cards.
- Typography: staying all-mono. The mock sets title / summary / news in `--sans`; live stays mono per the house convention. Do not introduce a sans face.

Corey: flip either of these in one line if you want them in. Everything else above is confirmed gap, not preference.

Also leave alone: the collapsed-row right-side metric (`CMTE · 2d` vs the mock's `FROM → TO` arrow) is data-driven, keep it. The two topic tags per row are correct, don't collapse to one.

## Constraints

- Mono-only UI, no new typeface. Tokens only, no new CSS vars.
- Named `git add` per commit, eyeball the diff. Stale `.next`: verify the stylesheet loads (no 404 on `layout.css`); `rm -rf .next` and restart if the dev server has been up a while. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

On `/dashboard-v2`, confirm: the expanded row carries the amber frame as a single clean line with no doubled border against its neighbors; the stage-bar dates read ISO and match the meta INTRODUCED on the same card; FULL BILL PAGE is amber with a `→` while CONGRESS.GOV stays gray. State whether the title hover was already wired or you added it. Confirm `/`'s feed is unchanged. Build clean, verify:deploy SHA matches.
