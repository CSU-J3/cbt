# docs/design/scratch

**The opt-in for a mock you know is disposable at the moment you save it.**
Everything in this directory is ignored by git. Nothing tracked may cite a file
here, and `npm run check:design-citations` reds on one that does — that check is
the whole reason the directory is safe to have.

A **ruling record never goes here.** If a mock was drawn against, chosen from, or
argued with in a handoff, it is evidence for a decision and it belongs in
`docs/design/`, tracked, under the `mock-<HO>-<slug>.html` name.

## What actually lands here

Two shapes, both known throwaway *when written*:

- a browser-download duplicate — the `name(1).html` beside its tracked twin;
- an iteration superseded before anyone ruled on it.

If you cannot say now that no finding will ever rest on it, it is not disposable.
Commit it.

## The rule (HO 696)

**Design artefacts default to TRACKED. This directory is the exception, not the
norm.** The pressure that produced the mess is real — a genuine one-off has to
live *somewhere*, and if the only lawful home is the tracked directory then people
leave things untracked instead and the exposure comes straight back. This gives
that case a home where it is harmless.

## The failure this closes

`docs/design/` reached **20 tracked · 13 untracked · 0 ignored** with no
disposable location at all, and four tracked files cited a mock that a fresh
clone does not carry — including `components/PolarizationOverTime.tsx`, a shipped
source file, whose citation had dangled since **HO 428**. Method says *clone
fresh, the repo is ground truth*, so a mock that exists only on your laptop is a
citation waiting to dangle. The count history is the pattern stated as a number:
**16·15 → 18·14 → 19·14 → 20·13**, the tracked side rising one per handoff that
ruled against a mock, each time as an ad-hoc commit rather than a rule.

## The half this directory could not close on its own

HO 672 closed the same defect for probes, and there `tsconfig` **also** excludes
the scratch directory, so `tsc` enforces that nothing depended-upon lives in it.
HTML mocks are compiled by nothing, so that half has no counterpart here. The
enforcement is `scripts/check-design-citations.ts` instead: a tracked file naming
any file below this directory is a hard failure that **no allowlist entry can
lift**. That is deliberate — an allowlist exists for citations that are merely
broken, never for one pointing at a place declared disposable.
