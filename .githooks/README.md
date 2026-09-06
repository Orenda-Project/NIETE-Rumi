# `.githooks/` — the QA pipeline for commits made from a terminal

Git does not run hooks from a tracked directory by itself. These travel with the
clone; one local setting makes git use them:

```bash
bash scripts/qa/install-hooks.sh      # sets core.hooksPath = .githooks (idempotent)
```

`npm install` at the repo root runs the same thing through the `prepare` script,
so a normal setup already has them. `--uninstall` removes the setting; `--force`
takes over a `core.hooksPath` that points somewhere else (by default it refuses
and tells you).

| Hook | Fires on | Does | Never |
|---|---|---|---|
| `post-commit` | every commit | maps the commit's files to E2E features (`feature-map.yaml`), builds the Gherkin sync brief, writes `.claude/.e2e-pending/git-<sha>.json` + `.sync.json`, prints the affected features and the two commands | fails the commit; writes anything outside `.claude/.e2e-pending/` (gitignored) |
| `pre-push` | a push to `develop` / `main` / `staging` | runs `scripts/qa/ci_impact.py` over the commits being sent: affected features, whether their `.feature` files were synced, the commands | blocks, unless `QA_HOOKS_STRICT=1` |

What happens next is in [`docs/qa-automation.md`](../docs/qa-automation.md): the
next Claude Code session in the clone is told about the pending marker at start
and held once at end of turn until the specs are synced and the targeted E2E is
driven — and CI checks the same things on the PR regardless of machine.

Switches: `QA_HOOKS_OFF=1` (both hooks silent) · `QA_HOOKS_QUIET=1` (post-commit
arms but prints nothing) · `QA_HOOKS_STRICT=1` (pre-push blocks on a stale spec).

Tests: `bash .githooks/githooks.test.sh`.
