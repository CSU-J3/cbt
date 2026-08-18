# scripts/diagnostic/scratch

**The opt-in for a probe you know is disposable at the moment you write it.**
Everything in here is ignored by git *and* excluded from `tsconfig.json`, so a
file dropped here can never red-light `npm run typecheck` or `npm run build`.

Nothing else under `scripts/` has that property. `tsconfig.json`'s `include`
carries `scripts/**/*.ts`, which selects on the **extension pattern, not on
tracking state** — an untracked probe is compiled exactly like a committed one.
This directory is the only place that opts out.

**One caveat, so the exclusion is not over-trusted:** `exclude` filters the
`include` globs, but it does **not** apply to a file pulled in by an `import`
from an included file. If a tracked probe ever imports a module from here, that
module re-enters the program and can red-light the gate from a directory
declared unable to. Nothing imports across that line today; keep it that way.

## The rule (HO 672)

**Probes default to TRACKED. `scratch/` is the exception, not the norm.**

At write time you cannot know whether a finding will come to rest on a probe.
When HO 672 enumerated `scripts/diagnostic/`, 126 of 154 files were already
tracked and 28 were not — and six of those 28 were cited as the instrument
behind a recorded finding in `SKILL.md`, `docs/backlog.md` or `docs/roadmap.md`
while existing on exactly one machine. `SKILL.md` named
`welcome-read-budget-670.ts` as the source of the 94,240-row `/welcome` price;
a fresh clone could not run it. Method says *clone fresh, the repo is ground
truth* — so a probe that is only on your laptop is a citation waiting to dangle.

So: write it in `scripts/diagnostic/` and commit it, unless you are prepared to
say now that no finding will ever rest on it. If you are, it goes here.

## Why the exception exists at all

Without it the pressure that produced those 28 files returns immediately — a
genuine one-off still has to live somewhere, and if the only lawful home is the
tracked directory, people will simply leave it untracked again and the exposure
comes back. This directory gives that case a home where it is harmless.

## The failure this closes

The `tsconfig` `scripts`-include exposure fired three times (HO 669, 670, 671)
and **was never visible between firings** — an untracked probe with a type error
red-lights the local gate, while CI, which checks out a fresh clone, cannot see
the file at all. HO 670's tree sat red *after* its final gate run because a probe
was written afterwards; tracked files were clean, so nothing could report it.
Three sessions each read it as a one-off because in the green state there is
nothing to find.

Two halves close it: probes are tracked, so local and CI agree by construction
and a real error is attributable on sight; and genuinely disposable work comes
here, where it cannot reach a gate.

## Write instruments

A probe that mutates the database does **not** belong here — being unreadable by
CI is not the same as being safe. It goes in `scripts/diagnostic/`, tracked, with
a header naming what it mutates and an explicit `--write`-style flag so it cannot
run by being invoked. `reset-bill-671.ts` is the worked example.
