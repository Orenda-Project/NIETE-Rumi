/**
 * bd-gr4fy.6 — what the two audits of the per-job override (bd-gr4fy.1, PR #1701) found, each
 * pinned by a case that failed before the fix.
 *
 * The promise of the override is narrow and must hold everywhere: a moved job is tried on the new
 * model, and on ANY failure the model it runs today answers instead, and the log says so. The
 * audits found the places where that promise quietly did not hold:
 *
 *   - a call site that reads the settings row itself (vision, assessment) had NOTHING behind the
 *     new model, because the override and the call site's model were the same model;
 *   - a cut-off, refused, or wrong-shaped answer was handed to the caller as a success, and a
 *     cut-off JSON object could come back as one of its inner arrays;
 *   - a timed-out attempt was retried by the SDK before the fallback started, about six minutes;
 *   - thinking was switched off for models that reject that, so those overrides 400 every time;
 *   - a malformed setting, or one read before the kill switch was known, changed nothing visibly.
 *
 * Everything below the network is real: the client, the settings reader, the registry, the facade
 * and, where a call site is named, the call site itself. Only the vendors and the settings table
 * are stubbed, at the boundary.
 */
const mockState = {
  or: [], orOpts: [], an: [], anOpts: [], oa: [], recorded: [], events: [], rows: [], orImpl: null, anImpl: null,
};

