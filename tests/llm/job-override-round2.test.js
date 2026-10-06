/**
 * bd-gr4fy.7 — a fresh adversarial review of the hardened override (bd-gr4fy.6, PR #1704) found
 * four more places where the promise did not quite hold. Each case below failed before the fix.
 *
 *   1. The model behind a settings-moved call site was GUESSED (the job's default, read without
 *      the family), so an Urdu paper fell back to the English default; and any unrelated
 *      per-language row made an unmoved call site look moved, changing its request.
 *   2. JSON extraction took the first fragment that parsed: "Filling the {} template: {...}"
 *      handed the caller `{}`, and a malformed answer followed by `{"score":0}` handed it 0.
 *   3. Three callers repair JSON themselves; the check was stricter than they are, so an answer
 *      they read fine fell back for nothing.
 *   4. An override the call site can never reach (it is on the direct lane) said nothing.
 *   5. The output-limit allowance is not free: it counts against output-rate limits and
 *      OpenRouter's up-front authorisation, so it is bounded.
 *
 * Only the vendors and the settings table are stubbed, at the boundary.
 */
const mockState = {
  or: [], orOpts: [], an: [], anOpts: [], recorded: [], events: [], rows: [], orImpl: null, anImpl: null,
};

jest.mock('openai', () => function OpenAI() {
  return {
    chat: { completions: { create: async (params, opts) => {
      mockState.or.push(params);
      mockState.orOpts.push(opts);
      if (mockState.orImpl) return mockState.orImpl(params);
      return { choices: [{ index: 0, message: { role: 'assistant', content: 'from openrouter' }, finish_reason: 'stop' }], usage: { cost: 0.001 } };
    } } },
  };
});

jest.mock('@anthropic-ai/sdk', () => function Anthropic() {
  return {
    messages: { create: async (req, opts) => {
      mockState.an.push(req);
      mockState.anOpts.push(opts);
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
}), { virtual: true });

const OLD_ENV = { ...process.env };

function load(env = {}) {
  jest.resetModules();
  for (const k of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'LLM_PROVIDER', 'LLM_JOB_MODELS', 'LLM_FALLBACK_OFF',
    'LLM_DIRECT_FALLBACK_MODEL', 'VISION_MODEL', 'ASSESSMENT_GEN_MODEL', 'ASSESSMENT_GEN_MODEL_ENG',
    'ASSESSMENT_GEN_MODEL_URDU']) delete process.env[k];
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

const answer = (content, finish = 'stop') => ({
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }], usage: {},
});
const moveTo = (job, model) => ({ LLM_JOB_MODELS: JSON.stringify({ [job]: model }) });
const fallbacks = () => mockState.events.filter((e) => e.name === 'llm.job_override_fallback');
const ask = (extra = {}) => ({
  model: 'openai/gpt-4o', job: 'training.capstoneScore', max_tokens: 700,
  messages: [{ role: 'user', content: 'Score this answer. Reply ONLY with JSON.' }], ...extra,
});

// The smallest tree the assessment generator accepts as a paper.
const ONE_QUESTION = JSON.stringify({ unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } });
const URDU_PAPER = {
  grade: 1, subject: 'Urdu', pageContent: '=== Page 4 ===\nسبق', pageReference: '4-14',
  contentSource: 'unseen', questionTypes: [{ id: 'MCQs', count: 5, category: 'objective' }],
};

beforeEach(() => {
  mockState.or = []; mockState.orOpts = []; mockState.an = []; mockState.anOpts = [];
  mockState.recorded = []; mockState.events = []; mockState.rows = []; mockState.orImpl = null; mockState.anImpl = null;
});
afterEach(() => { process.env = { ...OLD_ENV }; });

