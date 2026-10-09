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

To run features by name — always the mock lane, always the local database (`/e2e-mock` in Claude Code):

```bash
npm run e2e:mock                                  # the safe subset
npm run e2e:mock -- training                      # every scenario of one feature
npm run e2e:mock -- training,menu                 # several features at once, one slot each
npm run e2e:mock -- all                           # every feature at once
npm run e2e:mock -- coaching --only 'coaching=COA09,COA20'
```

To test what a commit touched:

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
| No shared data at all (the default) | every run gets its **own local database** (Postgres 17 + PostgREST, copied in ~1.4 s from a golden built from the committed sandbox schema + a per-machine reference-data snapshot) and its **own file store** (`local-r2.js`: writes stay in the run, unwritten keys read through from staging, read-only). Both are dropped after the run. See *The local lane* below |
| No production or staging writes | the DB tooling (Python `--env local`, Node `db-target.cjs`) only accepts 127.0.0.1 on a local run; with `E2E_LOCAL_DB=0` the bot runs on the **sandbox** Supabase (`keys/niete-local.env`), and the cassette and the DB tooling refuse any other project ref |
| One driver row per machine | the synthetic driver is derived from `hostname\|user` (`mock_driver.py`, `92300XXXXXXX`; `E2E_MOCK_DRIVER` pins it) and `ensure`d on first use; on the sandbox (`E2E_LOCAL_DB=0`) that is what keeps two machines off each other's rows. The run lock (`driver_lock.py`) guards same-machine runs, and a `--slot` whose ports are busy is refused (bd-d2zge) |
| Flows are emulated, never rendered | the `flow*` primitives play Meta's client from the stored FLOW_JSON (phase 4); every result carries `via: flow-emulator`, `caps.render` stays `false`, and a component the emulator does not model (PhotoPicker) is refused, not faked |
| Meta's field caps are enforced | the mock rejects header/footer > 60, button > 20, row title > 24, > 3 buttons, > 10 rows — counted in **code points**, like Meta |

## The local lane — the default (bd-z3ze4)

Every mock-lane run uses its own throwaway database and file store; nothing is shared with the sandbox or with
another run. `E2E_LOCAL_DB=0` opts a run out to the shared sandbox database and staging's R2, as before.

**A run needs no Railway, sandbox or staging access** (bd-z3ze4.5): no keys file, no `railway` call, no staging read.
The bot's settings (Flow ids, `PORTAL_URL`, placeholders, bucket name) come from the committed
`.claude/qa/config/local-lane.env`; the staging files a run reads (`supabase/baseline/seed-files.txt`, 4 files, 0.3 MB)
are served from the per-machine snapshot. The snapshot itself is a **small seed** (bd-z3ze4.7): only the reference rows the tests read (measured with
`bot/scripts/e2e/seed-rows-used.js`; 13 MB instead of 176 MB), released as one asset on the **private** repo
`Orenda-Project/niete-e2e-fixtures`. This public repo commits only the pointer
(`supabase/baseline/seed-release.txt`: tag + sha256) and the keep-list of row ids (`seed-keep.json`) — never content.

**What an operator needs:** `gh` signed in (`gh auth login`) with access to `Orenda-Project/niete-e2e-fixtures`
(ask an org admin). That's all — no Railway. The first run downloads the seed (checksum-verified); a `git pull`
that brings a new pointer makes the next run download the new one. Missing `gh` is installed with brew on a Mac,
with apt on Linux (see below).

**Maintainers (sandbox access) publishing a new seed:** `local-db.sh seed-pull --from-sandbox` (full data),
replay a run's `db/queries.log` with `seed-rows-used.js` to refresh `seed-keep.json` if tests changed, then
`local-db.sh seed-publish` (trims, packages, releases privately, writes the pointer) and commit the pointer.

**A new machine sets itself up** the first time `run-suite.sh` or `commit-e2e.sh` runs (both call
`e2e_mock_lane_autofix --with-redis`; never from inside `git commit`, so a commit is never held up):

