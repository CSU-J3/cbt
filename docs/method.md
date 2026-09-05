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
- **A ground-truth paragraph quotes what was read at the stated SHA and marks
  everything else as an estimate.** A status domain, a column shape, a SKILL entry
  or a CSS mechanism is read — the schema comment, the `CREATE TABLE`, the SKILL
  heading, the computed style — and cited by `file:line`; it is never recalled. A
  figure the architect cannot measure is written as `~N (estimate; STEP 0
  measures)`, and STEP 0's job is to replace it. Five consecutive handoffs had
  their ground truth corrected at STEP 0 (HO 690–694); the corrections that were
  not estimates were all of this kind — a `loser` status the schema never had
  (691), a SKILL clause that did not exist (694), a mechanism named from memory
  (692). The loop caught every one, which is what STEP 0 is for; the rule exists
  so it has less to catch.
- **`docs/handoffs/` is repo-ignored** and must stay so (SKILL, "Pre-flight
  verification" — build-input parity). Handoff files are therefore untracked and
  absent from `git status`; dropping one is `rm`, not `git rm`.

## Executing a handoff (Code)

**The repo is ground truth, and this section is what Code reads at session start
instead of a pasted block.** It supersedes the standing-instructions artifact that
was pasted ahead of every handoff (HO 695).

- **Before executing:** STEP 0 closure table, then HALT — nothing executes before
  the table is read (§ Handoff discipline). Re-derive every line number at your
  HEAD; a handoff's anchors are as-of its base SHA and any edit above them
  invalidates them. Controls before zeros (§ Gates). Bare-substring greps — never
  prefix-sweep, never quote-anchor.
- **When the handoff is wrong:** flag, don't absorb. A forced consequence of an
  approved change is not a widening; say which it is. A gate that is internally
  inconsistent, or a discriminator that cannot fire on this change, is a defect in
  the handoff — report it and propose the replacement; never gut a RECORD comment
  or contort the tree to satisfy a literal check. Don't assert what you haven't
  measured. Findings caught in relay are filed (backlog or oddities), never left
  in chat.
- **Gates, Code-side:** build, then typecheck (a stale `.next/types` reads as a
  code failure otherwise). Bind check before any curl is trusted — the socket
  mapped to your PID, kill by PID and port-scoped, foreign PIDs left alone (SKILL,
  "Process cleanup"). A freshness discriminator derives from something this change
  alters or from the transport — a token the change removes plus a control token
  that survives. Real ids only in probes. Never trigger `/api/sync` locally.
- **Commits:** review branch from the start, the SKILL diff approved alone,
  `--force-with-lease` on the ref only, `HEAD:main` with no force, then
  `git ls-remote` — SKILL, "Review-ref route". **Kinds are never mixed** —
  `chore` / `docs` / `docs(skill)` are separate commits; § Doc authority and
  conventions states the SKILL half (SKILL never rides with another doc), the
  general rule is stated here.
- **Paste-back:** table deltas as executed · `git show --stat` per commit · gate
  outputs including the bind evidence · the backlog numstat with every deletion
  explained · the docs and SKILL diffs · every remote claim via `git ls-remote`.
  Never delete struck text; strike is `~~…~~` plus a one-line close note. The
  numstat deletions column is the authority (§ Gates). One swallowed block
  re-delivers as a gitignored file, never a second paste (§ Relay).

## Gates

**A gate you cannot fail is not a gate.** Before running a check, say what it
reads if the work was never done at all. If that is the same as success, it is
not the check you think it is, and a green from it is worth nothing. The filed
version of this was narrower — *look at render output* (HO 670) — and it was
widened at the HO 671 close because the same principle had by then produced three
more failures in two sessions, none of them about looking at a page.

**Eleven instances. Five are about reading an instrument wrongly rather than
about the thing under test; one is a tool reporting an action it did not
perform; one is an export whose output is indistinguishable from a working one;
one is a set of gates that could not see the artifact at all; one is an
instrument that was silently rewritten in transit and went on answering a
different question; one is an evidence path the runner itself deletes, so the
check could not have fired at all; and one is an instrument that does not
exist:**

- **HO 670 — a visual check with no capture is not a check.** Every gate green
  while the layout was wrong three times: a ~300px dead zone under each panel, an
  empty ODDS third, and a reduced-motion mask that erased the first row's title.
  Greps and 200s cannot see a layout — a string is in the markup whether or not it
  is inside the visible box, and a mask that erases text changes no DOM.
- **HO 671 — never `tail` a command whose failure mode is a stack trace.**
  `npx tsx -e "…await…" 2>&1 | tail -3` printed only `Node.js v25.5.0`. The tool
  had reported the error in full; the pipeline showed the frames and hid the
  message. The informative line is the **first** one.
- **HO 671 — a write instrument that does not read back is not an instrument.**
  That same one-liner was a *write*, so its failure mode was not "it failed" but
  **"unclear whether it landed"** — the worst answer a write can give.
- **HO 672 — `git check-ignore -v` exits 0 on a negated pattern**, printing the
  `!` rule for a file that is **not** ignored. The flag added to make the answer
  legible is the flag that makes both answers print the same shape. Authoritative
  instrument: `git add --dry-run`.
- **HO 672 — `TaskStop` reported success twice and left the detached child
  processes running.** The first instance here where **a tool lied about an
  action rather than about a state**: three latency samplers ran concurrently
  against prod for 45 minutes, and the load change when two of them exited
  destroyed two of the four measurements the run existed to take. **When a
  process is supposed to have stopped, verify that it stopped.** And the
  counterintuitive half, which is the part worth carrying: **the tidier design
  would have hidden it.** One shared output file meant 540 lines for 240 cycles
  and the mismatch was unmissable; per-run filenames would have produced three
  inflated, internally consistent, entirely clean-looking series. **Prefer the
  output arrangement in which contamination is visible over the one that is
  merely neater.**
- **HO 672 — `git show --word-diff=color > file.txt` writes a diff containing no
  change information.** The markers exist only as ANSI escapes, which are gone
  the moment the file is read as text; what survives is the document's prose with
  nothing indicating what moved. Measured on the delivered file: **0 `[-old-]` /
  `{+new+}` markers in 38,468 bytes** — and the `-` lines in it are markdown
  bullets in the content, not removals. It is the right size, correctly named,
  contains the right document, and answers a different question. **An empty
  word-diff and a diff with no changes are the same bytes**, which is the
  operational test failing in its purest form. Rule: **when writing a diff to a
  file, use a format whose markers are text** — `--word-diff=plain` or plain
  unified, never `--word-diff=color`. It happened inside the delivery step of the
  commit that closes this very entry.
- **HO 678 — a quoted heredoc collapsed `\\` to `\`, and the regex still
  compiled.** A secret scan over 1,141 commits printed `hits=0`. `"\\s*"` reached
  disk as `"\s*"`, which JavaScript parses as plain `s`; `new RegExp` built a
  **valid** expression asking a different question, and the pattern it destroyed
  was the only one matching an api.data.gov key — the exact shape gitleaks has no
  rule for, which is why that pattern existed. **The control caught it: 7 of 8
  patterns fired on synthetic bait, and it named the missing one.** Two rules:
  **never build a regex from a string that had to survive a shell** — use regex
  literals, so a lost backslash is a syntax error at load rather than a semantic
  change at run time — and **a scanner's zero is worth exactly as much as its last
  control run.** This is the section's own subject reaching the place meant to be
  immune to it: an instrument built to cover a known blind spot, blinded by its
  own transport.
- **HO 678 — one log filter denies what another displays, and four causes share
  one output.** Vercel's runtime-log `level=["warning"]` returned nothing for a
  24h window in which a `statusCode=500` query returned a line the tool itself
  labelled `[warn/serverless]`. The control for the text path — searching a string
  the route logs every tick — **timed out** at 24h, at 6h, and scoped to a single
  deployment. Meanwhile "no logs found" is also what retention (Pro = 1 day) and a
  billing limit produce, so **absence, retention, timeout and a quota all render
  identically**; only the explicit error text separates them. Structured
  aggregation (`group_by=statusCode`) does work. Rule: **treat a runtime-log zero
  as UNAVAILABLE until a control string known to be in that window comes back**,
  and say which query path produced the reading. The audit that found this
  recorded its log evidence as unavailable rather than passed — and was right to:
  the key it was looking for was sitting in three database rows.
- **HO 683 — the handoff designated an evidence path the runner deletes, so the
  alarm's failure was identical to its success.** The overflow alarm was
  specified to write `playwright-report/smoke-overflow.md` and the workflow to
  fire on that file's presence. The Playwright HTML reporter **clears its output
  folder at run END**, so the row written during the run is gone before any step
  can read it: `hashFiles()` empty, issue step skipped, **an alarm structurally
  unable to fire and rendering exactly like a quiet prod**. Caught at STEP 0 by
  measurement rather than by reading the minified reporter source — a stale file
  placed, a row appended, **four candidate paths raced** — which also produced
  the replacement: `test-results/` is cleaned at run **START** and never at end,
  so a stale file cannot ping AND a live row survives. **Second
  architect-prescribed blind instrument on record (HO 680 is the first), and the
  first one caught BEFORE the gate ever ran** — which is the only reason it is
  an entry here rather than a post-mortem. The general form is already stated
  above: a handoff's designated method is a premise like any other and is
  verified before it is leaned on.
- **HO 685 — the handoff designated an instrument that does not exist.** A row
  was to be closed by reading a workflow run's resolved concurrency group,
  *"visible via `gh run view --json` / the UI."* It is not: `gh run view --json`
  offers seventeen fields and none is concurrency, and
  `gh api …/actions/runs/<id> --jq 'keys'` carries no concurrency key either.
  **Third architect-prescribed blind instrument (HO 680, HO 683), and the second
  caught before its gate ran** — a pattern now, not a coincidence, and the three
  differ instructively: HO 680's read the wrong column, HO 683's wrote to a path
  the runner deletes, and this one names a field the API has never had. The
  distinctive hazard here is that **the honest replacement is necessarily a
  tautology**, because a step cannot read `concurrency.group` and the only
  available echo must re-state the key's own expression — so it verifies
  expression semantics (what `|| 'na'` resolves to per event class) and can
  never catch a typo in the key. That limit is written beside the echo rather
  than left to be over-read, and the property it cannot reach — that two groups
  are genuinely distinct — is carried behaviourally instead, by a collision test
  in which a working run survives a mid-crawl skipped one. **When the only
  instrument available shares an expression with its subject, say which half it
  buys and name what carries the other half.**

**What the gate requires**

- **Render-touching work: capture, and keep the captures.** A named viewport set
  (HO 670 used 1920 / 1440 / 1100 / 430), a **separate `prefers-reduced-motion`
  pass** — it is a different layout, not a dimmer one — and the screenshots
  retained in the paste. "I looked at it" is not a capture.
- **Any instrument: state what its zero means, and fire a control that can
  produce a non-zero on the same instrument.** An untriggered guard is unproven,
  not protection. Where a state can mimic the condition being tested, the control
  has to separate them: "no rows yet" and "ran and produced nothing" are both a
  zero, and only one of them is an answer.
- **Any write: read back and print the effect.** `rowsAffected`, then re-read the
  row, then — where one exists — re-run the predicate the write was meant to
  satisfy.
- **Any pipeline: do not truncate from the end** of output whose failure mode is
  a trace, and read the exit status of the *command* rather than of the pipeline.
- **Any convenient check: name the authoritative one.** If the cheap instrument
  answers a different question than the one being asked, it is decoration —
  `check-ignore` reports which rule matched last, not the verdict.
- **An assertion in a comment is covered by no instrument.** A comment records a
  measurement — what was read, where, when, the number — or says in so many words
  that it is reasoning. HO 694's roster-header paragraph was the only unmeasured
  claim in a change that measured everything else, and the only wrong one: five
  children auto-flowed a cell early, RATE sat over ENACT, and neither the 430 gate
  (misalignment does not overflow) nor the ON baseline (the cell was not in its
  set) could see it. Measure it, or cut the claim back to the measured half and
  say which you did.
- **A check built from the same expression as the thing it checks is a tautology
  wearing a verdict.** An audit that shares its mapping expression with the
  collector that wrote the rows cannot catch a wrong mapping — only stale ones —
  so a clean result is evidence about freshness and none at all about
  correctness. Say which of the two a check is buying. *(Adopted from outside
  this project; the five instances above are ours.)*
- **A count invariant whose two sides derive from one upstream gate is blind to
  upstream staleness.** The sibling of the clause above, and the distinction is
  worth keeping straight: that one is about a check sharing an *expression* with
  its subject, this one about two independently-computed numbers sharing a
  *source*. HO 684's `promised = shown` compared a badge count against a rendered
  chip count — genuinely two computations — and would still have read green over
  chips silently absent, had the Data Cache served the old query shape: both
  sides degrade together, because both descend from the same read. The
  authoritative check was the served content, not the count that agreed with
  itself.
- **A gate binds to the state at the paste, not to the state when it ran.** Every
  instance above is a check that was run and misread; this is the one where
  nothing was wrong at the moment anything was checked. HO 670's tree went red
  *after* its final gate, because a probe was written afterwards — so the report
  was true when made and false when read. **Re-run the cheap gates immediately
  before the paste** rather than reporting the last green, and say which reading
  the paste carries. (Distinct from the reopening criterion below, which asks
  whether the *next* HO complies; this asks whether *this* paste is current.)
- **Deletion counting on an append-only doc: `git diff --numstat`'s deletions
  column, or normal-format `^<`.** The rule and both wrong alternatives are
  SKILL's (Pre-flight verification); what belongs here is the reproduction,
  because HO 639 filed it on reasoning and HO 672 caught it red-handed **on the
  very commit that closes the gate entry about not trusting it**. Striking a
  backlog line edits a line beginning `- **`, so the removed side of the diff
  reads `-- **…` — and `^-[^-]` requires the second character not to be a dash,
  so it **excludes deleted markdown bullets by construction**. Measured on that
  diff: `grep -c '^-[^-]'` returned **0** while `--numstat` reported **2**. A
  clean grep and a genuinely additive commit are the same output, which is this
  section's whole subject wearing its plainest disguise.
- **A close criterion that cannot become false again does not close a living
  thing.** Ask whether the criterion would still read true if the system stopped
  being maintained tomorrow. If yes, it describes a state, not a capability.
  Everything above is about instruments; this one is about **criteria**, which is
  why it reads as the odd item in the list and is not. Two instances, both from
  the roster arc: `backlog:83` closed on *"a named bill's roster readable from
  the local DB without a network call"* — true **forever** after a one-shot
  backfill, so the entry struck closed while the gap it covered was still
  growing; and `backlog:81` rested its premise, *once the rosters exist the
  roster is the better source*, on a refresh that **did not exist**, leaving a
  filed entry load-bearing on nothing. Ruled at the HO 675 close, landed HO 676.
- **An instrument that cannot distinguish the work having landed from the work
  never happening is not a read-back, however official it looks.** The HO 680
  handoff designated its own proof — *the `vercel env ls` age column resetting
  from 120d to seconds is proof a value changed* — and the column is labelled
  `created` and means it: it moves when an add **replaces** a record, never when
  `--force` overwrites one **in place**. So the first write of a rotation resets
  it and every correction after that does not, which is exactly backwards. A
  41-byte value (an unstripped trailing space) was corrected, and the corrected
  write read as `8m ago` — the *bad* write's timestamp. `--format json` carries
  `createdAt` **and** `updatedAt`; only the pair answers the question. **The
  handoff's stated method is a premise like any other and is verified before it
  is leaned on** — this is the first instance where the blind instrument was
  *prescribed* rather than chosen. It also produced a misreport that cannot be
  retested: an earlier write read the same wrong column, was reported as a tool
  no-op, and its record was deleted in the ordinary course of the rotation
  before the distinction surfaced — **unverifiable, not a tool defect**, and
  recorded as a misreading rather than dropped.
- **A close criterion that names the wrong quantity does not close what it claims
  to.** The criterion can be perfectly falsifiable and still measure something
  other than the capability it was written to gate. The sibling of the clause
  above — that one is about a criterion that cannot become false, this one about
  one that can, loudly, while pointing at the wrong thing. Both citations are
  from `backlog:80`'s own close: **leg 1** demanded *"a bill whose INTRODUCTION
  postdates the backfill"*, when the class that matters is **ingested-after** —
  `/api/sync` reaches a bill weeks after it is introduced, so `119-hr-9641`
  (introduced 2026-07-13) and `119-hres-1400` (2026-06-30) both satisfied the
  spirit and failed the letter; and **leg 3** demanded a disagreement fraction
  move, when that fraction belonged to `backlog:81`'s stale column rather than to
  roster freshness — so the HO that closed leg 3 was scoped out of moving it, and
  a version that had moved it would have been out of scope. Ruled at the HO 676
  close, landed HO 677.

**Cross-references, because these are owned elsewhere and restating them would
drift them:** SKILL, "Pre-flight verification" — the `pipefail` / piped-exit-status
rule, `npm ls` vs `npm ci`, coverage-vs-breakage instruments, and why a
falsification anchor lives in a fixture rather than on a product route. SKILL,
"Playwright smoke crawler" — why a skip-on-empty guard inverts a fixture's failure
mode. `docs/oddities.md` carries each instance as a field note.

**This step's own instrument can fail, which is the point.** If the step is
written and the next render-touching HO's paste carries no capture, the step is
decoration and the backlog entry reopens. That criterion was in the HO 670 filing
and it survives the widening.

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
  handoff, pointer advanced. **A block is mutable until its FF lands; once on
  `main` it is history.** On the review ref the block is a workspace: amend it so
  it ships true (a "six commits" clause that is already false is worse than an
  amended block). After FF, a correction goes into the next HO's block or the
  commit message, never into the landed text; a supersession marker on a prior
  block's pointer is the one permitted touch (HO 615). Ruled at HO 694, where the
  block was amended twice before FF and the 690 correction had gone into a commit
  message.
- **`docs/backlog.md`** — the open-loops ledger; its header states its own
  conventions, including that a logged line's mechanism or premise is **a claim,
  not a fact** — probe it before building on it.
- **`docs/oddities.md`** — field notes, appended, dated, HO-tagged.
- **`docs/design/`** — mocks and ruling records, tracked by default.
  `docs/design/README.md` states the directory's rule: the `mock-<HO>-<slug>.html`
  name, the one ignored `scratch/`, citations on one line, and what
  `check:design-citations` reads and cannot. A mock a tracked file cites ships
  with the repo, or it is a citation waiting to dangle (HO 672 → 696).
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
- **CI runs on Ubuntu; the Windows box and the MacBook do not.** Font metrics
  differ per host, so anything that depends on where text breaks — a flex line, a
  `nowrap` label, a wrapping breadcrumb — can read clean locally and fail in CI on
  the same SHA (HO 694: `/lobbying` at 430 over by 7px in CI twenty minutes after
  a by-hand prod run read 430/430). Prefer rules whose outcome does not depend on
  metrics (`flex-basis: 100%` over a tuned cap; `break-word` over a fixed width),
  and treat the CI reading as the reading for any width gate — a green local run
  is a prediction of it, not a substitute.
- **Every command references a secret by env name (`$CRON_SECRET`), never by
  value** (ruled HO 678). A literal pasted into a command travels through the API
  inside the tool call and lands in the local transcripts — so the value is
  disclosed by the act of running the command, whatever the command does. `curl`
  and `Invoke-WebRequest` headers are where this bites in this repo. The residue
  is visible afterwards in `.claude/settings.local.json`, whose permission
  allowlist records approved commands verbatim: HO 678 found `CRON_SECRET` in
  cleartext six times there and queued the rotation (backlog), because **the
  allowlist entries are the residue, not the cause** — deleting them does not
  un-send the value. Applies to any auth flow too: never
  `vercel login --token <value>`.

## Memory hygiene

- **Memory carries conventions, lessons and open loops** — the things that stay
  true across sessions.
- **Never a HEAD SHA, never "the latest committed handoff", never a next-HO
  pointer.** Those go stale silently, and a stale pointer is acted on exactly as
  if it were current.
- **Project memory and chat history are project-scoped and do not follow the
  repo** (HO 662). Anything that must survive a move belongs in a tracked file.
