# /sync-specs — sync the Gherkin specs to what the code now does

Phase 1 of the commit-triggered E2E auto-run. Brings
`tests/features/whatsapp/niete/*.feature` back in line with a change, then
validates them so phase 2 (`/niete-e2e`) drives specs that describe the CURRENT
behaviour instead of the behaviour they were written for.

Full procedure: [`gherkin-spec-sync`](../skills/gherkin-spec-sync/SKILL.md).
**Follow it — do not free-hand the sync.**

## Use

```
/sync-specs                              # sync whatever the HEAD commit touched
/sync-specs --brief <path/to/sync.json>  # the hook passes the brief it already built
/sync-specs menu status                  # just these features
```

`$ARGUMENTS` is either `--brief <file>`, a list of feature names, or empty.

## What to do

1. **Get the brief.** With `--brief`, read that file — it is already built and is
   the same selection that armed the run, so do not recompute it. Otherwise:
   ```bash
   python3 .claude/qa/shared/spec_sync.py --repo <repo> --committed --json
   ```
2. **Invoke the `gherkin-spec-sync` skill and follow it exactly.** Per feature:
   `create` · `update` · `validate-only`, from the brief's `action`.
3. **Author through [`gherkin-test-cases`](../skills/gherkin-test-cases/SKILL.md)** —
   the same skill `/testcases` runs. `gherkin-spec-sync` decides *what* the diff
   changes about coverage; `gherkin-test-cases` decides *how* the scenario is
   written (risk model, positive-first order, quality gate). Do not free-hand a
   scenario.
4. **Never delete a scenario** — tag it `@obsolete` with a
   `# OBSOLETE <date> (<bead>): <why>` line and raise it as an explicit ask.
5. **`only_shared: true` usually means change nothing** — that feature was pulled
   in by a fan-out file, not by a change to its own surface.
6. **Gate on the validator:**
   ```bash
   python3 .claude/qa/shared/validate_specs.py --only <features>
   ```
   Exit 1 → do NOT run the suite. Fix, or say phase 2 is skipped and why.
7. **RELEASE phase 2.** When the validator is green, stamp the release — the
   runners (`commit-e2e.sh`, `run-suite.sh`) mechanically REFUSE to drive this
   commit until you do, so an unsynced spec cannot reach the suite:
   ```bash
   python3 .claude/qa/shared/spec_sync.py --release <path/to/sync.json>
   ```
   It re-runs the validator itself and writes the per-commit stamp only on exit 0.
   With `--brief`, that path is the same file you were handed.
8. If a scenario count changed, update the counts in
   [`niete-e2e.md`](niete-e2e.md) and re-run `check-all-mode-counts.py`.

Report what changed per feature, the validator result, every `@obsolete` you
added, and that you released. Then run phase 2.