| Step | Who | When |
|---|---|---|
| `gh auth login` (an account in the Orenda-Project org) | **you** — the one manual step | once |
| Mac: `brew install postgresql@17 pgvector postgrest gh` | automatic | first run |
| Linux: `local-db.sh install-tools` — see below | automatic, or **you** once if sudo needs a password | first run |
| reference-data seed: `local-db.sh seed-pull` (13.6 MB, private release) into `~/.cache/niete-e2e-db/seed` | automatic | first run, and again when `seed-release.txt` changes |
| golden database (schema + snapshot + `seed-overrides.sql`, ~12 s) | automatic | first run after a schema/snapshot change |
| a fresh copy per run (~1.4 s), dropped at `down` | automatic | every run |

**Linux (Ubuntu/Debian; no Homebrew).** `bash bot/scripts/e2e/local-db.sh install-tools` installs PostgREST as the
static binary from its GitHub release into `~/.cache/niete-e2e-db/bin` (no root), and Postgres 17 + pgvector
(`postgresql-17`, `postgresql-17-pgvector` from the PGDG apt repo) and `gh` with apt. The run calls it by itself; the
apt part runs only as root or when `sudo` needs no password, because a hook must never wait on a password prompt.
Otherwise the run stops and prints the command: run `install-tools` once yourself in a terminal, where sudo can ask.
Port checks use `ss` when `lsof` is missing. Verified on GitHub's Ubuntu 22.04, 24.04 and 24.04-arm runners
(install, the real schema, PostgREST, supabase-js). Other distros (Fedora, Arch): install Postgres 17, pgvector and
PostgREST yourself; `LOCAL_DB_PG_BIN` points at a Postgres 17 `bin/` the script does not find on its own.

What is committed vs per machine:

| Committed | Per machine, never committed |
|---|---|
| `supabase/baseline/schema.sql` — the sandbox schema, no rows (regenerate: `local-db.sh baseline`) | the reference-data snapshot (part of it is the restricted ICT corpus) |
| `supabase/baseline/seed-tables.txt` — which reference tables are pulled (never a per-teacher table) | the Postgres cluster (`~/.cache/niete-e2e-db/pg17`) |
| `supabase/baseline/seed-overrides.sql` — the lane's own state for global switches (`app_redirect_*` off) | |

Check a machine: `bash bot/scripts/e2e/local-db.sh doctor` (prints what is missing; silent when ready).
Schema drift: `bash bot/scripts/e2e/local-db.sh drift` compares `supabase/baseline/schema.objects.txt` (every
public column + function, written by `baseline`) with the live sandbox in ~4 s and names what differs. It needs
sandbox access, so it is a **maintainer/CI** step; a run checks it only with `E2E_DRIFT_CHECK=1` (a warning, never
a block). Fix: `local-db.sh baseline`, then commit `schema.sql` + `schema.objects.txt`.
Without a snapshot, `local-db.sh up` **refuses** (exit 9) rather than run every scenario on an empty database.

Parallel: `run-suite.sh … --parallel` gives each feature a slot with its own database, PostgREST, proxy and file
store ports (`slot_ports`); the shared cluster and golden build are serialised by a lock. All nine mock-capable
features run in ~35 min (sequential ~100 min).

What the private database makes possible: scenarios that need a GLOBAL switch (`app_redirect_*`: M20, L11,
COA62, T92, T93) flip it for their own run via `api.setAppSetting` (`app-redirect-case.cjs`) and put it back;
on the sandbox they stay BLOCKED, since the switch would reach every tester.

## Setup (automatic — no manual step)