// ---------------------------------------------------------------------------------------------
describe('a call site that reads the settings declares its own model', () => {
  test('a moved Urdu paper falls back to the model Urdu runs today, not the English default', async () => {
    await loadWithSettings(
      { ASSESSMENT_GEN_MODEL_URDU: 'google/gemini-3-flash-preview' },
      [{ key: 'llm_per_job', value: { 'assessment.generate': 'anthropic/claude-haiku-4-5' } }],
    );
    mockState.orImpl = (p) => {
      if (p.model.includes('claude')) { const e = new Error('upstream exploded'); e.status = 500; throw e; }
      return answer(ONE_QUESTION);
    };
    // eslint-disable-next-line global-require
    const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
    await Gen.generateExam(URDU_PAPER);
    expect(mockState.or.map((p) => p.model)).toEqual(['anthropic/claude-haiku-4-5', 'google/gemini-3-flash-preview']);
  });

  test('an unrelated per-language row does not change a call site nobody moved', async () => {
    await loadWithSettings(
      { ASSESSMENT_GEN_MODEL_URDU: 'google/gemini-3-flash-preview' },
      [{ key: 'llm_per_language', value: { 'lang.detect:ur': 'anthropic/claude-haiku-4-5' } }],
    );
    mockState.orImpl = () => answer(ONE_QUESTION);
    // eslint-disable-next-line global-require
    const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
    await Gen.generateExam(URDU_PAPER);
    expect(mockState.or.map((p) => p.model)).toEqual(['google/gemini-3-flash-preview']);
    expect(mockState.orOpts[0]).toBeUndefined();
    expect(fallbacks()).toHaveLength(0);
  });

  test('vision, moved by the row, still falls back to the model it runs today', async () => {
    await loadWithSettings({}, [{ key: 'llm_per_job', value: { 'vision.analyse': 'anthropic/claude-haiku-4-5' } }]);
    mockState.orImpl = (p) => {
      if (p.model.includes('claude')) { const e = new Error('upstream exploded'); e.status = 500; throw e; }
      return answer('a bar chart');
    };
    // eslint-disable-next-line global-require
    const vision = require('../../bot/shared/services/vision.service');
    const out = await vision.analyzeImage(Buffer.from('png-bytes'), 'image/png', { language: 'en' });
    expect(mockState.or.map((p) => p.model)).toEqual(['anthropic/claude-haiku-4-5', 'openai/gpt-4.1-mini']);
    expect(out.analysis).toBe('a bar chart');
  });
});

// ---------------------------------------------------------------------------------------------
describe('JSON is taken from an answer only when there is no doubt which JSON is meant', () => {
  const run = async (claude, job = 'training.capstoneScore') => {
    const { getClient } = await loadWithSettings(moveTo(job, 'anthropic/claude-haiku-4-5'));
    mockState.orImpl = (p) => answer(p.model.includes('claude') ? claude : '{"score":61,"feedback":"own model"}');
    return getClient().chat.completions.create(ask({ job }));
  };

  test('an empty template before the answer is not the answer', async () => {
    const res = await run('Filling the {} template:\n{"score":72,"feedback":"good"}');
    expect(mockState.or).toHaveLength(2);
    expect(JSON.parse(res.choices[0].message.content).score).toBe(61);
  });

  test('a malformed answer is not replaced by a fragment written after it', async () => {
    const res = await run('{"score":72,"feedback":"good",}\n\nScale reminder: {"score":0}');
    expect(mockState.or).toHaveLength(2);
    expect(JSON.parse(res.choices[0].message.content).score).toBe(61);
  });

  test('an answer followed by a note with braces that are not JSON is still the answer', async () => {
    const res = await run('{"score":72,"feedback":"good"}\nNote: I used {your rubric}');
    expect(mockState.or).toHaveLength(1);
    expect(JSON.parse(res.choices[0].message.content)).toEqual({ score: 72, feedback: 'good' });
  });
});

