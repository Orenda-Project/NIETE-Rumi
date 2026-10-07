# Which model runs each job, and how to change it

Every model call in the bot names a **job** (`job: 'chat.respond'`), and the model for each job comes from one
table: [`bot/shared/config/model-registry.js`](../bot/shared/config/model-registry.js) (`JOBS`). You can move any
job to another model, or put every job back, **without a deploy**, from two settings rows. One command does all of
it: `npm run models`.

## In one minute

```bash
npm run models -- list                          # every job: its model, its env var, its call site (no database)

set -a; . ./.env; set +a                        # the env file of the environment you mean
npm run models -- status                        # what each job runs NOW (the rows + that env's LLM_JOB_MODELS)
npm run models -- apply moves.json              # dry run: + / ~ / - against the live per-job row
npm run models -- apply moves.json --confirm    # write it (the row becomes exactly this map), read back
npm run models -- kill --confirm                # every job back on its own model within about a minute
npm run models -- unkill --confirm              # overrides allowed again
```

`moves.json` is a map of job to model id, and it is the **whole** row, not a patch: start from what `status` shows.

```json
{ "chat.intent": "anthropic-direct/claude-haiku-4-5", "chat.respond": "anthropic-direct/claude-sonnet-5" }
```

Every command that touches the database prints which project it is (never the key) and writes only with
`--confirm`. A map is checked against this checkout's registry before anything is sent, so run the tool from the code
the target environment deploys (`origin/main` for production): a job that code does not know would be ignored there.

## The levers, highest first

| Lever | Where | Moves | Takes effect |
|---|---|---|---|
| Kill switch | settings row `llm_kill_switch` = `true` | every job back on its own model | within about a minute, no restart |
| Per-job row | settings row `llm_per_job` = `{"<job>": "<model id>"}` | the jobs it names | within about a minute, no restart |
| Env map | `LLM_JOB_MODELS='{"<job>": "<model id>"}'` on the service | the jobs it names, where there is no settings table | on restart |
| Job env var | e.g. `VISION_MODEL`; `npm run models -- list` shows each job's | that job's own model | on restart |
| Registry default | `JOBS[job].default` in `model-registry.js` | that job's own model, for good | on deploy |

A job's **own model** is its env var if the service sets one, else its registry default. It is what runs when
nothing moves the job, and what stands behind a move. `status` reads the env vars and the env map from the environment you
loaded, so load the env file of the service you mean: a deployed service decides with its own. The settings rows live in the `app_settings` table; each
process caches them for a minute.

Two jobs read their settings at the call site (`vision.analyse`, `assessment.generate`), and there the rows
`llm_per_language`, `llm_per_region` and `llm_rollout` apply as well.

## Model ids

| Id | Goes to |
|---|---|
| `anthropic-direct/<model>`, e.g. `anthropic-direct/claude-sonnet-5` | the Anthropic API directly, on the Anthropic key |
| `anthropic/<model>`, `openai/<model>`, `google/<model>`, `deepseek/<model>` | OpenRouter |
| a bare `gpt-…` | OpenRouter, sent as `openai/gpt-…` |

Anything that is not a well-formed model id is refused by the tool, and ignored (and reported) by the bot.

## What a move does

- **Its own model stands behind the new one.** On an error, a refusal, an answer cut off at the limit, an empty
  answer, or not-JSON where JSON is expected, the call is answered by the job's own model and logged as
  `llm.job_override_fallback` (with `kind`). A move can cost a few seconds, never an answer.
- **No SDK retry on the attempt**: the model behind it is the retry.
- **Twice the output limit** for a moved job (bounded), because Claude counts the same text in more tokens.
- **Nothing moves until the settings have been read once** in a process, so the kill switch is always known. A
  process whose copy is older than two minutes reads the table (bounded wait) before its next labelled call.
- **Two call sites can go straight to the Anthropic API** (`lp.author`, `quiz.keyVerify`). When their own model is
  an `anthropic-direct/…` id, as it is in production, the row does not reach them, and the bot says so once
  (`llm.job_override_ignored`): change them with their env var or their default. On any other id they go through
  the client like every other job, and the row moves them.
- **Labels that are recorded but not routed** (`TELEMETRY_ONLY_JOBS`: reading assessment, exam grading) cannot be
  moved; a row naming them is ignored.

## Before you move a job

1. **Check it offline first**, on real inputs, against the model it runs today: the job's own output checks, the
   language and tone rules of its prompt, latency, and cost per call. Pick the model that matches or beats today's,
   not the cheapest one by default.
2. **Dry run** the map, then write it with `--confirm`. Note the time: it is the start of your watch.
3. **Watch** an hour or two of real traffic (below). Fallbacks above a couple of percent, a slower median than the
   job can afford, or the job's own checks getting worse: take the job back out of the row (or `kill`).

## What actually ran

Every call records a cost event with its job and the model that answered. In the log dataset:

```
| where event == 'api.cost.incurred'
| summarize calls = count(), p50 = percentile(durationMs, 50), p95 = percentile(durationMs, 95), spend = sum(estimatedCostUsd) by job, model

| where event == 'llm.job_override_fallback'
| extend d = parse_json(data_json) | summarize n = count() by job, kind = tostring(d.kind)

| where event == 'llm.job_override_config'
```

The config event appears once per process per change, names the process (service, deployment, replica), and lists
the active map, anything rejected, and any job name it does not know.

## Adding a job

1. Add it to `JOBS` in `model-registry.js`: its env var (only if it already has one), its default, its call site.
2. At the call site, label the call `job: '<name>'` and ask the registry for the model: `modelFor('<name>')`.
3. If its caller parses JSON without asking for JSON mode, list it in `JSON_REPLY_JOBS` or `JSON_REPAIRED_BY_CALLER`,
   so a moved job falls back instead of handing over an answer the caller cannot parse.
4. The guards hold it there: `tests/llm/single-source-guard.test.js` (no model written at a call site, each site asks
   for the job it labels, the model it ran before is pinned) and `tests/config/job-labels-coverage.test.js`.

## Where the code is

| File | What it does |
|---|---|
| `bot/shared/config/model-registry.js` | the table: every job's own model, env var, call site, fallback |
| `bot/shared/config/model-settings.js` | reads the `llm_*` rows (cached a minute; a failed read keeps the last good copy) |
| `bot/shared/services/llm-client.js` | applies the levers (`planForJob`) and puts the job's own model behind a move |
| `bot/shared/services/anthropic-native-facade.js` | the direct Anthropic lane: JSON mode, images, limits, prices |
| `scripts/llm/models.js` | `npm run models` |
