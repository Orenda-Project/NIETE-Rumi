/**
 * bd-gr4fy.5.15 — chat.intent: a cut-off reply whose label is complete is the answer.
 *
 * chat.intent moved to Haiku 4.5 on the direct lane on 7 Oct 2026. Its call site asks for one word under a
 * 10-token limit (20 on Claude, after the tokenizer allowance). On bare replies — "Yes" 40 times, "In English",
 * "OK", "Analyse it" — Haiku writes more than the label, reaches the limit, and the client treats the cut-off as
 * unusable: every one of them was asked again of gpt-4.1-mini. Production, 7 Oct 10:35Z to 9 Oct 07:15Z: 116
 * such calls, each Claude attempt at exactly 20 tokens out, about 0.8 s lost before the second answer; gpt-4.1-mini
 * then said general 114 times and lesson_plan twice (intent-cutoffs-20261009T0715Z.txt, INTERNAL).
 *
 * Raising the limit alone would hand the explanation to a parser that matches the WHOLE reply against one word:
 * "lesson_plan\n\nThe teacher names..." is not 'lesson_plan', so a lesson-plan request would drop into general chat.
 *
 * Pinned here, on the real openai.service.detectIntent and the real llm-client (only the network and the database
 * client are stubbed):
 *   - a cut-off reply that STARTS with a complete label is handed over and read by that label; the old model is
 *     not asked again;
 *   - a cut-off reply that starts with anything else is still asked again of the old model, exactly as before;
 *   - lp_ref counts only right after the label, never inside an explanation;
 *   - a one-word reply reads exactly as before, and another job's cut-off still falls back.
 */

const REAL_FETCH = globalThis.fetch;
const SCRUBBED = [
  'REDIS_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'PHONE_NUMBER_ID', 'E2E_CASSETTE',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_JOB_MODELS', 'ANTHROPIC_API_KEY', 'LLM_FALLBACK_OFF',
];

// Every database read answers "nothing": no settings rows, no stored conversation.
jest.mock('../../bot/shared/config/supabase', () => {
  const empty = { data: [], error: null };
  const chain = new Proxy(function chainable() {}, {
    get: (_t, prop) => (prop === 'then' ? (resolve) => resolve(empty) : () => chain),
    apply: () => chain,
  });
  return { from: () => chain, rpc: async () => empty };
});

let native; // every request that reached the Anthropic messages endpoint
let openrouter; // every request that reached the old model's endpoint
let claudeText; // what Claude answers
let claudeStop; // and why it stopped: 'end_turn', or 'max_tokens' for a cut-off
let oldModelText; // what the old model answers when it is asked again
const saved = {};

beforeEach(() => {
  native = [];
  openrouter = [];
  claudeText = 'general';
  claudeStop = 'end_turn';
  oldModelText = 'general';
  for (const k of SCRUBBED) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic';
  process.env.LLM_JOB_MODELS = JSON.stringify({
    'chat.intent': 'anthropic-direct/claude-haiku-4-5',
    'chat.respond': 'anthropic-direct/claude-sonnet-5',
  });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/v1\/messages/.test(url)) {
      native.push(body);
      return json({
        id: 'msg_test', type: 'message', role: 'assistant', model: (body && body.model) || 'claude-haiku-4-5',
        content: [{ type: 'text', text: claudeText }],
        stop_reason: claudeStop, stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: claudeStop === 'max_tokens' ? 20 : 2 },
      });
    }
    if (/\/chat\/completions/.test(url)) {
      openrouter.push(body);
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: (body && body.model) || 'x',
        choices: [{ index: 0, message: { role: 'assistant', content: oldModelText }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 800, completion_tokens: 2, total_tokens: 802 },
      });
    }
    return json({ ok: true });
  };
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  for (const k of SCRUBBED) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

async function service() {
  jest.resetModules();
  await require('../../bot/shared/config/model-settings').refresh();
  return require('../../bot/shared/services/openai.service');
}

/** Claude stops at the output limit with this text. */
function cutOff(text) { claudeText = text; claudeStop = 'max_tokens'; }

