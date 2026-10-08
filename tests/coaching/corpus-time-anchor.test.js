/**
 * bd-gr4fy.5.13 — a corpus moment's time anchor is written in the teacher's own script, and spelled right.
 *
 * Since coaching.reflectiveCorpus moved to Haiku 4.5 (2026-10-08), every misspelt «کریب» in production corpora
 * (45 of 45) sat in approx_time_phrase ("کریب 5-12 منٹ پر"), and the reflective question copies it to the teacher
 * (7 of 68 questions). No transcript contains it. The cause is the prompt: its example anchors are Roman Urdu
 * ('kareeb 10 minute par') for every language, and Haiku transliterates 'kareeb' sound by sound.
 *
 * Pinned here: the prompt gives each language its anchors in that language's own script and words, and the
 * extraction itself, on the real service with only the network stubbed, hands back «قریب» even when a model
 * still writes «کریب». Nothing else in the corpus is touched.
 */

const REAL_FETCH = globalThis.fetch;
const SCRUBBED = [
  'REDIS_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'PHONE_NUMBER_ID', 'E2E_CASSETTE',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_JOB_MODELS', 'ANTHROPIC_API_KEY',
];

// Every database read answers "nothing": no settings rows.
jest.mock('../../bot/shared/config/supabase', () => {
  const empty = { data: [], error: null };
  const chain = new Proxy(function chainable() {}, {
    get: (_t, prop) => (prop === 'then' ? (resolve) => resolve(empty) : () => chain),
    apply: () => chain,
  });
  return { from: () => chain, rpc: async () => empty };
});

let answer; // the JSON string the stubbed model returns
const saved = {};

beforeEach(() => {
  for (const k of SCRUBBED) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  globalThis.fetch = async (input) => {
    const url = String(input && input.url ? input.url : input);
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/chat\/completions/.test(url)) {
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: 'x',
        choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
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

const prompt = (code) => {
  const { resolveProfile } = require('../../bot/shared/services/coaching/reflective-questions/language-profiles');
  const { buildCorpusPrompt } = require('../../bot/shared/services/coaching/reflective-questions/corpus-prompt');
  return buildCorpusPrompt(resolveProfile(code));
};

describe('the corpus prompt anchors time in the language it asks for (bd-gr4fy.5.13)', () => {
  test('Urdu: the example anchors are Nastaliq, with قریب, and no Roman Urdu is offered to copy', () => {
    const p = prompt('ur');
    expect(p).toMatch(/قریب [^"'<>]*منٹ پر/);
    expect(p).not.toMatch(/kareeb|shuru mein|aakhir mein/);
  });

  test('Kiswahili and English get anchors in their own words', () => {
    expect(prompt('sw')).toMatch(/karibu dakika/);
    expect(prompt('sw')).not.toMatch(/kareeb/);
    expect(prompt('en')).toMatch(/around minute/);
    expect(prompt('en')).not.toMatch(/kareeb/);
  });
});

describe('extractReflectiveCorpus spells the Urdu time anchor right, whatever the model wrote (bd-gr4fy.5.13)', () => {
  const corpusWith = (phrase1, phrase2, quote) => JSON.stringify({
    analysis: { subject_topic: 'Fractions', one_line_summary: 'x', focus_area_en: 'y' },
    lesson_throughline_en: 'z',
    significant_moments: [
      { approx_time_phrase: phrase1, what_happened: `ٹیچر نے پوچھا ${quote}`, scope: 'individual', named_student: null, significance_reason_en: 'r' },
    ],
    collective_moments: [{ approx_time_phrase: phrase2, what_happened: 'پوری کلاس خاموش رہی۔', significance_reason_en: 'r' }],
    recurring_signals: [{ signal: 's', what_it_likely_meant_en: 'm' }],
  });

  async function extract(code) {
    jest.resetModules();
    await require('../../bot/shared/config/model-settings').refresh();
    const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
    return GPT5MiniService.extractReflectiveCorpus('LESSON TRANSCRIPT TEXT', code);
  }

  test('«کریب» in a moment\'s anchor comes back as «قریب»; every other field is untouched', async () => {
    answer = corpusWith('کریب 5-12 منٹ پر', 'شروع میں، کریب 1 منٹ پر', "'کریب آؤ'");
    const { corpus } = await extract('ur');
    expect(corpus.significant_moments[0].approx_time_phrase).toBe('قریب 5-12 منٹ پر');
    expect(corpus.collective_moments[0].approx_time_phrase).toBe('شروع میں، قریب 1 منٹ پر');
    // A quote is evidence: what was said stays exactly as it was transcribed.
    expect(corpus.significant_moments[0].what_happened).toBe("ٹیچر نے پوچھا 'کریب آؤ'");
    expect(corpus.analysis.subject_topic).toBe('Fractions');
  });

  test('a Kiswahili corpus is handed back exactly as the model wrote it', async () => {
    answer = corpusWith('karibu dakika 10', 'mwanzoni', "'Kariba'");
    const { corpus } = await extract('sw');
    expect(corpus).toEqual(JSON.parse(answer));
  });
});
