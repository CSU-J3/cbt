# HO 321 — Collapsed dashboard feed row → two-line (relocate chips, add sponsor line)

Confirm the next free number before saving: `ls docs/handoffs/ | sort -V | tail`. Body assumes 321.

Restructure the `V2FeedList` collapsed rowhead (shared across MOVERS / TOP STALLS / NEW THIS WEEK) from one line to two, matching `/bills`. This is the Mock A collapsed-row change that didn't land earlier — the chip unify (316) and the shared expand (317) took over and the sponsor-line restructure was never picked back up. The row is one line today (SKILL §"Dashboard v2 feed rows": ID chip · sans title · `TopicChips` after the title · metric · caret).

**The spec's data blocker is already cleared — do not add query work.** The spec says to add sponsor fields to the feed query. HO 300 already did: per SKILL §"Data dependency (HO 300)", `getStageChanges` / `getStaleBills` / `getNewBillsThisWeek` carry the full `SPONSOR_ENRICH_SELECT`/`JOIN` (`last_name`, `first_name`, `district`, `cosponsor_count`, plus the base `sponsor_party` / `sponsor_state`) for the expand's sponsor card. So the `FeedBill` item the collapsed row receives already carries the three fields line 2 needs. **Verify they're on the item, then render — no query change.** This is pure presentation.

`/bills` (`BillRow`) already has this exact two-line main-column structure (title over sponsor-line-with-chips). Mirror it; "match /bills" is literal.

## Grid

Four columns, `align-items: start` (so metric + caret sit at line-1 height, not centered across both lines):

`[ ID chip ] [ main (1fr) ] [ metric (auto) ] [ caret (auto) ]`

`main` holds two stacked lines:
- line 1: title
- line 2: sponsor + bracket + topic chips

Line 2 aligns under the **title** (left edge of `main`). The ID-chip column stays empty on line 2 — do not indent line 2 under the ID chip.

## Line 1

Title only: `--sans`, `--text-primary`, single-line ellipsis, full `main` width. **Remove the topic chips from here** (they move to line 2). The full-title popover-when-truncated stays.

## Line 2 (new)

Single line, `overflow: hidden`, ~5–6px below line 1. In order:
- Sponsor `LASTNAME`: uppercase, mono, `--text-muted`, subtle underline, links to the member page. **Reuse the exact link mechanism the expand's sponsor card (`SponsorHoverName`) already uses** so the collapsed-row link and the expand link resolve identically — don't invent a route.
- Party-state bracket `[D-NV]`: party-colored (`--party-democrat` / `--party-republican` / `--party-independent`), mono. From `sponsor_party` + `sponsor_state`.
- One middot `·` separator in `--text-dim`.
- Topic chips: **the same shared `TopicChips`, relocated from line 1 unchanged.** Chips adjacent, no middot between them.

## Topic overflow — reuse, don't rebuild

The spec asks for fit-to-width + dim `+N`. Use the shipped `TopicChips` overflow as-is: the subline is `overflow: hidden`, the chip's responsive path gives first + `+N` on mobile, desktop shows all. **Measured desktop fit-to-width was deliberately not built (the 316 decision — bills carry ≤3 topics, so a measuring island wasn't worth it), and isn't built here either.** A long sponsor + 3 chips on desktop will clip rather than show a `+N`. If you want true measured desktop fit-to-width, that's a separate follow-up — flag it, don't fold it in.

## Unchanged

ID chip, metric (`STAGE · age`, e.g. `CMTE · 6h`, the per-tab swap), caret ▾. Row vertical padding stays the same; the content is just taller.

## Constraints

- Pure presentation — no feed-query change (the data's already there). Confirm the three fields on the `FeedBill` item, then render.
- Reuse the shared `TopicChips` and the expand's sponsor-link mechanism; don't rebuild either.
- No new CSS variables; reuse tokens + `lib/topic-colors`.
- Named `git add`, eyeball the diff. Stale `.next`: stylesheet loads (no 404 on `layout.css`), `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship: `git push`, then `npm run verify:deploy` until served SHA === HEAD.

## Ship report

- The dashboard MOVERS / TOP STALLS / NEW THIS WEEK rows are two lines: title full-width on line 1, sponsor + `[party-state]` + bordered chips on line 2, chips gone from line 1.
- Confirm the sponsor renders real data (name a bill — e.g. a `HORSFORD [D-NV]`) — proving the HO 300 enrichment carried, not a placeholder.
- The sponsor link resolves to the same member page as the expand's sponsor card.
- Confirm no feed-query change was needed.
- Build clean; verify:deploy SHA matches.
