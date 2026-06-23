# HO 281 — B1 + B3 header type scale

Type-scale only. Structure, colors, and copy unchanged. From the approved B1+B3 chrome spec.

Scope flag: the masthead and nav are the shared chrome (the unified masthead, HO 185), so this lands on every page's header at desktop, not just /dashboard-v2. Treating that as intended (global refinement). Mobile keeps its own header scaling per the existing mobile cuts; don't touch it.

Locate the masthead/breadcrumb component and the nav component (grep). Apply:

## B1 masthead

- Title / breadcrumb (`Congressional Terminal:\119TH\Dashboard>`): 26px, up from 20. Keep --text-primary with the `:\ \ >` glyphs in --accent-amber and the trailing blink cursor.
- Counts readout (`15,114 bills tracked · 13,805 in committee · ...`): stays 14px. It must NOT scale with the title.
- LAST SYNC line: stays 11px.
- Title and counts stay on one line. Verify 26/14 doesn't wrap at full desktop width (check a realistic narrow desktop too, ~1280px); flag if it wraps.

## B3 nav

- Items: 16px, up from 14, regular weight. Row padding ~14px vertical, ~28px gap between items.
- Active item (`[ \Dashboard ]`): --accent-amber-bright with a 2px underline.
- Inactive items: --text-muted.
- Group dividers (`|`) in --border-strong stay: `[ Dashboard ] | Bills Hearings Members Races Patterns | Reports Watchlist`.
- Single row of eight items at desktop, no wrap.

Resulting hierarchy, top to bottom: title 26 > nav 16 > counts 14 > tapes 11. Eyeball that it reads as intended.

## Constraints

- Desktop scale only. Don't touch mobile header scaling.
- No copy, color, or structure changes. Type size plus the listed nav padding/underline only.

## Ship

Commit the header type scale (named `git add`; masthead and nav together is fine as one logical change). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify the header on /dashboard-v2 and one inner page (e.g. /bills), since it's shared: correct sizes, no wrap at desktop width.
