# `.githooks/` — what git runs for a commit made from a terminal

Git does not run hooks from a tracked directory by itself. These travel with the clone; one local setting makes git
use them:

```bash
bash scripts/qa/link-engine.sh        # links the shared E2E engine, sets core.hooksPath = .githooks (idempotent)
```

`npm install` at the repo root runs the same thing through the guarded `prepare` script, so a normal setup already has
them. `--unlink` removes the engine link and leaves the repo untouched; a `core.hooksPath` that points somewhere else is
left alone.

| Hook | Fires on | Does | Never |
|---|---|---|---|
| `pre-commit` | every commit | refreshes the code map: `python3 kg/heal.py precommit` rebuilds the graph, re-renders the existing doors (`CLAUDE.md`) the commit moved and stages them | warn only, never blocks: gives up after 3 s (the nightly keeper heals), never stages a file that also holds your unstaged edits (`KG_PRECOMMIT_OFF=1` skips it) |
| `post-commit` | every commit | a shim: links the shared E2E engine in when this clone has none (`scripts/qa/link-engine.sh`), then runs the engine's `githooks/post-commit` — maps the commit's files to E2E features (`feature-map.yaml`), writes the Gherkin sync brief and the pending marker (`.claude/.e2e-pending/`), starts the mock lane in the background | blocks a commit; does anything when no engine is on the machine |
| `pre-push` | a push | a shim to the engine's `githooks/pre-push`: the impact report over the commits being sent (affected features, whether their `.feature` files were synced, the commands) | blocks, unless `QA_HOOKS_STRICT=1` |

`pre-commit` is this repo's own (the vendored code-map tool in `kg/`). `post-commit` and `pre-push` are the shared engine's:
the two files here are its shim templates, byte for byte. The E2E half — what the engine's two hooks do, their switches (`QA_HOOKS_OFF`, `QA_HOOKS_QUIET`, `QA_HOOKS_STRICT`),
the off-switch ledger and its git notes — lives with the shared engine, authored in rumi-agent-home:
[`.claude/qa/engine/githooks/README.md`](../.claude/qa/engine/githooks/README.md) (bd-9157r.1). What happens after a
commit is in [`docs/qa-automation.md`](../docs/qa-automation.md).

Tests: `bash scripts/qa/engine-bridge.test.sh` (this directory holds exactly these three hooks and this page) ·
`bash .claude/qa/engine/githooks/githooks.test.sh` (the E2E hooks themselves).
