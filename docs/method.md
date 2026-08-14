# CBT — Method

> How this project is worked, as opposed to what it is. `SKILL.md`
> (`.claude/skills/cbt/SKILL.md`) states the product and its implementation; this
> file states how a session operates around it. **Where SKILL owns a rule, this
> file names its section and stops** — a rule written twice is a rule that will
> drift, and SKILL wins ties on implementation.
>
> Rule-shaped, not historical. `docs/roadmap.md` owns the narrative; where a rule
> needs provenance it carries an HO number in parentheses and nothing more.

## Roles

- **Corey** — product direction and final approval. Rules on genuine design forks.
- **Claude** — architect and handoff author.
- **Code** — executes handoffs.
- **A non-fork architectural call is made without asking.** Escalate the forks:
  where two defensible directions lead to materially different products, that is
  Corey's, not the architect's.
- The `docs/backlog.md` owner tags (**Corey** / **Code** / **cron**) are a
  different taxonomy — who *acts* on an item, not who decides it.

## Session start

- **Clone fresh; the repo is ground truth.** Memory lags HEAD and records what was
  true when it was written. Verify anything memory asserts about the tree — a
  file, a helper, a flag — against the tree before acting on it.
- **A baked pointer is worse than none.** HEAD, the roadmap pointer and the open
  loops are read off the files at session open, never carried in.
- **Reconcile `docs/backlog.md` OPEN LOOPS at open and close** (stated in that
  file's header; nothing is tracked only in chat).
- **Establish which machine the session is on** before assuming any environment
  constraint — see Environment.
- **Sessions run concurrently against one shared working tree.** Stage by
  explicit pathspec, never a bare `git add`; re-check HEAD and ancestry
  immediately before every push; verify your own SHA, not the tree's. Claims
  about the remote go through `git ls-remote` — SKILL, "Review-ref route".

## Handoff discipline

- **The next HO number is `max(roadmap pointer, highest HO in commit subjects) + 1`,
  never an on-disk filename** (HO 649). The corollary is what the filename rule
  alone does not survive: **the roadmap is authoritative only while it is
  current, and it is current only after a sweep** — a deferred sweep silently
  degrades the instrument that was supposed to be safe against filenames.
- **Sizing follows the artifact, not the topic.** A full feature or data spec is a
  numbered file in `docs/handoffs/` delivered with `present_files` and the
  read-and-follow close; a small instruction — plan approval, a correction, a
  one-off nudge — is an inline block with no ceremony.
- **Enumerate-first where scope is uncertain:** STEP 0 produces a closure table
  (candidate · verdict · evidence `file:line` · destination) and **HALTS** for
  review before any file is created, edited or removed (HO 650 / 658 / 662).
- **Probe before build.** New upstream: SKILL, "External data sources" — the
  probe → wire cadence, diagnostic-only probe handoff first. New premise of any
  kind: SKILL, "Pre-flight verification".
- **`docs/handoffs/` is repo-ignored** and must stay so (SKILL, "Pre-flight
  verification" — build-input parity). Handoff files are therefore untracked and
  absent from `git status`; dropping one is `rm`, not `git rm`.

## Relay

- **Swallow runs both directions.** A block can be lost carrying work out to the
  owner and carrying instruction back in; neither direction announces it.
- **After ONE swallowed block, re-deliver as a gitignored file** with the standard
  close. Never re-paste a second time (HO 662, tightening the two-strike form
  established at HO 508 — every re-paste on record bought nothing).
- **Ground truth is `git ls-remote --heads origin`, never the pasted transcript.**
  A summary of a thing is not the thing.
- Mechanics of routing text out for a real read: SKILL, "Review-ref route".
- Verdicts coming back: SKILL, "Owner verdicts in a relay" — an unfilled slot is
  a HALT, and a verdict travels as a verbatim quotation with named provenance.

## Doc authority and conventions

- **`SKILL.md`** — standing product and implementation rules. **Self-mod guard:**
  its own commit, its own review ref, the diff approved before `main` moves
  (SKILL, "Review-ref route"). SKILL never rides with another doc.
- **`docs/roadmap.md`** — append-only narrative. One new `Also (HO N)` block per
  handoff, pointer advanced; **never retro-edit a prior block's clause, figure or
  pointer.** A supersession marker on a prior block's pointer is permitted
  (HO 615); the correction itself goes in the new block.
- **`docs/backlog.md`** — the open-loops ledger; its header states its own
  conventions, including that a logged line's mechanism or premise is **a claim,
  not a fact** — probe it before building on it.
- **`docs/oddities.md`** — field notes, appended, dated, HO-tagged.
- **`docs/method.md`** — this file.
- **Cross-reference rather than restate.** Two copies of a rule drift, and nothing
  in the toolchain reports it when they do.

## Product scope

- **Congress-focused, extended downstream along the bill spine.**
- **Test for a new data pillar:** it attaches to a tracked bill or a tracked
  member → it is a theme extension. It needs its own spine → it is a separate
  product, not a section of this one.
- **Declined as pillars:** FARA (foreign-agent filings are their own spine); a
  standalone Treasury/macro surface — FRED as a *feed* is adopted (tape:
  TNX/VIX/WTI/NATGAS/BTC), what was declined is macro as its own theme;
  standalone executive-branch tracking — `/president` exists because bills reach
  the desk, which is the spine attaching, not an exec pillar.
- Related but not this rule: SKILL, "Information architecture — The rule" governs
  how a pillar is *layered* (snapshot / hub / sub-page) once it is in.

## Environment

**Stated per machine; a session establishes which one it is on before assuming
either set.**

- **The Windows box.** WSL is present but distros will not run (virtualization
  enablement is broken). Route through native Windows tools or web dashboards —
  never WSL, Docker, or any VM-dependent path. Killing dev servers: SKILL,
  "Process cleanup" (port-scoped only; other Next apps share the box).
- **The MacBook.** Plain Unix; none of those constraints apply.

## Memory hygiene

- **Memory carries conventions, lessons and open loops** — the things that stay
  true across sessions.
- **Never a HEAD SHA, never "the latest committed handoff", never a next-HO
  pointer.** Those go stale silently, and a stale pointer is acted on exactly as
  if it were current.
- **Project memory and chat history are project-scoped and do not follow the
  repo** (HO 662). Anything that must survive a move belongs in a tracked file.
