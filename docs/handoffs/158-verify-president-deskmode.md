# 158 — Verify `/president` desk-time + oldest-first (synthetic seed, rolled back)

## What this is

The `/president` page's desk-time rendering and oldest-first sort have never been seen with real data — the corpus currently has **zero** `stage='president'` bills (the dashboard stage-distribution confirms PRESIDENT = 0). So the code path that renders the desk-time column and the `latest_action_date ASC` sort is unverified, not because it's untested logic but because no data has ever exercised it.

This handoff verifies that path **now**, without waiting for a real bill to reach the president's desk, by seeding a few synthetic `stage='president'` rows, confirming the page renders correctly, then rolling the seed back. It's a test fixture against the **local** database — no prod write, no committed code, no residue.

## The spec being verified (from SKILL.md)

- `getPresidentBills` / `getPresidentCount`: `stage='president'` AND `latest_action_date IS NOT NULL`, sorted `latest_action_date ASC` (oldest at desk first — closest to the 10-day veto deadline). (SKILL.md line 113.)
- `/president` page: no `StageFilter`, topic + search only, `?stage=*` silently dropped, header chrome `BILLS AT DESK`, empty state is a single muted line. (line 175.)
- Desk-time column: `BillRow` with `daysSinceMode='desk-time'` renders a right-aligned `Nd` figure in `tabular-nums`, color thresholds: `<5d` → `--text-secondary`, `5–9d` → `--accent-amber`, `≥10d` → `--party-republican` (overdue or misclassified). (lines 270–279.)

## What to do

### 1. Seed (local DB only)

Write a throwaway script (e.g. `scripts/diagnostic/seed-president-158.ts`, not committed) that inserts or reclassifies **3 rows** to `stage='president'` with `latest_action_date` values chosen to land one in each color band:

- One at **2 days** ago → expects `--text-secondary` (under 5d).
- One at **7 days** ago → expects `--accent-amber` (5–9d band).
- One at **12 days** ago → expects `--party-republican` (≥10d, overdue).

Prefer reclassifying 3 existing real bills (flip their `stage` to `president` and set `latest_action_date`) over inventing fake bill rows — real rows render with real titles/sponsors so the page looks authentic, and the rollback is a clean stage-restore. **Record each touched bill's id + original `stage` + original `latest_action_date` before changing it**, so rollback is exact. Don't touch `summary`, `topics`, or anything else.

### 2. Verify

Start the dev server, load `/president`, and confirm:

1. **Sort:** the 12-days row is first, then 7-days, then 2-days (oldest desk arrival at top, `latest_action_date ASC`).
2. **Desk-time column:** each row shows the right `Nd` figure (`12d`, `7d`, `2d`) right-aligned in tabular-nums.
3. **Colors:** 12d row red (`--party-republican`), 7d row amber (`--accent-amber`), 2d row secondary/dim. This is the core thing that's never been seen — confirm the threshold table actually maps as specced.
4. **Header chrome:** `BILLS AT DESK` renders.
5. **No StageFilter** on the page; topic + search filters present; hand-typing `?stage=enacted` is silently ignored (page still shows the president bills).
6. **Count** (`getPresidentCount`) reads 3.

Screenshot or describe the rendered rows so the verification is on-record, not just asserted.

### 3. Also confirm the empty state (cheap, while seeded)

Before or after the seed, load `/president` with zero president bills once and confirm the empty state is the single muted line, no chrome — that's the state prod is actually in right now, so it's worth a glance.

### 4. Roll back

Restore each touched bill's `stage` and `latest_action_date` to the recorded originals. Re-load `/president` and confirm it's back to the empty state (0 rows). Delete the throwaway script. Confirm `git status` is clean — no committed changes, no leftover script, no DB residue beyond the restored originals.

## Acceptance

1. 3 synthetic president-stage rows seeded locally with 2d / 7d / 12d desk ages; originals recorded first.
2. `/president` verified: oldest-first sort, correct `Nd` desk-time figures, correct color-band mapping per the threshold table, `BILLS AT DESK` header, no StageFilter, `?stage=` ignored, count = 3. Rendered rows put on-record (screenshot or description).
3. Empty state confirmed (single muted line, no chrome) — the current prod state.
4. Seed rolled back exactly; `/president` returns to empty; throwaway script deleted; `git status` clean.
5. No commit. This is a verification pass — nothing ships.

