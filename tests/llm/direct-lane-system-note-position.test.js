/**
 * bd-gr4fy.5.11 — on the direct Anthropic lane, a system note placed mid-conversation keeps its place.
 *
 * openai.service puts a one-line "REPLY LANGUAGE" note right before a child's message, and a teacher's lesson
 * context (with its own REPLY LANGUAGE line, bd-eb1ec) right before hers, because a language rule at the top of
 * a long chat loses to the language of the earlier replies. The Messages API has no mid-conversation system
 * role, and anthropic-native-facade's toNativeRequest folded EVERY system message into the top-level system,
 * so on the direct lane those notes sat at the top again. After chat.respond moved to Sonnet 5 on that lane
 * (2026-10-07 17:50Z), the bot's own language check flagged 15.0-15.2% of student replies, against 0.9-2.4% on
 * gpt-4.1-mini; teacher replies, whose rule is at the top on both lanes, moved 2.8% -> 4.8%.
 *
 * Pinned: a non-leading system message is folded into the NEXT user turn as a leading, marked instruction;
 * leading system messages, a trailing one, and one followed by an assistant turn go to the top-level system as
 * before; a request with no mid-conversation system message is byte-identical to before.
 *
 * The chat path is executed for real: only the network (globalThis.fetch) and the supabase client are stubbed.
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
let openrouter; // every request that reached OpenRouter
const saved = {};

beforeEach(() => {
  native = [];
  openrouter = [];
  for (const k of SCRUBBED) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OPENAI_API_KEY = 'test-openai';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic';
  process.env.LLM_JOB_MODELS = JSON.stringify({ 'chat.respond': 'anthropic-direct/claude-sonnet-5' });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input && input.url ? input.url : input);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (_) { body = init.body; }
    const json = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/v1\/messages/.test(url)) {
      native.push(body);
      return json({
        id: 'msg_test', type: 'message', role: 'assistant', model: (body && body.model) || 'claude-sonnet-5',
        content: [{ type: 'text', text: 'ٹھیک ہے، ایک چھوٹا سوال کرتے ہیں۔' }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 21, output_tokens: 9 },
      });
    }
    if (/\/chat\/completions/.test(url)) {
      openrouter.push(body);
      return json({
        id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: (body && body.model) || 'x',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
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

async function chatService() {
  jest.resetModules();
  await require('../../bot/shared/config/model-settings').refresh();
  return require('../../bot/shared/services/openai.service');
}

const textOf = (block) => (typeof block === 'string' ? block : (block && block.text) || '');
const systemText = (sys) => (Array.isArray(sys) ? sys.map(textOf).join('\n') : String(sys || ''));

const EARLIER = [
  { role: 'user', content: 'quiz kaise bhejte hain' },
  { role: 'assistant', content: 'Quiz ke liye /quiz bhejein.' },
];

describe('the chat path on the direct lane: a mid-conversation note stays next to the message it governs (bd-gr4fy.5.11)', () => {
  test("a child's REPLY LANGUAGE note opens the last user turn, right before the child's own message", async () => {
    const svc = await chatService();
    svc.conversationHistory.set('child-1', EARLIER.map((m) => ({ ...m })));
    await svc.getResponseWithFormat('mujhe fractions samjhao', 'child-1', 'text', 'ur', null, null,
      { persona: 'student', studentClass: 'Class 5' });

    expect(openrouter).toHaveLength(0);
    expect(native).toHaveLength(1);
    const req = native[0];
    const last = req.messages[req.messages.length - 1];
    expect(last.role).toBe('user');
    expect(Array.isArray(last.content)).toBe(true);
    expect(textOf(last.content[0])).toMatch(/^<instruction>\nREPLY LANGUAGE: Urdu/);
    expect(textOf(last.content[last.content.length - 1])).toBe('mujhe fractions samjhao');
    expect(systemText(req.system)).not.toMatch(/REPLY LANGUAGE: Urdu/);
    // The earlier turns are untouched.
    expect(req.messages.slice(0, -1)).toEqual(EARLIER);
  });

  // The sandbox version of this file also checks a teacher's lesson-context block here. That block is a
  // mid-conversation system message only once bd-wpupy lands (sandbox); on this branch the lesson context
  // still rides the system prompt, so there is no mid-array note for a teacher to keep in place. The case
  // travels with bd-wpupy's promotion.
});

describe('toNativeRequest: everything without a mid-conversation system message is translated exactly as before', () => {
  const facade = () => require('../../bot/shared/services/anthropic-native-facade');

  test('leading system messages become the top-level system; one string stays one string', () => {
    const { toNativeRequest } = facade();
    expect(toNativeRequest({ model: 'claude-sonnet-5', max_tokens: 10, messages: [
      { role: 'system', content: 'S1' }, { role: 'user', content: 'hi' },
    ] })).toEqual({ model: 'claude-sonnet-5', max_tokens: 10, system: 'S1', messages: [{ role: 'user', content: 'hi' }] });
    expect(toNativeRequest({ model: 'claude-sonnet-5', max_tokens: 10, messages: [
      { role: 'system', content: 'S1' }, { role: 'system', content: 'S2' }, { role: 'user', content: 'hi' },
    ] }).system).toEqual([{ type: 'text', text: 'S1' }, { type: 'text', text: 'S2' }]);
  });

  test('a cached block system prefix and the JSON instruction are passed through byte for byte', () => {
    const { toNativeRequest } = facade();
    const cached = [{ type: 'text', text: 'BIG STABLE PROMPT', cache_control: { type: 'ephemeral' } }];
    const out = toNativeRequest({ model: 'claude-sonnet-5', max_tokens: 10, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: cached }, { role: 'user', content: 'go' }] });
    expect(out.system[0]).toEqual(cached[0]);
    expect(out.system).toHaveLength(2);
    expect(out.messages).toEqual([{ role: 'user', content: 'go' }]);
  });

  test('a system message at the very end, or before an assistant turn, goes to the top-level system as before', () => {
    const { toNativeRequest } = facade();
    const trailing = toNativeRequest({ model: 'claude-sonnet-5', max_tokens: 10, messages: [
      { role: 'system', content: 'S1' }, { role: 'user', content: 'hi' }, { role: 'system', content: 'LATE' },
    ] });
    expect(trailing.system).toEqual([{ type: 'text', text: 'S1' }, { type: 'text', text: 'LATE' }]);
    expect(trailing.messages).toEqual([{ role: 'user', content: 'hi' }]);
    const beforeAssistant = toNativeRequest({ model: 'claude-sonnet-5', max_tokens: 10, messages: [
      { role: 'system', content: 'S1' }, { role: 'user', content: 'hi' }, { role: 'system', content: 'MID' },
      { role: 'assistant', content: 'yo' }, { role: 'user', content: 'again' },
    ] });
    expect(systemText(beforeAssistant.system)).toContain('MID');
    expect(beforeAssistant.messages).toEqual([
      { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'again' },
    ]);
  });

  test("a mid-conversation note in front of a user turn that carries an image keeps the image", () => {
    const { toNativeRequest } = facade();
    const out = toNativeRequest({ model: 'claude-sonnet-5', max_tokens: 10, messages: [
      { role: 'system', content: 'S1' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' },
      { role: 'system', content: 'NOTE' },
      { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'https://x.test/a.png' } }] },
    ] });
    const last = out.messages[out.messages.length - 1];
    expect(textOf(last.content[0])).toBe('<instruction>\nNOTE\n</instruction>');
    expect(last.content.slice(1)).toEqual([{ type: 'text', text: 'look' }, { type: 'image', source: { type: 'url', url: 'https://x.test/a.png' } }]);
    expect(out.system).toBe('S1');
  });
});
