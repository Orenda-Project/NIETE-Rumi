/**
 * bd-gr4fy.12 — the reflective question and the corpus it is built from are two jobs, not one.
 *
 * Both calls went out under one label, coaching.questionRouter (llm-router.service.js wrote it into its one
 * request), so one settings entry moved both. Measured offline on real lessons (7 Oct 2026) they want
 * different models: the question is right on Sonnet 5 (8/8 with the prompt's forward close; Haiku 0/7),
 * the corpus is most faithful on Haiku 4.5 (quotes found 66% vs DeepSeek 43%, no invented names) while
 * Sonnet writes past the limit. Neither can be moved without dragging the other.
 *
 * Pinned here: corpus extraction runs as coaching.reflectiveCorpus, the question stays
 * coaching.questionRouter, an override of either moves that step only, and with no override both keep
 * today's model. Executed for real: only the network (globalThis.fetch) and the settings table read are
 * replaced; the router, the llm-client seam and the service under test all run.
 */

const REAL_FETCH = globalThis.fetch;
const SCRUBBED = [
  'REDIS_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'PHONE_NUMBER_ID', 'E2E_CASSETTE',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_JOB_MODELS', 'ANTHROPIC_API_KEY',
];

// The settings table is read once, and holds nothing: overrides then come from LLM_JOB_MODELS alone.
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
}));

const CORPUS = {
  analysis: { subject_topic: 'colours', one_line_summary: 'A lesson on colours.', focus_area_en: 'wait time' },
  lesson_throughline_en: 'the teacher answers for the children',
  significant_moments: [
    { approx_time_phrase: 'early on', what_happened: "A child said 'blue' and the teacher moved on.", scope: 'individual', named_student: null, significance_reason_en: 'thinking cut short' },
    { approx_time_phrase: 'near the end', what_happened: "A child explained 'the sky is blue because of light'.", scope: 'individual', named_student: null, significance_reason_en: 'reasoning' },
  ],
  collective_moments: [{ approx_time_phrase: 'in the middle', what_happened: 'The class chorused the colour names.', significance_reason_en: 'drill' }],
  recurring_signals: [],
};
const QUESTION = {
  question: "Early on a child said 'blue' and you moved on, and near the end a child explained why the sky is blue. What changed in their thinking between those moments, and next time a child answers in one word, what is one small thing you would want to try?",
  question_en: 'same',
};

let sent; // every vendor completion: which model, and which prompt it carried
const saved = {};

beforeEach(() => {
  sent = [];
  for (const k of SCRUBBED) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  // config/supabase is mocked above; these only satisfy code that checks the variables exist.
  process.env.SUPABASE_URL = 'http://127.0.0.1:1/router-split-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-not-a-key';

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/chat\/completions/.test(url)) {
      const prompt = JSON.stringify((body && body.messages) || []);
      const step = /corpus of significant moments/.test(prompt) ? 'corpus' : 'question';
      sent.push({ step, model: body && body.model });
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: (body && body.model) || 'x',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(step === 'corpus' ? CORPUS : QUESTION) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      });
    }
    return json({ ok: true });
  };
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  for (const k of SCRUBBED) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

/** A fresh registry, with the REAL cost events (tests/__mocks__/pino.js makes logger.info observable). */
async function run(jobModels) {
  jest.resetModules();
  if (jobModels) process.env.LLM_JOB_MODELS = JSON.stringify(jobModels);
  const sl = require('../../bot/shared/utils/structured-logger');
  await require('../../bot/shared/config/model-settings').refresh();
  const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
  const { corpus } = await GPT5MiniService.extractReflectiveCorpus('Teacher: what colour is the sky? Child: blue.', 'en');
  const question = await GPT5MiniService._generateReflectiveQuestionV12(corpus, [], 1, 'en', '');
  const cost = sl.logger.info.mock.calls.map((c) => c[0]).filter((e) => e && e.event === 'api.cost.incurred');
  const byStep = (s) => sent.filter((x) => x.step === s);
  return { corpus, question, cost, corpusCalls: byStep('corpus'), questionCalls: byStep('question') };
}

describe('the reflective corpus and the reflective question are separate jobs (bd-gr4fy.12)', () => {
  test('each step is recorded under its own job, and with no override both keep today\'s model', async () => {
    const r = await run(null);
    expect(r.corpus).toEqual(CORPUS);
    expect(r.question).toBe(QUESTION.question);
    expect(r.corpusCalls.map((c) => c.model)).toEqual(['deepseek/deepseek-v3.2']);
    expect(r.questionCalls.map((c) => c.model)).toEqual(['deepseek/deepseek-v3.2']);
    expect(r.cost.map((e) => e.job)).toEqual(['coaching.reflectiveCorpus', 'coaching.questionRouter']);
  });

  test('an override of coaching.reflectiveCorpus moves the extraction and nothing else', async () => {
    const r = await run({ 'coaching.reflectiveCorpus': 'openai/gpt-4o' });
    expect(r.corpusCalls.map((c) => c.model)).toEqual(['openai/gpt-4o']);
    expect(r.questionCalls.map((c) => c.model)).toEqual(['deepseek/deepseek-v3.2']);
  });

  test('an override of coaching.questionRouter moves the question and nothing else', async () => {
    const r = await run({ 'coaching.questionRouter': 'openai/gpt-4o' });
    expect(r.questionCalls.map((c) => c.model)).toEqual(['openai/gpt-4o']);
    expect(r.corpusCalls.map((c) => c.model)).toEqual(['deepseek/deepseek-v3.2']);
  });

  test('the registry holds the new job like the router: same model, same fallback, its reply checked as its caller parses it', () => {
    jest.resetModules();
    const { JOBS, JSON_REPAIRED_BY_CALLER, fallbackForJob, modelFor } = require('../../bot/shared/config/model-registry');
    expect(JOBS['coaching.reflectiveCorpus']).toEqual(expect.objectContaining({
      env: null, default: 'deepseek/deepseek-v3.2', site: 'shared/services/coaching/reflective-questions/llm-router.service.js',
    }));
    expect(modelFor('coaching.reflectiveCorpus')).toBe('deepseek/deepseek-v3.2');
    expect(fallbackForJob('coaching.reflectiveCorpus')).toBe('openai/gpt-5.4');
    expect(JSON_REPAIRED_BY_CALLER['coaching.reflectiveCorpus']).toBe('whole');
  });
});
