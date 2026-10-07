/**
 * LLM Client Factory
 *
 * Provides a unified interface to LLM providers using the OpenAI SDK.
 * Default: OpenRouter (one key for 500+ models).
 * Override: Direct OpenAI (set LLM_PROVIDER=openai + OPENAI_API_KEY).
 *
 * When using OpenRouter, model names are auto-prefixed with 'openai/' if no
 * provider prefix is present (e.g. 'gpt-4o-mini' → 'openai/gpt-4o-mini').
 * This means existing code can use bare OpenAI model names unchanged.
 *
 * Usage:
 *   const { getClient, getDefaultModel } = require('./llm-client');
 *   const client = getClient();
 *   const response = await client.chat.completions.create({
 *     model: 'gpt-4o-mini',  // auto-prefixed to 'openai/gpt-4o-mini' on OpenRouter
 *     messages: [{ role: 'user', content: 'Hello' }],
 *   });
 */

const OpenAI = require('openai');
// bd-oak77.29 — the OFFICIAL Anthropic SDK, for the direct lane only. Required at module
// load (not lazily) so the repo's unresolved-require audit and the boot proof both see it:
// a dependency that only appears on the first cache-enabled author call is a dependency that
// reaches production as a runtime MODULE_NOT_FOUND with a green test suite.
const Anthropic = require('@anthropic-ai/sdk');
const {
  toNativeRequest,
  fromNativeResponse,
  isCreditClassError,
  jsonShapeFor,
  hasShape,
  extractJson,
  thinksByDefault,
  alwaysThinks,
} = require('./anthropic-native-facade');
// bd-8t362: one place to record what a call cost. No rate table: OpenRouter reports what it
// actually charged, and the facade prices the direct lane. We record what the vendor says.
const { recordModelCost } = require('../utils/model-cost');

const PROVIDER = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
const DEFAULT_MODEL = process.env.LLM_MODEL || 'openai/gpt-4o';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Per-call timeout + retry budget.
 *
 * Every client this module builds used to omit BOTH `timeout` and
 * `maxRetries`, so the openai SDK applied its own defaults: a 600000ms
 * (10 min) timeout and maxRetries: 2 (3 attempts). The lp612 author ladder
 * makes up to 5 calls inside a 14-minute job budget
 * (LP612_AUTHOR_TIMEOUT_MS=840000) — one stalled call could burn ~30
 * minutes, more than 2x the whole job, with `withTimeout(840s)` left as the
 * only effective bound and every remaining ladder round silently sacrificed.
 *
 * 180000ms (180s) is ~2x the measured p90 healthy call (~85s; round-0 p50
 * 72.3s / p90 85.3s, revision calls p50 ~56s, measured against a 6-12
 * lesson-plan simulation run) — generous enough that it never truncates a
 * slow-but-working call, while keeping 5 rounds x 180s = 900s worst case
 * bounded and comparable to the job budget instead of 30 minutes.
 * maxRetries: 1 (2 attempts total) halves the SDK's own default retry
 * budget for the same reason.
 *
 * Both are read at CALL time (inside the two functions below), matching the
 * anthropic-direct API-key comment further down: a value parsed once at
 * module load would be immune to a test (or a runtime env change) made
 * after require().
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 180000;
const DEFAULT_MAX_RETRIES = 1;

/**
 * Parse an env var as a positive integer, falling back to `fallback` for
 * anything that isn't one: missing, blank/whitespace, non-numeric, zero, or
 * negative. `parseInt('', 10)` is `NaN` — that must never reach the SDK as
 * a `timeout`/`maxRetries` value (NaN silently disables the SDK's own
 * validation and produces undefined-ish behaviour).
 */