jest.mock('openai', () => function OpenAI(cfg) {
  const direct = !(cfg && cfg.baseURL);
  return {
    chat: { completions: { create: async (params, opts) => {
      if (direct) { mockState.oa.push(params); return { choices: [{ message: { content: 'from openai' }, finish_reason: 'stop' }], usage: {} }; }
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
  for (const k of ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'LLM_PROVIDER', 'LLM_JOB_MODELS',
    'LLM_FALLBACK_OFF', 'LLM_DIRECT_FALLBACK_MODEL', 'VISION_MODEL', 'ASSESSMENT_GEN_MODEL',
    'ASSESSMENT_GEN_MODEL_ENG', 'ASSESSMENT_GEN_MODEL_URDU', 'CHILD_TEST_MODEL_COUNTS']) delete process.env[k];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
    ...env,
  });
  // eslint-disable-next-line global-require
  return require('../../bot/shared/services/llm-client');
}

/** Load with app_settings already read once, as a running process has them. */
async function loadWithSettings(env, rows = []) {
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
const moveTo = (job, model) => ({ LLM_JOB_MODELS: JSON.stringify({ [job]: model }) });
const fallbacks = () => mockState.events.filter((e) => e.name === 'llm.job_override_fallback');
const answer = (content, finish = 'stop', extraMsg = {}) => ({
  choices: [{ index: 0, message: { role: 'assistant', content, ...extraMsg }, finish_reason: finish }], usage: {},
});

beforeEach(() => {
  mockState.or = []; mockState.orOpts = []; mockState.an = []; mockState.anOpts = []; mockState.oa = [];
  mockState.recorded = []; mockState.events = []; mockState.rows = []; mockState.orImpl = null; mockState.anImpl = null;
});
afterEach(() => { process.env = { ...OLD_ENV }; });

// ---------------------------------------------------------------------------------------------
describe('a model always stands behind the override', () => {
  test('vision, moved by the settings row, falls back to the model it runs today (through the real call site)', async () => {
    await loadWithSettings({}, [{ key: 'llm_per_job', value: { 'vision.analyse': 'anthropic/claude-haiku-4-5' } }]);
    mockState.orImpl = (p) => {
      if (p.model.includes('claude')) { const e = new Error('upstream exploded'); e.status = 500; throw e; }
      return answer('a bar chart of attendance');
    };
    // eslint-disable-next-line global-require
    const vision = require('../../bot/shared/services/vision.service');
    const out = await vision.analyzeImage(Buffer.from('png-bytes'), 'image/png', { language: 'en' });
    expect(mockState.or.map((p) => p.model)).toEqual(['anthropic/claude-haiku-4-5', 'openai/gpt-4.1-mini']);
    expect(out.success).toBe(true);
    expect(out.analysis).toBe('a bar chart of attendance');
    expect(fallbacks()[0].data).toMatchObject({ job: 'vision.analyse', from: 'anthropic/claude-haiku-4-5', to: 'openai/gpt-4.1-mini' });
  });

  test("vision's finer settings (per language) are not overridden again by the per-job row", async () => {
    await loadWithSettings({}, [
      { key: 'llm_per_job', value: { 'vision.analyse': 'anthropic/claude-sonnet-5' } },
      { key: 'llm_per_language', value: { 'vision.analyse:ur': 'anthropic/claude-haiku-4-5' } },
    ]);
    // eslint-disable-next-line global-require
    const vision = require('../../bot/shared/services/vision.service');
    await vision.analyzeImage(Buffer.from('png-bytes'), 'image/png', { language: 'ur' });
    expect(mockState.or[0].model).toBe('anthropic/claude-haiku-4-5');
  });

  test('assessment, moved by the settings row, falls back to the model it runs today when the answer is not JSON (through the real call site)', async () => {
    await loadWithSettings({}, [{ key: 'llm_per_job', value: { 'assessment.generate': 'anthropic/claude-sonnet-5' } }]);
    const paper = JSON.stringify({ unseen: { objective: { MCQs: [{ question: 'q', marks: 1 }] } } });
    mockState.orImpl = (p) => answer(p.model.includes('claude') ? 'Here are your questions: 1. What is a fraction?' : paper);
    // eslint-disable-next-line global-require
    const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
    const out = await Gen.generateExam({
      grade: 1, subject: 'Eng', pageContent: '=== Page 4 ===\nHello', pageReference: '4-14',
      contentSource: 'unseen', questionTypes: [{ id: 'MCQs', count: 5, category: 'objective' }],
    });
    expect(mockState.or.map((p) => p.model)).toEqual(['anthropic/claude-sonnet-5', 'google/gemini-3.1-pro-preview']);
    expect(out.questionCount).toBe(1);
  });

  test("a call site on the direct lane keeps its own model behind an override, even with no frozen fallback", async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key', ...moveTo('childTest.counts', 'anthropic/claude-haiku-4-5') });
    mockState.orImpl = () => { const e = new Error('upstream exploded'); e.status = 500; throw e; };
    const res = await getClient().chat.completions.create(ask({ job: 'childTest.counts', model: 'anthropic-direct/claude-sonnet-5', max_tokens: 4000 }));
    expect(mockState.or.map((p) => p.model)).toEqual(['anthropic/claude-haiku-4-5']);
    expect(mockState.an.map((r) => r.model)).toEqual(['claude-sonnet-5']);
    expect(res.choices[0].message.content).toBe('from claude');
    expect(fallbacks()[0].data).toMatchObject({ job: 'childTest.counts', to: 'anthropic-direct/claude-sonnet-5' });
  });
});

// ---------------------------------------------------------------------------------------------
describe('an answer the caller cannot use puts the job back on its own model', () => {
  const run = async (claudeAnswer, extra = {}) => {
    const { getClient } = await loadWithSettings(moveTo(extra.job || 'chat.intent', 'anthropic/claude-haiku-4-5'));
    mockState.orImpl = (p) => (p.model.includes('claude') ? claudeAnswer : answer(extra.own || 'lesson_plan'));
    return getClient().chat.completions.create(ask(extra.params || {}));
  };

  test('cut off at the output limit', async () => {
    const res = await run(answer('The teacher wants a lesson pl', 'length'));
    expect(mockState.or).toHaveLength(2);
    expect(res.choices[0].message.content).toBe('lesson_plan');
    expect(fallbacks()[0].data).toMatchObject({ kind: 'cut_off', finishReason: 'length' });
  });

  test('stopped by a content filter', async () => {
    await run(answer('', 'content_filter'));
    expect(mockState.or).toHaveLength(2);
    expect(fallbacks()[0].data.kind).toBe('refused');
  });

  test('a refusal, even with text beside it', async () => {
    await run(answer('I cannot help with that.', 'stop', { refusal: 'I cannot help with that.' }));
    expect(mockState.or).toHaveLength(2);
    expect(fallbacks()[0].data.kind).toBe('refused');
  });

  test('a cut-off JSON object is never handed back as one of its inner arrays', async () => {
    const res = await run(answer('{"tags":["a","b"],"body":"the lesson began with'), {
      own: '{"tags":["x"],"body":"done"}', params: { job: 'chat.intent', response_format: { type: 'json_object' } },
    });
    expect(mockState.or).toHaveLength(2);
    expect(JSON.parse(res.choices[0].message.content)).toEqual({ tags: ['x'], body: 'done' });
  });

  test('json_object asked for, and the answer is valid JSON but not an object', async () => {
    for (const notAnObject of ['"ok"', '5', 'null', '["a","b"]']) {
      mockState.or = []; mockState.events = [];
      const res = await run(answer(notAnObject), { own: '{"ok":true}', params: { response_format: { type: 'json_object' } } });
      expect(mockState.or).toHaveLength(2);
      expect(JSON.parse(res.choices[0].message.content)).toEqual({ ok: true });
    }
  });

  test('an object followed by a note with braces in it is still the object', async () => {
    const res = await run(answer('{"topic":"x","tags":["a","b"]}\nNote: I used {your rubric}'), { params: { response_format: { type: 'json_object' } } });
    expect(mockState.or).toHaveLength(1);
    expect(JSON.parse(res.choices[0].message.content)).toEqual({ topic: 'x', tags: ['a', 'b'] });
  });

  test('on the direct lane, an answer cut off mid-object is not mined for JSON', async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key', ...moveTo('chat.intent', 'anthropic-direct/claude-haiku-4-5') });
    mockState.anImpl = (req) => ({
      id: 'm', model: req.model, stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"tags":["a","b"],"body":"the lesson began with' }], usage: { input_tokens: 5, output_tokens: 10 },
    });
    mockState.orImpl = () => answer('{"tags":[],"body":"ok"}');
    const res = await getClient().chat.completions.create(ask({ response_format: { type: 'json_object' } }));
    expect(mockState.or.map((p) => p.model)).toEqual(['openai/gpt-4.1-mini']);
    expect(JSON.parse(res.choices[0].message.content)).toEqual({ tags: [], body: 'ok' });
  });
});

// ---------------------------------------------------------------------------------------------
describe('jobs whose caller parses JSON without asking for JSON mode', () => {
  // Found by a survey of every moved job's call site: these prompts ask for JSON and the code
  // parses it, but the request sets no response_format, so the seam could not tell a broken answer
  // from a good one. On a parse failure several substitute a default without a word: a capstone
  // answer scores 0, a voice register finds "no names", a pedagogy array scores 0%.
  const JOBS_PARSING_JSON = [
    'coaching.pedagogy', 'coaching.fidelityFallback', 'lp.editIntent', 'lp.extractText',
    'attendance.voiceExtract', 'roster.extract', 'quiz.videoReport', 'training.capstoneScore',
  ];

  test.each(JOBS_PARSING_JSON)('%s: an answer with no JSON object in it puts the job back on its own model', async (job) => {
    const { getClient } = await loadWithSettings(moveTo(job, 'anthropic/claude-haiku-4-5'));
    mockState.orImpl = (p) => answer(p.model.includes('claude') ? 'Sure! Here is what I found in the lesson.' : '{"ok":true}');
    const res = await getClient().chat.completions.create(ask({ job, max_tokens: 2000 }));
    expect(mockState.or).toHaveLength(2);
    expect(JSON.parse(res.choices[0].message.content)).toEqual({ ok: true });
  });

  test.each(JOBS_PARSING_JSON)('%s: JSON in a fence is unwrapped and kept', async (job) => {
    const { getClient } = await loadWithSettings(moveTo(job, 'anthropic/claude-haiku-4-5'));
    mockState.orImpl = () => answer('```json\n{"ok":true}\n```');
    const res = await getClient().chat.completions.create(ask({ job, max_tokens: 2000 }));
    expect(mockState.or).toHaveLength(1);
    expect(res.choices[0].message.content).toBe('{"ok":true}');
  });

  test('through the real call site: a chatty classifier reply no longer degrades an edit to a question', async () => {
    await loadWithSettings(moveTo('lp.editIntent', 'anthropic/claude-haiku-4-5'));
    mockState.orImpl = (p) => answer(p.model.includes('claude') ? 'That sounds like an edit to the title.' : '{"kind":"edit"}');
    // eslint-disable-next-line global-require
    const { classifyEditIntent } = require('../../bot/shared/services/lp612-edit-intent.service');
    const out = await classifyEditIntent({ text: 'Change the title to Adding Fractions', language: 'en', correlationId: 'c1' });
    expect(out.kind).toBe('edit');
    expect(out.degraded).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
describe('the attempt on the new model is not retried before the fallback', () => {
  test('direct lane: no SDK retry, and the caller\'s own time budget', async () => {
    const { getClient } = await loadWithSettings({
      ANTHROPIC_API_KEY: 'grant-key',
      LLM_JOB_MODELS: JSON.stringify({ 'vision.analyse': 'anthropic-direct/claude-haiku-4-5', 'chat.intent': 'anthropic-direct/claude-haiku-4-5' }),
    });
    await getClient().chat.completions.create(ask({ job: 'vision.analyse', max_tokens: 800 }), { timeout: 30000, maxRetries: 0 });
    expect(mockState.anOpts[0]).toMatchObject({ timeout: 30000, maxRetries: 0 });

    mockState.anOpts = [];
    await getClient().chat.completions.create(ask({ job: 'chat.intent' }));
    expect(mockState.anOpts[0]).toMatchObject({ maxRetries: 0 });
  });

  test('OpenRouter: no SDK retry on the attempt, and the fallback keeps the caller\'s options', async () => {
    const { getClient } = await loadWithSettings(moveTo('chat.intent', 'anthropic/claude-haiku-4-5'));
    mockState.orImpl = (p) => {
      if (p.model.includes('claude')) { const e = new Error('timed out'); e.name = 'APIConnectionTimeoutError'; throw e; }
      return answer('lesson_plan');
    };
    await getClient().chat.completions.create(ask(), { timeout: 20000 });
    expect(mockState.orOpts[0]).toMatchObject({ timeout: 20000, maxRetries: 0 });
    expect(mockState.orOpts[1]).toEqual({ timeout: 20000 });
  });
});

// ---------------------------------------------------------------------------------------------
describe("a moved job's output limit is measured in the new model's tokens", () => {
  // Claude counts the same text in more tokens than the models these limits were sized for: the
  // eval measured 1.90x on coaching input, and a live Urdu answer at a 120-token limit was cut
  // off mid-sentence on Claude where the job's own model finished. Twice the limit keeps the same
  // length of text; a call is billed for what is written, not for the limit.
  test('direct lane: twice the limit, and the job\'s own model keeps the original', async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key', ...moveTo('chat.intent', 'anthropic-direct/claude-haiku-4-5') });
    mockState.anImpl = (req) => ({ id: 'm', model: req.model, stop_reason: 'max_tokens', content: [{ type: 'text', text: 'cut' }], usage: {} });
    await getClient().chat.completions.create(ask({ max_tokens: 120 }));
    expect(mockState.an[0].max_tokens).toBe(240);
    expect(mockState.or[0]).toMatchObject({ model: 'openai/gpt-4.1-mini', max_tokens: 120 });
  });

  test('OpenRouter, and max_completion_tokens, the same', async () => {
    const { getClient } = await loadWithSettings(moveTo('chat.intent', 'anthropic/claude-haiku-4-5'));
    await getClient().chat.completions.create(ask({ max_tokens: undefined, max_completion_tokens: 600 }));
    expect(mockState.or[0].max_tokens).toBe(1200);
  });

  test("a call site's own model on the direct lane is not a move, and keeps its limit", async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key' });
    await getClient().chat.completions.create(ask({ job: 'childTest.counts', model: 'anthropic-direct/claude-sonnet-5', max_tokens: 4000 }));
    expect(mockState.an[0].max_tokens).toBe(4000);
  });
});

// ---------------------------------------------------------------------------------------------
describe('thinking is adapted to what each model accepts', () => {
  test('Opus 5.5 cannot have thinking switched off: under a tiny limit it gets low effort instead', async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key', ...moveTo('chat.intent', 'anthropic-direct/claude-opus-5-5') });
    await getClient().chat.completions.create(ask({ max_tokens: 10 }));
    expect(mockState.an[0].thinking).toBeUndefined();
    expect(mockState.an[0].output_config).toMatchObject({ effort: 'low' });
  });

  test('Fable 5.1 the same', async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key', ...moveTo('chat.intent', 'anthropic-direct/claude-fable-5-1') });
    await getClient().chat.completions.create(ask({ max_tokens: 10 }));
    expect(mockState.an[0].thinking).toBeUndefined();
    expect(mockState.an[0].output_config).toMatchObject({ effort: 'low' });
  });

  test('Opus 5 still has thinking switched off under a tiny limit', async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key', ...moveTo('chat.intent', 'anthropic-direct/claude-opus-5') });
    await getClient().chat.completions.create(ask({ max_tokens: 10 }));
    expect(mockState.an[0].thinking).toEqual({ type: 'disabled' });
  });

  test("the facade never sends thinking:disabled where it is a 400", () => {
    load();
    // eslint-disable-next-line global-require
    const { toNativeRequest } = require('../../bot/shared/services/anthropic-native-facade');
    const msgs = [{ role: 'user', content: 'x' }];
    expect(toNativeRequest({ model: 'claude-fable-5-1', reasoning: { enabled: false }, messages: msgs }).thinking).toBeUndefined();
    expect(toNativeRequest({ model: 'claude-opus-5-5', reasoning: { enabled: false }, messages: msgs }).thinking).toBeUndefined();
    const opusMax = toNativeRequest({ model: 'claude-opus-5', reasoning: { enabled: false }, reasoning_effort: 'max', messages: msgs });
    expect(opusMax.thinking).toBeUndefined();
    expect(opusMax.output_config).toMatchObject({ effort: 'max' });
    expect(toNativeRequest({ model: 'claude-sonnet-5', reasoning: { enabled: false }, messages: msgs }).thinking).toEqual({ type: 'disabled' });
  });
});

