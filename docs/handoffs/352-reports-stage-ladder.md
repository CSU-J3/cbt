# HO 352 — Reports: stage-movements ladder

> Claim the next free HO number; if 352 is taken in `docs/handoffs/`, use the next
> available and rename this file. Independent of the content probe (HO 353) and the
> Filler Watch / Stale work.

Replace the per-transition row list in `## Stage movements (N)` with a stage
ladder: one rung per destination stage the week's transitions reached.

## What's wrong now

The section renders one row per transition. A typical week is N committee
referrals, so it's N near-identical rows —
`HR 9359 — ? → ▸ COMMITTEE (Rep. Meng, Grace [D-NY-6], D-NY)` — and the
LLM lead above already states the whole thing ("All 22 transitions were committee
referrals; nothing advanced"). The list adds no signal over that sentence. Two
data tells make it worse: `? →` is a null from-stage (a fresh intro has no prior
stage), and `[D-NY-6], D-NY` doubles party + state since the bracket already
encodes both.

## Confirm both edit locations before touching anything (per HO 242)

The shape lives in two coupled places. Change one without the other and the
commentary maps to the wrong structure.

- **Assembly:** section order and per-row format are baked into `content_md` by
  `assembleMarkdown` in `lib/report-generation.ts`, not in the page. The ladder is
  built here.
- **Prompt:** the per-section lead is LLM-generated against the prose-generation
  prompt's section template. The stage-movements guidance there must change in the
  same commit so the lead describes the new shape.

Grep both, confirm the function name and the prompt section still match HO 242
before editing.

## The ladder

Bucket the week's transitions by **destination stage** — the stage each bill
landed in this week. One rung per stage in canonical order: committee, floor,
other-chamber, president, enacted.

Each rung:

- Glyph `▸` in the stage's color (`--stage-*`), label in the same color. Standard
  triangle only, no new glyphs.
- A sqrt-scaled bar, the same treatment as the dashboard stage-distribution bars.
  Reuse that component, don't reimplement it.
- Count right-aligned, `tabular-nums`, `--text-primary`.
- **Zero-count rungs stay, dimmed** (`--text-dim`, a `·` where the bar would be).
  The flat rungs above a tall committee bar are the "nothing advanced" signal —
  render the full ladder, not just the populated rungs.

Routine vs advances:

- The **committee** rung is routine referrals. Count only, no per-bill list.
- Any rung **past committee** (floor, other-chamber, president, enacted) names its
  bills on a sub-line: `└ HR 1421 Veterans Care Access Act`, bill ID in
  `--accent-amber`, title in `--text-secondary`. Advances are few; list them all.
  Cap at ~8 with `+N more` only if a week ever runs long.

## Data cleanups (do these regardless)

- **Kill the `? →` null from-stage.** Grouping by destination sidesteps from→to
  rendering entirely; make sure no literal `?` leaks into a rung label or into the
  prose.
- **Drop the doubled party/state.** Routine referrals show no sponsor at all.
  Advance sub-lines show bill ID + title, no sponsor (the sponsor lives on the
  bill's own row elsewhere). If a sponsor ever does appear, single party-state
  only, never the district-plus-party-state double.

## Markdown / download parity — count-only ships

Reports download as `.md`, so the section reads in two renders. **Decision of
record: no per-bill referral list in either.** The committee rung is count-only.
The design mock's `[ show all 22 ]` expand is dropped — `<details>` doesn't
survive markdown, and listing every referral reintroduces the firehose into the
downloaded file. The full referral list already lives on the Bills page filtered
to the week; link there from the section if a path is wanted.

Bars are a web flourish. In `.md` a rung degrades to `▸ → COMMITTEE   22` (glyph +
label + count). Content is identical web vs file; only the bar differs. That's
acceptable.

If the referral list must be preserved, the only parity-safe options are (a) a
web-only `<details>` with the `.md` omitting it, or (b) a linked Bills-page view.
**Flag here before building if (a) or (b) is wanted; otherwise count-only ships.**

## Constraints

- No new tokens. Reuse `--stage-*` and the existing dashboard bar treatment.
- Static. No motion.
- The header `(N)` stays the total transition count, unchanged.

## Ship

- A quiet week renders lead + ladder with one populated rung and dimmed zeros; a
  week with advances names the advanced bills on their rungs.
- No `?` and no doubled party/state anywhere in the section or its prose.
- Web and downloaded `.md` carry identical content.
- One clean commit. Named `git add` only, `git push`, then `npm run verify:deploy`
  until the served SHA matches HEAD.
