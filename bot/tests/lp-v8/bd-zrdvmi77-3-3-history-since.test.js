/**
 * bd-zrdvmi.77.3.3 — a follow-up about the plan she JUST got reads only the chat since that plan.
 *
 * Staging phone check, 28 Nov 2026 (LP_CONTEXT_V2_ENABLED on, tier B "explicit-reference",
 * grade_5_math_ch3_seg1 injected right before her turn): the teacher had typed a Grade 5
 * SCIENCE topic three minutes earlier, then opened the Grade 5 MATHS ch3 plan in the app.
 *   "give me this lesson plan in text form" -> "I'm creating ... Grade 5 Science ... give me a moment"
 *   "improve the lp"                        -> a generic science plan
 * The right plan was in front of the model both times; the older chat topic won. bd-wpupy
 * found the same pull and measured that the same block and model answer correctly with no
 * history. So when the resolver is sure she means the plan just delivered, the turns from
 * before that plan landed are left out of the model's view.
 */

/* eslint-disable global-require */

const mockCreate = jest.fn(async () => ({ choices: [{ message: { content: 'ok' } }] }));
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  chat: { completions: { create: mockCreate } },
})));
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const OpenAIService = require('../../shared/services/openai.service');
const lpContext = require('../../shared/services/lp-context.service');

const MIN = 60 * 1000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

function ctxWith(deliveredMsAgo) {
  return {
    identityLine: 'IDENTITY',
    fullBlock: 'FULL',
    lessonIds: ['grade_5_math_ch3_seg1'],
    referenceTerms: [],
    source: 'downloads',
    entries: [{
      lesson_id: 'grade_5_math_ch3_seg1', grade: 5, subject: 'math', chapter_number: 3,
      delivered_at: iso(deliveredMsAgo), _viaApp: true,
    }],
  };
}

describe('injectLpContext reports how far back a plan follow-up should read', () => {
  const prev = process.env.LP_CONTEXT_V2_ENABLED;
  beforeEach(() => { process.env.LP_CONTEXT_V2_ENABLED = 'true'; });
  afterAll(() => { process.env.LP_CONTEXT_V2_ENABLED = prev; });

  test('row 951 words, plan opened 1 min ago -> read from just before the plan landed', async () => {
    const out = {};
    const ctx = ctxWith(1 * MIN);
    await lpContext.injectLpContext({
      userId: 'u1', message: 'give me this lesson plan in text form', intent: {}, prebuiltCtx: ctx, out,
    });
    expect(typeof out.historySince).toBe('string');
    const since = new Date(out.historySince).getTime();
    const landed = new Date(ctx.entries[0].delivered_at).getTime();
    expect(since).toBeLessThanOrEqual(landed);
    expect(landed - since).toBeLessThanOrEqual(60 * 1000);
  });

  test('row 937 words ("improve the lp") -> same', async () => {
    const out = {};
    await lpContext.injectLpContext({
      userId: 'u1', message: 'improve the lp', intent: {}, prebuiltCtx: ctxWith(2 * MIN), out,
    });
    expect(out.historySince).toEqual(expect.any(String));
  });

  test('a message that is not about the plan keeps the whole chat', async () => {
    const out = {};
    await lpContext.injectLpContext({
      userId: 'u1', message: 'how do I register my school for the training next week?', intent: {},
      prebuiltCtx: ctxWith(1 * MIN), out,
    });
    expect(out.historySince).toBeUndefined();
  });

  test('switch off -> unchanged behaviour, whole chat', async () => {
    process.env.LP_CONTEXT_V2_ENABLED = 'false';
    const out = {};
    await lpContext.injectLpContext({
      userId: 'u1', message: 'give me this lesson plan in text form', intent: {}, prebuiltCtx: ctxWith(1 * MIN), out,
    });
    expect(out.historySince).toBeUndefined();
  });

  test('callers that pass no `out` still work', async () => {
    await expect(lpContext.injectLpContext({
      userId: 'u1', message: 'improve the lp', intent: {}, prebuiltCtx: ctxWith(1 * MIN),
    })).resolves.toEqual(expect.stringContaining('FULL'));
  });
});

describe('getResponseWithFormat honours historySince', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    jest.spyOn(OpenAIService, 'getConversationHistory').mockResolvedValue([
      { role: 'user', content: 'Grade 5 Science, topic: transparent, translucent and opaque objects', at: iso(6 * MIN) },
      { role: 'assistant', content: 'Open your lesson plans.', at: iso(6 * MIN) },
      { role: 'assistant', content: '[lesson plan sent] Grade 5 math Ch 3', at: iso(2 * MIN) },
    ]);
  });
  afterEach(() => jest.restoreAllMocks());

  test('turns from before the plan landed are left out; later ones stay', async () => {
    await OpenAIService.getResponseWithFormat('improve the lp', 'u1', 'text', 'en', 'Amena', 'LP_BLOCK',
      { historySince: iso(3 * MIN) });
    const { messages } = mockCreate.mock.calls[0][0];
    const text = JSON.stringify(messages);
    expect(text).not.toMatch(/transparent, translucent/);
    expect(text).toMatch(/\[lesson plan sent\]/);
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'improve the lp' });
  });

  test('without historySince the whole chat is sent, and no bookkeeping field reaches the model', async () => {
    await OpenAIService.getResponseWithFormat('hello', 'u1', 'text', 'en', 'Amena', null);
    const { messages } = mockCreate.mock.calls[0][0];
    expect(JSON.stringify(messages)).toMatch(/transparent, translucent/);
    messages.forEach((m) => expect(Object.keys(m).sort()).toEqual(['content', 'role']));
  });
});
