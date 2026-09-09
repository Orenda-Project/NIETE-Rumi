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
| Flows are emulated, never rendered | the `flow*` primitives play Meta's client from the stored FLOW_JSON (phase 4); every result carries `via: flow-emulator`, `caps.render` stays `false`, and a component the emulator does not model (PhotoPicker) is refused, not faked |
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

## Phase 4, step 0 — the published Flow definitions, stored

`bot/scripts/e2e/flow-inventory.js fetch` reads every `*_FLOW_ID` from the environment, downloads each
Flow's **published** `FLOW_JSON` asset from Meta by id, and stores it under
`.claude/qa/fixtures/flows/<ENV_VAR>.json` with a `manifest.json` (id, name, status, version, sha256,
fetched-at, component types, actions, and `repoCopy: same | differs | none` against
`infrastructure/flows/`). It needs `WHATSAPP_TOKEN` for the calls and never writes it; take it from the
staging Railway env for that one process.

Census on 2026-09-08 (26 Flows, all PUBLISHED): 23 endpoint (data_exchange), 3 navigate. Sixteen
component types in use — Footer/Form/TextHeading/TextBody everywhere; Dropdown 17, RadioButtonsGroup 14,
CheckboxGroup 12, TextInput 11, TextArea 8, NavigationList 6, EmbeddedLink 5, TextSubheading 3, OptIn 2,
CalendarPicker 2, PhotoPicker 1. No routing-model problems. One drift: the repo's
`registration.json` lacks the `roles` data model the published Flow carries (48 differing leaves) — the
published copy is the truth, and this is exactly the class of gap the fixtures exist to catch.

`node bot/scripts/e2e/flow-inventory.js report --out .claude/qa/fixtures/flows` prints the census offline.
These files are the input to the Flow emulator (step 1, below).

## Phase 4, step 1 — the Flow emulator

