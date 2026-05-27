# 145 — Committees, Phase 2.5: cross-link into member and bill surfaces

## What this is

HO 143 landed committee data; HO 144 shipped the standalone `/committees` surface. This handoff closes the loops to the two pages where committee context is most missing today:

- `/member/[bioguideId]` — should show which committees the member serves on, with role
- `/bill/[id]` — should show which committees the bill was referred to, with activity context

Pure cross-linking. No new schema, no new pipeline, no new top-level pages. The data already exists; this puts it where readers will look.

## In scope

- Two new query helpers in `lib/queries.ts`:
  - `getMemberCommittees(bioguideId)`
  - `getBillCommittees(billId)`
- Member page addition: a "Committee assignments" section
- Bill detail page addition: a "Committee referrals" section
- `SKILL.md` updates for the two new helpers

## Out of scope

- Activity charts on committee detail pages. Phase 3.
- Topic distribution within committees. Phase 3.
- Hearings, communications, or reports. Phase 3.
- Subcommittee hierarchy expansion (showing "X serves on parent + 2 subcommittees" treated as a unit). Phase 3 polish.
- Changing the committees index or detail pages from HO 144.
- Mobile layout. Per backlog, mobile redesign is a separate consolidated effort.

## Query helpers

In `lib/queries.ts`:

```ts
export type MemberCommitteeRow = {
  systemCode: string;
  name: string;
  chamber: 'house' | 'senate' | 'joint';
  committeeType: string | null;
  parentSystemCode: string | null;
  parentName: string | null;        // joined for display ("X (subcommittee of Y)")
  role: string | null;              // 'Chair' | 'Ranking Member' | null for rank-and-file
  partySide: 'majority' | 'minority' | null;
  rank: number | null;
};

export async function getMemberCommittees(bioguideId: string): Promise<MemberCommitteeRow[]>;
```

Sort: parent committees first (where `parent_system_code IS NULL`), then subcommittees grouped under their parent. Within each group, sort by `committee_type` priority (Standing → Select → Joint → Task Force → other) then by name ASC. Role (Chair/Ranking Member) doesn't change row position — it's metadata on the row.

```ts
export type BillCommitteeRow = {
  systemCode: string;
  name: string;
  chamber: 'house' | 'senate' | 'joint';
  parentSystemCode: string | null;
  parentName: string | null;
  activityType: string;             // 'Referred to', 'Reported by', 'Discharged', etc.
  activityDate: string;             // ISO date
};

export async function getBillCommittees(billId: string): Promise<BillCommitteeRow[]>;
```

Sort: most recent `activity_date` DESC. A single bill can appear in multiple rows if it was referred to → reported by → etc. through one committee, or referred to multiple committees. Don't dedupe — each activity is informationally distinct.

Cache both with `unstable_cache`, tag `'committees'`. Existing committee sync route already revalidates that tag.

## Member page addition

`app/member/[bioguideId]/page.tsx` (or wherever the member hub currently lives — confirm path during implementation).

Add a "Committee Assignments" section. Position: after sponsor/cosponsor stats, before voting record. If the page is currently sectioned with column headers like `SPONSORSHIP` and `VOTING RECORD`, mirror that pattern: `COMMITTEES (<N>)`.

Each row renders:
- Committee name, linkable to `/committee/[systemCode]`
- Chamber + committee type, muted
- For subcommittees: `↳ ` prefix and parent name in muted text (e.g. `↳ Subcommittee on Crime · House Judiciary`)
- Role indicator if present: `CHAIR` or `RANKING` badge, styled to match existing badges
- No member-of-N counter — that's noise here

If `getMemberCommittees()` returns empty, render a single muted line: `No committee assignments on file.` This will fire for retired members or members whose YAML entries don't match a current systemCode.

## Bill detail page addition

`app/bill/[id]/page.tsx` (or wherever it lives).

Add a "Committees" section. Position: after `LATEST ACTION` and stage chrome, before `SUMMARY` or wherever the existing flow puts secondary metadata. If the page has a sidebar pattern, the committees section can live there; otherwise inline.

Each row renders:
- Committee name, linkable to `/committee/[systemCode]`
- Chamber, muted
- Activity caption: `<ACTIVITY_TYPE> · <RELATIVE_DATE>` (e.g. `Referred to · 4mo ago`)
- For subcommittees: same `↳` prefix + parent name treatment as the member page

Empty state: skip the section entirely if `getBillCommittees()` returns empty. Bills without committee referrals do exist (very new introductions, resolutions, etc.), and a "No committee referrals" line on the bill page is noise.

## Acceptance

1. `getMemberCommittees('K000393')` (or any well-known committee chair — e.g. Speaker Mike Johnson's bioguide, or a senior committee chair) returns at least one row with role populated.
2. `getBillCommittees('119-hr-1')` or another well-known bill returns at least one committee referral row.
3. `/member/[bioguideId]` renders the new section without breaking existing layout for at least 3 test members: a committee chair, a rank-and-file member, and a member with no committee assignments (use `/member/[id]` against a retired or freshman member).
4. `/bill/[id]` renders the new section without breaking layout for at least 3 test bills: one with multiple committee referrals (something high-profile in House Judiciary or Energy & Commerce), one with a single referral, one with none (recent introduction).
5. All committee names link to `/committee/[systemCode]` and the links resolve.
6. Subcommittee rows show parent context.
7. Role badges (CHAIR, RANKING) display correctly on member page rows.
8. `npm run build` clean.
9. `SKILL.md` updated with both new helpers.
10. Single commit: `feat: cross-link committees into member and bill pages (HO 145)`.

## Notes

- **Why not bulk-add committee info to the member index list?** The `/members` index shows all members. Listing committee assignments inline per row would be noisy and slow. Members who care about committee context are already clicking through to detail pages. Same reasoning for `/feed` — adding committee chips to every bill row would clutter the feed without proportional value. The cross-link belongs on detail pages, not list pages.
- **Empty-state asymmetry.** Member pages show "No committee assignments on file" because the assumption is every current member has at least one — empty signals data missing or a freshman whose assignments aren't published yet, both worth surfacing. Bill pages skip the section entirely on empty because no-referrals is a normal state for many bills, especially resolutions and brand-new introductions.
- **Subcommittee context.** The `↳` glyph + parent name in muted text is enough to convey hierarchy without dragging in tree UI. Phase 3 may revisit if subcommittee navigation becomes a real need.
- **Role badge styling.** Match whatever badge idiom already exists on member pages (party badge, caucus badges from HO 61). Don't invent new colors; reuse the existing `var(--accent)` or muted-tag pattern.
- **Performance.** Both new queries are small joins with one indexed lookup. No N+1, no aggregation. Trivial.