describe('chat.intent on Claude: a cut-off reply whose label is complete is the answer (bd-gr4fy.5.15)', () => {
  test('a bare "Yes" answered "general" plus the start of an explanation is general, and the old model is not asked', async () => {
    cutOff('general\n\nThe message "Yes" is a short affirmation with no');
    const svc = await service();
    const intent = await svc.detectIntent('Yes');
    expect(native).toHaveLength(1);
    expect(openrouter).toHaveLength(0);
    expect(intent).toEqual({ type: 'general', message: 'Yes', lp_reference: false });
  });

  test('a cut-off reply that starts with lesson_plan is a lesson-plan request', async () => {
    cutOff('lesson_plan\n\nThe teacher names a class and a chapter, which');
    oldModelText = 'general'; // were it asked again, the old model would say otherwise; it must not be asked
    const svc = await service();
    const intent = await svc.detectIntent('Class 3 chapter 3');
    expect(openrouter).toHaveLength(0);
    expect(intent).toEqual({ type: 'lesson_plan', message: 'Class 3 chapter 3', lp_reference: false });
  });

  test('"general lp_ref" at the start keeps its lp_ref when the rest is cut off', async () => {
    cutOff('general lp_ref\n\nShe is talking about the lesson she was sent');
    const svc = await service();
    const intent = await svc.detectIntent('is lesson mein activity kaisi karun');
    expect(openrouter).toHaveLength(0);
    expect(intent.type).toBe('general');
    expect(intent.lp_reference).toBe(true);
  });

  test('a label in bold or quotes is still the label', async () => {
    cutOff('**video**\n\nShe asks to see a video on fractions, so');
    const svc = await service();
    const intent = await svc.detectIntent('fractions video dikhao');
    expect(openrouter).toHaveLength(0);
    expect(intent.type).toBe('video');
  });

  // Production read lp_ref anywhere in the reply; reading it only after a space would drop it from compact replies
  // that put a comma, a colon, a bracket or markdown between the word and the marker.
  test.each([
    ['general, lp_ref'],
    ['general: lp_ref'],
    ['general (lp_ref)'],
    ['general - lp_ref'],
    ['**general** lp_ref'],
    ['general "lp_ref"'],
  ])('lp_ref after the label behind punctuation still counts: %j', async (reply) => {
    claudeText = reply;
    const svc = await service();
    const intent = await svc.detectIntent('is lesson ki activity kaise karun');
    expect(intent).toEqual({ type: 'general', message: 'is lesson ki activity kaise karun', lp_reference: true });
  });

  test('a cut-off reply with lp_ref behind a comma keeps it', async () => {
    cutOff('general, lp_ref\n\nShe is asking about the lesson she was sent');
    const svc = await service();
    const intent = await svc.detectIntent('yeh wali activity mushkil hai');
    expect(openrouter).toHaveLength(0);
    expect(intent.lp_reference).toBe(true);
  });

  test('lp_ref inside an explanation is not an lp_ref', async () => {
    claudeText = 'general\nNot an lp_ref: she asks something new.';
    const svc = await service();
    const intent = await svc.detectIntent('How do I start a class on time?');
    expect(intent).toEqual({ type: 'general', message: 'How do I start a class on time?', lp_reference: false });
  });
});

describe('everything else is read exactly as before', () => {
  test('a cut-off reply that does not start with a label is still asked again of the old model, whose answer decides', async () => {
    cutOff('The message "Class 3 chapter 3" names a class and a chapter but');
    oldModelText = 'lesson_plan';
    const svc = await service();
    const intent = await svc.detectIntent('Class 3 chapter 3');
    expect(native).toHaveLength(1);
    expect(openrouter).toHaveLength(1);
    expect(intent.type).toBe('lesson_plan');
  });

  test('a word that only begins like a label is not that label', async () => {
    cutOff('generally a message like this is a reply to the last');
    oldModelText = 'general';
    const svc = await service();
    await svc.detectIntent('Yes');
    expect(openrouter).toHaveLength(1);
  });

  test.each([
    ['lesson_plan', 'lesson_plan', false],
    ['lesson plan', 'lesson_plan', false],
    ['presentation', 'presentation', false],
    ['video', 'video', false],
    ['general', 'general', false],
    ['general lp_ref', 'general', true],
    ['lesson_plan lp_ref', 'lesson_plan', false],
    ['lp_ref', 'general', true],
    ['', 'general', false],
  ])('a complete one-word reply %j reads as before: %s, lp_ref %s', async (reply, type, lpRef) => {
    claudeText = reply;
    const svc = await service();
    const intent = await svc.detectIntent('anything');
    expect(intent.type).toBe(type);
    expect(intent.lp_reference).toBe(lpRef);
  });

  test("another job's cut-off still goes back to its own model, even when it starts like a label", async () => {
    cutOff('general advice for a noisy class is to');
    oldModelText = 'Give them a signal they know, then wait for quiet.';
    const svc = await service();
    const out = await svc.getResponseWithFormat('My class is noisy', 'teacher-1', 'text', 'en', null, null, {});
    expect(native).toHaveLength(1);
    expect(openrouter).toHaveLength(1);
    expect(out).toBe('Give them a signal they know, then wait for quiet.');
  });
});
