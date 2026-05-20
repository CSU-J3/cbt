# Handoff 89 — Rename /sponsors to /members

## What this is

Mechanical rename. `/sponsors` → `/members`, `/sponsors/[bioguideId]` → `/members/[bioguideId]`. Nav label, header chrome, and internal references updated throughout. Old URLs redirect to new ones so existing links don't break.

## Step 1 — Audit all references

Before touching anything, find every place `sponsors` appears as a route or label:

```
grep -r "sponsors" app/ components/ lib/ --include="*.ts" --include="*.tsx" -l
grep -r "sponsor" app/ components/ lib/ --include="*.ts" --include="*.tsx" -l
```

List the files before making any changes. This rename touches more places than it looks.

## Step 2 — Move routes

```
app/sponsors/page.tsx           → app/members/page.tsx
app/sponsors/[bioguideId]/      → app/members/[bioguideId]/
```

Create the new directories and move files. Don't delete the old ones yet — Step 3 adds redirects first.

## Step 3 — Add redirects

In `next.config.ts` (or `next.config.js`), add permanent redirects:

```ts
async redirects() {
  return [
    {
      source: '/sponsors',
      destination: '/members',
      permanent: true,
    },
    {
      source: '/sponsors/:bioguideId',
      destination: '/members/:bioguideId',
      permanent: true,
    },
  ]
}
```

After redirects are in place, delete `app/sponsors/` entirely.

## Step 4 — Update nav

In `components/HeaderBar.tsx` (or wherever nav links are defined), change:
- Link href: `/sponsors` → `/members`
- Link label: `SPONSORS` → `MEMBERS`

## Step 5 — Update internal hrefs and references

Search for every hardcoded `/sponsors` href and update:

- `BillRow` expanded panel — "View sponsor" or similar link
- `SponsorRow` or equivalent — any self-referencing hrefs
- `/?sponsor=` filter links — these stay as `sponsor` query param (it's a filter key, not a route)
- Any `basePath="/sponsors"` props → `basePath="/members"`

Also update string labels:
- `SPONSOR PRODUCTIVITY` header → `MEMBER PRODUCTIVITY`
- `BILLS AT DESK` and similar don't need changes
- Any `sponsor` in page `<title>` or metadata

## Step 6 — Update lib references

In `lib/queries.ts`, function names like `getSponsors`, `getSponsorCount`, `getSponsorRecentBills` — **do not rename these**. They're internal function names tied to the data model (bills have a `sponsor_name` column). Renaming query functions is churn with no user-facing benefit.

Same for DB column names (`sponsor_name`, `sponsor_party`, etc.) — leave them alone.

## Step 7 — Update SKILL.md

In `SKILL.md`, update the pages section:
- `/sponsors` → `/members`
- `/sponsors/[bioguideId]` → `/members/[bioguideId]`

## Step 8 — Verify

```powershell
npm run build
```

Build must pass with zero errors. Then:

1. `http://localhost:3000/members` loads the member list
2. `http://localhost:3000/members/[any bioguideId]` loads a member hub
3. `http://localhost:3000/sponsors` redirects to `/members` (301)
4. `http://localhost:3000/sponsors/B001288` redirects to `/members/B001288` (301)
5. Nav shows `MEMBERS` not `SPONSORS`
6. No broken internal links — check the bill feed expanded panel and the `/members` row expand

## Acceptance criteria

1. All routes moved and working
2. Old `/sponsors` URLs redirect permanently
3. Nav label updated
4. Build passes, no TypeScript errors
5. No hardcoded `/sponsors` hrefs remaining (grep to confirm)
6. Internal query function names and DB column names unchanged
