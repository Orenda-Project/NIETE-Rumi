/**
 * bd-upejat.45 — Claude Haiku 5.5 on the direct lane: priced, given its effort, and kept from
 * spending a short answer's limit on thinking.
 *
 * Haiku 5.5 is the cheapest Claude, and the Anthropic credits plan moves the short-output jobs to
 * it. Before this the direct lane:
 *   - held no price for it, so every call was recorded `cost_unpriced` and the monthly spend check
 *     went blind to it. It has two rate cards, chosen by prompt length: $0.10 / $0.50 per million
 *     tokens when the prompt is 100,000 tokens or fewer, $0.50 / $2.50 above (Anthropic's Haiku 5.5
 *     migration guide, `claude-api` skill, read 28 Oct 2026);
 *   - dropped an OpenRouter-spelled effort for every Haiku. Haiku 4.5 rejects effort; Haiku 5.5 is
 *     the first Haiku that takes it (low, medium, high, xhigh, max; default medium);
 *   - never switched its thinking off under a small output limit. It thinks by default, and the
 *     thinking counts against `max_tokens`, so a classifier's ten-token answer can be spent on
 *     thinking before any text. Thinking off is a 400 at effort xhigh or max, so it is never sent
 *     there.
 *
 * Everything below the network is real: the client, the switch, the facade and the cost recorder.
 * Only the vendors, the settings table and the log sink are stubbed, at the boundary.
 */
const mockState = { or: [], an: [], events: [], rows: [], anImpl: null };