// ---------------------------------------------------------------------------------------------
describe('callers that repair JSON themselves are checked the way they parse', () => {
  const run = async (job, claude) => {
    const { getClient } = await loadWithSettings(moveTo(job, 'anthropic/claude-haiku-4-5'));
    mockState.orImpl = (p) => answer(p.model.includes('claude') ? claude : '{"from":"own model"}');
    return getClient().chat.completions.create(ask({ job, max_tokens: 4000 }));
  };

  test('coaching.pedagogy: a trailing comma it repairs is accepted, and handed over untouched', async () => {
    const raw = '{"scores":{"engagement":3},"summary":"ok",}';
    const res = await run('coaching.pedagogy', raw);
    expect(mockState.or).toHaveLength(1);
    expect(res.choices[0].message.content).toBe(raw);
  });

  test('lp.extractText: a repairable object after a sentence is accepted', async () => {
    const raw = 'Here is the plan:\n{"title":"Fractions","steps":["a","b",]}';
    const res = await run('lp.extractText', raw);
    expect(mockState.or).toHaveLength(1);
    expect(res.choices[0].message.content).toBe(raw);
  });

  test('coaching.fidelityFallback: the same', async () => {
    const raw = 'Result: {"score":80,"notes":"fine",}';
    await run('coaching.fidelityFallback', raw);
    expect(mockState.or).toHaveLength(1);
  });

  test('coaching.pedagogy: prose its repair would turn into a string still falls back', async () => {
    await run('coaching.pedagogy', 'Sorry, I cannot score this lesson.');
    expect(mockState.or).toHaveLength(2);
  });

  test('a caller that does not repair (lp.editIntent) still falls back on a trailing comma', async () => {
    await run('lp.editIntent', '{"kind":"edit",}');
    expect(mockState.or).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------
describe('an override the call site cannot reach says so', () => {
  test('a direct-lane call site with an override configured reports it once, and still runs as before', async () => {
    const { getClientForModel } = await loadWithSettings(
      { ANTHROPIC_API_KEY: 'grant-key' },
      [{ key: 'llm_per_job', value: { 'quiz.keyVerify': 'google/gemini-2.5-flash' } }],
    );
    for (let i = 0; i < 2; i++) {
      const { client, model } = getClientForModel('anthropic-direct/claude-sonnet-5', { job: 'quiz.keyVerify' });
      // eslint-disable-next-line no-await-in-loop
      await client.chat.completions.create({ model, max_tokens: 500, messages: [{ role: 'user', content: 'solve' }] });
    }
    expect(mockState.an).toHaveLength(2);
    const ignored = mockState.events.filter((e) => e.name === 'llm.job_override_ignored');
    expect(ignored).toHaveLength(1);
    expect(ignored[0].data).toMatchObject({ job: 'quiz.keyVerify', override: 'google/gemini-2.5-flash' });
  });

  test("an override's own attempt on the direct lane is not reported as ignored", async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key', ...moveTo('chat.intent', 'anthropic-direct/claude-haiku-4-5') });
    await getClient().chat.completions.create(ask({ job: 'chat.intent', model: 'openai/gpt-4.1-mini', max_tokens: 10 }));
    expect(mockState.an).toHaveLength(1);
    expect(mockState.events.some((e) => e.name === 'llm.job_override_ignored')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the output-limit allowance is bounded', () => {
  test('a large limit gets 4096 more, not twice as much', async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key', ...moveTo('coaching.enhance', 'anthropic-direct/claude-sonnet-5') });
    await getClient().chat.completions.create(ask({ job: 'coaching.enhance', max_tokens: undefined, max_completion_tokens: 16000 }));
    expect(mockState.an[0].max_tokens).toBe(20096);
  });

  test('a small limit is still doubled', async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key', ...moveTo('chat.respond', 'anthropic-direct/claude-haiku-4-5') });
    await getClient().chat.completions.create(ask({ job: 'chat.respond', max_tokens: 500 }));
    expect(mockState.an[0].max_tokens).toBe(1000);
  });
});
