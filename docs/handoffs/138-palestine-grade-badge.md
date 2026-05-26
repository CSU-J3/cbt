# 138 — Palestine USCPR grade badge on member hub header

## What this is

Elevates the USCPR Palestine scorecard grade from a section deep on `/members/[bioguideId]` to a glance-level chip in the hub header meta line, next to party and caucus badges. The PALESTINE SCORECARD section from HO 90 stays put; this handoff just surfaces the grade earlier so you don't have to scroll past stats and votes to see it.

Scope is the same as HO 90: Senate Democrats only (~47 members). Everyone else renders nothing — no badge slot, no "ungraded" placeholder.

The badge is hub-only. Not on the `/members` row list, not on BillRow sponsor expansion. Row-list badging would mean 47/535 members get badged and the visual asymmetry reads as data-missing instead of editorial scope. Hub header keeps the badge in a context where you're already studying that member.

## Prior art

- **HO 61** — `CaucusBadge` component + `MemberHeader` meta-line append pattern. This handoff follows that exact chrome.
- **HO 90** — `palestine_scorecard` table, `getPalestineScorecard()` query helper, USCPR attribution language, A–F grade values. All reused.
- **SKILL.md design system** — color tokens (`--text-secondary`, `--accent-amber`, `--party-republican`) and 12px uppercase pill conventions.

## In scope

- New component: `components/PalestineBadge.tsx`
- Grade-to-color tier in `lib/palestine-config.ts` (small file, three thresholds)
- `components/MemberHeader.tsx` — append the badge to the meta line after caucus badges, behind a null check on the scorecard
- `app/members/[bioguideId]/page.tsx` — pass the existing `scorecard` value into `MemberHeader` (or fetch inside the header — Phase 1 picks which)
- Hover tooltip on the badge: `"USCPR Palestine scorecard: <grade> (rank #N of 47)"`
- SKILL.md update under the Member hub section noting the badge surface and its scope constraint

## Out of scope