function _resolvePositiveIntEnv(envValue, fallback) {
  const n = parseInt(envValue, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function resolveRequestTimeoutMs() {
  return _resolvePositiveIntEnv(process.env.LLM_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
}

function resolveMaxRetries() {
  return _resolvePositiveIntEnv(process.env.LLM_MAX_RETRIES, DEFAULT_MAX_RETRIES);
}


/**
 * Direct-to-Anthropic lane (bd-yoc6i, rebuilt on the official SDK by bd-oak77.29).
 *
 * A model id prefixed `anthropic-direct/` is billed against ANTHROPIC_API_KEY (the prepaid
 * credit) instead of the OpenRouter balance. It is a PER-MODEL seam, not a global provider
 * switch, because `LLM_PROVIDER` is process-wide and we need one lane on the credit while
 * another stays on OpenRouter.
 *
 * WHY THIS IS NO LONGER THE OPENAI SDK. bd-yoc6i pointed the OpenAI SDK at Anthropic's
 * OpenAI-compatibility endpoint so "the existing SDK, call sites and response shape are
 * unchanged". That endpoint CANNOT CACHE: it accepts `cache_control` with HTTP 200 and silently
 * ignores it, and returns no cache fields at all (measured twice — 11_cost/evidence/
 * shim_vs_native.json, 16_direct_lane/evidence/probe_native_cache.txt). Prompt caching is live on
 * production and saving 38.3% per lesson, so routing the author ladder through the shim would
 * have traded a measured saving for the ability to spend credit. The lane is therefore rebuilt on
 * `@anthropic-ai/sdk` against `/v1/messages`, where caching demonstrably works, with
 * `anthropic-native-facade.js` keeping the `chat.completions.create` shape every call site
 * already speaks.
 *
 * OFF UNTIL A MODEL ID SAYS OTHERWISE. Nothing routes here by the mere presence of the key —
 * activation is naming a prefixed model in config, and `LP_AUTHOR_MODEL` is that single switch:
 * `anthropic-direct/claude-sonnet-5` turns it on, `anthropic/claude-sonnet-5` turns it off, with
 * no deploy either way.
 */
const ANTHROPIC_DIRECT_PREFIX = 'anthropic-direct/';
/**
 * NO TRAILING `/v1/`. That path segment belonged to the OpenAI SDK, which appends
 * `chat/completions` to whatever baseURL it is given; `@anthropic-ai/sdk` appends `/v1/messages`
 * itself, so the old constant produced `https://api.anthropic.com/v1/v1/messages` — a 404 on the
 * very first author call. Caught by the network-boundary test, not by inspection, which is the
 * whole reason that test doubles `fetch` instead of the client.
 */
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/**
 * WHERE A CREDIT-EXHAUSTED CALL GOES INSTEAD.
 *
 * The operator is spending a FINITE prepaid balance. When it runs dry, lesson generation must not
 * stop, so the same call is re-issued on OpenRouter. Anthropic's own model ids carry no vendor
 * segment (`claude-sonnet-5`); OpenRouter's are `anthropic/claude-sonnet-5`, so the default
 * mapping is that one prefix. `LLM_DIRECT_FALLBACK_MODEL` overrides it exactly, for a model whose
 * two ids do not line up that way.
 */
const OPENROUTER_ANTHROPIC_PREFIX = 'anthropic/';

function directFallbackModel(directModel) {
  const override = (process.env.LLM_DIRECT_FALLBACK_MODEL || '').trim();
  if (override) return override;
  return OPENROUTER_ANTHROPIC_PREFIX + directModel;
}

/**
 * THE FALLBACK IS NOT OPTIONAL, AND THIS IS WHAT MAKES THAT TRUE IN CODE.
 *
 * The operator's instruction on approving this lane for production was, verbatim, *"Keep the fall
 * back on"*. There is deliberately no flag that turns it off — but "no off switch" is not the same
 * as "cannot be disabled", and the two ways it could quietly stop working are both environmental:
 *
 *   1. `OPENROUTER_API_KEY` absent. `getClient()` would build a client with no key and the first
 *      fallback call would die inside the OpenAI SDK with a message about `OPENAI_API_KEY` — a
 *      confusing error, raised at the worst possible moment, on a lesson a teacher is waiting for.
 *   2. `LLM_PROVIDER=openai`. `getClient()` is then a DIRECT OpenAI client, and the fallback would
 *      post `anthropic/claude-sonnet-5` to api.openai.com and 404. The fallback would fire, fail,
 *      and the lesson would die — the failure mode of a safety net that is present but not
 *      attached to anything.
 *
 * So the lane refuses to start at all unless its net is wired. This runs at RESOLUTION time, before
 * a single token is spent, and it fails CLOSED: a misconfigured deployment cannot author one
 * credit-funded lesson and then strand the next when the balance runs out — it authors none, and
 * says why. Since prod's rollback is `LP_AUTHOR_MODEL=anthropic/claude-sonnet-5`, the cost of this
 * refusal is one variable, and the cost of not having it is a silent lesson failure at 3am.
 */
function assertFallbackUsable(directModel) {
  const to = directFallbackModel(directModel);
  const problems = [];
  if (PROVIDER !== 'openrouter') {
    problems.push(
      `LLM_PROVIDER is "${PROVIDER}", so the OpenRouter client the fallback needs is not the one ` +
      `getClient() builds — "${to}" would be sent to the wrong vendor and 404`);
  }
  if (!(process.env.OPENROUTER_API_KEY || '').trim()) {
    problems.push('OPENROUTER_API_KEY is not set, so the fallback has nothing to fall back to');
  }
  if (problems.length) {
    throw new Error(
      'llm-client: refusing the direct-Anthropic lane because its MANDATORY credit-exhaustion ' +
      `fallback is not usable — ${problems.join('; ')}. ` +
      'Fix the environment, or set LP_AUTHOR_MODEL to an OpenRouter model id.'
    );
  }
}

let _client = null;
let _anthropicDirectClient = null;

/**
 * Create a new LLM client configured for the current provider.
 * For OpenRouter, wraps chat.completions.create to auto-prefix model names.
 */

/**
 * What a job falls back to. bd-4uw7n.
 *
 * REPLACED A BLANKET `openai/gpt-4o`, and the reason is the point. A fallback answers "this
 * supplier cannot serve us right now", which IS a fact about the supplier, so that half was
 * fine. But WHAT to fall back to is entirely a fact about the job, and the blanket version got
 * that wrong: roster extraction runs a model chosen for being cheap and would have failed over
 * to roughly 17x the price; transcript quizzes would have swapped the model their pipeline was
 * validated against; lesson-plan authoring would have landed on something no rubric has been
 * run against. One of them only worked by luck, because gpt-4o happens to do vision.
 *
 * The registry now records, per job and frozen, the model that job already works with. Move a
 * job to Anthropic and its fallback still names what it used to run.
 *
 * SO THE LADDER NEEDS THE JOB, and getClient() does not know it. That is why this arms only
 * when a caller passes one, through getClientForModel(model, { job }). Everything else keeps
 * today's behaviour and fails. A narrow correct fallback beats a broad wrong one: the broad
 * one would quietly answer a teacher with a model nobody checked.
 */
function resolveJobFallback(job) {
  if (!job) return null;
  try {
    // eslint-disable-next-line global-require
    const { fallbackForJob } = require('../config/model-registry');
    return fallbackForJob(job);
  } catch (_) {
    // An unknown job means no fallback, never a guessed one.
    return null;
  }
}

/**
 * The two failures a SECOND SUPPLIER can actually answer.
 *
 * Deliberately not "any error". A 400 is our own bad request and retrying it elsewhere just
 * breaks twice, more slowly. A timeout is already the SDK's retry budget. What a different
 * supplier genuinely fixes is: this account cannot spend, or this supplier is down.
 */
function isSupplierUnusableError(e) {
  if (!e) return false;
  const status = e.status != null ? e.status : e.statusCode;
  if (status === 401 || status === 402 || status === 429) return true;   // cannot spend
  if (status === 502 || status === 503 || status === 504) return true;   // supplier is down
  return false;
}

/** One switch, no deploy. A vendor swap changes what a teacher gets; it must be stoppable. */
const fallbackDisabled = () => String(process.env.LLM_FALLBACK_OFF || '').trim() === '1';

function createLLMClient() {
  if (PROVIDER === 'openai') {
    // Direct OpenAI — no baseURL override
    const direct = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: resolveRequestTimeoutMs(),
      maxRetries: resolveMaxRetries(),
    });
    // bd-3kv02. This branch used to hand back the bare SDK client, so a caller's `job` label (and a
    // `fallbackModel: null`) went to api.openai.com as request fields -- and OpenAI rejects unknown
    // top-level fields with a 400. No environment runs LLM_PROVIDER=openai today, so it never
    // fired; but with 62 labelled call sites it was one variable away from failing every one of
    // them at once. Strip both, on KEY PRESENCE for the same reason as the OpenRouter branch below,
    // and change nothing else: no `openai/` prefix, no fallback, no cost recording -- this branch
    // keeps exactly the behaviour it had, minus the two fields that would have broken it.
    const directCreate = direct.chat.completions.create.bind(direct.chat.completions);
    direct.chat.completions.create = (params, options) => {
      // `skipJobOverride` too (bd-gr4fy.6): this module adds it to calls it has already routed,
      // and api.openai.com answers an unknown field with a 400.
      if (params && ('job' in params || 'fallbackModel' in params || 'skipJobOverride' in params)) {
        params = { ...params };
        delete params.job;
        delete params.fallbackModel;
        delete params.skipJobOverride;
      }
      return directCreate(params, options);
    };
    return direct;
  }

  // Default: OpenRouter — uses OpenAI-compatible API
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    timeout: resolveRequestTimeoutMs(),
    maxRetries: resolveMaxRetries(),
    defaultHeaders: {
      'HTTP-Referer': process.env.APP_URL || '',
      'X-Title': 'Rumi Teaching Assistant',
    },
  });

  // Auto-prefix model names for OpenRouter (e.g. 'gpt-4o-mini' → 'openai/gpt-4o-mini')
  const originalCreate = client.chat.completions.create.bind(client.chat.completions);
  // `fallbackModel` is resolved by the caller from the JOB and handed in; it is never derived
  // from the model being called, because after a switch that would just name another Anthropic
  // model. It is stripped before the request goes out.
  client.chat.completions.create = async (params, options) => {
    // The job rides in beside the fallback: spend without it is one undifferentiated total,
    // and "which feature" is the only question worth asking about cost per child. bd-9b58p.
    //
    // ALL THREE are stripped on KEY PRESENCE, never on truthiness. A job whose frozen fallback
    // is null (lp.author, lp.fidelity, hcp.feedback) arrives carrying `fallbackModel: null`, and
    // a falsy check leaves that on the request -- which would put an unknown field on every
    // lesson-plan authoring call, the largest spender here. NOTHING is added to the request.
    // `skipJobOverride` marks a call this module makes after it has already resolved the job's
    // model (bd-gr4fy.1), so the override is never applied twice.
    const fallbackModel = params.fallbackModel || null;
    const job = params.job || null;
    const skipJobOverride = params.skipJobOverride === true;
    if ('fallbackModel' in params || 'job' in params || 'skipJobOverride' in params) {
      params = { ...params };
      delete params.fallbackModel;
      delete params.job;
      delete params.skipJobOverride;
    }
    const callSite = (p) => sendOnOpenRouter(p, options, fallbackModel, job);
    if (job && !skipJobOverride) return runWithJobOverride(job, params, options, callSite, fallbackModel);
    return callSite(params);
  };

  async function sendOnOpenRouter(params, options, fallbackModel, job) {
    if (params.model && !params.model.includes('/')) {
      params = { ...params, model: `openai/${params.model}` };
    }
    // bd-8t362. NOTHING is added to the request. An earlier draft of this sent
    // `usage: {include:true}` to ask OpenRouter for its accounting, until lp612-author's own
    // note pointed out that `usage.cost` and `usage.prompt_tokens_details` are already on every
    // OpenRouter response WITHOUT it, verified against the live API
    // (11_cost/evidence/usage_flag.json). Changing a request for no benefit is exactly the
    // risk this whole workstream exists to avoid, so this is logging only.
    const startedAt = Date.now();
    let response;
    try {
      response = await originalCreate(params, options);
    } catch (primaryErr) {
      const to = fallbackDisabled() ? null : fallbackModel;
      if (!to || to === params.model || !isSupplierUnusableError(primaryErr)) throw primaryErr;

      const status = primaryErr.status != null ? primaryErr.status : primaryErr.statusCode;
      const reason = String(primaryErr.message || 'unknown').slice(0, 300);
      // Two channels, matching the direct lane: a queryable name for a watcher or an Axiom
      // query, and the human sentence beside it in the same correlation trace. Required at
      // call time because llm-client is required by almost everything and a top-level require
      // of the loggers has broken the circular-deps suite before.
      // eslint-disable-next-line global-require
      const { logEvent } = require('../utils/structured-logger');
      // eslint-disable-next-line global-require
      const { logToFile } = require('../utils/logger');
      logEvent('llm.vendor_fallback', {
        from: params.model, to, status: status == null ? null : status, reason,
      });
      // Says WHICH supplier, because it is no longer always OpenAI: bd-4uw7n froze a fallback
      // per job, so this lands on Gemini for roster extraction and transcript quizzes. A
      // hardcoded vendor name here sends whoever is on call to the wrong supplier's status page.
      logToFile(`llm-client: supplier unusable, falling back to ${to}`,
        { from: params.model, to, status: status == null ? null : status, reason }, 'warn');

      try {
        response = await originalCreate({ ...params, model: to }, options);
      } catch (fallbackErr) {
        // BOTH SUPPLIERS FAILED. Whoever reads this needs the FIRST failure as much as the
        // second: "OpenAI is down" on its own sends the next engineer to the wrong supplier.
        fallbackErr.cause = fallbackErr.cause || primaryErr;
        fallbackErr.message = `${fallbackErr.message} (after ${params.model} was unusable: ${reason})`;
        throw fallbackErr;
      }
      // An answer from the fallback must never be mistaken for one from the model that was
      // asked for, or the whole point of running a different model becomes unmeasurable.
      if (response && typeof response === 'object') {
        response.usage = { ...(response.usage || {}), provider_fallback: true, provider_fallback_to: to };
      }
      recordModelCost(to, response, startedAt, { fallbackFrom: params.model, job });
      return response;
    }
    recordModelCost(params.model, response, startedAt, { job });
    return response;
  }

  return client;
}

