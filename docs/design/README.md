# docs/design

Mocks and ruling records for CBT. **Tracked by default.**

A mock here is usually *evidence for a decision* — the thing Corey ruled against,
the variant that lost, the sizes drawn live so a choice could be made between
them. A roadmap block that cites a mock and a repo that does not carry it is a
recorded decision whose evidence does not ship.

## The rules

1. **Tracked by default.** Commit the mock in the HO that ruled against it.
2. **Name a ruling record `mock-<HO>-<slug>.html`** — the convention since HO 629.
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

It scans every **tracked** file and reds on:

| class | meaning |
|---|---|
| `DANGLING` | a cited mock that does not resolve to a tracked file |
| `MALFORMED` | a path whose last segment has no extension — a wrapped citation |
| `FORBIDDEN` | any tracked file citing a file below `scratch/` — **no allowlist can lift this** |
| `STALE` | an allowlisted token that now resolves; delete the entry |

**What it cannot see, stated plainly rather than left to be discovered.** It reads
an explicit `docs/design/<file>` path, or a bare name matching the
`mock-<HO>-<slug>.html` convention. A **pre-629 mock cited by bare name** —
`ideology-cut1-members-insitu.html`, `dashboard-hill-fit.html`,
`dashboard-v2-tabbed-words.html` — is outside the grammar and always will be.
Committing what is on disk fixes those; the gate never could. It also does not
read untracked files, by design: a fresh clone has nothing else, and "resolves in
a fresh clone" is the property being checked.

## How it got here

`docs/design/` carried no disposable location at all, so every mock that was not
deliberately committed was simply loose in the working tree. The count history is
the ad-hoc pattern expressed as a number — **16·15 → 18·14 → 19·14 → 20·13**,
tracked rising one per handoff that ruled against a mock — and it was counted
rather than fixed at HO 689 and HO 690, both of which flagged it as due.

Four tracked-file citations were broken in a fresh clone the whole time, the
oldest since **HO 428** (24 handoffs before it was even filed): a shipped source
file (`components/PolarizationOverTime.tsx:14`), the roadmap's record of the HO
657 ruling, and two self-correcting mentions of files that never existed. Filed
at the HO 672 close as `docs/backlog.md:110`, ruled its own HO, closed by HO 696.
