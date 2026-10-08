/**
 * bd-gr4fy.5.12 — an Urdu reflective question and commitment card never put the teacher in a gendered verb.
 *
 * Urdu verbs carry gender: "کیا آپ ... آزمانا چاہیں گے؟" is masculine, "چاہیں گی" feminine, "آپ چاہتے ہیں"
 * masculine. NIETE does not store a teacher's gender, and both prompts already say "never require knowing it".
 * Measured on production (2026-10-08, the gendered-address detector pinned below):
 * - Urdu reflective questions: 152/164 gendered on Sonnet 5 (masculine and feminine mixed), 166/230 on DeepSeek
 *   V3.2 (almost all feminine).
 * - Urdu commitment cards: 44/166 on Sonnet 5, 45/296 before, almost all "آپ چاہتے ہیں".
 * The question's own template closes with an English "what would you want to try?", which Urdu can only say
 * with a gendered verb. The card's Urdu rule names only the future.
 *
 * Pinned here, on the real services with only the network stubbed: the Urdu question prompt offers a
 * noun-agreeing close and concrete examples; a question or card that still addresses her in a gendered verb is
 * rewritten once, with the reason; children's verbs, quotes and English are never flagged.
 */

const REAL_FETCH = globalThis.fetch;
const SCRUBBED = [
  'REDIS_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'PHONE_NUMBER_ID', 'E2E_CASSETTE',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_JOB_MODELS', 'ANTHROPIC_API_KEY',
];

jest.mock('../../bot/shared/config/supabase', () => {
  const empty = { data: [], error: null };
  const chain = new Proxy(function chainable() {}, {
    get: (_t, prop) => (prop === 'then' ? (resolve) => resolve(empty) : () => chain),
    apply: () => chain,
  });
  return { from: () => chain, rpc: async () => empty };
});

let answers; // queued model answers, one per completion request
let sent; // every completion request's prompt text
const saved = {};

