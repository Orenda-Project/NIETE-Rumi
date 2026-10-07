/**
 * bd-gr4fy.13 — the reflective router's ladder with a per-job override in force.
 *
 * callReflective climbs its own ladder (the step's model, the same model once more, then its fallback), and every
 * rung goes through the wrapped client, where the per-job override applies. So an override was tried on all three
 * rungs: an override that fails (a Claude outage, once coaching.reflectiveCorpus moves to Haiku) made one corpus
 * extraction six calls at the 150 s timeout, inside the analysis job, holding up the coaching report. And the router
 * named its own model as `model_used` even when the override answered, so its logs named DeepSeek for Claude's text.
 *
 * Pinned here: the override is tried once, on the first rung (the seam's own fallback to the step's model still
 * applies); the retries go straight to the step's own models under its own label; `model_used` is the model that
 * answered; and each step climbs ITS OWN registry entry. Executed for real: only globalThis.fetch and the
 * settings-table read are replaced.
 */

const REAL_FETCH = globalThis.fetch;
const SCRUBBED = [
  'REDIS_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'PHONE_NUMBER_ID', 'E2E_CASSETTE',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_JOB_MODELS', 'ANTHROPIC_API_KEY', 'LLM_FALLBACK_OFF',
];

jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
}));

const CORPUS = { analysis: { subject_topic: 'x' }, lesson_throughline_en: 'y', significant_moments: [], collective_moments: [], recurring_signals: [] };
const QUESTION = { question: 'Early on a child said one word and you moved on. What changed in their thinking, and next time, what is one small thing you would want to try?', question_en: 'same' };

let sent; // [{ step, model }] for every vendor completion, in order
let failing; // models whose completions fail with a 500
const saved = {};

beforeEach(() => {
  sent = [];
  failing = new Set();
  for (const k of SCRUBBED) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  process.env.SUPABASE_URL = 'http://127.0.0.1:1/router-ladder-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-not-a-key';
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    if (/\/chat\/completions/.test(url)) {
      const step = /corpus of significant moments/.test(JSON.stringify((body && body.messages) || [])) ? 'corpus' : 'question';
      sent.push({ step, model: body && body.model });
      if (failing.has(body && body.model)) return json({ error: { message: 'upstream unavailable', type: 'server_error' } }, 500);
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

/** Fresh registry; `tweak(registry)` may change it before the service loads. */
async function load({ jobModels = null, tweak = null } = {}) {
  jest.resetModules();
  if (jobModels) process.env.LLM_JOB_MODELS = JSON.stringify(jobModels);
  const registry = require('../../bot/shared/config/model-registry');
  if (tweak) tweak(registry);
  await require('../../bot/shared/config/model-settings').refresh();
  return require('../../bot/shared/services/gpt5-mini.service');
}
const models = (step) => sent.filter((x) => x.step === step).map((x) => x.model);

describe('the reflective router ladder with a per-job override (bd-gr4fy.13)', () => {
  test('a failing override is tried ONCE: override, the step\'s model behind it, its retry, its fallback', async () => {
    const svc = await load({ jobModels: { 'coaching.reflectiveCorpus': 'openai/gpt-4o' } });
    failing = new Set(['openai/gpt-4o', 'deepseek/deepseek-v3.2']);
    const { corpus } = await svc.extractReflectiveCorpus('Teacher: what colour is the sky? Child: blue.', 'en');
    expect(corpus).toEqual(CORPUS);
    expect(models('corpus')).toEqual(['openai/gpt-4o', 'deepseek/deepseek-v3.2', 'deepseek/deepseek-v3.2', 'openai/gpt-5.4']);
  });

  test('with no override the ladder is unchanged: the step\'s model twice, then its fallback', async () => {
    const svc = await load();
    failing = new Set(['deepseek/deepseek-v3.2']);
    await svc.extractReflectiveCorpus('Teacher: what colour is the sky? Child: blue.', 'en');
    expect(models('corpus')).toEqual(['deepseek/deepseek-v3.2', 'deepseek/deepseek-v3.2', 'openai/gpt-5.4']);
  });

  test('model_used names the model that answered when the override answered', async () => {
    const svc = await load({ jobModels: { 'coaching.reflectiveCorpus': 'openai/gpt-4o' } });
    const { model_used } = await svc.extractReflectiveCorpus('Teacher: what colour is the sky? Child: blue.', 'en');
    expect(models('corpus')).toEqual(['openai/gpt-4o']);
    expect(model_used).toBe('openai/gpt-4o');
  });

  test('each step climbs its OWN registry entry (the corpus entry moves the corpus ladder only)', async () => {
    const svc = await load({ tweak: (reg) => {
      reg.JOBS['coaching.reflectiveCorpus'].default = 'test/corpus-primary';
      reg.FALLBACK['coaching.reflectiveCorpus'] = 'test/corpus-retry';
    } });
    failing = new Set(['test/corpus-primary']);
    const { corpus } = await svc.extractReflectiveCorpus('Teacher: what colour is the sky? Child: blue.', 'en');
    await svc._generateReflectiveQuestionV12(corpus, [], 1, 'en', '');
    expect(models('corpus')).toEqual(['test/corpus-primary', 'test/corpus-primary', 'test/corpus-retry']);
    expect(models('question')).toEqual(['deepseek/deepseek-v3.2']);
  });

  test('and the question entry moves the question ladder only', async () => {
    const svc = await load({ tweak: (reg) => {
      reg.JOBS['coaching.questionRouter'].default = 'test/question-primary';
      reg.FALLBACK['coaching.questionRouter'] = 'test/question-retry';
    } });
    failing = new Set(['test/question-primary']);
    const { corpus } = await svc.extractReflectiveCorpus('Teacher: what colour is the sky? Child: blue.', 'en');
    await svc._generateReflectiveQuestionV12(corpus, [], 1, 'en', '');
    expect(models('corpus')).toEqual(['deepseek/deepseek-v3.2']);
    expect(models('question')).toEqual(['test/question-primary', 'test/question-primary', 'test/question-retry']);
  });
});
