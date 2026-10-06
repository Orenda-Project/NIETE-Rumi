/**
 * bd-gr4fy.1 — one place decides which model a job runs, and the job's own model stays behind it.
 *
 * Every live model call in the bot carries a `job` label (bd-jntcx, bd-8xmp9), but 24 of the 33
 * jobs that run still have their model written at the call site, so moving one meant a code change
 * and a deploy. The shared client now reads, per job:
 *
 *   kill switch (settings)  >  settings row `llm_per_job`  >  env `LLM_JOB_MODELS`  >  the call site
 *
 * and when an override names a different model it is tried first, with the call site's own model
 * behind it on ANY failure: an error, an empty answer, or not-JSON when JSON was asked for. With
 * nothing written, every request goes out exactly as before.
 */
const mockState = {
  or: [], an: [], recorded: [], events: [], rows: [], orImpl: null, anImpl: null,
};

jest.mock('openai', () => function OpenAI() {
  return {
    chat: { completions: { create: async (params) => {
      mockState.or.push(params);
      if (mockState.orImpl) return mockState.orImpl(params);
      return { choices: [{ index: 0, message: { role: 'assistant', content: 'from openrouter' }, finish_reason: 'stop' }], usage: { cost: 0.001 } };
    } } },
  };
});

jest.mock('@anthropic-ai/sdk', () => function Anthropic() {
  return {
    messages: { create: async (req) => {
      mockState.an.push(req);
      if (mockState.anImpl) return mockState.anImpl(req);
      return {
        id: 'msg_1', model: req.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'from claude' }], usage: { input_tokens: 5, output_tokens: 3 },
      };
    } },
  };
});

jest.mock('../../bot/shared/utils/model-cost', () => ({
  recordModelCost: (model, response, startedAt, extra) => mockState.recorded.push({ model, extra: extra || {} }),
}));
// The settings table is stubbed at the database boundary, so the real model-settings module
// parses the rows exactly as it does in production.
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: mockState.rows, error: null }) }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (name, data) => mockState.events.push({ name, data }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({
  mode: () => 'off', wrapChatCompletions: () => {},
}), { virtual: true });

const OLD_ENV = { ...process.env };

function load(env = {}) {
  jest.resetModules();
  for (const k of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'LLM_PROVIDER', 'LLM_JOB_MODELS',
    'LLM_FALLBACK_OFF', 'LLM_DIRECT_FALLBACK_MODEL']) delete process.env[k];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
    ...env,
  });
  // eslint-disable-next-line global-require
  return require('../../bot/shared/services/llm-client');
}

/** Load with app_settings rows already read, as a running process has them after its first minute. */
async function loadWithSettings(env, rows) {
  mockState.rows = rows;
  const mod = load(env);
  // eslint-disable-next-line global-require
  await require('../../bot/shared/config/model-settings').refresh();
  return mod;
}

const ask = (extra = {}) => ({
  model: 'openai/gpt-4.1-mini', job: 'chat.intent', max_tokens: 10, temperature: 0,
  messages: [{ role: 'user', content: 'Which feature does she want?' }], ...extra,
});

beforeEach(() => {
  mockState.or = []; mockState.an = []; mockState.recorded = []; mockState.events = [];
  mockState.rows = []; mockState.orImpl = null; mockState.anImpl = null;
});
afterEach(() => { process.env = { ...OLD_ENV }; });

describe('with nothing written, nothing changes', () => {
  test('the call goes out exactly as the call site wrote it, once', async () => {
    const { getClient } = load();
    await getClient().chat.completions.create(ask());
    expect(mockState.or).toHaveLength(1);
    expect(mockState.or[0]).toEqual({
      model: 'openai/gpt-4.1-mini', max_tokens: 10, temperature: 0,
      messages: [{ role: 'user', content: 'Which feature does she want?' }],
    });
    expect(mockState.an).toHaveLength(0);
  });

  test('the kill switch puts every job back on its own model', async () => {
    const { getClient } = await loadWithSettings(
      { LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic/claude-haiku-4-5' }) },
      [{ key: 'llm_kill_switch', value: true }, { key: 'llm_per_job', value: { 'chat.intent': 'anthropic/claude-sonnet-5' } }],
    );
    await getClient().chat.completions.create(ask());
    expect(mockState.or.map((p) => p.model)).toEqual(['openai/gpt-4.1-mini']);
  });

  test('a value that is not a model id is ignored, never sent', async () => {
    const { getClient } = load({ LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'Not A Model!' }) });
    await getClient().chat.completions.create(ask());
    expect(mockState.or.map((p) => p.model)).toEqual(['openai/gpt-4.1-mini']);
  });
});