jest.mock('openai', () => function OpenAI() {
  return {
    chat: { completions: { create: async (params) => {
      mockState.or.push(params);
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
        content: [{ type: 'text', text: 'pricing' }], usage: { input_tokens: 400, output_tokens: 3 },
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

const facade = () => {
  load();
  // eslint-disable-next-line global-require
  return require('../../bot/shared/services/anthropic-native-facade');
};

const HAIKU = 'claude-haiku-5-5';
const DIRECT_HAIKU = `anthropic-direct/${HAIKU}`;
const msgs = [{ role: 'user', content: 'Which subject is this lesson?' }];
const ask = (extra = {}) => ({
  model: 'openai/gpt-4.1-mini', job: 'chat.intent', max_tokens: 10, temperature: 0, messages: msgs, ...extra,
});
const moveTo = (job, model) => ({ ANTHROPIC_API_KEY: 'grant-key', LLM_JOB_MODELS: JSON.stringify({ [job]: model }) });

beforeEach(() => {
  mockState.or = []; mockState.an = []; mockState.events = []; mockState.rows = []; mockState.anImpl = null;
});
afterEach(() => { process.env = { ...OLD_ENV }; });

// ---------------------------------------------------------------------------------------------
describe('a reply from Haiku 5.5 is priced, on the rate card its prompt length selects', () => {
  test('a prompt of 100,000 tokens or fewer: $0.10 in, $0.50 out, cache reads 0.1x, five-minute writes 1.25x', () => {
    const { priceUsd } = facade();
    const usage = { input_tokens: 2000, cache_creation_input_tokens: 10000, cache_read_input_tokens: 40000, output_tokens: 500 };
    // 2,000 x $0.10 + 10,000 x $0.125 + 40,000 x $0.01 + 500 x $0.50, per million: a 52,000-token prompt.
    expect(priceUsd(HAIKU, usage)).toBeCloseTo((2000 * 0.10 + 10000 * 0.125 + 40000 * 0.01 + 500 * 0.50) / 1e6, 12);
    expect(priceUsd(HAIKU, usage)).toBeCloseTo(0.0021, 12);
  });

  test('a prompt over 100,000 tokens: $0.50 in, $2.50 out, cache reads still 0.1x of the input rate', () => {
    const { priceUsd } = facade();
    const usage = { input_tokens: 90000, cache_read_input_tokens: 20000, output_tokens: 1000 };
    // 110,000 prompt tokens: 90,000 x $0.50 + 20,000 x $0.05 + 1,000 x $2.50, per million.
    expect(priceUsd(HAIKU, usage)).toBeCloseTo((90000 * 0.50 + 20000 * 0.05 + 1000 * 2.50) / 1e6, 12);
  });

  test('the split is at the prompt, cache reads and writes included: 100,000 stays on the lower card, 100,001 does not', () => {
    const { priceUsd } = facade();
    expect(priceUsd(HAIKU, { input_tokens: 60000, cache_read_input_tokens: 40000, output_tokens: 100 }))
      .toBeCloseTo((60000 * 0.10 + 40000 * 0.01 + 100 * 0.50) / 1e6, 12);
    expect(priceUsd(HAIKU, { input_tokens: 60001, cache_read_input_tokens: 40000, output_tokens: 100 }))
      .toBeCloseTo((60001 * 0.50 + 40000 * 0.05 + 100 * 2.50) / 1e6, 12);
  });

  test('a one-hour cache write is billed at 2x the input rate', () => {
    const { priceUsd } = facade();
    const usage = {
      input_tokens: 0, cache_creation_input_tokens: 10000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 10000 }, output_tokens: 0,
    };
    expect(priceUsd(HAIKU, usage)).toBeCloseTo((10000 * 0.10 * 2) / 1e6, 12);
  });

  test('the mapped reply carries a cost, not cost_unpriced', () => {
    const { fromNativeResponse, priceUsd } = facade();
    const usage = { input_tokens: 400, output_tokens: 3 };
    const res = fromNativeResponse({ model: HAIKU, stop_reason: 'end_turn', content: [{ type: 'text', text: 'maths' }], usage });
    expect(res.usage.cost_unpriced).toBeUndefined();
    expect(res.usage.cost).toBeCloseTo(priceUsd(HAIKU, usage), 15);
    expect(res.usage.cost).toBeGreaterThan(0);
  });

  test('a model without a second rate card keeps its one price at any prompt length', () => {
    const { priceUsd } = facade();
    expect(priceUsd('claude-sonnet-5', { input_tokens: 150000, output_tokens: 0 })).toBeCloseTo(0.3, 12);
    expect(priceUsd('claude-haiku-4-5', { input_tokens: 150000, output_tokens: 0 })).toBeCloseTo(0.15, 12);
  });
});

// ---------------------------------------------------------------------------------------------
describe('effort reaches Haiku 5.5, and still never reaches Haiku 4.5', () => {
  test("OpenRouter's reasoning.effort and OpenAI's reasoning_effort become output_config.effort", () => {
    const { toNativeRequest } = facade();
    expect(toNativeRequest({ model: HAIKU, reasoning: { effort: 'low' }, messages: msgs }).output_config).toEqual({ effort: 'low' });
    expect(toNativeRequest({ model: HAIKU, reasoning_effort: 'high', messages: msgs }).output_config).toEqual({ effort: 'high' });
    expect(toNativeRequest({ model: HAIKU, reasoning_effort: 'minimal', messages: msgs }).output_config).toEqual({ effort: 'low' });
  });

  test('Haiku 4.5, dated or not, gets no effort (it rejects the parameter)', () => {
    const { toNativeRequest } = facade();
    expect(toNativeRequest({ model: 'claude-haiku-4-5', reasoning_effort: 'low', messages: msgs }).output_config).toBeUndefined();
    expect(toNativeRequest({ model: 'claude-haiku-4-5-20251001', reasoning: { effort: 'low' }, messages: msgs }).output_config).toBeUndefined();
  });

  test('temperature, top_p and top_k never reach Haiku 5.5 (each is a 400 there)', () => {
    const { toNativeRequest } = facade();
    const out = toNativeRequest({ model: HAIKU, temperature: 0, top_p: 0.5, top_k: 5, messages: msgs });
    expect(out.temperature).toBeUndefined();
    expect(out.top_p).toBeUndefined();
    expect(out.top_k).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
describe("Haiku 5.5's thinking is switched off where a short answer needs the room, and only where that is allowed", () => {
  test('a job moved to Haiku 5.5 with a ten-token limit is sent thinking:disabled (and no temperature)', async () => {
    const { getClient } = await loadWithSettings(moveTo('chat.intent', DIRECT_HAIKU));
    await getClient().chat.completions.create(ask());
    expect(mockState.an).toHaveLength(1);
    expect(mockState.an[0].model).toBe(HAIKU);
    expect(mockState.an[0].thinking).toEqual({ type: 'disabled' });
    expect(mockState.an[0].temperature).toBeUndefined();
  });

  test('moved by the settings row, the same; and its cost event carries a price', async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key' },
      [{ key: 'llm_per_job', value: { 'chat.intent': DIRECT_HAIKU } }]);
    await getClient().chat.completions.create(ask());
    expect(mockState.an[0].thinking).toEqual({ type: 'disabled' });
    const cost = mockState.events.find((e) => e.name === 'api.cost.incurred' && e.data.lane === 'anthropic-direct');
    expect(cost).toBeDefined();
    expect(cost.data).toMatchObject({ model: HAIKU, job: 'chat.intent' });
    expect(cost.data.costUnpriced).toBeUndefined();
    // The stubbed reply: 400 tokens in, 3 out, at $0.10 and $0.50 per million.
    expect(cost.data.estimatedCostUsd).toBeCloseTo((400 * 0.10 + 3 * 0.50) / 1e6, 15);
  });

  test('at 2,048 tokens or more nothing about thinking or effort is added', async () => {
    const { getClient } = await loadWithSettings(moveTo('chat.intent', DIRECT_HAIKU));
    await getClient().chat.completions.create(ask({ max_tokens: 2048 }));
    expect(mockState.an[0].thinking).toBeUndefined();
    expect(mockState.an[0].output_config).toBeUndefined();
  });

  test('a caller that names its own effort keeps it, and thinking is left to the model', async () => {
    const { getClient } = await loadWithSettings(moveTo('chat.intent', DIRECT_HAIKU));
    await getClient().chat.completions.create(ask({ reasoning: { effort: 'low' } }));
    expect(mockState.an[0].thinking).toBeUndefined();
    expect(mockState.an[0].output_config).toEqual({ effort: 'low' });
  });

  test('thinking:disabled is never sent at effort xhigh or max (a 400 on Haiku 5.5); the effort is sent instead', () => {
    const { toNativeRequest } = facade();
    for (const level of ['xhigh', 'max']) {
      const out = toNativeRequest({ model: HAIKU, reasoning: { enabled: false }, reasoning_effort: level, messages: msgs });
      expect(out.thinking).toBeUndefined();
      expect(out.output_config).toEqual({ effort: level });
    }
  });

  test('at effort high or below, thinking:disabled goes with the effort', () => {
    const { toNativeRequest } = facade();
    const out = toNativeRequest({ model: HAIKU, reasoning: { enabled: false, effort: 'high' }, messages: msgs });
    expect(out.thinking).toEqual({ type: 'disabled' });
    expect(out.output_config).toEqual({ effort: 'high' });
  });
});
