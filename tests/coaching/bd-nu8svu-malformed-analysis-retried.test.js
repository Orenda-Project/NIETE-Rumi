/**
 * bd-nu8svu — "❌ Error in processAnalysis" on NIETE production.
 *
 * 24 recordings failed analysis 1–17 Nov; 21 of them because the scoring reply was not valid JSON
 * ("JSON parsing failed: Expected ',' or '}' after property value…"). 35 of the 40 parse failures
 * logged since 19 Oct had finish_reason 'stop' — the model finished and simply wrote a broken
 * object, so asking again usually works: 19 of the 24 sessions did complete when the job was
 * redelivered ~16 minutes later, and 5 never got a report. A reply missing sections is already
 * retried once (incomplete-fico-analysis.test.js); a reply that is not JSON at all was not.
 *
 * Now: an unparseable reply is retried once, straight away. Still unparseable → it throws as before.
 *
 * Executes the real GPT5MiniService.analyzePedagogy with the real FICO module; the only mock is the
 * model client (network boundary).
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('jsonrepair', () => ({ jsonrepair: (s) => s }), { virtual: true });
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: () => {},
  getCurrentCorrelationId: () => null,
}));

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const { domains: DECLARED } = fico.getScoringConstants();
const SECTIONS = Object.keys(DECLARED);
const section = (id, score) => ({ indicators: [{ id, score, applicable: true, evidence: 'e' }] });
const FULL = {
  executive_summary: 'ok',
  domains: Object.fromEntries(SECTIONS.map((k, i) => [k, section(`${k}-1`, 1 + (i % 2))])),
};
// The shape production logged: the object breaks off mid-property and carries on.
const BROKEN = '{"executive_summary": "ok", "domains": {"high_leverage_practices": {"indicators": [{"id": "A1" "score": 2}]}}}';

const reply = (content) => ({
  choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, completion_tokens_details: { reasoning_tokens: 30 } },
});

function stub(replies) {
  const calls = [];
  GPT5MiniService.openai = { chat: { completions: { create: async (req) => { calls.push(req); return reply(replies[Math.min(calls.length, replies.length) - 1]); } } } };
  return calls;
}

describe('bd-nu8svu: a scoring reply that is not valid JSON is retried once', () => {
  const real = GPT5MiniService.openai;
  afterAll(() => { GPT5MiniService.openai = real; });

  test('broken first reply, good retry: the analysis completes on the retry', async () => {
    const calls = stub([BROKEN, FULL]);
    const { analysis } = await GPT5MiniService.analyzePedagogy('transcript', { language: 'en' }, null, fico);
    expect(calls).toHaveLength(2);
    expect(calls[1].messages).toEqual(calls[0].messages);
    for (const k of SECTIONS) expect(analysis.domains[k].assessed).not.toBe(false);
  });

  test('broken twice: it still fails, as before, after exactly one retry', async () => {
    const calls = stub([BROKEN, BROKEN]);
    await expect(GPT5MiniService.analyzePedagogy('transcript', { language: 'en' }, null, fico))
      .rejects.toThrow(/JSON parsing failed/);
    expect(calls).toHaveLength(2);
  });

  test('a good first reply is not retried', async () => {
    const calls = stub([FULL]);
    await GPT5MiniService.analyzePedagogy('transcript', { language: 'en' }, null, fico);
    expect(calls).toHaveLength(1);
  });
});
