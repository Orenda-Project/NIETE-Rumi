/**
 * bd-gr4fy.5.10 — a chat reply is shaped for WhatsApp, whichever model writes it.
 *
 * chat.respond moved to Sonnet 5 on 7 Oct 2026. On real traffic (Axiom, 7-8 Oct) its replies carried markdown that
 * WhatsApp does not render: `**ایک:**` arrives as a bold word wrapped in a stray asterisk. That happened in 87% of
 * English teacher replies, about half of student replies and 10% of Urdu teacher replies; gpt-4.1-mini wrote 1-7%.
 * English teacher replies also doubled in length (p50 31 -> 66 words). The only length rule the prompts gave was
 * "keep it brief", which each model reads its own way.
 *
 * Pinned here, on the real openai.service.getResponseWithFormat (only the network and the database client are
 * stubbed): every TEXT reply's system prompt states one WhatsApp shape (a length budget and no markdown), and a
 * reply that still comes back with **x** or a '# x' heading is handed over, and remembered, as WhatsApp's own *x*.
 * A model may ignore an instruction, so the second half is deterministic. VOICE replies are left alone: they are
 * spoken, and the TTS text path already has its own normaliser.
 */

const REAL_FETCH = globalThis.fetch;
const SCRUBBED = [
  'REDIS_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_ACCESS_TOKEN', 'PHONE_NUMBER_ID', 'E2E_CASSETTE',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_BASE_URL', 'LLM_PROVIDER', 'LLM_MODEL',
  'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_JOB_MODELS', 'ANTHROPIC_API_KEY',
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

let sent; // every completion request: its model and its system prompt
let replyText; // what the stubbed model answers
const saved = {};

beforeEach(() => {
  sent = [];
  replyText = 'ok';
  for (const k of SCRUBBED) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/chat\/completions/.test(url)) {
      const system = ((body && body.messages) || []).filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
      sent.push({ model: body && body.model, system });
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: (body && body.model) || 'x',
        choices: [{ index: 0, message: { role: 'assistant', content: replyText }, finish_reason: 'stop' }],
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

async function service() {
  jest.resetModules();
  await require('../../bot/shared/config/model-settings').refresh();
  return require('../../bot/shared/services/openai.service');
}

/** The shape every text reply's prompt must state: a length budget, and no markdown WhatsApp cannot show. */
function expectWhatsAppShape(system) {
  expect(system).toMatch(/WHATSAPP TEXT/);
  expect(system).toMatch(/about 50 words/);
  expect(system).toMatch(/no \*\*double asterisks\*\*/);
  expect(system).toMatch(/no # headings/);
}

const TEXT_CASES = [
  ['a teacher, in Urdu', 'ur', {}],
  ['a teacher, in English', 'en', {}],
  ['a student, in Urdu', 'ur', { persona: 'student', studentClass: 'Class 5' }],
  ['a student, in English', 'en', { persona: 'student', studentClass: 'Class 5' }],
];

describe('chat.respond: a text reply is shaped for WhatsApp (bd-gr4fy.5.10)', () => {
  test.each(TEXT_CASES)('the prompt for %s states the WhatsApp shape', async (_who, language, opts) => {
    const svc = await service();
    await svc.getResponseWithFormat('How can I get quiet children to answer?', 'user-1', 'text', language, 'Ayesha', null, opts);
    expect(sent).toHaveLength(1);
    expectWhatsAppShape(sent[0].system);
  });

  test.each(TEXT_CASES)('markdown emphasis in the reply to %s reaches WhatsApp as *bold*, and is remembered that way', async (_who, language, opts) => {
    replyText = '## Two ideas\n**ایک:** Think-pair-share.\n**Two:** use slates, and *praise* every try. 2 * 3 = 6';
    const svc = await service();
    const out = await svc.getResponseWithFormat('Two quick ideas?', 'user-2', 'text', language, null, null, opts);
    expect(out).toBe('*Two ideas*\n*ایک:* Think-pair-share.\n*Two:* use slates, and *praise* every try. 2 * 3 = 6');
    const history = svc.conversationHistory.get('user-2');
    expect(history[history.length - 1]).toEqual({ role: 'assistant', content: out });
  });

  test('a VOICE reply is left exactly as the model wrote it, and its prompt carries no text shape', async () => {
    replyText = '**ایک:** بات کریں۔';
    const svc = await service();
    const out = await svc.getResponseWithFormat('سوال', 'user-3', 'voice', 'ur', null, null, {});
    expect(out).toBe('**ایک:** بات کریں۔');
    expect(sent[0].system).not.toMatch(/WHATSAPP TEXT/);
  });

  test('a reply with no markdown is handed over unchanged', async () => {
    replyText = 'Give them *thinking time*, then ask a partner first. Try it tomorrow.';
    const svc = await service();
    const out = await svc.getResponseWithFormat('Idea?', 'user-4', 'text', 'en', null, null, {});
    expect(out).toBe('Give them *thinking time*, then ask a partner first. Try it tomorrow.');
  });
});
