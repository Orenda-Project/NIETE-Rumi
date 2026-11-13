/**
 * bd-lk7e3f.6.3 — a job can ask a Claude model that thinks by default for an effort of its own; lesson moments
 * (coaching.reflectiveCorpus) asks for low.
 *
 * Moved to Claude Haiku 5.5 at its default effort (medium), lesson moments thought past its 6,000-token limit on
 * 12 of 235 calls in one morning and each was handed back. Run on 30 real lessons and the 13 that had failed, through
 * the job's own code, it was never cut off at low effort (86 calls), at about a tenth of Haiku 4.5's cost. So the job
 * asks for low effort, and only where that means something: on a Claude model that thinks by default. Haiku 4.5 does
 * not think unless asked and rejects effort; DeepSeek and every OpenRouter model never see the field; a call that
 * says what it wants keeps it; and a reply handed back to the job's own model goes there as the call site wrote it.
 *
 * Everything below the network is real: the client, the switch, the facade and the job's own router. Only the
 * vendors, the settings table and the log sink are stubbed, at the boundary (as haiku-5-5-direct-lane.test.js).
 */
const mockState = { or: [], an: [], events: [], rows: [], anImpl: null };

jest.mock('openai', () => function OpenAI() {
  return {
    chat: { completions: { create: async (params) => {
      mockState.or.push(params);
      return { choices: [{ index: 0, message: { role: 'assistant', content: '{"from":"openrouter"}' }, finish_reason: 'stop' }], usage: { cost: 0.001 } };
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
        content: [{ type: 'text', text: '{"lesson_throughline_en":"x","significant_moments":[]}' }], usage: { input_tokens: 400, output_tokens: 30 },
      };
    } },
  };
});

jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: mockState.rows, error: null }) }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (name, data) => mockState.events.push({ name, data }),
  getCurrentCorrelationId: () => 'corr-1',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({
  mode: () => 'off', wrapChatCompletions: () => {},
}));

const OLD_ENV = { ...process.env };

function load(env = {}) {
  jest.resetModules();
  for (const k of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'LLM_PROVIDER', 'LLM_JOB_MODELS',
    'LLM_FALLBACK_OFF', 'LLM_DIRECT_FALLBACK_MODEL']) delete process.env[k];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
    ...env,
  });
  // eslint-disable-next-line global-require
  return require('../../bot/shared/services/llm-client');
}

async function loadWithSettings(env, rows = []) {
  mockState.rows = rows;
  const mod = load(env);
  // eslint-disable-next-line global-require
  await require('../../bot/shared/config/model-settings').refresh();
  return mod;
}

const JOB = 'coaching.reflectiveCorpus';
const HAIKU55 = 'anthropic-direct/claude-haiku-5-5';
const HAIKU45 = 'anthropic-direct/claude-haiku-4-5';
const msgs = [{ role: 'system', content: 'Extract the moments.' }, { role: 'user', content: 'LESSON TRANSCRIPT:\n...' }];
// The request the job's router makes (llm-router.service.js callReflective, step 'corpus'): its own model, the job's
// name, JSON asked for, 3,000 tokens, temperature 0.7.
const corpusAsk = (extra = {}) => ({
  model: 'deepseek/deepseek-v3.2', job: JOB, messages: msgs, response_format: { type: 'json_object' },
  max_tokens: 3000, temperature: 0.7, ...extra,
});
const moveTo = (job, model) => ({ ANTHROPIC_API_KEY: 'grant-key', LLM_JOB_MODELS: JSON.stringify({ [job]: model }) });

beforeEach(() => {
  mockState.or = []; mockState.an = []; mockState.events = []; mockState.rows = []; mockState.anImpl = null;
});
afterEach(() => { process.env = { ...OLD_ENV }; });