## Notes

- **Why synthetic, not wait.** Real data confirms this end-to-end eventually, but a president-stage bill could land and age past its 10-day window before anyone checks. The fixture confirms the rendering + sort + threshold logic — the part we actually wrote and the part that could be wrong — today. Waiting only confirms it on someone else's schedule.
- **Local DB only.** Seed against the local Turso/dev database, never prod. The point is to exercise the render path, not to put fake bills in front of the cron or the live site.
- **Reclassify real bills over inventing fake ones.** A real bill flipped to `president` renders with its true title and sponsor, so the page looks like production. Inventing fake `bills` rows risks missing NOT NULL columns or rendering oddly, and is messier to roll back. Record originals, flip stage + action date, restore after.
- **The thing most likely to be wrong** is the color threshold mapping (the `5–9d` band boundary, or `≥10d` going red), since it's never rendered. Look hardest there. The sort is simpler (`ASC`) and lower-risk.
- **No handoff number collision with the desk-time origin.** The desk-time work predates the `151-bills-news-feed.md` file; its spec lives in SKILL.md (113/175/270–279), which is the authoritative source verified against here.

---

## Verification result (2026-05-29) — static, no seed

**Decision: verified by code inspection, no DB seed.** Two HO 158 premises were stale, one a safety blocker, so the synthetic-seed plan was not run:

1. **Target moved (HO 151 + HO 154.1).** The standalone `/president` page is gone — `app/president/page.tsx` is now `redirect("/feed?stage=president")`. `getPresidentBills` / `getPresidentCount` / `buildPresidentWhere` were **deleted** (not present in `lib/queries.ts`). The desk-time + oldest-first behavior now lives in `getFeedBills` behind the feed's president-alias path, **not** a standalone page or dedicated helpers. So the acceptance criteria that referenced "no StageFilter," the `BILLS AT DESK` header, `?stage=` being silently dropped, and `getPresidentCount` reading 3 describe a removed page and no longer apply.
2. **No local DB — "local" is production.** `lib/db.ts` reads a single `TURSO_DATABASE_URL`; `.env` resolves it to a remote `libsql://` instance with no `file:` fallback, no embedded replica, no `.env.local` override, and no local `.db` on disk. Seeding "locally" would write to the production Turso the live site reads (live `/feed?stage=president` would show 3 bills; the dashboard stage funnel would read PRESIDENT=3). That violates the handoff's "local DB only, never prod" — so no seed was performed.

**What was confirmed (static read of the live code) — the desk-time render path is correct as specced:**

- **Color thresholds** (`components/BillRow.tsx` `daysSinceColor(days, "desk-time")`): `>=10` → `--party-republican`, `>=5` → `--accent-amber`, else `--text-secondary`. Inclusive-lower-bound bands match SKILL.md's `<5d / 5–9d / ≥10d`. → a **12d** row renders red, **7d** amber, **2d** secondary. (This was the handoff's stated highest-risk item — "the color threshold mapping, never rendered" — and it maps exactly.)
- **Sort** (`getFeedBills`, `lib/queries.ts`): `filters.direction === "asc"` → `ORDER BY latest_action_date ASC NULLS LAST, id DESC` → oldest-at-desk first (**12 → 7 → 2**).
- **Figure**: `${daysSince(latest_action_date)}d` right-aligned in `.row-days-since`, `tabular-nums` via CSS.
- **Alias wiring** (`app/feed/page.tsx`): `stage === "president"` as sole active stage with no explicit `?sort` → `direction:"asc"` + `daysSinceMode:"desk-time"`, both threaded into `BillRowList`. Loading `/president` redirects here, so bookmarks resolve to the same view.

**Not done:** no live pixel render (would require either a prod write or standing up a separate local DB — neither warranted to confirm a short, now-inspected code path). No DB write, no rollback needed (nothing seeded). The stale SKILL.md sections that fed this handoff were corrected in a separate commit (`docs: correct SKILL.md /president → /feed?stage=president alias`).
