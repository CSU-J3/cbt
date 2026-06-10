# HO 222 — /races LIST view redesign

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. If something landed past 221 since the diagnostic, renumber this file to match. The body assumes 222.

## What this is

Redesign the **LIST toggle** of `/races` from a 5-column rating matrix into a consensus-led, toss-ups-first row list. Design was resolved in the CBT Design chat; this is the build.

**Scope fence:** LIST toggle only. The MAP toggle, the HO 219 chamber-control hero band, CartogramShell, and the existing `/races` filters are **untouched**. Everything here rides data that already ships — no new pipelines, no new columns, no cron. Signals that can't be populated degrade to a neutral state; never fake a value.

---

## Phase 1 — VERIFY BEFORE BUILDING (do not skip)

The planning chat is working from a stale `/mnt/project` copy (its SKILL.md predates the entire races system). Every premise below is asserted from a frozen design spec, not live code. **Grep the live repo and confirm each before writing any UI.** Resolve all four CHECKs here, in plan mode, and report findings before Phase 2.

**Premises to confirm against live code (`lib/queries.ts`, the `/races` LIST component, schema):**

1. The LIST view's data source. Spec assumes it consumes `getRacesIndex` (the 137-seat INNER JOIN on `race_ratings`), producing a `RaceIndexRow`-shaped object per row. Confirm the actual query and row type the LIST renders. **Do NOT confuse `getRacesIndex` (137, INNER JOIN) with `getMostCompetitiveRaces` (61, `ABS(score)≤1`)** — they are different shapes and swapping them broke HO 210. Confirm which one feeds LIST.
2. `rating_score` is signed: `+` = R, `−` = D, `0` = Toss Up, `±3` = Solid. Confirm the consensus score field name and that per-rater scores (Cook / Sabato / Inside) are individually projected on the row (the spread bar needs all three).
3. The breaking-news join from HO 69/118 — confirm how a race resolves to its mapped-news count (last 7 days) and that LIST can reach it without a new query.
4. The HO 148 click-to-expand row pattern — confirm the component/hook name and that it's reusable here.
5. Kalshi favored-party per seat (HO 218) — confirm the field on the row and that `race_candidates` emptiness (~133/137) means the divergence flag must null-safe omit when no favored party resolves.

**CHECK 1 — OPEN-seat tag.** Does the row shape the LIST consumes project `incumbent_bioguide_id` (or a derived `isOpen` / the HO 221 `incumbent_running` flag) — not just inside the JOIN, but on the row the component reads? A null incumbent (or `incumbent_running = 0`) = open seat → render an `OPEN` tag in place of the incumbent name. **Confirm this general-election open-seat flag is NOT entangled with the primaries `'open'` party-enum** (e.g. `house-LA-01-2026-open` is an open *primary*, a different thing). If HO 221 already renders an OPEN treatment on the map card, reuse that exact derivation — do not invent a second one.

**CHECK 2 — cash-thin threshold.** `member_fundraising.cash_on_hand` exists (~128/137 rows per the handoff — confirm live). "Thin" is a product call, so produce the evidence: pull the cash-on-hand distribution across toss-up + lean rows, **House and Senate separately**, and look for a natural gap. If there's a clear gap, set the amber threshold there and report the number + the distribution you saw. If there's no natural break, **ship cash as plain `--text-secondary` everywhere with no amber** — do not invent a cutoff. Report which way you went and why.