// ---------------------------------------------------------------------------------------------
describe('the registry says which jobs ask for an effort of their own', () => {
  test('lesson moments asks for low, and every entry is a job the registry knows at an effort the facade sends', () => {
    load();
    // eslint-disable-next-line global-require
    const { JOB_EFFORT, JOBS } = require('../../bot/shared/config/model-registry');
    expect(JOB_EFFORT[JOB]).toBe('low');
    for (const [job, effort] of Object.entries(JOB_EFFORT)) {
      expect(JOBS[job]).toBeDefined();
      expect(['low', 'medium', 'high', 'xhigh', 'max']).toContain(effort);
    }
    expect(Object.isFrozen(JOB_EFFORT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('lesson moments on a Claude model that thinks by default asks for low effort', () => {
  test('moved to Haiku 5.5: low effort, thinking left to the model (not switched off), the 6,000-token limit', async () => {
    const { getClient } = await loadWithSettings(moveTo(JOB, HAIKU55));
    await getClient().chat.completions.create(corpusAsk());
    expect(mockState.an).toHaveLength(1);
    expect(mockState.an[0].model).toBe('claude-haiku-5-5');
    expect(mockState.an[0].output_config).toEqual({ effort: 'low' });
    expect(mockState.an[0].thinking).toBeUndefined();
    expect(mockState.an[0].max_tokens).toBe(6000);
    expect(mockState.an[0].temperature).toBeUndefined();
  });

  test('moved by the settings row, the same', async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key' },
      [{ key: 'llm_per_job', value: { [JOB]: HAIKU55 } }]);
    await getClient().chat.completions.create(corpusAsk());
    expect(mockState.an[0].output_config).toEqual({ effort: 'low' });
    expect(mockState.an[0].thinking).toBeUndefined();
  });

  test("through the job's own router (callReflective, step corpus), the same", async () => {
    await loadWithSettings(moveTo(JOB, HAIKU55));
    // eslint-disable-next-line global-require
    const { callReflective } = require('../../bot/shared/services/coaching/reflective-questions/llm-router.service');
    const r = await callReflective(msgs, { maxTokens: 3000, step: 'corpus' });
    expect(mockState.an).toHaveLength(1);
    expect(mockState.an[0].model).toBe('claude-haiku-5-5');
    expect(mockState.an[0].output_config).toEqual({ effort: 'low' });
    expect(mockState.an[0].thinking).toBeUndefined();
    expect(mockState.or).toHaveLength(0);
    expect(r.model_used).toBe(HAIKU55);
  });

  test('on Sonnet 5, which also thinks by default and takes effort, the same', async () => {
    const { getClient } = await loadWithSettings(moveTo(JOB, 'anthropic-direct/claude-sonnet-5'));
    await getClient().chat.completions.create(corpusAsk());
    expect(mockState.an[0].output_config).toEqual({ effort: 'low' });
  });
});

// ---------------------------------------------------------------------------------------------
describe('nothing changes anywhere else', () => {
  test('lesson moments on Haiku 4.5 (today): no effort and no thinking field, as before', async () => {
    const { getClient } = await loadWithSettings(moveTo(JOB, HAIKU45));
    await getClient().chat.completions.create(corpusAsk());
    expect(mockState.an).toHaveLength(1);
    expect(mockState.an[0].model).toBe('claude-haiku-4-5');
    expect(mockState.an[0].output_config).toBeUndefined();
    expect(mockState.an[0].thinking).toBeUndefined();
    expect(mockState.an[0].temperature).toBe(0.7);
  });

  test('lesson moments not moved, on its own model through OpenRouter: the request is the call site\'s, untouched', async () => {
    const { getClient } = await loadWithSettings({});
    await getClient().chat.completions.create(corpusAsk());
    expect(mockState.an).toHaveLength(0);
    expect(mockState.or).toHaveLength(1);
    expect(mockState.or[0].model).toBe('deepseek/deepseek-v3.2');
    expect(mockState.or[0].reasoning).toBeUndefined();
    expect(mockState.or[0].reasoning_effort).toBeUndefined();
  });

  test('another job moved to Haiku 5.5 at the same limit: no effort and no thinking field, as before', async () => {
    const { getClient } = await loadWithSettings(moveTo('coaching.questionRouter', HAIKU55));
    await getClient().chat.completions.create(corpusAsk({ job: 'coaching.questionRouter' }));
    expect(mockState.an[0].output_config).toBeUndefined();
    expect(mockState.an[0].thinking).toBeUndefined();
  });

  test('a lesson moments call that says what it wants keeps it (thinking off here, no effort added)', async () => {
    const { getClient } = await loadWithSettings(moveTo(JOB, HAIKU55));
    await getClient().chat.completions.create(corpusAsk({ reasoning: { enabled: false } }));
    expect(mockState.an[0].thinking).toEqual({ type: 'disabled' });
    expect(mockState.an[0].output_config).toBeUndefined();
  });

  test("a reply cut off on Haiku 5.5 is handed back to the job's own model as the call site wrote it, with no effort", async () => {
    mockState.anImpl = (req) => ({
      id: 'msg_cut', model: req.model, stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"lesson_throughline_en":"the class' }], usage: { input_tokens: 400, output_tokens: 6000 },
    });
    const { getClient } = await loadWithSettings(moveTo(JOB, HAIKU55));
    await getClient().chat.completions.create(corpusAsk());
    expect(mockState.an).toHaveLength(1);
    expect(mockState.an[0].output_config).toEqual({ effort: 'low' });
    expect(mockState.or).toHaveLength(1);
    expect(mockState.or[0].model).toBe('deepseek/deepseek-v3.2');
    expect(mockState.or[0].reasoning).toBeUndefined();
    expect(mockState.or[0].output_config).toBeUndefined();
    expect(mockState.or[0].max_tokens).toBe(3000);
    const back = mockState.events.find((e) => e.name === 'llm.job_override_fallback');
    expect(back && back.data.kind).toBe('cut_off');
  });
});
