# docs/design

Mocks and ruling records for CBT. **Tracked by default.**

A mock here is usually *evidence for a decision* — the thing Corey ruled against,
the variant that lost, the sizes drawn live so a choice could be made between
them. A roadmap block that cites a mock and a repo that does not carry it is a
recorded decision whose evidence does not ship.

## The rules

1. **Tracked by default.** Commit the mock in the HO that ruled against it.
2. **Name a ruling record `mock-<HO>-<slug>.html`** — in use since HO 507
   (`mock-507-bill-detail.html` is the oldest on disk); first *committed* at
   HO 629. Not every mock here follows it, which is why this is a rule and not a
   description. **This reverses a call HO 604 C0 made deliberately**, which chose
   *"descriptive names, no HO number — matching the seven files already in
   `docs/design/`"* (`604-type-scale.md:64`, tracked archive). The reversal is
   ruled, not accidental: a renamed ruling record **loses the citation trail its
   original name carried**, and that is precisely the dangle this HO found —
   `mock-591-conventions.html` still resolves the mockbar reference its renamed
   companion broke.
   Record its `sha256` in that HO's roadmap block (the HO 670 / 673 precedent), so
   a later reader can tell the ruled version from a redraw.
3. **`scratch/` is the one ignored location**, for a mock known disposable when it
   is saved. See `scratch/README.md`. Nothing tracked may cite a file in there.
4. **Cite on ONE line.** A path wrapped across two comment lines is illegible to
   grep and to the gate, and it is not hypothetical: `app/welcome/page.tsx` split
   `welcome-formats-mock.html` across a line break and the citation was invisible
   to every search for it until HO 696 went looking.
5. **A citation that is knowingly broken goes in `citations.allowlist.json`** with
   a reason and a note naming the citing `file:line`. It goes **stale loudly**: if
   the file later lands, the gate reds until the entry is removed.

## The gate

`npm run check:design-citations` (`scripts/check-design-citations.ts`), run in CI
by `.github/workflows/design-citations.yml` on every push and PR with **no path
filter** — because a docs push is exactly when a citation changes, and `ci.yml`
skips `docs/**` and `**/*.md`.

It scans every **tracked** file — with one structural exemption, the allowlist
itself, whose keys ARE the tokens it excuses and would otherwise cite themselves —
and reds on:

| class | meaning |
|---|---|
| `DANGLING` | a cited mock that does not resolve to a tracked file |
| `MALFORMED` | a path whose last segment has no extension — a wrapped citation |
| `FORBIDDEN` | any tracked file citing a file below `scratch/` — **no allowlist can lift this** |
| `STALE` | an allowlisted token that now resolves; delete the entry |
| `ORPHAN` | an allowlist entry no tracked file cites any more; delete the entry |

**What it cannot see, stated plainly rather than left to be discovered.** It reads
an explicit `docs/design/<file>` path, or a bare name matching the
`mock-<HO>-<slug>.html` convention. A **mock named outside that convention and
cited by bare name** — `ideology-cut1-members-insitu.html`,
`dashboard-hill-fit.html`, `dashboard-v2-tabbed-words.html`, and live tracked
files like `welcome-formats-mock.html` and `dashboard-layout-target.html` — is
outside the grammar and always will be. **This is not a date boundary**: the
`mock-<HO>-` name has been in use since HO 507. Tracked-by-default, not the
grammar, is what makes those citations resolve; the gate never could. It also does not
read untracked files, by design: a fresh clone has nothing else, and "resolves in
a fresh clone" is the property being checked.

## How it got here

`docs/design/` carried no disposable location at all, so every mock that was not
deliberately committed was simply loose in the working tree. The count history is
the ad-hoc pattern expressed as a number — **16·15 → 18·14 → 19·14 → 20·13**,
tracked rising one per handoff that ruled against a mock. HO 689 and HO 690 each
counted their own mock as one more ad-hoc instance and said the fix was larger
than a rider; **neither flagged the entry as due**, and being counted five times
without coming due is the shape of the problem.

**Five dangling tokens and one wrapped path** were live in a fresh clone when
HO 696 opened. Two were unrecorded anywhere — a shipped source file
(`components/PolarizationOverTime.tsx:14`) and the roadmap's record of the HO 657
ruling. Two were mentions whose own sentence says the file does not exist. One,
recorded as *never landed*, had been sitting on disk under a different name since
2026-08-06 — see the allowlist note on `mock-591-dashboard-layout.html`, and read
titles rather than filenames before writing that reason again.

**The oldest dangle ran from HO 428 to HO 672 — 244 handoffs — before anyone
filed it**, and 24 more from that filing to this fix. Filed at the HO 672 close as
`docs/backlog.md:110`, ruled its own HO, closed by HO 696.