// ---------------------------------------------------------------------------------------------
describe('the configuration is visible, and the kill switch is known before anything moves', () => {
  test('an env value that is not JSON is reported once, not dropped silently', async () => {
    const { getClient } = await loadWithSettings({ LLM_JOB_MODELS: "{'chat.intent': 'anthropic/claude-haiku-4-5'" });
    await getClient().chat.completions.create(ask());
    await getClient().chat.completions.create(ask());
    const cfgEvents = mockState.events.filter((e) => e.name === 'llm.job_override_config');
    expect(cfgEvents).toHaveLength(1);
    expect(cfgEvents[0].data.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'env' })]));
  });

  test('a bad model id and a misspelt job name in the settings row are both reported', async () => {
    const { getClient } = await loadWithSettings({}, [{ key: 'llm_per_job', value: { 'chat.intent': 'Not A Model!', 'chat.intnet': 'anthropic/claude-haiku-4-5', 'lang.detect': 'anthropic/claude-haiku-4-5' } }]);
    await getClient().chat.completions.create(ask());
    const ev = mockState.events.find((e) => e.name === 'llm.job_override_config');
    expect(ev.data.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'settings', job: 'chat.intent' })]));
    expect(ev.data.unknownJobs).toEqual(['chat.intnet']);
    expect(ev.data.active).toEqual({ 'chat.intnet': 'anthropic/claude-haiku-4-5', 'lang.detect': 'anthropic/claude-haiku-4-5' });
  });

  test('before the settings have been read once, an env override waits (the kill switch may be on)', async () => {
    mockState.rows = [{ key: 'llm_kill_switch', value: true }];
    const { getClient } = load(moveTo('chat.intent', 'anthropic/claude-haiku-4-5'));
    await getClient().chat.completions.create(ask());
    expect(mockState.or.map((p) => p.model)).toEqual(['openai/gpt-4.1-mini']);
  });

  test('with no database configured there is no kill switch to wait for', async () => {
    const { getClient } = load({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', ...moveTo('chat.intent', 'anthropic/claude-haiku-4-5') });
    await getClient().chat.completions.create(ask());
    expect(mockState.or.map((p) => p.model)).toEqual(['anthropic/claude-haiku-4-5']);
  });
});

