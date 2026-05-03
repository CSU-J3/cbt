# CBT — Step 3 Handoff Prompt (Next.js Feed Page)

Step 3: build the Next.js feed page for CBT.

Read `.claude/skills/cbt/SKILL.md` first — frontend conventions and page list are spelled out there.

This step builds the home feed only. Bill detail pages and the watchlist come in step 4.

## Build

1. Initialize the Next.js 15 app inside the existing project. App Router, TypeScript, Tailwind. Don't create a sub-directory — the Next.js app shares the repo with the existing `lib/` and `scripts/` directories. Adjust `tsconfig.json` and folder structure as needed so the existing `lib/db.ts` is reachable from server components.

2. Home page at `/`:
   - Server component that queries Turso directly via `lib/db.ts`
   - Lists the 50 most recently updated bills (order by `update_date DESC`)
   - Each row shows: bill ID (e.g. "HR 2702"), title, sponsor name + party, latest action date, stage as a colored pill, topic tags as small chips, and the LLM summary
   - Click on a bill ID or title → links to `https://www.congress.gov/bill/119th-congress/{bill_type_full}/{bill_number}` for now (we'll build the internal detail page in step 4)

3. Filter UI at the top of the feed:
   - Topic filter: multi-select chips for the topic enum, `?topics=foo,bar` in the URL
   - Stage filter: single-select dropdown, `?stage=committee` in the URL
   - "Clear filters" link when any are active
   - Filters are server-side via search params, no client state

4. Styling: clean, dense, readable. Think Hacker News meets a govtech tool — not flashy. Tailwind only, no shadcn or other libraries. Build small primitives in `components/`.

5. `npm run dev` should start it at localhost:3000 and show real data from Turso.

Don't build the bill detail page (`/bill/[id]`), watchlist, or the API route for sync yet. Get the feed solid first.

When done, take a screenshot of the running feed and show me, then I'll review before moving to step 4.
