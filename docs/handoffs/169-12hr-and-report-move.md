# HO 169 — 12-hour timestamps everywhere + weekly report above breaking

Two small, independent changes. No Phase 1 — both are known-location edits. If anything diverges from the premises below, halt and report instead of guessing.

## Change 1 — All timestamps to 12-hour

Per SKILL.md, `formatLastUpdated(iso)` in `lib/format.ts` renders `HH:MM MT` (24-hour, America/Denver). Switch all displayed times to 12-hour with AM/PM.

- **`formatLastUpdated`** → 12-hour: e.g. `2:47 PM MT` instead of `14:47 MT`. Keep the MT (America/Denver) zone and the `MT` suffix.
- **The markets tape `AS OF … UTC` timestamp.** The tape shows `AS OF 15:33 UTC · STALE`. Make this 12-hour too: `AS OF 3:33 PM UTC · STALE`. Find where the tape renders its "as of" time (likely `MarketsTapeClient.tsx` or a format helper it calls) and switch to 12-hour. Keep the UTC zone label.
- **Sweep for other time renders.** Grep for any other place that formats a clock time for display (the `· LAST SYNC HH:MM MT` masthead line uses `formatLastUpdated`, so it flips automatically — confirm). If any component formats time inline rather than through `formatLastUpdated`, switch those to 12-hour too. Report what you find.
- Date-only formats (`formatDateShort` MM-DD-YY, `formatDateLong` YYYY-MM-DD) are **not** times — leave them. This change is clock times only.
- No date-fns/dayjs (SKILL constraint) — use the same Intl/manual approach already in `lib/format.ts`, just 12-hour.

## Change 2 — Weekly report above breaking news

Current dashboard order (the `/` entry, post-HO-159): BREAKING strip → ReportSnapshot (weekly report) → CompetitiveRacesBlock → `.home-grid`.

**New order:** ReportSnapshot (weekly report) → BREAKING strip → CompetitiveRacesBlock → `.home-grid`.

Just swap the weekly-report snapshot band **above** the BREAKING strip in `app/page.tsx`. Both are full-width bands already; this is a reorder, not a restyle.

- Don't change either component's internals — `BreakingNewsBlock` and `ReportSnapshot` render the same, just in swapped order.
- Confirm the border caps / spacing still read cleanly with the order flipped (the BREAKING strip's borders were sized assuming it's first — check it still looks right when ReportSnapshot is above it; adjust spacing only if visibly broken, and report if so).
- The HO 159 note in SKILL says ReportSnapshot sits in the `.home-snapshot-slot` directly under BREAKING — after this it's directly *above* BREAKING. Keep the slot, move its position in the JSX.

## Verification

- Show the diff.
- Confirm `formatLastUpdated` and the tape "as of" both render 12-hour with AM/PM (give a before/after example string for each).
- Confirm no remaining 24-hour clock render anywhere (report the grep result).
- Confirm the dashboard order is now report → breaking → races → grid, rendering cleanly.
- Type check passes.

## Out of scope

- No markets-tape ticker/marquee changes (HO 168).
- No change to date-only formats.
- No SKILL.md edit here — but note: after this ships, the HO 159 "ReportSnapshot directly under BREAKING" line and the `formatLastUpdated` "HH:MM" line in SKILL.md will both be stale. Flag for the next doc touch (don't fix SKILL in this handoff).