1. `keys/niete-local.env` is **provisioned for you**. The SessionStart banner, `.githooks/post-commit` and
   `commit-e2e.sh` all call `e2e_mock_lane_autofix` (`.claude/hooks/lib/mock-lane.sh`), which runs
   `bot/scripts/e2e/provision-local-keys.sh --quiet` whenever the file is missing:
   - the two sandbox Supabase lines come from the **Railway sandbox environment** (or from a hand-made
     `keys/niete-sandbox.env` if one exists); the project ref is asserted against `ENV_REFS` in
     `niete_training_db.py` and anything but the sandbox ref is refused. `niete-sandbox.env` is written too, so
     the DB tooling works without a step of its own;
   - from the **staging** Railway env ONLY the storage + Flow-id + portal lines (`R2_*`, `*_FLOW_ID`, `PORTAL_URL`);
   - placeholders for `WHATSAPP_TOKEN` / `WEBHOOK_VERIFY_TOKEN` / `WABA_ID` / `OPENROUTER_API_KEY=cassette-only…`.
     No vendor API key is ever copied — that absence is what keeps the lane offline.
   It never overwrites (`--force`), never prints a value, writes `0600`, and lands the file next to any existing
   `keys/niete-sandbox.env` (repo `keys/` or the workspace-level `keys/`, the two places `local-stack.sh` looks).
   `QUEUE_DRIVER`, `REDIS_URL` and the run's own values are appended per run by `local-stack.sh`.

   **The one per-machine fact this cannot create is `railway login`** (an account with access to the
   "NIETE-Rumi Staging" project). Without it the banner / hook say exactly that, and nothing else — the keys
   are provisioned on the next session or commit once you are logged in. A machine with no Railway access can
   still be fed a teammate's dump: `provision-local-keys.sh --from-kv team.kv` covers the staging half.
   `E2E_AUTOFIX_OFF=1` disables the autofix (CI, tests).

   Before 2026-09-18 the first signal of a missing file was exit 14 deep inside `local-stack.sh`, on the agent's
   turn — which is how a PR could ship with the ledger reading `e2e: missing`.
1b. `redis-server` — `commit-e2e.sh` installs it automatically (`brew install redis`) when brew is present; the
   stack starts a private instance per run.
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
scenarios, as designed); coaching 4 pass · 1 fail · 2 blocked · 9 skipped (`DEEP=1` scenarios). The
coaching pipeline reaches Step 1, replays the transcription from the mirror, and asks for the
classroom photo; the shallow script declines by ignoring, so COA04 records the stall it would also
record on chrome without `DEEP=1`. Run `DEEP=1` to walk the whole pipeline; its LLM calls will miss
until the library holds them.