`bot/scripts/e2e/flow-emulator.js` plays the WhatsApp client's side of a Flow from the stored JSON:
screens and their visible components, `${data.x}` / `${form.x}` bindings, Form init-values, `visible`
conditions, the routing model (a transition it forbids is `ROUTING_REFUSED`, as on a phone), and the
Footer actions — `navigate`, `complete` (the `nfm_reply` payload, injected into the mock as the
teacher's reply) and `data_exchange`. The data exchange is the real contract, not a stub: the emulator
encrypts each submit exactly as the client does (RSA-OAEP SHA-256 wrapped AES-128-GCM, flipped-IV
response) and posts it to the bot's own `/api/flows/<path>` — proven in tests against the bot's
`flow-encryption.service.js`. The stack mints a keypair per run: the private half goes to the bot as
`FLOW_PRIVATE_KEY_B64`, the public half to the emulator (`flow-public-key.b64` in the run directory).

The mock adapter's `openFlow / flowProbe / flowClick / flowPick / flowType / flowState / flowComplete`
are the same primitives the browser lane has, so the feature scripts are unchanged. Matching is what a
teacher sees: a click finds its text anywhere on a list row (title, description, metadata — `Day 1`
lives in the K-5 row description), `probe().text` is the whole screen as the dialog's innerText would
be, and a miss names what was on screen (`NO_ITEM:x` + `seen: [...]`). The endpoint path per Flow comes
from `bot/scripts/setup/flow-configs.js`.

Proof at `c5f9a0eb` (this branch): **lesson-plan 7 pass · 1 fail · 2 blocked** — the Pick-Class Flow is
walked Grade 1 → English → Ch 1 → Day 1 through four encrypted exchanges and the PDF lands in the outbox
(L01), the secondary-grade path delivers the Oxbridge plan (L03), the Flow chrome reads English (L10); the
one FAIL is L08, the known spec-vs-build finding. **status 3 pass · 1 fail · 1 blocked** — STA01 reads the
in-flight listing through the Status Flow's endpoint; the FAIL is `STA-surface`, the script's deliberate
record that the spec still documents the retired text template. The ledger row carries
`flows: {via: "flow-emulator", opened, completed, refused, flows: [...]}`.

Honest limits: no pixels, so layout, truncation and RTL rendering are still only tested on the WhatsApp
Web lane; `completed` counts real `complete` actions (a script that closes the Flow after the endpoint
has answered, as lesson-plan does, completes none); a scenario whose premise is the account's language
(L10's Urdu teacher) runs against the sandbox driver, which is English.

## Recording the cassette (record once, replayed forever)

The lane cannot call Soniox, OpenRouter or ElevenLabs — the keys file has no vendor keys and the bot
runs `E2E_CASSETTE=replay-strict`, so a vendor call with no recording FAILS the scenario and is logged,
never sent live. The recorded answers live as committed fixtures under `.claude/qa/fixtures/cassettes/`
(one JSON per call, keyed by a request hash), exactly like `fixtures/flows/` holds the Flow definitions.
Recorded once, they are replayed by every run and every clone — no keys, no network.

Populating them is a one-time, un-sealing step that makes LIVE, paid calls, so it is gated:

```
bash .claude/qa/shared/commit-e2e.sh HEAD --features coaching --record
```

`--record` uses a SEPARATE keys file, `keys/niete-record.env`, that carries real vendor keys (and `R2_*`
to mirror) — never the sealed default's `niete-local.env`. It refuses to run if that file is absent, sets
`E2E_CASSETTE=record`, drives the deep pipeline (`DEEP=1`) for real, and writes the answers into
`fixtures/cassettes/`. Review the new files, then commit them. From then on the deep coaching and LLM
scenarios that currently block on "cassette not recorded" run against the real recorded answers with
`DEEP=1`, on every machine, with the lane sealed again.

Never hand-write a cassette: a fabricated transcription or analysis would make the tests assert against
invented data and hide real bugs. A cassette is only ever a real recorded answer.

## What this lane deliberately does not do (yet)

Native Flow rendering (pixels, truncation, RTL), templates, delivery on a phone, and the PhotoPicker
Flow — those stay on the WhatsApp Web lane after the `develop` deploy, which is still the only run that
tests what Meta does with the change. Registration / observe / attendance and training's Flow scenarios
are now emulatable in principle (their Flows are stored and encrypted exchange works) but are not yet on
the lane's feature list.

## Pieces

| Piece | Path |
|---|---|
| Meta seam | `bot/shared/services/whatsapp.service.js` (`WHATSAPP_API_BASE`) |
| Running commit on `/health` | `bot/shared/utils/build-info.js` |
| Mock Graph API | `bot/scripts/e2e/mock-graph-api.js` |
| Inbound builders | `bot/scripts/simulate.js` (`simulateMessage`, `buttonReply`, `listReply`, `mediaMessage`) |
| Stack launcher (redis · mock · bot · worker) | `bot/scripts/e2e/local-stack.sh` |
| Strict cassette | `bot/shared/services/e2e-cassette.js` (`E2E_CASSETTE=replay-strict`, `E2E_CASSETTE_MISS_LOG`) |
| Vendor cassette fixtures + record | `.claude/qa/fixtures/cassettes/` (committed); `commit-e2e.sh --record` + `keys/niete-record.env` to populate |
| Mock driver | `.claude/qa/shared/mock-api.cjs` (selected by `E2E_METHOD=mock` in `feature-runner.cjs`) |
| Runner, profile, ledger | `.claude/qa/shared/run-suite.sh` (`--method`, `--commit`), `whatsapp-targets.yaml` (`niete-local`), `ledger_row.py` |
| Sandbox driver account | `.claude/qa/shared/niete_sandbox_driver.py` |
| Flow definitions + census | `bot/scripts/e2e/flow-inventory.js` → `.claude/qa/fixtures/flows/` |
| Flow emulator (client side of a Flow, encrypted exchange) | `bot/scripts/e2e/flow-emulator.js`, used by `mock-api.cjs` (`E2E_FLOWS_DIR`, `E2E_FLOW_PUBLIC_KEY_B64`, `E2E_BOT_URL`) |
| Tests | `tests/e2e-mock/*.test.js` (54), `.claude/qa/shared/test_mock_api.js` (23), `test_ledger_row.py`, `test_niete_sandbox_driver.py`, `test_preflight.py`, `test_niete_training_db.py`, `.claude/hooks/e2e-autorun.test.sh` |