**CHECK 3 — challenger cash is out of scope.** The fundraising table is bioguide-keyed; challengers have no bioguide → challenger cash cannot exist. Do not derive or estimate it. Incumbent cash only. (Stated so Code doesn't try to fill the gap.)

**Also confirm:**
- **Margin delta is House-only.** `margin_2024` exists for House seats; Senate seats last ran in 2020 → Senate rows show `— senate` in the margin slot. House seats missing the field show `— no data`. Never blank-imply zero. Confirm the field name and that Senate rows lack it.
- **Rating history is empty** until HO 220 accrues weeks of logs. **Do not build any "moved since" enrichment in this HO** — the summary readout uses *divergence* (live day-one), not movement.

**HALT after Phase 1** with: the LIST data source + row type, all per-rater + consensus + Kalshi + cash + margin + open-seat fields confirmed present-or-absent, and the CHECK 2 distribution + threshold decision. If any premise is wrong (e.g. LIST doesn't use `getRacesIndex`, or per-rater scores aren't on the row), say so and propose the smallest query change rather than building on a wrong shape.

---

## Phase 2 — build

### New row structure

Replace the matrix with a consensus-led row, **sorted toss-ups first** (by `ABS(consensus_score)` ascending, then a stable secondary sort — confirm the existing sort so toss-ups surface):

```
│▌ ● 2   CA-22   David G. Valadao [R]   [TOSS UP]   ▕███▏  ◆   2024 R+0.2   $2.9M
```

Left to right:

- **Severity rail** — a 3px left-edge bar per row. `--accent-amber-bright` for toss-up, `--accent-amber` for lean, `--text-dim` for likely/solid. Lets the eye find competitive rows without reading text.
- **News flag** — `● N` in `--accent-amber` when the race has mapped news (count = headlines last 7 days, from the HO 69/118 join). Dims to `--border-strong` `● 0` when none.
- **Seat ID** — monospace, `--text-muted` (`CA-22`).
- **Candidate + party** — incumbent name, `[R]` / `[D]` party-colored tag. **Open seat (CHECK 1) → `OPEN` tag in place of the name.**
- **Consensus chip** — the lead signal: `TOSS UP` / `LEAN D` / `LIKELY R` etc., chip-styled (1px border in the rating color, palette below). Per-rater detail moves to the expand.
- **Spread bar** — 3-segment bar, fixed order **Cook · Sabato · Inside**, each segment colored by *that rater's own rating* (chip palette). ~60px wide. Three matching segments = consensus; an outlier segment = a rater dissents. **Missing rater = that segment is `--bg-base`** (empty slot) so a half-rated seat reads as partial, not as data.
- **Divergence flag** — `◆` in `--accent-amber` when Kalshi's favored party disagrees with the rater-consensus *direction* (consensus sign vs Kalshi favorite). Omitted when they agree or when no favored party resolves (null-safe — `race_candidates` empty for most seats). Free off HO 218 data; the diagnostic (`scripts/diagnostic/divergence-count.ts`) already computes this comparison — reuse its logic, don't re-derive.
- **Margin delta** — `2024 R+0.2`, House-only. `--accent-amber` when the seat moved toward competitive vs prior margin; `--text-secondary` otherwise. Senate → `— senate`; House missing field → `— no data`.
- **Incumbent cash** — cash-on-hand, `--text-secondary`. `--accent-amber` only per the CHECK 2 decision (if a threshold was set). Incumbent only.

### Summary readout (above the rows)

One line replacing the old column-header noise:

```
137 · 31 toss-up · 44 lean · 62 likely/solid · ◆ 9 markets disagree with raters
```

Counts are a free reduce over the consensus scores on the rows. The `◆ N` count = rows where the divergence flag fires (same predicate as the inline `◆`). This **replaces** any "moved this week" readout — rating-history only started at HO 220, so movement is empty for weeks. Divergence is live day-one. Use the real numbers Phase 1 produces, not the example values above.

### Expand (click a row) — reuse HO 148

On expand, show:
- **Per-rater detail** — the three ratings spelled out (`Cook: TOSS UP · Sabato: TOSS UP · Inside: LEAN R`), since the inline bar only encodes them by color.
- **NEWS MAPPED TO THIS RACE** — the HO 69/118 breaking-news block (source · headline · age), or "No mapped news this week."
- **Kalshi line** — market implied % and direction (HO 218).
- Link to the race hub `/race/[id]`.

### State-filtered LIST

If a state filter is active, show that state's breaking strip (same HO 69/118 block) at the top of the list, so a single-state view leads with its news.

---

## Palette — existing tokens only, no new ones

Chip / spread-segment colors by rating:
- TOSS UP → `--sev-toss` (`--accent-amber-bright`)
- LEAN D / TILT D → `--party-democrat`; LEAN R / TILT R → `--party-republican`
- LIKELY D → `#93c5fd` (border `#1e3a8a`); LIKELY R → `#fca5a5` (border `#7f1d1d`)
- SOLID/SAFE D → `#1e3a8a`; SOLID/SAFE R → `#7f1d1d`
- empty rater slot → `--bg-base`

Confirm these tokens resolve in the live stylesheet. Monospace for seat IDs, chips, counts, margin, cash. **No motion.**

---

## Constraints

- Desktop-first. Mobile <700 deferred (consistent with other surfaces) — don't build it, don't break the existing fallback.
- MAP toggle, hero band, and filters unchanged.
- Single-file row component. Reuse the HO 148 expand and HO 69/118 news block; don't build new versions.
- No new color tokens, no new pipeline, no new cron, no schema change.

## Ship verification (UI render is not proven by tsc + HTTP 200)

A drifted `.next` serves a stale CSS hash → 404 on the stylesheet asset → unstyled page that still returns 200. After building:
1. `rm -rf .next` + one fresh `npm run dev`.
2. Load `/races`, LIST toggle. **Confirm the stylesheet asset loads (no 404 on `layout.css`).**
3. Eyeball at the pixel: toss-ups sorted first, severity rail colors, a half-rated seat showing an empty spread segment (not faked), at least one `◆` divergence row, an `OPEN` seat rendering the tag (Montana/Kentucky retirements from HO 221 are known opens), and the summary readout counts matching the rows.
4. DB/query changes aren't visible until the races tag revalidates if you touched the query layer (`POST /api/revalidate?tag=races`).

Report the Phase-1 findings (especially CHECK 2's distribution + threshold call) and a screenshot-grade description of the rendered LIST.

---

read docs/handoffs/222-races-list-redesign.md and follow
