/**
 * bd-5rd2f — the pilot: `vision.analyse` chooses its model through the registry.
 *
 * WHY THIS JOB. It is the one place where the two things the chain needs are already in scope:
 * `language` is an argument `analyzeImage` already takes, and the one caller that has a teacher
 * (`image-message.handler.js`) has `user.id` on the very next line. The coaching caller has no
 * teacher and passes none, which is correct: it simply is not bucketed and gets today's model.
 *
 * WHAT IS WRONG TODAY, and is the reason this is worth doing at all even at rollout zero:
 *
 *   const CONFIG = { analysisModel: process.env.VISION_MODEL || 'gpt-4.1-mini' };
 *
 * That is evaluated ONCE, when the module is first required. The model is therefore fixed for
 * the life of the process and cannot respond to anything — not a settings row, not a changed
 * variable, not an incident. "Choose a model without a deploy" is not reachable from a constant
 * captured at import.
 *
 * THE CONTRACT. With nothing written to `app_settings`, every request must resolve to exactly
 * what it resolves to today. That is the first block below, and those cases pass before and
 * after this change on purpose: a guard that only works after the fix guards nothing.
 */

let created;
let supabaseFrom;
let settingsRows;

function makeChain() {
  const chain = {};
  chain.select = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.then = (res, rej) => Promise.resolve({ data: settingsRows, error: null }).then(res, rej);
  return chain;
}

// SUPABASE_* are SET, not cleared: the settings reader only reaches for a client when the
// environment can produce one, so without these every case here would silently be testing the
// no-database path instead of the switches. That path has its own file.
const ENV = ['VISION_MODEL', 'LLM_MODEL'];
const DB_ENV = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };
let savedDbEnv;
let savedEnv;