/**
 * WHICH MODEL A LABELLED JOB RUNS, DECIDED IN ONE PLACE. bd-gr4fy.1.
 *
 * Every live model call in the bot carries a `job` label, but most call sites still write their
 * model as a literal, so moving one job meant a code change and a deploy. This is the one place:
 *
 *   kill switch (`llm_kill_switch`)  >  settings row `llm_per_job`  >  env `LLM_JOB_MODELS`
 *
 * and nothing set means the call site decides, exactly as before. The settings row moves a job
 * within a minute with no restart; the env var is a JSON map of job -> model for environments
 * with no settings table to write to. Only a well-formed model id is ever used: this is the one
 * value from settings that is sent to a third party.
 *
 * NOTHING MOVES UNTIL THE KILL SWITCH IS KNOWN (bd-gr4fy.6). Until the settings have been read
 * once, a process cannot tell "kill switch off" from "not read yet", so the env map waits too and
 * the call site decides. That is the first second or so of a process's life.
 */
let _envMapRaw = null;
let _envMap = {};
let _envProblem = null;
function envJobModels() {
  const raw = process.env.LLM_JOB_MODELS || '';
  if (raw !== _envMapRaw) {
    _envMapRaw = raw;
    _envProblem = null;
    let parsed = {};
    try {
      parsed = raw.trim() ? JSON.parse(raw) : {};
    } catch (_) {
      parsed = {};
      _envProblem = 'not JSON';
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      parsed = {};
      _envProblem = 'not a map of job -> model id';
    }
    _envMap = parsed;
  }
  return _envMap;
}

