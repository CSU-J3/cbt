# HO 257 — Dashboard v2: movers feed to match the mock (rows + rich expand)

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 257. Builds on 253 (shell) and 254 (battlefield).

## What this is, and the miss it fixes

The v2 right-column feed currently reuses the existing `ActivityTabs` row and `BillExpandedPanel` as-is. That was my call in HO 253, on the assumption that HO 249's expand-parity meant the feed was done by reuse. That was wrong: parity (all three tabs share one expand) isn't the same as matching the mock, and the mock specifies a redesigned movers box, a different collapsed row and a much richer expanded panel, that was never built. This handoff builds the v2 feed presentation to match the mock's MOVERS box.

Source of truth: `docs/design/dashboard-2col.html`, the MOVERS box (now correctly placed after 254). Match it. The spec below is the data wiring the mock can't encode; where the mock and this doc differ on visuals, the mock wins.

**v2-specific.** Do not change the feed on `/` (`app/page.tsx`). Parametrize the components for a v2 variant or fork them, Code's call based on what's cleaner; `/` stays as-is until the eventual swap.

## Collapsed row (match the mock)

- **Boxed bill-id badge** inline on the left (`[HR 9171]`, `[S 162]`), not the current stacked plain number.
- Full bill title.
- Right-aligned: the **abbreviated last stage transition** `FROM → TO · {ago}` (e.g. `CMTE → FLOOR · 4h`), plus the expand caret. Drop the verbose `INTRODUCED · 13MO → FLOOR · 1D` pills and the inline sponsor/topic line, both of which move into the expand.
- Stage abbreviations: INTRO / CMTE / FLOOR / OTHER / PRES / ENACTED. Compact time-ago.

## Expanded panel (match the mock, two columns)

Left column:
- **Topic tags** (e.g. GOV TECH CONS) and the **stage-progress track** shown in the mock (connected dots across intro → committee → floor → other → president → enacted, filled through the bill's current stage, current one highlighted). Derived from the bill's stage + topic tags.
- The bill's **Gemini summary** (prose).
- **RELATED NEWS:** the bill's `news_mentions` (bill-keyed, the linkage we do have), each as `SOURCE · {ago}` + headline. **Conditional** — omit the whole section when the bill has no mentions (mentions are sparse).

Right sidebar:
- **SPONSOR** (name + party + state/district — the bill's sponsor, a plain bill field), **COMMITTEE**, **INTRODUCED** (date), **LATEST ACTION** (text · {ago}).
- Buttons: **FULL BILL PAGE** (internal bill route) and **CONGRESS.GOV** (external link built from the bill id).

## Shared across the three tabs

MOVERS / TOP STALLS / NEW THIS WEEK share the row + expand (as they do now per HO 249). Build the shared v2 row + expand to the mock; the **expand is identical across tabs** (same bill detail). The collapsed row's right-side indicator keeps each tab's existing semantic: movers show the transition, top stalls show stuck duration, new-this-week shows introduced. Match the movers box as shown in the mock and carry the shared chrome to the other two; don't force a `FROM → TO` transition onto a stall or new row where it doesn't fit.

## Constraints

- v2-specific; `/`'s feed untouched.
- **No data work.** Every field exists: summary, topics, stage, sponsor, committee, introduced date, latest action, and the bill-keyed news. RELATED NEWS is the only conditional element (sparse).
- The mock is the visual source of truth; this doc owns the data wiring and the conditional/degrade rules.
- Desktop. Mono for labels / ids / counts; UPPERCASE section labels.
- Named `git add` per commit, eyeball the diff. Stale `.next` rule: verify the stylesheet loads (no 404 on `layout.css`); `rm -rf .next` + restart if the dev server's been up a while. `npm run build` clean.
- Ship per the live-verify rule: `git push`, then `npm run verify:deploy` until the served SHA matches HEAD.

## Ship report

Confirm v2 movers rows match the mock (boxed bill-id badge, abbreviated last transition, caret) and the expand shows topic tags + stage-progress track, the summary, RELATED NEWS (present when the bill has mentions, omitted otherwise), and the right sidebar with sponsor / committee / introduced / latest action plus both buttons. Confirm `/`'s feed is unchanged. State one bill where RELATED NEWS rendered and one where it correctly omitted. Build clean; verify:deploy SHA matches.