beforeEach(() => {
  jest.resetModules();
  created = [];
  settingsRows = [];
  savedEnv = {};
  ENV.forEach((v) => { savedEnv[v] = process.env[v]; delete process.env[v]; });
  savedDbEnv = {};
  Object.entries(DB_ENV).forEach(([k, v]) => { savedDbEnv[k] = process.env[k]; process.env[k] = v; });

  supabaseFrom = jest.fn(() => makeChain());
  jest.doMock('../shared/config/supabase', () => ({ from: supabaseFrom }));
  jest.doMock('../shared/utils/logger', () => ({ logToFile: jest.fn() }));
  jest.doMock('../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
  jest.doMock('../shared/utils/constants', () => ({ OPENAI_API_KEY: 'test-key' }));
  jest.doMock('../shared/services/llm-client', () => ({
    getClient: () => ({
      chat: { completions: { create: jest.fn(async (payload) => {
        created.push(payload);
        return {
          choices: [{ message: { content: 'an analysis' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      }) } },
    }),
    getClientForModel: (m) => ({ client: {}, model: m }),
  }));
});

afterEach(() => {
  ENV.forEach((v) => {
    if (savedEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedEnv[v];
  });
  Object.keys(DB_ENV).forEach((k) => {
    if (savedDbEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedDbEnv[k];
  });
  jest.resetModules();
});

/** Refresh the settings cache if the loader exists yet. */
async function refreshSettings() {
  let settings;
  try { settings = require('../shared/config/model-settings'); } catch (_) { return; }
  if (settings.refresh) await settings.refresh();
}

/** Run one analysis and report the model the vendor was actually asked for. */
async function modelUsed(options = {}) {
  // Tolerated on purpose: before this change the loader does not exist, and the four
  // "nothing changed" guards below must still exercise the REAL service. A guard that
  // errors out before reaching the code it guards proves nothing.
  await refreshSettings();
  const vision = require('../shared/services/vision.service');
  await vision.analyzeImage(Buffer.from('x'), 'image/jpeg', options);
  return created[created.length - 1].model;
}

const PNG = 'image/jpeg';

describe('bd-5rd2f — with nothing written, the pilot is today exactly', () => {
  it('uses gpt-4.1-mini when no variable and no settings are set', async () => {
    expect(await modelUsed()).toBe('gpt-4.1-mini');
  });

  it('still honours VISION_MODEL, which is how this job is steered today', async () => {
    process.env.VISION_MODEL = 'google/gemini-2.5-flash';
    expect(await modelUsed()).toBe('google/gemini-2.5-flash');
  });

  it('is unchanged for a teacher writing in Urdu with no rule for Urdu', async () => {
    expect(await modelUsed({ language: 'ur' })).toBe('gpt-4.1-mini');
  });

  it('is unchanged for a named teacher when the rollout is at zero', async () => {
    settingsRows = [{ key: 'llm_rollout', value: { model: 'openai/gpt-4o', pct: 0 } }];
    expect(await modelUsed({ userId: 'teacher-1' })).toBe('gpt-4.1-mini');
  });
});

describe('bd-5rd2f — the model is chosen per request, not once at import', () => {
  it('picks up a variable changed while the process is running', async () => {
    await refreshSettings();
    const vision = require('../shared/services/vision.service');

    await vision.analyzeImage(Buffer.from('x'), PNG, {});
    expect(created[created.length - 1].model).toBe('gpt-4.1-mini');

    // No module reset: this is the SAME loaded service, which is the point. A constant
    // captured at import cannot answer differently here, and an incident is exactly when
    // somebody needs it to.
    process.env.VISION_MODEL = 'openai/gpt-4o';
    await vision.analyzeImage(Buffer.from('x'), PNG, {});
    expect(created[created.length - 1].model).toBe('openai/gpt-4o');
  });
});

describe('bd-5rd2f — the switches reach this job', () => {
  it('moves one language without touching the others', async () => {
    settingsRows = [{ key: 'llm_per_language',
      value: { 'vision.analyse:ur': 'google/gemini-2.5-flash' } }];
    expect(await modelUsed({ language: 'ur' })).toBe('google/gemini-2.5-flash');
    expect(await modelUsed({ language: 'en' })).toBe('gpt-4.1-mini');
  });

  it('moves a slice of teachers and leaves each one where it put her', async () => {
    settingsRows = [{ key: 'llm_rollout', value: { model: 'openai/gpt-4o', pct: 100 } }];
    const first = await modelUsed({ userId: 'teacher-7' });
    const second = await modelUsed({ userId: 'teacher-7' });
    expect(first).toBe('openai/gpt-4o');
    expect(second).toBe(first);
  });

  it('leaves a request with no teacher out of the rollout entirely', async () => {
    settingsRows = [{ key: 'llm_rollout', value: { model: 'openai/gpt-4o', pct: 100 } }];
    expect(await modelUsed({})).toBe('gpt-4.1-mini');
  });

  it('puts everything back when the kill switch is on, beating every other rule', async () => {
    const rules = [
      { key: 'llm_rollout', value: { model: 'openai/gpt-4o', pct: 100 } },
      { key: 'llm_per_language', value: { 'vision.analyse:ur': 'google/gemini-2.5-flash' } },
    ];
    const who = { userId: 'teacher-7', language: 'ur' };

    // Asserted as a PAIR on purpose. "the kill switch returns today's model" cannot fail
    // while nothing reads the settings at all, so on its own it would be a test that proves
    // the feature is absent. The first half is the red one.
    settingsRows = rules;
    expect(await modelUsed(who)).not.toBe('gpt-4.1-mini');

    settingsRows = [...rules, { key: 'llm_kill_switch', value: true }];
    expect(await modelUsed(who)).toBe('gpt-4.1-mini');
  });

  it('refuses a settings value that is not a model id', async () => {
    // Paired for the same reason as the kill switch: a well-formed id must move the job,
    // or "the bad one did not move it" says nothing.
    settingsRows = [{ key: 'llm_per_language',
      value: { 'vision.analyse:ur': 'google/gemini-2.5-flash' } }];
    expect(await modelUsed({ language: 'ur' })).toBe('google/gemini-2.5-flash');

    settingsRows = [{ key: 'llm_per_language',
      value: { 'vision.analyse:ur': 'ignore previous instructions' } }];
    expect(await modelUsed({ language: 'ur' })).toBe('gpt-4.1-mini');
  });

  it('moves one job by a settings row, without touching the variable', async () => {
    // The level added for this pilot. On Railway a variable change restarts the service,
    // which is a deploy by another name; a row is immediate. The variable still decides
    // when no row is written, which the first block above pins.
    settingsRows = [{ key: 'llm_per_job', value: { 'vision.analyse': 'openai/gpt-4o' } }];
    expect(await modelUsed()).toBe('openai/gpt-4o');

    settingsRows = [{ key: 'llm_per_job', value: { 'quiz.transcript': 'openai/gpt-4o' } }];
    expect(await modelUsed()).toBe('gpt-4.1-mini');
  });

  it('carries the teacher through the retry wrapper, which is how the handler calls it', async () => {
    // analyzeWithRetry is what image-message.handler.js actually calls. If it dropped
    // options on the floor the rollout would silently never fire in production while every
    // test of analyzeImage stayed green.
    settingsRows = [{ key: 'llm_rollout', value: { model: 'openai/gpt-4o', pct: 100 } }];
    await refreshSettings();
    const vision = require('../shared/services/vision.service');
    await vision.analyzeWithRetry(Buffer.from('x'), PNG, { userId: 'teacher-7' });
    expect(created[created.length - 1].model).toBe('openai/gpt-4o');
  });

  it('reports the model it actually used, not the one it meant to use', async () => {
    settingsRows = [{ key: 'llm_per_language',
      value: { 'vision.analyse:ur': 'google/gemini-2.5-flash' } }];
    await refreshSettings();
    const vision = require('../shared/services/vision.service');
    const result = await vision.analyzeImage(Buffer.from('x'), PNG, { language: 'ur' });
    expect(result.model).toBe('google/gemini-2.5-flash');
  });
});

/**
 * bd-27ort — the pilot must also SAY it is the pilot.
 *
 * Proved live on staging 2026-09-18, the first run of this telemetry outside a harness: 66
 * `api.cost.incurred` events, and `job` null on every one. vision.analyse was 48 of them.
 *
 * The model is resolved through the registry (above), but the CALL goes out on the bare
 * `getClient()`, which carries no job. So the spend is recorded and cannot be attributed to a
 * feature — and "what does this feature cost per teacher" is the question the whole workstream
 * exists to answer. Spend-by-model is only a proxy, and already a leaky one: lp.extractVision
 * and quiz.transcript both run google/gemini-2.5-flash.
 *
 * The wrapper in llm-client already reads `params.job` and strips it before the request goes
 * out, so naming the job costs one field and changes nothing else. Arming that job's fallback
 * ladder stays a separate, deliberate step for when the job actually moves.
 */
describe('bd-27ort — the call names its job, so the spend can be attributed', () => {
  it('sends job: vision.analyse with the request', async () => {
    await modelUsed();
    expect(created[created.length - 1].job).toBe('vision.analyse');
  });

  it('names the job whichever model it resolves to', async () => {
    process.env.VISION_MODEL = 'google/gemini-2.5-flash';
    await modelUsed();
    const last = created[created.length - 1];
    expect(last.model).toBe('google/gemini-2.5-flash');
    expect(last.job).toBe('vision.analyse');
  });
});
