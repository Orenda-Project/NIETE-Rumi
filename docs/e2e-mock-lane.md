# The E2E mock lane — a commit, tested on this machine, with no browser and no WhatsApp number

**Features on the lane:** menu · language · status (phase 1) · lesson-plan · coaching · training (phase 2). **Owner:** the repo.

The WhatsApp Web lane (`/niete-e2e`, `method: chrome`) can only test whatever build is deployed on
staging, so a run armed by a *commit* was always a regression check of the previous build. This lane
closes that gap: the bot starts **from the commit itself**, behind a local stand-in for Meta's Graph
API, and the same feature scripts drive it through the same primitives.

```
commit
  → select_e2e.py            which features did the diff touch
  → spec_sync.py             the Gherkin sync brief (authoring is an agent step: /sync-specs)
  → validate_specs.py        gate: errors → nothing is driven
  → local-stack.sh up <sha>  detached git worktree at EXACTLY that sha; /health must report it
  → mock-graph-api.js        stands in for graph.facebook.com (WHATSAPP_API_BASE)
  → feature-runner.cjs       E2E_METHOD=mock → mock-api.cjs, same primitives as the CDP driver
  → runs.jsonl               one row per feature, tied to commit_sha, dirty, cassette, spec_sync
```

## One command

```bash
bash .claude/qa/shared/commit-e2e.sh HEAD                      # what this commit touched (mock-capable subset)
bash .claude/qa/shared/commit-e2e.sh <sha> --features menu     # a specific feature
bash .claude/qa/shared/commit-e2e.sh HEAD --all-mock           # every mock-lane feature regardless of the diff
```

Or the runner directly: `bash .claude/qa/shared/run-suite.sh menu,status --method mock --commit <sha>`.
Every existing chrome invocation is unchanged; `--method` defaults from `whatsapp-targets.yaml`.

## What is guaranteed

| Guarantee | How |
|---|---|
| The code under test is the commit, never the developer's tree | `git worktree add --detach <run_dir>/src <sha>`; `git status --porcelain` there is asserted empty |
| The running bot is that commit | `/health` returns `commit` (`E2E_COMMIT_SHA`, or `RAILWAY_GIT_COMMIT_SHA` on Railway); `local-stack.sh` refuses to drive a mismatch (exit 13) |
| Installed deps match the commit's lockfiles | root and bot `package-lock.json` blobs at the sha must equal the installed trees' (exit 10) |
| No live vendor call | `E2E_CASSETTE=replay-strict`: a hit replays, a miss **throws** `E2E_CASSETTE_MISS`, is logged to `cassette-misses.jsonl`, and makes the ledger row `CRITICAL` naming the scenarios it hit |
| No production or staging data | the bot runs on the **sandbox** Supabase (`keys/niete-local.env`); the cassette and the DB tooling both refuse any other project ref |
| Flows are never faked | every `flow*` primitive answers `MOCK_NO_FLOW_RENDER`; Flow scenarios record `BLOCKED`/`SKIP` through their own branches |
| Meta's field caps are enforced | the mock rejects header/footer > 60, button > 20, row title > 24, > 3 buttons, > 10 rows — counted in **code points**, like Meta |

## Setup (once per machine)

1. `keys/niete-local.env` next to `keys/niete-sandbox.env`: the two sandbox Supabase lines, placeholders for
   `WHATSAPP_TOKEN` / `WEBHOOK_VERIFY_TOKEN` / `WABA_ID` / `OPENROUTER_API_KEY=cassette-only…`, and from the
   staging Railway env ONLY the storage + Flow-id lines (`R2_*`, `*_FLOW_ID`, `PORTAL_URL`), e.g.
   `railway variables -p "NIETE-Rumi Staging" -s bot --environment staging --kv | grep -E '^(R2_|[A-Z_]+_FLOW_ID=|PORTAL_URL=)'`.
   No vendor API key belongs in it — that absence is what keeps the lane offline. `QUEUE_DRIVER`, `REDIS_URL`
   and the run's own values are appended per run by `local-stack.sh`.
1b. `redis-server` on PATH (`brew install redis`): the stack starts a private instance per run.
2. Installed dependencies whose lockfiles match the commit under test. If the main checkout's install is
   stale, point the stack at a fresh one: `E2E_NODE_MODULES_ROOT=<dir with node_modules>` (root set) and
   `E2E_BOT_NODE_MODULES_ROOT=<dir with bot/node_modules>`.
3. A cassette library for the LLM turns the three features make (Ask Anything, gibberish, "what can you do",
   the `hello` after a language switch). Record once against staging with `E2E_CASSETTE=record`; until then
   those scenarios run against the bot's error path and the row says so.

## Reading a row

