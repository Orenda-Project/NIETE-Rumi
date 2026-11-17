/**
 * An analysis reply that is not valid JSON is asked for again ONCE, in the same
 * job, before the session is failed.
 *
 * Production (niete-logs, 10-17 Nov): 11 "Error in processAnalysis" in 7 days,
 * 10 of them "JSON parsing failed" from the scoring call. The model finished
 * normally (finish_reason 'stop', 27-34k chars, the JSON closed) but wrote an
 * invalid character mid-body that jsonrepair could not mend either. The job
 * then threw, so the session was marked failed, the teacher was sent "Sorry,
 * there was an error analyzing your classroom. Please try again." on WhatsApp,
 * and ~15 minutes later SQS redelivered the job and the SAME request parsed
 * fine: 13 of 13 such sessions since 10 Nov ended analysed. The retry was
 * always going to work; it just came after an error message and a quarter of
 * an hour.
 *
 * Executes the real GPT5MiniService.analyzePedagogy with the real FICO module;
 * mocked: the model client (network boundary), and the parse outcome of the
 * one malformed sample (held to production's: it throws; see parseLikeProduction).
 *
 *   J1  first reply unreadable, second readable → resolves after two calls with the same request
 *   J2  both unreadable → still throws "JSON parsing failed" after exactly two calls (SQS takes over)
 *   J3  a readable first reply → exactly one call (unchanged)
 *   J4  the re-ask itself errors → throws the original "JSON parsing failed" after two calls
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('dotenv', () => ({ config: () => ({}) }), { virtual: true });

const GPT5MiniService = require('../../bot/shared/services/gpt5-mini.service');
const fico = require('../../bot/shared/services/coaching/frameworks/fico-framework');

const reply = (content) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
});
const READABLE = reply(JSON.stringify({ executive_summary: 'ok', domains: {} }));
// A complete reply with one bad character mid-body, the production shape.
const UNREADABLE_TEXT = '{\n  "executive_summary": "The teacher asked "why?"",\n  "domains": {}\n}';
const UNREADABLE = reply(UNREADABLE_TEXT);

// Whether a given jsonrepair release can mend THIS sample differs by version (3.14 cannot, a later
// one can), and production's own samples were ones the shipped jsonrepair could not mend. So the
// parse step is held to production's outcome for the sample — it throws, with production's message —
// and every other reply goes through the real parser.
const realParse = GPT5MiniService._safeJsonParse.bind(GPT5MiniService);
function parseLikeProduction() {
  return jest.spyOn(GPT5MiniService, '_safeJsonParse').mockImplementation((content) => {
    if (content === UNREADABLE_TEXT) {
      throw new SyntaxError("Expected ',' or '}' after property value in JSON at position 45 (line 2 column 44)");
    }
    return realParse(content);
  });
}

function stub(behaviour) {
  const calls = [];
  GPT5MiniService.openai = { chat: { completions: { create: async (req) => { calls.push(req); return behaviour(req, calls.length); } } } };
  return calls;
}

describe('an unreadable analysis reply is asked for again once, in the same job', () => {
  const real = GPT5MiniService.openai;
  let parseSpy;
  beforeEach(() => { parseSpy = parseLikeProduction(); });
  afterEach(() => { parseSpy.mockRestore(); });
  afterAll(() => { GPT5MiniService.openai = real; });

  test('J1: unreadable then readable → the analysis completes after two calls with the same request', async () => {
    const calls = stub((req, n) => (n === 1 ? UNREADABLE : READABLE));
    const out = await GPT5MiniService.analyzePedagogy('transcript', { language: 'ur' }, null, fico);
    expect(out.analysis).toBeTruthy();
    expect(out.analysis.executive_summary).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(calls[1].messages).toEqual(calls[0].messages);
    expect(calls[1].model).toBe(calls[0].model);
  });

  test('J2: unreadable twice → still fails with JSON parsing failed, after exactly two calls', async () => {
    const calls = stub(() => UNREADABLE);
    await expect(GPT5MiniService.analyzePedagogy('transcript', { language: 'ur' }, null, fico))
      .rejects.toThrow(/JSON parsing failed/);
    expect(calls).toHaveLength(2);
  });

  test('J3: a readable first reply → exactly one call (unchanged)', async () => {
    const calls = stub(() => READABLE);
    await GPT5MiniService.analyzePedagogy('transcript', { language: 'ur' }, null, fico);
    expect(calls).toHaveLength(1);
  });

  test('J4: the re-ask itself errors → the original JSON parsing failure is thrown, after two calls', async () => {
    const calls = stub((req, n) => { if (n === 1) return UNREADABLE; throw new Error('Connection error.'); });
    await expect(GPT5MiniService.analyzePedagogy('transcript', { language: 'ur' }, null, fico))
      .rejects.toThrow(/JSON parsing failed/);
    expect(calls).toHaveLength(2);
  });
});