- Row-list badging (`/members`, BillRow sponsor expansion)
- Restructuring or relocating the existing PALESTINE SCORECARD section on the hub
- Re-running `sync:palestine` or schema changes — data layer is already correct from HO 90
- Wiring the Palestine cron (still deferred from HO 90's open thread; separate handoff if/when)
- House extension — sheet covers Senate only, no data to badge from
- Republican senators or independents — sheet scope is Senate Democrats, badge follows the data
- Animation or transitions on the badge

## Phase 1 — Diagnostic (no commits)

Small read, but worth confirming three things before any code lands.

### Required reads

1. **`components/MemberHeader.tsx`** — current meta-line structure post-HO 61. Where exactly the caucus badges render, what separator pattern (` · `), whether the component already receives affiliations as a prop or fetches internally
2. **`lib/queries.ts`** — confirm `getPalestineScorecard()` signature still matches HO 90's contract (grade as `string`, rank as `number | null`, plus the other fields)
3. **`app/members/[bioguideId]/page.tsx`** — where `getPalestineScorecard()` is currently called and whether the result is already in scope at the point `MemberHeader` mounts. If yes, pass it down as a prop. If no, fetch inside the header (less coupling)

### Confirmations to post

- **Token pick.** Three-tier grade color, recommend:
  - **A/B** → `var(--text-secondary)` — covered, not flagged. Muted on purpose
  - **C** → `var(--accent-amber)` — middle tier
  - **D/F** → `var(--party-republican)` — alarm tier. Flag if visual cross-wire with the party-blue chip on a Dem senator feels confusing in practice; alternative is a dedicated rose token if one already exists in `globals.css` (audit and report)
- **Display.** Recommend `[F]` (single character in brackets) rather than `[GRADE F]` to keep meta-line density tight. Confirm against existing caucus chip widths so the meta line doesn't visually break with a 5+ badge member
- **Position.** Recommend rendering after caucus badges in the meta-line sequence: `● D-VT · BORN 1941 · NEXT ELECTION 2030 · [PROG] [F]`. Caucus badges stay leftmost (more durable membership signal); Palestine grade chips last (advocacy-org evaluation, secondary)
- **Tooltip vocabulary.** Sentence case, no trailing period, matches HO 123 sweep. Recommend `"USCPR Palestine scorecard: F (rank #3 of 47)"` — single line, attribution + grade + rank context

### HALT

End Phase 1 with: existing meta-line structure dump, token pick confirmed, display string confirmed, position confirmed, tooltip confirmed. Wait for sign-off before Phase 2.

## Phase 2 — Implementation (after sign-off)

### `lib/palestine-config.ts`

```ts
export type PalestineGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface PalestineGradeInfo {
  color: string;       // CSS var
  display: string;     // text inside the badge
}

export const PALESTINE_GRADE_CONFIG: Record<PalestineGrade, PalestineGradeInfo> = {
  A: { color: 'var(--text-secondary)', display: 'A' },
  B: { color: 'var(--text-secondary)', display: 'B' },
  C: { color: 'var(--accent-amber)',   display: 'C' },
  D: { color: 'var(--party-republican)', display: 'D' },
  F: { color: 'var(--party-republican)', display: 'F' },
};

export function isPalestineGrade(g: string): g is PalestineGrade {
  return g === 'A' || g === 'B' || g === 'C' || g === 'D' || g === 'F';
}
```

### `components/PalestineBadge.tsx`

Server component. Same visual weight as `CaucusBadge`: 12px uppercase tracked, colored border + text on transparent background.

```tsx
import { PALESTINE_GRADE_CONFIG, PalestineGrade } from '@/lib/palestine-config';

interface Props {
  grade: PalestineGrade;
  rank: number | null;
}

export function PalestineBadge({ grade, rank }: Props) {
  const info = PALESTINE_GRADE_CONFIG[grade];
  const tooltip = rank
    ? `USCPR Palestine scorecard: ${grade} (rank #${rank} of 47)`
    : `USCPR Palestine scorecard: ${grade}`;

  return (
    <span
      className="inline-block px-2 py-0.5 text-[12px] uppercase tracking-[0.5px] tabular-nums"
      style={{
        color: info.color,
        border: `1px solid ${info.color}`,
        borderRadius: '2px',
      }}
      title={tooltip}
    >
      {info.display}
    </span>
  );
}
```

### `components/MemberHeader.tsx` (modify)

Append after caucus badges, behind a null check. If `scorecard` is null (any non-Senate-Dem), render nothing — no slot, no spacing reserved.

```tsx
{scorecard && isPalestineGrade(scorecard.grade) && (
  <>
    {' '}
    <PalestineBadge grade={scorecard.grade} rank={scorecard.rank} />
  </>
)}
```

Phase 1 picks whether `scorecard` arrives as a prop from `page.tsx` or via internal fetch in the header. Either is fine; prop-passing is slightly cheaper if `page.tsx` already calls `getPalestineScorecard`.

### `app/members/[bioguideId]/page.tsx`

If the diagnostic confirms `getPalestineScorecard()` is already called for the bottom section, just pass `scorecard` to `MemberHeader` as a prop. No second fetch.

### SKILL.md update

Under the Member hub section (or wherever HO 61 documented `CaucusBadge`), append a short paragraph noting:

- Palestine grade badge surface (hub header only, Senate Dems only)
- Grade-to-color tier (A/B muted, C amber, D/F red)
- Source attribution belongs in the tooltip, not the visible chip

## Verification

1. `/members/[bioguideId]` for a Senate Democrat with grade F renders the badge in the header meta line in the alarm color
2. Same page for grade A renders the badge in muted color
3. `/members/[bioguideId]` for a Republican senator renders no badge — meta line ends cleanly with caucus or party
4. `/members/[bioguideId]` for a House member renders no badge
5. Hover tooltip shows USCPR attribution + grade + rank
6. The existing PALESTINE SCORECARD section further down the page renders unchanged
7. `/members` row list shows no badge anywhere — no asymmetry between badged and unbadged members
8. BillRow sponsor expansion shows no badge
9. Type-check clean, no console errors

## Acceptance

1. Phase 1 diagnostic posted with the three meta-line / query / page-fetch confirmations and the four picks (token, display, position, tooltip)
2. Sign-off received before Phase 2 commits
3. Phase 2 ships per signed-off spec
4. All 9 verification items pass
5. SKILL.md updated with the badge surface + scope constraint
6. Type-check clean, working tree clean, pushed
7. Commit: `feat(members): USCPR Palestine grade badge on hub header (HO 138)`

## Don't

- Don't add the badge to the `/members` row list, BillRow sponsor expansion, or anywhere else outside the hub header. Scope asymmetry is the reason.
- Don't restructure or move the existing PALESTINE SCORECARD section. This handoff is additive only.
- Don't change `palestine_scorecard` schema, `sync:palestine` script, or any data-layer code. HO 90 settled that.
- Don't fetch the scorecard twice on the same page render. Pass it from `page.tsx` if it's already loaded there.
- Don't badge non-Senate-Dem members "for symmetry" with a "—" or "N/A" chip. Absence of badge is the correct signal.
- Don't introduce a new color token. Three existing tokens cover the tiers.
- Don't depend on the (still-deferred) Palestine cron landing first. The badge reads whatever's in `palestine_scorecard` at request time.

## Notes

- This sits cleanly between Phase 1 of the design-project work and the parked mini-dashboards. No design rounds needed — the badge chrome is already locked by HO 61.
- If Phase 1 finds the existing `MemberHeader.tsx` is densely packed and a 5-badge senator would visually break the meta line, flag in the diagnostic. The meta-line wrap behavior is a known soft constraint and may justify a small layout tweak before Phase 2.
- Cron for `sync:palestine` is still deferred from HO 90's open thread. The badge surfaces stale data until that ships, which is fine for now (USCPR updates infrequently and the sheet is checked-in via manual sync).
