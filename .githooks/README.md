# `.githooks/` → moved into the vendored E2E engine (`.claude/qa/engine/githooks/`)

Since bd-9157r.1 the terminal-commit QA hooks (`post-commit`, `pre-push`) live in the **vendored engine**,
`.claude/qa/engine/githooks/`, together with the rest of the pipeline. They are authored in
`rumi-agent-home/.claude/qa/engine` and ported here; do not edit them in this repo (the `qa-engine-guard.sh`
Claude hook refuses, and the next port would overwrite the change).

One local setting makes git use them, and `npm install` (via the root `prepare` script) or a Claude Code session
in this clone sets it for you:

```bash
bash .claude/qa/engine/scripts/install-hooks.sh      # sets core.hooksPath = .claude/qa/engine/githooks (idempotent)
```

Everything this repo owns about the pipeline — the tenant layer — is in `.claude/qa/config/tenants.yaml`,
`.claude/qa/config/feature-map.yaml`, `whatsapp-targets.yaml`, the specs under `tests/features/whatsapp/niete/`,
the drivers under `.claude/qa/shared/features/`, and the `niete_*` tools beside them. Map of the whole system:
[`docs/qa-automation.md`](../docs/qa-automation.md).

`post-commit` and `pre-push` here are two-line shims that exec the engine's hooks, so a clone whose `core.hooksPath` is still `.githooks` (every clone from before the engine) keeps working after the merge with nothing to run. New clones get `core.hooksPath=.claude/qa/engine/githooks` from `npm install` (`prepare`) or from the first Claude session's SessionStart banner, which installs it automatically.
