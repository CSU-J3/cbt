# HO 348 — Filler Watch strip (Patterns tab)

> Claim the next free HO number; if 348 is taken, use the next available and
> rename. Run this after the Patterns meta-line and ranked-bars handoffs — the
> placement references the rebuilt layout.

A collapsible `CEREMONIAL · NON-BINDING` strip on the Patterns tab, placed between
the meta line and the blurb, above the bars.

**Denominator: the four ceremonial patterns only** — awareness-designation (624)
+ honoring-resolution (349) + facility-naming (128) + sense-of-congress (124) =
1,225. CRA disapproval (196) is EXCLUDED (real tool, not filler).

**Numbers (real, from the Filler Watch diagnostic HO 344):** 1,225 filed · 165
past committee (13.5%) · 1 enacted (facility-naming, a post office) · sponsors
727 D / 495 R / 3 IND = 59% / 41% · 1,060 died in committee (86.5%). Compute these
live by reusing the HO 344 union query so they track syncs; the figures here are
the current expected values to sanity-check against.

**Collapsed (resting, one line):**

```
CEREMONIAL · NON-BINDING   1,225 FILED · 1 ENACTED (a post office) · 165 PAST COMMITTEE · 13.5% · SPONSORS 59% D / 41% R
```

- `1,225 FILED` and `1 ENACTED` at `--text-primary` (the punch); committee and
  sponsors at `--text-muted` (texture).
- Sponsors as percentage only when collapsed; raw counts live in the expanded
  state.

**Expanded (click the label row to toggle; `--accent-amber` frame,
`--bg-row-hover` fill, matching the expanded-bill-panel treatment):**

- Attrition row: `1,225 FILED → 165 PAST COMMITTEE (13.5%) → 1 ENACTED (a post
  office)`. Numbers stay at body weight, not enlarged — the expansion adds rows,
  not volume, and must not shout.
- Register line: "Sense-of-Congress, awareness designations, and honoring
  resolutions are non-binding by nature, 1,097 of the 1,225. Only facility namings
  can become law, and one did. The other ~86% never clear committee."
- Footer: `SPONSORS 727 D · 495 R · 3 IND   SPLIT 59% D / 41% R   DIED IN
  COMMITTEE 1,060 · 86.5%`.

**Interaction.** Click the label row to toggle collapsed ↔ expanded. Instant, no
animation, consistent with the app's click-to-expand rows.

Constraints: all-mono, no new tokens. Low weight, factual, not a hero. Framing is
"non-binding," not "stalled," so the figure survives a poke at the denominator
(1,097 of the 1,225 cannot become law by nature).

This is a distinct component from the dashboard weekly bar (different data,
different layout). Not a shared module.

**Don't act on (deferred):** always-expanded vs click-to-open — build
click-to-open. Amber frame vs hairline — build the amber frame.

Ship: `tsc`, confirm the Patterns page renders styled (stylesheet 200), named
`git add` only, push, `npm run verify:deploy` until SHA matches.