/**
 * The settings as this call sees them. Required at call time: llm-client is required by almost
 * everything, and the settings module reaches the database client. A settings module that cannot
 * be read at all moves nothing (`known: false`), and says why once, in the config event.
 */
function readSettings() {
  try {
    // eslint-disable-next-line global-require
    const settings = require('../config/model-settings');
    const cfg = settings.configForRequest() || {};
    return { cfg, known: settings.hasRead(), rejected: settings.rejectedEntries(), error: null };
  } catch (err) {
    return { cfg: {}, known: false, rejected: [], error: String((err && err.message) || err).slice(0, 200) };
  }
}

/**
 * One `llm.job_override_config` event per change of what is in force: the map that is active,
 * every entry that was dropped and why, and any job name that matches nothing. A malformed value
 * used to be dropped without a word, so a typo looked exactly like "nothing configured".
 */
let _lastConfigKey = null;

/**
 * Which process this is (bd-gr4fy.9): Railway's own service, environment, deployment and replica
 * where they exist, and the host and pid everywhere. On sandbox two workers once reported an empty
 * override map while every other process reported the full one, and nothing in the logs said which
 * machine they ran on. Only values that exist are named; nothing secret is.
 */
function processIdentity() {
  const out = {};
  const fromEnv = {
    service: 'RAILWAY_SERVICE_NAME', environment: 'RAILWAY_ENVIRONMENT_NAME',
    deployment: 'RAILWAY_DEPLOYMENT_ID', replica: 'RAILWAY_REPLICA_ID',
  };
  for (const [field, name] of Object.entries(fromEnv)) if (process.env[name]) out[field] = process.env[name];
  // eslint-disable-next-line global-require
  try { out.host = require('os').hostname(); } catch (_) { /* no host is not a reason to drop the event */ }
  out.pid = process.pid;
  return out;
}

function reportConfig(s) {
  if (!s.known && !s.error) return;
  const env = envJobModels();
  const key = JSON.stringify([s.known, !!s.cfg.killSwitch, s.cfg.perJob || {}, s.rejected, _envMapRaw, s.error]);
  if (key === _lastConfigKey) return;
  _lastConfigKey = key;

  // eslint-disable-next-line global-require
  const { isModel, JOBS, TELEMETRY_ONLY_JOBS } = require('../config/model-registry');
  const rejected = (s.rejected || []).map((r) => ({
    source: 'settings', key: r.key, ...(r.entry ? { job: r.entry } : {}), ...(r.value ? { value: r.value } : {}), why: r.why,
  }));
  if (_envProblem) rejected.push({ source: 'env', why: _envProblem });
  const fromEnv = {};
  for (const [job, model] of Object.entries(env)) {
    if (isModel(model)) fromEnv[job] = model;
    else rejected.push({ source: 'env', job, value: String(model).slice(0, 80), why: 'not a model id' });
  }
  const active = s.cfg.killSwitch ? {} : { ...fromEnv, ...(s.cfg.perJob || {}) };
  const unknownJobs = Object.keys(active).filter((j) => !JOBS[j] && !TELEMETRY_ONLY_JOBS.includes(j));

  // eslint-disable-next-line global-require
  const { logEvent } = require('../utils/structured-logger');
  logEvent('llm.job_override_config', {
    killSwitch: !!s.cfg.killSwitch, active, rejected, unknownJobs, ...(s.error ? { settingsError: s.error } : {}),
    process: processIdentity(),
  });
  if (rejected.length || unknownJobs.length || s.error) {
    // eslint-disable-next-line global-require
    const { logToFile } = require('../utils/logger');
    logToFile('llm-client: part of the per-job model configuration is not in force', { rejected, unknownJobs, settingsError: s.error }, 'warn');
  }
}

const isDirectModel = (m) => String(m || '').startsWith(ANTHROPIC_DIRECT_PREFIX);
const withVendor = (m) => (String(m || '').includes('/') ? String(m) : `openai/${m}`);
const sameModel = (a, b) => withVendor(a) === withVendor(b);

/** The first candidate that is a different model from `first`, or null. */
function behindFor(first, candidates) {
  for (const c of candidates) if (c && !sameModel(c, first)) return c;
  return null;
}

/**
 * Which model answers first, and which stands behind it, for one labelled call.
 *
 *   { first: null }                 nothing to change: the call site's request goes out as written
 *   { first, behind: null }         one model only (a direct-lane call site with nothing validated
 *                                   behind it): sent once, exactly as the call site would have
 *   { first, behind }               `first` is tried; on any failure `behind` answers
 *
 * THE MODEL BEHIND IS NEVER THE ONE IN FRONT (bd-gr4fy.6). A call site that reads the settings
 * itself (`settingsAtSite`: vision, assessment) arrives already carrying the moved model, so an
 * "override vs call site" comparison sees one model twice and puts nothing behind it. The row is
 * never applied a second time on top of a finer choice such a site already made (per language,
 * rollout).
 *
 * SUCH A CALL SITE SAYS WHICH MODEL IS ITS OWN (bd-gr4fy.7), as `fallbackModel`, and only when its
 * settings moved it. Only the call site knows that model exactly (an Urdu paper runs a different
 * one from an English paper) and whether the settings moved it at all. Guessing both here put an
 * Urdu paper behind the English default, and made a call site nobody moved look moved, with its
 * request changed, whenever any per-language row existed.
 *
 * `declared` is that model, or the frozen fallback a getClientForModel caller carries; null when
 * there is neither.
 */
