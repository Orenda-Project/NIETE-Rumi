# Exit codes — mock lane

Three scripts, three code spaces. `commit-e2e.sh` exit `3` wraps whatever the stack returned;
the stack's own code is in the run log.

## `commit-e2e.sh` (`.claude/qa/shared/`)

| Exit | Meaning | Next |
|---|---|---|
| 0 | It ran, or nothing was selected (it says so) | read the printed rows — the verdicts are there, not in the exit code |
| 1 | `validate_specs.py` found errors — nothing driven | fix the `.feature` (or run `/sync-specs --brief <file>` from the printed line) |
| 2 | usage: bad ref, bad flag, or `--record` without `keys/niete-record.env` | as printed |
| 3 | the stack or the run was blocked | open the run log, find the `local-stack.sh` code below |

## `local-stack.sh up` (`bot/scripts/e2e/`)

| Exit | Meaning | Fix |
|---|---|---|
| 10 | no `node_modules` for this commit's lockfile (npm missing, or the private install failed) | install npm; or point `E2E_NODE_MODULES_ROOT` / `E2E_BOT_NODE_MODULES_ROOT` at a tree built from that lockfile |
| 11 | worktree failed: unknown commit, `git worktree add` failed, wrong sha, or tree not clean | `git fetch`; check the sha exists locally |
| 12 | bot not healthy on its port after 60s | `<run_dir>/bot.log` |
| 13 | `/health` reports a different commit than asked — refuses to drive | the branch lacks `bot/shared/utils/build-info.js` / the `/health` `commit` field (not a `sandbox`-based branch) |
| 14 | `keys/niete-local.env` missing, or bad `E2E_CASSETTE_MODE` | §2 of SKILL.md — `railway login` + project access, or `--from-kv` |
| 15 | mock Graph API not healthy | `<run_dir>/mock.log` |
| 16 | `redis-server` missing or not answering | `brew install redis`; `<run_dir>/redis.log` |
| 17 | queue worker not healthy after 60s | `<run_dir>/worker.log` |

## `provision-local-keys.sh` (`bot/scripts/e2e/`)

| Exit | Meaning | Fix |
|---|---|---|
| 0 | wrote `keys/niete-local.env` (and `niete-sandbox.env` if it was absent) | — |
| 2 | a hand-made `niete-sandbox.env` lacks `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | add both lines |
| 3 | the sandbox lines point at a **non-sandbox** Supabase project — refused | the file or Railway env is wrong; never override this |
| 4 | target exists | nothing to do; `--force` rebuilds it |
| 5 | Railway CLI missing, not logged in, or the account has **no access to "NIETE-Rumi Staging"** | install `railway`, `railway login`, get the account invited; or `--from-kv <file>` + a hand-made `niete-sandbox.env` |
| 6 | Railway answered but the expected variables are not there | wrong project / service / environment |
