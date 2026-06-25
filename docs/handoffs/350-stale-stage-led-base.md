# HO 350 — Stale tab: stage-led base (supersedes the original "oldest first" sort)

> Claim the next free HO number; if 350 is taken, use the next available and
> rename. Wiring confirmed GO by the HO 345 diagnostic. Relies only on `stage` +
> `latest_action_date`.

`/stale` stops being "no action in 60+ days" and becomes stage-led: the advanced
stalls are the story, the committee wall stays one click away.

**Seed (live, from HO 345 — recompute, don't hardcode; these move every sync):**

- stage counts (16,538 total): committee 14,789 · floor 788 · introduced 532 ·
  NULL 280 · enacted 92 · other_chamber 57. The "other" catchall is empty live;
  only NULL is off-path.
- Past-committee group = `stage IN ('floor','other_chamber','president')` = 845
  (floor 788, other_chamber 57, president 0). Excludes committee, introduced,
  enacted, NULL.
- `latest_action_date` non-null and varied across that group (Jan-2025 →
  Jun-2026, no January pile-up once procedural items are filtered).

**Changes:**

- Default filter `PAST COMMITTEE` = `stage IN (floor, other_chamber, president)`.
  Not the old 60+-days definition.
- Sort: stage descending in legislative order (president → other_chamber →
  floor), then longest time since last action within a stage. Enacted excluded
  (became law, not stalled). NULL sorts last.
- Subtitle: `PAST COMMITTEE · STALLED 60+ DAYS · FURTHEST FIRST`, plus a one-line
  gloss that the committee backlog sits under the stage filter.
- Row: keep the existing structure (id rail + stage tick, title, stage dots +
  current-stage pill, sponsor, topics, age, star). Age now varies by real
  `latest_action_date`, killing the flat 536d wall.
- Committee backlog reachable via `STAGE → COMMITTEE`; footer shows the
  committee-stage count, computed live (currently 14,789), not a literal.

**Procedural housekeeping — filtered from the default** (per HO 345 #3: no
existing flag, curated hybrid):

- Frozen ID list for the one-time opening-week set: electoral-vote count,
  elect/notify officers, fix meeting hour, quorum/assemble, pro-tem election.
- Live title pattern for the recurring "Electing Members to … committees" family
  — it recurs all year (24 rows Jan 2025 → Jun 2026), so an ID list alone misses
  it.
- Blocklist: `hres-966` (Limón honoring), `sres-6` (Murray thanks) — title-pattern
  false positives.
- Do NOT filter `hres-5` (Rules package) or "Amending the Rules" resolutions —
  real floor bills.
- `INCLUDE PROCEDURAL` toggle, off by default, next to `INCLUDE CEREMONIAL`.
  Filtered, not deleted — doubles as the escape hatch if curation grabs a real
  bill.

**HALT — curation needs a human eyeball before the list freezes.** Build the
filter logic, then print the full candidate set (every bill the ID list + title
pattern would remove, minus the blocklist) and STOP. Wait for Corey's sign-off
before committing the frozen list. Do not ship the default filter until the list
is confirmed.

**Resolved (was open):** keep the current-stage pill for now; its removal is a
separate readability pass.

**Don't act on (deferred):** hidden-backlog count as a footer line vs folded into
the subtitle — build it as the footer line.

Constraints: static, no new tokens.

Ship (after sign-off): `tsc`, confirm the Stale page renders styled (stylesheet
200), named `git add` only, push, `npm run verify:deploy` until SHA matches.