describe('one place moves a job', () => {
  test('the env var moves a labelled job, and the spend is recorded under that job', async () => {
    const { getClient } = load({ LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic/claude-haiku-4-5' }) });
    await getClient().chat.completions.create(ask());
    expect(mockState.or).toHaveLength(1);
    expect(mockState.or[0].model).toBe('anthropic/claude-haiku-4-5');
    expect('job' in mockState.or[0]).toBe(false);
    expect(mockState.recorded[0]).toMatchObject({ model: 'anthropic/claude-haiku-4-5', extra: { job: 'chat.intent' } });
  });

  test('a settings row beats the env var, so a job moves without a restart', async () => {
    const { getClient } = await loadWithSettings(
      { LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic/claude-haiku-4-5' }) },
      [{ key: 'llm_per_job', value: { 'chat.intent': 'anthropic/claude-sonnet-5' } }],
    );
    await getClient().chat.completions.create(ask({ max_tokens: 4000 }));
    expect(mockState.or[0].model).toBe('anthropic/claude-sonnet-5');
  });

  test('a job moved onto the direct lane is billed to Anthropic, not sent to OpenRouter', async () => {
    const { getClient } = load({
      ANTHROPIC_API_KEY: 'grant-key',
      LLM_JOB_MODELS: JSON.stringify({ 'lang.detect': 'anthropic-direct/claude-haiku-4-5' }),
    });
    const res = await getClient().chat.completions.create(ask({ job: 'lang.detect', max_tokens: 15 }));
    expect(mockState.or).toHaveLength(0);
    expect(mockState.an).toHaveLength(1);
    expect(mockState.an[0].model).toBe('claude-haiku-4-5');
    expect(res.choices[0].message.content).toBe('from claude');
    expect(mockState.recorded[0]).toMatchObject({ model: 'claude-haiku-4-5', extra: { lane: 'anthropic-direct', job: 'lang.detect' } });
  });

  test('an unlabelled call is never moved', async () => {
    const { getClient } = load({ LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic/claude-haiku-4-5' }) });
    await getClient().chat.completions.create({ model: 'openai/gpt-4.1-mini', messages: [] });
    expect(mockState.or.map((p) => p.model)).toEqual(['openai/gpt-4.1-mini']);
  });
});

describe("the job's own model stays behind the new one", () => {
  test('an error from the new model falls back to the call-site model, and says so', async () => {
    const { getClient } = load({ LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic/claude-haiku-4-5' }) });
    mockState.orImpl = (p) => {
      if (p.model.includes('claude')) { const e = new Error('upstream exploded'); e.status = 500; throw e; }
      return { choices: [{ message: { content: 'lesson_plan' }, finish_reason: 'stop' }], usage: {} };
    };
    const res = await getClient().chat.completions.create(ask());
    expect(mockState.or.map((p) => p.model)).toEqual(['anthropic/claude-haiku-4-5', 'openai/gpt-4.1-mini']);
    expect(res.choices[0].message.content).toBe('lesson_plan');
    expect(res.usage.job_override_fallback).toMatchObject({ from: 'anthropic/claude-haiku-4-5', to: 'openai/gpt-4.1-mini' });
    const ev = mockState.events.find((e) => e.name === 'llm.job_override_fallback');
    expect(ev.data).toMatchObject({ job: 'chat.intent', from: 'anthropic/claude-haiku-4-5', to: 'openai/gpt-4.1-mini' });
  });

  test('an empty answer counts as a failure', async () => {
    const { getClient } = load({ LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic/claude-haiku-4-5' }) });
    mockState.orImpl = (p) => ({
      choices: [{ message: { content: p.model.includes('claude') ? '   ' : 'chat' }, finish_reason: 'stop' }], usage: {},
    });
    const res = await getClient().chat.completions.create(ask());
    expect(mockState.or).toHaveLength(2);
    expect(res.choices[0].message.content).toBe('chat');
  });

  test('when JSON was asked for, an answer that is not JSON counts as a failure', async () => {
    const { getClient } = load({ LLM_JOB_MODELS: JSON.stringify({ 'coaching.inferTopic': 'anthropic/claude-haiku-4-5' }) });
    mockState.orImpl = (p) => ({
      choices: [{ message: { content: p.model.includes('claude') ? 'Sure! {"topic": ' : '{"topic":"fractions"}' }, finish_reason: 'stop' }], usage: {},
    });
    const res = await getClient().chat.completions.create(ask({ job: 'coaching.inferTopic', response_format: { type: 'json_object' } }));
    expect(mockState.or).toHaveLength(2);
    expect(JSON.parse(res.choices[0].message.content)).toEqual({ topic: 'fractions' });
  });

  test('valid JSON from the new model is kept', async () => {
    const { getClient } = load({ LLM_JOB_MODELS: JSON.stringify({ 'coaching.inferTopic': 'anthropic/claude-haiku-4-5' }) });
    mockState.orImpl = () => ({ choices: [{ message: { content: '{"topic":"fractions"}' }, finish_reason: 'stop' }], usage: {} });
    await getClient().chat.completions.create(ask({ job: 'coaching.inferTopic', response_format: { type: 'json_object' } }));
    expect(mockState.or).toHaveLength(1);
  });

  test('without the Anthropic key, a direct-lane override leaves the job on its own model', async () => {
    const { getClient } = load({ LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic-direct/claude-haiku-4-5' }) });
    const res = await getClient().chat.completions.create(ask());
    expect(mockState.an).toHaveLength(0);
    expect(mockState.or.map((p) => p.model)).toEqual(['openai/gpt-4.1-mini']);
    expect(res.choices[0].message.content).toBe('from openrouter');
    expect(mockState.events.some((e) => e.name === 'llm.job_override_fallback')).toBe(true);
  });

  test("the direct lane's own credit fallback keeps the job's name and does not loop back", async () => {
    const { getClient } = load({
      ANTHROPIC_API_KEY: 'grant-key',
      LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic-direct/claude-haiku-4-5' }),
    });
    mockState.anImpl = () => { const e = new Error('Your credit balance is too low to access the Anthropic API.'); e.status = 400; throw e; };
    const res = await getClient().chat.completions.create(ask());
    expect(mockState.an).toHaveLength(1);
    expect(mockState.or.map((p) => p.model)).toEqual(['anthropic/claude-haiku-4-5']);
    expect(res.choices[0].message.content).toBe('from openrouter');
    expect(mockState.recorded.find((r) => r.model === 'anthropic/claude-haiku-4-5').extra.job).toBe('chat.intent');
  });
});

describe('a thinking model under a tiny output limit', () => {
  test('on the direct lane, thinking is turned off so the limit holds an answer', async () => {
    const { getClient } = load({
      ANTHROPIC_API_KEY: 'grant-key',
      LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic-direct/claude-sonnet-5' }),
    });
    await getClient().chat.completions.create(ask({ max_tokens: 10 }));
    expect(mockState.an[0].thinking).toEqual({ type: 'disabled' });
  });

  test("through OpenRouter, the same thing in OpenRouter's spelling", async () => {
    const { getClient } = load({ LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic/claude-sonnet-5' }) });
    await getClient().chat.completions.create(ask({ max_tokens: 10 }));
    expect(mockState.or[0].reasoning).toEqual({ enabled: false });
  });

  test('Haiku does not think unless asked, so nothing is added', async () => {
    const { getClient } = load({
      ANTHROPIC_API_KEY: 'grant-key',
      LLM_JOB_MODELS: JSON.stringify({ 'chat.intent': 'anthropic-direct/claude-haiku-4-5' }),
    });
    await getClient().chat.completions.create(ask({ max_tokens: 10 }));
    expect(mockState.an[0].thinking).toBeUndefined();
  });
});

describe('a routed job whose settings already resolved to the direct lane', () => {
  test('reaches Anthropic even through the plain client', async () => {
    const { getClient } = load({ ANTHROPIC_API_KEY: 'grant-key' });
    await getClient().chat.completions.create(ask({ job: 'assessment.generate', model: 'anthropic-direct/claude-sonnet-5', max_tokens: 8000 }));
    expect(mockState.or).toHaveLength(0);
    expect(mockState.an[0].model).toBe('claude-sonnet-5');
  });

  test('and falls back to the model that job already works with', async () => {
    const { getClient } = load({ ANTHROPIC_API_KEY: 'grant-key' });
    mockState.anImpl = () => { const e = new Error('overloaded'); e.status = 529; throw e; };
    await getClient().chat.completions.create(ask({ job: 'assessment.generate', model: 'anthropic-direct/claude-sonnet-5', max_tokens: 8000 }));
    expect(mockState.or.map((p) => p.model)).toEqual(['google/gemini-3.1-pro-preview']);
  });
});

describe('services with their own raw client', () => {
  const rawClient = (log, impl) => ({
    chat: { completions: { create: async (p) => { log.push(p); return impl ? impl(p) : { choices: [{ message: { content: 'raw answer' } }], usage: {} }; } } },
  });

  test('honour the same override', async () => {
    const { withSpendRecording } = load({
      ANTHROPIC_API_KEY: 'grant-key',
      LLM_JOB_MODELS: JSON.stringify({ 'quiz.videoReport': 'anthropic-direct/claude-haiku-4-5' }),
    });
    const raw = [];
    const client = withSpendRecording(rawClient(raw), { lane: 'openai-direct' });
    const res = await client.chat.completions.create({ model: 'gpt-5.4-mini', job: 'quiz.videoReport', max_completion_tokens: 600, messages: [{ role: 'user', content: 'x' }] });
    expect(raw).toHaveLength(0);
    expect(mockState.an).toHaveLength(1);
    expect(mockState.an[0].max_tokens).toBe(600);
    expect(res.choices[0].message.content).toBe('from claude');
  });

  test('and fall back to their own client when the new model fails', async () => {
    const { withSpendRecording } = load({
      ANTHROPIC_API_KEY: 'grant-key',
      LLM_JOB_MODELS: JSON.stringify({ 'quiz.videoReport': 'anthropic-direct/claude-haiku-4-5' }),
    });
    mockState.anImpl = () => { const e = new Error('server error'); e.status = 500; throw e; };
    const raw = [];
    const client = withSpendRecording(rawClient(raw), { lane: 'openai-direct' });
    const res = await client.chat.completions.create({ model: 'gpt-5.4-mini', job: 'quiz.videoReport', messages: [{ role: 'user', content: 'x' }] });
    expect(raw).toHaveLength(1);
    expect(raw[0].model).toBe('gpt-5.4-mini');
    expect('job' in raw[0]).toBe(false);
    expect(res.choices[0].message.content).toBe('raw answer');
  });
});