// ---------------------------------------------------------------------------------------------
describe('what the logs say when it falls back', () => {
  test('the fallback event says what kind of failure, how long the attempt took, and the error name', async () => {
    const { getClient } = await loadWithSettings(moveTo('chat.intent', 'anthropic/claude-haiku-4-5'));
    mockState.orImpl = (p) => {
      if (p.model.includes('claude')) { const e = new Error('upstream exploded'); e.status = 500; throw e; }
      return answer('lesson_plan');
    };
    await getClient().chat.completions.create(ask());
    const d = fallbacks()[0].data;
    expect(d).toMatchObject({ kind: 'error', status: 500, errName: 'Error' });
    expect(typeof d.elapsedMs).toBe('number');
  });

  test("when the job's own model fails too, its error carries the first failure", async () => {
    const { getClient } = await loadWithSettings(moveTo('chat.intent', 'anthropic/claude-haiku-4-5'));
    mockState.orImpl = (p) => {
      const e = new Error(p.model.includes('claude') ? 'claude exploded' : 'gpt exploded'); e.status = 500; throw e;
    };
    let err;
    try { await getClient().chat.completions.create(ask()); } catch (e) { err = e; }
    expect(err.message).toMatch(/gpt exploded/);
    expect(err.message).toMatch(/anthropic\/claude-haiku-4-5/);
    expect(err.cause && err.cause.message).toBe('claude exploded');
  });

  test("the direct lane's credit fallback names the job and leaves the correlation id alone", async () => {
    const { getClient } = await loadWithSettings({ ANTHROPIC_API_KEY: 'grant-key', ...moveTo('chat.intent', 'anthropic-direct/claude-haiku-4-5') });
    mockState.anImpl = () => { const e = new Error('Your credit balance is too low to access the Anthropic API.'); e.status = 400; throw e; };
    await getClient().chat.completions.create(ask());
    const ev = mockState.events.find((e) => e.name === 'lp612.llm.fallback_provider');
    expect(ev.data.job).toBe('chat.intent');
    expect('correlationId' in ev.data).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe('loose ends', () => {
  test('the direct-OpenAI provider strips the internal marker too', async () => {
    const { getClient } = load({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' });
    await getClient().chat.completions.create({ model: 'gpt-4o', job: 'chat.intent', skipJobOverride: true, messages: [] });
    expect(mockState.oa).toHaveLength(1);
    expect('skipJobOverride' in mockState.oa[0]).toBe(false);
  });

  test('audio parts are refused by name on the direct lane, not sent to be refused by the API', () => {
    load();
    // eslint-disable-next-line global-require
    const { toNativeRequest } = require('../../bot/shared/services/anthropic-native-facade');
    expect(() => toNativeRequest({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } }] }],
    })).toThrow(/input_audio/);
  });
});
