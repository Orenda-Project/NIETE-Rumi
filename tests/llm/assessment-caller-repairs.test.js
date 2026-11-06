/**
 * bd-5jmnfj.38.30 — a board-section answer is checked the way the exam writer parses it.
 *
 * _writeSection asks for JSON and reads the reply with extractJsonFromResponse: it locates the first
 * object (inside a ```json fence or after a sentence), escapes raw newlines, repairs small slips, then
 * parses. The seam refused such answers as not_json and asked the fallback writer instead, though the
 * writer would have read them. Listing both assessment jobs in JSON_REPAIRED_BY_CALLER as 'span' makes
 * the seam accept what the writer turns into an object, and still fall back on prose or a cut-off reply.
 *
 * Executed for real: llm-client and the direct-lane facade. Only the network edges are replaced.
 * Every reply below is synthetic. Approved by Amena 2026-11-06 (model-registry is a code-owner file).
 */
const mockState = { or: [], an: [], events: [], anReply: null, anStop: 'end_turn' };

jest.mock('openai', () => function OpenAI() {
  return { chat: { completions: { create: async (params) => {
    mockState.or.push(params);
    return { choices: [{ index: 0, message: { role: 'assistant', content: '{"objective":{}}' }, finish_reason: 'stop' }], usage: { cost: 0.001 } };
  } } } };
});
jest.mock('@anthropic-ai/sdk', () => function Anthropic() {
  return { messages: { create: async (req) => {
    mockState.an.push(req);
    return {
      id: 'msg_1', model: req.model, stop_reason: mockState.anStop,
      content: [{ type: 'text', text: mockState.anReply }], usage: { input_tokens: 5, output_tokens: 3 },
    };
  } } };
});
jest.mock('../../bot/shared/utils/model-cost', () => ({ recordModelCost: () => {} }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (name, data) => mockState.events.push({ name, data }),
  getCurrentCorrelationId: () => 'corr-1',
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: () => {} }));
jest.mock('../../bot/shared/services/e2e-cassette', () => ({ mode: () => 'off', wrapChatCompletions: () => {} }), { virtual: true });

const OLD_ENV = { ...process.env };
const CLAUDE = 'anthropic-direct/claude-sonnet-5';
const SECTION = { seen: { MCQ: [{ slot: 'A.Q1', stem: 'A body moves\nat constant speed. Its acceleration is', options: ['zero', 'one'], key: 'a' }] } };

async function write(job, anReply, { stop = 'end_turn' } = {}) {
  jest.resetModules();
  for (const k of ['ANTHROPIC_API_KEY', 'LLM_PROVIDER', 'LLM_JOB_MODELS', 'LLM_FALLBACK_OFF']) delete process.env[k];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: 'or-key', ANTHROPIC_API_KEY: 'test-key',
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
  });
  Object.assign(mockState, { or: [], an: [], events: [], anReply, anStop: stop });
  // eslint-disable-next-line global-require
  await require('../../bot/shared/config/model-settings').refresh();
  // eslint-disable-next-line global-require
  const { getClient } = require('../../bot/shared/services/llm-client');
  const res = await getClient().chat.completions.create({
    model: CLAUDE, job, fallbackModel: 'google/gemini-3.1-pro-preview',
    messages: [{ role: 'user', content: 'write the section' }], response_format: { type: 'json_object' }, max_tokens: 4000,
  });
  const fallbacks = mockState.events.filter((e) => e.name === 'llm.job_override_fallback');
  return { res, fallbacks, askedClaude: mockState.an.length, askedBehind: mockState.or.length };
}

afterEach(() => { process.env = { ...OLD_ENV }; });

const pretty = JSON.stringify(SECTION, null, 2);
const rawNewline = pretty.replace('moves\\nat', 'moves\nat');

describe.each(['assessment.generate.fde', 'assessment.generate'])('%s: a reply the writer reads is kept', (job) => {
  test.each([
    ['a sentence before the object, with a raw newline in a string', `Here is the section.\n${rawNewline}`],
    ['a trailing comma', pretty.replace(/\n}$/, ',\n}')],
  ])('%s: no fallback', async (_what, reply) => {
    expect(() => JSON.parse(reply)).toThrow();
    const r = await write(job, reply);
    expect(r.fallbacks).toEqual([]);
    expect(r.askedClaude).toBe(1);
    expect(r.askedBehind).toBe(0);
  });

  test('prose only still falls back as not_json', async () => {
    const r = await write(job, 'I could not write this section.');
    expect(r.fallbacks).toHaveLength(1);
    expect(r.fallbacks[0].data.kind).toBe('not_json');
    expect(r.askedBehind).toBe(1);
  });

  test('the map lists the job as span', () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    const { JSON_REPAIRED_BY_CALLER } = require('../../bot/shared/config/model-registry');
    expect(JSON_REPAIRED_BY_CALLER[job]).toBe('span');
  });
});