function planForJob(job, siteModel, declared) {
  const s = readSettings();
  reportConfig(s);
  // eslint-disable-next-line global-require
  const { JOBS, isModel } = require('../config/model-registry');
  const spec = JOBS[job] || null;
  const frozen = spec ? resolveJobFallback(job) : null;
  const live = s.known && !s.cfg.killSwitch;
  const rowModel = live ? s.cfg.perJob && s.cfg.perJob[job] : null;
  const envModel = live ? envJobModels()[job] : null;

  if (spec && spec.settingsAtSite) {
    if (declared && !sameModel(declared, siteModel)) {
      // Spelled as it goes out (`gpt-4.1-mini` is sent as `openai/gpt-4.1-mini`), so the log
      // names what was actually asked.
      return { first: { model: siteModel, source: 'settings' }, behind: isDirectModel(declared) ? declared : withVendor(declared) };
    }
    // Not moved by its settings. The registry never reads the env map, so that may still move it,
    // unless the row names this job (the row outranks the env map, and the site applied the row).
    if (!rowModel && isModel(envModel) && !sameModel(envModel, siteModel)) {
      return { first: { model: envModel, source: 'env' }, behind: siteModel };
    }
  } else {
    const override = isModel(rowModel) ? { model: rowModel, source: 'settings' }
      : (isModel(envModel) ? { model: envModel, source: 'env' } : null);
    if (override && !sameModel(override.model, siteModel)) return { first: override, behind: siteModel };
  }

  // No override. A call site on the direct lane is routed there (OpenRouter refuses the prefix),
  // with the job's validated model behind it when it has one.
  if (!isDirectModel(siteModel)) return { first: null, behind: null };
  return { first: { model: siteModel, source: 'call-site' }, behind: behindFor(siteModel, [declared, frozen]) };
}

/**
 * Claude models that think by default (Sonnet 5, Opus 5 and up). Under a limit sized for a model
 * that does not think, the thinking spends the whole budget and the answer comes back empty: Opus
 * returned nothing on 30 of 44 language-detection calls at 15 tokens. Haiku does not think unless
 * asked, so it is not touched. Where thinking cannot be switched off at all (Fable 5 / 5.1,
 * Opus 5.5: a 400), low effort is the only lever and is used instead (bd-gr4fy.6).
 */
const SMALL_OUTPUT_LIMIT = 2048;

/**
 * A moved job's output limit, in Claude's tokens (bd-gr4fy.6). The call site sized its limit for
 * its own model, and Claude counts the same text in more tokens: the eval measured 1.90x on
 * coaching input, and live, a Urdu answer at a 120-token limit was cut off mid-sentence on Claude
 * where the job's own model finished. Twice the limit is the same length of TEXT; an answer that
 * still reaches it is cut off, and the job's own model answers instead.
 *
 * BOUNDED, BECAUSE IT IS NOT FREE (bd-gr4fy.7). A call is billed for what is written, but the limit
 * is what OpenRouter authorises spend against up front (see roster-extraction.service.js), so a
 * bigger ask can be refused on a thin balance. A small limit, where a cut-off is likely, is
 * doubled; a large one, which a normal answer rarely nears, gets at most ALLOWANCE_CAP more.
 */
const TOKENIZER_ALLOWANCE = 2;
const ALLOWANCE_CAP = 4096;
const MAX_OUTPUT_TOKENS = 64000;  // Haiku 4.5's ceiling, the lowest of the Claude models in use
const isClaude = (m) => /(^|\/)claude-/.test(String(m || ''));

/**
 * The request as the new model should receive it. The call site's own request is never edited.
 * `moved` is false when the model is the call site's own (a direct-lane id routed to the direct
 * lane): that limit was sized for that model already.
 */
function adaptForTarget(model, params, moved = true) {
  const p = { ...params };
  const limit = p.max_tokens != null ? p.max_tokens : p.max_completion_tokens;
  const hinted = p.reasoning !== undefined || p.thinking !== undefined || p.reasoning_effort !== undefined
    || (p.output_config && p.output_config.effort !== undefined);
  if (thinksByDefault(model) && limit != null && limit < SMALL_OUTPUT_LIMIT && !hinted) {
    p.reasoning = alwaysThinks(model) ? { effort: 'low' } : { enabled: false };
  }
  // OpenRouter reads `max_tokens` for non-OpenAI models; the facade reads either.
  if (!String(model).startsWith('openai/') && p.max_tokens == null && p.max_completion_tokens != null) {
    p.max_tokens = p.max_completion_tokens;
    delete p.max_completion_tokens;
  }
  if (moved && isClaude(model) && Number.isFinite(p.max_tokens) && p.max_tokens > 0) {
    p.max_tokens = Math.min(Math.ceil(p.max_tokens * TOKENIZER_ALLOWANCE), p.max_tokens + ALLOWANCE_CAP, MAX_OUTPUT_TOKENS);
  }
  return p;
}

/**
 * Send one call to a model this module chose: the direct lane for `anthropic-direct/`, else the
 * shared OpenRouter client, marked so the job's override is not applied to it a second time.
 * `options` are the per-call SDK options (timeout, retries), passed on to whichever lane it is.
 */
async function callModel(model, params, options, job, moved = true) {
  const p = adaptForTarget(model, params, moved);
  if (isDirectModel(model)) {
    // Throws on a missing key or an unusable credit fallback, before a token is spent; the
    // caller treats that like any other failure and puts the job back on its own model.
    const { client } = getClientForModel(model, { job, routed: true });
    return client.chat.completions.create(p, options);
  }
  return getClient().chat.completions.create({ ...p, model, job, skipJobOverride: true }, options);
}

/** The model behind: the call site itself when it is the call site's own model. */
function callBehind(model, params, options, job, callSite) {
  if (isDirectModel(model)) return callModel(model, params, options, job, !sameModel(model, params.model));
  if (sameModel(model, params.model)) return callSite(params);
  return callSite({ ...params, model });
}

/**
 * Why an answer cannot be handed to the caller, or null.
 *
 *   refused   a refusal, or stopped by a content filter
 *   cut_off   stopped at the output limit: the limit was sized for the job's own model, whose
 *             tokenizer counts the same text in fewer tokens, so its model is the right one to ask
 *   empty     what a thinking model returns under a small limit
 *   not_json  JSON was asked for (or the job's caller parses JSON) and the answer is not JSON of
 *             that shape. JSON wrapped in fences or a sentence is unwrapped first, and only a
 *             complete value of the right shape counts: an inner array of a cut-off object does not.
 */
function unusableAnswer(res, params, job) {
  const choice = res && Array.isArray(res.choices) ? res.choices[0] : null;
  const message = choice && choice.message;
  const finishReason = (choice && choice.finish_reason) || null;
  if ((message && message.refusal) || finishReason === 'content_filter') {
    return { kind: 'refused', reason: 'refused, or stopped by a content filter', finishReason };
  }
  if (finishReason === 'length') return { kind: 'cut_off', reason: 'cut off at the output limit', finishReason };
  const content = message ? message.content : null;
  if (typeof content !== 'string' || !content.trim()) return { kind: 'empty', reason: 'empty answer', finishReason };
  const shape = jsonShapeFor(params) || jsonReplyShape(job);
  if (shape) {
    let fits = false;
    try { fits = hasShape(JSON.parse(content), shape); } catch (_) { fits = false; }
    if (!fits) {
      const json = extractJson(content, shape);
      if (json) message.content = json;
      else if (!callerRepairsTo(job, content, shape)) {
        return { kind: 'not_json', reason: `not JSON of the shape asked for (${shape})`, finishReason };
      }
    }
  }
  return null;
}