```json
{"method":"mock","env":"sandbox","feature":"menu","status":"CRITICAL",
 "summary":{"total":12,"passed":11,"failed":1,"blocked":0,"skipped":0},
 "commit_sha":"<40 hex>","branch":"…","dirty":false,"dirty_files":0,
 "cassette":{"mode":"replay-strict","misses":7,"scenarios_affected":["M08","M09","M12"],"note":"…record once…"},
 "stack":{"bot_url":"http://127.0.0.1:3100","mock_url":"http://127.0.0.1:4010","worktree":"…/src","lock_blob":"…"},
 "spec_sync":{"brief":null,"validator_exit":0}}
```

`dirty` describes the **developer's** tree at run time (minus the ledger/results the runner writes); the bot
itself always ran from a clean worktree at `commit_sha`. A `PASS` listed under `scenarios_affected` is not
evidence: the bot answered from its error path because a vendor answer was missing.

## Phase 2 — media and the pipelines

The stack now runs **four** processes: a private `redis-server` (its own port, nothing persisted,
dies with the run), the mock Graph API, the bot, and `bot/workers/sqs-worker.js` on
`QUEUE_DRIVER=bullmq`. Coaching and lesson-plan jobs therefore travel the same queue path as on
Railway, minus AWS.

**Media.** The mock serves the Graph API's media surface: `POST /<v>/<phone>/media` (the bot's
uploads, multipart), `GET /<v>/<media_id>` (metadata with a `url`), and the bytes behind that url.
The runner's `upload(file, 'Document' | 'Photos & videos' | 'Audio')` registers a fixture and forges
the matching document / image / audio message, so `downloadMedia()` in the bot fetches the real bytes
back exactly as with Meta. Outbound media (the coaching PDF, a voice note) lands in the outbox with
`img` / `audio` / `doc` / `pdf` flags and, when uploaded by id, the byte count and sha256 — evidence
the browser lane cannot produce. Both drivers expose `fresh()` / `freshReset()`, the inbound reader
the pipeline walkers use.

**Vendors.** Still `replay-strict`. `keys/niete-local.env` carries the **staging R2** credentials so
(a) the cassette mirror is read from staging's recorded library — the 16-minute classroom fixture's
Soniox transcription replays from there — and (b) the pipeline's own audio upload has a bucket. It
carries **no vendor API key at all**: the handful of services that construct their own OpenAI
client instead of going through `llm-client` (coaching-helpers, quiz, audio, elevenlabs) fail closed
and fall back, which the logs show as "using fallback". A miss on a wrapped call is still a loud
`E2E_CASSETTE_MISS` attributed to its scenario.

**What a Phase 2 run proves today** (2026-09-08): lesson-plan 4 pass · 1 fail · 5 blocked (the Flow
scenarios, as designed); coaching 4 pass · 1 fail · 2 blocked · 9 skipped (`DEEP=1` scenarios);
training 6 pass · 0 fail · 11 blocked (the native Training Flow and account-state-gated scenarios) in
75 seconds — its entry points, the two-word negative, statelessness and the certificates surface. The coaching pipeline reaches Step 1, replays the transcription from the
mirror, and asks for the classroom photo; the shallow script declines by ignoring, so COA04 records
the stall it would also record on chrome without `DEEP=1`. Run `DEEP=1` to walk the whole pipeline;
its LLM calls will miss until the library holds them.

## What this lane deliberately does not do (yet)

Native Flow rendering, templates, delivery on a phone, and registration / observe / attendance
(Flow-first features; training's Flow scenarios likewise stay on chrome) — those stay on the WhatsApp Web lane after the `develop` deploy,
which is still the only run that tests what Meta does with the change.

## Pieces

| Piece | Path |
|---|---|
| Meta seam | `bot/shared/services/whatsapp.service.js` (`WHATSAPP_API_BASE`) |
| Running commit on `/health` | `bot/shared/utils/build-info.js` |
| Mock Graph API | `bot/scripts/e2e/mock-graph-api.js` |
| Inbound builders | `bot/scripts/simulate.js` (`simulateMessage`, `buttonReply`, `listReply`, `mediaMessage`) |
| Stack launcher (redis · mock · bot · worker) | `bot/scripts/e2e/local-stack.sh` |
| Strict cassette | `bot/shared/services/e2e-cassette.js` (`E2E_CASSETTE=replay-strict`, `E2E_CASSETTE_MISS_LOG`) |
| Mock driver | `.claude/qa/shared/mock-api.cjs` (selected by `E2E_METHOD=mock` in `feature-runner.cjs`) |
| Runner, profile, ledger | `.claude/qa/shared/run-suite.sh` (`--method`, `--commit`), `whatsapp-targets.yaml` (`niete-local`), `ledger_row.py` |
| Sandbox driver account | `.claude/qa/shared/niete_sandbox_driver.py` |
| Tests | `tests/e2e-mock/*.test.js`, `.claude/qa/shared/test_mock_api.js`, `test_ledger_row.py`, `test_preflight.py`, `test_niete_training_db.py`, `.claude/hooks/e2e-autorun.test.sh` |