**Training grew from 6 scenarios to all 83** (2026-09-30, #1200). The quiz-generation scenarios
needed levers the product itself does not expose to a script — a job enqueued or run right now, a
lesson document seeded into R2 under the lane's own key, a process restarted with one env var
flipped, a Redis key filled or dropped, a vendor call forced to answer badly on demand — and those
levers surfaced two real bugs rather than test gaps: `quiz_offer`/`quiz_generate` were queued
through `../queue/sqs-queue.service` directly instead of the pluggable driver index, so nothing
reached BullMQ on the mock lane (bd-2aetj); and the worker's own gate for polling the `quiz`/`video`
queues checked only the SQS-specific `SQS_QUIZ_QUEUE_URL`/`SQS_VIDEO_QUEUE_URL` env vars, so under
`QUEUE_DRIVER=bullmq` a queued quiz sat "generating" forever (bd-p99wn, twin of bd-2aetj). Both are
fixed on `sandbox`. The training feature file's full run on the pushed head: **81 pass · 3 fail · 1
blocked of 83**. See `.claude/qa/shared/training-quiz-gen.cjs` for the generation cluster (T25 T28
T29, T46–T84) and its owned-id list, and the new levers below.

### New mock-lane levers (2026-09-30, #1200)

The stack now sets three more things per run (`local-stack.sh`): `QUIZ_LP612_SOURCE=on` (quizzes can
draw from a Grades 6-12 lesson, not just a coaching transcript), `VIDEO_QUIZ_JOIN_LOCK_SECS=5` (the
class-quiz join lock is a minute in production; a rejoin scenario cannot wait that long), and
`E2E_CASSETTE_FAULTS=<run_dir>/cassette-faults.json` (see below). Suite pacing for the mock method
(`run-suite.sh`): `E2E_JOIN_LOCK_SECS` (mirrors `VIDEO_QUIZ_JOIN_LOCK_SECS`) and `E2E_QUIESCE_MS`
(default 800ms — how long the mock waits for a burst of outbound sends to quiet down before reading
the outbox).

- **A job, on demand.** `bot/scripts/e2e/quiz-job.js enqueue <jobType> <groupId> '<payload>'
  [delaySeconds]` puts one quiz job in front of the real queue driver, so the worker consumes it
  exactly as production would. `quiz-job.js run <jobType> <groupId> '<payload>'` calls the handler
  directly in-process instead, for a case the worker would otherwise defer (a nudge inside the
  21:00–07:00 PKT quiet window re-queues itself until morning; a scenario cannot wait for that).
  Handles `quiz_nudge_teacher` and `quiz_video_report`. Refuses the NIETE production project.
- **A Grades 6-12 lesson document, on demand.** `bot/scripts/e2e/lp612-doc.js put <segment_id>
  <lang> <template_version> <doc.json>` / `rm <segment_id> <lang> <template_version>` puts or
  removes one lesson document in the lane's R2 bucket, under exactly the key the product computes
  (`lp612-serving.service.js`'s `docKeyFor`) — needed because the backfilled 6-12 deliveries on
  sandbox point at renders whose documents live in a different bucket. `template_version` must start
  with `qa-`, so a seed can never collide with a real render's key.
- **A resolver fallback for a flaky machine.** `bot/scripts/e2e/dns-pin.js`, preloaded by
  `local-stack.sh` via `NODE_OPTIONS`, answers a hostname from the public resolvers (1.1.1.1 / 8.8.8.8)
  when the OS resolver fails — the run machine has lost its router's DNS mid-run for 15+ minutes on
  four separate occasions. The OS resolver is always tried first. `E2E_DNS_FALLBACK=off` disables it.
- **A process restarted with a switch flipped.** `bot/scripts/e2e/local-stack.sh restart bot|worker
  <run_dir> [KEY=VAL ...]` kills and relaunches one stack process with env overrides layered on the
  composed `.env` — how a scenario proves a config-gated behaviour changes when the flag does
  (training T72/T73), without tearing down the whole stack.
- **A scripted vendor answer.** `E2E_CASSETTE_FAULTS` names a JSON file of rules
  (`[{kind, match, times, content|throw}]`, `kind` one of `asr`/`llm`/`tts`) that `e2e-cassette.js`
  answers instead of the cassette or the vendor when the request's normalised text matches — a
  scenario's only way to force "the model gave no usable reply" or "the author never passed the
  checks" on demand. Rule shape and file validation are documented in the module's own header
  (`bot/shared/services/e2e-cassette.js`). Ignored whenever the cassette is off, so never live on
  production. A scripted answer is never recorded into the real cassette library.
- **A driver's async view of all four levers**, plus a private Redis command and the faults file:
  `.claude/qa/shared/stack-control.cjs` (`restart`, `redis`, `job`, `lp612Doc`, `faults` /
  `clearFaults` / `faultsLeft`). Every lever that shells out is async and awaited — a synchronous
  wait past a restart can outlive the mock's dropped keep-alive sockets and the next request rides a
  dead one. Absent `RUN_DIR`, every lever reports `{ ok: false }` and the driver records `BLOCKED`
  with that reason, never a false pass.
- **Seed helpers for the quiz scenarios** live in `.claude/qa/shared/niete_training_db.py`:
  `seed-lp-download`, `seed-coaching-session`, `seed-lp612-delivery`, `seed-lp-quiz`
  (`--lesson-id`/`--error`/`--topic`), `seed-class-quiz --topic`, `quizzes-for-lesson`, `driver-user`,
  `purge-run-quizzes`.

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

## The child-test simulation on this lane (bd-s1oo0.13)

`bot/scripts/e2e/child-test-sim/sim-stack.sh up <sha> <run_dir>` is `local-stack.sh up` set up for the
child test: sandbox only (refuses any other Supabase ref and any R2 bucket but `rumi-sandbox`), provisions
`keys/niete-local.env` from `~/.childtest-golive/sandbox.env` through `provision-local-keys.sh --from-kv` when it
is missing, seeds today's SIM observe2 visit (`seed-visit.js`; `--no-visit` uses the day key), and starts the
stack in a clean environment with `CHILD_TEST_ENABLED=true`, `CHILD_TEST_R2_ENV=local-sim`, the SIM coach on
`CHILD_TEST_COACH_IDS` and a fresh throwaway `CHILD_TEST_DRAW_SECRET` (process env: the bot's dotenv never
overrides it, so these win over the keys file). `--live-vendors` adds the sandbox's own model keys and
`E2E_CASSETTE=off`, so the scoring path calls the real models and no child speech is recorded into a cassette.
Then `driver.js --mode mock --driver 923009990301` plays the coach. The driver follows L4's protocol: it records
a block only after that block's prompt (never on a card image), and logs `ready` marks (`rtt_block_ready`).

For the DEPLOYED sandbox bot, whose replies go to a phone no device reads, the reply source is the bot's own
`whatsapp.outbound_echo` log line (`bot/shared/services/outbound-echo.js`): the sent /messages payload, logged
only for recipients on `WA_OUTBOUND_ECHO_TO` and never in production. `child-test-sim/replies-axiom.js` reads it
from Axiom (`rumi-sandbox`), strictly on one phone and the run window.

### The check, played for real, and the run scored (bd-s1oo0.18)

- `--checks batch|inline|none`: for every check card the bot sends, `check-play.js` plays the Flow the way
  Meta's client does — INIT, one `data_exchange` per screen (URDU, ENGLISH, MATHS) posting the screen's own
  init values, then the `nfm_reply` completion to the webhook — encrypted with the public half of the bot's
  Flow key (mock: `--stack <run_dir>/stack.json`; sandbox: `FLOW_PUBLIC_KEY_B64` from the env, endpoint
  `https://bot-sandbox.up.railway.app/api/flows/child-test-check`, no other host).
- The coach is a seeded model (`--coach-catch 0.9 --coach-seed 1`): an empty field gets the fixture key's
  value, a pre-filled field that disagrees beyond L5's tolerance is corrected with probability
  `--coach-catch`, an agreeing one is confirmed. Every action is priced from `coach-actions.json` (sources
  in the file) and logged as a `check_action` mark; `summary.json` has each child's `check` time.
- `--grade 3|5` keeps fixtures of the visit's grade (another grade is marked against a different passage).
- Score a run (read-only, sandbox DB asserted): `python3 "$G/sim/score_run.py" <run_dir>` → `RESULTS.md` +
  `results.json` (time per child and per visit, AI vs key and coach vs key per field with L5's comparison
  functions from `scripts/child-test/eval-compare.js`, pre-fill rate, cost). Score BEFORE resetting the SIM
  school; it keeps a `db_rows.json` snapshot and refuses to overwrite a result with fewer rows.
- The stack gives the mock bot `CHILD_TEST_CHECK_FLOW_ID=sim-child-test-check` so `sendCheck` sends a card;
  `sim-stack.sh env-names [--live-vendors]` lists the bot's env names (never values).

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
| Quiz job, on demand (enqueue through the driver, or run its handler now) | `bot/scripts/e2e/quiz-job.js` |
| Grades 6-12 lesson document, seeded into the lane's R2 bucket | `bot/scripts/e2e/lp612-doc.js` |
| DNS resolver fallback for the mock lane (`E2E_DNS_FALLBACK`) | `bot/scripts/e2e/dns-pin.js` |
| A driver's async view of restart/redis/job/lp612Doc/faults | `.claude/qa/shared/stack-control.cjs` |
| Training's quiz-generation scenario cluster (T25 T28 T29, T46–T84) | `.claude/qa/shared/training-quiz-gen.cjs` |
| Quiz/coaching/6-12 seed + purge helpers | `.claude/qa/shared/niete_training_db.py` |
| Flow definitions + census | `bot/scripts/e2e/flow-inventory.js` → `.claude/qa/fixtures/flows/` |
| Flow emulator (client side of a Flow, encrypted exchange) | `bot/scripts/e2e/flow-emulator.js`, used by `mock-api.cjs` (`E2E_FLOWS_DIR`, `E2E_FLOW_PUBLIC_KEY_B64`, `E2E_BOT_URL`) |
| Tests | `tests/e2e-mock/*.test.js` (54), `.claude/qa/shared/test_mock_api.js` (23), `test_ledger_row.py`, `test_niete_sandbox_driver.py`, `test_preflight.py`, `test_niete_training_db.py`, `.claude/hooks/e2e-autorun.test.sh` |
