# Sovereign Connections — Claude Code Handoff #2

## State at handoff

The first scaffold pass is mostly complete. What's on disk:

- README.md and PROJECT.md at repo root
- Directory tree per the README's Architecture block: docs/, data/, collectors/, .github/workflows/
- Four data JSON files initialized as empty arrays: records.json, candidates.json, sovereign_entities.json, connected_businesses.json
- Six collector Python stubs with module docstrings describing source and cadence, and main() raising NotImplementedError: oge_278_collector.py, sec_edgar_collector.py, pacer_collector.py, fara_collector.py, cfius_collector.py, foreign_registry_collector.py
- collectors/__init__.py
- .github/workflows/.gitkeep (workflow file deferred in session #1; directory preserved with no YAML)
- .gitignore at repo root

What's pending:

- LICENSE: session #1 hit a content-filter block when generating CC-BY-4.0 text. The user is adding the file manually via GitHub's web UI license picker, the curl-from-creativecommons.org path, or pasting the canonical legal code. When this session runs, verify LICENSE is at the repo root before committing. Don't try to generate the license text again.
- docs/changelog.md: should exist with the creation entry. Confirm presence; create if missing. Sister repos don't have a changelog convention to mirror, so the format is being set here.
- Commits and push: the work isn't committed yet. The original handoff specified three logical groups.

## Open verification question

The .gitignore from session #1 reads:

```
.claude/
__pycache__/
*.pyc

# Working artifacts: handoff docs and decision notes pasted in from Claude.ai
# sessions. Kept on disk for reference but not committed.
handoffs/
CLAUDE_CODE_HANDOFF.md
foreign-sovereign-first-session-handoff.md
```

The directory pattern (`handoffs/`) and the two named files cover overlapping ground depending on where the files actually live. Verify the location of the two named handoff files. If they're at the repo root, the directory line is dead weight. If they're inside a `handoffs/` subdirectory, the named-file lines are dead weight.

Recommendation: move all handoff artifacts into a `handoffs/` directory and remove the named-file lines from .gitignore. This handoff doc (claude-code-handoff-2.md) goes in the same directory. The naming convention then becomes "handoffs live in handoffs/", which is easier to keep consistent than the current mix of uppercase-underscored and lowercase-hyphenated filenames at the root.

If you'd rather keep them at root, fine, but drop the directory line and add this handoff to the named-file list.

## Tasks, in order

1. Verify LICENSE is present at repo root. If not, stop and ask the user. Don't try to generate license text.
2. Verify docs/changelog.md exists. If not, create it with the entry: today's date, "Repo created. README and PROJECT.md drafted. Defined terms fixed at v1. No data collected yet."
3. Resolve the .gitignore-vs-handoff-location question above. Make one consistent choice and apply it.
4. Stage and commit in three logical groups:
   - Commit 1: scope docs (README.md, PROJECT.md, LICENSE)
   - Commit 2: directory skeleton (docs/, data/, collectors/, .github/)
   - Commit 3: housekeeping (.gitignore, docs/changelog.md)
5. Verify `git log --oneline` shows three distinct commits, not one squash.
6. Push to main.
7. Confirm a fresh `git clone` produces a tree matching the README's Architecture block.

## What NOT to do

- Don't build any collectors. Stubs stay as stubs.
- Don't populate data files with records.
- Don't add a workflow YAML. The empty .github/workflows/ directory is correct.
- Don't write the methodology page. That's the next piece of writing in a different session.
- Don't deploy or publish anything. Status stays pre-launch.
- Don't try to regenerate LICENSE text. The content filter blocked it once already.

## Definition of done

- LICENSE present at root (CC-BY-4.0).
- docs/changelog.md present with the creation entry.
- .gitignore is internally consistent: either directory-only OR named-files-only, not both for the same artifact.
- Three distinct commits visible in `git log --oneline`.
- `git status` clean after push.
- Fresh clone matches the README's Architecture block exactly.

## House style for anything written this pass

PROJECT.md sets the rules. For commit messages, the changelog entry, and anything else generated:

- No em-dashes
- Direct prose, point first, specific over vague
- Match the sister repos' commit-message tone where they set one (Follow-the-Moneys is the more mature reference)
- No AI-marker phrasing (the banned-word list in PROJECT.md applies)

## What's next, after this session

Repo lands at "scaffold complete, no records collected yet." The next piece of work is the methodology post — post one in the publication queue. That's a writing task, not a Claude Code task. Claude Code's next likely involvement is when the first real collector gets built, probably OGE 278, since both Affinity Partners and the Trump Org bookings should surface in those filings first.