/**
 * Whether a caller that repairs JSON itself (JSON_REPAIRED_BY_CALLER) would get a value of the
 * shape it wants from this answer, parsed exactly the way it parses it (bd-gr4fy.7). Such an answer
 * is handed over untouched: the caller's own repair reaches the same value. Prose its repair turns
 * into a string, or two objects it turns into an array, still fall back.
 */
function callerRepairsTo(job, content, shape) {
  let mode;
  let repair;
  try {
    // eslint-disable-next-line global-require
    mode = require('../config/model-registry').JSON_REPAIRED_BY_CALLER[job];
    if (!mode) return false;
    // eslint-disable-next-line global-require
    repair = require('jsonrepair').jsonrepair;
  } catch (_) {
    return false;
  }
  let text = content;
  if (mode === 'span') {
    const m = content.match(/\{[\s\S]*\}/);
    text = m ? m[0] : content;
  }
  try { return hasShape(JSON.parse(text), shape); } catch (_) { /* the caller repairs next */ }
  try { return hasShape(JSON.parse(repair(text)), shape); } catch (_) { return false; }
}

/** The JSON shape a job's caller parses out of a reply it never asked JSON mode for, or null. */
function jsonReplyShape(job) {
  try {
    // eslint-disable-next-line global-require
    const { JSON_REPLY_JOBS } = require('../config/model-registry');
    return (JSON_REPLY_JOBS && JSON_REPLY_JOBS[job]) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Run one labelled call with the job's override, if it has one.
 *
 * THE JOB'S OWN MODEL STAYS BEHIND THE NEW ONE, ON ANY FAILURE. Not only the outages a second
 * supplier can answer (that is `isSupplierUnusableError`, for the frozen fallbacks), because
 * here the model behind is the one this job has always run on: an error, a refusal, a cut-off or
 * empty answer, or not-JSON when JSON was wanted all put the call back on it, and say so on
 * `llm.job_override_fallback` and in `usage.job_override_fallback`. A move can therefore cost a
 * teacher a few seconds, never an answer.
 *
 * THE ATTEMPT IS NOT RETRIED (bd-gr4fy.6). The model behind IS the retry, so the attempt goes out
 * with `maxRetries: 0` and the caller's own time budget. With the SDK's retry, a timed-out attempt
 * waited twice the 180 s budget before the fallback even started.
 */
async function runWithJobOverride(job, params, options, callSite, declared = null) {
  const plan = planForJob(job, params.model, declared);
  if (!plan.first) return callSite(params);
  const { first, behind } = plan;
  // Only an override is a move; the call site's own model routed to the direct lane is not.
  const moved = first.source !== 'call-site';
  if (!behind) return callModel(first.model, params, options, job, moved);

  const startedAt = Date.now();
  let failure;
  let firstErr = null;
  try {
    const res = await callModel(first.model, params, { ...(options || {}), maxRetries: 0 }, job, moved);
    failure = unusableAnswer(res, params, job);
    if (!failure) {
      res.usage = { ...(res.usage || {}), job_override: { from: behind, to: first.model, source: first.source } };
      return res;
    }
  } catch (err) {
    firstErr = err;
    failure = {
      kind: 'error',
      reason: String((err && err.message) || 'unknown').slice(0, 300),
      status: err && (err.status != null ? err.status : err.statusCode),
      errName: (err && err.name) || null,
    };
  }

  // eslint-disable-next-line global-require
  const { logEvent } = require('../utils/structured-logger');
  // eslint-disable-next-line global-require
  const { logToFile } = require('../utils/logger');
  const event = {
    job, from: first.model, to: behind, source: first.source, kind: failure.kind,
    status: failure.status == null ? null : failure.status, reason: failure.reason,
    finishReason: failure.finishReason || null, errName: failure.errName || null,
    elapsedMs: Date.now() - startedAt,
  };
  logEvent('llm.job_override_fallback', event);
  logToFile(`llm-client: ${job} could not use ${first.model}, answering on ${behind}`, event, 'warn');

  let res;
  try {
    res = await callBehind(behind, params, options, job, callSite);
  } catch (behindErr) {
    // BOTH FAILED. The second error alone sends whoever reads it at the wrong model; the first
    // rides along as `cause` and in the message, the way the other two fallbacks here do it.
    if (behindErr && typeof behindErr === 'object') {
      behindErr.cause = behindErr.cause || firstErr || new Error(failure.reason);
      behindErr.message = `${behindErr.message} (after ${first.model} could not answer: ${failure.reason})`;
    }
    throw behindErr;
  }
  if (res && typeof res === 'object') {
    res.usage = { ...(res.usage || {}), job_override_fallback: { from: first.model, to: behind, reason: failure.reason } };
  }
  return res;
}

/**
 * Get a singleton LLM client instance.
 */
function getClient() {
  if (!_client) {
    _client = createLLMClient();
  }
  return _client;
}

/**
 * Get the singleton `@anthropic-ai/sdk` client for the direct lane.
 *
 * The key is read at CALL time, not at module load, so a process that is configured after
 * require() still works and so a test can assert the missing-key behaviour without reloading the
 * module.
 *
 * `timeout` is passed explicitly for two reasons: it is bd-v60qf's per-call budget, and the
 * Anthropic SDK refuses a NON-STREAMING request whose `max_tokens` implies a long generation
 * unless a timeout is stated. The author asks for 24,000 output tokens, so without this the very
 * first direct-lane call would throw before it reached the network.
 */
function getAnthropicDirectClient() {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    // A THROW, not a fallback to OpenRouter. Falling back HERE would spend the wrong budget and —
    // worse — mislabel every measurement taken in that window: a run recorded as "on the credit"
    // would actually be OpenRouter. Naming the missing variable is the whole value of this error.
    //
    // This is NOT the credit-exhaustion fallback below, and the two must not be confused: a
    // MISSING key is a misconfiguration nobody meant, and it is silent-forever; an EXHAUSTED
    // balance is the expected end state of a prepaid grant, it is loud, and it is per-call.
    throw new Error(
      'llm-client: a model was requested on the direct-Anthropic lane ' +
      `("${ANTHROPIC_DIRECT_PREFIX}…") but ANTHROPIC_API_KEY is not set. ` +
      'Set it, or use an OpenRouter model id without the prefix.'
    );
  }
  if (!_anthropicDirectClient) {
    _anthropicDirectClient = new Anthropic({
      apiKey,
      baseURL: ANTHROPIC_BASE_URL,
      timeout: resolveRequestTimeoutMs(),
      maxRetries: resolveMaxRetries(),
    });
  }
  return _anthropicDirectClient;
}

/**
 * An override that can never apply, said once (bd-gr4fy.7). A call site that sends its model
 * straight to the direct lane (getClientForModel with an `anthropic-direct/` id: the lesson-plan
 * author, the quiz key check) never reaches the per-job override, so an override written for such
 * a job did nothing and said nothing. Reported once per job and override on
 * `llm.job_override_ignored`. The override's own attempts on this lane are marked `routed` and are
 * never reported.
 */
const _ignoredReported = new Set();
function noteIgnoredOverride(job, directId) {
  if (!job) return;
  const s = readSettings();
  if (!s.known || s.cfg.killSwitch) return;
  // eslint-disable-next-line global-require
  const { isModel } = require('../config/model-registry');
  const fromRow = s.cfg.perJob && s.cfg.perJob[job];
  const fromEnv = envJobModels()[job];
  const override = isModel(fromRow) ? fromRow : (isModel(fromEnv) ? fromEnv : null);
  if (!override || sameModel(override, directId)) return;
  const key = `${job} -> ${override}`;
  if (_ignoredReported.has(key)) return;
  _ignoredReported.add(key);
  // eslint-disable-next-line global-require
  const { logEvent } = require('../utils/structured-logger');
  logEvent('llm.job_override_ignored', {
    job, override, model: directId,
    why: 'this call site sends its model straight to the direct lane, which the per-job override does not reach',
  });
}

/**
 * The direct lane dressed as an OpenAI client, with the credit-exhaustion fallback.
 *
 * Returns `{ chat: { completions: { create } } }` — the ONLY surface any caller in this repo uses
 * — so no call site changes shape. `create` does three things in order:
 *
 *   1. translate the OpenAI-shaped payload to `/v1/messages` (dropping `temperature`, which this
 *      model rejects, and turning `reasoning:{enabled:false}` into `thinking:{type:'disabled'}`),
 *      passing `cache_control` blocks through UNTOUCHED — that pass-through is the entire reason
 *      this lane was rebuilt;
 *   2. map the reply back, including the cache split and a LIST-PRICE cost, because Anthropic
 *      returns no `cost` field and `accumulateUsage` reads one;
 *   3. on a credit-class failure, re-issue the SAME call on OpenRouter, mark the returned usage,
 *      and emit `lp612.llm.fallback_provider` — so a dry balance costs a few seconds, not the
 *      lesson.
 *
 * Built per call rather than memoised: it is three closures over a singleton HTTP client, which
 * costs nothing beside a 60-second model call, and it lets the caller hand in the correlationId
 * and stage that make the fallback event queryable instead of anonymous.
 */
function buildDirectLaneClient(directModel, ctx) {
  const context = ctx || {};

  // `options` are the per-call SDK options (timeout, retries). They used to stop here, so a caller's
  // 30 s budget with no retries became 180 s twice on this lane (bd-gr4fy.6).
  async function create(params, options) {
    if (!context.routed) noteIgnoredOverride(context.job, `${ANTHROPIC_DIRECT_PREFIX}${directModel}`);
    const payload = { ...params, model: directModel };
    try {
      const startedAt = Date.now();
      // Options only when there are some: a caller that passes none (the lesson-plan author) sends
      // exactly the request it always has.
      const native = toNativeRequest(payload);
      const msg = options
        ? await getAnthropicDirectClient().messages.create(native, options)
        : await getAnthropicDirectClient().messages.create(native);
      const mapped = fromNativeResponse(msg, { json: jsonShapeFor(params) });
      // bd-8t362: this lane never touched the OpenRouter wrapper, so lesson-plan authoring,
      // the job with the largest spend here, recorded nothing while its own fallback did.
      // The facade has already worked out a real price, cache multipliers and all.
      recordModelCost(directModel, mapped, startedAt, { lane: 'anthropic-direct', job: context.job || null });
      return mapped;
    } catch (e) {
      if (!isCreditClassError(e)) throw e;

      const to = directFallbackModel(directModel);
      const status = e && (e.status != null ? e.status : e.statusCode);
      const reason = String((e && e.message) || 'unknown').slice(0, 300);

      // Two channels on purpose. `logEvent` is the queryable name the watcher and any Axiom
      // query use; `logToFile` is the human sentence beside it in the same correlation trace.
      // Required at call time so the module graph here stays a leaf — llm-client is required by
      // almost everything, and a top-level require of the loggers has bitten the circular-deps
      // suite before.
      // eslint-disable-next-line global-require
      const { logEvent } = require('../utils/structured-logger');
      // eslint-disable-next-line global-require
      const { logToFile } = require('../utils/logger');
      // Only what is KNOWN goes on the event (bd-gr4fy.6). `logEvent` spreads the data over the
      // correlation id it reads from context, so a `correlationId: null` here erased the real one,
      // and every job moved onto this lane fell back as an anonymous lesson-plan event.
      const where = {
        ...(context.correlationId ? { correlationId: context.correlationId } : {}),
        ...(context.stage ? { stage: context.stage } : {}),
        ...(context.job ? { job: context.job } : {}),
      };
      logEvent('lp612.llm.fallback_provider', {
        ...where,
        from: `${ANTHROPIC_DIRECT_PREFIX}${directModel}`,
        to,
        reason,
        status: status == null ? null : status,
      });
      logToFile(
        'llm-client: the direct-Anthropic lane could not spend — falling back to OpenRouter',
        { ...where, from: `${ANTHROPIC_DIRECT_PREFIX}${directModel}`, to, status: status == null ? null : status, reason },
        'warn'
      );

      let res;
      try {
        // The retry keeps the job's name, so its spend is not recorded anonymously, and is marked
        // as already resolved, so the job's override cannot send it back here (bd-gr4fy.1).
        res = await getClient().chat.completions.create({
          ...params, model: to, ...(context.job ? { job: context.job } : {}), skipJobOverride: true,
        }, options);
      } catch (fallbackErr) {
        // BOTH PROVIDERS FAILED. Whoever reads this needs the FIRST failure as much as the
        // second: "OpenRouter returned 502" on its own sends the next engineer at OpenRouter,
        // when the story is "the prepaid balance ran out AND the fallback was down". `cause` is
        // where node's own error chain puts it and where the logger already looks.
        fallbackErr.cause = fallbackErr.cause || e;
        fallbackErr.message =
          `${fallbackErr.message} (after the direct-Anthropic lane could not spend: ${reason})`;
        throw fallbackErr;
      }
      // THE LESSON MUST SAY WHERE IT WAS AUTHORED. A fallback that produced a perfect lesson and
      // reported it as credit-funded would make the whole point of this lane unmeasurable, and
      // would tell the operator his balance was draining when it was not.
      if (res && typeof res === 'object') {
        // bd-4uw7n: keep the DEEPER answer. getClient() is now wrapped, so this call can
        // itself have fallen through to OpenAI. Stamping `to` unconditionally would relabel a
        // lesson OpenAI wrote as one Claude wrote, which is exactly the reporting this lane's
        // own comment says must never happen.
        const already = res.usage && res.usage.provider_fallback_to;
        res.usage = {
          ...(res.usage || {}),
          provider_fallback: true,
          provider_fallback_to: already || to,
          ...(already ? { provider_fallback_via: to } : {}),
        };
      }
      return res;
    }
  }

  return { chat: { completions: { create } } };
}

/**
 * Resolve the client AND the model id to send, for one model.
 *
 * Returns `{ client, model }`. The caller must use the RETURNED model id: the
 * `anthropic-direct/` prefix is our routing token and Anthropic 404s on it.
 *
 * An unprefixed id is returned untouched on the shared OpenRouter client, so
 * every existing caller keeps its current behaviour.
 *
 * `ctx` ({correlationId, stage}) is OPTIONAL and used only to label a provider fallback. Callers
 * that pass nothing behave exactly as before.
 */
function getClientForModel(model, ctx) {
  const id = String(model || '');
  if (id.startsWith(ANTHROPIC_DIRECT_PREFIX)) {
    const directModel = id.slice(ANTHROPIC_DIRECT_PREFIX.length);
    // Fail fast on a missing key here, at resolution time, exactly as before — the error must not
    // wait until the first await inside `create`.
    getAnthropicDirectClient();
    // ...and fail just as fast if the mandatory fallback could not run. See above: a net that is
    // present but not attached is worse than no net, because it is invisible until it is needed.
    assertFallbackUsable(directModel);
    return { client: buildDirectLaneClient(directModel, ctx), model: directModel };
  }
  // bd-4uw7n: a caller that names its job gets the ladder armed with THAT job's frozen
  // fallback. One that does not keeps today's behaviour.
  const fallbackModel = resolveJobFallback(ctx && ctx.job);
  const job = (ctx && ctx.job) || null;
  // Nothing to wrap: no job named AND no fallback to arm. Behaves exactly as before.
  if (!fallbackModel && !job) return { client: getClient(), model: id };
  const base = getClient();
  return {
    model: id,
    client: { chat: { completions: {
      // A job whose frozen fallback is null (lp.author, lp.fidelity, hcp.feedback) still gets
      // wrapped, because it still needs its spend attributed. `fallbackModel: null` arms
      // nothing -- the wrapper already treats a null `to` as "no net" and rethrows.
      create: (params, options) => base.chat.completions.create(
        { ...params, fallbackModel, job }, options),
    } } },
  };
}

/**
 * Get the default model name.
 */
function getDefaultModel() {
  return DEFAULT_MODEL;
}

/**
 * Get current provider info (for diagnostics/health checks).
 */
function getProviderInfo() {
  return {
    provider: PROVIDER,
    model: DEFAULT_MODEL,
    baseURL: PROVIDER === 'openrouter' ? OPENROUTER_BASE_URL : 'https://api.openai.com/v1',
    // Lets a health check answer "is the grant wired?" without spending a call.
    // Reports CONFIGURED, not IN USE — nothing routes to the grant until a model
    // id carries the prefix.
    anthropicDirectConfigured: Boolean((process.env.ANTHROPIC_API_KEY || '').trim()),
  };
}

/**
 * For a client that talks to a vendor DIRECTLY rather than through getClient(): the two things
 * getClient() gives every call and a raw client was missing. bd-wgso2.
 *
 *   - `job` / `fallbackModel` are stripped before the request goes out (a raw SDK sends every field
 *     it is given, and api.openai.com answers an unknown one with a 400 -- bd-3kv02);
 *   - the call's spend is recorded after it comes back, so it stops being invisible.
 *
 * NOTHING ELSE CHANGES, and that is the point of it. Same client, same provider, same key, same
 * model id, same params, same per-call options, same errors: it does not reroute a call through
 * OpenRouter, add an `openai/` prefix, or arm a fallback. Five live quiz/coaching services used a
 * raw client, NIETE's highest-volume feature among them, so they spent money no telemetry could
 * see; this makes them measurable without changing what any teacher receives. Rerouting them is a
 * separate decision with its own risk.
 *
 * Spend is recorded from whatever `usage` the vendor returned. api.openai.com reports tokens but no
 * price, so a direct call is recorded with tokens, duration and `costUnpriced: true` -- by design;
 * see model-cost.js, which records nothing rather than a guess.
 *
 * A call that throws records nothing and rethrows unchanged. Wrap a client ONCE: wrapping it twice
 * records every call twice.
 *
 * @param {object} client   an OpenAI-SDK-shaped client (chat.completions.create)
 * @param {{lane?: string}} [opts]  e.g. 'openai-direct', kept on the event beside the job
 */
function withSpendRecording(client, { lane } = {}) {
  const create = client.chat.completions.create.bind(client.chat.completions);
  client.chat.completions.create = async (params, options) => {
    const job = (params && params.job) || null;
    const skipJobOverride = !!(params && params.skipJobOverride === true);
    if (params && ('job' in params || 'fallbackModel' in params || 'skipJobOverride' in params)) {
      params = { ...params };
      delete params.job;
      delete params.fallbackModel;
      delete params.skipJobOverride;
    }
    const callSite = async (p) => {
      const startedAt = Date.now();
      const response = await create(p, options);
      recordModelCost(p && p.model, response, startedAt, lane ? { lane, job } : { job });
      return response;
    };
    // bd-gr4fy.3: the job's override applies here too, with this service's own client behind it.
    if (job && !skipJobOverride) return runWithJobOverride(job, params, options, callSite);
    return callSite(params);
  };
  return client;
}

module.exports = {
  createLLMClient,
  getClient,
  getClientForModel,
  withSpendRecording,
  getAnthropicDirectClient,
  directFallbackModel,
  assertFallbackUsable,
  getDefaultModel,
  getProviderInfo,
  ANTHROPIC_DIRECT_PREFIX,
};
