'use strict';
/**
 * The quiz's Claude calls (the blind solve and the summary truth check, both on
 * `anthropic/claude-sonnet-5` by default) are paid from the prepaid Anthropic
 * key instead of the OpenRouter balance — same model, same list price, the
 * mandatory credit-exhaustion fallback to OpenRouter kept.
 *
 * Drives the REAL transcript-quiz-llm → llm-client → @anthropic-ai/sdk / openai
 * chain with only `global.fetch` doubled (the network boundary).
 */
const mockLogEvent = jest.fn();
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a), getCurrentCorrelationId: () => undefined,
}));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: jest.fn() }), { virtual: true });

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CREDIT_400 = {
  type: 'error',
  error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' },
};
const nativeReply = (text) => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
  content: [{ type: 'text', text }], stop_reason: 'end_turn',
  usage: { input_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 400 },
});
const orReply = (text) => ({
  id: 'gen-test', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0123 },
});

function installFetch(route) {
  const seen = [];
  const prev = global.fetch;
  global.fetch = jest.fn(async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    const body = init && init.body ? JSON.parse(init.body) : null;
    seen.push({ url: u, body });
    const [status, payload] = route(u, body, seen.length);
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  });
  return { seen, restore: () => { global.fetch = prev; } };
}

const ENV = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'LLM_PROVIDER', 'LLM_MAX_RETRIES', 'QUIZ_ANTHROPIC_DIRECT', 'TRANSCRIPT_QUIZ_MODEL', 'LLM_DIRECT_FALLBACK_MODEL'];
function fresh(env) {
  jest.resetModules();
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'test-credit-key', OPENROUTER_API_KEY: 'test-or-key', LLM_MAX_RETRIES: '1' }, env || {});
  for (const [k, v] of Object.entries(env || {})) if (v === undefined) delete process.env[k];
  // eslint-disable-next-line global-require
  return require('../../bot/shared/services/quiz/transcript-quiz-llm');
}
let net;
afterEach(() => {
  if (net) net.restore();
  net = null;
  for (const k of ENV) delete process.env[k];
  jest.resetModules();
});

const SOLVE = { prompt: 'Solve these. Reply as JSON.', maxTokens: 8000, label: 'transcript_quiz.key_verify', model: 'anthropic/claude-sonnet-5', job: 'quiz.keyVerify' };

describe('an anthropic/ quiz call goes to the prepaid Anthropic key', () => {
  test('the request reaches /v1/messages as claude-sonnet-5 at low effort, with nothing the native API refuses', async () => {
    net = installFetch(() => [200, nativeReply('{"answers":[{"q":1,"pick":[1]}]}')]);
    const Llm = fresh();
    const out = await Llm.completeJson(SOLVE);
    expect(net.seen).toHaveLength(1);
    const { url, body } = net.seen[0];
    expect(url).toBe(ANTHROPIC_URL);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.max_tokens).toBe(8000);
    // what OpenRouter's `reasoning:{effort:'low'}` meant, in the native spelling
    expect(body.output_config).toEqual({ effort: 'low' });
    for (const k of ['response_format', 'temperature', 'reasoning', 'usage']) expect(body[k]).toBeUndefined();
    expect(out.json).toEqual({ answers: [{ q: 1, pick: [1] }] });
    // Anthropic returns no cost: the list price is computed ($2/$10 per MTok)
    expect(out.costUsd).toBeCloseTo(2000 * 2e-6 + 400 * 10e-6, 8);
    expect(out.model).toBe('anthropic/claude-sonnet-5');
  });

  test('a fenced JSON reply (no JSON mode on this lane) still parses', async () => {
    net = installFetch(() => [200, nativeReply('```json\n{"ok":true}\n```')]);
    const Llm = fresh();
    const out = await Llm.completeJson(SOLVE);
    expect(out.json).toEqual({ ok: true });
  });

  test('the credit runs out: the SAME call is re-issued on OpenRouter and the quiz gets its answer', async () => {
    net = installFetch((url) => (url === ANTHROPIC_URL ? [400, CREDIT_400] : [200, orReply('{"answers":[]}')]));
    const Llm = fresh();
    const out = await Llm.completeJson(SOLVE);
    expect(net.seen.map((s) => s.url)).toEqual([ANTHROPIC_URL, OPENROUTER_URL]);
    expect(net.seen[1].body.model).toBe('anthropic/claude-sonnet-5');
    expect(out.json).toEqual({ answers: [] });
    expect(mockLogEvent).toHaveBeenCalledWith('lp612.llm.fallback_provider', expect.objectContaining({ to: 'anthropic/claude-sonnet-5' }));
  });
});

describe('the switch back', () => {
  test('QUIZ_ANTHROPIC_DIRECT=off: OpenRouter, exactly as before (JSON mode, low reasoning)', async () => {
    net = installFetch(() => [200, orReply('{"ok":1}')]);
    const Llm = fresh({ QUIZ_ANTHROPIC_DIRECT: 'off' });
    await Llm.completeJson(SOLVE);
    expect(net.seen[0].url).toBe(OPENROUTER_URL);
    expect(net.seen[0].body.model).toBe('anthropic/claude-sonnet-5');
    expect(net.seen[0].body.response_format).toEqual({ type: 'json_object' });
    expect(net.seen[0].body.reasoning).toEqual({ effort: 'low' });
  });

  test('no ANTHROPIC_API_KEY on the service: OpenRouter', async () => {
    net = installFetch(() => [200, orReply('{"ok":1}')]);
    const Llm = fresh({ ANTHROPIC_API_KEY: undefined });
    await Llm.completeJson(SOLVE);
    expect(net.seen[0].url).toBe(OPENROUTER_URL);
  });

  test('no OpenRouter key (the fallback could not run): OpenRouter-shaped call is kept, never a credit-only lane', async () => {
    net = installFetch(() => [200, orReply('{"ok":1}')]);
    const Llm = fresh({ OPENROUTER_API_KEY: undefined });
    expect(Llm.directModelFor('anthropic/claude-sonnet-5')).toBeNull();
  });

  test('the author (a Google model) never moves', async () => {
    net = installFetch(() => [200, orReply('{"ok":1}')]);
    const Llm = fresh();
    await Llm.completeJson({ ...SOLVE, model: null, job: null });
    expect(net.seen[0].url).toBe(OPENROUTER_URL);
    expect(net.seen[0].body.model).toBe('google/gemini-2.5-flash');
  });
});