beforeEach(() => {
  answers = [];
  sent = [];
  for (const k of SCRUBBED) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/chat\/completions/.test(url)) {
      sent.push(((body && body.messages) || []).map((m) => String(m.content)).join('\n'));
      const content = answers.length > 1 ? answers.shift() : answers[0];
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: (body && body.model) || 'x',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
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

async function services() {
  jest.resetModules();
  await require('../../bot/shared/config/model-settings').refresh();
  return {
    GPT5MiniService: require('../../bot/shared/services/gpt5-mini.service'),
    cards: require('../../bot/shared/services/coaching/coaching-card/commitment-card.service'),
    guardrails: require('../../bot/shared/services/coaching/reflective-questions/guardrails'),
  };
}

const CORPUS = {
  lesson_throughline_en: 'children reason for themselves early, then the teacher supplies the rule',
  significant_moments: [
    { approx_time_phrase: 'قریب پانچ منٹ پر', what_happened: "ایک بچے نے خود کہا 'تین تھریز آر نائن'۔", scope: 'individual', named_student: null },
    { approx_time_phrase: 'قریب پندرہ منٹ پر', what_happened: 'ٹیچر نے قاعدہ خود بتا دیا۔', scope: 'collective', named_student: null },
  ],
  collective_moments: [],
};
const q = (question) => JSON.stringify({ question, question_en: 'x' });
const GENDERED_Q = 'قریب پانچ منٹ پر ایک بچے نے خود جواب ڈھونڈا، اور قریب پندرہ منٹ پر قاعدہ بتا دیا گیا۔ اگلی بار جب ایسا لمحہ آئے، تو آپ کیا آزمانا چاہیں گی؟';
const NEUTRAL_Q = 'قریب پانچ منٹ پر ایک بچے نے خود جواب ڈھونڈا، اور قریب پندرہ منٹ پر قاعدہ بتا دیا گیا۔ اگلی بار جب ایسا لمحہ آئے، تو کون سا ایک چھوٹا قدم آزمانا مفید رہے گا؟';

describe('Urdu reflective question: no gendered verb for the teacher (bd-gr4fy.5.12)', () => {
  test('the prompt closes on a noun-agreeing Urdu invitation and names the forms to avoid', async () => {
    const { GPT5MiniService } = await services();
    answers = [q(NEUTRAL_Q)];
    await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [], 1, 'ur', 'Ayesha');
    expect(sent[0]).toContain('کون سا ایک چھوٹا قدم آزمانا مفید رہے گا');
    expect(sent[0]).toMatch(/چاہیں گے/);
    expect(sent[0]).toMatch(/چاہتے/);
    expect(sent[0]).not.toMatch(/what is the one small thing you'd want to try/);
  });

  test('a question that still says «آپ ... چاہیں گی» is rewritten once, with the reason, and the neutral one is kept', async () => {
    const { GPT5MiniService } = await services();
    answers = [q(GENDERED_Q), q(NEUTRAL_Q)];
    const out = await GPT5MiniService._generateReflectiveQuestionV12(CORPUS, [], 1, 'ur', 'Ayesha');
    expect(out).toBe(NEUTRAL_Q);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/gendered_address/);
  });

  test('the detector reads who the verb is about: hers is flagged; the children\'s, a quote and English are not', async () => {
    const { guardrails } = await services();
    const { genderedAddress } = guardrails;
    expect(genderedAddress('کیا آپ کل یہ آزمانا چاہیں گے؟')).not.toHaveLength(0);
    expect(genderedAddress('اس وقت کیا آزمانا چاہیں گی؟')).not.toHaveLength(0); // آپ dropped, still hers
    expect(genderedAddress('آپ کیا سوچتی ہیں؟')).not.toHaveLength(0);
    expect(genderedAddress('آپ چاہتے ہیں کہ ہر بچہ بولے۔')).not.toHaveLength(0);
    expect(genderedAddress('اگر آپ ایسا کریں تو بچے کیا سیکھیں گے؟')).toHaveLength(0);
    expect(genderedAddress('آپ کے خیال میں بچے کیوں ہنس رہے تھے؟')).toHaveLength(0);
    expect(genderedAddress("بچے نے کہا 'آپ کیا کریں گے'۔")).toHaveLength(0);
    expect(genderedAddress('ہم چاہتے ہیں کہ ہر بچہ بولے۔')).toHaveLength(0);
    expect(genderedAddress('کون سا قدم آزمانا مفید رہے گا؟')).toHaveLength(0);
    const english = guardrails.validateQuestion("What is the one small thing you'd want to try?", {}, '', { language: 'English', script: 'Latin' });
    expect(english).not.toContain('gendered_address');
  });
});

describe('Urdu commitment card: no gendered verb for the teacher (bd-gr4fy.5.12)', () => {
  const ANALYSIS = { framework: 'fico', strengths: [{ title: 'warm tone' }], growth_opportunities: [{ area: 'wait time', observation: 'o', strategies: ['s'] }] };
  const STATE = { questions: [{ question_number: 1, question: 'q', answer: 'میں چاہتی ہوں کہ خاموش بچوں کو زیادہ وقت ملے۔' }] };
  const card = (commitment) => JSON.stringify({ commitment, action: 'اگلی کلاس میں سوال کے بعد پانچ تک گنیں، پھر جواب لیں۔', lesson_label: 'ریاضی · کسور', highlights: ['پانچ تک'] });

  test('the Urdu rule names the present forms too, not only the future', async () => {
    const { cards } = await services();
    const prompt = cards.buildPrompt('ur', ANALYSIS, STATE.questions[0]);
    expect(prompt).toMatch(/چاہتے/);
    expect(prompt).toMatch(/چاہتی/);
  });

  test('a card that says «آپ چاہتے ہیں» is regenerated once, with the reason, and the neutral card is kept', async () => {
    const { cards } = await services();
    answers = [card('آپ چاہتے ہیں کہ ہر خاموش بچہ بولے۔'), card('آپ کی خواہش ہے کہ ہر خاموش بچہ بولے۔')];
    const out = await cards.generateCommitmentCard(ANALYSIS, STATE, 'ur', { teacherName: 'Ayesha' });
    expect(out.commitment).toBe('آپ کی خواہش ہے کہ ہر خاموش بچہ بولے۔');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/gendered/i);
  });

  test('a neutral card is made with one call, as today', async () => {
    const { cards } = await services();
    answers = [card('آپ کی خواہش ہے کہ ہر خاموش بچہ بولے۔')];
    const out = await cards.generateCommitmentCard(ANALYSIS, STATE, 'ur', { teacherName: 'Ayesha' });
    expect(out.commitment).toBe('آپ کی خواہش ہے کہ ہر خاموش بچہ بولے۔');
    expect(sent).toHaveLength(1);
  });
});
