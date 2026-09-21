# `.githooks/` → shims into the SHARED E2E engine

`post-commit` and `pre-push` here are four-line shims. The harness they run is not in this repo: it is
authored once in **rumi-agent-home** at `.claude/qa/engine`, and this repo borrows it through a
gitignored symlink at `.claude/qa/engine` (operator, 2026-09-21: *"One shared engine in
rumi-agent-home; commit hook runs the mock lane locally; each bot owns its Gherkin and mock drivers,
cassette fixtures"*).

One command does both halves of the setup, and `npm install` runs it for you via the `prepare` script:

```bash
bash scripts/qa/link-engine.sh      # borrow the engine + set core.hooksPath = .githooks (idempotent)
bash scripts/qa/link-engine.sh --unlink
```

It looks for the engine in `$E2E_ENGINE`, then in any ancestor directory's `.claude/qa/engine`, then in
a sibling `rumi-agent-home` clone. On a machine that has none of those it prints one sentence saying
where the harness lives, exits 0, and commits here behave exactly as they did before the pipeline
existed: they land, and nothing is armed.

`core.hooksPath` stays **inside** this repo on purpose. Pointing it into another tree breaks the moment
that tree moves, and that has already cost one wedged push.

## What this repo owns

| path | what it is |
|---|---|
| `tests/features/whatsapp/niete/*.feature` | the Gherkin, beside the code it describes |
| `.claude/qa/shared/features/*.cjs` | the mock-lane drivers, one per feature |
| `.claude/qa/fixtures/**` | cassettes, Flow JSON, WhatsApp copy |
| `.claude/qa/config/**` | `tenants.yaml`, `feature-map.yaml`, `whatsapp-targets.yaml`, known findings |
| `.claude/qa/agents/**`, `.claude/qa/ledgers/**` | the E2E agent prompts and the run ledger |
| `.claude/qa/shared/niete_*.py` | the NIETE-only database tools the lane calls |

Everything else about the pipeline comes from the shared engine. Map of the whole system:
[`docs/qa-automation.md`](../docs/qa-automation.md).
